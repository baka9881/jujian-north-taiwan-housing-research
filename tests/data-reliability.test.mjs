import assert from "node:assert/strict";
import test from "node:test";
import { latestTransactions } from "../scripts/transaction-records.mjs";
import { parseBuildcaseCsv } from "../scripts/buildcase-csv.mjs";
import { rocToIso, parseCsv } from "../scripts/data-utils.mjs";
import { geocodingProvider } from "../scripts/geocoding-provider.mjs";
import {
  extractIntersectionRoads,
  findCrossRoad,
  parseCountyItems,
  parseCrossRoads,
  parseTownItems,
} from "../scripts/nlsc-intersections.mjs";
import {
  shouldRefreshGeocode,
  splitAmenityWork,
  unavailableAmenityProject,
} from "../scripts/enrich-amenities.mjs";

test("a later cancellation removes historical sales instead of resurrecting them", () => {
  const sold = { 編號: "one", 單價元平方公尺: "200000", 解約情形: "" };
  assert.deepEqual(latestTransactions([sold, { ...sold, 解約情形: "全部解約" }]), []);
  assert.deepEqual(latestTransactions([sold, { ...sold, 單價元平方公尺: "180000" }]), [{ ...sold, 單價元平方公尺: "180000" }]);
  assert.equal(latestTransactions([sold, sold]).length, 1);
  assert.equal(latestTransactions([{ ...sold, 編號: "", 單價元平方公尺: "Infinity" }]).length, 0);
  const anonymous = { 單價元平方公尺: "150000" };
  assert.equal(latestTransactions([anonymous, anonymous]).length, 1);
  assert.equal(latestTransactions([{ rps27: "one", rps22_amountsunitdollars: "100" }, { rps27: "one", rps30: "解約" }], { serial: "rps27", cancellation: "rps30", price: "rps22_amountsunitdollars" }).length, 0);
});
test("invalid calendar dates and truncated CSV are not silently accepted", () => {
  assert.equal(rocToIso("1130229"), "2024-02-29");
  assert.equal(rocToIso("1140229"), null);
  assert.equal(rocToIso("1151301"), null);
  assert.equal(rocToIso("115/09/01"), "2026-09-01");
  assert.equal(rocToIso(""), null);
  assert.throws(() => parseCsv('name,value\n"truncated,123'), /CSV/);
  assert.equal(parseCsv('name,value\n"quoted, name","line\nvalue"')[0].value, "line\nvalue");
});
test("geocoding defaults to cached data and requires an appropriate provider", () => {
  assert.equal(geocodingProvider({}), null);
  assert.throws(() => geocodingProvider({ JUJIAN_GEOCODER_URL: "https://nominatim.openstreetmap.org/search" }), /公共端點/);
  assert.throws(() => geocodingProvider({ JUJIAN_GEOCODER_URL: "https://example.com/search", JUJIAN_GEOCODER_INTERVAL_MS: "-1" }), /間隔/);
  assert.equal(geocodingProvider({ JUJIAN_GEOCODER_URL: "http://localhost:8080/search" }).intervalMs, 15000);
});

test("unquoted commas in official buildcase text fields are repaired without shifting permit dates", () => {
  const header = "鄉鎮市區,建案名稱,坐落街道,起造人,層棟戶數,使用分區,主要用途,主要建材,申報備查日期,銷售期間,坐落基地,建照核發日期,建造執照,第1次登記日期,編號";
  const row = "大園區,閤林苑,中山北路224號旁,福綱開發建設有限公司,35,住宅區,H2集合住宅;G3店鋪,鋼筋混凝土造,1111101,自售:1111101起,至全案完銷;,內海墘段387-5地號,1110916,桃市都建執照字第會園01182-01號,1130320,";
  const [project] = parseBuildcaseCsv(`${header}\n${row}`);
  assert.equal(project.銷售期間, "自售:1111101起,至全案完銷;");
  assert.equal(project.坐落基地, "內海墘段387-5地號");
  assert.equal(project.建造執照, "桃市都建執照字第會園01182-01號");
  assert.equal(project["第1次登記日期"], "1130320");
  assert.equal(project.__sourceRepair.extraColumnCount, 1);

  const zoningRow = "內湖區,商辦案,新湖一路,某公司,15,科技工業區(C區,不得作住宅使用),攝影棚 一般事務所,鋼骨造,1100709,自售:1100701~1151231;,舊宗段16-3地號,1100326,110建字第0078號,1140612,";
  const [zoningProject] = parseBuildcaseCsv(`${header}\n${zoningRow}`);
  assert.equal(zoningProject.使用分區, "科技工業區(C區,不得作住宅使用)");
  assert.equal(zoningProject.主要用途, "攝影棚 一般事務所");
});

test("official NLSC intersection data can be parsed and matched across regions", () => {
  assert.deepEqual(extractIntersectionRoads("樂學路與長慶三街交叉口附近"), ["樂學路", "長慶三街"]);
  assert.deepEqual(extractIntersectionRoads("龍鳳路、如意街口"), ["龍鳳路", "如意街"]);
  assert.deepEqual(extractIntersectionRoads("復興路樹德街交叉口"), ["復興路", "樹德街"]);
  assert.equal(extractIntersectionRoads("埤腳街交叉口"), null);
  assert.equal(extractIntersectionRoads("經國路415、413、435號"), null);
  assert.equal(extractIntersectionRoads("石園路776巷上，石園路788號對面"), null);

  const counties = parseCountyItems("<countyItems><countyItem><countycode>F</countycode><countyname>新北市</countyname><countycode01>65000</countycode01></countyItem></countyItems>");
  const towns = parseTownItems("<townItems><townItem><towncode>F02</towncode><townname>林口區</townname></townItem></townItems>");
  const roads = parseCrossRoads("<crossRoads><crossRoad><name>吉祥路</name><x>121.37</x><y>25.07</y></crossRoad></crossRoads>");
  assert.equal(counties.新北市, "F");
  assert.equal(towns.林口區, "F02");
  assert.deepEqual(findCrossRoad(roads, "吉祥路口"), roads[0]);
});

test("estimated project locations remain eligible for a later geocoding pass", () => {
  const queryAddress = "新竹縣竹北市光明六路";
  const location = (method) => ({ method, queryAddress });
  const cachedMatch = { lat: "24.83", lon: "121.01" };

  assert.equal(shouldRefreshGeocode(location("region-center"), queryAddress, null, true), true);
  assert.equal(shouldRefreshGeocode(location("catalogue-fallback"), queryAddress, undefined, false), true);
  assert.equal(shouldRefreshGeocode(location("nominatim-road"), queryAddress, undefined, false), false);
  assert.equal(shouldRefreshGeocode(location("region-center"), queryAddress, cachedMatch, true), false);
  assert.equal(shouldRefreshGeocode(location("region-center"), queryAddress, {}, true), true);
  assert.equal(shouldRefreshGeocode(location("nominatim-address"), `${queryAddress}1號`, cachedMatch, true), true);
});

test("amenity coverage gates scores without removing projects from the location queue", () => {
  const enabled = { id: "enabled", region: "林口" };
  const disabled = { id: "disabled", region: "新竹縣" };
  const resolveRegion = (project) => ({ amenityEnabled: project.id === "enabled" });
  const work = splitAmenityWork([enabled, disabled], resolveRegion);

  assert.deepEqual(work.locationProjects, [enabled, disabled]);
  assert.deepEqual(work.scoredProjects, [enabled]);
  assert.throws(() => splitAmenityWork([{ id: "unknown", region: "未設定" }], () => undefined), /未設定分區/);

  const location = { latitude: 24.83, longitude: 121.01, method: "nominatim-road", confidence: "low" };
  const unavailable = unavailableAmenityProject(location);
  assert.equal(unavailable.location, location);
  assert.equal(unavailable.score, null);
  assert.equal(unavailable.scoreReliability, "unavailable");
  assert.ok(Object.values(unavailable.nearest).every((value) => value === null));
  assert.ok(Object.values(unavailable.categoryScores).every((value) => value === 0));
});

import { priceSampleLabel } from "../app/catalogue.ts";
test("price labels show incomplete periods and small samples honestly", () => {
  assert.match(priceSampleLabel(null), /尚無/);
  assert.match(priceSampleLabel({ count: 2, latestDate: "2026-07-01" }), /最早日期待補.*少量樣本/);
  assert.match(priceSampleLabel({ count: 20, earliestDate: "2024-01-01", latestDate: "2026-07-01" }), /2024-01-01 ～ 2026-07-01/);
  assert.doesNotMatch(priceSampleLabel({ count: 20, latestDate: null }), /少量樣本/);
});
