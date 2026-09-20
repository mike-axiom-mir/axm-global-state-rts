import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  LOCAL_COMBAT_CUE_IDS,
  cueForLocalCombatResult,
  localCombatAudioTruthBoundary
} from '../src/presentation/local-combat-audio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const generatedDir = join(root, 'assets/audio/generated');
const recipes = JSON.parse(await readFile(join(root, 'assets/audio/combat-sfx-recipes.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(generatedDir, 'combat-sfx-pack.json'), 'utf8'));

assert.equal(recipes.schema, 'axm.global-state-rts.audio-cue-map/v1');
assert.equal(manifest.schema, 'axm.global-state-rts.audio-fabric-pack/v1');
assert.equal(manifest.audio_fabric_commit, recipes.audio_fabric_commit);
assert.match(recipes.audio_fabric_commit, /^[0-9a-f]{40}$/);

const expectedCueIds = Object.values(LOCAL_COMBAT_CUE_IDS).sort();
assert.deepEqual(Object.keys(recipes.cues).sort(), expectedCueIds);
assert.deepEqual(Object.keys(manifest.cues).sort(), expectedCueIds);

const accepted = fields => ({ handled: true, accepted: true, ...fields });
assert.equal(cueForLocalCombatResult({ handled: true, accepted: false }, { kind: 'exchange' }), null);
assert.equal(cueForLocalCombatResult(accepted({ action: 'combat-menu-open' }), { kind: 'menu' }), 'combat-menu-open');
assert.equal(cueForLocalCombatResult(accepted({ action: 'combat-exchange' }), { kind: 'exchange' }), 'combat-exchange');
assert.equal(cueForLocalCombatResult(accepted({ action: 'combat-exchange' }), { kind: 'victory' }), 'combat-victory');
assert.equal(cueForLocalCombatResult(accepted({ action: 'combat-exchange' }), { kind: 'defeat' }), 'combat-defeat');
assert.equal(cueForLocalCombatResult(accepted({ action: 'combat-retreat' }), { kind: 'retreat' }), null);
assert.equal(localCombatAudioTruthBoundary().authority, 'presentation-only');

function riffDataChunk(wav) {
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString('ascii');
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    assert.ok(end <= wav.length, `WAV chunk ${id} exceeds file bounds`);
    if (id === 'fmt ') fmt = wav.subarray(start, end);
    if (id === 'data') data = wav.subarray(start, end);
    offset = end + (size % 2);
  }
  assert.ok(fmt && data, 'WAV must include fmt and data chunks');
  assert.equal(fmt.readUInt16LE(0), 1, 'PCM format required');
  assert.equal(fmt.readUInt16LE(2), 2, 'stereo required');
  assert.equal(fmt.readUInt32LE(4), 8000, 'bounded 8kHz experiment pack required');
  return data;
}

for (const cueId of expectedCueIds) {
  const relativePath = manifest.cues[cueId];
  assert.equal(relativePath, `./${cueId}.json`);
  const artifact = JSON.parse(await readFile(join(generatedDir, `${cueId}.json`), 'utf8'));
  assert.equal(artifact.schema, 'axm.global-state-rts.audio-fabric-cue/v1');
  assert.equal(artifact.id, cueId);
  assert.equal(artifact.audio_fabric_commit, recipes.audio_fabric_commit);
  assert.deepEqual(artifact.recipe, recipes.cues[cueId]);
  assert.equal(artifact.receipt.schema, 'axm.audio-render-receipt/v1');
  assert.equal(artifact.receipt.sample_rate, 8000);
  assert.equal(artifact.receipt.channels, 2);
  assert.ok(artifact.receipt.frames > 0);
  assert.ok(Number.isFinite(artifact.receipt.peak));
  assert.ok(Number.isFinite(artifact.receipt.rms));

  const wav = Buffer.from(artifact.wav_base64, 'base64');
  assert.equal(createHash('sha256').update(wav).digest('hex'), artifact.wav_sha256);
  const pcm = riffDataChunk(wav);
  assert.equal(createHash('sha256').update(pcm).digest('hex'), artifact.receipt.pcm16_sha256);
}

console.log('local combat audio selftest passed');
