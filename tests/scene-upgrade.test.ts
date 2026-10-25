import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../shared/brannan.json';
import type { SceneSpec } from '../shared/types';
import { addMissingLevels } from '../shared/scene-upgrade';

test('adding a level preserves user furniture, existing walls, sources and revision history', () => {
  const template = structuredClone(fixture) as SceneSpec;
  const saved = structuredClone(template);
  saved.rooms = saved.rooms.filter((room) => room.floorZ === 0);
  saved.walls = saved.walls.filter((wall) => !wall.floorZ);
  saved.cameras = saved.cameras.filter((camera) => !camera.floorZ);
  saved.objects = saved.objects.filter(
    (object) => object.position[2] - object.dimensions[2] / 2 < 1,
  );
  saved.revision = 27;
  saved.objects.push({
    id: 'user-desk',
    name: 'My desk',
    kind: 'desk',
    position: [1, 6, 0.4],
    dimensions: [1.2, 0.6, 0.8],
    rotation: 0.7,
    color: '#987654',
    movable: true,
    basis: 'user',
  });
  saved.walls[0].color = '#123456';
  saved.navigation.levels = undefined;
  const result = addMissingLevels(saved, template);
  assert.ok(result);
  assert.equal(result.revision, 28);
  assert.deepEqual(
    result.objects.find((object) => object.id === 'user-desk'),
    saved.objects.at(-1),
  );
  assert.deepEqual(result.walls[0], saved.walls[0]);
  assert.deepEqual(result.sources, saved.sources);
  assert.ok(result.rooms.some((room) => room.floorZ > 0));
  assert.equal(addMissingLevels(result, template), null, 'upgrade is idempotent');
  assert.equal(saved.revision, 27, 'input remains unchanged');
});
