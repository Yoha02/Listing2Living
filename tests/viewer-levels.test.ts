import assert from 'node:assert/strict';
import test from 'node:test';
import { supportingSceneFloor } from '../src/viewerLevels';

test('published elevated mirrors and shower surrounds stay on their supporting floor', () => {
  const levels = [0, 2.85];
  for (const elevation of [0, 0.575, 1.2, 2.1]) {
    assert.equal(supportingSceneFloor(elevation, levels), 0);
  }
  for (const elevation of [2.85, 3.425, 4.05]) {
    assert.equal(supportingSceneFloor(elevation, levels), 2.85);
  }
});

test('floor filtering handles unsorted levels, rounding, and missing legacy metadata', () => {
  const levels = [5.7, 2.85, 0, 2.85];
  assert.equal(supportingSceneFloor(2.849, levels), 2.85);
  assert.equal(supportingSceneFloor(5.69, levels), 5.7);
  assert.equal(supportingSceneFloor(undefined, levels), 0);
  assert.equal(supportingSceneFloor(Number.NaN, []), 0);
});
