import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelObject, readImagePart } from '../server/argon.js';
import { renderPathForModel, validateEmbeddedGlb } from '../server/blender.js';

test('model plans must be valid objects, including fenced responses', () => {
  assert.deepEqual(parseModelObject('```json\n{"patches":[]}\n```'), { patches: [] });
  for (const invalid of ['null', '[]', 'true', '"hello"', '{broken}', undefined])
    assert.throws(() => parseModelObject(invalid));
});
test('visual requests fail when declared evidence is missing or invalid', async () => {
  await assert.rejects(
    () => readImagePart('runtime/definitely-missing-test-image.png'),
    /could not be read/,
  );
  await assert.rejects(
    () => readImagePart('data:image/png;base64,bm90IGFuIGltYWdl'),
    /empty|supported/,
  );
  await assert.rejects(() => readImagePart('data:image/svg+xml;base64,PHN2Zz4='), /invalid/);
});
function glb(metadata: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(metadata));
  const padding = (4 - (json.length % 4)) % 4;
  const chunk = Buffer.concat([json, Buffer.alloc(padding, 32)]),
    buffer = Buffer.alloc(20 + chunk.length);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(chunk.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(buffer, 20);
  return buffer;
}
test('published GLB resources must be embedded', () => {
  assert.doesNotThrow(() =>
    validateEmbeddedGlb(
      glb({
        asset: { version: '2.0' },
        buffers: [{ byteLength: 0 }],
        images: [{ bufferView: 0, mimeType: 'image/png' }],
      }),
    ),
  );
  assert.throws(() => validateEmbeddedGlb(glb({ buffers: [{ uri: 'mesh.bin' }] })), /external/);
  assert.throws(() => validateEmbeddedGlb(glb({ images: [{ uri: 'wood.png' }] })), /external/);
  assert.throws(() => validateEmbeddedGlb(Buffer.from('not a GLB')), /invalid/);
});
test('visual build inspection requires a fresh revision render path', () => {
  assert.match(
    renderPathForModel('/generated/build-3-abc/reference'.replace('reference', 'brannan.glb')),
    /build-3-abc[\\/]reference.png$/,
  );
  assert.throws(() => renderPathForModel('/generated/brannan.glb'), /fresh/);
  assert.throws(() => renderPathForModel('/generated/../../private/brannan.glb'), /fresh/);
});
