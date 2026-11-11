import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(root, "data", "processed", "projects.json");
const amenitiesPath = path.join(root, "data", "processed", "amenities.json");
const manualAuditsPath = path.join(root, "data", "manual", "quality-audits.json");
const outputPath = path.join(root, "data", "processed", "quality-evidence.json");
const generatedAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

const landSections = {
  林口段: { county: "F", code: "2211" },
  行政段: { county: "F", code: "2212" },
  佳林段: { county: "F", code: "2216" },
  麗林段: { county: "F", code: "0465" },
  力行段: { county: "F", code: "0466" },
  建林段: { county: "F", code: "0467" },
  新林段: { county: "F", code: "0468" },
  樂捷段: { county: "H", code: "1441" },
  善捷段: { county: "H", code: "1442" },
};

function parcelReference(buildingLand) {
  const match = buildingLand.match(/^(.+段)(\d+)(?:-(\d+))?地號$/u);
  if (!match || !landSections[match[1]]) return null;
  const section = landSections[match[1]];
  const main = match[2].padStart(4, "0");
  const sub = (match[3] || "0").padStart(4, "0");
  const parcelCode = `${section.code}${main}${sub}`;
  return {
    sectionName: match[1],
    sectionCode: section.code,
    parcelNumber: `${Number(match[2])}${match[3] ? `-${Number(match[3])}` : ""}`,
    parcelCode,
    officialMapUrl: `https://maps.nlsc.gov.tw/goland/${section.county}/${parcelCode}`,
  };
}

function locationReview(amenity, buildingLand) {
  const status = amenity.location.confidence === "high" || amenity.location.confidence === "medium"
    ? "verified"
    : amenity.location.confidence === "low"
      ? "approximate"
      : "awaiting-parcel-check";
  return {
    status,
    label: status === "verified" ? "已有可信定位" : status === "approximate" ? "道路位置估算" : "等待地號核對",
    method: amenity.location.method,
    parcel: amenity.location.method === "region-center" ? null : parcelReference(buildingLand),
  };
}

const defectCategories = ["漏水／滲水", "壁癌／潮濕", "磁磚脫落", "地下室積水", "電梯／機電", "隔音", "結構裂縫"];

function normalizeEvent(event, project) {
  const eventType = event.eventType || (event.category === "契約查核" ? "contract" : "defect");
  const caseCount = Number.isFinite(event.caseCount) ? event.caseCount : null;
  return {
    ...event,
    eventType,
    defectCategory: eventType === "defect" ? event.defectCategory || event.category : null,
    affectedArea: eventType === "defect" ? event.affectedArea || "資料未載明" : null,
    repairStatus: eventType === "defect" ? event.repairStatus || "資料未載明" : null,
    recurrence: eventType === "defect" ? event.recurrence || "資料未載明" : null,
    caseCount,
    casesPer100Households: eventType === "defect" && caseCount !== null && project.households > 0
      ? Number((caseCount / project.households * 100).toFixed(2))
      : null,
  };
}

async function main() {
  const projectDataset = JSON.parse(await readFile(projectsPath, "utf8"));
  const amenityDataset = JSON.parse(await readFile(amenitiesPath, "utf8"));
  const manualAudits = JSON.parse(await readFile(manualAuditsPath, "utf8"));
  let previousDataset = { projects: {} };
  try {
    previousDataset = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const projects = {};

  for (const project of projectDataset.projects) {
    const previous = previousDataset.projects?.[project.id] || {};
    const manualAudit = manualAudits.projects?.[project.id] || null;
    const isReviewedByCurrentAudit = Boolean(manualAudit || manualAudits.reviewedProjectIds?.includes(project.id));
    const manualDefaults = isReviewedByCurrentAudit ? manualAudits.defaults || {} : {};
    const defaultChecks = [
      { sourceId: "judicial", status: "not-reviewed", checkedAt: null, matchCount: null },
      { sourceId: "consumer-disputes", status: "not-reviewed", checkedAt: null, matchCount: null },
      { sourceId: "contract-inspection", status: "not-reviewed", checkedAt: null, matchCount: null },
    ];
    const previousChecks = new Map((previous.sourceChecks || []).map((check) => [check.sourceId, check]));
    const defaultManualChecks = manualDefaults.sourceChecks || {};
    const manualChecks = manualAudit?.sourceChecks || {};
    const events = (manualAudit?.events ?? (isReviewedByCurrentAudit ? [] : previous.events ?? []))
      .map((event) => normalizeEvent(event, project));
    const defectEvents = events.filter((event) => event.eventType === "defect");
    const contractEvents = events.filter((event) => event.eventType === "contract");
    projects[project.id] = {
      ...previous,
      ...manualDefaults,
      ...manualAudit,
      status: manualAudit?.status ?? manualDefaults.status ?? previous.status ?? "queued",
      statusLabel: manualAudit?.statusLabel ?? manualDefaults.statusLabel ?? previous.statusLabel ?? "已排入官方來源查核",
      lastReviewedAt: manualAudit?.lastReviewedAt ?? manualDefaults.lastReviewedAt ?? previous.lastReviewedAt ?? null,
      publishedEventCount: events.length,
      evidenceCount: events.length,
      defectEventCount: defectEvents.length,
      contractEventCount: contractEvents.length,
      defectReview: {
        status: defectEvents.length ? "identified" : isReviewedByCurrentAudit ? "reviewed-no-publishable-event" : "queued",
        label: defectEvents.length ? `已確認 ${defectEvents.length} 件實際瑕疵` : isReviewedByCurrentAudit ? "未找到可歸戶的實際瑕疵" : "實際瑕疵待查核",
        categories: defectCategories,
      },
      searchTerms: [project.name, project.builder, project.permitNo, project.buildingLand],
      defectSearchTerms: defectCategories.map((category) => `${project.name} ${category.split("／")[0]}`),
      sourceChecks: defaultChecks.map((check) => {
        const merged = {
          ...check,
          ...(previousChecks.get(check.sourceId) || {}),
          ...(defaultManualChecks[check.sourceId] || {}),
          ...(manualChecks[check.sourceId] || {}),
        };
        if (check.sourceId === "judicial" && !merged.query) merged.query = project.name;
        return merged;
      }),
      locationReview: locationReview(amenityDataset.projects[project.id], project.buildingLand),
      events,
    };
  }

  const values = Object.values(projects);
  const payload = {
    generatedAt,
    methodology: {
      publishRule: "僅刊登 A 級可直接核對資料，或至少兩個互相獨立來源構成的 B 級資料；C 級線索不形成品質結論。",
      noEventDisclaimer: "0 件已刊登事件只代表目前沒有資料通過刊登門檻，不代表建案沒有漏水或施工問題。",
      defectPublishRule: "實際瑕疵必須同時能確認建案、問題類型與發生事實；只有建商名稱、相似社區或契約違規時，不歸入漏水或施工瑕疵。",
      normalizationDisclaimer: "事件件數會另外列出每 100 戶比例；屋齡、棟別與是否修復仍需與原始文件一起判讀，不能只用件數排名建商。",
      defectCategories,
      reviewStates: {
        queued: "已排入查核，尚未逐筆完成官方來源搜尋",
        reviewing: "正在核對事件、建案名稱、地址與當事人",
        reviewed: "本輪來源查核完成，但仍可能因資料更新而改變",
      },
      evidenceLevels: {
        A: "裁判書、政府處分、建商正式公告、具體修繕或鑑定文件",
        B: "至少兩個互相獨立且能確認同一建案的公開來源",
        C: "單一匿名貼文、無法核對棟別時間或僅有轉述的待查線索",
      },
    },
    sources: [
      { id: "judicial", name: "司法院裁判書查詢", url: "https://judgment.judicial.gov.tw/FJUD/default.aspx", level: "A", access: "公開查詢" },
      { id: "judicial-api", name: "司法院裁判書開放 API", url: "https://opendata.judicial.gov.tw/", level: "A", access: "需申請帳號與限時權杖" },
      { id: "consumer-disputes", name: "內政部房地產消費糾紛案例", url: "https://data.gov.tw/dataset/7506", level: "A", access: "開放資料" },
      { id: "contract-inspection", name: "行政院消保處預售屋契約查核", url: "https://cpc.ey.gov.tw/Page/6C059838CA9744A8/b876668f-58c1-4e6f-80c3-846d4a317786", level: "A", access: "公開資料" },
      { id: "nlsc", name: "國土測繪圖資服務雲", url: "https://maps.nlsc.gov.tw/", level: "A", access: "地號人工核對" },
    ],
    summary: {
      projectCount: values.length,
      publishedEventCount: values.reduce((total, project) => total + project.publishedEventCount, 0),
      defectEventCount: values.reduce((total, project) => total + project.defectEventCount, 0),
      contractEventCount: values.reduce((total, project) => total + project.contractEventCount, 0),
      queuedCount: values.filter((project) => project.status === "queued").length,
      reviewedCount: values.filter((project) => project.status === "reviewed").length,
      verifiedLocationCount: values.filter((project) => project.locationReview.status === "verified").length,
      approximateLocationCount: values.filter((project) => project.locationReview.status === "approximate").length,
      awaitingParcelCount: values.filter((project) => project.locationReview.status === "awaiting-parcel-check").length,
    },
    projects,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`完成 ${payload.summary.reviewedCount}／${payload.summary.projectCount} 個建案的品質查核，刊登 ${payload.summary.publishedEventCount} 筆官方結果`);
  console.log(`定位：可信 ${payload.summary.verifiedLocationCount}、道路估算 ${payload.summary.approximateLocationCount}、待地號核對 ${payload.summary.awaitingParcelCount}`);
}

await main();
