const DEFAULT_PACK_URL = '../assets/audio/generated/combat-sfx-pack.json';

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function defaultContextFactory() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Context ? new Context() : null;
}

function normalizeVoiceLimit(value) {
  if (!Number.isInteger(value)) return 8;
  return Math.max(1, Math.min(32, value));
}

function normalizePriority(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1000, Number(value)));
}

export class AudioFabricPackPlayer {
  constructor({ packUrl = DEFAULT_PACK_URL, contextFactory = defaultContextFactory } = {}) {
    this.packUrl = packUrl;
    this.contextFactory = contextFactory;
    this.enabled = false;
    this.context = null;
    this.packPromise = null;
    this.entryPromises = new Map();
    this.decoded = new Map();
    this.activeVoices = new Map();
    this.voiceSequence = 0;
    this.lastCueId = null;
    this.lastFailure = null;
    this.lastVoiceLimit = null;
    this.maxObservedVoices = 0;
  }

  snapshot() {
    const voices = [...this.activeVoices.values()]
      .map(({ id, cueId, priority, startedAt }) => Object.freeze({ id, cueId, priority, startedAt }))
      .sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt || a.id - b.id);
    return Object.freeze({
      enabled: this.enabled,
      contextState: this.context?.state || 'not-created',
      decodedCueIds: Object.freeze([...this.decoded.keys()].sort()),
      activeVoiceCount: voices.length,
      activeVoices: Object.freeze(voices),
      lastVoiceLimit: this.lastVoiceLimit,
      maxObservedVoices: this.maxObservedVoices,
      lastCueId: this.lastCueId,
      lastFailure: this.lastFailure,
      truthBoundary: 'plays pre-rendered Audio Fabric WAV bytes through a bounded product playback adapter; playback and voice-budget success do not prove listening quality, mix quality, latency, or game feel'
    });
  }

  async #loadPack() {
    if (!this.packPromise) {
      this.packPromise = fetch(this.packUrl).then(async response => {
        if (!response.ok) throw new Error(`audio pack fetch failed: ${response.status}`);
        const pack = await response.json();
        if (pack?.schema !== 'axm.global-state-rts.audio-fabric-pack/v1') {
          throw new Error('unexpected audio pack schema');
        }
        if (!pack.cues || typeof pack.cues !== 'object') throw new Error('audio pack cues missing');
        return pack;
      });
    }
    return this.packPromise;
  }

  async #loadEntry(cueId) {
    if (!this.entryPromises.has(cueId)) {
      this.entryPromises.set(cueId, this.#loadPack().then(async pack => {
        const relative = pack.cues[cueId];
        if (typeof relative !== 'string' || !relative) throw new Error(`audio cue missing: ${cueId}`);
        const url = new URL(relative, new URL(this.packUrl, document.baseURI));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`audio cue fetch failed: ${cueId}:${response.status}`);
        const entry = await response.json();
        if (entry?.schema !== 'axm.global-state-rts.audio-fabric-cue/v1' || entry.id !== cueId) {
          throw new Error(`unexpected audio cue artifact: ${cueId}`);
        }
        if (entry.audio_fabric_commit !== pack.audio_fabric_commit) {
          throw new Error(`audio cue fabric pin mismatch: ${cueId}`);
        }
        return entry;
      }));
    }
    return this.entryPromises.get(cueId);
  }

  async unlock() {
    this.enabled = true;
    if (!this.context) this.context = this.contextFactory();
    if (!this.context) {
      this.lastFailure = 'web-audio-unavailable';
      return Object.freeze({ enabled: false, reason: this.lastFailure });
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return Object.freeze({ enabled: this.context.state !== 'closed', state: this.context.state });
  }

  disable() {
    this.enabled = false;
    for (const voice of this.activeVoices.values()) {
      try { voice.source.stop(); } catch {}
    }
    this.activeVoices.clear();
    return this.snapshot();
  }

  async #bufferFor(cueId) {
    if (this.decoded.has(cueId)) return this.decoded.get(cueId);
    const entry = await this.#loadEntry(cueId);
    if (!entry?.wav_base64) throw new Error(`audio cue bytes missing: ${cueId}`);
    const buffer = await this.context.decodeAudioData(decodeBase64(entry.wav_base64).slice(0));
    this.decoded.set(cueId, buffer);
    return buffer;
  }

  #admitVoice(cueId, priority, maxVoices) {
    if (this.activeVoices.size < maxVoices) return Object.freeze({ admitted: true, preempted: null });
    const lowest = [...this.activeVoices.values()]
      .sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt || a.id - b.id)[0];
    if (!lowest || priority <= lowest.priority) {
      return Object.freeze({ admitted: false, reason: 'voice-budget', preempted: null });
    }
    this.activeVoices.delete(lowest.id);
    try { lowest.source.stop(); } catch {}
    return Object.freeze({ admitted: true, preempted: lowest.cueId });
  }

  async play(cueId, { gain = 1, pan = 0, priority = 0, maxVoices = 8 } = {}) {
    if (!cueId) return Object.freeze({ played: false, reason: 'no-cue' });
    if (!this.enabled) return Object.freeze({ played: false, reason: 'disabled' });
    if (!this.context) await this.unlock();
    if (!this.context || this.context.state === 'closed') return Object.freeze({ played: false, reason: 'web-audio-unavailable' });
    if (this.context.state === 'suspended') await this.context.resume();

    const voiceLimit = normalizeVoiceLimit(maxVoices);
    const cuePriority = normalizePriority(priority);
    this.lastVoiceLimit = voiceLimit;

    try {
      const buffer = await this.#bufferFor(cueId);
      const admission = this.#admitVoice(cueId, cuePriority, voiceLimit);
      if (!admission.admitted) {
        this.lastFailure = null;
        return Object.freeze({ played: false, reason: admission.reason, cueId, priority: cuePriority, maxVoices: voiceLimit });
      }

      const source = this.context.createBufferSource();
      const gainNode = this.context.createGain();
      gainNode.gain.value = Math.max(0, Number.isFinite(gain) ? Number(gain) : 1);
      source.buffer = buffer;
      source.connect(gainNode);

      let tail = gainNode;
      if (typeof this.context.createStereoPanner === 'function') {
        const panner = this.context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, Number.isFinite(pan) ? Number(pan) : 0));
        gainNode.connect(panner);
        tail = panner;
      }
      tail.connect(this.context.destination);

      const id = ++this.voiceSequence;
      const voice = { id, cueId, priority: cuePriority, startedAt: this.context.currentTime, source };
      this.activeVoices.set(id, voice);
      source.onended = () => this.activeVoices.delete(id);
      source.start();
      this.maxObservedVoices = Math.max(this.maxObservedVoices, this.activeVoices.size);
      this.lastCueId = cueId;
      this.lastFailure = null;
      return Object.freeze({ played: true, cueId, priority: cuePriority, maxVoices: voiceLimit, preemptedCueId: admission.preempted });
    } catch (error) {
      this.lastFailure = String(error?.message || error);
      return Object.freeze({ played: false, reason: this.lastFailure, cueId });
    }
  }
}

export function createAudioFabricPackPlayer(options = {}) {
  return new AudioFabricPackPlayer(options);
}
