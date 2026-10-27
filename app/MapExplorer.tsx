"use client";

import { useRef, useState, type ReactNode } from "react";
import InteractiveMap, { type MapCamera, type MapViewport } from "./InteractiveMap";

type ExplorerProject = {
  id: string; name: string; city: string; district: string; region: string;
  address: string; builder: string; households: number; firstRegistrationDate: string | null;
  latitude: number; longitude: number; price: { median: number; count: number } | null;
  amenity: { score: number | null; location: { method: string; label: string } };
};
type Props = {
  pois: NonNullable<Parameters<typeof InteractiveMap>[0]["pois"]>;
  visibleAmenityCategories: NonNullable<Parameters<typeof InteractiveMap>[0]["visibleAmenityCategories"]>;
  projects: ExplorerProject[]; scopeKey: string; city: string; district: string; region: string;
  districtCenters: Record<string, number[]>;
  initialCamera?: MapCamera; onCameraChange: (camera: MapCamera) => void;
  selectedId: string | null; preview: ReactNode;
  onSelect: (id: string) => void; onClosePreview: () => void;
  onGeography: (city: string, district: string) => void;
  onOpenFilters: () => void; tools: ReactNode;
};
function located(project: ExplorerProject) {
  return Number.isFinite(project.latitude) && Number.isFinite(project.longitude) && !["region-center", "catalogue-fallback"].includes(project.amenity.location.method);
}

export default function MapExplorer({ projects, scopeKey, city, district, region, districtCenters, initialCamera, onCameraChange, selectedId, preview, onSelect, onClosePreview, onGeography, onOpenFilters, tools, pois, visibleAmenityCategories }: Props) {
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [pendingLocations, setPendingLocations] = useState(() => projects.length > 0 && !projects.some(located));
  const [expanded, setExpanded] = useState(() => Boolean(selectedId));
  const [resetSequence, setResetSequence] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number; zoomIn?: boolean } | null>(null);
  const [limit, setLimit] = useState(30);
  const listRef = useRef<HTMLDivElement>(null);
  const mapProjects = projects.filter(located);
  const unlocated = projects.filter((p) => !located(p));
  const visibleIds = new Set(viewport?.ids ?? mapProjects.map((p) => p.id));
  const clusterSet = clusterIds ? new Set(clusterIds) : null;
  const results = pendingLocations ? unlocated : clusterSet ? mapProjects.filter((p) => clusterSet.has(p.id)) : mapProjects.filter((p) => visibleIds.has(p.id));
  const resultMode = selectedId ? "selected" : pendingLocations ? "pending" : clusterIds ? "cluster" : "viewport";
  const browseCities = projects.length > 0 && !pendingLocations && !clusterIds && city === "全部" && region === "全部" && viewport?.tier === "area";
  const browseDistricts = projects.length > 0 && !pendingLocations && !clusterIds && !browseCities && district === "全部" && viewport?.tier === "district";
  const areaCounts = new Map<string, { city: string; district: string; total: number; located: number }>();
  for (const project of projects) {
    const key = browseCities ? project.city : `${project.city}::${project.district}`;
    const area = areaCounts.get(key) ?? { city: project.city, district: project.district, total: 0, located: 0 };
    area.total += 1;
    if (located(project)) area.located += 1;
    areaCounts.set(key, area);
  }
  const areas = [...areaCounts.values()];
  const title = pendingLocations ? "位置待確認" : clusterIds ? `附近 ${results.length} 筆歷史建案` : browseCities ? "先選擇縣市" : browseDistricts ? "再選擇行政區" : "地圖範圍內的歷史建案";

  function select(id: string, fromList = false) {
    setExpanded(true);
    listRef.current?.scrollTo({ top: 0 });
    setFocusRequest((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1, zoomIn: fromList }));
    onSelect(id);
  }
  function showResults(pending: boolean) {
    onClosePreview(); setPendingLocations(pending); setClusterIds(null); setLimit(30); setExpanded(true);
  }
  return (
    <section className="map-explorer" aria-label="歷史建案地圖">
      <nav className="map-context" aria-label="地圖地區導覽">
        <div><button onClick={() => onGeography("全部", "全部")}>全部地區</button>{city !== "全部" && <><span>›</span><button onClick={() => onGeography(city, "全部")}>{city}</button></>}{district !== "全部" && <><span>›</span><strong>{district}</strong></>}{region !== "全部" && <><span>›</span><strong>{region}</strong></>}</div>
        <button className="map-reset-view" onClick={() => { onClosePreview(); setClusterIds(null); setPendingLocations(false); setLimit(30); setFocusRequest(null); setResetSequence((n) => n + 1); }}>回到所選地區</button>
      </nav>
      <div className={`map-explorer-body ${expanded ? "results-expanded" : ""} ${selectedId ? "has-selection" : ""}`}>
        <aside className="map-results" aria-label="地圖建案清單">
          <button className="map-results-toggle" aria-expanded={expanded} aria-controls="map-results-content" onClick={() => setExpanded(!expanded)}><span>{selectedId ? projects.find((p) => p.id === selectedId)?.name : title}{!selectedId && !clusterIds && !browseCities && !browseDistricts && <b>{results.length} 案</b>}</span><span>{expanded ? "收合 ⌄" : "展開 ⌃"}</span></button>
          <div className="map-results-content" id="map-results-content" ref={listRef}>
            {selectedId && preview ? <div className="map-selected-result"><button className="map-results-back" onClick={onClosePreview}>← 返回地圖清單</button>{preview}</div> : <>
              <header className="map-results-heading"><h1>{title}</h1><p>{browseCities || browseDistricts ? `共 ${projects.length.toLocaleString("zh-TW")} 筆歷史備查資料。選擇地區後查看建案，並非在售清單。` : pendingLocations ? "這些建案沒有可用的道路參考點，仍可查看資料。" : clusterIds ? "選擇一筆建案查看資料；這些資料並非在售清單。" : "移動地圖可更新清單；點選標記或清單查看建案。這些資料並非在售清單。"}</p></header>
              <div className="map-result-tabs" aria-label="目前搜尋範圍的定位資料分類"><button aria-pressed={!pendingLocations} onClick={() => showResults(false)}>有參考位置 <b>{mapProjects.length}</b></button><button aria-pressed={pendingLocations} onClick={() => showResults(true)}>位置待確認 <b>{unlocated.length}</b></button></div>
              {clusterIds && <button className="map-results-back" onClick={() => { setClusterIds(null); setLimit(30); }}>← 返回地圖範圍清單</button>}
              {(browseCities || browseDistricts) ? <div className="map-area-list">{areas.map((area) => <button key={`${area.city}:${browseCities ? "" : area.district}`} onClick={() => { setExpanded(false); onGeography(area.city, browseCities ? "全部" : area.district); }}><span>{browseCities ? area.city : area.district}{!browseCities && city === "全部" && <small>{area.city}</small>}</span><span className="map-area-counts"><span>參考點 {area.located.toLocaleString("zh-TW")}</span><span>全部 {area.total.toLocaleString("zh-TW")} 案 ›</span></span></button>)}</div> : <>
                {!results.length && <div className="map-results-empty"><strong>{!projects.length ? "沒有符合條件的建案" : pendingLocations ? "這個範圍的建案都有參考位置" : "這個畫面沒有建案參考點"}</strong><p>{!projects.length ? "試試調整搜尋條件或選擇其他地區。" : pendingLocations ? "可切換有參考位置的建案繼續瀏覽。" : unlocated.length ? `此範圍另有 ${unlocated.length} 案位置待確認，可從上方清單查看。` : "試試縮小地圖，或調整搜尋條件。"}</p>{projects.length && pendingLocations ? <button onClick={() => showResults(false)}>查看有參考位置的建案</button> : unlocated.length && !pendingLocations ? <button onClick={() => showResults(true)}>查看位置待確認的建案</button> : <button onClick={onOpenFilters}>調整搜尋條件</button>}</div>}
                <div className="map-result-rows" key={resultMode}>{results.slice(0, limit).map((project) => <button className="map-result-row" key={project.id} onClick={() => select(project.id, !pendingLocations)}><span className="map-row-location">{project.city}・{project.district}</span><strong>{project.name}</strong><span className="map-row-address">{project.address || "地址待補"}</span><span className={`map-row-price ${project.price ? "" : "missing"}`}>{project.price ? `${project.price.median} 萬／坪` : "成交資料待補"}<small>{project.price ? `歷史成交 ${project.price.count} 筆` : ""}</small></span><span className="map-row-meta">{project.households || "—"} 戶 · {pendingLocations ? "位置待核對" : "道路／路口參考點"}<span>查看資料 ›</span></span></button>)}</div>
                {results.length > limit && <button className="map-more-results" onClick={() => setLimit((n) => n + 30)}>再顯示 {Math.min(30, results.length - limit)} 案</button>}
              </>}
            </>}
          </div>
        </aside>
        <section className="map-stage" aria-label="建案位置地圖">
          <InteractiveMap projects={projects} activeId={selectedId || ""} districtCenters={districtCenters} scopeKey={scopeKey} initialCamera={initialCamera} resetSequence={resetSequence} focusRequest={focusRequest} pois={pois} visibleAmenityCategories={visibleAmenityCategories}
            onSelect={(id) => select(id)} onCitySelect={(nextCity) => onGeography(nextCity, "全部")} onDistrictSelect={onGeography}
            onClusterSelect={(ids) => { onClosePreview(); setPendingLocations(false); setClusterIds(ids); setLimit(30); setExpanded(true); listRef.current?.scrollTo({ top: 0 }); }}
            onUserNavigate={() => { setClusterIds(null); setLimit(30); }}
            onViewportChange={(next) => { onCameraChange(next.camera); setViewport(next); }} />
          {tools}
          <div className="map-scale-note">{viewport?.tier === "area" ? "選擇縣市" : viewport?.tier === "district" ? "選擇行政區" : "參考位置 · 歷史成交價（萬／坪）"}</div>
        </section>
      </div>
    </section>
  );
}
