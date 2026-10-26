import type { SceneSpec } from './types';

/** Add newly supported levels without replacing the user's existing arrangement. */
export function addMissingLevels(scene: SceneSpec, template: SceneSpec): SceneSpec | null {
  const heights = [...new Set(template.rooms.map((room) => room.floorZ))].filter(
    (z) => !scene.rooms.some((room) => Math.abs(room.floorZ - z) < 0.01),
  );
  if (!heights.length) return null;
  const added = (z: number) => heights.some((height) => Math.abs(height - z) < 0.01);
  const next = structuredClone(scene);
  next.revision += 1;
  next.rooms.push(...structuredClone(template.rooms.filter((room) => added(room.floorZ))));
  next.walls.push(...structuredClone(template.walls.filter((wall) => added(wall.floorZ || 0))));
  next.objects.push(
    ...structuredClone(
      template.objects.filter((object) => added(object.position[2] - object.dimensions[2] / 2)),
    ),
  );
  next.cameras.push(
    ...structuredClone(
      template.cameras.filter(
        (camera) =>
          added(camera.floorZ || 0) && !next.cameras.some((existing) => existing.id === camera.id),
      ),
    ),
  );
  next.levels = structuredClone(template.levels);
  next.navigation.levels = structuredClone(template.navigation.levels);
  next.notes = next.notes.filter(
    (note) => !note.startsWith('Lower floor only.') && !note.startsWith('Stair direction anchor:'),
  );
  next.notes.push(
    ...template.notes.filter(
      (note) => !next.notes.includes(note) && !note.startsWith('Lower floor only.'),
    ),
  );
  next.notes.push(
    'Upper floor added from the listing plan; the existing lower-floor furniture arrangement was preserved. Vertical alignment and heights remain inferred.',
  );
  return next;
}
