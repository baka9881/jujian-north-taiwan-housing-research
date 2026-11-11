import { readFileSync } from "node:fs";
export const regionConfig = JSON.parse(readFileSync(new URL("../data/regions.json", import.meta.url), "utf8"));
export const regions = regionConfig.regions;
export function validateRegions(config = regionConfig) {
  const ids = new Set();
  const labels = new Set();
  for (const region of config.regions) {
    if (!/^[a-z0-9-]+$/.test(region.id) || ids.has(region.id) || !region.label || labels.has(region.label)) throw new Error("分區 ID 或名稱無效／重複");
    if (!/^[a-z]_lvr_buildcase\.csv$/.test(region.file) || !region.city || !Array.isArray(region.districts)) throw new Error("分區來源設定無效");
    if (region.center.length !== 2 || !region.center.every(Number.isFinite)) throw new Error("分區中心無效");
    if (region.addressPattern) new RegExp(region.addressPattern, "u");
    ids.add(region.id); labels.add(region.label);
  }
  if (!config.districtMap?.source?.url || !config.districtMap?.note || !config.districtMap?.centers || typeof config.districtMap.centers !== "object") throw new Error("行政區地圖設定無效");
  for (const [key, center] of Object.entries(config.districtMap.centers)) {
    if (!key.includes("::") || !Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)) throw new Error(`行政區中心無效：${key}`);
    const [latitude, longitude] = center;
    if (latitude < 21 || latitude > 27 || longitude < 119 || longitude > 123) throw new Error(`行政區中心超出台灣範圍：${key}`);
  }
  if (config.importPolicy !== "all-identifiable-residential") throw new Error("必須完整匯入可辨識住宅建案");
}
validateRegions();
// Specific subregions precede city-wide fallbacks; a source row belongs to exactly one region.
export function resolveRegion(city, district, address = "", land = "") {
  return regions.find((region) => region.city === city &&
    (!region.districts.length || region.districts.includes(district)) &&
    (!region.addressPattern || new RegExp(region.addressPattern, "u").test(`${land} ${address}`)));
}
export function regionFor(project) { return regions.find((region) => region.label === project.region); }
