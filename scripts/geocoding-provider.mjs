// Public Nominatim is not a bulk POI catalogue. Use a deliberately configured
// self-hosted/provider endpoint, or reuse already stored results offline.
export function geocodingProvider(environment = process.env) {
  const configured = environment.JUJIAN_GEOCODER_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("定位服務需為不含密碼及查詢參數的 HTTP(S) 端點");
  if (url.hostname === "nominatim.openstreetmap.org") throw new Error("批次擴區請使用自架或允許批次查詢的服務；OSMF 公共端點不支援此用途。https://operations.osmfoundation.org/policies/nominatim/");
  const intervalMs = Number(environment.JUJIAN_GEOCODER_INTERVAL_MS || 15000);
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error("定位查詢間隔至少 1000 ms，並應符合所選供應商規範");
  return { url: url.href, intervalMs };
}
