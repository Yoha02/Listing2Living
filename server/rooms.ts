import path from 'node:path';
import { z } from 'zod';
import { askArgon, safeError } from './argon.js';
import type {
  RoomAssessment,
  SceneSpec,
  Source,
  VisualAssessment,
  Verification,
} from '../shared/types.js';

type Progress = (label: string, detail: string, failed?: boolean) => void;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const roomAppearanceSchema = z.object({
  wallColor: color,
  floorColor: color,
  floorMaterial: z.enum(['wood', 'tile', 'carpet', 'concrete']),
  ceilingColor: color,
  // Descriptive evidence is already bounded by the model response token budget.
  // Preserve all observations, including feature tokens late in the response.
  details: z.array(z.string()),
});
const scoreSchema = z.object({
  layout: z.number().min(0).max(100),
  objects: z.number().min(0).max(100),
  materials: z.number().min(0).max(100),
});
const roomReviewSchema = z.object({
  scores: scoreSchema,
  summary: z.string(),
  evidenceSufficient: z.boolean(),
  majorMismatch: z.boolean(),
  recommendations: z.array(z.string()),
});
const local = (s: Source) => path.join('public', s.localUrl!);
export async function eachLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  const failed = workers.find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results;
}
export function matchedRoomPhotos(scene: SceneSpec, roomId: string): Source[] {
  const room = scene.rooms.find((r) => r.id === roomId);
  return scene.sources.filter(
    (s) =>
      s.kind === 'photo' &&
      s.localUrl &&
      (s.roomIds?.includes(roomId) || room?.sourceIds?.includes(s.id)),
  );
}
export function objectsInRoom(scene: SceneSpec, roomId: string) {
  const room = scene.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++) {
      const a = room.polygon[i],
        b = room.polygon[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
        hit = !hit;
    }
    return hit;
  };
  return scene.objects.filter(
    (o) =>
      (o.movable
        ? Math.abs(o.position[2] - o.dimensions[2] / 2 - room.floorZ) < 0.15
        : o.position[2] >= room.floorZ && o.position[2] < room.floorZ + room.ceilingHeight) &&
      inside(o.position[0], o.position[1]),
  );
}
export async function enrichRoomSources(scene: SceneSpec, progress: Progress): Promise<SceneSpec> {
  const next = structuredClone(scene),
    plan = next.sources.find((s) => s.kind === 'plan' && s.localUrl);
  const unmapped = next.sources.filter(
    (s) => s.kind === 'photo' && s.localUrl && !s.roomIds?.length,
  );
  const batches = Array.from({ length: Math.ceil(unmapped.length / 4) }, (_, i) =>
    unmapped.slice(i * 4, i * 4 + 4),
  );
  await eachLimit(batches, 3, async (batch) => {
    const result = await askArgon<{
      matches: { sourceId: string; roomIds: string[]; certain: boolean }[];
    }>(
      'Match these listing photos to modeled rooms, using the final image (floor plan) for topology when present. Only map a photo when its room can reasonably be identified; common amenities/exteriors must have no room IDs. Treat floor assignment as uncertain when ambiguous. Return {matches:[{sourceId,roomIds:[known room IDs],certain:boolean}]}. Photos in order:' +
        JSON.stringify(batch.map((s) => ({ id: s.id, label: s.label }))) +
        ' Rooms:' +
        JSON.stringify(next.rooms),
      [...batch.map(local), ...(plan ? [local(plan)] : [])],
      2500,
    );
    const parsed = z
      .object({
        matches: z.array(
          z.object({ sourceId: z.string(), roomIds: z.array(z.string()), certain: z.boolean() }),
        ),
      })
      .parse(result.value);
    for (const m of parsed.matches) {
      const source = batch.find((s) => s.id === m.sourceId);
      if (source && m.certain)
        source.roomIds = m.roomIds.filter((id) => next.rooms.some((r) => r.id === id));
    }
  });
  await eachLimit(next.rooms, 3, async (room) => {
    const photos = matchedRoomPhotos(next, room.id);
    room.sourceIds = photos.map((s) => s.id);
    if (!photos.length) {
      room.appearance ??= {
        wallColor: '#e9e6dc',
        floorColor: '#93623d',
        floorMaterial: 'wood',
        ceilingColor: '#e5e3dd',
        details: ['No matching interior photo; finish is inferred.'],
        basis: 'inferred',
      };
      room.appearance.basis = 'inferred';
      progress(room.name, 'No direct source photo. Appearance remains explicitly inferred.');
      return;
    }
    const previous = room.appearance;
    const result = await askArgon<unknown>(
      'Describe source-consistent materials for this room. Return {wallColor:"#rrggbb",floorColor:"#rrggbb",floorMaterial:"wood"|"tile"|"carpet"|"concrete",ceilingColor:"#rrggbb",details:[string]}. Use approximate base material colors, not shadows/overexposure. Identify visible distinctive features. Include the exact token feature:closet-rail ONLY if a wall-mounted clothes rail is visible, and feature:concrete-accent-wall ONLY if a substantial exposed concrete wall is visible. Do not infer furniture from other rooms. Room:' +
        JSON.stringify(room) +
        ' Source photos:' +
        JSON.stringify(photos.slice(0, 3).map((s) => ({ id: s.id, label: s.label }))),
      photos.slice(0, 3).map(local),
      1800,
    );
    room.appearance = { ...roomAppearanceSchema.parse(result.value), basis: 'photo' };
    if (previous?.details.includes('No matching interior photo; finish is inferred.'))
      room.appearance.details = room.appearance.details.filter((d) => !d.includes('No matching'));
    progress(
      room.name,
      photos.length +
        ' source photo(s) linked; source-based finishes and distinctive features recorded.',
    );
  });
  return next;
}
export function normalizeRoomReview(
  raw: unknown,
  scene: SceneSpec,
  roomId: string,
  renderUrl: string | undefined,
): RoomAssessment {
  const room = scene.rooms.find((r) => r.id === roomId)!;
  const photos = matchedRoomPhotos(scene, roomId);
  const value = roomReviewSchema.parse(raw);
  const status =
    !photos.length || !renderUrl || !value.evidenceSufficient
      ? 'insufficient-evidence'
      : value.majorMismatch || Object.values(value.scores).some((n) => n < 70)
        ? 'needs-repair'
        : 'ready-for-human-review';
  return {
    roomId,
    roomName: room.name,
    revision: scene.revision,
    status,
    sourceIds: photos.map((s) => s.id),
    renderUrl,
    scores: value.scores,
    summary: value.summary,
    recommendations: value.recommendations,
  };
}
export async function evaluateRooms(
  scene: SceneSpec,
  renders: Record<string, string>,
  progress: Progress,
): Promise<RoomAssessment[]> {
  return eachLimit(scene.rooms, 3, async (room) => {
    const photos = matchedRoomPhotos(scene, room.id),
      render = renders[room.id];
    const renderUrl = render
      ? '/' + path.relative(path.resolve('public'), render).replaceAll('\\', '/')
      : undefined;
    if (!photos.length || !render) {
      const result = normalizeRoomReview(
        {
          scores: { layout: 0, objects: 0, materials: 0 },
          summary: !photos.length
            ? 'No matching source photo; visual similarity cannot be judged.'
            : 'No fresh room render is available.',
          evidenceSufficient: false,
          majorMismatch: false,
          recommendations: [
            !photos.length
              ? 'Add a source photo of this room before accepting its resemblance.'
              : 'Render this room before judging its resemblance.',
          ],
        },
        scene,
        room.id,
        renderUrl,
      );
      progress(room.name, result.summary);
      return result;
    }
    progress(
      room.name,
      'Comparing the actual room render with ' + photos.length + ' matched source photo(s).',
    );
    try {
      const plan = scene.sources.find(
        (s) =>
          s.kind === 'plan' && s.localUrl && (s.floorZ === room.floorZ || s.floorZ === undefined),
      );
      const result = await askArgon<unknown>(
        'You are the final room-by-room reconstruction critic. FIRST image is the actual rendered room. Next images are reference photos of this room; final image is the floor plan if listed. Compare architecture, scale, openings, wall/floor/ceiling materials and visible fixed features. Camera mismatch is not itself an error. Never treat a blank wall, obstructed view, or missing evidence as a pass. Approved staging may differ from empty source photos. Objects in adjoining rooms or outside the view are not missing from this room. Distinguish important architectural/fixture differences from optional personal decorations; a missing sticker is a minor detail. Report substantial differences honestly, including missing fixtures or unsupported structural details. Return {scores:{layout:0..100,objects:0..100,materials:0..100},summary,evidenceSufficient:boolean,majorMismatch:boolean,recommendations:[specific actionable strings]}. These are subjective model scores, not measured accuracy;70 is only a demo threshold. Room:' +
          JSON.stringify(room) +
          ' Photo labels:' +
          JSON.stringify(photos.slice(0, 2).map((s) => s.label)) +
          ' Plan included:' +
          Boolean(plan) +
          ' Objects whose centers are inside this room:' +
          JSON.stringify(objectsInRoom(scene, room.id)),
        [render, ...photos.slice(0, 2).map(local), ...(plan ? [local(plan)] : [])],
        2400,
      );
      const review = normalizeRoomReview(result.value, scene, room.id, renderUrl);
      progress(room.name, review.status + ': ' + review.summary);
      return review;
    } catch (error) {
      const review = normalizeRoomReview(
        {
          scores: { layout: 0, objects: 0, materials: 0 },
          summary: 'Room inspection could not complete: ' + safeError(error),
          evidenceSufficient: false,
          majorMismatch: false,
          recommendations: ['Retry room inspection; this room has not passed.'],
        },
        scene,
        room.id,
        renderUrl,
      );
      progress(room.name, review.summary, true);
      return review;
    }
  });
}
export function aggregateRoomReviews(
  scene: SceneSpec,
  reviews: RoomAssessment[],
  checks: Verification,
): VisualAssessment {
  const complete =
    reviews.length === scene.rooms.length && reviews.every((r) => r.revision === scene.revision);
  const missing = !complete || reviews.some((r) => r.status === 'insufficient-evidence');
  const failing = reviews.some((r) => r.status === 'needs-repair');
  const avg = (key: 'layout' | 'objects' | 'materials') =>
    Math.round(reviews.reduce((n, r) => n + r.scores[key], 0) / Math.max(1, reviews.length));
  const passed = reviews.filter((r) => r.status === 'ready-for-human-review').length;
  return {
    revision: scene.revision,
    status: missing
      ? 'insufficient-evidence'
      : failing || !checks.passed
        ? 'needs-repair'
        : 'ready-for-human-review',
    summary: `${passed}/${scene.rooms.length} rooms meet the provisional visual threshold. ${reviews.filter((r) => r.status === 'needs-repair').length} need repair; ${reviews.filter((r) => r.status === 'insufficient-evidence').length} lack enough evidence. Geometry ${checks.passed ? 'passes' : 'needs attention'}.`,
    scores: { layout: avg('layout'), objects: avg('objects'), materials: avg('materials') },
    threshold: 70,
    findings: reviews
      .filter((r) => r.status !== 'ready-for-human-review')
      .map((r) => ({
        id: 'room-' + r.roomId,
        category: r.status === 'insufficient-evidence' ? 'evidence' : 'structure',
        severity: 'major',
        message: r.roomName + ': ' + r.summary,
        objectIds: [],
        recommendation: r.recommendations.join(' '),
      })),
  };
}
export async function refineRoomFinishes(
  scene: SceneSpec,
  reviews: RoomAssessment[],
  renders: Record<string, string>,
  progress: Progress,
): Promise<SceneSpec> {
  const next = structuredClone(scene);
  await eachLimit(
    next.rooms.filter((room) =>
      reviews.some(
        (r) =>
          r.roomId === room.id &&
          r.revision === scene.revision &&
          r.status === 'needs-repair' &&
          r.scores.materials < 70,
      ),
    ),
    3,
    async (room) => {
      const photos = matchedRoomPhotos(next, room.id),
        render = renders[room.id];
      if (!photos.length || !render || !room.appearance) return;
      const review = reviews.find((r) => r.roomId === room.id)!;
      const result = await askArgon<unknown>(
        'Correct only material colors/finish category using the source evidence. FIRST image is current rendered room, next images source photos. Preserve architecture, fixtures, item dimensions and source mapping. Return {wallColor:"#rrggbb",floorColor:"#rrggbb",floorMaterial:"wood"|"tile"|"carpet"|"concrete",ceilingColor:"#rrggbb",details:[string]}. Retain existing detail tokens. Colors should be base material approximations not shadow pixels. Room:' +
          JSON.stringify(room) +
          ' Critic recommendations:' +
          JSON.stringify(review.recommendations),
        [render, ...photos.slice(0, 2).map(local)],
        1800,
      );
      const corrected = roomAppearanceSchema.parse(result.value);
      room.appearance = { ...corrected, details: room.appearance.details, basis: 'photo' };
      progress(
        room.name,
        'Source-based finish correction proposed; geometry and fixed objects unchanged.',
      );
    },
  );
  return next;
}
