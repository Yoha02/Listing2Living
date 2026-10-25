import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../shared/brannan.json';
import type { SceneSpec } from '../shared/types';
import { advanceWalker, findWalkStart, moveWalker, type WalkerPose } from '../shared/navigation';

function scene(): SceneSpec {
  return {
    id: 'walk-test',
    revision: 1,
    title: 'Walk test',
    listingUrl: '',
    units: 'm',
    rooms: [
      {
        id: 'main',
        name: 'Main',
        polygon: [
          [0, 0],
          [6, 0],
          [6, 8],
          [0, 8],
        ],
        floorZ: 0,
        ceilingHeight: 2.85,
      },
    ],
    walls: [],
    objects: [],
    stairs: [],
    cameras: [],
    sources: [],
    notes: [],
    navigation: { start: [1, 1], targets: [], clearance: 0.65 },
  };
}
const pose = (x = 3, y = 1, z = 0): WalkerPose => ({
  position: [x, y, z],
  floorZ: z,
  yaw: 0,
  pitch: 0,
});

test('movement is elapsed-time based and diagonal movement is normalized', () => {
  const input = { forward: 1, strafe: 0, turn: 0, look: 0 };
  const one = advanceWalker(scene(), pose(), input, 1);
  let many = pose();
  for (let i = 0; i < 20; i++) many = advanceWalker(scene(), many, input, 0.05);
  assert.ok(Math.abs(one.position[1] - many.position[1]) < 1e-8);
  const diagonal = advanceWalker(scene(), pose(), { ...input, strafe: 1 }, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.position[0] - 3, diagonal.position[1] - 1) - 1.6) < 1e-8);
});

test('a wall blocks walking while its tall door permits passage', () => {
  const s = scene();
  s.walls = [
    {
      id: 'divider',
      start: [0, 3],
      end: [6, 3],
      floorZ: 0,
      height: 2.85,
      thickness: 0.14,
      color: '#fff',
      openings: [
        { id: 'door', type: 'door', offset: 3, width: 1.1, bottom: 0, height: 2.2, basis: 'plan' },
      ],
    },
  ];
  assert.ok(moveWalker(s, pose(3, 2), 0, 2).position[1] > 3.9);
  assert.ok(moveWalker(s, pose(1, 2), 0, 2).position[1] < 2.75);
  s.walls[0].openings[0].type = 'window';
  assert.ok(moveWalker(s, pose(3, 2), 0, 2).position[1] < 2.75);
});

test('rotated furniture and floor boundaries block motion without blocking rugs or another floor', () => {
  const s = scene();
  s.objects = [
    {
      id: 'desk',
      name: 'Desk',
      kind: 'desk',
      dimensions: [2, 0.6, 0.75],
      position: [3, 3, 0.375],
      rotation: Math.PI / 2,
      color: '#aaa',
      movable: true,
      basis: 'user',
    },
  ];
  assert.ok(moveWalker(s, pose(3, 1), 0, 4).position[1] < 1.85);
  s.objects[0].position[2] += 2.85;
  assert.ok(moveWalker(s, pose(3, 1), 0, 4).position[1] > 4.9);
  s.objects[0].position[2] = 0.01;
  s.objects[0].kind = 'rug';
  s.objects[0].dimensions[2] = 0.02;
  assert.ok(moveWalker(s, pose(3, 1), 0, 4).position[1] > 4.9);
  assert.ok(moveWalker(s, pose(3, 1), 20, 0).position[0] <= 5.8);
});

test('stairs ascend and descend continuously and cannot be entered through a side', () => {
  const s = scene();
  s.rooms.push({
    id: 'upper',
    name: 'Upper',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    floorZ: 2.85,
    ceilingHeight: 2.65,
  });
  s.stairs = [
    {
      id: 'stairs',
      position: [3, 5.25, 1.425],
      dimensions: [1, 2.5, 2.85],
      rotation: 0,
      steps: 14,
      bottom: [3, 6.5],
      top: [3, 4],
    },
  ];
  let walker = pose(3, 6.8);
  let previousZ = 0;
  for (let i = 0; i < 62; i++) {
    walker = moveWalker(s, walker, 0, -0.05);
    assert.ok(Math.abs(walker.position[2] - previousZ) < 0.1);
    previousZ = walker.position[2];
  }
  assert.equal(walker.floorZ, 2.85);
  assert.ok(walker.position[1] < 4);
  for (let i = 0; i < 62; i++) walker = moveWalker(s, walker, 0, 0.05);
  assert.equal(walker.floorZ, 0);
  assert.ok(walker.position[1] > 6.5);
  const sideways = moveWalker(s, pose(1.8, 5.25), 1.2, 0);
  assert.ok(sideways.position[0] < 2.5);
  assert.equal(sideways.position[2], 0);
});

test('look controls turn in place, clamp pitch, and find a free start when an entry is obstructed', () => {
  const s = scene();
  const turned = advanceWalker(s, pose(), { forward: 0, strafe: 0, turn: 1, look: 1 }, 4);
  assert.deepEqual(turned.position, pose().position);
  assert.ok(turned.yaw > 0 && turned.pitch <= 1.18);
  s.objects = [
    {
      id: 'block',
      name: 'Block',
      kind: 'cabinet',
      dimensions: [1, 1, 2],
      position: [1, 1, 1],
      rotation: 0,
      color: '#aaa',
      movable: false,
      basis: 'user',
    },
  ];
  assert.notDeepEqual(findWalkStart(s, 0), [1, 1, 0]);
});

test('the Brannan staircase connects the two real landing regions in both directions', () => {
  const home = fixture as SceneSpec;
  let walker = pose(3.84, 8.08);
  for (let i = 0; i < 103; i++) walker = moveWalker(home, walker, 0, -0.03);
  assert.ok(Math.abs(walker.position[2] - 2.85) < 0.001);
  assert.equal(walker.floorZ, 2.85);
  assert.ok(walker.position[1] < 5.1);
  for (let i = 0; i < 103; i++) walker = moveWalker(home, walker, 0, 0.03);
  assert.equal(walker.floorZ, 0);
  assert.ok(walker.position[1] > 7.9);
  assert.deepEqual(findWalkStart(home, 2.85), [3.84, 4.75, 2.85]);
});
