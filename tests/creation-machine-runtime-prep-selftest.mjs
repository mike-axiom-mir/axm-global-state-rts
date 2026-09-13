import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeStaticGlb } from '../src/assets/static-glb-runtime.mjs';

const root = mkdtempSync(join(tmpdir(), 'axm-cm-runtime-prep-'));
const first = join(root, 'first');
const second = join(root, 'second');

function prepare(outputDir) {
  const run = spawnSync('python3', [
    'assets/creation-machine/prepare_runtime_glb.py',
    '--asset', 'improvised-workshop',
    '--variant', 'far',
    '--output-dir', outputDir
  ], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  return JSON.parse(readFileSync(join(outputDir, 'improvised-workshop-lod1.receipt.json'), 'utf8'));
}

try {
  const receiptA = prepare(first);
  const receiptB = prepare(second);
  assert.equal(receiptA.schema, 'axm.global-state-rts.creation-machine-runtime-derivative/v0.1');
  assert.equal(receiptA.status, 'PREPARED_RUNTIME_DERIVATIVE_NOT_VISUALLY_ACCEPTED');
  assert.equal(receiptA.asset, 'improvised-workshop');
  assert.equal(receiptA.variant, 'far');
  assert.match(receiptA.sourceModel, /improvised-workshop-lod1\.gltf$/);
  assert.match(receiptA.outputGlbSha256, /^[0-9a-f]{64}$/);
  assert.equal(receiptA.outputGlbSha256, receiptB.outputGlbSha256, 'runtime derivative must be byte-deterministic');
  assert.ok(receiptA.triangles > 0);
  assert.ok(receiptA.meshes > 0);
  assert.ok(receiptA.materials > 0);
  assert.ok(receiptA.embeddedImages > 0);
  assert.ok(Object.keys(receiptA.verifiedDependencies).length > 2);
  assert.ok(receiptA.nonclaims.some(text => text.includes('visual acceptance')));
  assert.ok(receiptA.nonclaims.some(text => text.includes('mass-RTS performance')));

  const bytes = readFileSync(join(first, 'improvised-workshop-lod1.glb'));
  const decoded = decodeStaticGlb(bytes);
  assert.equal(decoded.json.buffers.length, 1);
  assert.equal(decoded.json.buffers[0].uri, undefined);
  assert.ok(decoded.json.images.every(image => image.uri === undefined && Number.isInteger(image.bufferView)));
  assert.ok(decoded.json.images.every(image => ['image/png', 'image/jpeg'].includes(image.mimeType)));

  console.log('creation-machine-runtime-prep-selftest: PASS', JSON.stringify({
    sha256: receiptA.outputGlbSha256,
    triangles: receiptA.triangles,
    meshes: receiptA.meshes,
    materials: receiptA.materials,
    images: receiptA.embeddedImages
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
