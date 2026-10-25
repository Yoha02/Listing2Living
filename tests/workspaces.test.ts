import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fixture from '../shared/brannan.json';
import {
  saveWorkspace,
  loadWorkspace,
  listWorkspaces,
  archiveWorkspace,
  safeWorkspaceId,
} from '../server/workspaces.js';
import type { SceneSpec } from '../shared/types.js';
test('different listings preserve independent scenes, versions and asset URLs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'listing2living-workspaces-'));
  const one = {
    workspaceId: 'zillow-1',
    scene: structuredClone(fixture) as SceneSpec,
    modelUrl: '/generated/one/build-1/brannan.glb',
    events: [],
  };
  const two = {
    ...structuredClone(one),
    workspaceId: 'zillow-2',
    scene: { ...structuredClone(one.scene), id: 'second-home', title: 'Second home' },
    modelUrl: '/generated/two/build-1/brannan.glb',
  };
  await saveWorkspace(one, root);
  await archiveWorkspace(one, root);
  await saveWorkspace(two, root);
  two.scene.revision = 9;
  await saveWorkspace(two, root);
  assert.equal((await loadWorkspace('zillow-1', root)).scene.revision, one.scene.revision);
  assert.equal((await loadWorkspace('zillow-1', root)).modelUrl, one.modelUrl);
  assert.equal((await loadWorkspace('zillow-2', root)).scene.revision, 9);
  assert.equal((await listWorkspaces(root)).length, 2);
  assert.equal((await fs.readdir(path.join(root, 'zillow-1', 'versions'))).length, 1);
  assert.throws(() => safeWorkspaceId('../escape'));
});
