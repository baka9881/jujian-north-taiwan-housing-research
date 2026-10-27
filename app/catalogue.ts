export type Geography = { city: string; district: string; region: string };
export function paginateProjects<T>(projects: T[], requestedPage: number, pageSize = 50) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("無效的每頁筆數");
  const pageCount = Math.max(1, Math.ceil(projects.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return { page, pageCount, items: projects.slice((page - 1) * pageSize, page * pageSize) };
}
export function matchesGeography(project: Geography, filters: Geography) {
  return (filters.city === "全部" || project.city === filters.city) &&
    (filters.region === "全部" || project.region === filters.region) &&
    (filters.district === "全部" || project.district === filters.district);
}
/** Keep an active subregion when drilling into one of its city's districts. */
export function regionAfterMapNavigation(region: string, city: string, district: string, regions: ReadonlyArray<{ label: string; city: string }>) {
  return district !== "全部" && regions.some((item) => item.label === region && item.city === city) ? region : "全部";
}
export function toggleComparison(ids: string[], id: string, maximum = 3): string[] {
  if (ids.includes(id)) return ids.filter((current) => current !== id);
  return ids.length < maximum ? [...ids, id] : ids;
}
export function comparableProjects<T extends Geography & { price: { median: number } | null }>(projects: T[], project: Geography): T[] {
  return projects.filter((item) => item.city === project.city && item.district === project.district && item.region === project.region && item.price !== null);
}

export function priceSampleLabel(price: { count: number; earliestDate?: string | null; latestDate: string | null } | null) {
  if (!price) return "尚無可核對的成交樣本";
  const range = price.earliestDate && price.latestDate
    ? `${price.earliestDate} ～ ${price.latestDate}`
    : price.latestDate ? `最早日期待補；最新 ${price.latestDate}` : "交易期間待補";
  return `${price.count} 筆 · ${range}${price.count < 10 ? " · 少量樣本" : ""}`;
}
