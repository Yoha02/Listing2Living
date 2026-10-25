import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SceneObject, SceneSpec } from '../shared/types.js';
import { createStressTest, suggestRepair, verifyScene } from '../shared/verification.js';

function scene(): SceneSpec {
  return {
    id: 'verification-fixture',
    revision: 1,
    title: 'Test room',
    listingUrl: '',
    units: 'm',
    rooms: [
      {
        id: 'room',
        name: 'Room',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 6],
          [0, 6],
        ],
        floorZ: 0,
        ceilingHeight: 3,
      },
    ],
    walls: [
      {
        id: 'divider',
        start: [0, 3],
        end: [6, 3],
        height: 3,
        thickness: 0.1,
        color: '#fff',
        openings: [
          {
            id: 'door',
            type: 'door',
            offset: 3,
            width: 1.2,
            height: 2.1,
            bottom: 0,
            basis: 'plan',
          },
        ],
      },
    ],
    objects: [],
    stairs: [],
    cameras: [],
    sources: [],
    navigation: {
      start: [3, 0.7],
      targets: [
        { id: 'far', label: 'Far room', point: [3, 5.2] },
        { id: 'near', label: 'Near room', point: [1, 1] },
      ],
      clearance: 0.65,
    },
    notes: [],
  };
}
function furniture(
  id: string,
  x: number,
  y: number,
  width = 0.8,
  depth = 0.5,
  rotation = 0,
): SceneObject {
  return {
    id,
    name: id,
    kind: 'desk',
    position: [x, y, 0.4],
    dimensions: [width, depth, 0.8],
    rotation,
    color: '#999',
    movable: true,
    basis: 'user',
  };
}

test('unobstructed scene has actual clear routes through the opening', () => {
  const input = scene(),
    result = verifyScene(input);
  assert.equal(result.passed, true, JSON.stringify(result.issues));
  assert.equal(result.routes.length, 2);
  for (const route of result.routes) {
    assert.equal(route.passed, true);
    assert.deepEqual(route.points[0], input.navigation.start);
    assert.deepEqual(
      route.points.at(-1),
      input.navigation.targets.find((t) => t.id === route.targetId)!.point,
    );
    assert.ok(route.length > 0);
  }
});

test('rotated obstacle blocks the doorway with its oriented footprint', () => {
  const input = scene();
  input.objects.push(furniture('rotated-barrier', 3, 3, 0.3, 1.15, Math.PI / 2));
  const result = verifyScene(input);
  assert.equal(result.routes.find((r) => r.targetId === 'far')!.passed, false);
  assert.ok(result.issues.some((i) => i.type === 'route'));
});

test('a blocked start is reported, not snapped through an obstacle', () => {
  const input = createStressTest(scene()),
    result = verifyScene(input);
  assert.ok(input.notes.some((note) => note.includes('Deliberate stress test')));
  assert.equal(result.passed, false);
  assert.ok(result.routes.every((route) => !route.passed && route.points.length === 0));
});

test('repair clears an intentional doorway obstruction without changing sizes or fixed/pinned items', () => {
  const input = scene();
  input.objects.push(furniture('blocker', 3, 3, 1.1, 0.5));
  input.objects.push({ ...furniture('fixed-cabinet', 0.7, 5), movable: false, kind: 'cabinet' });
  input.objects.push({ ...furniture('pinned-sofa', 5, 4.8), pinned: true, kind: 'sofa' });
  const original = structuredClone(input),
    repaired = suggestRepair(input);
  assert.equal(verifyScene(input).passed, false);
  assert.equal(verifyScene(repaired.scene).passed, true, repaired.summary);
  assert.ok(repaired.changes.length > 0);
  assert.deepEqual(input, original, 'repair does not mutate caller state');
  for (const id of ['fixed-cabinet', 'pinned-sofa'])
    assert.deepEqual(
      repaired.scene.objects.find((o) => o.id === id),
      original.objects.find((o) => o.id === id),
    );
  for (const object of repaired.scene.objects)
    assert.deepEqual(
      object.dimensions,
      original.objects.find((o) => o.id === object.id)!.dimensions,
    );
});

test('out-of-bounds corners and rotated furniture overlaps are failures', () => {
  const input = scene();
  input.objects.push(furniture('outside', 0.1, 1, 1, 1, Math.PI / 4));
  input.objects.push(furniture('first', 4, 1.5, 1.2, 0.5, Math.PI / 4));
  input.objects.push(furniture('second', 4.2, 1.6, 1.2, 0.5, -Math.PI / 4));
  const result = verifyScene(input);
  assert.ok(result.issues.some((i) => i.type === 'boundary' && i.objectIds.includes('outside')));
  assert.ok(
    result.issues.some(
      (i) =>
        i.type === 'collision' && i.objectIds.includes('first') && i.objectIds.includes('second'),
    ),
  );
});

test('rugs under furniture and tucked chairs are permitted', () => {
  const input = scene();
  input.objects.push(furniture('desk', 4.5, 1.5));
  input.objects.push({
    ...furniture('rug', 4.5, 1.5, 1.5, 1.5),
    kind: 'rug',
    position: [4.5, 1.5, 0.01],
    dimensions: [1.5, 1.5, 0.02],
  });
  input.objects.push({ ...furniture('chair', 4.5, 1.7, 0.45, 0.45), kind: 'chair' });
  assert.equal(verifyScene(input).passed, true);
});

test('a pinned blocker remains unchanged and failure stays explicit', () => {
  const input = createStressTest(scene());
  input.objects[0].pinned = true;
  const repaired = suggestRepair(input);
  assert.deepEqual(repaired.scene.objects, input.objects);
  assert.equal(repaired.changes.length, 0);
  assert.equal(verifyScene(repaired.scene).passed, false);
});

test('Brannan baseline passes, deliberate obstruction fails, and repair restores all routes', () => {
  const input = JSON.parse(
    readFileSync(new URL('../shared/brannan.json', import.meta.url), 'utf8'),
  ) as SceneSpec;
  const baseline = verifyScene(input);
  assert.equal(baseline.passed, true, JSON.stringify(baseline.issues));
  const blocked = createStressTest(input);
  assert.equal(verifyScene(blocked).passed, false);
  const repaired = suggestRepair(blocked);
  assert.equal(verifyScene(repaired.scene).passed, true, repaired.summary);
  assert.equal(repaired.scene.objects.length, blocked.objects.length);
  for (const original of input.objects.filter((o) => !o.movable))
    assert.deepEqual(
      repaired.scene.objects.find((o) => o.id === original.id),
      original,
    );
});

test('Brannan stair route approaches the lower window-side end, not the upper landing', () => {
  const input = JSON.parse(
    readFileSync(new URL('../shared/brannan.json', import.meta.url), 'utf8'),
  ) as SceneSpec;
  const stair = input.stairs.find((s) => s.id === 'main-stair')!;
  const target = input.navigation.targets.find((t) => t.id === 'stair-foot')!.point;
  assert.ok(stair.bottom && stair.top);
  const distance = (point: number[]) => Math.hypot(target[0] - point[0], target[1] - point[1]);
  assert.ok(distance(stair.bottom) < 1);
  assert.ok(distance(stair.bottom) < distance(stair.top));
  assert.ok(stair.bottom[1] > stair.top[1], 'stair ascends southward toward the kitchen');
  assert.ok(
    target[0] + input.navigation.clearance / 2 < stair.position[0] - stair.dimensions[0] / 2,
  );
});
