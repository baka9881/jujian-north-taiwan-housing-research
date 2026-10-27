const roadTokenPattern = /[\p{Script=Han}0-9]+?(?:大道(?:[一二三四五六七八九十0-9]+段)?|路(?:[一二三四五六七八九十0-9]+段)?|街)(?:[0-9]+(?:之[0-9]+)?巷)?(?:[0-9]+弄)?/gu;

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function sectionNumberText(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) return value;
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number < 10) return digits[number];
  if (number === 10) return "十";
  if (number < 20) return `十${digits[number - 10]}`;
  return "二十";
}

export function normalizeRoadName(value = "") {
  return value
    .normalize("NFKC")
    .replaceAll("台", "臺")
    .replace(/([路道])([0-9]{1,2})段/gu, (_match, road, section) => `${road}${sectionNumberText(section)}段`)
    .replace(/[\s，,、。．·・()（）]/gu, "")
    .replace(/(?:交岔路口|交叉路口|交叉口|交界處)$/gu, "")
    .replace(/路口$/u, "路")
    .replace(/街口$/u, "街")
    .replace(/(?:附近|旁|對面|工地)$/gu, "")
    .trim();
}

function roadTokens(value) {
  return [...value.matchAll(roadTokenPattern)]
    .map((match) => normalizeRoadName(match[0]))
    .filter(Boolean);
}

export function extractIntersectionRoads(address = "") {
  const hasExplicitIntersection = /交叉|交岔|交界|(?:路|街|巷|道)口/u.test(address);
  const hasTwoRoadJoin = /(?:與|及|跟|和|、|，|,|\+|；|;|\.|。)/u.test(address) && !/\d+(?:之\d+)?號/u.test(address);
  if (!hasExplicitIntersection && !hasTwoRoadJoin) return null;
  const normalized = address
    .normalize("NFKC")
    .replace(/交岔路口|交叉路口|交叉口|交界處/gu, "")
    .replace(/(?:路口|街口)(?=附近|旁|對面|工地|$)/gu, (value) => value[0])
    .replace(/(?:附近|旁|對面工地|對面|工地)$/gu, "")
    .trim();
  let chunks = normalized.split(/(?:與|及|跟|、|，|,|\+|；|;|\.|。|間|近)/u).map((part) => part.trim()).filter(Boolean);
  if (chunks.length === 1 && normalized.includes("和")) {
    const andChunks = normalized.split("和").map((part) => part.trim()).filter(Boolean);
    if (andChunks.length === 2 && andChunks.every((part) => roadTokens(part).length === 1)) chunks = andChunks;
  }
  const candidates = chunks.length > 1 ? chunks.flatMap(roadTokens) : roadTokens(normalized);
  const unique = [...new Set(candidates)];
  return unique.length === 2 ? unique : null;
}

export function parseCountyItems(xml) {
  return Object.fromEntries([...xml.matchAll(/<countyItem>[\s\S]*?<countycode>([^<]+)<\/countycode>[\s\S]*?<countyname>([^<]+)<\/countyname>[\s\S]*?<\/countyItem>/gu)]
    .map((match) => [decodeXml(match[2]).trim(), decodeXml(match[1]).trim()]));
}

export function parseTownItems(xml) {
  return Object.fromEntries([...xml.matchAll(/<townItem>[\s\S]*?<towncode>([^<]+)<\/towncode>[\s\S]*?<townname>([^<]+)<\/townname>[\s\S]*?<\/townItem>/gu)]
    .map((match) => [decodeXml(match[2]).trim(), decodeXml(match[1]).trim()]));
}

export function parseCrossRoads(xml) {
  return [...xml.matchAll(/<crossRoad>\s*<name>([^<]+)<\/name>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<\/crossRoad>/gu)]
    .map((match) => ({
      name: decodeXml(match[1]).trim(),
      longitude: Number(match[2]),
      latitude: Number(match[3]),
    }))
    .filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
}

export function findCrossRoad(crossRoads, targetRoad) {
  const target = normalizeRoadName(targetRoad);
  if (!target) return null;
  return crossRoads.find((item) => normalizeRoadName(item.name) === target) || null;
}
