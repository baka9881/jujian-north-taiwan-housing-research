import { latestTransactions } from "./transaction-records.mjs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBytes, normalizeName, parseCsv, rocToIso, todayTaipei } from "./data-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(root, "data", "processed", "projects.json");
const a7Directory = path.join(root, "data", "source", "a7-history");
const linkouPath = path.join(root, "data", "source", "linkou_presale_transactions.csv");
const officialBase = "https://plvr.land.moi.gov.tw";
const officialPage = `${officialBase}/DownloadOpenData`;
const linkouDatasetPage = "https://data.ntpc.gov.tw/datasets/D46D75A6-9888-44FF-BBF6-451D5279671A";
const linkouCsvUrl = "https://data.ntpc.gov.tw/api/datasets/D46D75A6-9888-44FF-BBF6-451D5279671A/csv/file";
const firstSeason = "112S1";

function median(numbers) {
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function streetTokens(value = "") {
  return [...new Set(value.match(/[\p{Script=Han}0-9一二三四五六七八九十]+(?:路|街|巷)/gu) || [])].sort();
}

function summarize(rows, fields, source) {
  const prices = rows
    .map((row) => Number(row[fields.unitPrice]) * 3.305785 / 10_000)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const dates = rows.map((row) => rocToIso(row[fields.date])).filter(Boolean).sort();
  return {
    median: roundOne(median(prices)),
    low: roundOne(prices[0]),
    high: roundOne(prices.at(-1)),
    count: prices.length,
    earliestDate: dates[0] || null,
    latestDate: dates.at(-1) || null,
    source,
  };
}

async function downloadSources() {
  await mkdir(a7Directory, { recursive: true });
  const seasonBytes = await fetchBytes(`${officialBase}/DownloadSeason_ajax_list`, { method: "POST" });
  const seasonHtml = seasonBytes.toString("utf8");
  const seasons = [...new Set([...seasonHtml.matchAll(/<option value="(\d{3}S[1-4])">/gu)].map((match) => match[1]))]
    .filter((season) => season >= firstSeason)
    .sort();
  if (!seasons.length) throw new Error("官方歷史季度清單沒有回傳可用資料");

  for (const season of seasons) {
    const query = new URLSearchParams({ season, fileName: "H_lvr_land_B.csv" });
    await writeFile(path.join(a7Directory, `${season}_H_lvr_land_B.csv`), await fetchBytes(`${officialBase}/DownloadSeason?${query}`));
  }
  const currentQuery = new URLSearchParams({ fileName: "h_lvr_land_b.csv" });
  await writeFile(path.join(a7Directory, "current_H_lvr_land_B.csv"), await fetchBytes(`${officialBase}/Download?${currentQuery}`));
  await writeFile(linkouPath, await fetchBytes(linkouCsvUrl));
  return seasons.length;
}

async function a7Transactions() {
  const files = (await readdir(a7Directory)).filter((name) => /_H_lvr_land_B\.csv$/iu.test(name)).sort();
  if (!files.length) throw new Error("找不到桃園市預售屋成交來源，請先使用 --download");
  const unique = new Map();
  let anonymous = 0;
  for (const file of files) {
    const rows = parseCsv(await readFile(path.join(a7Directory, file), "utf8"));
    for (const row of rows) {
      if (row.鄉鎮市區 !== "龜山區") continue;
      const serial = String(row.編號 || "").trim() || `anonymous-${file}-${anonymous += 1}`;
      unique.set(serial, row);
    }
  }
  const grouped = new Map();
  for (const row of latestTransactions([...unique.values()])) {
    const key = normalizeName(row.建案名稱);
    const unitPrice = Number(row.單價元平方公尺);
    if (!key || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return { grouped, reviewedCount: unique.size };
}

async function linkouTransactions() {
  const rows = parseCsv(await readFile(linkouPath, "utf8"));
  const unique = new Map();
  let anonymous = 0;
  for (const row of rows) {
    if (row.district !== "林口區") continue;
    const serial = String(row.rps27 || "").trim() || `anonymous-${anonymous += 1}`;
    unique.set(serial, row);
  }
  const grouped = new Map();
  for (const row of latestTransactions([...unique.values()], { serial: "rps27", cancellation: "rps30", price: "rps22_amountsunitdollars" })) {
    const key = normalizeName(row.rps28);
    const unitPrice = Number(row.rps22_amountsunitdollars);
    if (!key || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return { grouped, reviewedCount: unique.size };
}

function matchedEvidence(project, rows, checkedAt, sourceUrl, addressField, method) {
  const tokens = streetTokens(project.address);
  const corroborated = tokens.filter((token) => rows.some((row) => String(row[addressField] || "").includes(token)));
  return {
    status: "matched",
    statusLabel: "官方成交已配對",
    matchMethod: method,
    addressCorroborated: corroborated.length ? true : null,
    addressTokens: corroborated,
    lastCheckedAt: checkedAt,
    sourceUrl,
  };
}

function unmatchedEvidence(checkedAt, sourceUrl) {
  return {
    status: "official-no-match",
    statusLabel: "官方尚無已發布成交",
    matchMethod: "官方成交建案名稱未找到可安全歸戶紀錄；地號與地址不足以單獨判定同案",
    addressCorroborated: false,
    addressTokens: [],
    lastCheckedAt: checkedAt,
    sourceUrl,
  };
}

async function refreshPrices() {
  const payload = JSON.parse(await readFile(projectsPath, "utf8"));
  const checkedAt = todayTaipei();
  const a7 = await a7Transactions();
  const linkou = await linkouTransactions();
  const regionStats = { A7: { matched: 0, unmatched: 0 }, 林口: { matched: 0, unmatched: 0 } };

  for (const project of payload.projects) {
    if (!["林口", "A7"].includes(project.region)) continue;
    const source = project.region === "A7" ? a7 : linkou;
    const ambiguousName = payload.projects.filter((item) => item.city === project.city && item.district === project.district && normalizeName(item.name) === normalizeName(project.name)).length > 1;
    const rows = ambiguousName ? [] : source.grouped.get(normalizeName(project.name)) || [];
    const sourceUrl = project.region === "A7" ? officialPage : linkouDatasetPage;
    if (rows.length) {
      project.price = summarize(
        rows,
        project.region === "A7"
          ? { unitPrice: "單價元平方公尺", date: "交易年月日" }
          : { unitPrice: "rps22_amountsunitdollars", date: "rps07" },
        project.region === "A7" ? "內政部預售屋實價登錄（歷史季度＋本期）" : "新北市政府預售屋實價登錄開放資料",
      );
      project.priceEvidence = matchedEvidence(
        project,
        rows,
        checkedAt,
        sourceUrl,
        project.region === "A7" ? "土地位置建物門牌" : "rps02",
        "建案名稱正規化完全相符",
      );
      project.dataCompleteness = Math.max(project.dataCompleteness || 0, 90);
      regionStats[project.region].matched += 1;
    } else {
      project.price = null;
      project.priceEvidence = unmatchedEvidence(checkedAt, sourceUrl);
      if (ambiguousName) { project.priceEvidence.status = "source-no-match"; project.priceEvidence.statusLabel = "同名建案待人工歸戶"; }
      project.dataCompleteness = Math.min(project.dataCompleteness || 70, 70);
      regionStats[project.region].unmatched += 1;
    }
  }

  payload.generatedAt = checkedAt;
  payload.priceCoverage = {
    pricedProjects: payload.projects.filter((project) => project.price).length,
    totalProjects: payload.projects.length,
    linkouMatchedProjects: regionStats.林口.matched,
    linkouOfficialNoMatchProjects: regionStats.林口.unmatched,
    linkouOfficialRecordsReviewed: linkou.reviewedCount,
    a7MatchedProjects: regionStats.A7.matched,
    a7OfficialNoMatchProjects: regionStats.A7.unmatched,
    a7OfficialRecordsReviewed: a7.reviewedCount,
    historyFrom: firstSeason,
    checkedAt,
  };
  for (const source of payload.sources || []) {
    if (source.name?.startsWith("內政部預售屋實價登錄")) {
      source.name = "內政部預售屋實價登錄（歷史季度＋本期）";
      source.url = officialPage;
      source.role = "A7 自 2023 年起歷史季度與本期成交單價、筆數及最新交易";
    }
  }
  await writeFile(projectsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { ...payload.priceCoverage };
}

if (process.argv.includes("--download")) {
  console.log(`已下載 ${await downloadSources()} 個歷史季度、本期資料與林口完整成交檔`);
}
const result = await refreshPrices();
console.log(`價格完成：${result.pricedProjects}/${result.totalProjects} 案有官方成交；林口 ${result.linkouMatchedProjects}、A7 ${result.a7MatchedProjects}`);
