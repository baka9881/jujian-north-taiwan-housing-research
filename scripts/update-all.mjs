import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = process.argv.includes("--snapshot");
const sourceFlag = snapshot ? "--snapshot" : "--download";
const acceptArgs = process.argv.filter((arg) => arg.startsWith("--accept="));
const scripts = [
  ["scan-project-updates.mjs", sourceFlag, ...acceptArgs],
  ...(!snapshot ? [["refresh-project-prices.mjs", "--download"]] : process.argv.includes("--legacy-cache") ? [["refresh-project-prices.mjs"]] : []),
  ["refresh-regional-prices.mjs", sourceFlag],
  ["sync-regional-amenities.mjs"],
  ...(process.argv.includes("--amenities") ? [["enrich-amenities.mjs"], ["enrich-route-times.mjs"]] : []),
  ["build-quality-evidence.mjs"],
  ["build-regional-supply.mjs"],
];
// Preserve the last coherent release if a source, generator or validation fails.
const backupNames = ["projects.json", "amenities.json", "quality-evidence.json", "regional-supply.json", "update-report.json"];
const backups = new Map(await Promise.all(backupNames.map(async (name) => [name, await readFile(path.join(root, "data/processed", name))])));

for (const [script, ...arguments_] of scripts) {
  console.log(`\n▶ ${script}`);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...arguments_], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    for (const [name, content] of backups) await writeFile(path.join(root, "data/processed", name), content);
    console.error("更新失敗：已還原所有 processed 資料至更新前版本，下載快取保留供排查。");
    process.exit(result.status ?? 1);
  }
}

const processed = path.join(root, "data", "processed");
const reportPath = path.join(processed, "update-report.json");
const [report, projects, amenities, quality, regionalSupply] = await Promise.all([
  readFile(reportPath, "utf8").then(JSON.parse),
  readFile(path.join(processed, "projects.json"), "utf8").then(JSON.parse),
  readFile(path.join(processed, "amenities.json"), "utf8").then(JSON.parse),
  readFile(path.join(processed, "quality-evidence.json"), "utf8").then(JSON.parse),
  readFile(path.join(processed, "regional-supply.json"), "utf8").then(JSON.parse),
]);
report.pipeline = {
  status: "complete",
  sourceMode: snapshot ? "local-snapshot" : "download",
  amenityMode: process.argv.includes("--amenities") ? "official-intersections-and-enabled-region-routes-refreshed" : "preserved-reviewed-data-new-projects-pending",
  pricedProjects: projects.priceCoverage.pricedProjects,
  totalProjects: projects.projects.length,
  individualLocationProjects: Object.values(amenities.projects).filter((project) => !["region-center", "catalogue-fallback"].includes(project.location.method)).length,
  verifiedLocationProjects: Object.values(amenities.projects).filter((project) => ["high", "medium"].includes(project.location.confidence)).length,
  approximateLocationProjects: Object.values(amenities.projects).filter((project) => project.location.confidence === "low").length,
  districtOnlyLocationProjects: Object.values(amenities.projects).filter((project) => project.location.confidence === "estimated").length,
  amenityScoredProjects: Object.values(amenities.projects).filter((project) => project.score !== null).length,
  locationUpdatedAt: amenities.generatedAt,
  qualityQueuedCount: quality.summary.queuedCount,
  qualityReviewedCount: quality.summary.reviewedCount,
  regionalSupplyPeriod: regionalSupply.latestPeriod,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log("\n▶ validate-data.mjs");
const validation = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (validation.status !== 0) {
  for (const [name, content] of backups) await writeFile(path.join(root, "data/processed", name), content);
  console.error("更新失敗：已還原所有 processed 資料至更新前版本，下載快取保留供排查。");
  process.exit(validation.status ?? 1);
}
console.log("\n安全更新完成；請查看 data/processed/update-report.json 的變更報告。");
