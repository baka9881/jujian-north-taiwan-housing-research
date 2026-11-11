import { latestTransactions } from "./transaction-records.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { regions } from "./regions.mjs";
import { fetchBytes, parseCsv, normalizeName, rocToIso, todayTaipei } from "./data-utils.mjs";
const root = new URL("../", import.meta.url);
const output = new URL("data/processed/projects.json", root);
const dataset = JSON.parse(await readFile(output, "utf8"));
const directory = new URL(process.argv.includes("--snapshot") ? "data/source/lvr_landcsv/" : "data/source/current-transactions/", root);
await mkdir(directory, { recursive: true });
const sources = new Map();
const officialIdentities = new Map();
for (const region of regions) {
  if (sources.has(region.city)) continue;
  const buildDirectory = process.argv.includes("--snapshot") ? "data/source/lvr_buildcasecsv/" : "data/source/current-buildcases/";
  const builds = parseCsv(await readFile(new URL(buildDirectory + region.file, root), "utf8"));
  for (const row of builds) {
    const key = `${region.city}:${row.鄉鎮市區}:${normalizeName(row.建案名稱)}`;
    if (!officialIdentities.has(key)) officialIdentities.set(key, new Set());
    officialIdentities.get(key).add(row.編號 || row.建造執照 || row.坐落基地);
  }
  const file = region.file.replace("buildcase", "land_b");
  const url = `https://plvr.land.moi.gov.tw/Download?fileName=${file}`;
  if (process.argv.includes("--download")) await writeFile(new URL(file, directory), await fetchBytes(url));
  const text = await readFile(new URL(file, directory), "utf8");
  if (!["建案名稱", "鄉鎮市區", "單價元平方公尺"].every((field) => text.split("\n")[0].includes(field))) throw new Error(`${file} 成交欄位無效`);
  // Deduplicate before cancellation filtering, so the final cancelled record wins.
  sources.set(region.city, { file, url, rows: latestTransactions(parseCsv(text)) });
}
for (const project of dataset.projects) {
  if (["林口", "A7"].includes(project.region)) continue;
  const source = sources.get(project.city);
  const sameIdentity = (item) => item.city === project.city && item.district === project.district && normalizeName(item.name) === normalizeName(project.name);
  const ambiguous = dataset.projects.filter(sameIdentity).length > 1 || (officialIdentities.get(`${project.city}:${project.district}:${normalizeName(project.name)}`)?.size || 0) > 1;
  const rows = ambiguous ? [] : source.rows.filter((row) => row.鄉鎮市區 === project.district && normalizeName(row.建案名稱) === normalizeName(project.name));
  const prices = rows.map((row) => Number(row.單價元平方公尺) * 3.305785 / 10000).sort((a, b) => a - b);
  const round = (value) => Math.round(value * 10) / 10;
  project.price = prices.length ? {
    median: round((prices[Math.floor((prices.length - 1) / 2)] + prices[Math.floor(prices.length / 2)]) / 2), low: round(prices[0]), high: round(prices.at(-1)), count: prices.length,
    earliestDate: rows.map((row) => rocToIso(row.交易年月日)).filter(Boolean).sort()[0] || null,
    latestDate: rows.map((row) => rocToIso(row.交易年月日)).filter(Boolean).sort().at(-1) || null,
    source: "內政部預售屋實價登錄（本期快照，非完整歷史）",
  } : null;
  project.priceEvidence = {
    status: prices.length ? "matched" : "source-no-match", statusLabel: prices.length ? "本期官方成交已配對" : ambiguous ? "同名建案待人工歸戶" : "本期快照未配對（非無成交）",
    matchMethod: "同縣市＋行政區＋正規化建案名稱唯一配對；僅本期樣本", addressCorroborated: null, addressTokens: [], lastCheckedAt: todayTaipei(), sourceUrl: source.url,
  };
}
dataset.priceCoverage.totalProjects = dataset.projects.length;
dataset.priceCoverage.pricedProjects = dataset.projects.filter((project) => project.price).length;
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`分區價格完成：${dataset.priceCoverage.pricedProjects}/${dataset.projects.length} 案有成交樣本`);
