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

export class AudioFabricPackPlayer {
  constructor({ packUrl = DEFAULT_PACK_URL, contextFactory = defaultContextFactory } = {}) {
    this.packUrl = packUrl;
    this.contextFactory = contextFactory;
    this.enabled = false;
    this.context = null;
    this.packPromise = null;
    this.decoded = new Map();
    this.lastCueId = null;
    this.lastFailure = null;
  }

  snapshot() {
    return Object.freeze({
      enabled: this.enabled,
      contextState: this.context?.state || 'not-created',
      decodedCueIds: Object.freeze([...this.decoded.keys()].sort()),
      lastCueId: this.lastCueId,
      lastFailure: this.lastFailure,
      truthBoundary: 'plays pre-rendered Audio Fabric WAV bytes only; browser playback success does not prove listening quality, mix quality, latency, or game feel'
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
    return this.snapshot();
  }

  async #bufferFor(cueId) {
    if (this.decoded.has(cueId)) return this.decoded.get(cueId);
    const pack = await this.#loadPack();
    const entry = pack.cues[cueId];
    if (!entry?.wav_base64) throw new Error(`audio cue missing: ${cueId}`);
    const buffer = await this.context.decodeAudioData(decodeBase64(entry.wav_base64).slice(0));
    this.decoded.set(cueId, buffer);
    return buffer;
  }

  async play(cueId, { gain = 1, pan = 0 } = {}) {
    if (!cueId) return Object.freeze({ played: false, reason: 'no-cue' });
    if (!this.enabled) return Object.freeze({ played: false, reason: 'disabled' });
    if (!this.context) await this.unlock();
    if (!this.context || this.context.state === 'closed') return Object.freeze({ played: false, reason: 'web-audio-unavailable' });
    if (this.context.state === 'suspended') await this.context.resume();

    try {
      const buffer = await this.#bufferFor(cueId);
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
      source.start();
      this.lastCueId = cueId;
      this.lastFailure = null;
      return Object.freeze({ played: true, cueId });
    } catch (error) {
      this.lastFailure = String(error?.message || error);
      return Object.freeze({ played: false, reason: this.lastFailure, cueId });
    }
  }
}

export function createAudioFabricPackPlayer(options = {}) {
  return new AudioFabricPackPlayer(options);
}
