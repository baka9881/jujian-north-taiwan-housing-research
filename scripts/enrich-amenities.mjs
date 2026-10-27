import { geocodingProvider } from "./geocoding-provider.mjs";
import {
  extractIntersectionRoads,
  findCrossRoad,
  parseCountyItems,
  parseCrossRoads,
  parseTownItems,
} from "./nlsc-intersections.mjs";
import { regionFor } from "./regions.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(root, "data", "processed", "projects.json");
const outputPath = path.join(root, "data", "processed", "amenities.json");
const cacheDirectory = path.join(root, "data", "cache");
const geocodeCachePath = path.join(cacheDirectory, "nominatim-projects.json");
const overpassCachePath = path.join(cacheDirectory, "overpass-pois.json");
const nominatimAmenitiesCachePath = path.join(cacheDirectory, "nominatim-amenities.json");
const intersectionCachePath = path.join(cacheDirectory, "nlsc-intersections.json");
const nlscAdminCachePath = path.join(cacheDirectory, "nlsc-admin.json");
const locationOverridesPath = path.join(root, "data", "manual", "location-overrides.json");
const userAgent = "JujianNorthTaiwan/1.0 (+https://jujian-north-taiwan.baka0406.chatgpt.site)";
const geocoder = geocodingProvider();
const generatedAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

const officialIntersectionSpecs = {
  "林口-03-217128": { county: "F", town: "F02", road: "文化二路二段", cross: "吉祥路" },
  "林口-05-6701e3": { county: "F", town: "F02", road: "仁愛路一段", cross: "新生街" },
  "林口-06-d0c30b": { county: "F", town: "F02", road: "文化二路二段", cross: "中華路" },
  "林口-09-69e9f6": { county: "F", town: "F02", road: "文化三路二段", cross: "中山路" },
  "林口-16-187dad": { county: "F", town: "F02", road: "八德路", cross: "三民路" },
  "林口-18-553cd8": { county: "F", town: "F02", road: "竹林一路", cross: "民享路" },
  "林口-20-1aa799": { county: "F", town: "F02", road: "南勢三街", cross: "南勢三街138巷" },
  "a7-02-234762": { county: "H", town: "H07", road: "樂學路", cross: "長慶三街" },
  "a7-04-acfee0": { county: "H", town: "H07", road: "樂學路", cross: "長慶一街" },
  "a7-07-cd952c": { county: "H", town: "H07", road: "樂善二路", cross: "文化二路" },
  "a7-08-0362a4": { county: "H", town: "H07", road: "樂善二路", cross: "牛角坡路" },
  "a7-09-9e9aa8": { county: "H", town: "H07", road: "長慶一街", cross: "長慶二街" },
  "a7-10-e86850": { county: "H", town: "H07", road: "文桃路", cross: "牛角坡路" },
  "a7-17-803131": { county: "H", town: "H07", road: "樂善二路", cross: "文化二路" },
  "a7-18-78daaa": { county: "H", town: "H07", road: "樂善一路", cross: "牛角坡路" },
  "a7-19-f52012": { county: "H", town: "H07", road: "文化二路", cross: "樂善二路" },
};

const categories = {
  convenience: { label: "便利商店", symbol: "商" },
  pxmart: { label: "全聯", symbol: "全" },
  costco: { label: "好市多", symbol: "好" },
  station: { label: "捷運／車站", symbol: "站" },
  school: { label: "學校", symbol: "學" },
  medical: { label: "醫療", symbol: "醫" },
  market: { label: "市場／超市", symbol: "市" },
  park: { label: "公園", symbol: "園" },
  pharmacy: { label: "藥局", symbol: "藥" },
  parking: { label: "停車場", symbol: "停" },
};

const scoreRules = [
  { category: "convenience", label: "便利商店", maxScore: 20, bands: [[300, 20], [500, 15], [800, 8]] },
  { category: "pxmart", label: "全聯", maxScore: 20, bands: [[800, 20], [1500, 12], [2500, 6]] },
  { category: "costco", label: "好市多", maxScore: 15, bands: [[5000, 15], [10000, 10], [15000, 5]] },
  { category: "station", label: "捷運／車站", maxScore: 25, bands: [[800, 25], [1200, 18], [2000, 10]] },
  { category: "school", label: "學校", maxScore: 10, bands: [[800, 10], [1500, 6]] },
  { category: "medical", label: "醫療", maxScore: 10, bands: [[1200, 10], [2500, 6]] },
];

const retryableLocationMethods = new Set(["region-center", "catalogue-fallback"]);

function usableGeocodeResult(result) {
  return Number.isFinite(Number(result?.lat)) && Number.isFinite(Number(result?.lon));
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function shouldRefreshGeocode(previousLocation, queryAddress, cachedResult, cacheHasEntry = false) {
  const addressChanged = Boolean(previousLocation) && previousLocation.queryAddress !== queryAddress;
  if (addressChanged) return true;
  if (cacheHasEntry && usableGeocodeResult(cachedResult)) return false;
  if (!previousLocation || previousLocation.queryAddress !== queryAddress) return true;
  return retryableLocationMethods.has(previousLocation.method);
}

export function splitAmenityWork(projects, resolveProjectRegion = regionFor) {
  const locationProjects = [];
  const scoredProjects = [];
  for (const project of projects) {
    const region = resolveProjectRegion(project);
    if (!region) throw new Error(`未設定分區：${project.region}`);
    locationProjects.push(project);
    if (region.amenityEnabled) scoredProjects.push(project);
  }
  return { locationProjects, scoredProjects };
}

function emptyCategoryValues(value) {
  return Object.fromEntries(Object.keys(categories).map((category) => [category, value]));
}

export function unavailableAmenityProject(location) {
  return {
    location,
    score: null,
    rawScore: 0,
    distanceScore: null,
    grade: null,
    scoreReliability: "unavailable",
    nearest: emptyCategoryValues(null),
    categoryScores: emptyCategoryValues(0),
    routeScores: emptyCategoryValues(0),
    densityScores: emptyCategoryValues(0),
    nearbyCounts: emptyCategoryValues(0),
    scoreFormulaVersion: 2,
  };
}

function fallbackPoint(project) {
  const seed = [...project.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  const latitudeJitter = ((seed % 9) - 4) * 0.00007;
  const longitudeJitter = (((seed * 7) % 9) - 4) * 0.00007;
  if (project.region === "林口") {
    const x = (project.mapX - 25) / 19;
    const y = (project.mapY - 33) / 34;
    return { latitude: 25.0885 - y * 0.0205 + latitudeJitter, longitude: 121.364 + x * 0.023 + longitudeJitter };
  }
  if (project.region === "A7") {
    const x = (project.mapX - 57) / 15;
    const y = (project.mapY - 42) / 30;
    return { latitude: 25.057 - y * 0.018 + latitudeJitter, longitude: 121.381 + x * 0.017 + longitudeJitter };
  }
  const region = regionFor(project);
  if (!region) throw new Error(`未設定分區：${project.region}`);
  return { latitude: region.center[0], longitude: region.center[1] };
}

function fallbackLocation(project, queryAddress) {
  const point = fallbackPoint(project);
  if (project.region !== "林口" && project.region !== "A7") {
    return {
      ...point,
      confidence: "estimated",
      method: "region-center",
      label: "分區示意中心，非建案位置",
      queryAddress,
    };
  }
  return {
    ...point,
    confidence: "estimated",
    method: "catalogue-fallback",
    label: "區域估算位置",
    queryAddress,
  };
}

function cleanAddress(address) {
  return address
    .replace(/(\d+)號旁/gu, "$1號")
    .replace(/對面工地|對面|附近|旁|等$/gu, "")
    .replace(/、/gu, "與")
    .replace(/跟/gu, "與")
    .replace(/交岔路口|交叉路口|交叉口|路口/gu, "與")
    .replace(/與+/gu, "與")
    .replace(/與$/u, "")
    .trim();
}

function geocodeQueries(project) {
  const cleaned = cleanAddress(project.address);
  const roadParts = cleaned.split("與").map((part) => part.trim()).filter(Boolean);
  return [...new Set([
    `${project.city}${project.district}${cleaned}`,
    roadParts.length > 1 ? `${project.city}${project.district}${roadParts[0]}` : null,
  ].filter(Boolean))];
}

function geocodeMatches(project, result) {
  if (!result) return false;
  const roadTokens = project.address.match(/[\p{Script=Han}\d]+(?:路(?:[一二三四五六七八九十]+段)?|街(?:\d+巷)?)/gu) || [];
  if (!roadTokens.length) return true;
  const displayName = result.display_name || "";
  return roadTokens.some((token) => displayName.includes(token));
}

function locationConfidence(project, result) {
  if (!result) {
    return { confidence: "estimated", method: "catalogue-fallback", label: "區域估算位置" };
  }
  const address = project.address;
  const resultType = `${result.category || ""} ${result.type || ""}`;
  if (/\d+號/u.test(address) && /house|building|residential/u.test(resultType)) {
    return { confidence: "high", method: "nominatim-address", label: "門牌定位" };
  }
  if (/交叉|路口|與/u.test(address)) {
    return { confidence: "medium", method: "nominatim-intersection", label: "路口附近" };
  }
  return { confidence: "low", method: "nominatim-road", label: "道路中心附近" };
}

async function geocodeProjects(projects, previousProjects) {
  const cache = await readJson(geocodeCachePath, {});
  const refreshedProjectIds = new Set();
  let changed = false;

  for (const [index, project] of projects.entries()) {
    const queryAddress = `${project.city}${project.district}${project.address}`;
    const previousLocation = previousProjects[project.id]?.location;
    const cacheHasEntry = Object.hasOwn(cache, project.id);
    const refreshGeocode = shouldRefreshGeocode(previousLocation, queryAddress, cache[project.id], cacheHasEntry);
    if (refreshGeocode) {
      if (!geocoder) {
        if (previousLocation && previousLocation.queryAddress !== queryAddress && cacheHasEntry) {
          cache[project.id] = null;
          changed = true;
        }
        continue;
      }
      let matchedResult = null;
      for (const query of geocodeQueries(project)) {
        const params = new URLSearchParams({
          q: query,
          format: "jsonv2",
          limit: "1",
          countrycodes: "tw",
          addressdetails: "1",
          "accept-language": "zh-TW,zh-Hant",
        });
        const response = await fetch(`${geocoder.url}?${params}`, {
          headers: { "User-Agent": userAgent, Referer: "https://jujian-north-taiwan.baka0406.chatgpt.site" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Nominatim ${response.status} for ${project.id}`);
        const results = await response.json();
        if (geocodeMatches(project, results[0])) {
          matchedResult = results[0];
          break;
        }
        await sleep(geocoder.intervalMs);
      }
      cache[project.id] = matchedResult;
      refreshedProjectIds.add(project.id);
      changed = true;
      console.log(`[${index + 1}/${projects.length}] 定位 ${project.name}: ${matchedResult?.display_name || "無結果"}`);
      await writeFile(geocodeCachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
      await sleep(geocoder.intervalMs);
    }
  }

  if (changed) await writeFile(geocodeCachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

  return Object.fromEntries(projects.map((project) => {
    const queryAddress = `${project.city}${project.district}${project.address}`;
    const previousLocation = previousProjects[project.id]?.location;
    const sameAddress = previousLocation?.queryAddress === queryAddress;
    const result = refreshedProjectIds.has(project.id) || !previousLocation || sameAddress ? cache[project.id] : null;
    if (usableGeocodeResult(result)) {
      return [project.id, {
        latitude: Number(result.lat),
        longitude: Number(result.lon),
        ...locationConfidence(project, result),
        queryAddress,
      }];
    }
    if (sameAddress) return [project.id, previousLocation];
    return [project.id, fallbackLocation(project, queryAddress)];
  }));
}

async function fetchNlscText(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 750);
    }
  }
  throw new Error(`NLSC ${label} 查詢失敗：${lastError?.message || "未知錯誤"}`);
}

async function loadNlscAdminCodes(projects) {
  const cached = await readJson(nlscAdminCachePath, { counties: {}, towns: {} });
  let changed = false;
  if (!Object.keys(cached.counties || {}).length) {
    cached.counties = parseCountyItems(await fetchNlscText("https://api.nlsc.gov.tw/other/ListCounty", "縣市代碼"));
    changed = true;
  }
  const cities = [...new Set(projects.map((project) => project.city))];
  for (const city of cities) {
    const county = cached.counties[city];
    if (!county || Object.keys(cached.towns?.[city] || {}).length) continue;
    cached.towns ||= {};
    cached.towns[city] = parseTownItems(await fetchNlscText(`https://api.nlsc.gov.tw/other/ListTown/${county}`, `${city}行政區代碼`));
    changed = true;
  }
  if (changed) {
    cached.updatedAt = generatedAt;
    await writeFile(nlscAdminCachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
  }
  return cached;
}

function canUseOfficialIntersection(location) {
  return ["region-center", "catalogue-fallback", "nominatim-road"].includes(location?.method);
}

async function refineOfficialIntersections(locations, projects) {
  const cache = await readJson(intersectionCachePath, {});
  const admin = await loadNlscAdminCodes(projects);
  const automaticSpecs = Object.fromEntries(projects.flatMap((project) => {
    if (officialIntersectionSpecs[project.id] || !canUseOfficialIntersection(locations[project.id])) return [];
    const roads = extractIntersectionRoads(project.address);
    const county = admin.counties?.[project.city];
    const town = admin.towns?.[project.city]?.[project.district];
    return roads && county && town ? [[project.id, { county, town, road: roads[0], cross: roads[1] }]] : [];
  }));
  const specs = { ...automaticSpecs, ...officialIntersectionSpecs };
  let matchedCount = 0;
  let fetchedCount = 0;
  const intervalMs = Math.max(100, Number(process.env.JUJIAN_NLSC_INTERVAL_MS || 200));

  async function crossRoadsFor(spec) {
    const cacheKey = `${spec.county}/${spec.town}/${spec.road}`;
    if (!Object.hasOwn(cache, cacheKey)) {
      const url = `https://api.nlsc.gov.tw/idc/ListRoadCross/${spec.county}/${spec.town}/${encodeURIComponent(spec.road)}`;
      cache[cacheKey] = parseCrossRoads(await fetchNlscText(url, `${spec.road}路口`));
      fetchedCount += 1;
      await writeFile(intersectionCachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
      await sleep(intervalMs);
    }
    return cache[cacheKey];
  }

  for (const [projectId, spec] of Object.entries(specs)) {
    let match = findCrossRoad(await crossRoadsFor(spec), spec.cross);
    let matchedRoad = spec.road;
    let matchedCross = spec.cross;
    if (!match && !officialIntersectionSpecs[projectId]) {
      match = findCrossRoad(await crossRoadsFor({ ...spec, road: spec.cross }), spec.road);
      matchedRoad = spec.cross;
      matchedCross = spec.road;
    }
    if (!match) {
      console.warn(`官方路口尚未匹配：${spec.road} × ${spec.cross}`);
      continue;
    }
    locations[projectId] = {
      latitude: match.latitude,
      longitude: match.longitude,
      confidence: "high",
      method: "nlsc-official-intersection",
      label: "官方路口定位",
      queryAddress: locations[projectId].queryAddress,
      officialReference: { provider: "NLSC", road: matchedRoad, crossRoad: matchedCross },
    };
    matchedCount += 1;
  }
  console.log(`NLSC 官方路口：${matchedCount}/${Object.keys(specs).length} 案匹配，本次新增 ${fetchedCount} 筆道路快取`);
  return locations;
}

async function applyManualOverrides(locations) {
  const overrides = await readJson(locationOverridesPath, { projects: {} });
  for (const [projectId, override] of Object.entries(overrides.projects || {})) {
    if (!locations[projectId]) {
      console.warn(`人工定位找不到建案：${projectId}`);
      continue;
    }
    const latitude = Number(override.latitude);
    const longitude = Number(override.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`人工定位座標無效：${projectId}`);
    }
    locations[projectId] = {
      ...locations[projectId],
      latitude,
      longitude,
      confidence: "high",
      method: "manual-verified",
      label: override.label || "人工核對定位",
      note: override.note || null,
    };
  }
  return locations;
}

const coreBounds = "25.025,121.335,25.110,121.420";
const overpassQueries = {
  convenience: `[out:json][timeout:60];nwr["shop"="convenience"](${coreBounds});out center tags;`,
  supermarket: `[out:json][timeout:60];nwr["shop"="supermarket"](${coreBounds});out center tags;`,
  station: `[out:json][timeout:30];(node["railway"="station"](${coreBounds});node["railway"="halt"](${coreBounds}););out body;`,
  school: `[out:json][timeout:60];nwr["amenity"="school"](${coreBounds});out center tags;`,
  medical: `[out:json][timeout:60];nwr["amenity"~"hospital|clinic"](${coreBounds});out center tags;`,
  market: `[out:json][timeout:60];nwr["amenity"="marketplace"](${coreBounds});out center tags;`,
  costco: `[out:json][timeout:60];nwr["name"~"好市多|Costco",i](24.85,121.15,25.30,121.65);out center tags;`,
};

const nominatimAmenityQueries = {
  park: "[park]",
  pharmacy: "[pharmacy]",
  parking: "[parking]",
  market: "[marketplace]",
};

async function loadOverpass() {
  const cached = await readJson(overpassCachePath, { elementsByQuery: {} });
  const endpoints = ["https://overpass.osm.ch/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"];
  for (const [name, query] of Object.entries(overpassQueries)) {
    if (cached.elementsByQuery[name]?.length) continue;
    if (name === "station") {
      cached.elementsByQuery[name] = [];
      await writeFile(overpassCachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
      continue;
    }
    let lastError;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: { "User-Agent": userAgent },
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        cached.elementsByQuery[name] = data.elements || [];
        console.log(`設施 ${name}: ${cached.elementsByQuery[name].length}`);
        await writeFile(overpassCachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.warn(`Overpass ${name} 暫時失敗（${endpoint}）：${error.message}`);
      }
    }
    if (lastError) {
      cached.elementsByQuery[name] = [];
      console.warn(`Overpass ${name} 本次無法取得，先保留空集合並使用可驗證的補充資料。`);
      await writeFile(overpassCachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
    }
    await sleep(1000);
  }
  return { elements: Object.values(cached.elementsByQuery).flat() };
}

async function loadNominatimAmenities() {
  const cache = await readJson(nominatimAmenitiesCachePath, {});
  for (const [category, query] of Object.entries(nominatimAmenityQueries)) {
    if (cache[category]?.length || !geocoder) continue;
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "50",
      bounded: "1",
      viewbox: "121.335,25.110,121.420,25.025",
      "accept-language": "zh-TW,zh-Hant",
    });
    const response = await fetch(`${geocoder.url}?${params}`, {
      headers: { "User-Agent": userAgent, Referer: "https://jujian-north-taiwan.baka0406.chatgpt.site" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Nominatim amenities ${response.status}: ${category}`);
    cache[category] = await response.json();
    await writeFile(nominatimAmenitiesCachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await sleep(geocoder.intervalMs);
  }

  return Object.entries(cache).flatMap(([category, results]) => results.map((result) => ({
    type: "nominatim",
    id: result.place_id,
    lat: Number(result.lat),
    lon: Number(result.lon),
    tags: {
      name: result.name?.trim() || categories[category].label,
      "addr:full": result.display_name || null,
      ...(category === "park" ? { leisure: "park" } : { amenity: category === "market" ? "marketplace" : category }),
    },
  })));
}

function classifyPoi(tags = {}) {
  const identity = [tags.name, tags["name:zh"], tags.brand, tags.operator].filter(Boolean).join(" ");
  if (tags.amenity === "parking") return "parking";
  if (/好市多|costco/iu.test(identity) && (tags.shop || tags.building)) return "costco";
  if (/全聯|px\s*mart|pxmart/iu.test(identity)) return "pxmart";
  if (tags.shop === "convenience") return "convenience";
  if (tags.railway === "station" || tags.railway === "halt") return "station";
  if (tags.amenity === "school") return "school";
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "medical";
  if (tags.amenity === "marketplace" || tags.shop === "supermarket") return "market";
  if (tags.leisure === "park") return "park";
  if (tags.amenity === "pharmacy") return "pharmacy";
  return null;
}

function poiAddress(tags = {}) {
  if (tags["addr:full"]) return tags["addr:full"];
  return [tags["addr:city"], tags["addr:district"], tags["addr:street"], tags["addr:housenumber"]]
    .filter(Boolean)
    .join("");
}

function normalizePois(overpass) {
  const pois = [];
  const seen = new Set();
  for (const element of overpass.elements || []) {
    const category = classifyPoi(element.tags);
    const latitude = Number(element.lat ?? element.center?.lat);
    const longitude = Number(element.lon ?? element.center?.lon);
    if (!category || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const id = `${element.type}-${element.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    pois.push({
      id,
      name: element.tags?.name || element.tags?.["name:zh"] || categories[category].label,
      category,
      latitude,
      longitude,
      address: poiAddress(element.tags) || null,
    });
  }
  const supplementalPois = [
    { id: "node-4456093778", name: "A9 林口站", category: "station", latitude: 25.0657846, longitude: 121.3614372, address: "新北市林口區八德路" },
    { id: "node-4653352241", name: "A8 長庚醫院站", category: "station", latitude: 25.0604744, longitude: 121.3707965, address: "桃園市龜山區" },
    { id: "node-4653352242", name: "A7 體育大學站", category: "station", latitude: 25.0413317, longitude: 121.3854083, address: "桃園市龜山區" },
    { id: "way-183547237", name: "好市多 桃園南崁店", category: "costco", latitude: 25.0542781, longitude: 121.2819513, address: "桃園市蘆竹區南崁" },
    { id: "way-183001662", name: "林口國中", category: "school", latitude: 25.0770334, longitude: 121.3771228, address: "新北市林口區民治路25號" },
    { id: "way-182688791", name: "麗林國小", category: "school", latitude: 25.0683973, longitude: 121.3685137, address: "新北市林口區公園路46號" },
    { id: "node-9741206307", name: "樂善國小", category: "school", latitude: 25.0519917, longitude: 121.3843066, address: "桃園市龜山區樂學三路" },
    { id: "way-1310794583", name: "文青國中小", category: "school", latitude: 25.0449991, longitude: 121.3910210, address: "桃園市龜山區樂善二路778號" },
  ];
  for (const poi of supplementalPois) {
    if (seen.has(poi.id)) continue;
    seen.add(poi.id);
    pois.push(poi);
  }
  return pois.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "zh-Hant"));
}

function haversineMeters(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function nearestPoi(projectLocation, pois, category) {
  const candidates = pois
    .filter((poi) => poi.category === category)
    .map((poi) => ({ poi, distanceMeters: Math.round(haversineMeters(projectLocation, poi)) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  if (!candidates.length) return null;
  const { poi, distanceMeters } = candidates[0];
  return { ...poi, distanceMeters, walkMinutes: Math.max(1, Math.ceil(distanceMeters / 80)) };
}

function categoryScore(distanceMeters, rule) {
  if (!Number.isFinite(distanceMeters)) return 0;
  return rule.bands.find(([limit]) => distanceMeters <= limit)?.[1] || 0;
}

function gradeFor(score) {
  if (score >= 80) return "非常便利";
  if (score >= 65) return "便利";
  if (score >= 45) return "基本足夠";
  return "機能較少";
}

async function main() {
  await mkdir(cacheDirectory, { recursive: true });
  const projectDataset = await readJson(projectsPath, null);
  const previousDataset = await readJson(outputPath, { projects: {} });
  const { locationProjects, scoredProjects } = splitAmenityWork(projectDataset.projects);
  const geocoded = await geocodeProjects(locationProjects, previousDataset.projects || {});
  const locations = await applyManualOverrides(await refineOfficialIntersections(geocoded, locationProjects));
  const [overpass, nominatimAmenities] = await Promise.all([loadOverpass(), loadNominatimAmenities()]);
  const pois = normalizePois({ elements: [...overpass.elements, ...nominatimAmenities] });
  const scoredProjectIds = new Set(scoredProjects.map((project) => project.id));
  const projects = Object.fromEntries(locationProjects
    .filter((project) => !scoredProjectIds.has(project.id))
    .map((project) => [project.id, unavailableAmenityProject(locations[project.id])]));

  for (const project of scoredProjects) {
    const location = locations[project.id];
    const nearest = Object.fromEntries(Object.keys(categories).map((category) => [category, nearestPoi(location, pois, category)]));
    const rawScore = scoreRules.reduce((total, rule) => total + categoryScore(nearest[rule.category]?.distanceMeters, rule), 0);
    const scoreReliability = location.confidence === "estimated"
      ? "unavailable"
      : location.confidence === "low"
        ? "approximate"
        : "verified";
    projects[project.id] = {
      location,
      score: scoreReliability === "unavailable" ? null : rawScore,
      rawScore,
      grade: scoreReliability === "unavailable" ? null : gradeFor(rawScore),
      scoreReliability,
      nearest,
    };
  }

  const payload = {
    generatedAt,
    source: {
      name: "OpenStreetMap contributors",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL",
      service: "Nominatim 與 Overpass API",
    },
    methodology: {
      distance: "兩點間直線距離",
      walkingMetersPerMinute: 80,
      disclaimer: "距離與步行時間為直線距離換算，未考慮實際道路、坡度、圍牆、紅綠燈與出入口，不可當作導航時間。",
      locationDisclaimer: "建案位置先讀官方申報街道；兩條道路可由國土測繪中心資料完全匹配時，顯示官方路口參考點。路口與道路點都不代表精確基地界址。",
      locationSources: [
        { name: "內政部預售屋建案備查資料", url: "https://data.gov.tw/dataset/176351", role: "申報街道與基地" },
        { name: "國土測繪中心路口 API", url: "https://data.gov.tw/dataset/167920", role: "路口坐標" },
      ],
      scoreDisclaimer: "只有官方路口、門牌或可辨識道路位置才顯示機能分數；區域估算位置不顯示分數。",
      scoreRules,
    },
    categories,
    poiCount: pois.length,
    pois,
    projects,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const counts = Object.keys(categories).map((category) => `${categories[category].label} ${pois.filter((poi) => poi.category === category).length}`).join("、");
  console.log(`完成：定位 ${locationProjects.length} 個建案，機能評估 ${scoredProjects.length} 個建案，${pois.length} 個設施（${counts}）`);
  console.log(`輸出：${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
