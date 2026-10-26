import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SceneObject, SceneSpec } from '../shared/types.js';
import { objectFloorZ, suggestRepair, verifyScene } from '../shared/verification.js';

function twoFloors(): SceneSpec {
  return {
    id: 'two-floor-test',
    revision: 1,
    title: 'Two floors',
    listingUrl: '',
    units: 'm',
    rooms: [
      {
        id: 'ground',
        name: 'Ground',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 6],
          [0, 6],
        ],
        floorZ: 0,
        ceilingHeight: 2.85,
      },
      {
        id: 'upper',
        name: 'Upper',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 6],
          [0, 6],
        ],
        floorZ: 2.85,
        ceilingHeight: 2.65,
      },
    ],
    walls: [
      {
        id: 'upper-divider',
        start: [0, 3],
        end: [6, 3],
        floorZ: 2.85,
        height: 2.65,
        thickness: 0.1,
        color: '#fff',
        openings: [
          {
            id: 'upper-door',
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
      targets: [{ id: 'far', label: 'Ground far', point: [3, 5.2] }],
      clearance: 0.65,
      levels: [
        {
          floorZ: 2.85,
          start: [3, 0.7],
          targets: [{ id: 'far', label: 'Upper far', point: [3, 5.2] }],
        },
      ],
    },
    notes: [],
  };
}
function object(id: string, x: number, y: number, floorZ: number): SceneObject {
  return {
    id,
    name: id,
    kind: 'desk',
    position: [x, y, floorZ + 0.4],
    dimensions: [0.8, 0.5, 0.8],
    rotation: 0,
    color: '#999999',
    movable: true,
    basis: 'user',
  };
}

test('Brannan verifies three ground destinations and six independent upper destinations', () => {
  const scene = JSON.parse(
    readFileSync(new URL('../shared/brannan.json', import.meta.url), 'utf8'),
  ) as SceneSpec;
  const checked = verifyScene(scene);
  assert.equal(checked.passed, true, JSON.stringify(checked.issues));
  assert.equal(checked.routes.filter((route) => route.floorZ === 0).length, 3);
  assert.equal(checked.routes.filter((route) => route.floorZ === 2.85).length, 6);
  for (const route of checked.routes.filter((route) => route.floorZ === 2.85))
    assert.deepEqual(route.points[0], scene.navigation.levels![0].start);
});

test('same XY furniture on different floors does not collide or inherit the other floor wall', () => {
  const scene = twoFloors();
  scene.objects.push(
    object('downstairs', 1, 3, 0),
    object('upstairs', 1, 1, 2.85),
    object('same-xy', 1, 1, 0),
  );
  const checked = verifyScene(scene);
  assert.equal(checked.passed, true, JSON.stringify(checked.issues));
  assert.deepEqual(
    checked.routes.map((r) => r.floorZ),
    [0, 2.85],
  );
});
test('upper furniture intersects upper walls while ground furniture does not', () => {
  const scene = twoFloors();
  scene.objects.push(object('downstairs', 1, 3, 0), object('upstairs', 1, 3, 2.85));
  const checked = verifyScene(scene);
  assert.ok(
    checked.issues.some(
      (i) =>
        i.type === 'collision' &&
        i.objectIds.includes('upstairs') &&
        i.objectIds.includes('upper-divider'),
    ),
  );
  assert.ok(!checked.issues.some((i) => i.objectIds.includes('downstairs')));
});
test('upper floor bounds are independent of a larger floor below', () => {
  const scene = twoFloors();
  scene.rooms[1].polygon = [
    [0, 0],
    [4, 0],
    [4, 6],
    [0, 6],
  ];
  scene.objects.push(object('outside-upper', 4.5, 1, 2.85), object('inside-ground', 4.5, 1, 0));
  const checked = verifyScene(scene);
  assert.ok(
    checked.issues.some((i) => i.type === 'boundary' && i.objectIds.includes('outside-upper')),
  );
  assert.ok(
    !checked.issues.some((i) => i.type === 'boundary' && i.objectIds.includes('inside-ground')),
  );
});
test('an upper doorway obstruction fails only the upper route and repair retains its floor', () => {
  const scene = twoFloors();
  scene.objects.push({ ...object('upper-blocker', 3, 3, 2.85), dimensions: [1.1, 0.5, 0.8] });
  const before = verifyScene(scene);
  assert.equal(before.routes.find((r) => r.floorZ === 0)!.passed, true);
  assert.equal(before.routes.find((r) => r.floorZ === 2.85)!.passed, false);
  const repaired = suggestRepair(scene);
  assert.equal(verifyScene(repaired.scene).passed, true, repaired.summary);
  assert.equal(repaired.scene.objects[0].position[2], scene.objects[0].position[2]);
  assert.equal(objectFloorZ(repaired.scene, repaired.scene.objects[0]), 2.85);
  assert.deepEqual(repaired.scene.objects[0].dimensions, scene.objects[0].dimensions);
});
test('a lower staircase does not become a phantom upper obstacle; upper stairwell void stays impassable', () => {
  const scene = twoFloors();
  scene.walls = [];
  scene.stairs = [
    { id: 'stair', position: [3, 3, 1.425], dimensions: [1, 2, 2.85], rotation: 0, steps: 14 },
  ];
  const checked = verifyScene(scene);
  assert.equal(checked.routes.find((r) => r.floorZ === 2.85)!.passed, true);
  scene.rooms = scene.rooms.filter((r) => r.floorZ === 0);
  scene.rooms.push(
    {
      id: 'upper-left',
      name: 'Upper left',
      polygon: [
        [0, 0],
        [2.5, 0],
        [2.5, 6],
        [0, 6],
      ],
      floorZ: 2.85,
      ceilingHeight: 2.65,
    },
    {
      id: 'upper-right',
      name: 'Upper right',
      polygon: [
        [3.5, 0],
        [6, 0],
        [6, 6],
        [3.5, 6],
      ],
      floorZ: 2.85,
      ceilingHeight: 2.65,
    },
  );
  scene.navigation.levels![0] = {
    floorZ: 2.85,
    start: [1, 3],
    targets: [{ id: 'across-void', label: 'Across void', point: [5, 3] }],
  };
  assert.equal(verifyScene(scene).routes.find((r) => r.floorZ === 2.85)!.passed, false);
});
