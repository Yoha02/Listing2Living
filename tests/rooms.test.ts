import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../shared/brannan.json';
import type { SceneSpec } from '../shared/types.js';
import {
  normalizeRoomReview,
  aggregateRoomReviews,
  eachLimit,
  roomAppearanceSchema,
} from '../server/rooms.js';
import { verifyScene } from '../shared/verification.js';
const passing = {
  scores: { layout: 95, objects: 95, materials: 95 },
  summary: 'Looks similar',
  evidenceSufficient: true,
  majorMismatch: false,
  recommendations: [],
};
test('room appearance retains large detail lists, late feature tokens and long descriptions', () => {
  const longNote =
    'The bay window has a built-in bench with a dark blue cushion; the material color is an approximation from the supplied photograph. '.repeat(
      4,
    );
  const details = [
    ...Array.from({ length: 40 }, (_, i) => `Source-backed finish observation ${i + 1}`),
    'feature:closet-rail',
    'feature:concrete-accent-wall',
    longNote,
  ];
  const raw = {
    wallColor: '#e9e6dc',
    floorColor: '#93623d',
    floorMaterial: 'wood',
    ceilingColor: '#ffffff',
    details,
  };
  const parsed = roomAppearanceSchema.parse(raw);
  assert.ok(longNote.length > 250);
  assert.deepEqual(parsed, raw, 'Descriptive evidence must not be truncated or silently dropped.');
  assert.equal(parsed.details[40], 'feature:closet-rail');
  assert.equal(parsed.details[41], 'feature:concrete-accent-wall');
});

test('unbounded descriptive lists still reject malformed values and invalid appearance fields', () => {
  const valid = {
    wallColor: '#e9e6dc',
    floorColor: '#93623d',
    floorMaterial: 'wood',
    ceilingColor: '#ffffff',
    details: ['Visible wood flooring'],
  };
  for (const invalid of [
    { ...valid, details: ['Visible wood flooring', 42] },
    { ...valid, details: ['Visible wood flooring', { note: 'not a string' }] },
    { ...valid, details: 'not an array' },
    { ...valid, wallColor: 'white' },
    { ...valid, floorColor: '#12345g' },
    { ...valid, floorMaterial: 'invented-material' },
  ]) {
    assert.equal(roomAppearanceSchema.safeParse(invalid).success, false);
  }
});

test('large critic recommendation lists are retained without bypassing evidence or mismatch failures', () => {
  const s = structuredClone(fixture) as SceneSpec;
  const roomId = s.rooms[0].id;
  s.sources.push({
    id: 'matched-many-recommendations',
    kind: 'photo',
    label: 'living',
    url: 'https://example.invalid/photo.jpg',
    localUrl: '/evidence/test.jpg',
    roomIds: [roomId],
  });
  const recommendations = Array.from(
    { length: 40 },
    (_, i) => `Compare visible finish detail ${i + 1} against the source photograph.`,
  );
  for (const [overrides, expected] of [
    [{}, 'ready-for-human-review'],
    [{ evidenceSufficient: false }, 'insufficient-evidence'],
    [{ majorMismatch: true }, 'needs-repair'],
  ] as const) {
    const review = normalizeRoomReview(
      { ...passing, recommendations, ...overrides },
      s,
      roomId,
      '/generated/test.png',
    );
    assert.deepEqual(review.recommendations, recommendations);
    assert.equal(review.status, expected);
  }
  assert.throws(() =>
    normalizeRoomReview(
      { ...passing, recommendations: [...recommendations, 42] },
      s,
      roomId,
      '/generated/test.png',
    ),
  );
});

test('high visual scores cannot pass a room without matching source photographs', () => {
  const s = structuredClone(fixture) as SceneSpec;
  assert.equal(
    normalizeRoomReview(passing, s, s.rooms[0].id, '/generated/example.png').status,
    'insufficient-evidence',
  );
});
test('room acceptance requires a fresh render, sufficient evidence and threshold scores', () => {
  const s = structuredClone(fixture) as SceneSpec;
  s.sources.push({
    id: 'matched',
    kind: 'photo',
    label: 'living',
    url: 'https://example.invalid/photo.jpg',
    localUrl: '/evidence/test.jpg',
    roomIds: [s.rooms[0].id],
  });
  assert.equal(
    normalizeRoomReview(passing, s, s.rooms[0].id, undefined).status,
    'insufficient-evidence',
  );
  assert.equal(
    normalizeRoomReview(passing, s, s.rooms[0].id, '/generated/test.png').status,
    'ready-for-human-review',
  );
  assert.equal(
    normalizeRoomReview(
      { ...passing, majorMismatch: true },
      s,
      s.rooms[0].id,
      '/generated/test.png',
    ).status,
    'needs-repair',
  );
  assert.equal(
    normalizeRoomReview(
      { ...passing, scores: { ...passing.scores, materials: 60 } },
      s,
      s.rooms[0].id,
      '/generated/test.png',
    ).status,
    'needs-repair',
  );
});
test('whole-home review cannot pass when room evidence is missing or stale', () => {
  const s = structuredClone(fixture) as SceneSpec;
  const rooms = s.rooms.map((room) =>
    normalizeRoomReview(passing, s, room.id, '/generated/test.png'),
  );
  assert.equal(aggregateRoomReviews(s, rooms, verifyScene(s)).status, 'insufficient-evidence');
  for (const r of rooms) {
    r.status = 'ready-for-human-review';
    r.revision = s.revision - 1;
  }
  assert.equal(aggregateRoomReviews(s, rooms, verifyScene(s)).status, 'insufficient-evidence');
  assert.equal(
    aggregateRoomReviews(s, rooms.slice(1), verifyScene(s)).status,
    'insufficient-evidence',
  );
});

test('a failed room batch drains in-flight workers before its caller can roll back or switch homes', async () => {
  const events: string[] = [];
  let releaseWorkers!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseWorkers = resolve;
  });
  let settled = false;
  const completion = eachLimit(['failure', 'wall review', 'floor review'], 3, async (name) => {
    events.push('start:' + name);
    if (name === 'failure') throw new Error('first room failed');
    await blocked;
    events.push('done:' + name);
    return name;
  }).then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      events.push('batch rejected');
      return error;
    },
  );
  // Let the rejected worker settle while the other two remain in flight.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    settled,
    false,
    'The batch must not release the workspace lock while workers are running.',
  );
  releaseWorkers();
  const error = await completion;
  assert.ok(error instanceof Error);
  assert.match(error.message, /first room failed/);
  assert.deepEqual(events.slice(-3), ['done:wall review', 'done:floor review', 'batch rejected']);
  const atRollback = [...events];
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, atRollback, 'No old-room progress may arrive after rollback begins.');
});

test('room batches preserve input order while respecting the worker limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await eachLimit([3, 1, 2, 4], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return value * 10;
  });
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(results, [30, 10, 20, 40]);
});
