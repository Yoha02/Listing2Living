import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneSpec } from '../shared/types.js';

export function validateEmbeddedGlb(buffer: Buffer): void {
  if (
    buffer.length < 20 ||
    buffer.readUInt32LE(0) !== 0x46546c67 ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length
  )
    throw new Error('Blender produced an invalid GLB.');
  const length = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + length > buffer.length)
    throw new Error('GLB scene metadata is missing.');
  const json = JSON.parse(
    buffer
      .subarray(20, 20 + length)
      .toString('utf8')
      .trim(),
  );
  for (const resource of [...(json.buffers || []), ...(json.images || [])])
    if (resource.uri && !resource.uri.startsWith('data:'))
      throw new Error(
        'GLB contains an external resource; publish requires embedded textures and buffers.',
      );
}
export function sceneBuildKey(sceneId: string): string {
  const slug =
    sceneId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 65) || 'scene';
  return slug + '-' + createHash('sha256').update(sceneId).digest('hex').slice(0, 8);
}

function buildDirectoryForModel(modelUrl: string): string {
  const pathname = modelUrl.split('?')[0];
  // Accept previous immutable build URLs and new scene-namespaced builds.
  if (!/^\/generated\/(?:[A-Za-z0-9_-]+\/)?build-[A-Za-z0-9_-]+\/brannan\.glb$/.test(pathname))
    throw new Error('A fresh revision render is required.');
  return path.resolve('public', pathname.slice(1), '..');
}

export function renderPathForModel(modelUrl: string): string {
  return path.join(buildDirectoryForModel(modelUrl), 'reference.png');
}

export async function roomRenderPathsForModel(modelUrl: string): Promise<Record<string, string>> {
  const directory = buildDirectoryForModel(modelUrl);
  const report = JSON.parse(await fs.readFile(path.join(directory, 'build-report.json'), 'utf8'));
  const entries = Object.entries(report.roomRenders || {});
  const paths = await Promise.all(
    entries.map(async ([roomId, relative]) => {
      if (typeof relative !== 'string' || !/^rooms\/[A-Za-z0-9_-]+\.png$/.test(relative))
        throw new Error('The room render manifest contains an invalid image path.');
      const filename = path.join(directory, relative);
      const image = await fs.readFile(filename);
      if (
        image.length < 24 ||
        !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('A room render is missing or is not a PNG image.');
      return [roomId, filename] as const;
    }),
  );
  return Object.fromEntries(paths);
}
export async function buildBlender(scene: SceneSpec): Promise<string> {
  const executable = process.env.PYTHON_PATH || 'C:\\Python313\\python.exe';
  await fs.access(executable);
  await fs.access(path.resolve('blender/bridge.py'));
  const projectKey = sceneBuildKey(scene.id),
    buildId = 'build-' + scene.revision + '-' + randomUUID().slice(0, 8),
    staging = path.resolve('runtime', projectKey, buildId),
    published = path.resolve('public/generated', projectKey, buildId);
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(path.dirname(published), { recursive: true });
  const input = path.join(staging, 'scene-build.json');
  await fs.writeFile(input, JSON.stringify(scene, null, 2));
  const log: string[] = [];
  // Each room adds a real render; allow larger homes time to finish while bounded.
  const renderTimeoutSeconds = Math.min(600, 120 + scene.rooms.length * 20);
  const bridgeTimeoutSeconds = renderTimeoutSeconds + 30;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          path.resolve('blender/bridge.py'),
          '--transport',
          'auto',
          '--scene',
          input,
          '--out',
          staging,
          '--timeout',
          String(renderTimeoutSeconds),
        ],
        { windowsHide: true },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Blender bridge exceeded ${bridgeTimeoutSeconds} seconds. The previous published model is unchanged.`,
          ),
        );
      }, bridgeTimeoutSeconds * 1000);
      child.stdout.on('data', (d) => log.push(d.toString()));
      child.stderr.on('data', (d) => log.push(d.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error('Blender build failed; see local runtime/blender.log.'));
      });
    });
    validateEmbeddedGlb(await fs.readFile(path.join(staging, 'brannan.glb')));
    await fs.access(path.join(staging, 'brannan.blend'));
    await fs.access(path.join(staging, 'reference.png'));
    const report = JSON.parse(await fs.readFile(path.join(staging, 'build-report.json'), 'utf8'));
    if (report.sceneId !== scene.id || report.revision !== scene.revision)
      throw new Error('Blender artifact revision does not match the requested scene.');
    for (const room of scene.rooms) {
      const relative = report.roomRenders?.[room.id];
      if (typeof relative !== 'string' || !/^rooms\/[A-Za-z0-9_-]+\.png$/.test(relative))
        throw new Error('The fresh build is missing a rendered image for ' + room.name + '.');
      await fs.access(path.join(staging, relative));
    }
    const approvedIds = scene.objects.filter((object) => object.movable).map((object) => object.id);
    if (
      approvedIds.length &&
      (!report.furnitureIncludedInRender ||
        approvedIds.some((id) => !report.furnitureIds?.includes(id)))
    )
      throw new Error('The fresh reference render did not include every approved furniture item.');
    await fs.rename(staging, published);
    return '/generated/' + projectKey + '/' + buildId + '/brannan.glb';
  } finally {
    await fs.mkdir('runtime', { recursive: true });
    await fs.writeFile('runtime/blender.log', log.join(''));
  }
}
