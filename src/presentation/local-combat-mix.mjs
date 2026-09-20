export const LOCAL_COMBAT_MIX_SCENE_SCHEMA = 'axm.global-state-rts.sound-mix-scenes/v1';
export const LOCAL_COMBAT_MIX_RESOLUTION_SCHEMA = 'axm.global-state-rts.resolved-sound-mix/v1';
export const SOUND_MIXER_COMMIT = '8dc36bda6f24ec727e38b161db04df0909972cf5';
export const REQUIRED_SOUND_BUSES = Object.freeze(['sfx', 'music', 'voice']);

function assertFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a finite number >= 0`);
}

function assertTrack(track, id) {
  if (!track || track.schema !== 'axm.audio-track/v1' || track.id !== id) {
    throw new TypeError(`required Sound Mixer track missing or invalid: ${id}`);
  }
  assertFiniteNonNegative(track.gain, `${id} gain`);
  if (!Number.isFinite(track.pan) || track.pan < -1 || track.pan > 1) throw new TypeError(`${id} pan must be between -1 and 1`);
  if (typeof track.mute !== 'boolean' || typeof track.solo !== 'boolean') throw new TypeError(`${id} mute/solo must be boolean`);
}

export function validateLocalCombatMixPolicy(project, policy) {
  if (!project || project.schema !== 'axm.sound-mix-project/v1') throw new TypeError('expected axm.sound-mix-project/v1');
  if (!Array.isArray(project.tracks)) throw new TypeError('Sound Mixer project tracks must be an array');
  if (!policy || policy.schema !== LOCAL_COMBAT_MIX_SCENE_SCHEMA) throw new TypeError(`expected ${LOCAL_COMBAT_MIX_SCENE_SCHEMA}`);
  if (policy.sound_mixer_commit !== SOUND_MIXER_COMMIT) throw new Error('Sound Mixer pin mismatch');
  if (policy.project_id !== project.id) throw new Error('mix scene project id does not match Sound Mixer project');
  if (!Number.isInteger(policy.max_voices) || policy.max_voices < 1 || policy.max_voices > 32) throw new TypeError('max_voices must be an integer between 1 and 32');
  if (!policy.scenes || typeof policy.scenes !== 'object') throw new TypeError('mix scenes missing');
  if (!policy.cue_policy || typeof policy.cue_policy !== 'object') throw new TypeError('cue policy missing');

  for (const id of REQUIRED_SOUND_BUSES) {
    const track = project.tracks.find(candidate => candidate.id === id);
    assertTrack(track, id);
  }

  for (const [sceneId, scene] of Object.entries(policy.scenes)) {
    if (!scene?.buses || typeof scene.buses !== 'object') throw new TypeError(`scene buses missing: ${sceneId}`);
    for (const id of REQUIRED_SOUND_BUSES) assertFiniteNonNegative(scene.buses[id], `${sceneId}.${id} multiplier`);
  }

  for (const [cueId, cue] of Object.entries(policy.cue_policy)) {
    if (!cue || typeof cue.scene !== 'string' || !policy.scenes[cue.scene]) throw new Error(`cue scene missing: ${cueId}`);
    if (!Number.isInteger(cue.priority) || cue.priority < 0 || cue.priority > 1000) throw new TypeError(`cue priority invalid: ${cueId}`);
  }

  return Object.freeze({ projectId: project.id, maxVoices: policy.max_voices });
}

function resolvedBus(track, multiplier, hasSolo) {
  const audible = !track.mute && (!hasSolo || track.solo);
  const configuredGain = track.gain * multiplier;
  return Object.freeze({
    trackId: track.id,
    configuredGain,
    gain: audible ? configuredGain : 0,
    pan: track.pan,
    audible
  });
}

export function resolveLocalCombatMix(project, policy, cueId) {
  validateLocalCombatMixPolicy(project, policy);
  const cue = policy.cue_policy[cueId];
  if (!cue) throw new Error(`no product mix policy for cue: ${cueId}`);
  const scene = policy.scenes[cue.scene];
  const hasSolo = project.tracks.some(track => track.solo);
  const buses = {};
  for (const id of REQUIRED_SOUND_BUSES) {
    const track = project.tracks.find(candidate => candidate.id === id);
    buses[id] = resolvedBus(track, scene.buses[id], hasSolo);
  }
  return Object.freeze({
    schema: LOCAL_COMBAT_MIX_RESOLUTION_SCHEMA,
    projectId: project.id,
    projectRevision: project.revision,
    soundMixerCommit: policy.sound_mixer_commit,
    cueId,
    sceneId: cue.scene,
    priority: cue.priority,
    maxVoices: policy.max_voices,
    buses: Object.freeze(buses),
    truthBoundary: 'product mix-state resolution only; music/voice buses are inspectable policy state until audible consumers exist, and no listening-quality claim is made'
  });
}

export function localCombatMixTruthBoundary() {
  return Object.freeze({
    authority: 'presentation-and-mix-policy-only',
    sharedContract: 'axm.sound-mix-project/v1',
    soundMixerCommit: SOUND_MIXER_COMMIT,
    nonClaims: Object.freeze([
      'no combat or world-state authority',
      'no Audio Fabric synthesis ownership',
      'no Music Maker composition ownership',
      'no audible music or voice claim',
      'no listening, balance, latency, or game-feel acceptance claim'
    ])
  });
}
