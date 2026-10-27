import { stableHash } from "./data-utils.mjs";

// Releases must be passed oldest first, current release last. A cancellation
// replaces the old transaction before eligibility is evaluated.
export function latestTransactions(rows, { serial = "編號", cancellation = "解約情形", price = "單價元平方公尺" } = {}) {
  const latest = new Map();
  for (const row of rows) {
    const id = String(row[serial] || "").trim();
    latest.set(id || `anonymous:${stableHash(JSON.stringify(row), 64)}`, row);
  }
  return [...latest.values()].filter((row) => !String(row[cancellation] || "").trim() && Number.isFinite(Number(row[price])) && Number(row[price]) > 0);
}
