import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalogue = JSON.parse(await readFile(new URL("../data/processed/projects.json", import.meta.url), "utf8"));
const catalogueSize = catalogue.projects.length;

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("opens with clear paths for current listings and historical records", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>居鑑｜北台灣建案履歷<\/title>/);
  assert.match(html, /找目前刊登的房屋/);
  assert.match(html, /查建案履歷/);
  assert.match(html, /房源由信義房屋提供/);
  assert.match(html, /不代表建案仍在銷售/);
  assert.match(html, /Taipei-city\/presale\/default-desc\/1/);
  assert.doesNotMatch(html, /class="project-grid-card"/);
  assert.doesNotMatch(html, /data-map-engine="leaflet"/);
  assert.doesNotMatch(html, /class="map-project-card"/);
  assert.match(html, /lang="zh-Hant-TW"/);
  assert.doesNotMatch(html, /滾輪縮放 · 拖曳移動/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /maps\/search\/|target="_blank"[^>]*>[^<]*(?:地圖|放大)/);
  assert.doesNotMatch(html, /匿名示範資料|綜合表現/);
});

test("processed amenity data is scored and source-labelled", async () => {
  const raw = await readFile(new URL("../data/processed/amenities.json", import.meta.url), "utf8");
  const dataset = JSON.parse(raw);

  assert.equal(Object.keys(dataset.projects).length, catalogueSize);
  assert.ok(dataset.pois.length >= 350);
  assert.equal(dataset.source.name, "OpenStreetMap contributors");
  assert.equal(Object.keys(dataset.categories).length, 10);
  assert.ok(["market", "park", "pharmacy", "parking"].every((category) => dataset.categories[category]));
  assert.ok(dataset.routeCoverage.routedProjects >= 31);
  assert.equal(dataset.routeCoverage.routedProjects, Object.values(dataset.projects).filter((project) => project.score !== null).length);
  assert.equal(dataset.routeCoverage.unavailableLocationProjects, Object.values(dataset.projects).filter((project) => project.scoreReliability === "unavailable").length);
  assert.deepEqual(Object.keys(dataset.methodology.profiles).sort(), ["balanced", "driver", "family", "student"]);
  assert.equal(dataset.methodology.scoreFormula.version, 2);
  assert.equal(dataset.methodology.scoreFormula.routeWeightPercent, 75);
  assert.equal(dataset.methodology.scoreFormula.densityWeightPercent, 25);
  assert.match(dataset.methodology.scoreFormula.densityDisclaimer, /營業時間、店家品質與即時路況目前不計分/);
  assert.equal(Object.keys(dataset.methodology.densityRules).length, 10);
  assert.ok(Object.values(dataset.projects).every((project) => project.score === null || (project.score >= 0 && project.score <= 100)));
  assert.ok(Object.values(dataset.projects).every((project) => project.location.confidence));
  assert.ok(Object.values(dataset.projects).filter((project) => project.scoreReliability === "verified").length >= 17);
  assert.equal(Object.values(dataset.projects).filter((project) => project.scoreReliability === "unavailable").length, dataset.routeCoverage.unavailableLocationProjects);
  assert.ok(Object.values(dataset.projects).filter((project) => project.location.confidence === "estimated").every((project) => project.score === null));
  assert.ok(Object.values(dataset.projects).filter((project) => project.location.method === "nlsc-official-intersection").length > 16);
  assert.ok(Object.values(dataset.projects).filter((project) => project.score !== null).every((project) => Object.keys(project.categoryScores).length === 10));
  assert.ok(Object.values(dataset.projects).every((project) => Object.keys(project.routeScores).length === 10));
  assert.ok(Object.values(dataset.projects).every((project) => Object.keys(project.densityScores).length === 10));
  assert.ok(Object.values(dataset.projects).every((project) => Object.keys(project.nearbyCounts).length === 10));
  assert.equal(dataset.projects["林口-11-c4a9a4"].score, 41);
  assert.equal(dataset.projects["林口-11-c4a9a4"].nearbyCounts.convenience, 11);
  assert.ok(Object.values(dataset.projects).filter((project) => project.score !== null).every((project) => Object.values(project.nearest).every((nearest) => !nearest || nearest.routes.walking)));
  assert.match(dataset.methodology.peakDisclaimer, /不是即時路況/);
});

test("quality evidence records all current official-source reviews without overclaiming", async () => {
  const raw = await readFile(new URL("../data/processed/quality-evidence.json", import.meta.url), "utf8");
  const dataset = JSON.parse(raw);
  const projects = Object.values(dataset.projects);
  const events = projects.flatMap((project) => project.events);

  assert.equal(projects.length, catalogueSize);
  assert.equal(dataset.summary.queuedCount, catalogueSize - 42);
  assert.equal(dataset.summary.reviewedCount, 42);
  assert.equal(dataset.summary.publishedEventCount, 7);
  assert.equal(dataset.summary.defectEventCount, 0);
  assert.equal(dataset.summary.contractEventCount, 7);
  const amenities = JSON.parse(await readFile(new URL("../data/processed/amenities.json", import.meta.url), "utf8"));
  const amenityProjects = Object.values(amenities.projects);
  assert.equal(dataset.summary.verifiedLocationCount, amenityProjects.filter((project) => ["high", "medium"].includes(project.location.confidence)).length);
  assert.equal(dataset.summary.approximateLocationCount, amenityProjects.filter((project) => project.location.confidence === "low").length);
  assert.equal(dataset.summary.awaitingParcelCount, amenityProjects.filter((project) => project.location.confidence === "estimated").length);
  assert.ok(projects.filter((project) => project.status === "reviewed").length === 42);
  assert.equal(events.length, 7);
  assert.ok(events.every((event) => event.level === "A"));
  assert.ok(events.every((event) => event.category === "契約查核"));
  assert.ok(events.every((event) => event.eventType === "contract"));
  assert.ok(projects.every((project) => project.defectEventCount === 0));
  assert.ok(projects.every((project) => project.defectReview.categories.length === 7));
  assert.equal(events.filter((event) => event.outcome === "符合").length, 6);
  assert.equal(events.filter((event) => event.outcome === "部分不符合").length, 1);
  assert.ok(events.every((event) => /施工|漏水/.test(event.limitation)));
  assert.match(dataset.projects["a7-06-08ce9d"].events[0].summary, /房地面積誤差及其價款找補/);
  assert.equal(dataset.projects["a7-12-ae84ab"].events.length, 0);
  assert.match(dataset.projects["a7-12-ae84ab"].sourceChecks.find((check) => check.sourceId === "judicial").note, /不是漏水或施工瑕疵/);
  assert.equal(dataset.projects["a7-10-e86850"].sourceChecks.find((check) => check.sourceId === "judicial").status, "ambiguous-query");
  assert.ok(projects.filter((project) => project.status === "reviewed").every((project) => project.locationReview.parcel?.officialMapUrl.startsWith("https://maps.nlsc.gov.tw/goland/")));
  assert.ok(dataset.methodology.noEventDisclaimer.includes("不代表建案沒有漏水或施工問題"));
  assert.match(dataset.methodology.defectPublishRule, /建案、問題類型與發生事實/);
});

test("processed data has the intended scope and explicit unknown states", async () => {
  const raw = await readFile(new URL("../data/processed/projects.json", import.meta.url), "utf8");
  const dataset = JSON.parse(raw);
  const regions = new Set(dataset.projects.map((project) => project.region));

  assert.equal(dataset.projects.length, catalogueSize);
  assert.equal(regions.size, 7);
  assert.equal(new Set(dataset.projects.map((project) => project.city)).size, 5);
  assert.ok(dataset.projects.filter((project) => project.price).length >= 37);
  assert.ok(dataset.projects.filter((project) => project.region === "A7" && project.price).length >= 17);
  assert.ok(dataset.projects.filter((project) => project.region === "A7").length > 20);
  assert.ok(dataset.priceCoverage.a7OfficialRecordsReviewed >= 8000);
  assert.equal(dataset.priceCoverage.historyFrom, "112S1");
  assert.ok(dataset.projects.filter((project) => project.price).every((project) => project.price.count > 0));
  assert.ok(dataset.projects.filter((project) => project.region === "A7" && project.price).every((project) => project.price.source.includes("歷史季度＋本期")));
  assert.ok(dataset.projects.every((project) => project.registryNumber));
  assert.equal(new Set(dataset.projects.map((project) => project.sourceKey)).size, dataset.projects.length);
});

test("safe update report records safeguards and keeps historical backlog separate", async () => {
  const raw = await readFile(new URL("../data/processed/update-report.json", import.meta.url), "utf8");
  const report = JSON.parse(raw);

  assert.equal(report.summary.catalogueAfter, catalogueSize);
  assert.equal(report.summary.ambiguousCount, report.changes.ambiguous.length);
  assert.equal(report.summary.missingFromCurrentSourceCount, report.changes.missing.length);
  assert.equal(report.summary.historicalBacklogCount, 0);
  assert.equal(report.pipeline.status, "complete");
  assert.equal(report.pipeline.totalProjects, catalogueSize);
  assert.ok(report.safeguards.some((item) => item.includes("不會") && item.includes("刪除")));
});

test("regional supply data is current, scoped, and never presented as project sales", async () => {
  const raw = await readFile(new URL("../data/processed/regional-supply.json", import.meta.url), "utf8");
  const sourceRaw = await readFile(new URL("../data/manual/regional-supply-source.json", import.meta.url), "utf8");
  const dataset = JSON.parse(raw);
  const source = JSON.parse(sourceRaw);

  assert.equal(dataset.latestPeriod, source.latestPeriod);
  assert.equal(dataset.national.units, source.national.units);
  for (const [region, mapping] of Object.entries(source.regionMapping)) {
    const district = source.districts.find((record) => record.county === mapping.county && record.district === mapping.district && record.period === source.latestPeriod);
    const county = source.counties.find((record) => record.county === mapping.county);
    assert.equal(dataset.regions[region].sourceLevel, district ? "district" : "county");
    assert.equal(dataset.regions[region].units, (district || county).units);
    if (!district) assert.match(dataset.regions[region].fallbackReason, /未公布.*確切戶數/);
  }
  assert.match(dataset.methodology.interpretation, /不推論單一建案銷售率/);
  assert.match(dataset.sources.bulletin.url, /^https:\/\/www\.moi\.gov\.tw\//);
});

test("filter controls stay above Leaflet map layers", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const filterLayer = Number(css.match(/\.filter-bar \{[^}]*z-index:(\d+)/)?.[1]);
  const headerLayer = Number(css.match(/\.site-header \{[^}]*z-index:(\d+)/)?.[1]);

  assert.ok(filterLayer > 1000);
  assert.ok(headerLayer > filterLayer);
  assert.match(css, /\.advanced-filter-panel \{[^}]*position:fixed;[^}]*right:20px;[^}]*width:min\(460px,calc\(100vw - 40px\)\)/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.advanced-filter-panel \{[^}]*bottom:0;[^}]*width:100%;[^}]*max-height:82dvh/);
});

test("map uses stable project coordinates and progressive zoom layers", async () => {
  const source = await readFile(new URL("../app/InteractiveMap.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /containerPointToLatLng|marker-offset-line|areaMarkerOffsets/);
  assert.match(source, /groupMapLabels/);
  assert.match(source, /leaflet\.marker\(point,/);
  assert.match(source, /map\.getZoom\(\) >= 14/);
  assert.match(source, /leaflet\.control\.zoom/);
  assert.match(source, /method !== "catalogue-fallback"/);
  assert.match(source, /onClusterSelect\?\.\(group.ids\)/);
  assert.match(source, /onViewportChange\?\./);
  assert.doesNotMatch(source, /map-empty-state|map-marker-zoom-hint|map-coverage-note|map-gesture-hint/);
  assert.match(css, /\.map-explorer-body/);
});

test("detail interface separates defect evidence and supports route-based custom amenity weights", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /快速結論/);
  assert.match(source, /先看答案，需要時再查看資料來源/);
  assert.match(source, /每月固定支出/);
  assert.match(source, /className="summary-answer-list"/);
  assert.match(source, /查看官方基本資料/);
  assert.match(source, /實際瑕疵與契約查核/);
  assert.match(source, /契約違規不會被當成漏水證據/);
  assert.match(source, /我們查了哪些資料？/);
  assert.match(source, /調整各項權重/);
  assert.match(source, /查看其餘 \{activeMoreAmenityEntries\.length\} 類設施/);
  assert.match(source, /查看設施地圖與計算方式/);
  assert.match(source, /不再只看最近一家/);
  assert.match(source, /查看 \{activeAmenityScore\} 分怎麼算/);
  assert.match(source, /amenityNearbyCountText/);
  assert.match(source, /routeTimeText\(nearest\)/);
  assert.match(source, /平日 8 時/);
});

test("the product keeps map mode focused and reveals information progressively", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /type BudgetFilter/);
  assert.match(source, /每坪成交預算/);
  assert.match(source, /縮小搜尋範圍/);
  assert.doesNotMatch(source, /result-sidebar|panelOpen|隱藏清單|顯示清單/);
  assert.match(source, /if \(project\) previewProject\(project\)/);
  assert.match(source, /className="map-project-preview"/);
  assert.match(source, /查看建案/);
  assert.match(source, />總覽<\/button>/);
  assert.match(source, />價格<\/button>/);
  assert.match(source, />費用<\/button>/);
  assert.match(source, />品質<\/button>/);
  assert.match(source, />機能<\/button>/);
  assert.match(source, />建商<\/button>/);
  assert.match(source, /initialCamera=\{builderMapFocus\?\.id === validMapPreviewId \? builderMapFocus\.camera : mapCameraMemory\[mapScopeKey\]\}/);
  assert.match(source, /className="map-tools-control"/);
  assert.doesNotMatch(source, /map-marker-zoom-hint|map-coverage-note|map-gesture-hint/);
  assert.match(source, /priceComparison\(active\)/);
  assert.match(source, /區域新屋供給/);
  assert.doesNotMatch(source, /setDetailTab\("supply"\)|快速前往|更多資料/);
  assert.match(source, /快速結論/);
  assert.match(source, /className="summary-data-confidence"/);
  assert.match(source, /資料可信度/);
  assert.match(source, /\{activeConfidence\.covered\}／4 項可核對/);
  assert.match(source, /資料不足，暫不評分/);
  assert.match(source, /不以建案數量推測售後品質/);
  assert.match(source, /價格、品質、生活與資料可信度分開比較/);
  assert.match(css, /\.summary-answer-list/);
  assert.match(css, /\.summary-data-confidence/);
  assert.match(css, /\.detail-drawer > nav \{[^}]*grid-template-columns:repeat\(6,minmax\(52px,1fr\)\)/);
  assert.match(css, /\.map-project-preview/);
  assert.doesNotMatch(css, /\.evidence-navigation/);
  assert.match(css, /\.map-region-pin/);
  assert.doesNotMatch(css, /\.panel-toggle|\.panel-collapsed|\.result-sidebar|\.map-project-card/);
  assert.match(source, /primary-filter-button/);
  assert.match(source, /role="dialog" aria-modal="true" aria-label="篩選建案"/);
  assert.match(source, /onGeography=/);
  assert.match(source, /\{confidence\.covered\}／4 項可核對/);
  assert.doesNotMatch(source, /quick-start|熱門地區/);
  assert.match(css, /\.filter-backdrop,\.detail-backdrop \{[^}]*position:fixed/);
  assert.match(css, /\.table-scroll th:first-child \{[^}]*position:sticky/);
});

test("registration status is not misrepresented as a current presale ratio", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const mapSource = await readFile(new URL("../app/InteractiveMap.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /首次登記狀態/);
  assert.match(pageSource, /尚無首次登記資料/);
  assert.match(pageSource, /不能直接判定仍是預售屋/);
  assert.doesNotMatch(pageSource, /<option value="presale">預售屋<\/option>/);
  assert.doesNotMatch(mapSource, /stageLabel|stage === "presale"/);
});

test("project details include traceable nearby street imagery without pretending it is an official facade photo", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /function streetViewEmbedUrl/);
  assert.match(source, /https:\/\/www\.google\.com\/maps\/embed/);
  assert.match(source, /附近實景 · Google Street View/);
  assert.match(source, /查看建案附近實景/);
  assert.match(source, /className="summary-visual-details"/);
  assert.match(source, /不一定正對建案入口/);
  assert.match(source, /預售屋可能是施工前或尚未更新的畫面/);
  assert.match(css, /\.project-visual iframe \{[^}]*pointer-events:none;/);
  assert.match(css, /\.project-visual\.interactive iframe \{ pointer-events:auto;/);
});

test("official contract checks are explained in plain Traditional Chinese before the original wording", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /官方有沒有查到合約問題？/);
  assert.match(source, /官方抽查合約，沒有發現不合格項目/);
  assert.match(source, /政府抽查了這份預售屋合約的 15 個項目/);
  assert.match(source, /這只表示合約內容通過當次抽查/);
  assert.match(source, /不能證明不會漏水/);
  assert.match(source, /查看政府原本怎麼寫/);
  assert.match(source, /查看政府原始資料/);
});

test("project details provide a self-use-only holding cost calculator without treating market price as taxable value", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /只算自住/);
  assert.match(source, /買下後，每月還要付多少？/);
  assert.match(source, /房屋課稅現值/);
  assert.match(source, /看房屋稅單，不是買價/);
  assert.match(source, /土地課稅地價持分/);
  assert.match(source, /自住 1\.2% 保守試算/);
  assert.match(source, /自用住宅用地 2‰/);
  assert.match(source, /主建物＋附屬建物約/);
  assert.match(source, /這不是室內淨坪/);
  assert.match(source, /實際金額以稅捐機關稅單、社區規約與管委會公告為準/);
  assert.doesNotMatch(source, /出租情境|投資情境|非自住試算/);
  assert.match(css, /\.holding-cost-total/);
  assert.match(css, /\.holding-cost-breakdown/);
});
