import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import fixture from '../shared/brannan.json';
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
import { askArgon, configured, modelName, safeError } from './argon.js';
import { collectEvidence, validateListing } from './evidence.js';
import { buildBlender, renderPathForModel } from './blender.js';
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
  if (saved.scene?.id === initial.id) {
    verifyScene(saved.scene);
    state.scene = saved.scene;
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
if (state.modelUrl) {
  try {
    await fs.access(path.join('public', state.modelUrl.split('?')[0]));
  } catch {
    state.modelUrl = null;
  }
}
if (!state.modelUrl)
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
    });
  saveQueue = pending;
  return pending;
}
function snapshot() {
  return structuredClone({
    scene: state.scene,
    modelUrl: state.modelUrl,
    verification: state.verification,
    visualReview: state.visualReview,
    visualIssues: state.visualIssues,
    visualReviewRevision: state.visualReviewRevision,
    workflow: state.workflow,
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
    if (pos) o.position = [pos[0], pos[1], o.dimensions[2] / 2];
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
      (route) => route.passed && !after.routes.find((r) => r.targetId === route.targetId)?.passed,
    )
  )
    return false;
  const count = (v: Verification) => v.issues.filter((i) => i.severity === 'error').length;
  return after.passed || count(after) < count(before);
}
function recordVisualReview(review: VisualAssessment) {
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
    'You are Listing2Living layout repair agent. Correct the actual failures while preserving fixed/pinned objects, furniture dimensions, room geometry and floor Z=0. Canonical metres XY floor, Z up, object position is CENTER and rotation radians. Only move existing movable objects, ideally into living room away from stairs. Return {patches:[{objectId,position:[x,y,z],rotation}],summary}.\nScene: ' +
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
  validateListing(url);
  checkpoint();
  state.events = [];
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
  const evidence = await collectEvidence(url, (fixture as SceneSpec).sources);
  event('sources', 'Read listing', evidence.mode === 'cached' ? 'cached' : 'done', evidence.detail);
  const scene = structuredClone(fixture) as SceneSpec;
  scene.revision = state.scene.revision + 1;
  scene.sources = evidence.sources;
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
    'Interpret the supplied floor plan for this lower floor. Return {summary,rooms:[{roomId,name,width,depth,ceilingHeight,dimensionBasis:"plan"|"inferred",confidence:"high"|"medium"|"low",evidence}],scaleNote,uncertainties:[string]}. Dimensions must be numeric METRES; read printed labels rather than inventing measurements. Ceiling height is inferred. Room IDs must match the supplied seed. Source-traced footprint is an existing event-created approximation and will remain the construction seed. Listing total1420sqft versus plan1379total/434lower must remain an unresolved source discrepancy.\nScene seed:' +
      compact(scene),
    sourcePaths('plan').slice(0, 1),
    4000,
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
      'Choose approximate source-consistent colors. Return {wallColor:"#rrggbb",cabinetColor:"#rrggbb",notes:[string]}. Interior photos show a concrete ceiling, reddish wood floor, dark kitchen cabinets, whitecountertops. These are appearance estimates.',
      sourcePaths('photo').slice(0, 3),
      1200,
    ),
  ]);
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
  const [assets, structure, openings, appearance] = results.map(
    (r) => (r as PromiseFulfilledResult<any>).value,
  );
  scene.rooms.forEach((r) => (r.ceilingHeight = structure.ceilingHeight));
  scene.walls.forEach((w) => {
    w.height = structure.ceilingHeight;
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
  state.scene = scene;
  state.verification = verifyScene(scene);
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
    'The first image is a fresh rendered scene; subsequent images are source photos and then the source floor plan if present. Scope is the lower-floor entry, kitchen, living area and stair approach; upstairs is outside this prototype. Record missing bathroom/closet photo evidence as a limitation. Inspect layout, approved object presence/scale, and material resemblance. Suggested staging objects intentionally differ from empty source photos: do not penalize their existence. Compare architecture to sources, objects to their current scene dimensions and finishes, accounting for camera mismatch. Stair bottom/top fields, when present, are explicit XY endpoints of the generated stair: bottom is lower, top is higher. Cross-check those endpoints before alleging reversed ascent; do not infer compass direction from image left/right. If the perspective is inconclusive, label uncertainty. Return {summary,scores:{layout:0..100,objects:0..100,materials:0..100},evidenceSufficient:boolean,findings:[{category:"placement"|"appearance"|"structure"|"evidence",severity:"major"|"minor",message,objectIds:[string],recommendation}]}. Scores are provisional model judgments;70 is a demo review threshold, NOT measured reconstruction accuracy or safety certification. Report unavailable evidence explicitly. Structural/source contradictions require human review. Scene:' +
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
    const review = await inspectScene(scene, renderPathForModel(state.modelUrl));
    recordVisualReview(review);
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
        review.status === 'ready-for-human-review'
          ? 'Visual repair improved the scene; geometric checks and provisional visual threshold pass.'
          : 'Visual repair improved the scene; unresolved findings remain visible.';
      await save();
      if (review.status === 'ready-for-human-review') break;
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

async function furnish(prompt: string) {
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
      '. Use livingspace avoid stairs and keep requested routes clear. Return {additions:[{kind,position:[x,y,z],rotation,color}],patches:[{objectId,position,rotation}],summary:string}. Add requestedobjects only; if already present edit instead of duplicate. Current scene:' +
      compact(state.scene) +
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
    if (p) o.position = [p[0], p[1], o.dimensions[2] / 2];
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
app.use(express.json({ limit: '12mb' }));
app.use('/generated', express.static(path.resolve('public/generated')));
app.use('/evidence', express.static(path.resolve('public/evidence')));
app.get('/api/state', (_req, res) => res.json(state));
app.get('/api/catalog', (_req, res) => res.json(catalog));
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
      await handler(req.body || {});
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
      void run()
        .catch((e) => {
          rollback(previous, safeError(e));
          event('workflow', 'Workflow stopped', 'failed', state.lastAction);
        })
        .finally(() => {
          state.busy = false;
          void save();
        });
      res.status(202).json({ started: true });
    } catch (e) {
      res.status(400).json({ error: safeError(e) });
    }
  });
}
backgroundJob('/api/build', (body) => {
  const url = validateListing(String(body.url || ''));
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
mutation('/api/furnish', (body) => furnish(String(body.prompt || '').slice(0, 1500)));
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
  object.id = 'furniture-' + object.kind + '-' + randomUUID().slice(0, 6);
  next.objects.push(object);
  commit(next, object.name + ' added.');
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
  const answer = await inspectScene(state.scene, body.image);
  recordVisualReview(answer);
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
    server: { middlewareMode: true, hmr: { port: Number(process.env.PORT || 5173) + 1 } },
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
