import { regions, resolveRegion } from "./regions.mjs";
import { parseBuildcaseCsv } from "./buildcase-csv.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanBuilder,
  fetchBytes,
  householdCount,
  normalizeIdentity,
  normalizeName,
  rocToIso,
  seededPosition,
  sourceKeyFor,
  stableHash,
  todayTaipei,
} from "./data-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(root, "data", "processed", "projects.json");
const reportPath = path.join(root, "data", "processed", "update-report.json");
const sourceDirectory = path.join(root, "data", "source", "current-buildcases");
const officialBase = "https://plvr.land.moi.gov.tw";
const sourceSpecs = regions.map((region) => ({ ...region, region: region.label }));
const sourceManifest = [];
const officialFields = [
  "name", "city", "district", "builder", "households", "zoning", "mainUse", "material", "address",
  "buildingLand", "declaredDate", "permitDate", "permitNo", "firstRegistrationDate", "registryNumber",
  "sourceIntegrity",
];

function validValue(value) {
  return value && value !== "未提供";
}

function eligible(row, spec) {
  const name = row.建案名稱 || "";
  if (!name || /\?|�/u.test(name) || !String(row.主要用途 || "").includes("住宅")) return false;
  return resolveRegion(spec.city, row.鄉鎮市區, row.坐落街道, row.坐落基地)?.id === spec.id;
}

function officialProject(row, spec) {
  const project = {
    name: row.建案名稱.trim(),
    region: spec.region,
    city: spec.city,
    district: row.鄉鎮市區.trim(),
    builder: cleanBuilder(row.起造人),
    households: householdCount(row.層棟戶數),
    zoning: (row.使用分區 || "未提供").trim(),
    mainUse: (row.主要用途 || "未提供").trim(),
    material: (row.主要建材 || "未提供").trim(),
    address: (row.坐落街道 || "未提供").trim(),
    buildingLand: (row.坐落基地 || "未提供").trim(),
    declaredDate: rocToIso(row.申報備查日期),
    permitDate: rocToIso(row.建照核發日期),
    permitNo: (row.建造執照 || "未提供").trim(),
    firstRegistrationDate: rocToIso(row["第1次登記日期"]),
    registryNumber: (row.編號 || "未提供").trim(),
    sourceIntegrity: row.__sourceRepair || null,
  };
  return { ...project, sourceKey: sourceKeyFor(project) };
}

function matchKeys(project) {
  const keys = [];
  if (validValue(project.registryNumber)) keys.push(`registry:${project.region}:${normalizeIdentity(project.registryNumber)}`);
  if (validValue(project.permitNo)) keys.push(`permit:${project.region}:${normalizeIdentity(project.permitNo)}`);
  keys.push(`fallback:${project.region}:${normalizeName(project.name)}:${normalizeIdentity(project.buildingLand)}`);
  return keys;
}

function candidateView(project) {
  return {
    sourceKey: project.sourceKey,
    city: project.city,
    district: project.district,
    name: project.name,
    region: project.region,
    builder: project.builder,
    households: project.households,
    declaredDate: project.declaredDate,
    address: project.address,
    buildingLand: project.buildingLand,
    permitNo: project.permitNo,
    sourceIntegrity: project.sourceIntegrity || null,
  };
}

function buildNewProject(candidate, checkedAt) {
  const { mapX, mapY } = seededPosition(candidate.name, candidate.region);
  const prefix = regions.find((region) => region.label === candidate.region).id;
  return {
    id: `${prefix}-${stableHash(candidate.sourceKey, 10)}`,
    ...candidate,
    price: null,
    priceEvidence: {
      status: "source-no-match",
      statusLabel: "官方來源尚未配對",
      matchMethod: "新建案已加入，等待成交資料配對",
      addressCorroborated: null,
      addressTokens: [],
      lastCheckedAt: checkedAt,
      sourceUrl: "https://plvr.land.moi.gov.tw/DownloadOpenData",
    },
    qualityStatus: "尚未查核",
    amenityStatus: "待定位",
    dataCompleteness: candidate.firstRegistrationDate ? 80 : 70,
    mapX,
    mapY,
  };
}

async function downloadSources() {
  await mkdir(sourceDirectory, { recursive: true });
  for (const spec of sourceSpecs.filter((item, index) => sourceSpecs.findIndex((other) => other.file === item.file) === index)) {
    const url = `${officialBase}/Download?PayType=saleremark&fileName=${spec.file}`;
    await writeFile(path.join(sourceDirectory, spec.file), await fetchBytes(url));
  }
}

async function readCandidates() {
  const candidates = [];
  for (const spec of sourceSpecs) {
    const directory = process.argv.includes("--snapshot") ? path.join(root, "data/source/lvr_buildcasecsv") : sourceDirectory;
    const text = await readFile(path.join(directory, spec.file), "utf8");
    if (!["建案名稱", "鄉鎮市區", "編號", "主要用途"].every((field) => text.split("\n")[0].includes(field))) throw new Error(`${spec.file} 欄位不符，拒絕匯入`);
    sourceManifest.push({ region: spec.region, city: spec.city, file: spec.file, sha256: stableHash(text, 64), publishedAt: null, sourceUrl: `${officialBase}/Download?PayType=saleremark&fileName=${spec.file}` });
    candidates.push(...parseBuildcaseCsv(text).filter((row) => eligible(row, spec)).map((row) => officialProject(row, spec)));
  }
  return candidates;
}

async function main() {
  const shouldDownload = process.argv.includes("--download");
  if (shouldDownload) await downloadSources();

  const checkedAt = todayTaipei();
  const dataset = JSON.parse(await readFile(projectsPath, "utf8"));
  const catalogueBefore = dataset.projects.length;
  const existingIndex = new Map();
  for (const project of dataset.projects) {
    project.sourceKey ||= sourceKeyFor(project);
    for (const key of matchKeys(project)) {
      if (!existingIndex.has(key)) existingIndex.set(key, []);
      existingIndex.get(key).push(project);
    }
  }

  const matchedIds = new Set();
  const added = [];
  const updated = [];
  const ambiguous = [];
  const backlog = [];
  const candidates = (await readCandidates()).sort((a, b) => (b.declaredDate || "").localeCompare(a.declaredDate || "") || a.sourceKey.localeCompare(b.sourceKey));
  const duplicates = new Set(candidates.filter((candidate, index) => candidates.findIndex((other) => other.sourceKey === candidate.sourceKey) !== index).map((candidate) => candidate.sourceKey));
  const acceptIds = new Set(process.argv.filter((arg) => arg.startsWith("--accept=")).map((arg) => arg.slice(9)));
  for (const key of acceptIds) if (!candidates.some((candidate) => candidate.sourceKey === key)) throw new Error(`找不到指定候選：${key}`);

  for (const candidate of candidates) {
    if (duplicates.has(candidate.sourceKey)) { ambiguous.push({ ...candidateView(candidate), reason: "來源身分重複，需人工核對" }); continue; }
    let matches = [...new Set(matchKeys(candidate).flatMap((key) => existingIndex.get(key) || []))];
    if (!matches.length && candidate.sourceIntegrity?.status === "repaired-unquoted-commas") {
      const repairedMatches = dataset.projects.filter((project) => project.region === candidate.region
        && project.district === candidate.district
        && normalizeName(project.name) === normalizeName(candidate.name)
        && normalizeIdentity(project.builder) === normalizeIdentity(candidate.builder)
        && project.households === candidate.households);
      if (repairedMatches.length === 1) matches = repairedMatches;
    }
    if (matches.length > 1) {
      ambiguous.push({ ...candidateView(candidate), matchedIds: matches.map((project) => project.id) });
      continue;
    }
    if (matches.length === 1) {
      const existing = matches[0];
      matchedIds.add(existing.id);
      if (!candidate.sourceIntegrity && ((validValue(existing.registryNumber) && validValue(candidate.registryNumber) && normalizeIdentity(existing.registryNumber) !== normalizeIdentity(candidate.registryNumber)) || (validValue(existing.permitNo) && validValue(candidate.permitNo) && normalizeIdentity(existing.permitNo) !== normalizeIdentity(candidate.permitNo)) || normalizeName(existing.name) !== normalizeName(candidate.name) || normalizeIdentity(existing.buildingLand) !== normalizeIdentity(candidate.buildingLand))) {
        ambiguous.push({ ...candidateView(candidate), matchedIds: [existing.id], reason: "備查編號、建照、名稱或基地變更，需人工核對" }); continue;
      }
      const changes = {};
      for (const field of officialFields) {
        if (JSON.stringify(existing[field] ?? null) !== JSON.stringify(candidate[field] ?? null)) {
          changes[field] = { before: existing[field] ?? null, after: candidate[field] ?? null };
          existing[field] = candidate[field];
        }
      }
      existing.sourceKey = candidate.sourceKey;
      if (Object.keys(changes).length) updated.push({ id: existing.id, name: candidate.name, region: candidate.region, changes });
      continue;
    }

    if (!validValue(candidate.registryNumber) && !validValue(candidate.permitNo) && !validValue(candidate.buildingLand)) {
      ambiguous.push({ ...candidateView(candidate), reason: "缺少備查編號、建照及基地，無法安全辨識" });
      continue;
    }
    {
      const project = buildNewProject(candidate, checkedAt);
      dataset.projects.push(project);
      for (const key of matchKeys(project)) {
        if (!existingIndex.has(key)) existingIndex.set(key, []);
        existingIndex.get(key).push(project);
      }
      added.push(candidateView(project));
      matchedIds.add(project.id);
    }
  }

  const missing = dataset.projects
    .filter((project) => !added.some((item) => item.sourceKey === project.sourceKey) && !matchedIds.has(project.id))
    .map((project) => ({ id: project.id, name: project.name, region: project.region, sourceKey: project.sourceKey }));

  dataset.generatedAt = checkedAt;
  dataset.scope = "桃園、新竹縣市、雙北官方住宅建案快照全量匯入（不涵蓋所有既有社區）";
  dataset.projectCount = dataset.projects.length;
  dataset.maintenance = {
    lastProjectScanAt: checkedAt,
    officialEligibleCount: candidates.length,
    catalogueCount: dataset.projects.length,
    autoAddedCount: added.length,
    updatedExistingCount: updated.length,
    historicalBacklogCount: backlog.length,
    attentionCount: ambiguous.length + missing.length,
    policy: "完整匯入可安全辨識的住宅建案，不設數量、戶數或申報日期門檻；既有案不自動刪除，歧義資料不覆蓋。",
  };
  await writeFile(projectsPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  const report = {
    generatedAt: checkedAt,
    status: ambiguous.length || missing.length ? "attention" : "ok",
    summary: {
      officialEligibleCount: candidates.length,
      catalogueBefore,
      catalogueAfter: dataset.projects.length,
      autoAddedCount: added.length,
      updatedExistingCount: updated.length,
      ambiguousCount: ambiguous.length,
      missingFromCurrentSourceCount: missing.length,
      historicalBacklogCount: backlog.length,
    },
    safeguards: [
      "舊案、同日補登、小型住宅建案均納入；僅身分歧義或缺乏識別資料時待核對",
      "既有建案不會因本期來源暫時缺少而刪除",
      "多重匹配或身分歧義不會自動覆蓋",
      "人工確認的定位與品質事件由後續流程保留",
    ],
    changes: { added, updated, ambiguous, missing },
    historicalBacklog: backlog.sort((a, b) => (b.declaredDate || "").localeCompare(a.declaredDate || "")),
    sourceManifest,
    sources: sourceSpecs.map((spec) => ({
      region: spec.region,
      mode: process.argv.includes("--snapshot") ? "local-snapshot" : "downloaded-cache",
      importedAt: checkedAt,
      name: "內政部預售屋建案備查資料",
      url: `${officialBase}/DownloadOpenData`,
      file: spec.file,
    })),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`官方候選 ${candidates.length} 案；目錄 ${catalogueBefore} → ${dataset.projects.length} 案`);
  console.log(`自動新增 ${added.length}、既有更新 ${updated.length}、歧義 ${ambiguous.length}、來源暫缺 ${missing.length}`);
  console.log(`歷史候選庫 ${backlog.length} 案（不再因日期或數量限制排除）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
