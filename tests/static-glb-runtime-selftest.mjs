import assert from 'node:assert/strict';
import { decodeStaticGlb } from '../src/assets/static-glb-runtime.mjs';
import { createStaticGlbFixture } from './helpers/static-glb-fixture.mjs';

const fixture = createStaticGlbFixture();
const decoded = decodeStaticGlb(fixture);
assert.equal(decoded.json.asset.version, '2.0');
assert.equal(decoded.json.meshes.length, 1);
assert.equal(decoded.json.meshes[0].primitives.length, 1);
assert.equal(decoded.json.materials.length, 1);
assert.equal(decoded.json.images.length, 1);
assert.equal(decoded.json.images[0].mimeType, 'image/png');
assert.equal(decoded.json.meshes[0].primitives[0].mode, 4);
assert.deepEqual(Object.keys(decoded.json.meshes[0].primitives[0].attributes).sort(), ['NORMAL', 'POSITION', 'TEXCOORD_0']);

const unsupported = createStaticGlbFixture({ unsupportedExtension: 'EXT_future_unknown' });
assert.throws(
  () => decodeStaticGlb(unsupported),
  /used extension EXT_future_unknown is unsupported/,
  'unknown extensions must fail closed rather than silently dropping visual/runtime meaning'
);

const broken = fixture.slice(0);
new DataView(broken).setUint32(0, 0x12345678, true);
assert.throws(() => decodeStaticGlb(broken), /invalid GLB magic/);

console.log('bounded static GLB contract / fail-closed extension selftest: PASS');
