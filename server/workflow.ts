import { z } from 'zod';
import { objectFloorZ } from '../shared/verification.js';
import type {
  AssetProposal,
  PlanInterpretation,
  SceneObject,
  SceneSpec,
  Verification,
  VisualAssessment,
  WorkflowState,
} from '../shared/types.js';

export const vectorSchema = z.tuple([
  z.number().finite().min(-50).max(50),
  z.number().finite().min(-50).max(50),
  z.number().finite().min(-50).max(50),
]);
export const dimensionSchema = z.tuple([
  z.number().finite().min(0.1).max(5),
  z.number().finite().min(0.1).max(5),
  z.number().finite().min(0.005).max(3),
]);
const confidence = z.enum(['high', 'medium', 'low']);
export const patchSchema = z.object({
  objectId: z.string(),
  position: vectorSchema.optional(),
  rotation: z.number().finite().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});
export const planSchema = z.object({
  summary: z.string(),
  rooms: z
    .array(
      z.object({
        roomId: z.string(),
        name: z.string(),
        width: z.number().finite().positive().max(30),
        depth: z.number().finite().positive().max(30),
        ceilingHeight: z.number().finite().min(2).max(5),
        dimensionBasis: z.enum(['plan', 'inferred']),
        confidence,
        evidence: z.string(),
      }),
    )
    .min(1),
  scaleNote: z.string(),
  uncertainties: z.array(z.string()).default([]),
});
export const assetsSchema = z.object({
  assets: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().min(1).max(100),
        kind: z.enum(['sofa', 'desk', 'chair', 'table', 'rug']),
        dimensions: dimensionSchema,
        position: vectorSchema,
        rotation: z.number().finite(),
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
        sourceIds: z.array(z.string()),
        sourceDescription: z.string(),
        dimensionReasoning: z.string(),
        confidence,
        origin: z.enum(['photo', 'suggested']),
        selected: z.boolean().default(true),
      }),
    )
    .max(8),
  summary: z.string().default(''),
});
export const approvalSchema = z.object({
  mode: z.enum(['reviewed', 'suggested']),
  items: z
    .array(
      z.object({ id: z.string(), selected: z.boolean(), dimensions: dimensionSchema.optional() }),
    )
    .max(20)
    .optional(),
});
export const assessmentSchema = z.object({
  summary: z.string(),
  scores: z.object({
    layout: z.number().finite().min(0).max(100),
    objects: z.number().finite().min(0).max(100),
    materials: z.number().finite().min(0).max(100),
  }),
  findings: z
    .array(
      z.object({
        id: z.string().optional(),
        category: z.enum(['placement', 'appearance', 'structure', 'evidence']),
        severity: z.enum(['major', 'minor']),
        message: z.string(),
        objectIds: z.array(z.string()).default([]),
        recommendation: z.string(),
      }),
    )
    .max(30),
  evidenceSufficient: z.boolean().default(true),
});

export const emptyWorkflow = (): WorkflowState => ({
  phase: 'idle',
  assets: [],
  approvedAssetIds: [],
  iterations: 0,
  maxIterations: 2,
});
export function normalizePlan(raw: unknown, scene: SceneSpec): PlanInterpretation {
  const plan = planSchema.parse(raw);
  const ids = new Set(scene.rooms.map((room) => room.id));
  const labels: Record<string, [number, number]> = {
    living: [4.2418, 3.302],
    kitchen: [2.8956, 2.5146],
    bathroom: [2.1336, 2.7432],
    'upper-bedroom-west': [3.175, 7.8486],
    'upper-bedroom-east': [4.191, 6.477],
    'upper-bathroom': [2.0574, 2.54],
    'upper-closet-east': [3.1496, 2.0574],
    'upper-closet-west': [4.5466, 2.8194],
  };
  const seen = new Set<string>();
  for (const room of plan.rooms) {
    if (!ids.has(room.roomId) || seen.has(room.roomId))
      throw new Error('Floor-plan interpretation contains an unknown or duplicate room.');
    seen.add(room.roomId);
    const known = scene.id === 'brannan-lower-floor' ? labels[room.roomId] : undefined;
    const matches =
      known &&
      ((Math.abs(room.width - known[0]) < 0.06 && Math.abs(room.depth - known[1]) < 0.06) ||
        (Math.abs(room.width - known[1]) < 0.06 && Math.abs(room.depth - known[0]) < 0.06));
    if (room.dimensionBasis === 'plan' && !matches) {
      room.dimensionBasis = 'inferred';
      room.confidence = 'low';
      room.evidence +=
        ' These dimensions do not match a verified printed plan label and remain estimates.';
    }
    room.evidence += ' Ceiling height is inferred, not a printed plan measurement.';
    if (['upper-bedroom-west', 'upper-closet-west'].includes(room.roomId))
      room.evidence +=
        ' Printed dimensions describe extents of a nonrectangular room; traced polygon vertices remain approximate.';
  }
  for (const room of scene.rooms)
    if (!seen.has(room.id)) {
      const xs = room.polygon.map((p) => p[0]),
        ys = room.polygon.map((p) => p[1]);
      plan.rooms.push({
        roomId: room.id,
        name: room.name,
        width: Math.max(...xs) - Math.min(...xs),
        depth: Math.max(...ys) - Math.min(...ys),
        ceilingHeight: room.ceilingHeight,
        dimensionBasis: 'inferred',
        confidence: 'low',
        evidence:
          'Bounding extent of the event-created source-traced footprint; not a measured room dimension. Ceiling height is inferred.',
      });
    }
  plan.scaleNote +=
    ' The source-traced footprint remains the construction seed; this interpretation does not certify survey accuracy.';
  return plan;
}
export function proposalSet(
  raw: unknown,
  scene: SceneSpec,
  catalog: SceneObject[],
): AssetProposal[] {
  const parsed = assetsSchema.parse(raw),
    photoIds = new Set(scene.sources.filter((s) => s.kind === 'photo').map((s) => s.id));
  const seen = new Set<string>();
  const observed: AssetProposal[] = [];
  for (const candidate of parsed.assets) {
    if (candidate.origin !== 'photo') continue;
    const id = 'proposal-' + candidate.id;
    if (seen.has(id)) throw new Error('Photo analysis returned duplicate asset IDs.');
    seen.add(id);
    if (!candidate.sourceIds.length || candidate.sourceIds.some((id) => !photoIds.has(id)))
      throw new Error('A photo-derived asset must cite available source photos.');
    const floorZ = objectFloorZ(scene, candidate);
    if (floorZ === undefined)
      throw new Error('A photo-derived asset must have its bottom at a modeled floor elevation.');
    observed.push({
      ...candidate,
      id,
      position: [
        candidate.position[0],
        candidate.position[1],
        floorZ + candidate.dimensions[2] / 2,
      ],
      selected: true,
    });
  }
  const suggested = ['sofa', 'desk', 'rug'].map((kind) => {
    const item = catalog.find((o) => o.kind === kind);
    if (!item) throw new Error('Suggested furniture is missing from the catalog.');
    const position = [...item.position] as [number, number, number];
    if (scene.id !== 'brannan-lower-floor') {
      const room = scene.rooms.find((r) => /living|lounge|family/i.test(r.name)) || scene.rooms[0];
      const xs = room.polygon.map((p) => p[0]),
        ys = room.polygon.map((p) => p[1]);
      position[0] = (Math.min(...xs) + Math.max(...xs)) / 2;
      position[1] = (Math.min(...ys) + Math.max(...ys)) / 2;
      position[2] = room.floorZ + item.dimensions[2] / 2;
    }
    return {
      id: 'suggested-' + kind,
      name: item.name,
      kind: item.kind,
      dimensions: [...item.dimensions],
      position,
      rotation: item.rotation,
      color: item.color,
      sourceIds: [],
      sourceDescription:
        'Optional staging suggestion; this item was not identified in the listing photos.',
      dimensionReasoning:
        'Catalog dimensions selected for the traced living-room scale; verify suitability before purchase.',
      confidence: 'low',
      origin: 'suggested',
      selected: observed.length === 0,
    } as AssetProposal;
  });
  return [...observed, ...suggested];
}
export function approveAssets(
  scene: SceneSpec,
  workflow: WorkflowState,
  raw: unknown,
): { scene: SceneSpec; workflow: WorkflowState } {
  if (workflow.phase !== 'awaiting-approval')
    throw new Error('Analyze the listing and review its asset proposal before generating.');
  const body = approvalSchema.parse(raw),
    next = structuredClone(scene),
    flow = structuredClone(workflow);
  const ids = new Set(flow.assets.map((a) => a.id)),
    seen = new Set<string>();
  for (const item of body.items || []) {
    if (!ids.has(item.id) || seen.has(item.id))
      throw new Error('Approval contains an unknown or duplicate asset ID.');
    seen.add(item.id);
  }
  for (const asset of flow.assets) {
    if (body.mode === 'suggested') {
      asset.selected = asset.origin === 'suggested';
      continue;
    }
    const edit = body.items?.find((i) => i.id === asset.id);
    if (edit) {
      asset.selected = edit.selected;
      if (edit.dimensions) {
        const floorZ = objectFloorZ(scene, asset);
        if (floorZ === undefined)
          throw new Error('The proposed item is not assigned to a modeled floor.');
        asset.dimensions = [...edit.dimensions];
        asset.position[2] = floorZ + edit.dimensions[2] / 2;
        asset.dimensionReasoning += ' Dimensions confirmed or edited during user approval.';
      }
    }
  }
  const selected = flow.assets.filter((a) => a.selected);
  if (body.mode === 'suggested' && selected.length !== 3)
    throw new Error('The suggested shortcut requires exactly three available suggestions.');
  next.objects = next.objects.filter((o) => !o.movable);
  for (const asset of selected) {
    const floorZ = objectFloorZ(scene, asset);
    if (floorZ === undefined)
      throw new Error('The approved item is not assigned to a modeled floor.');
    next.objects.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      position: [asset.position[0], asset.position[1], floorZ + asset.dimensions[2] / 2],
      dimensions: [...asset.dimensions],
      rotation: asset.rotation,
      color: asset.color,
      movable: true,
      pinned: false,
      basis: asset.origin === 'photo' ? 'photo' : 'user',
    });
  }
  next.revision = scene.revision + 1;
  flow.approvedAssetIds = selected.map((a) => a.id);
  flow.approvalMode = body.mode;
  flow.phase = 'building';
  flow.iterations = 0;
  flow.review = undefined;
  return { scene: next, workflow: flow };
}
export function normalizeAssessment(
  raw: unknown,
  scene: SceneSpec,
  checks: Verification,
  evidencePresent: boolean,
): VisualAssessment {
  const parsed = assessmentSchema.parse(raw),
    ids = new Set([
      ...scene.objects.map((o) => o.id),
      ...scene.walls.map((w) => w.id),
      ...scene.rooms.map((r) => r.id),
      ...scene.stairs.map((s) => s.id),
    ]);
  const findings = parsed.findings.map((finding, index) => ({
    ...finding,
    id: 'visual-' + scene.revision + '-' + index,
    objectIds: finding.objectIds.filter((id) => ids.has(id)),
  }));
  const enough =
    evidencePresent &&
    parsed.evidenceSufficient &&
    !findings.some((f) => f.category === 'evidence' && f.severity === 'major');
  const ready =
    enough &&
    checks.sceneRevision === scene.revision &&
    checks.passed &&
    Object.values(parsed.scores).every((score) => score >= 70) &&
    !findings.some((f) => f.severity === 'major');
  return {
    revision: scene.revision,
    status: !enough ? 'insufficient-evidence' : ready ? 'ready-for-human-review' : 'needs-repair',
    summary:
      parsed.summary +
      ' Scores are provisional model judgments, not an accuracy or safety certification.',
    scores: parsed.scores,
    threshold: 70,
    findings,
  };
}
export function hasRouteRegression(before: Verification, after: Verification): boolean {
  return before.routes.some(
    (route) =>
      route.passed &&
      !after.routes.find(
        (r) =>
          r.targetId === route.targetId && Math.abs((r.floorZ || 0) - (route.floorZ || 0)) < 0.1,
      )?.passed,
  );
}
export function visualImproved(before: VisualAssessment, after: VisualAssessment): boolean {
  if (after.status === 'insufficient-evidence' && before.status !== 'insufficient-evidence')
    return false;
  if (after.status === 'ready-for-human-review') return true;
  const major = (review: VisualAssessment) =>
    review.findings.filter((f) => f.severity === 'major').length;
  if (major(after) < major(before)) return true;
  if (major(after) > major(before)) return false;
  const score = (review: VisualAssessment) =>
    Object.values(review.scores).reduce((sum, value) => sum + value, 0);
  return score(after) > score(before);
}
export function retainHumanFindings(
  before: VisualAssessment,
  after: VisualAssessment,
): VisualAssessment {
  const human = before.findings.filter(
    (f) => f.category === 'structure' || f.category === 'evidence',
  );
  if (!human.length) return after;
  const result = structuredClone(after);
  for (const finding of human)
    if (
      !result.findings.some((f) => f.category === finding.category && f.message === finding.message)
    )
      result.findings.push({ ...finding, id: finding.id + '-retained' });
  if (result.findings.some((f) => f.category === 'evidence' && f.severity === 'major'))
    result.status = 'insufficient-evidence';
  else if (result.findings.some((f) => f.category === 'structure' && f.severity === 'major'))
    result.status = 'needs-repair';
  result.summary +=
    ' Structural and evidence observations remain for human review because this repair did not change the fixed shell or source evidence.';
  return result;
}
