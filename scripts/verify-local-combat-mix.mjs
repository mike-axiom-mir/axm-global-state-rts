import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveLocalCombatMix, SOUND_MIXER_COMMIT, validateLocalCombatMixPolicy } from '../src/presentation/local-combat-mix.mjs';

const root = process.cwd();
const projectPath = path.join(root, 'assets/audio/local-combat-mix-project.json');
const policyPath = path.join(root, 'assets/audio/local-combat-mix-scenes.json');
const mixerPath = path.join(root, '.deps/axm-sound-mixer/src/mixer-core.mjs');
const evidenceDir = '/tmp/axm-rts-combat-mix';

const [project, policy, mixer] = await Promise.all([
  readFile(projectPath, 'utf8').then(JSON.parse),
  readFile(policyPath, 'utf8').then(JSON.parse),
  import(pathToFileURL(mixerPath).href)
]);

assert.equal(policy.sound_mixer_commit, SOUND_MIXER_COMMIT);
const validatedProject = mixer.validateProject(structuredClone(project));
const validatedPolicy = validateLocalCombatMixPolicy(validatedProject, policy);
assert.equal(validatedPolicy.projectId, project.id);
assert.equal(validatedPolicy.maxVoices, 4);

const canonical = mixer.canonicalJson(validatedProject);
const canonicalSha256 = createHash('sha256').update(canonical).digest('hex');
const mixPlan = mixer.buildMixPlan(validatedProject);
assert.equal(mixPlan.schema, 'axm.sound-mix-plan/v1');
assert.equal(mixPlan.projectId, project.id);
assert.equal(mixPlan.projectRevision, project.revision);
assert.deepEqual(mixPlan.events, []);

const expected = {
  'combat-menu-open': { sceneId: 'command', priority: 20, sfx: 0.6336, music: 0.4896, voice: 0.95 },
  'combat-exchange': { sceneId: 'combat', priority: 60, sfx: 0.88, music: 0.3536, voice: 0.95 },
  'combat-victory': { sceneId: 'result', priority: 100, sfx: 0.9504, music: 0.2584, voice: 0.95 },
  'combat-defeat': { sceneId: 'result', priority: 100, sfx: 0.9504, music: 0.2584, voice: 0.95 }
};

const resolved = {};
for (const [cueId, wanted] of Object.entries(expected)) {
  const mix = resolveLocalCombatMix(validatedProject, policy, cueId);
  assert.equal(mix.sceneId, wanted.sceneId);
  assert.equal(mix.priority, wanted.priority);
  assert.equal(mix.maxVoices, 4);
  assert.ok(Math.abs(mix.buses.sfx.gain - wanted.sfx) < 1e-12);
  assert.ok(Math.abs(mix.buses.music.gain - wanted.music) < 1e-12);
  assert.ok(Math.abs(mix.buses.voice.gain - wanted.voice) < 1e-12);
  assert.equal(mix.buses.sfx.audible, true);
  resolved[cueId] = {
    sceneId: mix.sceneId,
    priority: mix.priority,
    maxVoices: mix.maxVoices,
    buses: Object.fromEntries(Object.entries(mix.buses).map(([id, bus]) => [id, { gain: bus.gain, audible: bus.audible }]))
  };
}

const mutedSfxProject = mixer.setTrackMix(validatedProject, 'sfx', { mute: true });
const mutedSfx = resolveLocalCombatMix(mutedSfxProject, policy, 'combat-exchange');
assert.equal(mutedSfx.buses.sfx.audible, false);
assert.equal(mutedSfx.buses.sfx.gain, 0);
assert.equal(mutedSfx.buses.music.audible, true);

const voiceSoloProject = mixer.setTrackMix(validatedProject, 'voice', { solo: true });
const voiceSolo = resolveLocalCombatMix(voiceSoloProject, policy, 'combat-exchange');
assert.equal(voiceSolo.buses.sfx.audible, false);
assert.equal(voiceSolo.buses.music.audible, false);
assert.equal(voiceSolo.buses.voice.audible, true);
assert.equal(voiceSolo.buses.voice.gain, 0.95);

assert.throws(() => resolveLocalCombatMix(validatedProject, policy, 'unknown-cue'), /no product mix policy/);
assert.throws(() => validateLocalCombatMixPolicy(validatedProject, { ...policy, sound_mixer_commit: 'wrong-pin' }), /Sound Mixer pin mismatch/);

const receipt = {
  schema: 'axm.global-state-rts.sound-mix-verification/v1',
  soundMixerCommit: SOUND_MIXER_COMMIT,
  project: {
    id: validatedProject.id,
    revision: validatedProject.revision,
    canonicalSha256,
    requiredBuses: ['sfx', 'music', 'voice']
  },
  policy: {
    schema: policy.schema,
    maxVoices: policy.max_voices,
    cueCount: Object.keys(policy.cue_policy).length
  },
  resolved,
  checks: {
    soundMixerValidation: 'pass',
    soundMixerCanonicalRoundTripInput: 'pass',
    soundMixerPlanDerivation: 'pass',
    productSceneResolution: 'pass',
    muteSemantics: 'pass',
    soloSemantics: 'pass',
    unknownCueFailClosed: 'pass',
    pinMismatchFailClosed: 'pass'
  },
  truthBoundary: [
    'This proves canonical Sound Mixer project validity plus deterministic product mix-policy resolution.',
    'The SFX bus is connected to the RTS Audio Fabric playback adapter; music and voice buses are inspectable policy state only in this candidate.',
    'No listening quality, musical quality, voice quality, device behavior, perceived latency, balance, or game-feel claim is made.'
  ]
};

await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, 'verification.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
