import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMapLabels } from '../app/map-layout.ts';

test('co-located buildings remain individually selectable through a complete group', () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ id: `project-${i}`, x: 250, y: 400 }));
  const groups = groupMapLabels(points);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].ids), new Set(points.map(p => p.id)));
  assert.equal(groups[0].x, 250);
  assert.equal(groups[0].y, 400);
});

test('labels have no overlap after merging, with no lost or duplicate projects', () => {
  const points = Array.from({ length: 300 }, (_, i) => ({ id: `project-${i}`, x: (i * 73) % 1080, y: (i * 127) % 720 }));
  const groups = groupMapLabels(points);
  const ids = groups.flatMap(g => g.ids);
  assert.equal(ids.length, points.length);
  assert.deepEqual(new Set(ids), new Set(points.map(p => p.id)));
  groups.forEach((a, i) => groups.slice(i + 1).forEach(b => assert.ok(Math.abs(a.x - b.x) >= 128 || Math.abs(a.y - b.y) >= 48)));
  assert.deepEqual(groupMapLabels([...points].reverse()), groups);
});

test('well-separated buildings keep their exact coordinate and singleton label', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 240, y: 100 }, { id: 'c', x: 100, y: 160 }];
  assert.deepEqual(groupMapLabels(points), points.map(p => ({ ids: [p.id], x: p.x, y: p.y })));
  assert.deepEqual(groupMapLabels([]), []);
});
