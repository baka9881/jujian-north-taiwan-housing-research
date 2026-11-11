import { regions as regionSettings } from "./regions.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.join(root, "data", "manual", "regional-supply-source.json");
const outputPath = path.join(root, "data", "processed", "regional-supply.json");
const input = JSON.parse(await readFile(inputPath, "utf8"));

function periodLabel(period) {
  const match = /^(\d{3})Q([1-4])$/.exec(period);
  if (!match) throw new Error(`無法辨識待售新成屋期別：${period}`);
  return `${match[1]} 年第 ${match[2]} 季`;
}

function change(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  const units = current - previous;
  const percent = Math.round((units / previous) * 1000) / 10;
  return {
    units,
    percent,
    direction: Math.abs(percent) < 0.5 ? "stable" : units > 0 ? "up" : "down",
  };
}

function normalizeRecord(record, period = input.latestPeriod) {
  if (!Number.isInteger(record.units) || record.units < 0) throw new Error("待售新成屋戶數必須是非負整數");
  return {
    ...record,
    period,
    periodLabel: periodLabel(period),
    quarterlyChange: change(record.units, record.previousQuarterUnits),
    annualChange: change(record.units, record.yearAgoUnits),
  };
}

const counties = Object.fromEntries(input.counties.map((record) => [record.county, normalizeRecord(record)]));
const districts = Object.fromEntries(input.districts.map((record) => [
  `${record.county}${record.district}`,
  normalizeRecord(record, record.period),
]));

const mappings = Object.fromEntries(regionSettings.map((region) => [region.label, { county: region.city, district: region.districts.length === 1 ? region.districts[0] : "", ...input.regionMapping[region.label] }]));
const regions = Object.fromEntries(Object.entries(mappings).map(([region, mapping]) => {
  const districtKey = `${mapping.county}${mapping.district}`;
  const currentDistrict = districts[districtKey];
  const sourceRecord = currentDistrict?.period === input.latestPeriod ? currentDistrict : counties[mapping.county];
  if (!sourceRecord) return [region, { region, requestedGeography: districtKey, geography: mapping.county, sourceLevel: "unavailable", scopeLabel: "資料待補", units: null, period: null, periodLabel: "尚未匯入同層級資料", quarterlyChange: null, annualChange: null, fallbackReason: "尚無可核對的區域供給資料", note: null }];
  const sourceLevel = currentDistrict?.period === input.latestPeriod ? "district" : "county";
  return [region, {
    region,
    requestedGeography: districtKey,
    geography: sourceLevel === "district" ? districtKey : mapping.county,
    sourceLevel,
    scopeLabel: sourceLevel === "district" ? "行政區資料" : "縣市參考",
    fallbackReason: sourceLevel === "county"
      ? mapping.district ? `最新官方摘要未公布${mapping.district}確切戶數，因此顯示${mapping.county}層級。` : `顯示${mapping.county}全縣市資料，並非此分區或特定建案的剩餘戶數。`
      : null,
    units: sourceRecord.units,
    period: sourceRecord.period,
    periodLabel: sourceRecord.periodLabel,
    quarterlyChange: sourceRecord.quarterlyChange,
    annualChange: sourceRecord.annualChange,
    note: sourceRecord.note ?? null,
  }];
}));

const output = {
  generatedAt: new Date().toISOString(),
  latestPeriod: input.latestPeriod,
  latestPeriodLabel: periodLabel(input.latestPeriod),
  publishedAt: input.publishedAt,
  definition: input.definition,
  methodology: {
    displayRule: "優先顯示同一期行政區資料；未公布確切行政區戶數時，退回縣市層級並標明範圍。",
    interpretation: "只用來觀察區域新屋供給與增減，不推論單一建案銷售率、剩餘戶數或品質。",
    updateGuide: "更新 data/manual/regional-supply-source.json 後執行 npm run data:supply。",
  },
  national: normalizeRecord(input.national),
  counties,
  districts,
  regions,
  sources: input.sources,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`已產生 ${path.relative(root, outputPath)}：${Object.keys(regions).length} 個網站區域，期別 ${output.latestPeriodLabel}`);
