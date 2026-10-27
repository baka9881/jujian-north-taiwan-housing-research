import { readFile, writeFile } from "node:fs/promises";
import { regionFor } from "./regions.mjs";
const directory = new URL("../data/processed/", import.meta.url);
const dataset = JSON.parse(await readFile(new URL("projects.json", directory), "utf8"));
const amenities = JSON.parse(await readFile(new URL("amenities.json", directory), "utf8"));
const categories = Object.keys(amenities.categories);
const values = (value) => Object.fromEntries(categories.map((category) => [category, value]));
for (const project of dataset.projects) {
  if (amenities.projects[project.id]) continue;
  const region = regionFor(project);
  if (!region) throw new Error(`未設定分區：${project.region}`);
  amenities.projects[project.id] = {
    location: { latitude: region.center[0], longitude: region.center[1], confidence: "estimated", method: "region-center", label: "分區示意中心，非建案位置", queryAddress: `${project.city}${project.district}${project.address}` },
    score: null, rawScore: 0, distanceScore: null, grade: null, scoreReliability: "unavailable",
    nearest: values(null), categoryScores: values(0), routeScores: values(0), densityScores: values(0), nearbyCounts: values(0), scoreFormulaVersion: 2,
  };
}
amenities.routeCoverage.totalProjects = dataset.projects.length;
amenities.routeCoverage.unavailableLocationProjects = Object.values(amenities.projects).filter((project) => project.score === null).length;
await writeFile(new URL("amenities.json", directory), `${JSON.stringify(amenities, null, 2)}\n`);
console.log("機能資料同步完成；未完成定位及區域圖資查核者保持待補，既有評估保留原更新日期。");
