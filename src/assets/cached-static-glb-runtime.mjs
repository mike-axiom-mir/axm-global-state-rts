import { buildStaticGlbScene as buildStaticGlbSceneUncached } from './static-glb-runtime.mjs';

export const STATIC_GLB_CACHE_SCHEMA = 'axm.global-state-rts.static-glb-decode-cache/v0.1';

const templatePromises = new Map();
const stats = {
  templateBuilds: 0,
  cacheHits: 0,
  cacheMisses: 0,
  instances: 0
};

const TEXTURE_SLOTS = Object.freeze([
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'envMap'
]);

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError('cached-static-glb-runtime: ArrayBuffer or typed-array bytes required');
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) throw new Error('cached-static-glb-runtime: Web Crypto SHA-256 required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cloneTexture(source, textureCache) {
  if (!source) return source;
  if (textureCache.has(source)) return textureCache.get(source);
  const clone = source.clone();
  // Three.Texture.clone()/copy preserves the decoded Source/ImageBitmap but not
  // the original Texture's event listeners. This gives each instance its own
  // disposable texture object without repeating image decode.
  clone.needsUpdate = true;
  clone.userData = { ...source.userData, axmDecodedSourceShared: true };
  textureCache.set(source, clone);
  return clone;
}

function cloneMaterial(source, materialCache, textureCache) {
  if (!source) return source;
  if (materialCache.has(source)) return materialCache.get(source);
  const clone = source.clone();
  for (const slot of TEXTURE_SLOTS) {
    if (source[slot]) clone[slot] = cloneTexture(source[slot], textureCache);
  }
  clone.userData = { ...source.userData, axmDecodedTemplateClone: true };
  clone.needsUpdate = true;
  materialCache.set(source, clone);
  return clone;
}

function cloneTemplateObject(template) {
  const clone = template.clone(true);
  const geometryCache = new Map();
  const materialCache = new Map();
  const textureCache = new Map();

  clone.traverse(object => {
    if (object.geometry) {
      const sourceGeometry = object.geometry;
      let geometry = geometryCache.get(sourceGeometry);
      if (!geometry) {
        geometry = sourceGeometry.clone();
        geometry.userData = { ...sourceGeometry.userData, axmDecodedTemplateClone: true };
        geometryCache.set(sourceGeometry, geometry);
      }
      object.geometry = geometry;
    }

    if (Array.isArray(object.material)) {
      object.material = object.material.map(material => cloneMaterial(material, materialCache, textureCache));
    } else if (object.material) {
      object.material = cloneMaterial(object.material, materialCache, textureCache);
    }
    object.userData = { ...object.userData, axmDecodedTemplateClone: true };
  });

  return clone;
}

async function templateFor(buffer, sha256) {
  let pending = templatePromises.get(sha256);
  const cacheStatus = pending ? 'HIT' : 'MISS';
  if (pending) {
    stats.cacheHits += 1;
  } else {
    stats.cacheMisses += 1;
    pending = (async () => {
      stats.templateBuilds += 1;
      return buildStaticGlbSceneUncached(buffer, { expectedSha256: sha256 });
    })();
    templatePromises.set(sha256, pending);
  }

  try {
    return { loaded: await pending, cacheStatus };
  } catch (error) {
    if (templatePromises.get(sha256) === pending) templatePromises.delete(sha256);
    throw error;
  }
}

export async function buildStaticGlbScene(value, { expectedSha256 = null } = {}) {
  const buffer = asArrayBuffer(value);
  const sha256 = await sha256Hex(buffer);
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(`cached-static-glb-runtime: runtime bytes hash mismatch: expected ${expectedSha256}, got ${sha256}`);
  }

  const { loaded, cacheStatus } = await templateFor(buffer, sha256);
  const object = cloneTemplateObject(loaded.object);
  stats.instances += 1;
  const receipt = Object.freeze({
    ...loaded.receipt,
    decodedTemplateCache: Object.freeze({
      schema: STATIC_GLB_CACHE_SCHEMA,
      status: cacheStatus,
      sha256,
      templateBuilds: stats.templateBuilds,
      instances: stats.instances,
      boundary: 'Decoded template/ImageBitmap sources are reused; each returned instance still owns cloned geometry/material/texture objects.'
    })
  });
  object.userData.axmRuntimeReceipt = receipt;
  return Object.freeze({ object, receipt });
}

export function staticGlbDecodeCacheStats() {
  return Object.freeze({
    schema: STATIC_GLB_CACHE_SCHEMA,
    templates: templatePromises.size,
    templateBuilds: stats.templateBuilds,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    instances: stats.instances,
    nonclaims: Object.freeze([
      'This cache does not prove GPU texture residency is shared across instances.',
      'Geometry, material and texture wrapper objects remain per-instance for disposal isolation.',
      'A decoded-template cache does not establish target-device FPS acceptance.'
    ])
  });
}
