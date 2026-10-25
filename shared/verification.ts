import type {
  Issue,
  PlacementPatch,
  Route,
  SceneObject,
  SceneSpec,
  Vec2,
  Verification,
} from './types.js';

/** Geometric checks, not building-code certification. Coordinates are metres, XY floor. */
const EPS = 1e-5;
const GRID_STEP = 0.12;
type Rect = { center: Vec2; half: Vec2; rotation: number; id: string };
type World = { scene: SceneSpec; obstacles: Rect[]; radius: number };
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clone = (scene: SceneSpec): SceneSpec => structuredClone(scene);

function objectRect(o: SceneObject): Rect {
  return {
    center: [o.position[0], o.position[1]],
    half: [o.dimensions[0] / 2, o.dimensions[1] / 2],
    rotation: o.rotation,
    id: o.id,
  };
}
function corners(r: Rect): Vec2[] {
  const c = Math.cos(r.rotation),
    s = Math.sin(r.rotation);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(
    ([x, y]) =>
      [
        r.center[0] + x * r.half[0] * c - y * r.half[1] * s,
        r.center[1] + x * r.half[0] * s + y * r.half[1] * c,
      ] as Vec2,
  );
}
function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function insidePolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (pointSegmentDistance(p, a, b) < EPS) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function insideFloor(scene: SceneSpec, p: Vec2): boolean {
  return scene.rooms.some((room) => Math.abs(room.floorZ) < 0.25 && insidePolygon(p, room.polygon));
}
function rectInsideFloor(scene: SceneSpec, r: Rect): boolean {
  const points = corners(r);
  if (!insideFloor(scene, r.center)) return false;
  // Sample edges as well as corners: a rectangle can bridge a concave floor boundary.
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      steps = Math.max(1, Math.ceil(distance(a, b) / 0.1));
    for (let n = 0; n <= steps; n++)
      if (
        !insideFloor(scene, [
          a[0] + ((b[0] - a[0]) * n) / steps,
          a[1] + ((b[1] - a[1]) * n) / steps,
        ])
      )
        return false;
  }
  return true;
}
function rectsOverlap(a: Rect, b: Rect): boolean {
  // Separating axis test handles arbitrarily rotated footprints. Touching is allowed.
  const ca = corners(a),
    cb = corners(b);
  for (const angle of [
    a.rotation,
    a.rotation + Math.PI / 2,
    b.rotation,
    b.rotation + Math.PI / 2,
  ]) {
    const x = Math.cos(angle),
      y = Math.sin(angle);
    const pa = ca.map((p) => p[0] * x + p[1] * y),
      pb = cb.map((p) => p[0] * x + p[1] * y);
    if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS)
      return false;
  }
  return true;
}
function pointRectDistance(p: Vec2, r: Rect): number {
  const dx = p[0] - r.center[0],
    dy = p[1] - r.center[1],
    c = Math.cos(r.rotation),
    s = Math.sin(r.rotation);
  return Math.hypot(
    Math.max(Math.abs(dx * c + dy * s) - r.half[0], 0),
    Math.max(Math.abs(-dx * s + dy * c) - r.half[1], 0),
  );
}
function wallRects(scene: SceneSpec, zMin = 0, zMax = 1.8): Rect[] {
  const result: Rect[] = [];
  for (const wall of scene.walls) {
    const length = distance(wall.start, wall.end);
    if (length <= EPS || zMin >= wall.height) continue;
    const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
    // offset is the opening's centre measured from the wall's start.
    const gaps = wall.openings
      .filter(
        (o) => o.bottom <= zMin + EPS && o.bottom + o.height >= Math.min(zMax, wall.height) - EPS,
      )
      .map((o) => [Math.max(0, o.offset - o.width / 2), Math.min(length, o.offset + o.width / 2)])
      .filter((g) => g[1] > g[0])
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const add = (start: number, end: number) => {
      if (end - start <= EPS) return;
      const d = (start + end) / 2;
      result.push({
        id: wall.id,
        center: [wall.start[0] + Math.cos(angle) * d, wall.start[1] + Math.sin(angle) * d],
        half: [(end - start) / 2, wall.thickness / 2],
        rotation: angle,
      });
    };
    for (const gap of gaps) {
      add(cursor, gap[0]);
      cursor = Math.max(cursor, gap[1]);
    }
    add(cursor, length);
  }
  return result;
}
function verticalOverlap(a: SceneObject, b: SceneObject): boolean {
  return (
    Math.min(a.position[2] + a.dimensions[2] / 2, b.position[2] + b.dimensions[2] / 2) -
      Math.max(a.position[2] - a.dimensions[2] / 2, b.position[2] - b.dimensions[2] / 2) >
    0.02
  );
}
function collisionRelevant(o: SceneObject): boolean {
  return o.kind !== 'rug' && o.kind !== 'plant';
}
function furnitureOverlap(a: SceneObject, b: SceneObject): boolean {
  if (!collisionRelevant(a) || !collisionRelevant(b)) return false;
  // Chairs can tuck under a table/desk; bounding boxes do not represent leg cavities.
  if (
    (a.kind === 'chair' && ['desk', 'table'].includes(b.kind)) ||
    (b.kind === 'chair' && ['desk', 'table'].includes(a.kind))
  )
    return false;
  return verticalOverlap(a, b) && rectsOverlap(objectRect(a), objectRect(b));
}
function geometryIssues(scene: SceneSpec): Issue[] {
  const issues: Issue[] = [];
  for (const o of scene.objects) {
    if (o.movable && !rectInsideFloor(scene, objectRect(o)))
      issues.push({
        id: `boundary-${o.id}`,
        type: 'boundary',
        severity: 'error',
        message: `${o.name} extends outside the modeled floor.`,
        objectIds: [o.id],
      });
    if (!collisionRelevant(o)) continue;
    const walls = wallRects(
      scene,
      Math.max(0, o.position[2] - o.dimensions[2] / 2),
      o.position[2] + o.dimensions[2] / 2,
    );
    const seen = new Set<string>();
    for (const wall of walls)
      if (rectsOverlap(objectRect(o), wall) && !seen.has(wall.id)) {
        seen.add(wall.id);
        issues.push({
          id: `wall-${o.id}-${wall.id}`,
          type: 'collision',
          severity: 'error',
          message: `${o.name} intersects a wall.`,
          objectIds: [o.id, wall.id],
        });
      }
    if (o.movable)
      for (const stair of scene.stairs) {
        const stairRect: Rect = {
          id: stair.id,
          center: [stair.position[0], stair.position[1]],
          half: [stair.dimensions[0] / 2, stair.dimensions[1] / 2],
          rotation: stair.rotation,
        };
        if (rectsOverlap(objectRect(o), stairRect))
          issues.push({
            id: `stair-${o.id}-${stair.id}`,
            type: 'collision',
            severity: 'error',
            message: `${o.name} occupies the fixed staircase footprint.`,
            objectIds: [o.id, stair.id],
          });
      }
  }
  for (let i = 0; i < scene.objects.length; i++)
    for (let j = i + 1; j < scene.objects.length; j++) {
      const a = scene.objects[i],
        b = scene.objects[j];
      if (!a.movable && !b.movable) continue;
      if (furnitureOverlap(a, b))
        issues.push({
          id: `collision-${a.id}-${b.id}`,
          type: 'collision',
          severity: 'error',
          message: `${a.name} overlaps ${b.name}.`,
          objectIds: [a.id, b.id],
        });
    }
  return issues;
}
function makeWorld(scene: SceneSpec): World {
  const obstacles = wallRects(scene);
  for (const object of scene.objects) {
    const bottom = object.position[2] - object.dimensions[2] / 2;
    if (
      object.kind !== 'rug' &&
      bottom < 1.6 &&
      object.position[2] + object.dimensions[2] / 2 > 0.08
    )
      obstacles.push(objectRect(object));
  }
  for (const stair of scene.stairs)
    obstacles.push({
      id: stair.id,
      center: [stair.position[0], stair.position[1]],
      half: [stair.dimensions[0] / 2, stair.dimensions[1] / 2],
      rotation: stair.rotation,
    });
  return { scene, obstacles, radius: Math.max(0.05, scene.navigation.clearance || 0.65) / 2 };
}
function walkable(world: World, point: Vec2): boolean {
  if (!insideFloor(world.scene, point)) return false;
  // Erode the union of room polygons, not individual rooms: shared room boundaries stay open.
  for (let n = 0; n < 12; n++) {
    const angle = (n * Math.PI) / 6;
    if (
      !insideFloor(world.scene, [
        point[0] + Math.cos(angle) * world.radius,
        point[1] + Math.sin(angle) * world.radius,
      ])
    )
      return false;
  }
  return !world.obstacles.some((o) => pointRectDistance(point, o) < world.radius - EPS);
}
function segmentWalkable(world: World, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) / 0.04));
  for (let n = 0; n <= steps; n++)
    if (!walkable(world, [a[0] + ((b[0] - a[0]) * n) / steps, a[1] + ((b[1] - a[1]) * n) / steps]))
      return false;
  return true;
}
class MinHeap {
  values: { id: number; score: number }[] = [];
  push(id: number, score: number) {
    const value = { id, score };
    let i = this.values.length;
    this.values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.values[p].score <= score) break;
      this.values[i] = this.values[p];
      i = p;
    }
    this.values[i] = value;
  }
  pop(): number | undefined {
    if (!this.values.length) return undefined;
    const top = this.values[0],
      last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= this.values.length) break;
        if (
          child + 1 < this.values.length &&
          this.values[child + 1].score < this.values[child].score
        )
          child++;
        if (this.values[child].score >= last.score) break;
        this.values[i] = this.values[child];
        i = child;
      }
      this.values[i] = last;
    }
    return top.id;
  }
}
function findRoutes(scene: SceneSpec): Route[] {
  const world = makeWorld(scene),
    vertices = scene.rooms.flatMap((room) => room.polygon);
  if (!vertices.length)
    return scene.navigation.targets.map((t) => ({
      targetId: t.id,
      label: t.label,
      passed: false,
      points: [],
      length: 0,
    }));
  const minX = Math.min(...vertices.map((p) => p[0])),
    minY = Math.min(...vertices.map((p) => p[1]));
  const width = Math.max(...vertices.map((p) => p[0])) - minX,
    height = Math.max(...vertices.map((p) => p[1])) - minY;
  const step = Math.max(GRID_STEP, Math.sqrt((width * height) / 80000));
  const cols = Math.ceil(width / step) + 1,
    rows = Math.ceil(height / step) + 1,
    count = cols * rows;
  const cache = new Uint8Array(count);
  const point = (id: number): Vec2 => [
    minX + (id % cols) * step,
    minY + Math.floor(id / cols) * step,
  ];
  const free = (id: number) => {
    if (!cache[id]) cache[id] = walkable(world, point(id)) ? 1 : 2;
    return cache[id] === 1;
  };
  const snap = (p: Vec2): number | undefined => {
    if (!walkable(world, p)) return undefined;
    const cx = Math.round((p[0] - minX) / step),
      cy = Math.round((p[1] - minY) / step);
    const candidates: number[] = [];
    for (let y = cy - 2; y <= cy + 2; y++)
      for (let x = cx - 2; x <= cx + 2; x++)
        if (x >= 0 && y >= 0 && x < cols && y < rows) candidates.push(y * cols + x);
    candidates.sort((a, b) => distance(point(a), p) - distance(point(b), p));
    return candidates.find((id) => free(id) && segmentWalkable(world, p, point(id)));
  };
  const startId = snap(scene.navigation.start);
  return scene.navigation.targets.map((target) => {
    const failed: Route = {
      targetId: target.id,
      label: target.label,
      passed: false,
      points: [],
      length: 0,
    };
    if (startId === undefined) return failed;
    const endId = snap(target.point);
    if (endId === undefined) return failed;
    const costs = new Float64Array(count).fill(Infinity),
      parents = new Int32Array(count).fill(-1),
      closed = new Uint8Array(count),
      heap = new MinHeap();
    costs[startId] = 0;
    heap.push(startId, distance(point(startId), target.point));
    while (heap.values.length) {
      const current = heap.pop()!;
      if (closed[current]) continue;
      if (current === endId) {
        const raw: Vec2[] = [target.point];
        let id = current;
        while (id !== -1) {
          raw.push(point(id));
          id = parents[id];
        }
        raw.push(scene.navigation.start);
        raw.reverse();
        const simplified: Vec2[] = [raw[0]];
        let anchor = 0;
        while (anchor < raw.length - 1) {
          let next = Math.min(raw.length - 1, anchor + 1);
          for (let candidate = raw.length - 1; candidate > anchor + 1; candidate--)
            if (segmentWalkable(world, raw[anchor], raw[candidate])) {
              next = candidate;
              break;
            }
          if (distance(simplified[simplified.length - 1], raw[next]) > EPS)
            simplified.push(raw[next]);
          anchor = next;
        }
        return {
          targetId: target.id,
          label: target.label,
          passed: true,
          points: simplified,
          length: simplified.slice(1).reduce((sum, p, i) => sum + distance(p, simplified[i]), 0),
        };
      }
      closed[current] = 1;
      const cx = current % cols,
        cy = Math.floor(current / cols);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || cx + dx < 0 || cy + dy < 0 || cx + dx >= cols || cy + dy >= rows)
            continue;
          const next = (cy + dy) * cols + cx + dx;
          if (closed[next] || !free(next)) continue;
          if (dx && dy && (!free(cy * cols + cx + dx) || !free((cy + dy) * cols + cx))) continue;
          const cost = costs[current] + step * Math.hypot(dx, dy);
          if (cost < costs[next]) {
            costs[next] = cost;
            parents[next] = current;
            heap.push(next, cost + distance(point(next), point(endId)));
          }
        }
    }
    return failed;
  });
}

export function verifyScene(scene: SceneSpec): Verification {
  const issues = geometryIssues(scene),
    routes = findRoutes(scene);
  for (const route of routes)
    if (!route.passed)
      issues.push({
        id: `route-${route.targetId}`,
        type: 'route',
        severity: 'error',
        message: `No ${scene.navigation.clearance.toFixed(2)} m clear route from the entrance to ${route.label}.`,
        objectIds: [],
        evidence:
          'Geometric route test; fixed architecture and furniture footprints, including rotated objects, are considered.',
      });
  return {
    sceneRevision: scene.revision,
    passed: issues.every((i) => i.severity !== 'error'),
    issues,
    routes,
    checkedAt: new Date().toISOString(),
    clearance: scene.navigation.clearance,
  };
}

function validPlacement(scene: SceneSpec, object: SceneObject): boolean {
  const rect = objectRect(object);
  if (!rectInsideFloor(scene, rect)) return false;
  if (
    wallRects(
      scene,
      Math.max(0, object.position[2] - object.dimensions[2] / 2),
      object.position[2] + object.dimensions[2] / 2,
    ).some((wall) => rectsOverlap(rect, wall))
  )
    return false;
  if (scene.objects.some((other) => other.id !== object.id && furnitureOverlap(object, other)))
    return false;
  if (
    scene.stairs.some((stair) =>
      rectsOverlap(rect, {
        id: stair.id,
        center: [stair.position[0], stair.position[1]],
        half: [stair.dimensions[0] / 2, stair.dimensions[1] / 2],
        rotation: stair.rotation,
      }),
    )
  )
    return false;
  return true;
}
const score = (verification: Verification) =>
  verification.routes.filter((r) => !r.passed).length * 1000 +
  verification.issues.filter((i) => i.type !== 'route' && i.severity === 'error').length * 100;

/** Deterministic, bounded helper. It never changes fixed/pinned objects or furniture size. */
export function suggestRepair(scene: SceneSpec): {
  scene: SceneSpec;
  changes: PlacementPatch[];
  summary: string;
} {
  let result = clone(scene),
    current = verifyScene(result),
    currentScore = score(current);
  if (current.passed)
    return {
      scene: result,
      changes: [],
      summary: 'All geometric checks already pass; no furniture was moved.',
    };
  const deadline = performance.now() + 4000,
    changes: PlacementPatch[] = [];
  const implicated = new Set(current.issues.flatMap((i) => i.objectIds));
  const movable = result.objects
    .filter((o) => o.movable && !o.pinned && o.kind !== 'rug')
    .sort(
      (a, b) =>
        Number(implicated.has(b.id)) - Number(implicated.has(a.id)) ||
        distance([a.position[0], a.position[1]], result.navigation.start) -
          distance([b.position[0], b.position[1]], result.navigation.start),
    );
  for (const original of movable) {
    if (current.passed || performance.now() > deadline) break;
    const index = result.objects.findIndex((o) => o.id === original.id);
    const candidates: SceneObject[] = [];
    for (const room of result.rooms.filter((r) => Math.abs(r.floorZ) < 0.25)) {
      const minX = Math.min(...room.polygon.map((p) => p[0])),
        maxX = Math.max(...room.polygon.map((p) => p[0]));
      const minY = Math.min(...room.polygon.map((p) => p[1])),
        maxY = Math.max(...room.polygon.map((p) => p[1]));
      for (const rotation of [original.rotation, original.rotation + Math.PI / 2])
        for (let y = minY + 0.25; y < maxY; y += 0.3)
          for (let x = minX + 0.25; x < maxX; x += 0.3) {
            const candidate = {
              ...original,
              position: [x, y, original.position[2]] as SceneObject['position'],
              rotation,
            };
            if (validPlacement(result, candidate)) candidates.push(candidate);
          }
    }
    candidates.sort(
      (a, b) =>
        distance([a.position[0], a.position[1]], [original.position[0], original.position[1]]) -
        distance([b.position[0], b.position[1]], [original.position[0], original.position[1]]) +
        (Math.abs(a.rotation - original.rotation) - Math.abs(b.rotation - original.rotation)) * 0.1,
    );
    let best: { object: SceneObject; verification: Verification; score: number } | undefined;
    for (const candidate of candidates.slice(0, 80)) {
      if (performance.now() > deadline) break;
      const trial = {
        ...result,
        objects: result.objects.map((o, i) => (i === index ? candidate : o)),
      };
      const checked = verifyScene(trial),
        candidateScore = score(checked);
      if (candidateScore < (best?.score ?? currentScore))
        best = { object: candidate, verification: checked, score: candidateScore };
      if (checked.passed) break;
    }
    if (best) {
      result.objects[index] = best.object;
      current = best.verification;
      currentScore = best.score;
      changes.push({
        objectId: original.id,
        position: [...best.object.position],
        rotation: best.object.rotation,
      });
    }
  }
  if (changes.length) result.revision = scene.revision + 1;
  const final = verifyScene(result);
  return {
    scene: result,
    changes,
    summary: final.passed
      ? `Moved ${changes.length} item${changes.length === 1 ? '' : 's'}; all ${final.routes.length} routes and geometric checks now pass. Fixed and pinned objects were preserved.`
      : changes.length
        ? `Moved ${changes.length} item${changes.length === 1 ? '' : 's'}; ${final.issues.filter((i) => i.severity === 'error').length} issue(s) remain. No furniture was resized and fixed/pinned objects were preserved.`
        : 'No safe improving placement was found within the bounded search. Fixed/pinned objects and furniture sizes were preserved; unresolved checks remain visible.',
  };
}

/** Explicit demonstration fixture, never presented as an organically discovered defect. */
export function createStressTest(scene: SceneSpec): SceneSpec {
  const result = clone(scene),
    id = 'stress-test-doorway-bench';
  result.objects = result.objects.filter((o) => o.id !== id);
  result.objects.push({
    id,
    name: 'Doorway stress-test bench',
    kind: 'table',
    position: [scene.navigation.start[0], scene.navigation.start[1], 0.4],
    dimensions: [1.1, 0.5, 0.8],
    rotation: 0,
    color: '#b76b44',
    movable: true,
    pinned: false,
    basis: 'user',
  });
  result.revision++;
  if (!result.notes.some((note) => note.startsWith('Deliberate stress test:')))
    result.notes.push(
      'Deliberate stress test: a movable bench was placed at the entrance to demonstrate route detection and repair.',
    );
  return result;
}
