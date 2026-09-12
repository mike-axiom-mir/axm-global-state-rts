import * as THREE from '../../planet-upstream/shared/vendor/three-r160/three.module.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ALLOWED_EXTENSIONS = new Set(['KHR_materials_emissive_strength']);
const COMPONENT_TYPES = Object.freeze({
  5121: Uint8Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array
});
const COMPONENT_BYTES = Object.freeze({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 });
const TYPE_COMPONENTS = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 });

function fail(message) {
  throw new Error(`static-glb-runtime: ${message}`);
}

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError('static-glb-runtime: ArrayBuffer or typed-array bytes required');
}

function decodeJson(bytes) {
  const text = new TextDecoder().decode(bytes).replace(/\u0000+$/g, '').trimEnd();
  return JSON.parse(text);
}

function parseChunks(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20) fail('GLB is too small');
  if (view.getUint32(0, true) !== GLB_MAGIC) fail('invalid GLB magic');
  if (view.getUint32(4, true) !== 2) fail('only GLB version 2 is supported');
  if (view.getUint32(8, true) !== buffer.byteLength) fail('GLB declared length does not match bytes');

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) fail('truncated GLB chunk header');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) fail('truncated GLB chunk');
    const chunk = buffer.slice(offset, offset + length);
    offset += length;
    if (type === JSON_CHUNK) {
      if (json) fail('multiple JSON chunks are not supported');
      json = decodeJson(new Uint8Array(chunk));
    } else if (type === BIN_CHUNK) {
      if (binary) fail('multiple BIN chunks are not supported');
      binary = chunk;
    }
  }
  if (!json || !binary) fail('GLB requires one JSON and one BIN chunk');
  return { json, binary };
}

function requiredArray(value) {
  return Array.isArray(value) ? value : [];
}

function textureInfoIndexes(material) {
  const pbr = material?.pbrMetallicRoughness || {};
  return [
    pbr.baseColorTexture,
    pbr.metallicRoughnessTexture,
    material?.normalTexture,
    material?.emissiveTexture,
    material?.occlusionTexture
  ].filter(Boolean);
}

function validateDocument(json) {
  if (String(json?.asset?.version || '')[0] !== '2') fail('glTF asset version 2 is required');
  if (requiredArray(json.buffers).length !== 1 || json.buffers[0]?.uri) {
    fail('only one embedded GLB buffer is supported');
  }
  if (requiredArray(json.animations).length) fail('animations are outside this static asset contract');
  if (requiredArray(json.skins).length) fail('skins are outside this static asset contract');
  if (requiredArray(json.cameras).length) fail('cameras are outside this static asset contract');

  for (const extension of requiredArray(json.extensionsRequired)) {
    if (!ALLOWED_EXTENSIONS.has(extension)) fail(`required extension ${extension} is unsupported`);
  }
  for (const extension of requiredArray(json.extensionsUsed)) {
    if (!ALLOWED_EXTENSIONS.has(extension)) fail(`used extension ${extension} is unsupported`);
  }

  for (const [index, accessor] of requiredArray(json.accessors).entries()) {
    if (accessor.sparse) fail(`sparse accessor ${index} is unsupported`);
    if (accessor.bufferView === undefined) fail(`accessor ${index} has no bufferView`);
    if (!COMPONENT_TYPES[accessor.componentType]) fail(`accessor ${index} component type is unsupported`);
    if (!TYPE_COMPONENTS[accessor.type]) fail(`accessor ${index} type ${accessor.type} is unsupported`);
    const bufferView = json.bufferViews?.[accessor.bufferView];
    if (!bufferView) fail(`accessor ${index} references missing bufferView`);
    if (bufferView.byteStride) fail(`interleaved accessor ${index} is unsupported`);
  }

  for (const [meshIndex, mesh] of requiredArray(json.meshes).entries()) {
    if (!requiredArray(mesh.primitives).length) fail(`mesh ${meshIndex} has no primitives`);
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      if ((primitive.mode ?? 4) !== 4) fail(`mesh ${meshIndex} primitive ${primitiveIndex} is not TRIANGLES`);
      if (primitive.indices === undefined) fail(`mesh ${meshIndex} primitive ${primitiveIndex} must be indexed`);
      const keys = Object.keys(primitive.attributes || {});
      for (const key of keys) {
        if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(key)) {
          fail(`mesh ${meshIndex} primitive ${primitiveIndex} attribute ${key} is unsupported`);
        }
      }
      for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        if (primitive.attributes?.[key] === undefined) {
          fail(`mesh ${meshIndex} primitive ${primitiveIndex} requires ${key}`);
        }
      }
    }
  }

  for (const [materialIndex, material] of requiredArray(json.materials).entries()) {
    if (material.alphaMode && !['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode)) {
      fail(`material ${materialIndex} alphaMode is unsupported`);
    }
    for (const info of textureInfoIndexes(material)) {
      if ((info.texCoord ?? 0) !== 0) fail(`material ${materialIndex} requires TEXCOORD_${info.texCoord}`);
    }
  }

  for (const [imageIndex, image] of requiredArray(json.images).entries()) {
    if (image.uri) fail(`image ${imageIndex} must be embedded in the GLB`);
    if (image.bufferView === undefined) fail(`image ${imageIndex} has no bufferView`);
    if (!['image/png', 'image/jpeg'].includes(image.mimeType)) {
      fail(`image ${imageIndex} mime type ${image.mimeType} is unsupported`);
    }
  }
}

export function decodeStaticGlb(value) {
  const bytes = asArrayBuffer(value);
  const parsed = parseChunks(bytes);
  validateDocument(parsed.json);
  return Object.freeze({ json: parsed.json, binary: parsed.binary });
}

function accessorArray(decoded, accessorIndex) {
  const accessor = decoded.json.accessors[accessorIndex];
  const bufferView = decoded.json.bufferViews[accessor.bufferView];
  const ArrayType = COMPONENT_TYPES[accessor.componentType];
  const itemSize = TYPE_COMPONENTS[accessor.type];
  const byteSize = COMPONENT_BYTES[accessor.componentType];
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const elementCount = accessor.count * itemSize;
  const byteLength = elementCount * byteSize;
  if (byteOffset + byteLength > decoded.binary.byteLength) fail(`accessor ${accessorIndex} exceeds BIN chunk`);
  const copy = decoded.binary.slice(byteOffset, byteOffset + byteLength);
  return Object.freeze({
    array: new ArrayType(copy),
    itemSize,
    normalized: Boolean(accessor.normalized),
    count: accessor.count,
    componentType: accessor.componentType
  });
}

function imageBytes(decoded, imageIndex) {
  const image = decoded.json.images[imageIndex];
  const bufferView = decoded.json.bufferViews[image.bufferView];
  const start = bufferView.byteOffset || 0;
  const end = start + bufferView.byteLength;
  if (end > decoded.binary.byteLength) fail(`image ${imageIndex} exceeds BIN chunk`);
  return new Uint8Array(decoded.binary.slice(start, end));
}

const WRAP = Object.freeze({
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping
});
const FILTER = Object.freeze({
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter
});

async function textureFactory(decoded) {
  if (typeof globalThis.createImageBitmap !== 'function') {
    fail('createImageBitmap is required for embedded image textures');
  }
  const cache = new Map();
  return async (textureIndex, { srgb = false } = {}) => {
    const key = `${textureIndex}:${srgb ? 'srgb' : 'linear'}`;
    if (cache.has(key)) return cache.get(key);
    const textureDef = decoded.json.textures?.[textureIndex];
    if (!textureDef || textureDef.source === undefined) fail(`missing texture ${textureIndex}`);
    const imageDef = decoded.json.images?.[textureDef.source];
    if (!imageDef) fail(`texture ${textureIndex} references missing image`);
    const bitmap = await globalThis.createImageBitmap(new Blob([imageBytes(decoded, textureDef.source)], { type: imageDef.mimeType }));
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const sampler = decoded.json.samplers?.[textureDef.sampler] || {};
    texture.wrapS = WRAP[sampler.wrapS ?? 10497] ?? THREE.RepeatWrapping;
    texture.wrapT = WRAP[sampler.wrapT ?? 10497] ?? THREE.RepeatWrapping;
    texture.magFilter = FILTER[sampler.magFilter ?? 9729] ?? THREE.LinearFilter;
    texture.minFilter = FILTER[sampler.minFilter ?? 9987] ?? THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    texture.userData.axmImageIndex = textureDef.source;
    texture.addEventListener('dispose', () => bitmap.close?.());
    cache.set(key, texture);
    return texture;
  };
}

async function materialFactory(decoded, getTexture) {
  const cache = new Map();
  return async materialIndex => {
    if (cache.has(materialIndex)) return cache.get(materialIndex);
    const def = decoded.json.materials?.[materialIndex] || {};
    const pbr = def.pbrMetallicRoughness || {};
    const base = pbr.baseColorFactor || [1, 1, 1, 1];
    const material = new THREE.MeshStandardMaterial({
      name: def.name || `material-${materialIndex}`,
      color: new THREE.Color(base[0], base[1], base[2]),
      opacity: base[3] ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      metalness: pbr.metallicFactor ?? 1,
      side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: def.alphaMode === 'BLEND' || (base[3] ?? 1) < 1,
      alphaTest: def.alphaMode === 'MASK' ? (def.alphaCutoff ?? 0.5) : 0
    });
    if (pbr.baseColorTexture) material.map = await getTexture(pbr.baseColorTexture.index, { srgb: true });
    if (pbr.metallicRoughnessTexture) {
      const orm = await getTexture(pbr.metallicRoughnessTexture.index);
      material.metalnessMap = orm;
      material.roughnessMap = orm;
    }
    if (def.normalTexture) {
      material.normalMap = await getTexture(def.normalTexture.index);
      const scale = def.normalTexture.scale ?? 1;
      material.normalScale = new THREE.Vector2(scale, scale);
    }
    if (def.emissiveTexture) material.emissiveMap = await getTexture(def.emissiveTexture.index, { srgb: true });
    const emissive = def.emissiveFactor || [0, 0, 0];
    material.emissive = new THREE.Color(emissive[0], emissive[1], emissive[2]);
    material.emissiveIntensity = def.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    material.needsUpdate = true;
    cache.set(materialIndex, material);
    return material;
  };
}

function applyNodeTransform(object, node) {
  if (node.matrix) {
    object.matrix.fromArray(node.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
  } else {
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
  }
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) fail('Web Crypto SHA-256 is required for exact runtime identity');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildStaticGlbScene(value, { expectedSha256 = null } = {}) {
  const bytes = asArrayBuffer(value);
  const sha256 = await sha256Hex(bytes);
  if (expectedSha256 && sha256 !== expectedSha256) {
    fail(`runtime bytes hash mismatch: expected ${expectedSha256}, got ${sha256}`);
  }
  const decoded = decodeStaticGlb(bytes);
  const getTexture = await textureFactory(decoded);
  const getMaterial = await materialFactory(decoded, getTexture);
  let primitiveCount = 0;
  let triangleCount = 0;

  async function buildMesh(meshIndex) {
    const meshDef = decoded.json.meshes[meshIndex];
    if (!meshDef) fail(`missing mesh ${meshIndex}`);
    const group = new THREE.Group();
    group.name = meshDef.name || `mesh-${meshIndex}`;
    for (const [primitiveIndex, primitive] of meshDef.primitives.entries()) {
      const geometry = new THREE.BufferGeometry();
      const position = accessorArray(decoded, primitive.attributes.POSITION);
      const normal = accessorArray(decoded, primitive.attributes.NORMAL);
      const uv = accessorArray(decoded, primitive.attributes.TEXCOORD_0);
      const indices = accessorArray(decoded, primitive.indices);
      if (position.itemSize !== 3 || normal.itemSize !== 3 || uv.itemSize !== 2 || indices.itemSize !== 1) {
        fail(`mesh ${meshIndex} primitive ${primitiveIndex} has unexpected accessor shapes`);
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(position.array, 3, position.normalized));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal.array, 3, normal.normalized));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv.array, 2, uv.normalized));
      geometry.setIndex(new THREE.BufferAttribute(indices.array, 1, indices.normalized));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = await getMaterial(primitive.material ?? -1);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${group.name}/primitive-${primitiveIndex}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      primitiveCount += 1;
      triangleCount += indices.count / 3;
    }
    return group.children.length === 1 ? group.children[0] : group;
  }

  const nodeStack = new Set();
  async function buildNode(nodeIndex) {
    if (nodeStack.has(nodeIndex)) fail(`node cycle detected at ${nodeIndex}`);
    nodeStack.add(nodeIndex);
    const node = decoded.json.nodes?.[nodeIndex];
    if (!node) fail(`missing node ${nodeIndex}`);
    const object = node.mesh === undefined ? new THREE.Group() : await buildMesh(node.mesh);
    object.name = node.name || object.name || `node-${nodeIndex}`;
    applyNodeTransform(object, node);
    for (const childIndex of requiredArray(node.children)) object.add(await buildNode(childIndex));
    nodeStack.delete(nodeIndex);
    return object;
  }

  const sceneIndex = decoded.json.scene ?? 0;
  const sceneDef = decoded.json.scenes?.[sceneIndex];
  if (!sceneDef) fail(`missing scene ${sceneIndex}`);
  const root = new THREE.Group();
  root.name = sceneDef.name || 'axm-static-glb-root';
  for (const nodeIndex of requiredArray(sceneDef.nodes)) root.add(await buildNode(nodeIndex));
  root.updateMatrixWorld(true);

  const receipt = Object.freeze({
    schema: 'axm.global-state-rts.static-glb-runtime-receipt/v0.1',
    status: 'RUNTIME_DECODED_NOT_VISUALLY_ACCEPTED',
    sha256,
    sceneIndex,
    nodes: requiredArray(decoded.json.nodes).length,
    meshes: requiredArray(decoded.json.meshes).length,
    primitives: primitiveCount,
    triangles: triangleCount,
    materials: requiredArray(decoded.json.materials).length,
    embeddedImages: requiredArray(decoded.json.images).length,
    extensionsUsed: Object.freeze([...requiredArray(decoded.json.extensionsUsed)]),
    nonclaims: Object.freeze([
      'Runtime decoding does not establish collision or navigation.',
      'Runtime decoding does not establish split-screen readability or visual acceptance.',
      'Runtime decoding does not establish target-device FPS or mass-RTS performance.'
    ])
  });
  root.userData.axmRuntimeReceipt = receipt;
  return Object.freeze({ object: root, receipt });
}
