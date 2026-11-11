# JuJian — Northern Taiwan Housing Project Explorer

JuJian is a housing research platform for new residential projects in Northern Taiwan. The first regional catalogue covers Taoyuan, Hsinchu County, Hsinchu City, Taipei and New Taipei, with dedicated Linkou and Airport MRT A7 subregions, combining official project records, registered transaction prices, regional housing supply, nearby amenities, quality evidence, and estimated owner-occupier holding costs.

**Live site:** [jujian-north-taiwan.baka0406.chatgpt.site](https://jujian-north-taiwan.baka0406.chatgpt.site)

## What the Project Does

- Opens with a scannable project list; city, district and unit price are the primary filters.
- Keeps geographic breadcrumbs and result counts visible, with optional map browsing and progressive zoom levels.
- Preserves filters, comparison selections and view scroll positions when switching between list and map; pagination returns to the result heading.
- Shows whether the official record includes a first-registration date; a missing date is not presented as proof that a project is still presale.
- Shows official registered transaction prices and regional price comparisons.
- Presents Ministry of the Interior unsold-new-home statistics as regional supply context.
- Reviews traceable quality evidence without treating missing records as proof that no problem exists.
- Scores nearby amenities using route time and the number of nearby choices.
- Estimates recurring owner-occupier costs, including management fees, house tax, and land value tax.
- Supports side-by-side project comparison.

## Product Principles

- Every negative claim should be traceable to a source.
- Missing data means **insufficient information**, not **no problem**.
- Contract inspections are not presented as evidence of construction quality.
- Regional unsold-home figures are not interpreted as the sales rate of an individual project.
- Estimated project locations are clearly distinguished from verified locations.
- Price, quality, convenience, recurring cost, and data confidence remain separate instead of being collapsed into one misleading score.

## Data Sources

The project currently uses or references data from:

- Ministry of the Interior real-estate transaction and presale-project datasets
- Ministry of the Interior regional unsold-new-home statistics
- New Taipei City open data
- National Land Surveying and Mapping Center services
- OpenStreetMap contributors
- Official administrative inspection records and source links

Source coverage and publication schedules vary. The interface displays the relevant scope, date, confidence, and limitations wherever possible.

## Updating the Data

On Windows, double-click `更新建案資料.cmd` in the project root. The update pipeline will:

1. Download the latest official presale-project records and detect new or changed projects.
2. Refresh Linkou/A7 historical transactions and current-quarter transactions for the five configured cities/counties.
3. Preserve reviewed amenity results and initialize new projects as unavailable; use `--amenities` to match explicit two-road addresses against the official NLSC intersection API, then refresh POI and routes for reviewed `amenityEnabled` regions.
4. Rebuild quality evidence while preserving manually reviewed records.
5. Rebuild regional housing-supply data.
6. Validate that project, price, location, amenity, quality, and supply datasets remain synchronized.

After an update, review `data/processed/update-report.json` before publishing. Running the local update does not automatically deploy the production site.

### Safe Update Rules

- A new project is added automatically only when its official identity can be matched unambiguously.
- Existing projects are not deleted just because they are temporarily absent from a new source release.
- Renames, multiple matches, and identity conflicts are reported for manual review instead of being overwritten.
- Manual location overrides in `data/manual/location-overrides.json` take priority over automated geocoding.
- Reviewed quality events, source progress, and review dates are preserved.
- Older candidates outside the initial catalogue are kept in `historicalBacklog` instead of being inserted all at once.

### Updating Regional Housing Supply

Regional supply has a single maintainable source file:

```text
data/manual/regional-supply-source.json
```

After updating the official quarterly values and source metadata, run:

```bash
npm run data:supply
```

The generator chooses current district-level data when available and falls back to county or city data with an explicit scope label when the official release does not publish an exact district value.

## Development

### Requirements

- Node.js 22.13 or later
- npm

### Setup

```bash
npm install
npm run dev
```

### Validation

```bash
npm run data:check
npm run lint
npm test
```

`npm test` builds the production application and runs the rendered-output and data-integrity tests.

### Main Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm run data:update` | Run the complete safe data-update pipeline |
| `npm run data:supply` | Rebuild regional housing-supply data |
| `npm run data:check` | Validate processed datasets and cross-file consistency |
| `npm run lint` | Run ESLint |
| `npm test` | Build and run the automated test suite |

## Project Structure

```text
app/                 Application UI and interactive map
data/manual/         Human-reviewed inputs and overrides
data/processed/      Generated datasets consumed by the site
scripts/             Data ingestion, enrichment, generation, and validation
tests/               Rendered-output and data-integrity tests
.openai/hosting.json Site hosting metadata
```

## Current Scope and Limitations

- The catalogue contains 2,299 identifiable residential projects from the available official snapshot in 7 regions and 5 cities/counties; it is not a complete Northern Taiwan database.
- Some locations are approximate when an exact parcel or official address cannot be safely matched.
- Amenity scores depend on available OpenStreetMap data and stored route results.
- Quality evidence is limited to records that can be traced and responsibly attributed.
- The holding-cost calculator is an estimate for owner-occupiers, not a tax assessment.
- Transaction prices are historical registered transactions, not current asking prices or appraisals.

JuJian is a research and comparison tool. It does not replace a professional building inspection, legal review, tax assessment, appraisal, or on-site investigation.


## 全量分區目錄：維護與驗證（2026-09-20）

### 已完成與資料範圍

- 2,304 案：林口 95、A7 35、桃園其他 1,095、新北其他 609、新竹市 238、新竹縣 148、臺北市 84。原有人工證據完整保留。
- 取消 12 案首批上限、20 戶最低門檻及最新備查日期限制；509 案為少於 20 戶的小型住宅，現在也能搜尋及比較。
- 使用工作區既有官方 CSV 快照，**不是 2026-09-20 的最新市場全集**。來源本身未提供發布日期時保留 null；匯入日期不能取代發布日期。來源檔雜湊記錄於更新報告 `sourceManifest`。
- 全目錄有 288 案成交樣本；林口／A7 以外區域僅有本期快照，林口／A7 使用原歷史樣本，不可直接當作同期市場漲跌比較。
- 原 42 案品質查核與 7 筆契約查核證據均保留；目前 382 案有個別道路／路口參考點，其中 51 案完成生活機能路線評估。未完成定位或機能評估者明確標為待補，不以缺資料判為無漏水或不便利。
- 現有快照共 2,322 筆具名住宅候選，2,304 案收錄，22 筆身分歧義待核對；另有 4 筆舊目錄資料因修正來源欄位後不再符合住宅用途，保留於更新報告供人工處理，未自動刪除。
- 列表每頁顯示 24 案，可切換任意頁；篩選條件改變回到第一頁，跨頁／跨區比較清單保留。這是顯示分頁，不是收錄上限。
- 篩選提供縣市、分區、行政區及既有價格／品質／機能條件；切換篩選不清除跨區比較清單，最多 3 案。基準只取同縣市、同行政區、同分區已收錄建案，少於 3 個有價建案時不提供中位數比較。
- 地圖只把 382 案 NLSC／Nominatim 道路或路口結果畫成個案參考點；其餘 1,922 案以行政區彙整圖示呈現。遠景看縣市總量、中景看行政區總量、近景才顯示已有參考點的個案；近景若標記重疊會先合併成群組，點擊或放大後才拆開，避免把示意座標誤認成基地位置也避免標記互相遮住。

### 架構與責任

| 檔案 | 維護內容 |
| --- | --- |
| `data/regions.json` | 分區 ID、名稱、縣市、官方 CSV、行政區條件、A7 地址規則、分區示意中心、行政區界面積重心及其官方來源、完整匯入政策（不設數量、戶數、日期門檻） |
| `scripts/regions.mjs` | 設定驗證及唯一歸區；特定生活圈優先，縣市其餘區域最後承接 |
| `scripts/buildcase-csv.mjs` | 修復官方 CSV 文字欄未引用逗號造成的欄位位移，並留下來源修復註記 |
| `scripts/scan-project-updates.mjs` | 官方身分對照、增量匯入、歧義與歷史候選報告 |
| `scripts/nlsc-intersections.mjs` | 解析路口地址、NLSC 行政區／路口資料及嚴格道路名稱匹配 |
| `scripts/refresh-regional-prices.mjs` | 五縣市本期成交 CSV，縣市＋行政區＋名稱唯一配對，排除解約、去重 |
| `scripts/sync-regional-amenities.mjs` | 保留既有評估、建立未定位／未評分狀態；示意中心不能當作建案座標 |
| `app/catalogue.ts` | 共用地域篩選、比較名單及價格比較群組 |
| `scripts/update-all.mjs` | 串接匯入、價格、機能、品質及供給驗證；任何步驟失敗即還原五份 processed 資料 |

`data/regions.json` 的順序有意義：林口及 A7 必須放在新北其他及桃園其他之前。A7 屬龜山區內的地址／地段子集合，龜山其餘建案歸桃園其他。`districts: []` 表示承接該縣市全部其餘行政區。ID 和 label 是持久識別的一部分，已有資料後不可直接改名；改分區規則時要先做明確 ID 遷移及人工證據對照，避免建立第二份同案資料。

`districtMap.centers` 由[內政部國土測繪中心鄉鎮市區界線](https://data.gov.tw/dataset/7441)的行政區界計算面積重心，只供未定位建案的群組入口。新增縣市或來源出現新的行政區時，先加入 `city::district` 中心座標並更新 `source.boundaryVersion`，再執行 `npm run data:check`；缺少中心的已匯入行政區會讓測試失敗。這些座標不得寫回單一建案的 `amenity.location`。

### 日常更新

```bash
# 下載官方來源，更新五縣市建案及成交；保留已評估機能
npm run data:update

# 用既有工作區快照離線重現（data/source 未納入 Git）
npm run data:snapshot

# 更新所有分區的官方路口定位；目前只對 amenityEnabled 的林口／A7 重算 POI／路線
npm run data:update -- --amenities

# 匯入後驗證與測試
npm run data:check
npm run lint
npm test
```

雙擊 `更新建案資料.cmd` 同樣執行日常更新。更新不會自行發布網站。`--snapshot` 使用 `data/source/lvr_buildcasecsv/` 與 `data/source/lvr_landcsv/`；一般下載使用 `current-buildcases/` 與 `current-transactions/`。CSV 需為官方 UTF-8 格式並保留原始欄名（建案名稱、鄉鎮市區、編號等），不接受自行猜測欄位的試算表。缺檔、無效欄位或驗證失敗均中止並還原 processed。請一次只執行一個更新程序；處理中的檔案不是可發布版本，應等 `pipeline.status=complete` 後才建置發布。

每次更新都掃描來源中全部具名住宅建案，舊日期、同日補登、少量戶數與缺少日期不會被排除。能用備查編號、建照或名稱＋基地安全識別者直接納入；身分重複、衝突或缺乏識別資料保留於 `changes.ambiguous`。`--accept` 保留相容性，但已不需要用它逐筆加入舊案，也不會繞過歧義檢查。

既有案不因來源消失而刪除；請查看 `changes.added`、`updated`、`missing` 和 `ambiguous`。重跑相同來源不重複新增。住宅以外用途與名稱無法辨識的來源不列為可搜尋建案；這仍是官方預售屋備查來源的涵蓋範圍，不是所有歷年建成社區的全集。

### 補齊品質、建商與生活機能

- **品質證據**：以持久 project ID 寫入 `data/manual/quality-audits.json`，記錄 `eventType`（defect 或 contract）、證據 A/B/C、來源網址／日期、事件摘要、問題部位、修繕結果、是否復發及判讀限制。漏水與契約查核分開；建商名稱相同不能作為建案歸戶依據。確認查核範圍後才填 `reviewedProjectIds`／查核日期，再執行 `node scripts/build-quality-evidence.mjs` 及 `npm run data:check`。
- **建商履歷**：以官方起造人名稱完全相同跨區聚合，顯示已收錄作品；尚無經核對的公司別名／母子公司對照或售後統計，不合併推測，也不評分售後。
- **定位**：`--amenities` 會先從官方申報街道解析明確的兩路交叉描述，再以 NLSC `ListRoadCross` 完全匹配路名並快取結果；未匹配者不猜座標。人工核對的門牌／地號使用 `data/manual/location-overrides.json`，優先於自動結果；未定位新案不顯示精確標記、附近街景或機能分數。
- **新分區機能的下一階段資料接入**：目前 `amenityEnabled` 只適用既有林口／A7 的 POI／路線來源。新分區先保持 false；須先為該區建立實際範圍的 POI 取得與快取、核對地址座標、確認便利商店／全聯／好市多等十類設施涵蓋，再接到 `enrich-amenities.mjs`／`enrich-route-times.mjs` 的相同資料格式。**不能只把 false 改成 true**，否則會沿用原生活圈 POI 範圍。這版提供跨區一致的待補狀態及評估介面，未宣稱已完成新區域地圖蒐集。
- **供給**：維護 `data/manual/regional-supply-source.json` 的縣市／行政區數值與來源，執行 `npm run data:supply`。無可用資料的地區顯示待補，絕不填 0 或套其他縣市數據。

### 第一版驗證

`npm test` 包含正式建置、伺服器渲染，以及分區唯一歸屬、跨區篩選／比較、重複匯入穩定、品質證據保留、損壞來源整批還原等 27 項測試。測試用官方欄位格式的小型資料，不依賴網路或未入 Git 的來源快取。暫存測試資料保留在 Git 忽略的 `work/`，不批次刪除。

已加入 Wrangler 官方產生的 Worker runtime 型別與可選 D1 binding 宣告，可執行 `npm run typecheck`。更新 Cloudflare runtime／相容日期後執行 `npm run types:generate` 重新產生型別。未執行瀏覽器點擊／截圖自動化。


## 參考官方資源後的改善（2026-09-10）

| 官方資源 | 落實的調整 |
| --- | --- |
| [內政部建案備查資料](https://data.gov.tw/dataset/176351) | 介面註明每月 1 日產製；來源排程、匯入日期與交易日期分開說明。 |
| [內政部實價查詢網](https://lvr.land.moi.gov.tw/jsp/index.jsp) | 顯示每月 1／11／21 日發布節奏及揭露落差；比較表新增樣本起訖日期。 |
| [OSMF Nominatim 政策](https://operations.osmfoundation.org/policies/nominatim/) | 移除批次流程對公共 Nominatim 的預設網路呼叫；改為快取優先、可指定供應商及查詢間隔。 |
| [Cloudflare TypeScript 指南](https://developers.cloudflare.com/workers/languages/typescript/) | 用 Wrangler 產生 runtime 型別，修正 Worker／D1 型別缺漏並提供 typecheck 指令。 |
| [Nielsen Norman Group：Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | 首頁先顯示生活圈與三個高頻條件，戶數、狀態、品質等低頻條件收進「更多條件」。 |
| [Nielsen Norman Group：10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | 顯示「目前找到幾案」、已套用條件與可返回的生活圈路徑，降低使用者記憶篩選狀態的負擔。 |
| [Material Design：Chips](https://m2.material.io/go/design-chips) | 區域與常用條件使用可辨識的快速選項；手機寬度不足時才在選項列內橫向滑動，不讓整個頁面溢出。 |

交易處理現在統一採「先以識別碼合併、以較新來源取代舊來源，再排除解約及無效單價」，避免較新解約紀錄被丟棄後，舊成交仍被統計。輸入 CSV 引號未閉合會拒收；民國日期會驗證實際日曆，非閏年的 2/29 不轉為有效日期。這些改動是依資料語義進行的工程修正，並非宣稱官方文件指定某套實作。

少於 10 筆的「少量樣本」提示是本產品的閱讀提醒門檻，不是官方認證或統計信賴區間。樣本期間不同的建案仍可並列，但不能把差異直接解讀成同期區域漲跌。

### 地圖操作與維護（2026-09）

地圖採用清單與地圖並排的操作方式，參考 [樂居地圖](https://www.leju.com.tw/map?area=F238&city=F) 將地區導覽、地圖標籤與詳細資料分開呈現。手機清單可展開或收合，地圖始終保留獨立空間。

- `app/MapExplorer.tsx` 管理畫面內建案、群組清單、待定位清單與地區返回；`app/InteractiveMap.tsx` 只負責地圖與鏡頭。
- 標記顯示成交中位單價或案名，重疊時由 `app/map-layout.ts` 合併為案數標籤。點群組會放大並列出全部成員，同座標案件也能逐一選取。
- 縣市／行政區標記是彙整資料；`region-center`、`catalogue-fallback` 不作個案位置。待定位案件仍可從清單開啟履歷與比較。
- 切換列表與地圖、開關詳細資料會保留搜尋範圍及鏡頭；「回到此區」可回到目前篩選範圍。
- 新增資料仍使用下方既有流程，地圖直接採用處理後的建案與定位資料。增加行政區時同步維護 `data/regions.json` 的中心點；中心點只供區域總覽使用。

### 定位服務設定

未設定 `JUJIAN_GEOCODER_URL` 時只沿用既有 Nominatim 快取；OSMF 公共端點不再是本專案批次定位／POI 蒐集的預設。該公共服務限制一般流量每秒至多 1 次，定期批次工作另限制每分鐘 4 次，且不允許用來系統性下載某區全部 POI。擴區應使用允許此用途的供應商或自架服務，並核對其授權和流量限制。

以下為自架 Nominatim 相容服務的設定範例，服務本身須另行啟動；URL 不可帶密碼：

```powershell
$env:JUJIAN_GEOCODER_URL = 'http://localhost:8080/search'
$env:JUJIAN_GEOCODER_INTERVAL_MS = '15000'
npm run data:update -- --amenities
```

間隔預設 15 秒且至少 1 秒；有效快取命中不發送查詢。設定供應商後，`region-center`、`catalogue-fallback`、無效或空白快取會在明確執行 `--amenities` 時重試；`amenityEnabled` 不阻擋定位，只控制機能分數、最近設施、路線與密度的產生。沒有新資料時，不會聲稱新區域已完成機能評估。

要用既有林口／A7 歷史快取套用新版解約處理並重算全部區域：

```bash
npm run data:snapshot -- --legacy-cache
npm run data:check
npm run typecheck
npm run lint
npm test
```
