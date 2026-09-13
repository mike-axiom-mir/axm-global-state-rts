const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z/D/PwAG/gL+DHWJ3gAAAABJRU5ErkJggg==';

function base64Bytes(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function bytesOf(typed) {
  return new Uint8Array(typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength));
}

function align4(value) {
  return (value + 3) & ~3;
}

function concatAligned(parts) {
  const offsets = [];
  let size = 0;
  for (const part of parts) {
    size = align4(size);
    offsets.push(size);
    size += part.byteLength;
  }
  const output = new Uint8Array(align4(size));
  parts.forEach((part, index) => output.set(part, offsets[index]));
  return { output, offsets };
}

export function createStaticGlbFixture({ unsupportedExtension = null, tag = '' } = {}) {
  const positions = bytesOf(new Float32Array([
    -10, 0, 0,
    10, 0, 0,
    0, 18, 0
  ]));
  const normals = bytesOf(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ]));
  const uvs = bytesOf(new Float32Array([
    0, 0,
    1, 0,
    0.5, 1
  ]));
  const indices = bytesOf(new Uint16Array([0, 1, 2]));
  const png = base64Bytes(PNG_1X1);
  const { output: binary, offsets } = concatAligned([positions, normals, uvs, indices, png]);
  const suffix = tag ? `:${String(tag)}` : '';

  const json = {
    asset: { version: '2.0', generator: `AXM deterministic browser GLB fixture${suffix}` },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: `runtime-fixture-node${suffix}`, mesh: 0 }],
    meshes: [{
      name: `runtime-fixture-mesh${suffix}`,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
        mode: 4
      }]
    }],
    materials: [{
      name: `runtime-fixture-material${suffix}`,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.72
      }
    }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-10, 0, 0], max: [10, 18, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: normals.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: uvs.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: indices.byteLength, target: 34963 },
      { buffer: 0, byteOffset: offsets[4], byteLength: png.byteLength }
    ],
    buffers: [{ byteLength: binary.byteLength }]
  };
  if (unsupportedExtension) json.extensionsUsed = [unsupportedExtension];

  const encoder = new TextEncoder();
  const rawJson = encoder.encode(JSON.stringify(json));
  const jsonLength = align4(rawJson.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + jsonLength);
  glb.set(rawJson, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binary.byteLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  glb.set(binary, binHeader + 8);
  return glb.buffer;
}
