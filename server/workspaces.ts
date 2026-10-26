import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppState, PropertyWorkspace, SceneSpec } from '../shared/types.js';

export const projectContext = new AsyncLocalStorage<string>();
export function safeWorkspaceId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id))
    throw new Error('Invalid saved-home identifier.');
  return id;
}
export function projectDirectory(id: string, root = 'runtime/projects') {
  return path.join(root, safeWorkspaceId(id));
}
export type SavedWorkspace = Pick<
  AppState,
  | 'scene'
  | 'modelUrl'
  | 'visualReview'
  | 'visualIssues'
  | 'visualReviewRevision'
  | 'workflow'
  | 'events'
  | 'workspaceId'
  | 'intake'
> & { history?: SceneSpec[]; updatedAt?: string };
export async function saveWorkspace(saved: SavedWorkspace, root = 'runtime/projects') {
  const id = safeWorkspaceId(saved.workspaceId!);
  const dir = projectDirectory(id, root);
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify({ ...saved, updatedAt: new Date().toISOString() }, null, 2);
  await fs.writeFile(path.join(dir, 'state.json.tmp'), payload);
  await fs.rename(path.join(dir, 'state.json.tmp'), path.join(dir, 'state.json'));
}
export async function archiveWorkspace(saved: SavedWorkspace, root = 'runtime/projects') {
  const dir = path.join(projectDirectory(saved.workspaceId!, root), 'versions');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, Date.now() + '-revision-' + saved.scene.revision + '.json'),
    JSON.stringify(saved, null, 2),
  );
}
export async function loadWorkspace(
  id: string,
  root = 'runtime/projects',
): Promise<SavedWorkspace> {
  const saved = JSON.parse(
    await fs.readFile(path.join(projectDirectory(id, root), 'state.json'), 'utf8'),
  ) as SavedWorkspace;
  if (saved.workspaceId !== id || !saved.scene?.rooms?.length)
    throw new Error('Saved home could not be validated.');
  return saved;
}
export async function listWorkspaces(root = 'runtime/projects'): Promise<PropertyWorkspace[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const saved = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        try {
          const s = await loadWorkspace(e.name, root);
          return {
            id: e.name,
            title: s.scene.title,
            url: s.scene.listingUrl,
            updatedAt: s.updatedAt || '',
            roomCount: s.scene.rooms.length,
          };
        } catch {
          return null;
        }
      }),
  );
  return saved
    .filter((s): s is PropertyWorkspace => s !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
