import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderPathForModel, roomRenderPathsForModel, sceneBuildKey } from '../server/blender.js';

test('build paths isolate scene IDs and accept both immutable URL formats', () => {
  assert.match(sceneBuildKey('../../an unrelated scene'), /^[a-z0-9_-]+$/);
  assert.notEqual(sceneBuildKey('Home A'), sceneBuildKey('Home-A'));
  assert.notEqual(sceneBuildKey('Home'), sceneBuildKey('home'));
  assert.equal(sceneBuildKey('same'), sceneBuildKey('same'));
  assert.match(renderPathForModel('/generated/house/build-2-abcd/brannan.glb?revision=2'), /house[\\/]build-2-abcd[\\/]reference.png$/);
  assert.match(renderPathForModel('/generated/build-1-old/brannan.glb'), /build-1-old[\\/]reference.png$/);
  for (const value of ['/generated/a/b/build-1/brannan.glb', '/generated/../build-1/brannan.glb', '/generated/a/%2e%2e/brannan.glb'])
    assert.throws(() => renderPathForModel(value), /fresh/);
});

test('room render manifests only resolve existing PNGs inside the same build', async () => {
  const build = 'build-test-' + randomUUID();
  const directory = path.resolve('public/generated/room-render-tests', build);
  const url = '/generated/room-render-tests/' + build + '/brannan.glb';
  await fs.mkdir(path.join(directory, 'rooms'), { recursive: true });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=', 'base64');
  const report = (roomRenders: unknown) => fs.writeFile(path.join(directory, 'build-report.json'), JSON.stringify({ roomRenders }));
  try {
    await fs.writeFile(path.join(directory, 'rooms/bedroom.png'), image);
    await report({ bedroom: 'rooms/bedroom.png' });
    assert.deepEqual(await roomRenderPathsForModel(url), { bedroom: path.join(directory, 'rooms/bedroom.png') });
    await report({ bedroom: '../private.png' });
    await assert.rejects(() => roomRenderPathsForModel(url), /invalid image path/);
    await report({ bedroom: 'rooms/missing.png' });
    await assert.rejects(() => roomRenderPathsForModel(url), /ENOENT/);
    await fs.writeFile(path.join(directory, 'rooms/not-image.png'), 'not a picture');
    await report({ bedroom: 'rooms/not-image.png' });
    await assert.rejects(() => roomRenderPathsForModel(url), /not a PNG/);
    await report(undefined);
    assert.deepEqual(await roomRenderPathsForModel(url), {});
  } finally {
    // This exact directory was created for this test under public/generated.
    await fs.rm(directory, { recursive: true, force: true });
  }
});
