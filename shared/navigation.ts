import type { SceneSpec, Stair, Vec2, Vec3 } from './types';

export interface WalkerPose {
  position: Vec3;
  floorZ: number;
  yaw: number;
  pitch: number;
}
export interface WalkInput {
  forward: number;
  strafe: number;
  turn: number;
  look: number;
}
export const WALK_RADIUS = 0.21;
export const EYE_HEIGHT = 1.62;
const BODY_HEIGHT = 1.74;
const EPSILON = 0.0001;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function segmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
export function insidePolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (segmentDistance(point, a, b) < EPSILON) return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function stairEndpoints(stair: Stair): {
  bottom: Vec2;
  top: Vec2;
  bottomZ: number;
  topZ: number;
} {
  const [cx, cy, cz] = stair.position,
    [, depth, height] = stair.dimensions;
  const direction: Vec2 = [-Math.sin(stair.rotation), Math.cos(stair.rotation)];
  return {
    bottom: stair.bottom ?? [cx + (direction[0] * depth) / 2, cy + (direction[1] * depth) / 2],
    top: stair.top ?? [cx - (direction[0] * depth) / 2, cy - (direction[1] * depth) / 2],
    bottomZ: cz - height / 2,
    topZ: cz + height / 2,
  };
}
function stairPoint(stair: Stair, point: Vec2) {
  const ends = stairEndpoints(stair),
    dx = ends.top[0] - ends.bottom[0],
    dy = ends.top[1] - ends.bottom[1];
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const px = point[0] - ends.bottom[0],
    py = point[1] - ends.bottom[1];
  const t = (px * dx + py * dy) / (length * length),
    side = Math.abs(px * dy - py * dx) / length;
  return { ...ends, t, side, height: ends.bottomZ + clamp(t, 0, 1) * (ends.topZ - ends.bottomZ) };
}

function floorContains(scene: SceneSpec, point: Vec2, height: number) {
  return scene.rooms.some(
    (room) => Math.abs(room.floorZ - height) < 0.08 && insidePolygon(point, room.polygon),
  );
}
function supportAt(
  scene: SceneSpec,
  point: Vec2,
  previousZ: number,
  radius: number,
): number | null {
  for (const stair of scene.stairs) {
    const p = stairPoint(stair, point);
    if (!p || p.t < 0 || p.t > 1 || p.side > stair.dimensions[0] / 2 + radius) continue;
    // A walking cylinder enters at an end, not through a rail or a vertical side.
    if (p.side > stair.dimensions[0] / 2 - radius + EPSILON) return null;
    if (Math.abs(p.height - previousZ) > 0.2) return null;
    return p.height;
  }
  const levels = [...new Set(scene.rooms.map((room) => room.floorZ))].sort(
    (a, b) => Math.abs(a - previousZ) - Math.abs(b - previousZ),
  );
  for (const level of levels) {
    if (Math.abs(level - previousZ) > 0.2 || !floorContains(scene, point, level)) continue;
    const supported = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4,
        sample: Vec2 = [point[0] + Math.cos(a) * radius, point[1] + Math.sin(a) * radius];
      return (
        floorContains(scene, sample, level) ||
        scene.stairs.some((stair) => {
          const p = stairPoint(stair, sample);
          return (
            p &&
            p.t >= -0.04 &&
            p.t <= 1.04 &&
            p.side <= stair.dimensions[0] / 2 &&
            Math.abs(p.height - level) < 0.35
          );
        })
      );
    }).every(Boolean);
    if (supported) return level;
  }
  return null;
}

export function canOccupy(scene: SceneSpec, position: Vec3, radius = WALK_RADIUS) {
  const point: Vec2 = [position[0], position[1]],
    feet = position[2];
  for (const wall of scene.walls) {
    const floor = wall.floorZ ?? 0;
    if (feet >= floor + wall.height - EPSILON || feet + BODY_HEIGHT <= floor) continue;
    const dx = wall.end[0] - wall.start[0],
      dy = wall.end[1] - wall.start[1],
      length = Math.hypot(dx, dy);
    if (length < EPSILON) continue;
    const intervals = wall.openings
      .filter(
        (o) =>
          o.type !== 'window' &&
          floor + o.bottom <= feet + 0.12 &&
          floor + o.bottom + o.height >= feet + BODY_HEIGHT,
      )
      .map(
        (o) =>
          [Math.max(0, o.offset - o.width / 2), Math.min(length, o.offset + o.width / 2)] as Vec2,
      )
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const hit = (start: number, end: number) =>
      end > start + EPSILON &&
      segmentDistance(
        point,
        [wall.start[0] + (dx * start) / length, wall.start[1] + (dy * start) / length],
        [wall.start[0] + (dx * end) / length, wall.start[1] + (dy * end) / length],
      ) <
        radius + wall.thickness / 2 - EPSILON;
    for (const [start, end] of intervals) {
      if (hit(cursor, start)) return false;
      cursor = Math.max(cursor, end);
    }
    if (hit(cursor, length)) return false;
  }
  for (const object of scene.objects) {
    if (object.kind === 'rug' || object.dimensions[2] < 0.08) continue;
    const bottom = object.position[2] - object.dimensions[2] / 2,
      top = object.position[2] + object.dimensions[2] / 2;
    if (top <= feet + 0.08 || bottom >= feet + BODY_HEIGHT) continue;
    const dx = point[0] - object.position[0],
      dy = point[1] - object.position[1],
      c = Math.cos(object.rotation),
      s = Math.sin(object.rotation);
    const x = c * dx + s * dy,
      y = -s * dx + c * dy;
    const nearX = clamp(x, -object.dimensions[0] / 2, object.dimensions[0] / 2),
      nearY = clamp(y, -object.dimensions[1] / 2, object.dimensions[1] / 2);
    if (Math.hypot(x - nearX, y - nearY) < radius - EPSILON) return false;
  }
  return true;
}

export function moveWalker(
  scene: SceneSpec,
  pose: WalkerPose,
  dx: number,
  dy: number,
  radius = WALK_RADIUS,
): WalkerPose {
  let position: Vec3 = [...pose.position];
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.045));
  const attempt = (x: number, y: number): boolean => {
    const height = supportAt(scene, [x, y], position[2], radius);
    if (height === null) return false;
    const next: Vec3 = [x, y, height];
    if (!canOccupy(scene, next, radius)) return false;
    position = next;
    return true;
  };
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps,
      sy = dy / steps;
    if (!attempt(position[0] + sx, position[1] + sy)) {
      if (Math.abs(sx) > EPSILON) attempt(position[0] + sx, position[1]);
      if (Math.abs(sy) > EPSILON) attempt(position[0], position[1] + sy);
    }
  }
  const arrived = scene.rooms
    .map((room) => room.floorZ)
    .find((level) => Math.abs(position[2] - level) < 0.035);
  return { ...pose, position, floorZ: arrived ?? pose.floorZ };
}

export function advanceWalker(
  scene: SceneSpec,
  pose: WalkerPose,
  input: WalkInput,
  dt: number,
): WalkerPose {
  const yaw = pose.yaw + input.turn * dt * 1.65,
    pitch = clamp(pose.pitch + input.look * dt * 1.25, -1.18, 1.18);
  const length = Math.max(1, Math.hypot(input.forward, input.strafe));
  const forward = input.forward / length,
    strafe = input.strafe / length,
    speed = 1.6 * Math.max(0, dt);
  const dx = (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
  const dy = (Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed;
  return moveWalker(scene, { ...pose, yaw, pitch }, dx, dy);
}

export function findWalkStart(scene: SceneSpec, floorZ: number): Vec3 {
  const level = scene.navigation.levels?.find((l) => Math.abs(l.floorZ - floorZ) < 0.08);
  const preferred = level?.start ?? (Math.abs(floorZ) < 0.08 ? scene.navigation.start : undefined);
  const usable = (p: Vec2) =>
    supportAt(scene, p, floorZ, WALK_RADIUS) === floorZ && canOccupy(scene, [p[0], p[1], floorZ]);
  if (preferred && usable(preferred)) return [...preferred, floorZ];
  const rooms = scene.rooms.filter((r) => Math.abs(r.floorZ - floorZ) < 0.08);
  for (const room of rooms) {
    const center: Vec2 = [
      room.polygon.reduce((s, p) => s + p[0], 0) / room.polygon.length,
      room.polygon.reduce((s, p) => s + p[1], 0) / room.polygon.length,
    ];
    if (usable(center)) return [...center, floorZ];
    const xs = room.polygon.map((p) => p[0]),
      ys = room.polygon.map((p) => p[1]);
    for (let x = Math.min(...xs) + WALK_RADIUS; x <= Math.max(...xs); x += 0.25)
      for (let y = Math.min(...ys) + WALK_RADIUS; y <= Math.max(...ys); y += 0.25)
        if (usable([x, y])) return [x, y, floorZ];
  }
  // A valid room is expected; keep a deterministic position if all usable space is obstructed.
  return preferred ? [...preferred, floorZ] : [0, 0, floorZ];
}
