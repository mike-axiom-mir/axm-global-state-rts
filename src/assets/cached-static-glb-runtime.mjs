import { buildStaticGlbScene as buildStaticGlbSceneUncached } from './static-glb-runtime.mjs';

export const STATIC_GLB_CACHE_SCHEMA = 'axm.global-state-rts.static-glb-decode-cache/v0.2-shared-resources';

const templatePromises = new Map();
const hashPromises = new WeakMap();
const protectedDisposables = new WeakMap();
const stats = {
  templateBuilds: 0,
  cacheHits: 0,
  cacheMisses: 0,
  instances: 0,
  hashBuilds: 0,
  hashHits: 0,
  sharedGeometries: 0,
  sharedMaterials: 0,
  sharedTextures: 0,
  suppressedDisposals: 0
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

function hashFor(buffer) {
  let pending = hashPromises.get(buffer);
  if (pending) {
    stats.hashHits += 1;
    return pending;
  }
  stats.hashBuilds += 1;
  pending = sha256Hex(buffer);
  hashPromises.set(buffer, pending);
  pending.catch(() => {
    if (hashPromises.get(buffer) === pending) hashPromises.delete(buffer);
  });
  return pending;
}

function protectSharedDisposable(resource, kind) {
  if (!resource || typeof resource.dispose !== 'function') return;
  if (protectedDisposables.has(resource)) return;
  const originalDispose = resource.dispose.bind(resource);
  protectedDisposables.set(resource, originalDispose);
  resource.userData = {
    ...(resource.userData || {}),
    axmSharedImmutableResource: true,
    axmSharedResourceKind: kind,
    axmSharedResourceOwner: 'page-static-glb-template-cache'
  };
  resource.dispose = () => {
    // Local seat/scene disposal must never invalidate resources still shared by
    // sibling seat instances. The template cache owns these resources for the
    // lifetime of the page. A later explicit cache-lifetime API can release
    // them only when no live instance remains.
    stats.suppressedDisposals += 1;
  };
}

function protectTemplateResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of list) {
      materials.add(material);
      for (const slot of TEXTURE_SLOTS) {
        if (material?.[slot]) textures.add(material[slot]);
      }
    }
  });

  for (const geometry of geometries) protectSharedDisposable(geometry, 'geometry');
  for (const material of materials) protectSharedDisposable(material, 'material');
  for (const texture of textures) protectSharedDisposable(texture, 'texture');

  stats.sharedGeometries += geometries.size;
  stats.sharedMaterials += materials.size;
  stats.sharedTextures += textures.size;
  return Object.freeze({
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size
  });
}

function instantiateSharedTemplate(template) {
  // Object3D.clone(true) creates independent scene/node wrappers but Three.js
  // intentionally retains the same geometry and material references. That is
  // the behavior wanted here: transforms/userData remain seat-local while the
  // immutable heavy resources are shared.
  const clone = template.clone(true);
  clone.traverse(object => {
    object.userData = {
      ...(object.userData || {}),
      axmSharedDecodedResources: true,
      axmSharedResourceOwner: 'page-static-glb-template-cache'
    };
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
      const loaded = await buildStaticGlbSceneUncached(buffer, { expectedSha256: sha256 });
      const resources = protectTemplateResources(loaded.object);
      loaded.object.traverse(object => {
        object.userData = {
          ...(object.userData || {}),
          axmSharedDecodedResources: true,
          axmSharedResourceOwner: 'page-static-glb-template-cache'
        };
      });
      return Object.freeze({ ...loaded, resources });
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
  const sha256 = await hashFor(buffer);
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(`cached-static-glb-runtime: runtime bytes hash mismatch: expected ${expectedSha256}, got ${sha256}`);
  }

  const { loaded, cacheStatus } = await templateFor(buffer, sha256);
  const object = instantiateSharedTemplate(loaded.object);
  stats.instances += 1;
  const receipt = Object.freeze({
    ...loaded.receipt,
    decodedTemplateCache: Object.freeze({
      schema: STATIC_GLB_CACHE_SCHEMA,
      status: cacheStatus,
      sha256,
      templateBuilds: stats.templateBuilds,
      instances: stats.instances,
      resourceMode: 'SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE',
      sharedResources: loaded.resources,
      boundary: 'Object/transform wrappers are per instance; geometry, materials and textures are page-cache-owned immutable shared resources.'
    })
  });
  object.userData = {
    ...(object.userData || {}),
    axmRuntimeReceipt: receipt,
    axmSharedDecodedResources: true,
    axmSharedResourceOwner: 'page-static-glb-template-cache'
  };
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
    hashBuilds: stats.hashBuilds,
    hashHits: stats.hashHits,
    sharedGeometries: stats.sharedGeometries,
    sharedMaterials: stats.sharedMaterials,
    sharedTextures: stats.sharedTextures,
    suppressedDisposals: stats.suppressedDisposals,
    resourceMode: 'SHARED_IMMUTABLE_GEOMETRY_MATERIAL_TEXTURE',
    lifetime: 'PAGE_CACHE_OWNS_RESOURCES',
    nonclaims: Object.freeze([
      'Shared Three.js resource identity does not by itself prove target GPU residency or FPS improvement.',
      'Shared geometry/material/texture resources are immutable by contract; mutating one would affect every live instance.',
      'Resources intentionally remain cache-owned for the browser-page lifetime; explicit cache eviction is not implemented yet.',
      'A shared-resource cache does not establish target-device performance acceptance.'
    ])
  });
}
