#!/usr/bin/env python3
"""Small AXM-native rigid-scene glTF compiler used by the quality rebuild lane.

The compiler intentionally keeps rigid parts and sockets as named glTF nodes.
It is derived from the buffer/accessor approach in AXM Game Asset Forge's
``native_gltf.py`` but adds scene hierarchy, multiple PBR materials, embedded
procedural maps, and GLB output.  It does not claim animation or engine proof.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import random
import struct
from typing import Iterable
import zlib

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]
Face = tuple[int, ...]


@dataclass(slots=True)
class Mesh:
    name: str
    vertices: list[Vec3]
    faces: list[Face]


@dataclass(frozen=True, slots=True)
class Material:
    name: str
    base_color: tuple[int, int, int]
    metallic: float
    roughness: float
    wear: float = 0.2
    emissive: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass(slots=True)
class Part:
    name: str
    mesh: Mesh
    material: str
    parent: str = "asset_root"


@dataclass(slots=True)
class Node:
    name: str
    parent: str = "asset_root"
    translation: Vec3 = (0.0, 0.0, 0.0)
    extras: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class Scene:
    name: str
    materials: dict[str, Material]
    parts: list[Part] = field(default_factory=list)
    nodes: list[Node] = field(default_factory=list)
    extras: dict[str, object] = field(default_factory=dict)

    def add(self, name: str, mesh: Mesh, material: str, parent: str = "asset_root") -> None:
        if material not in self.materials:
            raise KeyError(f"unknown material {material}")
        self.parts.append(Part(name, mesh, material, parent))

    def group(self, name: str, parent: str = "asset_root", translation: Vec3 = (0.0, 0.0, 0.0), **extras: object) -> None:
        self.nodes.append(Node(name, parent, translation, extras))


def _matmul(v: Vec3, rotation: Vec3) -> Vec3:
    x, y, z = v
    rx, ry, rz = rotation
    cy, sy = math.cos(rx), math.sin(rx)
    y, z = y * cy - z * sy, y * sy + z * cy
    cy, sy = math.cos(ry), math.sin(ry)
    x, z = x * cy + z * sy, -x * sy + z * cy
    cy, sy = math.cos(rz), math.sin(rz)
    x, y = x * cy - y * sy, x * sy + y * cy
    return x, y, z


def transform(mesh: Mesh, *, translate: Vec3 = (0.0, 0.0, 0.0), rotate: Vec3 = (0.0, 0.0, 0.0), scale: Vec3 = (1.0, 1.0, 1.0), name: str | None = None) -> Mesh:
    tx, ty, tz = translate
    sx, sy, sz = scale
    vertices = []
    for x, y, z in mesh.vertices:
        x, y, z = _matmul((x * sx, y * sy, z * sz), rotate)
        vertices.append((x + tx, y + ty, z + tz))
    return Mesh(name or mesh.name, vertices, list(mesh.faces))


def box(name: str, center: Vec3, size: Vec3, rotate: Vec3 = (0.0, 0.0, 0.0)) -> Mesh:
    x, y, z = (value * 0.5 for value in size)
    mesh = Mesh(name, [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
                [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    return transform(mesh, translate=center, rotate=rotate)


def cylinder(name: str, center: Vec3, radius: float, length: float, *, axis: str = "y", segments: int = 16) -> Mesh:
    if segments < 3:
        raise ValueError("segments must be >= 3")
    half = length * 0.5
    vertices: list[Vec3] = []
    for side in (-half, half):
        for index in range(segments):
            angle = math.tau * index / segments
            a, b = radius * math.cos(angle), radius * math.sin(angle)
            if axis == "x": vertices.append((side, a, b))
            elif axis == "z": vertices.append((a, b, side))
            else: vertices.append((a, side, b))
    faces: list[Face] = []
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((index, nxt, segments + nxt, segments + index))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(segments, segments * 2)))
    return transform(Mesh(name, vertices, faces), translate=center)


def tube(name: str, start: Vec3, end: Vec3, radius: float, *, segments: int = 10) -> Mesh:
    sx, sy, sz = start
    ex, ey, ez = end
    dx, dy, dz = ex - sx, ey - sy, ez - sz
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length <= 1e-9:
        return cylinder(name, start, radius, radius * 2, segments=segments)
    direction = (dx / length, dy / length, dz / length)
    helper = (0.0, 1.0, 0.0) if abs(direction[1]) < 0.9 else (1.0, 0.0, 0.0)
    ux = direction[1] * helper[2] - direction[2] * helper[1]
    uy = direction[2] * helper[0] - direction[0] * helper[2]
    uz = direction[0] * helper[1] - direction[1] * helper[0]
    ul = math.sqrt(ux * ux + uy * uy + uz * uz)
    u = (ux / ul, uy / ul, uz / ul)
    v = (direction[1] * u[2] - direction[2] * u[1], direction[2] * u[0] - direction[0] * u[2], direction[0] * u[1] - direction[1] * u[0])
    vertices: list[Vec3] = []
    for point in (start, end):
        for index in range(segments):
            angle = math.tau * index / segments
            ca, sa = math.cos(angle), math.sin(angle)
            vertices.append((point[0] + radius * (u[0] * ca + v[0] * sa), point[1] + radius * (u[1] * ca + v[1] * sa), point[2] + radius * (u[2] * ca + v[2] * sa)))
    faces: list[Face] = []
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((index, segments + index, segments + nxt, nxt))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(segments, segments * 2)))
    return Mesh(name, vertices, faces)


def torus(name: str, center: Vec3, major: float, minor: float, *, axis: str = "x", major_segments: int = 24, minor_segments: int = 8) -> Mesh:
    vertices: list[Vec3] = []
    for i in range(major_segments):
        a = math.tau * i / major_segments
        ca, sa = math.cos(a), math.sin(a)
        for j in range(minor_segments):
            b = math.tau * j / minor_segments
            cb, sb = math.cos(b), math.sin(b)
            ring = major + minor * cb
            if axis == "x": point = (minor * sb, ring * ca, ring * sa)
            elif axis == "z": point = (ring * ca, ring * sa, minor * sb)
            else: point = (ring * ca, minor * sb, ring * sa)
            vertices.append((point[0] + center[0], point[1] + center[1], point[2] + center[2]))
    faces: list[Face] = []
    for i in range(major_segments):
        ni = (i + 1) % major_segments
        for j in range(minor_segments):
            nj = (j + 1) % minor_segments
            faces.append((i * minor_segments + j, ni * minor_segments + j, ni * minor_segments + nj, i * minor_segments + nj))
    return Mesh(name, vertices, faces)


def sphere(name: str, center: Vec3, radii: Vec3, *, segments: int = 16, rings: int = 8) -> Mesh:
    vertices = [(0.0, 1.0, 0.0)]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        y = math.cos(phi)
        rr = math.sin(phi)
        for seg in range(segments):
            angle = math.tau * seg / segments
            vertices.append((rr * math.cos(angle), y, rr * math.sin(angle)))
    bottom = len(vertices)
    vertices.append((0.0, -1.0, 0.0))
    faces: list[Face] = []
    for seg in range(segments): faces.append((0, 1 + seg, 1 + (seg + 1) % segments))
    for ring in range(rings - 2):
        row, nxt = 1 + ring * segments, 1 + (ring + 1) * segments
        for seg in range(segments):
            n = (seg + 1) % segments
            faces.append((row + seg, nxt + seg, nxt + n, row + n))
    last = 1 + (rings - 2) * segments
    for seg in range(segments): faces.append((last + seg, bottom, last + (seg + 1) % segments))
    return transform(Mesh(name, vertices, faces), translate=center, scale=radii)


def triangulate(mesh: Mesh) -> list[tuple[Vec3, Vec3, Vec3]]:
    result = []
    for face in mesh.faces:
        for index in range(1, len(face) - 1):
            result.append((mesh.vertices[face[0]], mesh.vertices[face[index]], mesh.vertices[face[index + 1]]))
    return result


def triangle_indices(mesh: Mesh) -> list[int]:
    result: list[int] = []
    for face in mesh.faces:
        for index in range(1, len(face) - 1):
            result.extend((face[0], face[index], face[index + 1]))
    return result


def scene_bounds(scene: Scene) -> tuple[Vec3, Vec3]:
    vertices = [point for part in scene.parts for point in part.mesh.vertices]
    if not vertices:
        return (0.0,0.0,0.0),(0.0,0.0,0.0)
    return tuple(min(v[i] for v in vertices) for i in range(3)), tuple(max(v[i] for v in vertices) for i in range(3))


def triangle_count(scene: Scene) -> int:
    return sum(len(triangulate(part.mesh)) for part in scene.parts)


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]


def _normal(a: Vec3, b: Vec3, c: Vec3) -> Vec3:
    value = _cross((b[0]-a[0],b[1]-a[1],b[2]-a[2]),(c[0]-a[0],c[1]-a[1],c[2]-a[2]))
    length = math.sqrt(sum(x*x for x in value)) or 1.0
    return value[0]/length,value[1]/length,value[2]/length


def _png(width: int, height: int, channels: int, pixels: bytes) -> bytes:
    kind = {1:0,3:2,4:6}[channels]
    stride = width * channels
    raw = b"".join(b"\x00" + pixels[row*stride:(row+1)*stride] for row in range(height))
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I",len(payload))+tag+payload+struct.pack(">I",zlib.crc32(tag+payload)&0xffffffff)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,kind,0,0,0))+chunk(b"IDAT",zlib.compress(raw,9))+chunk(b"IEND",b"")


def material_maps(material: Material, *, size: int = 64) -> tuple[bytes, bytes, bytes]:
    seed = int(hashlib.sha256(material.name.encode()).hexdigest()[:8],16)
    rng = random.Random(seed)
    base, orm, normal = bytearray(), bytearray(), bytearray()
    for y in range(size):
        for x in range(size):
            grain = (math.sin((x+seed%19)*.73)+math.sin((y+seed%23)*.49))*0.5 + rng.uniform(-.35,.35)
            chip = rng.random() < material.wear * .035
            if chip:
                color = (112,104,91)
                metal = 235
                rough = 120
            else:
                shade = max(.72,min(1.12,1.0+grain*.055))
                color = tuple(max(0,min(255,round(c*shade))) for c in material.base_color)
                metal = round(255*material.metallic)
                rough = round(255*material.roughness)
            base.extend(color)
            orm.extend((245,rough,metal))
            nx = int(128 + max(-22,min(22,grain*6)))
            ny = int(128 + max(-22,min(22,math.sin((x+y)*.31)*5)))
            normal.extend((nx,ny,252))
    return _png(size,size,3,bytes(base)),_png(size,size,3,bytes(orm)),_png(size,size,3,bytes(normal))


def _align(blob: bytearray) -> None:
    while len(blob)%4: blob.append(0)


def compile_scene(scene: Scene, *, external_buffer_uri: str | None = None) -> tuple[dict[str, object], bytes]:
    blob=bytearray();views=[];accessors=[];meshes=[];nodes=[]
    def view(payload: bytes, target: int|None=None) -> int:
        _align(blob);offset=len(blob);blob.extend(payload);row={"buffer":0,"byteOffset":offset,"byteLength":len(payload)}
        if target is not None: row["target"]=target
        views.append(row);return len(views)-1
    def accessor(values: list[tuple[float,...]], kind: str, bounds: bool=False) -> int:
        flat=[v for row in values for v in row];idx=view(struct.pack("<"+"f"*len(flat),*flat),34962)
        item={"bufferView":idx,"componentType":5126,"count":len(values),"type":kind}
        if bounds:
            item["min"]=[min(row[i] for row in values) for i in range(len(values[0]))]
            item["max"]=[max(row[i] for row in values) for i in range(len(values[0]))]
        accessors.append(item);return len(accessors)-1
    material_names=list(scene.materials)
    material_index={name:i for i,name in enumerate(material_names)}
    images=[];textures=[];materials=[];samplers=[{"magFilter":9729,"minFilter":9987,"wrapS":10497,"wrapT":10497}]
    texture_receipt={}
    for name in material_names:
        material=scene.materials[name];maps=material_maps(material);indices=[];hashes=[]
        for label,payload in zip(("base_color","orm","normal"),maps):
            index=view(payload);images.append({"name":f"{name}_{label}","bufferView":index,"mimeType":"image/png"});textures.append({"sampler":0,"source":len(images)-1});indices.append(len(textures)-1);hashes.append(hashlib.sha256(payload).hexdigest())
        pbr={"baseColorTexture":{"index":indices[0]},"metallicRoughnessTexture":{"index":indices[1]},"baseColorFactor":[1,1,1,1],"metallicFactor":material.metallic,"roughnessFactor":material.roughness}
        row={"name":name,"pbrMetallicRoughness":pbr,"normalTexture":{"index":indices[2],"scale":.45},"occlusionTexture":{"index":indices[1],"strength":.8}}
        if any(material.emissive): row["emissiveFactor"]=list(material.emissive)
        materials.append(row);texture_receipt[name]={"base_color":hashes[0],"orm":hashes[1],"normal":hashes[2]}
    for part in scene.parts:
        positions=list(part.mesh.vertices)
        uvs=[((point[0]*.41+point[2]*.19)%1.0,(point[1]*.47+point[2]*.23)%1.0) for point in positions]
        indices=triangle_indices(part.mesh)
        # NORMAL is intentionally omitted. glTF consumers derive flat normals
        # when the attribute is absent, preserving hard-surface edges without
        # duplicating every triangle corner in the delivery buffer.
        pa=accessor(positions,"VEC3",True);ua=accessor(uvs,"VEC2")
        payload=struct.pack("<"+"I"*len(indices),*indices);iv=view(payload,34963);accessors.append({"bufferView":iv,"componentType":5125,"count":len(indices),"type":"SCALAR","min":[0],"max":[len(indices)-1]});ia=len(accessors)-1
        meshes.append({"name":part.name,"primitives":[{"attributes":{"POSITION":pa,"TEXCOORD_0":ua},"indices":ia,"material":material_index[part.material],"mode":4}]})
        nodes.append({"name":part.name,"mesh":len(meshes)-1,"extras":{"axm_material_role":part.material,"axm_parent":part.parent}})
    part_nodes=len(nodes);named=[Node("asset_root",parent="")]+scene.nodes
    named_index={node.name:part_nodes+i for i,node in enumerate(named)}
    for node in named:
        row={"name":node.name}
        if node.translation!=(0,0,0): row["translation"]=list(node.translation)
        if node.extras: row["extras"]=node.extras
        nodes.append(row)
    children={name:[] for name in named_index}
    for index,part in enumerate(scene.parts): children.setdefault(part.parent,[]).append(index)
    for node in scene.nodes: children.setdefault(node.parent,[]).append(named_index[node.name])
    for name,index in named_index.items():
        if children.get(name): nodes[index]["children"]=children[name]
    _align(blob);lo,hi=scene_bounds(scene)
    document={"asset":{"version":"2.0","generator":"AXM Game Asset Forge native_scene_gltf v0.2"},"scene":0,"scenes":[{"name":scene.name,"nodes":[named_index["asset_root"]]}],"nodes":nodes,"meshes":meshes,"materials":materials,"samplers":samplers,"images":images,"textures":textures,"buffers":[{"byteLength":len(blob)}],"bufferViews":views,"accessors":accessors,"extras":{"axm":{"axis":"+Y up, +Z forward","bounds":{"min":list(lo),"max":list(hi)},"triangles":triangle_count(scene),"material_maps_sha256":texture_receipt,**scene.extras}}}
    if external_buffer_uri: document["buffers"][0]["uri"]=external_buffer_uri
    return document,bytes(blob)


def write_glb(scene: Scene, path: str|Path) -> dict[str, object]:
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);document,binary=compile_scene(scene)
    encoded=json.dumps(document,separators=(",",":"),ensure_ascii=False).encode();encoded+=b" "*((4-len(encoded)%4)%4);binary+=b"\0"*((4-len(binary)%4)%4)
    total=12+8+len(encoded)+8+len(binary);payload=struct.pack("<4sII",b"glTF",2,total)+struct.pack("<I4s",len(encoded),b"JSON")+encoded+struct.pack("<I4s",len(binary),b"BIN\0")+binary
    path.write_bytes(payload);return {"file":path.name,"sha256":hashlib.sha256(payload).hexdigest(),"bytes":len(payload),"triangles":triangle_count(scene),"nodes":len(document["nodes"]),"materials":len(document["materials"]),"bounds":document["extras"]["axm"]["bounds"]}


def write_gltf(scene: Scene, gltf_path: str|Path, bin_path: str|Path) -> dict[str, object]:
    gltf_path,bin_path=Path(gltf_path),Path(bin_path);document,binary=compile_scene(scene,external_buffer_uri=bin_path.name)
    gltf_path.parent.mkdir(parents=True,exist_ok=True);gltf_path.write_text(json.dumps(document,indent=2,sort_keys=True)+"\n");bin_path.write_bytes(binary)
    return {"gltf":gltf_path.name,"gltf_sha256":hashlib.sha256(gltf_path.read_bytes()).hexdigest(),"bin":bin_path.name,"bin_sha256":hashlib.sha256(binary).hexdigest()}
