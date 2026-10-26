import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import fixture from '../shared/brannan.json';
import curatedSources from '../shared/brannan-sources.json';
import catalogData from '../shared/catalog.json';
import type {
  AppState,
  SceneSpec,
  SceneObject,
  PipelineEvent,
  PlacementPatch,
  Vec3,
  Issue,
  Verification,
  VisualAssessment,
  WorkflowState,
} from '../shared/types.js';
import { verifyScene, suggestRepair, createStressTest } from '../shared/verification.js';
import { addMissingLevels } from '../shared/scene-upgrade.js';
import { askArgon, configured, modelName, safeError } from './argon.js';
import { collectEvidence, demoUrl } from './evidence.js';
import { inspectListing, propertyKey, reconstructScene } from './intake.js';
import { buildBlender, renderPathForModel, roomRenderPathsForModel } from './blender.js';
import {
  enrichRoomSources,
  evaluateRooms,
  aggregateRoomReviews,
  refineRoomFinishes,
} from './rooms.js';
import {
  saveWorkspace,
  loadWorkspace,
  listWorkspaces,
  archiveWorkspace,
  projectContext,
  projectDirectory,
} from './workspaces.js';
import {
  planSchema,
  assetsSchema,
  assessmentSchema,
  approvalSchema,
  emptyWorkflow,
  normalizePlan,
  proposalSet,
  approveAssets,
  normalizeAssessment,
  hasRouteRegression,
  visualImproved,
  retainHumanFindings,
} from './workflow.js';
const vectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const patchSchema = z.object({
  objectId: z.string(),
  position: vectorSchema.optional(),
  rotation: z.number().finite().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});
const replySchemas: Record<string, z.ZodType> = {
  surveyor: planSchema,
  assets: assetsSchema,
  structure: z.object({
    ceilingHeight: z.number().finite().min(2.5).max(3.5),
    notes: z.array(z.string()).default([]),
  }),
  openings: z.object({
    findings: z.array(z.string()).default([]),
    uncertainties: z.array(z.string()).default([]),
  }),
  appearance: z.object({
    wallColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    cabinetColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    notes: z.array(z.string()).default([]),
  }),
  repair: z.object({
    patches: z.array(patchSchema).max(20),
    summary: z.string().default('Placement repair proposed.'),
  }),
  furnish: z.object({
    additions: z
      .array(
        z.object({
          kind: z.string(),
          position: vectorSchema.optional(),
          rotation: z.number().finite().optional(),
          color: z
            .string()
            .regex(/^#[0-9a-f]{6}$/i)
            .optional(),
        }),
      )
      .max(6)
      .default([]),
    patches: z.array(patchSchema).max(20).default([]),
    summary: z.string().default('Furniture placement proposed.'),
  }),
  visual: assessmentSchema,
  'visual-repair': z.object({ patches: z.array(patchSchema).max(20), summary: z.string() }),
};
const catalog = catalogData as SceneObject[];
const initial = structuredClone(fixture) as SceneSpec;
const history: SceneSpec[] = [];
const state: AppState = {
  scene: initial,
  events: [],
  verification: null,
  model: { configured, name: modelName, status: configured ? 'Configured' : 'API key needed' },
  modelUrl: null,
  busy: false,
  lastAction: 'Analyze the listing, review its proposed items, then approve Blender generation.',
  workflow: emptyWorkflow(),
};
try {
  const saved = JSON.parse(await fs.readFile('runtime/state.json', 'utf8'));
  if (saved.scene?.rooms?.length && saved.scene?.listingUrl) {
    verifyScene(saved.scene);
    state.scene = saved.scene;
    state.workspaceId = saved.workspaceId || propertyKey(saved.scene.listingUrl);
    state.intake = saved.intake;
    if (Array.isArray(saved.history)) history.push(...saved.history.slice(-20));
    state.modelUrl = saved.modelUrl;
    state.visualReview = typeof saved.visualReview === 'string' ? saved.visualReview : undefined;
    state.visualIssues = Array.isArray(saved.visualIssues) ? saved.visualIssues : [];
    state.visualReviewRevision = saved.visualReviewRevision;
    if (Array.isArray(saved.events)) state.events = saved.events.slice(-60);
    if (saved.workflow && Array.isArray(saved.workflow.assets)) state.workflow = saved.workflow;
    state.lastAction = 'Restored saved scene and workflow. New requests run live.';
    if (['building', 'analyzing', 'review'].includes(state.workflow!.phase)) {
      state.workflow!.phase = 'needs-review';
      state.lastAction =
        'A previous run was interrupted. Review the saved scene before continuing.';
    }
  }
} catch {}
if (!state.events.length) {
  try {
    const lines = (await fs.readFile('runtime/events.jsonl', 'utf8')).trim().split('\n').slice(-60);
    state.events = lines.flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        return typeof entry.stage === 'string' && typeof entry.label === 'string' ? [entry] : [];
      } catch {
        return [];
      }
    });
  } catch {}
}
state.workspaceId ||= propertyKey(state.scene.listingUrl);
const upgradedScene = state.scene.id === initial.id ? addMissingLevels(state.scene, initial) : null;
if (upgradedScene) {
  await fs.mkdir('runtime', { recursive: true });
  await fs.writeFile(
    'runtime/before-upper-floor-' + state.scene.revision + '.json',
    JSON.stringify(state, null, 2),
  );
  state.scene = upgradedScene;
  state.modelUrl = null;
  state.workflow ??= emptyWorkflow();
  if (state.workflow.plan) state.workflow.plan = normalizePlan(state.workflow.plan, upgradedScene);
  state.workflow.phase = 'needs-review';
  state.lastAction =
    'Added the source-traced second floor. Your existing furniture is preserved; a fresh two-floor render is needed.';
  event(
    'structure',
    'Add second floor',
    'done',
    'Upper rooms traced from the listing plan; floor height and vertical alignment are inferred. Existing furniture preserved.',
  );
}
if (state.scene.id === initial.id && state.scene.rooms.some((room) => room.floorZ > 0)) {
  state.scene.levels = structuredClone(initial.levels);
  state.scene.notes = state.scene.notes.map((note) =>
    note.startsWith('Stair direction anchor:')
      ? initial.notes.find((entry) => entry.startsWith('Stair direction anchor:')) || note
      : note,
  );
}
if (state.modelUrl) {
  try {
    await fs.access(path.join('public', state.modelUrl.split('?')[0]));
  } catch {
    state.modelUrl = null;
  }
}
if (!state.modelUrl && !upgradedScene && state.scene.id === initial.id)
  try {
    await fs.access('public/generated/brannan.glb');
    state.modelUrl = '/generated/brannan.glb?v=' + Date.now();
  } catch {}
state.verification = verifyScene(state.scene);
let saveQueue: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  const payload = JSON.stringify(
    {
      scene: state.scene,
      modelUrl: state.modelUrl,
      visualReview: state.visualReview,
      visualIssues: state.visualIssues,
      visualReviewRevision: state.visualReviewRevision,
      workflow: state.workflow,
      events: state.events,
      workspaceId: state.workspaceId,
      intake: state.intake,
      history,
    },
    null,
    2,
  );
  const pending = saveQueue
    .catch(() => {})
    .then(async () => {
      await fs.mkdir('runtime', { recursive: true });
      await fs.writeFile('runtime/state.json.tmp', payload);
      await fs.rename('runtime/state.json.tmp', 'runtime/state.json');
      await saveWorkspace(JSON.parse(payload));
    });
  saveQueue = pending;
  return pending;
}
await save();
function snapshot() {
  return structuredClone({
    scene: state.scene,
    modelUrl: state.modelUrl,
    verification: state.verification,
    visualReview: state.visualReview,
    visualIssues: state.visualIssues,
    visualReviewRevision: state.visualReviewRevision,
    workflow: state.workflow,
    workspaceId: state.workspaceId,
    intake: state.intake,
    events: state.events,
    history,
  });
}
function rollback(saved: ReturnType<typeof snapshot>, message: string) {
  state.scene = saved.scene;
  state.modelUrl = saved.modelUrl;
  state.verification = saved.verification;
  state.visualReview = saved.visualReview;
  state.visualIssues = saved.visualIssues;
  state.visualReviewRevision = saved.visualReviewRevision;
  state.workflow = saved.workflow;
  state.workspaceId = saved.workspaceId;
  state.intake = saved.intake;
  state.events = saved.events;
  history.splice(0, history.length, ...saved.history);
  state.lastAction = message + ' Previous scene and workflow preserved.';
}
function event(
  stage: string,
  label: string,
  status: PipelineEvent['status'],
  detail: string,
  model?: string,
) {
  const e = {
    id: randomUUID(),
    stage,
    label,
    status,
    detail,
    at: new Date().toISOString(),
    ...(model ? { model } : {}),
  };
  state.events.push(e);
  state.events = state.events.slice(-60);
  void fs
    .mkdir('runtime', { recursive: true })
    .then(() => fs.appendFile('runtime/events.jsonl', JSON.stringify(e) + '\n'))
    .catch(() => {});
}
function checkpoint() {
  history.push(structuredClone(state.scene));
  if (history.length > 20) history.shift();
}
function commit(scene: SceneSpec, message: string) {
  const architecture = (s: SceneSpec) =>
    JSON.stringify({
      rooms: s.rooms,
      walls: s.walls,
      stairs: s.stairs,
      objects: s.objects.filter((o) => !o.movable),
    });
  if (architecture(scene) !== architecture(state.scene)) state.modelUrl = null;
  scene.revision = state.scene.revision + 1;
  state.scene = scene;
  state.verification = verifyScene(scene);
  state.lastAction = message;
  if (state.workflow?.phase === 'ready') state.workflow.phase = 'needs-review';
}
function checkedVector(value: any): Vec3 | undefined {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((v: any) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 50)
    ? (value as Vec3)
    : undefined;
}
function applyPatches(scene: SceneSpec, patches: PlacementPatch[]): SceneSpec {
  const next = structuredClone(scene);
  for (const patch of z.array(patchSchema).max(20).parse(patches)) {
    const o = next.objects.find((o) => o.id === patch.objectId);
    if (!o?.movable || o.pinned) continue;
    const pos = checkedVector(patch.position);
    if (pos) o.position = [pos[0], pos[1], o.position[2]];
    if (typeof patch.rotation === 'number' && Number.isFinite(patch.rotation))
      o.rotation = patch.rotation;
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color))
      o.color = patch.color;
  }
  return next;
}
async function call<T>(
  stage: string,
  label: string,
  prompt: string,
  images: string[] = [],
  tokens = 4096,
): Promise<T> {
  event(stage, label, 'running', 'Live ' + modelName + ' request.', modelName);
  try {
    const result = await askArgon<T>(prompt, images, tokens);
    const schema = replySchemas[stage];
    const value = schema ? schema.parse(result.value) : result.value;
    state.model.status = 'Connected';
    event(
      stage,
      label,
      'done',
      'Argon completed in ' +
        (result.elapsedMs / 1000).toFixed(1) +
        ' s. Response validated; interaction saved locally.',
      modelName,
    );
    return value as T;
  } catch (e) {
    state.model.status = 'Request failed';
    event(stage, label, 'failed', safeError(e), modelName);
    throw e;
  }
}
const compact = (scene: SceneSpec) =>
  JSON.stringify({
    rooms: scene.rooms,
    walls: scene.walls,
    objects: scene.objects,
    stairs: scene.stairs,
    navigation: scene.navigation,
  });
function improves(before: Verification, after: Verification) {
  if (
    before.routes.some(
      (route) =>
        route.passed &&
        !after.routes.find(
          (r) => r.targetId === route.targetId && (r.floorZ || 0) === (route.floorZ || 0),
        )?.passed,
    )
  )
    return false;
  const count = (v: Verification) => v.issues.filter((i) => i.severity === 'error').length;
  return after.passed || count(after) < count(before);
}
function recordVisualReview(review: VisualAssessment) {
  const rooms = state.workflow?.roomReviews;
  if (
    review.status === 'ready-for-human-review' &&
    (!rooms ||
      rooms.length !== state.scene.rooms.length ||
      rooms.some(
        (r) => r.revision !== state.scene.revision || r.status !== 'ready-for-human-review',
      ))
  ) {
    review = {
      ...review,
      status: 'insufficient-evidence',
      summary:
        review.summary +
        ' Whole-home acceptance still requires a current passing source comparison for every room.',
    };
  }
  state.visualReview = review.summary;
  state.visualReviewRevision = review.revision;
  state.visualIssues = review.findings.map((finding): Issue => ({
    id: finding.id,
    type: 'visual',
    severity: 'warning',
    message: finding.message,
    objectIds: finding.objectIds,
    evidence:
      'Argon observation on rendered revision ' + review.revision + '; ' + finding.recommendation,
  }));
  state.workflow ??= emptyWorkflow();
  state.workflow.review = review;
  state.workflow.phase = review.status === 'ready-for-human-review' ? 'ready' : 'needs-review';
  return review;
}
async function repairCurrent() {
  const before = state.scene;
  const beforeChecks = verifyScene(before);
  if (beforeChecks.passed) {
    state.lastAction = 'All geometric checks already pass. No repair needed.';
    return;
  }
  const answer = await call<{ patches: PlacementPatch[]; summary: string }>(
    'repair',
    'Placement repair',
    "You are Listing2Living layout repair agent. Correct the actual failures while preserving fixed/pinned objects, furniture dimensions, room geometry and each object's current floor elevation. Canonical metres XY floor, Z up, object position is CENTER and rotation radians. Only move existing movable objects, staying on their current floor, away from stairs. Use each modeled room’s actual floorZ; never transfer items between floors during repair. Return {patches:[{objectId,position:[x,y,z],rotation}],summary}.\nScene: " +
      compact(before) +
      '\nFailures: ' +
      JSON.stringify(beforeChecks),
  );
  let next = applyPatches(before, answer.patches || []);
  let checks = verifyScene(next);
  event(
    'geometry',
    'Retest proposed repair',
    'done',
    checks.passed
      ? 'Argon placement passes all geometry checks.'
      : checks.issues.length + ' issues remain; checking deterministic placement candidates.',
  );
  if (!checks.passed) {
    const fitted = suggestRepair(next);
    const fittedChecks = verifyScene(fitted.scene);
    if (
      improves(beforeChecks, fittedChecks) &&
      (fittedChecks.passed || fittedChecks.issues.length < checks.issues.length)
    ) {
      next = fitted.scene;
      checks = fittedChecks;
      event('fitter', 'Geometric placement tool', 'done', fitted.summary);
    }
  }
  if (improves(beforeChecks, checks)) {
    commit(
      next,
      checks.passed
        ? 'Layout repaired. All ' + checks.routes.length + ' destinations are reachable.'
        : 'Repair improved the layout without blocking previously reachable destinations; some issues remain.',
    );
  } else {
    state.lastAction = 'No verified improvement found. Previous scene preserved.';
    event('repair', 'Repair result', 'failed', state.lastAction);
  }
}
async function build(url: string) {
  const intake = state.intake;
  if (!intake || intake.id !== propertyKey(url) || intake.status !== 'ready')
    throw new Error(
      'Check this listing first. A readable scaled floor plan and enough interior photos are required.',
    );
  await save();
  await archiveWorkspace({ ...snapshot(), workspaceId: state.workspaceId! });
  if (intake.id !== state.workspaceId) {
    try {
      await archiveWorkspace(await loadWorkspace(intake.id));
    } catch {}
  }
  const reconstructionEvents: PipelineEvent[] = [];
  const scene =
    intake.id === propertyKey(demoUrl)
      ? (structuredClone(fixture) as SceneSpec)
      : await reconstructScene(intake, (detail, status) => {
          state.lastAction = detail;
          event('plan', 'Reconstruct this property', status, detail, modelName);
          reconstructionEvents.push(state.events.at(-1)!);
        });
  scene.revision = intake.id === state.workspaceId ? state.scene.revision + 1 : 1;
  scene.sources = structuredClone(intake.sources);
  const evidence = {
    sources: scene.sources,
    imagePaths: scene.sources
      .filter((s) => s.localUrl)
      .map((s) => path.join('public', s.localUrl!)),
  };
  state.workspaceId = intake.id;
  history.splice(0);
  state.events = reconstructionEvents;
  state.visualReview = undefined;
  state.visualIssues = [];
  state.visualReviewRevision = undefined;
  state.workflow = { ...emptyWorkflow(), phase: 'analyzing' };
  event(
    'sources',
    'Read listing',
    'running',
    'Collecting the source floor plan and observed interior views.',
  );
  event('sources', 'Read listing', 'done', intake.summary);
  state.scene = scene;
  state.modelUrl = null;
  state.verification = verifyScene(scene);
  state.lastAction = 'Argon is interpreting the plan before proposing any 3D assets.';
  const sourcePaths = (kind: 'photo' | 'plan') =>
    scene.sources
      .filter((s) => s.kind === kind && s.localUrl)
      .map((s) => path.join('public', s.localUrl!));
  const planRaw = await call<any>(
    'surveyor',
    'Floor-plan interpreter',
    'Interpret every floor in the supplied plan. Return {summary,rooms:[{roomId,name,width,depth,ceilingHeight,dimensionBasis:"plan"|"inferred",confidence:"high"|"medium"|"low",evidence}],scaleNote,uncertainties:[string]}. Dimensions must be numeric METRES; read printed labels rather than inventing measurements. Ceiling height and vertical floor alignment are inferred. Room IDs must match the supplied scene. Preserve uncertainty and any contradictions stated in scene notes. Source-traced footprint is an approximation, not a survey.\nScene seed:' +
      compact(scene),
    sourcePaths('plan').slice(0, 1),
    6500,
  );
  const plan = normalizePlan(planRaw, scene);
  state.workflow.plan = plan;
  const photoSources = scene.sources.filter((s) => s.kind === 'photo' && s.localUrl);
  const results = await Promise.allSettled([
    call<any>(
      'assets',
      'Photo item analyst',
      'Inspect the interior photos and identify only visible movable furnishings from kinds sofa,desk,chair,table,rug. Empty photos should yield assets:[]. Do not pretend suggested furnishings are observed. Estimate dimensions using room scale, label uncertainties. Return {assets:[{id,name,kind,dimensions:[width,depth,height],position:[x,y,z],rotation,color:"#rrggbb",sourceIds:[sourceID],sourceDescription,dimensionReasoning,confidence:"high"|"medium"|"low",origin:"photo",selected:true}],summary}. Numeric metres, XY floor/Z up, positions CENTER, rotations radians. At most5 observed items. Actual photos in order:' +
        JSON.stringify(photoSources.map((s) => ({ id: s.id, label: s.label }))) +
        ' Plan:' +
        JSON.stringify(plan) +
        ' Seed:' +
        compact(scene),
      sourcePaths('photo').slice(0, 4),
      4000,
    ),
    call<any>(
      'structure',
      'Structure worker',
      'Review the source-traced shell; return {ceilingHeight:number,notes:[string]}. Height is inferred, use2.85m unless evidence justifies another estimate in2.5..3.5m. Do not change the source-traced footprint. Plan:' +
        JSON.stringify(plan),
      evidence.imagePaths.slice(0, 2),
      1200,
    ),
    call<any>(
      'openings',
      'Openings and stairs worker',
      'Compare source openings and stairs with the seed. Return {findings:[string],uncertainties:[string]}. Flag contradictions for review, do not silently replace measured geometry. Seed:' +
        compact(scene) +
        ' Plan:' +
        JSON.stringify(plan),
      evidence.imagePaths.slice(0, 3),
      1800,
    ),
    call<any>(
      'appearance',
      'Materials worker',
      'Choose approximate source-consistent colors from the supplied actual photos. Return {wallColor:"#rrggbb",cabinetColor:"#rrggbb",notes:[string]}. These are appearance estimates; do not assume a particular style.',
      sourcePaths('photo').slice(0, 3),
      1200,
    ),
  ]);
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  const [assets, structure, openings, appearance] = results.map(
    (r) => (r as PromiseFulfilledResult<any>).value,
  );
  // Preserve the inferred floor/stair alignment; a proposed ceiling height is evidence for review.
  scene.notes.push(...structure.notes.slice(0, 3));
  scene.walls.forEach((w) => {
    w.color = appearance.wallColor;
  });
  scene.objects
    .filter((o) => o.kind === 'counter' || o.kind === 'cabinet')
    .forEach((o) => (o.color = appearance.cabinetColor));
  scene.notes.push(
    'Live Argon plan interpretation: ' + plan.summary,
    ...plan.uncertainties.slice(0, 4),
    ...openings.findings.slice(0, 3),
  );
  state.scene = await addSourceFixtures(
    await enrichRoomSources(scene, (label, detail, failed) =>
      event('room-sources', label, failed ? 'failed' : 'done', detail, modelName),
    ),
  );
  state.verification = verifyScene(state.scene);
  state.workflow = {
    phase: 'awaiting-approval',
    plan,
    assets: proposalSet(assets, scene, catalog),
    approvedAssetIds: [],
    iterations: 0,
    maxIterations: 2,
  };
  state.lastAction =
    'Review the photo-derived items and estimated dimensions, or choose three clearly labeled staging suggestions. Blender generation is waiting for approval.';
  event(
    'approval',
    'Review proposed items',
    'queued',
    'Awaiting explicit item and dimension approval. No Blender generation has started.',
  );
  await save();
}
function sourceImagePaths(scene: SceneSpec, kind: 'photo' | 'plan') {
  return scene.sources
    .filter((s) => s.kind === kind && s.localUrl)
    .map((s) => path.join('public', s.localUrl!));
}
async function inspectScene(scene: SceneSpec, image: string): Promise<VisualAssessment> {
  const photos = sourceImagePaths(scene, 'photo').slice(0, 2),
    plans = sourceImagePaths(scene, 'plan').slice(0, 1),
    checks = verifyScene(scene);
  const raw = await call<any>(
    'visual',
    'Rendered scene critic',
    'The first image is a fresh rendered view; subsequent images are source photos followed by a floor plan if present. Judge only rooms actually visible in the render and supported by the supplied photos. Do not claim full-house verification from a single view; each room has a separate final comparison. Inspect layout, approved item scale, and material resemblance. Optional staging may differ from empty listing photos. Camera mismatch alone is not an error. Record missing evidence honestly. Stair bottom/top fields are explicit XY endpoints; do not infer orientation from image left/right alone. Return {summary,scores:{layout:0..100,objects:0..100,materials:0..100},evidenceSufficient:boolean,findings:[{category:"placement"|"appearance"|"structure"|"evidence",severity:"major"|"minor",message,objectIds:[string],recommendation}]}. Scores are provisional model judgments;70 is a demo review threshold, not measured reconstruction accuracy. Structural contradictions require human plan review. Scene:' +
      compact(scene) +
      ' Checks:' +
      JSON.stringify(checks) +
      ' Approved proposals:' +
      JSON.stringify(
        state.workflow?.assets.filter((a) => state.workflow?.approvedAssetIds.includes(a.id)),
      ) +
      ' Source image counts:' +
      JSON.stringify({ photos: photos.length, plans: plans.length }),
    [image, ...photos, ...plans],
    3500,
  );
  return normalizeAssessment(raw, scene, checks, photos.length > 0 && plans.length > 0);
}
async function renderScene(scene: SceneSpec): Promise<string> {
  event(
    'blender',
    'Blender assembly',
    'running',
    'Building approved items and source-traced architecture through the local Blender bridge.',
  );
  const url = await buildBlender(scene);
  const report = JSON.parse(
    await fs.readFile(
      path.join(path.dirname(renderPathForModel(url)), 'build-report.json'),
      'utf8',
    ),
  );
  event(
    'blender',
    'Blender assembly',
    'done',
    'Published fresh revision ' +
      scene.revision +
      ' with approved furniture in the reference render. Transport: ' +
      (report.transport || 'cli') +
      '.',
  );
  return url;
}
async function reviewAllRooms() {
  state.workflow ??= emptyWorkflow();
  state.workflow.phase = 'review';
  let fresh = false;
  if (state.modelUrl) {
    try {
      const report = JSON.parse(
        await fs.readFile(
          path.join(path.dirname(renderPathForModel(state.modelUrl)), 'build-report.json'),
          'utf8',
        ),
      );
      fresh =
        report.sceneId === state.scene.id &&
        report.revision === state.scene.revision &&
        Object.keys(report.roomRenders || {}).length === state.scene.rooms.length;
    } catch {}
  }
  if (!fresh) state.modelUrl = await renderScene(state.scene);
  const renders = await roomRenderPathsForModel(state.modelUrl!);
  state.workflow.roomReviews = await evaluateRooms(state.scene, renders, (label, detail, failed) =>
    event(
      'room-review',
      label,
      failed ? 'failed' : detail.startsWith('Comparing') ? 'running' : 'done',
      detail,
      modelName,
    ),
  );
  state.verification = verifyScene(state.scene);
  recordVisualReview(
    aggregateRoomReviews(state.scene, state.workflow.roomReviews, state.verification),
  );
  state.lastAction = state.workflow.review!.summary;
  await save();
}
async function addSourceFixtures(scene: SceneSpec): Promise<SceneSpec> {
  if (scene.id !== initial.id) return scene;
  const manifest = JSON.parse(await fs.readFile('shared/brannan-fixtures.json', 'utf8'));
  for (const object of manifest.objects as SceneObject[])
    if (!scene.objects.some((o) => o.id === object.id)) scene.objects.push(structuredClone(object));
  for (const camera of manifest.cameras || []) {
    scene.cameras = scene.cameras.filter((c) => c.id !== camera.id);
    scene.cameras.push(structuredClone(camera));
  }
  for (const update of manifest.navigationUpdates || []) {
    const targets =
      update.floorZ === 0
        ? scene.navigation.targets
        : scene.navigation.levels?.find((l) => l.floorZ === update.floorZ)?.targets;
    const target = targets?.find((t) => t.id === update.targetId);
    if (target) {
      target.point = update.point;
      target.label = update.label;
    }
  }
  for (const note of manifest.notes || []) if (!scene.notes.includes(note)) scene.notes.push(note);
  return scene;
}
async function refreshSources() {
  await save();
  await archiveWorkspace({ ...snapshot(), workspaceId: state.workspaceId! });
  checkpoint();
  event(
    'sources',
    'Find room references',
    'running',
    'Collecting matching source photos for every modeled room.',
  );
  let next = structuredClone(state.scene);
  if (next.id === initial.id) {
    const evidence = await collectEvidence(next.listingUrl, curatedSources as SceneSpec['sources']);
    next.sources = evidence.sources;
    event('sources', 'Listing gallery', 'done', evidence.detail);
  } else {
    const intake = await inspectListing(next.listingUrl, next.sources);
    if (intake.status !== 'ready') throw new Error(intake.summary);
    next.sources = intake.sources;
  }
  next = await enrichRoomSources(next, (label, detail, failed) =>
    event('room-sources', label, failed ? 'failed' : 'done', detail, modelName),
  );
  next = await addSourceFixtures(next);
  const beforeChecks = verifyScene(state.scene),
    afterChecks = verifyScene(next);
  if (hasRouteRegression(beforeChecks, afterChecks) || (beforeChecks.passed && !afterChecks.passed))
    throw new Error(
      'Source detail additions introduced a collision or blocked destination; previous scene retained.',
    );
  commit(next, 'Room sources and finishes updated. Building fresh room views for comparison.');
  state.workflow!.roomReviews = [];
  state.modelUrl = await renderScene(state.scene);
  await reviewAllRooms();
}
async function approve(body: unknown) {
  checkpoint();
  const approved = approveAssets(state.scene, state.workflow || emptyWorkflow(), body);
  let scene = approved.scene;
  state.workflow = approved.workflow;
  state.lastAction =
    'Approval received. Checking the chosen item dimensions and routes before Blender generation.';
  event(
    'approval',
    'Items approved',
    'done',
    state.workflow.approvedAssetIds.length +
      ' items approved using ' +
      state.workflow.approvalMode +
      ' mode.',
  );
  let checks = verifyScene(scene);
  if (!checks.passed) {
    event(
      'geometry',
      'Fit approved assets',
      'running',
      'Testing bounded placements without resizing approved items.',
    );
    const fitted = suggestRepair(scene);
    scene = fitted.scene;
    checks = verifyScene(scene);
    event('geometry', 'Fit approved assets', checks.passed ? 'done' : 'failed', fitted.summary);
  }
  if (!checks.passed)
    throw new Error(
      'The approved dimensions could not be placed without geometry failures. Review item sizes or selections; Blender was not started.',
    );
  state.scene = scene;
  state.verification = checks;
  for (const asset of state.workflow.assets) {
    const object = scene.objects.find((o) => o.id === asset.id);
    if (object) {
      asset.position = [...object.position];
      asset.rotation = object.rotation;
    }
  }
  state.modelUrl = await renderScene(scene);
  state.workflow.phase = 'review';
  try {
    const review = recordVisualReview(
      await inspectScene(scene, renderPathForModel(state.modelUrl)),
    );
    state.lastAction =
      review.status === 'ready-for-human-review'
        ? 'The fresh scene passed geometric checks and the provisional visual threshold. Ready for your review.'
        : 'The fresh scene has unresolved visual findings. Review them before accepting the reconstruction.';
  } catch (error) {
    state.workflow.phase = 'needs-review';
    state.workflow.review = undefined;
    state.lastAction =
      'The approved home was built, but visual inspection could not complete: ' + safeError(error);
  }
  if (
    state.workflow.review?.status === 'needs-repair' &&
    state.workflow.review.findings.some(
      (f) => f.category === 'placement' || f.category === 'appearance',
    )
  ) {
    event(
      'visual-repair',
      'Automatic review loop',
      'running',
      'Approval permits up to two bounded movable-object repair, render and inspection attempts. Structural and evidence findings stay assigned to human review.',
    );
    await visualRepair();
  }
  await reviewAllRooms();
  await save();
}
async function visualRepair() {
  if (!state.workflow?.review)
    throw new Error('Run a visual inspection before requesting a visual repair.');
  if (state.workflow.review.revision !== state.scene.revision)
    throw new Error('The scene changed after its visual review. Inspect the current view first.');
  if (state.workflow.iterations >= state.workflow.maxIterations)
    throw new Error(
      'Two visual repair attempts have already run. Review the remaining findings manually.',
    );
  checkpoint();
  while (state.workflow.iterations < state.workflow.maxIterations) {
    const before = structuredClone(state.scene),
      previousReview = state.workflow.review!,
      beforeChecks = verifyScene(before);
    if (previousReview.status === 'ready-for-human-review') {
      state.lastAction = 'The current scene already meets the provisional review threshold.';
      break;
    }
    const humanFindings = previousReview.findings.filter(
      (f) => f.category === 'structure' || f.category === 'evidence',
    );
    const repairable = previousReview.findings.filter(
      (f) => f.category === 'placement' || f.category === 'appearance',
    );
    if (!repairable.length) {
      state.workflow.phase = 'needs-review';
      state.lastAction = humanFindings.length
        ? 'Remaining structural or evidence findings require human plan review; fixed architecture was preserved.'
        : 'No concrete movable-object repair was proposed. Human review is required.';
      break;
    }
    state.workflow.iterations++;
    state.workflow.phase = 'review';
    event(
      'visual-repair',
      'Visual repair attempt ' + state.workflow.iterations,
      'running',
      'Only approved movable-object positions, rotations and colors may change. Fixed architecture and dimensions remain unchanged.',
    );
    try {
      const answer = await call<{ patches: PlacementPatch[]; summary: string }>(
        'visual-repair',
        'Visual repair planner',
        'Repair only the listed placement/appearance findings using existing movable unpinned objects. Preserve dimensions, fixed structure, source evidence and pinned items. Return {patches:[{objectId,position:[x,y,z],rotation,color}],summary}. No patch may move walls, stairs, counters, or change dimensions. If a finding needs a structural change, leave it for human review. Scene:' +
          compact(before) +
          ' Findings:' +
          JSON.stringify(repairable),
        [],
        2500,
      );
      let candidate = applyPatches(before, answer.patches),
        checks = verifyScene(candidate);
      if (!checks.passed) {
        const fitted = suggestRepair(candidate);
        candidate = fitted.scene;
        checks = verifyScene(candidate);
        event('geometry', 'Visual repair geometry check', 'done', fitted.summary);
      }
      if (!checks.passed || hasRouteRegression(beforeChecks, checks)) {
        state.workflow.phase = 'needs-review';
        state.lastAction =
          'The proposed visual repair failed geometry checks. Previous scene preserved.';
        event('visual-repair', 'Repair rejected', 'failed', state.lastAction);
        break;
      }
      if (JSON.stringify(candidate.objects) === JSON.stringify(before.objects)) {
        state.workflow.phase = 'needs-review';
        state.lastAction =
          'No supported movable-object change was proposed. Remaining findings need human review.';
        break;
      }
      candidate.revision = before.revision + 1;
      const candidateUrl = await renderScene(candidate),
        review = retainHumanFindings(
          previousReview,
          await inspectScene(candidate, renderPathForModel(candidateUrl)),
        );
      if (!visualImproved(previousReview, review)) {
        state.workflow.phase = 'needs-review';
        state.lastAction =
          'Fresh inspection showed no improvement. The previous accepted scene and unresolved findings were retained.';
        event('visual-repair', 'No improvement', 'failed', state.lastAction);
        break;
      }
      state.scene = candidate;
      state.modelUrl = candidateUrl;
      state.verification = checks;
      state.verification.sceneRevision = candidate.revision;
      recordVisualReview(review);
      state.lastAction =
        state.workflow.review?.status === 'ready-for-human-review'
          ? 'Visual repair improved the scene; geometric checks and provisional visual threshold pass.'
          : 'Visual repair improved the scene; unresolved findings remain visible.';
      await save();
      if (state.workflow.review?.status === 'ready-for-human-review') break;
    } catch (error) {
      state.workflow.phase = 'needs-review';
      state.lastAction =
        'Visual repair stopped without replacing the accepted scene: ' + safeError(error);
      event('visual-repair', 'Repair stopped', 'failed', state.lastAction);
      break;
    }
  }
  if (state.workflow.review?.status !== 'ready-for-human-review')
    state.workflow.phase = 'needs-review';
  await save();
}
function requestedFloor(value: unknown): number {
  const floorZ = value === undefined ? 0 : Number(value);
  if (
    !Number.isFinite(floorZ) ||
    !state.scene.rooms.some((room) => Math.abs(room.floorZ - floorZ) < 0.01)
  )
    throw new Error('Choose an available floor.');
  return floorZ;
}
async function furnish(prompt: string, floorZ = 0) {
  if (!prompt.trim()) throw new Error('Describe what you want to change.');
  checkpoint();
  const answer = await call<{
    additions: { kind: string; position?: Vec3; rotation?: number; color?: string }[];
    patches: PlacementPatch[];
    summary: string;
  }>(
    'furnish',
    'Furnishing planner',
    'You furnish an existing home in response to a real user request. Metres, floorXY,Zup, positions CENTER, rotations radians. Do not change architecture or fixed objects. Allowed furniturecatalog:' +
      JSON.stringify(catalog) +
      '. Use the rooms at the selected floor elevation, avoid stairs and keep requested routes clear. Return {additions:[{kind,position:[x,y,z],rotation,color}],patches:[{objectId,position,rotation}],summary:string}. Add requestedobjects only; if already present edit instead of duplicate. Current scene:' +
      compact(state.scene) +
      '\nSelected floor elevation: ' +
      floorZ +
      ". Add new furniture on this floor, with center Z equal to floor elevation plus half item height. Preserve each existing item's floor." +
      '\nUser request:' +
      prompt,
    [],
    3500,
  );
  let next = applyPatches(state.scene, answer.patches || []);
  for (const add of (answer.additions || []).slice(0, 6)) {
    const template = catalog.find((o) => o.kind === add.kind);
    if (!template) continue;
    const o = structuredClone(template);
    o.id = 'furniture-' + o.kind + '-' + randomUUID().slice(0, 6);
    const p = checkedVector(add.position);
    const room =
      next.rooms.find((r) => r.floorZ === floorZ && /living|bedroom|lounge/i.test(r.name)) ||
      next.rooms.find((r) => r.floorZ === floorZ)!;
    const xs = room.polygon.map((p) => p[0]),
      ys = room.polygon.map((p) => p[1]);
    o.position = [
      p?.[0] ?? (Math.min(...xs) + Math.max(...xs)) / 2,
      p?.[1] ?? (Math.min(...ys) + Math.max(...ys)) / 2,
      floorZ + o.dimensions[2] / 2,
    ];
    if (Number.isFinite(add.rotation)) o.rotation = add.rotation!;
    if (/^#[0-9a-f]{6}$/i.test(add.color || '')) o.color = add.color!;
    next.objects.push(o);
  }
  commit(next, answer.summary || 'Furniture placement proposed.');
  event(
    'geometry',
    'Test furniture layout',
    'done',
    state.verification!.passed
      ? 'All routes and geometry checks pass.'
      : state.verification!.issues.length + ' issues detected.',
  );
  if (!state.verification!.passed) await repairCurrent();
}
const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      const u = new URL(origin),
        port = String(process.env.PORT || 5173);
      if (
        u.protocol !== 'http:' ||
        !['localhost', '127.0.0.1'].includes(u.hostname) ||
        u.port !== port
      )
        throw new Error();
    } catch {
      res.status(403).json({ error: 'Requests must come from this local studio.' });
      return;
    }
  }
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Send application/json for studio changes.' });
    return;
  }
  next();
});
app.use(express.json({ limit: '12mb' }));
app.use('/generated', express.static(path.resolve('public/generated')));
app.use('/evidence', express.static(path.resolve('public/evidence')));
app.get('/api/state', (_req, res) => res.json(state));
app.get('/api/catalog', (_req, res) => res.json(catalog));
app.get('/api/workspaces', async (_req, res) =>
  res.json({ activeId: state.workspaceId, workspaces: await listWorkspaces() }),
);
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, model: modelName, configured, busy: state.busy }),
);
app.get('/api/export', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="listing2living-scene.json"');
  res.json(state.scene);
});
function mutation(route: string, handler: (body: any) => Promise<void> | void) {
  app.post(route, async (req, res) => {
    if (state.busy) {
      res
        .status(409)
        .json({ error: 'An agent is already working. Please wait for this step to finish.' });
      return;
    }
    const previous = snapshot();
    state.busy = true;
    try {
      await projectContext.run(state.workspaceId!, () => handler(req.body || {}));
      await save();
      res.json({ ...state, busy: false });
    } catch (e) {
      rollback(previous, safeError(e));
      event('request', 'Request', 'failed', state.lastAction);
      await save().catch(() => {});
      res.status(400).json({ error: state.lastAction });
    } finally {
      state.busy = false;
    }
  });
}
function backgroundJob(route: string, prepare: (body: any) => () => Promise<void>) {
  app.post(route, (req, res) => {
    if (state.busy) {
      res.status(409).json({ error: 'A job is already running.' });
      return;
    }
    try {
      const run = prepare(req.body || {}),
        previous = snapshot();
      state.busy = true;
      const contextId = req.body?.url ? propertyKey(String(req.body.url)) : state.workspaceId!;
      void projectContext
        .run(contextId, run)
        .catch((e) => {
          rollback(previous, safeError(e));
          event('workflow', 'Workflow stopped', 'failed', state.lastAction);
        })
        .finally(async () => {
          try {
            await save();
          } catch (error) {
            state.lastAction =
              'The latest job could not be saved: ' +
              safeError(error) +
              '. Keep the studio open and retry saving before switching homes.';
            event('storage', 'Save home', 'failed', state.lastAction);
          } finally {
            state.busy = false;
          }
        });
      res.status(202).json({ started: true });
    } catch (e) {
      res.status(400).json({ error: safeError(e) });
    }
  });
}
backgroundJob('/api/intake', (body) => {
  const url = String(body.url || '');
  propertyKey(url);
  return async () => {
    state.intake = undefined;
    state.lastAction = 'Checking listing photos and floor-plan scale. Your open home is preserved.';
    event('intake', 'Check listing', 'running', url);
    const known =
      propertyKey(url) === propertyKey(demoUrl) ? (curatedSources as SceneSpec['sources']) : [];
    state.intake = await inspectListing(url, known, (detail) =>
      event('intake', 'Read evidence', 'running', detail, modelName),
    );
    const dir = projectDirectory(state.intake.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'intake.json'), JSON.stringify(state.intake, null, 2));
    state.lastAction = state.intake.summary;
    event(
      'intake',
      'Input sufficiency',
      state.intake.status === 'ready' ? 'done' : 'failed',
      state.intake.summary,
      modelName,
    );
  };
});
mutation('/api/workspaces/select', async (body) => {
  const id = String(body.id || '');
  const saved = await loadWorkspace(id);
  verifyScene(saved.scene);
  await save();
  state.workspaceId = id;
  state.scene = saved.scene;
  state.modelUrl = saved.modelUrl;
  state.workflow = saved.workflow || emptyWorkflow();
  state.events = saved.events || [];
  state.visualReview = saved.visualReview;
  state.visualIssues = saved.visualIssues;
  state.visualReviewRevision = saved.visualReviewRevision;
  state.intake = saved.intake;
  history.splice(0, history.length, ...(saved.history || []));
  state.verification = verifyScene(state.scene);
  state.lastAction =
    'Opened saved home. Its source files, generated assets, and review history are preserved.';
});
backgroundJob('/api/refresh-sources', () => {
  if (!state.workflow?.approvalMode)
    throw new Error('Approve the plan and item selection before rebuilding its room details.');
  return refreshSources;
});
backgroundJob('/api/review-rooms', () => {
  if (!state.workflow?.approvalMode)
    throw new Error('Approve the plan and item selection before the final room comparison.');
  return reviewAllRooms;
});
backgroundJob('/api/repair-room-appearance', () => {
  const reviews = state.workflow?.roomReviews;
  if (
    !reviews?.length ||
    reviews.some((r) => r.revision !== state.scene.revision) ||
    !state.modelUrl
  )
    throw new Error('Compare the current rooms before refining finishes.');
  if ((state.workflow?.roomRepairIterations || 0) >= 2)
    throw new Error('Two room finish attempts have run. Remaining differences need human review.');
  return async () => {
    const before = structuredClone(state.scene),
      flow = state.workflow!;
    flow.roomRepairIterations = (flow.roomRepairIterations || 0) + 1;
    const renders = await roomRenderPathsForModel(state.modelUrl!);
    const candidate = await refineRoomFinishes(before, reviews, renders, (label, detail) =>
      event('room-repair', label, 'done', detail, modelName),
    );
    if (JSON.stringify(candidate.rooms) === JSON.stringify(before.rooms)) {
      state.lastAction = 'No supported finish correction was found. Existing home retained.';
      return;
    }
    candidate.revision = before.revision + 1;
    const url = await renderScene(candidate);
    const nextReviews = await evaluateRooms(
      candidate,
      await roomRenderPathsForModel(url),
      (label, detail, failed) =>
        event('room-review', label, failed ? 'failed' : 'done', detail, modelName),
    );
    const total = (rs: typeof reviews) => rs.reduce((sum, r) => sum + r.scores.materials, 0);
    const regressed = reviews.some(
      (r) =>
        r.status === 'ready-for-human-review' &&
        nextReviews.find((n) => n.roomId === r.roomId)?.status !== 'ready-for-human-review',
    );
    if (regressed || total(nextReviews) <= total(reviews)) {
      state.lastAction =
        'Fresh room comparisons did not show a safe improvement. Previous home and review retained.';
      return;
    }
    checkpoint();
    state.scene = candidate;
    state.modelUrl = url;
    flow.roomReviews = nextReviews;
    state.verification = verifyScene(candidate);
    recordVisualReview(aggregateRoomReviews(candidate, nextReviews, state.verification));
    state.lastAction = 'Room finishes improved against source photos. ' + flow.review!.summary;
  };
});
backgroundJob('/api/build', (body) => {
  const url = String(body.url || '');
  if (state.intake?.id !== propertyKey(url) || state.intake.status !== 'ready')
    throw new Error('Check this listing and resolve missing source information before building.');
  return () => build(url);
});
backgroundJob('/api/approve', (body) => {
  const approvedBody = approvalSchema.parse(body);
  approveAssets(state.scene, state.workflow || emptyWorkflow(), approvedBody);
  return () => approve(approvedBody);
});
backgroundJob('/api/visual-repair', () => {
  if (!state.workflow?.review)
    throw new Error('Run a visual inspection before requesting a repair.');
  if (state.workflow.review.revision !== state.scene.revision)
    throw new Error('Inspect the current scene before requesting a visual repair.');
  if (state.workflow.iterations >= state.workflow.maxIterations)
    throw new Error('The two-attempt visual repair limit has been reached.');
  return visualRepair;
});
mutation('/api/furnish', (body) =>
  furnish(String(body.prompt || '').slice(0, 1500), requestedFloor(body.floorZ)),
);
mutation('/api/verify', () => {
  state.verification = verifyScene(state.scene);
  state.lastAction = state.verification.passed
    ? 'All routes and geometry checks pass.'
    : state.verification.issues.length + ' issues found.';
  event('geometry', 'Check layout', 'done', state.lastAction);
});
mutation('/api/repair', async () => {
  checkpoint();
  await repairCurrent();
});
mutation('/api/stress-test', () => {
  checkpoint();
  commit(
    createStressTest(state.scene),
    'Deliberate stress test: a bench blocks the entrance. Run Repair to restore passage.',
  );
  event(
    'stress',
    'Deliberate obstruction',
    'done',
    'Stress-test furniture added. This is an intentional test, not a source reconstruction error.',
  );
});
mutation('/api/undo', () => {
  const previous = history.pop();
  if (!previous) throw new Error('Nothing to undo yet.');
  commit(previous, 'Previous furniture arrangement restored.');
});
mutation('/api/object', (body) => {
  const obj = state.scene.objects.find((o) => o.id === body.objectId);
  if (!obj?.movable || obj.pinned)
    throw new Error('Only movable, unpinned furniture can be edited.');
  checkpoint();
  commit(applyPatches(state.scene, [body]), 'Furniture updated; geometry checks refreshed.');
});
mutation('/api/add', (body) => {
  const template = catalog.find((o) => o.kind === body.kind);
  if (!template) throw new Error('Choose a furniture item from the library.');
  checkpoint();
  const next = structuredClone(state.scene);
  const object = structuredClone(template);
  const floorZ = requestedFloor(body.floorZ);
  if (floorZ > 0 || next.id !== initial.id) {
    const room =
      next.rooms.find(
        (room) => room.floorZ === floorZ && /living|bedroom|lounge/i.test(room.name),
      ) || next.rooms.find((room) => room.floorZ === floorZ)!;
    const xs = room.polygon.map((p) => p[0]),
      ys = room.polygon.map((p) => p[1]);
    object.position = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      floorZ + object.dimensions[2] / 2,
    ];
  }
  object.id = 'furniture-' + object.kind + '-' + randomUUID().slice(0, 6);
  next.objects.push(object);
  commit(next, object.name + ' added.');
});
backgroundJob('/api/rebuild', () => {
  if (!state.workflow?.approvalMode)
    throw new Error('Approve your item selection before generating the scene.');
  return async () => {
    const next = await addSourceFixtures(structuredClone(state.scene));
    if (JSON.stringify(next) !== JSON.stringify(state.scene)) {
      if (!verifyScene(next).passed)
        throw new Error('Updated room details need a geometry correction before building.');
      checkpoint();
      commit(next, 'Source-based room details and viewing angles updated.');
    }
    event(
      'blender',
      'Rebuild this home',
      'running',
      'Rebuilding the current approved arrangement and every room view.',
    );
    state.modelUrl = await buildBlender(state.scene);
    state.verification = verifyScene(state.scene);
    state.workflow!.phase = 'needs-review';
    state.lastAction = 'Home rebuilt. Comparing every room with its source photos.';
    event(
      'blender',
      'Build both floors',
      'done',
      'Fresh Blender model and render published; current furniture preserved.',
    );
    await reviewAllRooms();
  };
});
mutation('/api/remove', (body) => {
  const o = state.scene.objects.find((o) => o.id === body.objectId);
  if (!o?.movable || o.pinned) throw new Error('This object cannot be removed.');
  checkpoint();
  const next = structuredClone(state.scene);
  next.objects = next.objects.filter((o) => o.id !== body.objectId);
  commit(next, 'Furniture removed.');
});
mutation('/api/visual-review', async (body) => {
  if (
    !state.workflow?.approvalMode ||
    ['awaiting-approval', 'analyzing'].includes(state.workflow.phase)
  )
    throw new Error(
      'Approve the plan and selected items before requesting the final visual review.',
    );
  if (typeof body.image !== 'string' || !body.image.startsWith('data:image/'))
    throw new Error('A rendered scene capture is required.');
  const answer = recordVisualReview(await inspectScene(state.scene, body.image));
  event('visual', 'Argon visual inspection', 'done', state.visualReview!);
  state.lastAction =
    answer.status === 'ready-for-human-review'
      ? 'Current browser view inspected; geometry and provisional visual threshold pass. Ready for human review.'
      : 'Current browser view inspected. Unresolved findings and missing evidence remain visible.';
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
} else {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { port: Number(process.env.PORT || 5173) + 1 },
      watch: { ignored: ['**/work/**', '**/runtime/**', '**/public/generated/**'] },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 5173);
app.listen(port, '127.0.0.1', () =>
  console.log(
    'Listing2Living: http://127.0.0.1:' +
      port +
      ' | ' +
      modelName +
      ' ' +
      (configured ? 'configured' : 'needs API key'),
  ),
);
