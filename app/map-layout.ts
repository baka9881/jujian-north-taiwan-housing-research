export type ScreenPoint = { id: string; x: number; y: number };
export type ScreenGroup = { ids: string[]; x: number; y: number };

// Merge overlapping label rectangles, including new collisions caused by a
// merged centroid. Order is stable so selecting a project does not reshuffle it.
export function groupMapLabels(points: ScreenPoint[], width = 128, height = 48): ScreenGroup[] {
  const groups = [...points].sort((a, b) => a.id.localeCompare(b.id)).map((point) => ({ ids: [point.id], x: point.x, y: point.y }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i], b = groups[j];
        if (Math.abs(a.x - b.x) >= width || Math.abs(a.y - b.y) >= height) continue;
        const size = a.ids.length + b.ids.length;
        groups[i] = { ids: [...a.ids, ...b.ids], x: (a.x * a.ids.length + b.x * b.ids.length) / size, y: (a.y * a.ids.length + b.y * b.ids.length) / size };
        groups.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return groups;
}
