import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolveRegion, regionConfig, validateRegions } from "../scripts/regions.mjs";
import { matchesGeography, toggleComparison, comparableProjects, paginateProjects, regionAfterMapNavigation } from "../app/catalogue.ts";

test("exclusive subregion routing leaves non-A7 Guishan in Taoyuan", () => {
  assert.equal(resolveRegion("桃園市", "龜山區", "文青路")?.id, "a7");
  assert.equal(resolveRegion("桃園市", "龜山區", "萬壽路")?.id, "taoyuan");
  assert.equal(resolveRegion("新北市", "林口區")?.id, "linkou");
  assert.equal(resolveRegion("新北市", "板橋區")?.id, "new-taipei");
  assert.equal(resolveRegion("新竹市", "東區")?.id, "hsinchu-city");
  assert.equal(resolveRegion("新竹縣", "竹北市")?.id, "hsinchu-county");
  assert.equal(resolveRegion("臺北市", "中山區")?.id, "taipei");
  assert.equal(resolveRegion("臺中市", "東區"), undefined);
  assert.throws(() => validateRegions({ ...regionConfig, regions: [regionConfig.regions[0], regionConfig.regions[0]] }));
});

test("every imported district has a maintained fallback map center", async () => {
  const dataset = JSON.parse(await readFile(new URL("../data/processed/projects.json", import.meta.url), "utf8"));
  const districtKeys = new Set(dataset.projects.map((project) => `${project.city}::${project.district}`));
  for (const key of districtKeys) {
    const center = regionConfig.districtMap.centers[key];
    assert.ok(center, `missing district map center for ${key}`);
    assert.equal(center.length, 2);
  }
  assert.match(regionConfig.districtMap.source.url, /^https:\/\/data\.gov\.tw\//);
  assert.match(regionConfig.districtMap.note, /不代表建案基地位置/);
});

test("geographic filters, empty results and comparison survive switching regions", () => {
  const hsinchu = { id: "one", city: "新竹市", region: "新竹市", district: "東區", price: { median: 50 } };
  const taipei = { id: "two", city: "臺北市", region: "臺北市", district: "中山區", price: { median: 90 } };
  assert.ok(matchesGeography(hsinchu, { city: "新竹市", region: "全部", district: "東區" }));
  assert.ok(!matchesGeography(taipei, { city: "新竹市", region: "全部", district: "東區" }));
  assert.deepEqual([hsinchu, taipei].filter((p) => matchesGeography(p, { city: "桃園市", region: "全部", district: "全部" })), []);
  let ids = toggleComparison([], hsinchu.id);
  ids = toggleComparison(ids, taipei.id);
  assert.deepEqual(ids, ["one", "two"]);
  assert.deepEqual(toggleComparison(["one", "two", "three"], "four"), ["one", "two", "three"]);
  assert.deepEqual(toggleComparison(ids, "one"), ["two"]);
  assert.deepEqual(comparableProjects([hsinchu, taipei], hsinchu), [hsinchu]);
});

test("drilling into a district retains its subregion while navigating back clears it", async () => {
  const dataset = JSON.parse(await readFile(new URL("../data/processed/projects.json", import.meta.url), "utf8"));
  const region = regionAfterMapNavigation("桃園其他", "桃園市", "龜山區", regionConfig.regions);
  const results = dataset.projects.filter((p) => matchesGeography(p, { city: "桃園市", district: "龜山區", region }));
  assert.ok(results.length > 0);
  assert.ok(results.every((p) => p.region === "桃園其他"));
  assert.ok(dataset.projects.some((p) => p.district === "龜山區" && p.region === "A7"));
  assert.equal(regionAfterMapNavigation("桃園其他", "全部", "全部", regionConfig.regions), "全部");
  assert.equal(regionAfterMapNavigation("桃園其他", "新北市", "林口區", regionConfig.regions), "全部");
});

test("offline pipeline is repeatable, preserves evidence and rolls back invalid sources", async () => {
  const root = new URL("../", import.meta.url);
  const work = new URL("work/", root);
  await mkdir(work, { recursive: true });
  const fixture = await mkdtemp(new URL("regional-test-", work));
  await cp(new URL("scripts/", root), `${fixture}/scripts`, { recursive: true });
  await cp(new URL("data/processed/", root), `${fixture}/data/processed`, { recursive: true });
  await cp(new URL("data/manual/", root), `${fixture}/data/manual`, { recursive: true });
  await cp(new URL("data/regions.json", root), `${fixture}/data/regions.json`);
  // Self-contained official-schema fixtures: no network or ignored source cache required.
  const before = JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8"));
  const header = ["建案名稱", "鄉鎮市區", "編號", "主要用途", "層棟戶數", "坐落街道", "坐落基地", "建造執照", "起造人", "申報備查日期"];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  await mkdir(`${fixture}/data/source/lvr_buildcasecsv`, { recursive: true });
  await mkdir(`${fixture}/data/source/lvr_landcsv`, { recursive: true });
  for (const region of regionConfig.regions) {
    const rows = before.projects.filter((p) => p.city === region.city).map((p) => [p.name, p.district, p.registryNumber, "住宅", String(p.households), p.address, p.buildingLand, p.permitNo, p.builder, "1150101"]);
    const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
    await writeFile(`${fixture}/data/source/lvr_buildcasecsv/${region.file}`, csv);
    await writeFile(`${fixture}/data/source/lvr_landcsv/${region.file.replace("buildcase", "land_b")}`, "建案名稱,鄉鎮市區,單價元平方公尺,編號,解約情形,交易年月日\n");
  }
  const run = () => spawnSync(process.execPath, ["scripts/update-all.mjs", "--snapshot"], { cwd: fixture, encoding: "utf8" });
  let result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const once = JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8"));
  result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const twice = JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8"));
  assert.deepEqual(twice.projects, once.projects);
  assert.deepEqual(twice.projects.map((p) => p.id), before.projects.map((p) => p.id));
  const extraFile = `${fixture}/data/source/lvr_buildcasecsv/o_lvr_buildcase.csv`;
  const extraRows = Array.from({ length: 15 }, (_, index) => [
    `完整匯入回歸測試${index}`, "東區", `regression-${index}`, "住宅", index === 0 ? "" : "1", "測試路", `測試段${index}地號`, `regression-permit-${index}`, "測試起造人", index === 0 ? "" : "1000101",
  ]);
  await writeFile(extraFile, (await readFile(extraFile, "utf8")) + "\n" + extraRows.map((row) => row.map(cell).join(",")).join("\n"));
  result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const expanded = JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8"));
  assert.equal(expanded.projects.length, before.projects.length + 15, "超過舊首批上限的小型、舊日期及缺日期建案皆應納入");
  assert.equal(expanded.projects.filter((p) => p.name.startsWith("完整匯入回歸測試")).length, 15);
  result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8")).projects.length, expanded.projects.length);
  const oldQuality = JSON.parse(await readFile(new URL("data/processed/quality-evidence.json", root), "utf8"));
  const newQuality = JSON.parse(await readFile(`${fixture}/data/processed/quality-evidence.json`, "utf8"));
  for (const id of Object.keys(oldQuality.projects)) assert.deepEqual(newQuality.projects[id].events, oldQuality.projects[id].events);
  const sample = before.projects.find((p) => p.region === "新竹縣");
  const buildFile = `${fixture}/data/source/lvr_buildcasecsv/j_lvr_buildcase.csv`;
  const originalCsv = await readFile(buildFile, "utf8");
  const conflict = [sample.name, sample.district, sample.registryNumber, "住宅", String(sample.households), sample.address, sample.buildingLand, "conflicting-permit", sample.builder, "1150101"];
  await writeFile(buildFile, originalCsv + "\n" + conflict.map(cell).join(","));
  result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const conflictReport = JSON.parse(await readFile(`${fixture}/data/processed/update-report.json`, "utf8"));
  assert.ok(conflictReport.changes.ambiguous.some((item) => item.name === sample.name));
  const conflictProjects = JSON.parse(await readFile(`${fixture}/data/processed/projects.json`, "utf8"));
  assert.equal(conflictProjects.projects.find((p) => p.id === sample.id).permitNo, sample.permitNo);
  await writeFile(buildFile, originalCsv);
  const files = ["projects.json", "amenities.json", "quality-evidence.json", "regional-supply.json", "update-report.json"];
  const stable = await Promise.all(files.map((name) => readFile(`${fixture}/data/processed/${name}`, "utf8")));
  await writeFile(`${fixture}/data/source/lvr_landcsv/j_lvr_land_b.csv`, "invalid response");
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /已還原/);
  assert.deepEqual(await Promise.all(files.map((name) => readFile(`${fixture}/data/processed/${name}`, "utf8"))), stable);
  // Fixtures intentionally retained under ignored work/: user prohibits bulk deletion.
});

test("pagination reaches every result without changing comparison selections", () => {
  const projects = Array.from({ length: 123 }, (_, id) => ({ id }));
  const pages = [1, 2, 3].flatMap((page) => paginateProjects(projects, page).items);
  assert.deepEqual(pages, projects);
  assert.equal(paginateProjects(projects, 999).page, 3);
  assert.equal(paginateProjects([], 5).items.length, 0);
  assert.equal(paginateProjects(projects, -1).page, 1);
  assert.equal(paginateProjects(projects.slice(0, 2), 3).page, 1);
});
