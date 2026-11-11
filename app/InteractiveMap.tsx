"use client";

import { useEffect, useRef, useState } from "react";
import { groupMapLabels } from "./map-layout";

type MapProject = {
  id: string; name: string; region: string; city: string; district: string;
  price: { median: number } | null;
  firstRegistrationDate: string | null;
  amenity?: { location: { method: string; label?: string } };
  latitude?: number; longitude?: number;
};
type AmenityCategory = "convenience" | "pxmart" | "costco" | "station" | "school" | "medical" | "market" | "park" | "pharmacy" | "parking";
type AmenityPoi = { id: string; name: string; category: AmenityCategory; latitude: number; longitude: number };
export type MapCamera = { center: [number, number]; zoom: number };
export type MapTier = "area" | "district" | "project";
export type MapViewport = { ids: string[]; camera: MapCamera; tier: MapTier };
type Props = {
  projects: MapProject[]; activeId: string;
  onSelect?: (id: string) => void;
  onClusterSelect?: (ids: string[]) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  onUserNavigate?: () => void;
  onCitySelect?: (city: string) => void;
  onDistrictSelect?: (city: string, district: string) => void;
  districtCenters?: Record<string, number[]>;
  scopeKey?: string;
  initialCamera?: MapCamera;
  focusRequest?: { id: string; sequence: number; zoomIn?: boolean } | null;
  resetSequence?: number;
  compact?: boolean; pois?: AmenityPoi[]; visibleAmenityCategories?: AmenityCategory[];
};
const emptyCenters: Record<string, number[]> = {};
const emptyPois: AmenityPoi[] = [];
const emptyCategories: AmenityCategory[] = [];
const amenitySymbols: Record<AmenityCategory, string> = { convenience: "商", pxmart: "全", costco: "好", station: "站", school: "學", medical: "醫", market: "市", park: "園", pharmacy: "藥", parking: "停" };
const overviewCenter: [number, number] = [24.96, 121.28];

function hasIndividualLocation(project: MapProject) {
  const method = project.amenity?.location.method;
  return Number.isFinite(project.latitude) && Number.isFinite(project.longitude) && method !== "region-center" && method !== "catalogue-fallback";
}
function districtKey(project: MapProject) { return `${project.city}::${project.district}`; }
function projectPoint(project: MapProject, centers: Record<string, number[]>): [number, number] {
  if (hasIndividualLocation(project)) return [project.latitude!, project.longitude!];
  const point = centers[districtKey(project)];
  if (point?.length === 2 && point.every(Number.isFinite)) return [point[0], point[1]];
  throw new Error(`缺少 ${districtKey(project)} 的行政區中心`);
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

export default function InteractiveMap({
  projects, activeId, onSelect, onClusterSelect, onViewportChange, onUserNavigate, onCitySelect, onDistrictSelect,
  districtCenters = emptyCenters, scopeKey = "", initialCamera, focusRequest, resetSequence = 0,
  compact = false, pois = emptyPois, visibleAmenityCategories = emptyCategories,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const poiLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const callbacksRef = useRef({ onSelect, onClusterSelect, onViewportChange, onUserNavigate, onCitySelect, onDistrictSelect });
  const initialRef = useRef({ initialCamera, scopeKey });
  const fittedScopeRef = useRef<string | null>(null);
  const resetRef = useRef(resetSequence);
  const renderRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onSelect, onClusterSelect, onViewportChange, onUserNavigate, onCitySelect, onDistrictSelect };
  }, [onSelect, onClusterSelect, onViewportChange, onUserNavigate, onCitySelect, onDistrictSelect]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let removeNavigationListeners: (() => void) | undefined;
    void import("leaflet").then((leaflet) => {
      if (cancelled || !containerRef.current) return;
      const map = leaflet.map(containerRef.current, {
        zoomControl: false, attributionControl: false, scrollWheelZoom: true,
        inertia: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
        minZoom: 8, maxZoom: 19, wheelPxPerZoomLevel: 120,
      });
      const camera = initialRef.current.initialCamera;
      map.setView(camera?.center || overviewCenter, camera?.zoom ?? 10);
      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, updateWhenIdle: true, keepBuffer: 3, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      if (!compact) leaflet.control.zoom({ position: "bottomright" }).addTo(map);
      leaflet.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
      // Leaflet also emits move/zoom events for programmatic camera changes.
      // Listen to the user's gestures instead so clicking a group can zoom and
      // keep its results open until the user moves the map themselves.
      const element = containerRef.current;
      const navigate = () => callbacksRef.current.onUserNavigate?.();
      const zoomControlClick = (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest(".leaflet-control-zoom")) navigate();
      };
      const keyboardNavigation = (event: KeyboardEvent) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "=", "_"].includes(event.key)) navigate();
      };
      const touchNavigation = (event: TouchEvent) => { if (event.touches.length > 1) navigate(); };
      map.on("dragstart", navigate);
      element.addEventListener("wheel", navigate, { passive: true });
      element.addEventListener("dblclick", navigate);
      element.addEventListener("click", zoomControlClick, true);
      element.addEventListener("keydown", keyboardNavigation);
      element.addEventListener("touchstart", touchNavigation, { passive: true });
      removeNavigationListeners = () => {
        map.off("dragstart", navigate);
        element.removeEventListener("wheel", navigate);
        element.removeEventListener("dblclick", navigate);
        element.removeEventListener("click", zoomControlClick, true);
        element.removeEventListener("keydown", keyboardNavigation);
        element.removeEventListener("touchstart", touchNavigation);
      };
      leafletRef.current = leaflet;
      mapRef.current = map;
      markerLayerRef.current = leaflet.layerGroup().addTo(map);
      poiLayerRef.current = leaflet.layerGroup().addTo(map);
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize({ animate: false, pan: true });
        renderRef.current?.();
      });
      resizeObserver.observe(containerRef.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeNavigationListeners?.();
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, [compact]);

  useEffect(() => {
    const leaflet = leafletRef.current, map = mapRef.current, layer = markerLayerRef.current;
    if (!ready || !leaflet || !map || !layer) return;
    const located = projects.filter(hasIndividualLocation);
    const oneDistrict = projects.length > 0 && new Set(projects.map(districtKey)).size === 1;
    const oneCity = projects.length > 0 && new Set(projects.map((p) => p.city)).size === 1;

    const render = () => {
      layer.clearLayers();
      const tier: MapTier = compact || oneDistrict || map.getZoom() >= 14 ? "project" : oneCity || map.getZoom() >= 11 ? "district" : "area";
      containerRef.current?.setAttribute("data-tier", tier);
      const viewBounds = map.getBounds();
      const visibleIds = located.filter((project) => viewBounds.contains(projectPoint(project, districtCenters))).map((p) => p.id);
      if (!compact) {
        const center = map.getCenter();
        callbacksRef.current.onViewportChange?.({ ids: visibleIds, camera: { center: [center.lat, center.lng], zoom: map.getZoom() }, tier });
      }
      const addMarker = (point: [number, number], html: string, className: string, width: number, label: string, click: () => void, selected = false) => {
        const marker = leaflet.marker(point, {
          icon: leaflet.divIcon({ className, html, iconSize: [width, 36], iconAnchor: [width / 2, 36] }),
          keyboard: true, riseOnHover: true, zIndexOffset: selected ? 1000 : 0,
        }).addTo(layer);
        marker.on("click", click);
        marker.getElement()?.setAttribute("aria-label", label);
        marker.getElement()?.setAttribute("title", label);
      };
      if (tier === "project") {
        // Only actual reference coordinates become project pins. Missing locations
        // stay available in the results panel, never as a pretend project pin.
        const byId = new Map(located.map((p) => [p.id, p]));
        const points = located.filter((p) => viewBounds.pad(.12).contains(projectPoint(p, districtCenters))).map((p) => {
          const point = map.latLngToContainerPoint(projectPoint(p, districtCenters));
          return { id: p.id, x: point.x, y: point.y };
        });
        groupMapLabels(points).forEach((group) => {
          const items = group.ids.map((id) => byId.get(id)!);
          const selected = group.ids.includes(activeId);
          if (items.length === 1) {
            const project = items[0];
            const caption = project.price ? `${project.price.median} 萬／坪` : project.name;
            const label = `查看 ${project.name}，${project.price ? caption : "成交資料待補"}，${project.amenity?.location.label || "道路參考位置"}`;
            addMarker(projectPoint(project, districtCenters), `<span class="map-pin ${selected ? "is-selected" : ""} ${project.price ? "" : "no-price"}">${escapeHtml(caption)}</span>`, "map-pin-host", 120, label, () => callbacksRef.current.onSelect?.(project.id), selected);
          } else {
            // Geographic centroid is stable and independent of screen offsets.
            const center: [number, number] = [
              items.reduce((sum, p) => sum + p.latitude!, 0) / items.length,
              items.reduce((sum, p) => sum + p.longitude!, 0) / items.length,
            ];
            addMarker(center, `<span class="map-pin map-group-pin ${selected ? "is-selected" : ""}"><b>${items.length}</b> 案 <span aria-hidden="true">＋</span></span>`, "map-pin-host map-group-host", 76, `查看附近 ${items.length} 個建案`, () => {
              map.setView(center, Math.min(map.getZoom() + 2, 19), { animate: false });
              callbacksRef.current.onClusterSelect?.(group.ids);
            }, selected);
          }
        });
      } else {
        const groups = new Map<string, MapProject[]>();
        projects.forEach((p) => { const key = tier === "area" ? p.city : districtKey(p); groups.set(key, [...(groups.get(key) || []), p]); });
        const summaries = [...groups.entries()].map(([id, items]) => {
          const first = items[0];
          const points = items.map((p) => projectPoint(p, districtCenters));
          const fallback = districtCenters[districtKey(first)];
          const point: [number, number] = tier === "district" && fallback
            ? [fallback[0], fallback[1]]
            : [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
          const name = tier === "area" ? first.city : first.district;
          const screen = map.latLngToContainerPoint(point);
          return { id, items, first, point, name, x: screen.x, y: screen.y };
        });
        const byId = new Map(summaries.map((summary) => [summary.id, summary]));
        groupMapLabels(summaries, 124, 44).forEach((group) => {
          const members = group.ids.map((id) => byId.get(id)!);
          const first = members[0];
          const point: [number, number] = [members.reduce((sum, m) => sum + m.point[0], 0) / members.length, members.reduce((sum, m) => sum + m.point[1], 0) / members.length];
          const name = members.length === 1 ? first.name : `${members.length} 個${tier === "area" ? "縣市" : "行政區"}`;
          const count = members.reduce((sum, m) => sum + m.items.length, 0);
          addMarker(point, `<span class="map-region-pin"><b>${escapeHtml(name)}</b><small>${count} 案</small></span>`, "map-pin-host map-region-host", 116, `${members.length === 1 ? "選擇" : "放大查看"} ${members.map((m) => m.first.city + (tier === "district" ? m.first.district : "")).join("、")}，${count} 個建案`, () => {
            if (members.length > 1) map.setView(point, Math.min(map.getZoom() + 1, 19), { animate: false });
            else if (tier === "area") callbacksRef.current.onCitySelect?.(first.first.city);
            else callbacksRef.current.onDistrictSelect?.(first.first.city, first.first.district);
          });
        });
      }
    };
    renderRef.current = render;
    render();
    map.on("moveend zoomend", render);
    return () => { map.off("moveend zoomend", render); renderRef.current = null; };
  }, [activeId, compact, districtCenters, projects, ready]);

  useEffect(() => {
    const map = mapRef.current, leaflet = leafletRef.current;
    if (!ready || !map || !leaflet) return;
    if (fittedScopeRef.current === scopeKey && resetRef.current === resetSequence) return;
    const restore = fittedScopeRef.current === null && initialRef.current.initialCamera && initialRef.current.scopeKey === scopeKey;
    fittedScopeRef.current = scopeKey;
    resetRef.current = resetSequence;
    if (restore) { renderRef.current?.(); return; }
    if (!projects.length) { renderRef.current?.(); return; }
    const oneDistrict = new Set(projects.map(districtKey)).size === 1;
    const located = projects.filter(hasIndividualLocation);
    const fitProjects = oneDistrict && located.length ? located : projects;
    const bounds = leaflet.latLngBounds(fitProjects.map((p) => projectPoint(p, districtCenters)));
    map.fitBounds(bounds, { padding: compact ? [32, 32] : [70, 64], maxZoom: compact ? 15 : oneDistrict ? 16 : 12, animate: false });
    renderRef.current?.();
  }, [projects, ready, compact, districtCenters, scopeKey, resetSequence]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusRequest) return;
    const project = projects.find((p) => p.id === focusRequest.id);
    if (project && hasIndividualLocation(project)) map.setView(projectPoint(project, districtCenters), focusRequest.zoomIn ? Math.max(16, map.getZoom()) : map.getZoom(), { animate: false });
  }, [ready, focusRequest, projects, districtCenters]);

  useEffect(() => {
    const leaflet = leafletRef.current, layer = poiLayerRef.current;
    if (!ready || !leaflet || !layer) return;
    layer.clearLayers();
    pois.filter((poi) => visibleAmenityCategories.includes(poi.category)).forEach((poi) => {
      const marker = leaflet.marker([poi.latitude, poi.longitude], {
        icon: leaflet.divIcon({ className: "amenity-poi-host", html: `<span class="amenity-poi-marker poi-${poi.category}">${amenitySymbols[poi.category]}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        keyboard: false, zIndexOffset: -200,
      }).addTo(layer);
      marker.bindTooltip(escapeHtml(poi.name), { direction: "top" });
    });
  }, [pois, ready, visibleAmenityCategories]);

  return (
    <div className={`interactive-map ${compact ? "compact" : ""}`} data-map-engine="leaflet" lang="zh-Hant-TW">
      <div className="interactive-map-canvas" ref={containerRef} role="application" aria-label="建案地圖，可拖曳移動、使用加減按鈕縮放" />
      {failed && <p className="map-load-message" role="alert">地圖暫時無法載入，仍可從建案清單查看資料。</p>}
    </div>
  );
}
