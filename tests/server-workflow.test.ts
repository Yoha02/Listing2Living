import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { SceneObject, SceneSpec } from '../shared/types.js';
import {
  approveAssets,
  emptyWorkflow,
  hasRouteRegression,
  normalizeAssessment,
  normalizePlan,
  proposalSet,
  retainHumanFindings,
  visualImproved,
} from '../server/workflow.js';
import { verifyScene } from '../shared/verification.js';
const scene = JSON.parse(
  readFileSync(new URL('../shared/brannan.json', import.meta.url), 'utf8'),
) as SceneSpec;
const catalog = JSON.parse(
  readFileSync(new URL('../shared/catalog.json', import.meta.url), 'utf8'),
) as SceneObject[];
const assets = () =>
  proposalSet(
    { assets: [], summary: 'The source photographs show empty living space.' },
    scene,
    catalog,
  );
test('empty photos produce exactly three explicitly suggested items, not invented observations', () => {
  const proposed = assets();
  assert.equal(proposed.length, 3);
  assert.ok(
    proposed.every(
      (a) =>
        a.origin === 'suggested' &&
        a.sourceIds.length === 0 &&
        a.sourceDescription.includes('not identified'),
    ),
  );
  assert.deepEqual(
    proposed.map((a) => a.kind),
    ['sofa', 'desk', 'rug'],
  );
});
test('approval is required, rejects unknown IDs, and preserves user-approved dimensions', () => {
  const flow = { ...emptyWorkflow(), phase: 'awaiting-approval' as const, assets: assets() };
  assert.throws(() => approveAssets(scene, emptyWorkflow(), { mode: 'suggested' }), /review/);
  assert.throws(
    () =>
      approveAssets(scene, flow, { mode: 'reviewed', items: [{ id: 'unseen', selected: true }] }),
    /unknown/,
  );
  const result = approveAssets(scene, flow, {
    mode: 'reviewed',
    items: [{ id: 'suggested-sofa', selected: true, dimensions: [1.8, 0.8, 0.9] }],
  });
  assert.deepEqual(
    result.scene.objects.find((o) => o.id === 'suggested-sofa')!.dimensions,
    [1.8, 0.8, 0.9],
  );
  assert.equal(result.scene.objects.find((o) => o.id === 'suggested-sofa')!.position[2], 0.45);
  assert.equal(result.workflow.phase, 'building');
  assert.equal(flow.phase, 'awaiting-approval');
});
test('three suggested items fit the actual Brannan fixture without changing fixed objects', () => {
  const result = approveAssets(
    scene,
    { ...emptyWorkflow(), phase: 'awaiting-approval', assets: assets() },
    { mode: 'suggested' },
  );
  assert.equal(result.workflow.approvedAssetIds.length, 3);
  assert.equal(
    verifyScene(result.scene).passed,
    true,
    JSON.stringify(verifyScene(result.scene).issues),
  );
  for (const fixed of scene.objects)
    assert.deepEqual(
      result.scene.objects.find((o) => o.id === fixed.id),
      fixed,
    );
});

test('explicit reviewed approval can keep the room unfurnished', () => {
  const proposals = assets();
  const result = approveAssets(
    scene,
    { ...emptyWorkflow(), phase: 'awaiting-approval', assets: proposals },
    { mode: 'reviewed', items: proposals.map((a) => ({ id: a.id, selected: false })) },
  );
  assert.equal(result.workflow.approvalMode, 'reviewed');
  assert.equal(result.workflow.approvedAssetIds.length, 0);
  assert.ok(result.scene.objects.every((o) => !o.movable));
  assert.equal(verifyScene(result.scene).passed, true);
});
test('unverified plan labels are downgraded to estimates and height remains inferred', () => {
  const plan = normalizePlan(
    {
      summary: 'Plan',
      rooms: [
        {
          roomId: 'living',
          name: 'Living',
          width: 7,
          depth: 7,
          ceilingHeight: 2.85,
          dimensionBasis: 'plan',
          confidence: 'high',
          evidence: 'Guessed',
        },
      ],
      scaleNote: 'Metres',
      uncertainties: [],
    },
    scene,
  );
  assert.equal(plan.rooms[0].dimensionBasis, 'inferred');
  assert.equal(plan.rooms[0].confidence, 'low');
  assert.match(plan.rooms[0].evidence, /Ceiling height is inferred/);
  assert.equal(plan.rooms.length, scene.rooms.length);
});
test('photo assets must cite actual source photos', () => {
  const photo = {
    ...assets()[0],
    id: 'photo-sofa',
    origin: 'photo',
    sourceIds: ['invented-source'],
  };
  assert.throws(() => proposalSet({ assets: [photo] }, scene, catalog), /source photos/);
});
const reviewRaw = (findings: unknown[] = []) => ({
  summary: 'Visual comparison',
  scores: { layout: 80, objects: 80, materials: 80 },
  findings,
  evidenceSufficient: true,
});
test('visual readiness requires fresh geometric pass, every score threshold, and no major findings', () => {
  const checks = verifyScene(scene);
  assert.equal(
    normalizeAssessment(reviewRaw(), scene, checks, true).status,
    'ready-for-human-review',
  );
  assert.equal(
    normalizeAssessment(
      { ...reviewRaw(), scores: { layout: 90, objects: 69, materials: 95 } },
      scene,
      checks,
      true,
    ).status,
    'needs-repair',
  );
  assert.equal(
    normalizeAssessment(reviewRaw(), scene, { ...checks, passed: false }, true).status,
    'needs-repair',
  );
  assert.equal(
    normalizeAssessment(reviewRaw(), scene, { ...checks, sceneRevision: scene.revision - 1 }, true)
      .status,
    'needs-repair',
  );
  assert.equal(
    normalizeAssessment(reviewRaw(), scene, checks, false).status,
    'insufficient-evidence',
  );
});
test('structural findings cannot disappear through a movable-only repair', () => {
  const before = normalizeAssessment(
    reviewRaw([
      {
        category: 'structure',
        severity: 'major',
        message: 'Window placement needs review',
        objectIds: ['wall-north'],
        recommendation: 'Review the plan',
      },
    ]),
    scene,
    verifyScene(scene),
    true,
  );
  const after = normalizeAssessment(reviewRaw(), scene, verifyScene(scene), true);
  const retained = retainHumanFindings(before, after);
  assert.equal(retained.status, 'needs-repair');
  assert.equal(retained.findings[0].category, 'structure');
  assert.equal(visualImproved(before, retained), false);
});

test('upper-floor photo proposals and dimension approval preserve the original floor', () => {
  const upperScene = structuredClone(scene);
  upperScene.rooms.push({ ...upperScene.rooms[0], id: 'test-upper', floorZ: 2.85 });
  upperScene.sources.push({
    id: 'test-upper-photo',
    label: 'Upper view',
    url: 'https://example.com/test.jpg',
    kind: 'photo',
  });
  const raw = {
    ...assets()[0],
    id: 'upper-sofa',
    origin: 'photo',
    sourceIds: ['test-upper-photo'],
    position: [1.25, 7.3, 2.85 + 0.42],
  };
  const proposed = proposalSet({ assets: [raw] }, upperScene, catalog);
  const flow = { ...emptyWorkflow(), phase: 'awaiting-approval' as const, assets: proposed };
  const approved = approveAssets(upperScene, flow, {
    mode: 'reviewed',
    items: [{ id: 'proposal-upper-sofa', selected: true, dimensions: [1.8, 0.8, 1.0] }],
  });
  const upper = approved.scene.objects.find((o) => o.id === 'proposal-upper-sofa')!;
  assert.equal(upper.position[2], 3.35);
  assert.equal(upper.position[2] - upper.dimensions[2] / 2, 2.85);
});

test('route regression distinguishes duplicate destination IDs on different floors', () => {
  const checked = verifyScene(scene);
  const base = { targetId: 'same-id', label: 'Destination', points: [], length: 0 };
  const before = {
    ...checked,
    routes: [
      { ...base, floorZ: 0, passed: true },
      { ...base, floorZ: 2.85, passed: false },
    ],
  };
  const after = {
    ...checked,
    routes: [
      { ...base, floorZ: 2.85, passed: true },
      { ...base, floorZ: 0, passed: false },
    ],
  };
  assert.equal(hasRouteRegression(before, after), true);
});

test('verified upper printed extents remain source-backed without certifying polygon vertices', () => {
  const plan = normalizePlan(
    {
      summary: 'Upper floor',
      rooms: [
        {
          roomId: 'upper-bedroom-west',
          name: 'West bedroom',
          width: 3.175,
          depth: 7.8486,
          ceilingHeight: 2.65,
          dimensionBasis: 'plan',
          confidence: 'high',
          evidence: 'Printed 10 ft 5 in by25 ft9 in label.',
        },
      ],
      scaleNote: 'Metres',
      uncertainties: [],
    },
    scene,
  );
  const bedroom = plan.rooms.find((room) => room.roomId === 'upper-bedroom-west')!;
  assert.equal(bedroom.dimensionBasis, 'plan');
  assert.match(bedroom.evidence, /nonrectangular/);
  assert.match(bedroom.evidence, /vertices remain approximate/);
});
