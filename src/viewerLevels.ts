/** Older GLB fixture metadata records the mesh bottom instead of its supporting floor. */
export function supportingSceneFloor(elevation: number | undefined, levels: readonly number[]) {
  const floors = [...new Set(levels.filter(Number.isFinite))].sort((a, b) => a - b);
  const bottom = Number.isFinite(elevation) ? elevation! : (floors[0] ?? 0);
  return floors.filter((floor) => floor <= bottom + 0.08).at(-1) ?? floors[0] ?? 0;
}
