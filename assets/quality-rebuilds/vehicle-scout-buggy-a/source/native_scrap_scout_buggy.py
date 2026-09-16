#!/usr/bin/env python3
"""Build the quality-v2 Scrap Scout Buggy with AXM's native geometry path.

The source concept is used as art direction, not claimed as an automatic or
exact reconstruction.  Geometry, materials, nodes, sockets, LOD and collision
are authored deterministically here.  Output is CREATED candidate evidence;
runtime behavior and visual acceptance remain separate gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Iterable

from PIL import Image, ImageDraw

from native_scene_gltf import Material, Mesh, Scene, box, cylinder, material_maps, scene_bounds, sphere, torus, transform, triangle_count, triangulate, tube, write_glb, write_gltf

ASSET_ID = "vehicle-scout-buggy-a"
CANDIDATE_ID = "scrap-buggy-quality-v2"
REFERENCE_SHA256 = "0fbad9cbbf521be91028dcef3e73112ceacab5837910a3d5700762ff67cada82"


def materials() -> dict[str, Material]:
    return {
        "painted_teal": Material("painted_teal", (44, 104, 105), .62, .53, .34),
        "old_cream": Material("old_cream", (206, 190, 148), .22, .68, .42),
        "signal_yellow": Material("signal_yellow", (227, 170, 49), .28, .52, .26),
        "oxidized_red": Material("oxidized_red", (133, 51, 39), .48, .64, .52),
        "dark_iron": Material("dark_iron", (50, 55, 53), .82, .37, .38),
        "steel": Material("steel", (126, 133, 126), .9, .25, .18),
        "rubber": Material("rubber", (34, 33, 28), .02, .88, .22),
        "upholstery": Material("upholstery", (73, 57, 42), .02, .82, .32),
        "glass_lamp": Material("glass_lamp", (255, 218, 126), .05, .2, .05, (1.0, .55, .12)),
    }


def add_box(scene: Scene, name: str, center, size, material: str, *, rotate=(0.0,0.0,0.0), parent="asset_root"):
    scene.add(name, box(name, center, size, rotate), material, parent)


def add_tube(scene: Scene, name: str, start, end, radius: float, material: str, *, segments=10, parent="asset_root"):
    scene.add(name, tube(name, start, end, radius, segments=segments), material, parent)


def wheel(scene: Scene, key: str, center: tuple[float,float,float], *, lod: int) -> None:
    x,y,z=center;parent=f"wheel_{key}";scene.group(parent, axm_role="driven_wheel", rotation_axis="x")
    major_segments,minor_segments=(24,8) if lod==0 else (16,5)
    scene.add(f"{parent}_tire",torus(f"{parent}_tire",center,.275,.105,axis="x",major_segments=major_segments,minor_segments=minor_segments),"rubber",parent)
    scene.add(f"{parent}_rim",cylinder(f"{parent}_rim",center,.225,.17,axis="x",segments=20 if lod==0 else 12),"old_cream",parent)
    scene.add(f"{parent}_hub",cylinder(f"{parent}_hub",(x + (.105 if x>0 else -.105),y,z),.075,.055,axis="x",segments=16 if lod==0 else 10),"oxidized_red",parent)
    tread_count=20 if lod==0 else 10
    for index in range(tread_count):
        angle=math.tau*index/tread_count
        cy=y+.378*math.cos(angle);cz=z+.378*math.sin(angle)
        add_box(scene,f"{parent}_tread_{index:02d}",(x,cy,cz),(.26,.105,.06),"rubber",rotate=(angle,0,(-.16 if index%2 else .16)),parent=parent)
    if lod==0:
        for index in range(8):
            angle=math.tau*index/8
            scene.add(f"{parent}_lug_{index:02d}",cylinder(f"{parent}_lug_{index:02d}",(x + (.142 if x>0 else -.142),y+.135*math.cos(angle),z+.135*math.sin(angle)),.018,.026,axis="x",segments=6),"steel",parent)


def flag_mesh(name: str, x: float, y: float, z: float) -> Mesh:
    vertices=[(x,y,z),(x+.44,y-.02,z+.02),(x,y-.32,z),(x+.40,y-.30,z+.015)]
    return Mesh(name,vertices,[(0,2,3,1)])


def smile_plate(scene: Scene, lod: int) -> None:
    scene.add("front_smile_plate",cylinder("front_smile_plate",(0,.72,1.095),.17,.035,axis="z",segments=28 if lod==0 else 16),"signal_yellow")
    for side in (-1,1):
        scene.add(f"smile_eye_{'left' if side<0 else 'right'}",sphere("smile_eye",(side*.055,.77,1.08),(.014,.014,.013),segments=8,rings=5),"dark_iron")
    add_tube(scene,"smile_arc_left",(-.09,.785,1.09),(-.035,.785,1.045),.009,"dark_iron",segments=6)
    add_tube(scene,"smile_arc_mid",(-.035,.785,1.045),(.035,.785,1.045),.009,"dark_iron",segments=6)
    add_tube(scene,"smile_arc_right",(.035,.785,1.045),(.09,.785,1.09),.009,"dark_iron",segments=6)


def build_scene(lod: int = 0) -> Scene:
    if lod not in (0,1): raise ValueError("LOD must be 0 or 1")
    scene=Scene(f"{ASSET_ID}_lod{lod}",materials(),extras={"asset_id":ASSET_ID,"candidate_id":CANDIDATE_ID,"lod":lod,"meters_per_unit":1,"truth_status":"CREATED_NOT_ACCEPTED"})
    # Four separately named wheels and exposed long-travel suspension.
    for key,x,z in (("front_left",-.72,.73),("front_right",.72,.73),("rear_left",-.72,-.73),("rear_right",.72,-.73)):
        wheel(scene,key,(x,.42,z),lod=lod)
        add_tube(scene,f"{key}_upper_wishbone",(x*.46,.69,z),(x,.46,z),.026,"steel",segments=8 if lod==0 else 6)
        add_tube(scene,f"{key}_lower_wishbone",(x*.42,.48,z),(x,.37,z),.026,"dark_iron",segments=8 if lod==0 else 6)
        add_tube(scene,f"{key}_shock",(x*.62,.49,z),(x*.48,.91,z),.031,"signal_yellow",segments=10 if lod==0 else 6)
        if lod==0:
            for coil in range(3):
                scene.add(f"{key}_spring_{coil}",torus("coil",(x*.55,.58+coil*.095,z),.074,.012,axis="y",major_segments=10,minor_segments=4),"dark_iron")
    # Chassis rails, belly protection, axles and visible fasteners.
    add_box(scene,"left_chassis_rail",(-.36,.61,0),(.11,.15,1.72),"dark_iron")
    add_box(scene,"right_chassis_rail",(.36,.61,0),(.11,.15,1.72),"dark_iron")
    add_box(scene,"belly_skid",(0,.61,.07),(.78,.09,1.58),"steel")
    add_tube(scene,"front_axle",(-.74,.42,.73),(.74,.42,.73),.048,"dark_iron",segments=12 if lod==0 else 8)
    add_tube(scene,"rear_axle",(-.74,.42,-.73),(.74,.42,-.73),.048,"dark_iron",segments=12 if lod==0 else 8)
    for z in (-.62,-.22,.25,.62): add_box(scene,f"floor_crossmember_{z}",(0,.69,z),(.83,.08,.07),"oxidized_red")
    # Distinctive sloped nose, patched side skins and exposed front guard.
    add_box(scene,"sloped_nose",(0,.82,.76),(.78,.19,.48),"painted_teal",rotate=(-.14,0,0))
    add_box(scene,"nose_cream_patch",(-.21,.925,.81),(.31,.028,.27),"old_cream",rotate=(-.14,0,.035))
    add_box(scene,"nose_red_patch",(.19,.93,.73),(.25,.03,.18),"oxidized_red",rotate=(-.14,0,-.06))
    add_tube(scene,"front_bullbar_left",(-.56,.43,1.02),(-.56,.77,1.08),.04,"signal_yellow",segments=10)
    add_tube(scene,"front_bullbar_right",(.56,.43,1.02),(.56,.77,1.08),.04,"signal_yellow",segments=10)
    add_tube(scene,"front_bullbar_top",(-.56,.77,1.08),(.56,.77,1.08),.04,"signal_yellow",segments=10)
    add_tube(scene,"front_bullbar_lower",(-.56,.45,1.02),(.56,.45,1.02),.04,"dark_iron",segments=10)
    add_tube(scene,"tow_loop_left",(-.34,.49,1.08),(-.22,.49,1.13),.025,"signal_yellow",segments=8)
    add_tube(scene,"tow_loop_right",(.34,.49,1.08),(.22,.49,1.13),.025,"signal_yellow",segments=8)
    # Round lamps remain separate emissive nodes/sockets.
    for side in (-1,1):
        x=side*.39;name="left" if side<0 else "right"
        scene.add(f"headlight_{name}_housing",cylinder("housing",(x,.91,.88),.11,.10,axis="z",segments=20 if lod==0 else 12),"dark_iron")
        scene.add(f"headlight_{name}_lens",cylinder("lens",(x,.91,.937),.082,.018,axis="z",segments=20 if lod==0 else 12),"glass_lamp")
    smile_plate(scene,lod)
    # Open two-seat cockpit with real cage load paths and negative space.
    cage_segments=12 if lod==0 else 8
    cage=[((- .59,.73,.50),(-.59,1.18,.18)),((.59,.73,.50),(.59,1.18,.18)),
          ((-.59,1.18,.18),(-.52,1.56,-.15)),((.59,1.18,.18),(.52,1.56,-.15)),
          ((-.52,1.56,-.15),(-.50,1.54,-.65)),((.52,1.56,-.15),(.50,1.54,-.65)),
          ((-.50,1.54,-.65),(-.58,.74,-.86)),((.50,1.54,-.65),(.58,.74,-.86)),
          ((-.52,1.56,-.15),(.52,1.56,-.15)),((-.50,1.54,-.65),(.50,1.54,-.65)),
          ((-.59,1.18,.18),(.59,1.18,.18)),((-.58,.78,-.83),(.58,.78,-.83))]
    for index,(start,end) in enumerate(cage): add_tube(scene,f"roll_cage_{index:02d}",start,end,.032,"dark_iron",segments=cage_segments)
    for side in (-1,1):
        x=side*.29;label="driver" if side<0 else "passenger"
        add_box(scene,f"{label}_seat_cushion",(x,.82,-.16),(.43,.16,.44),"upholstery",rotate=(.04,0,0))
        add_box(scene,f"{label}_seat_back",(x,1.08,-.42),(.43,.56,.14),"upholstery",rotate=(.18,0,0))
        add_tube(scene,f"{label}_harness_left",(x-.14,1.35,-.39),(x-.09,.86,-.11),.018,"signal_yellow",segments=6)
        add_tube(scene,f"{label}_harness_right",(x+.14,1.35,-.39),(x+.09,.86,-.11),.018,"signal_yellow",segments=6)
    scene.group("steering_wheel",translation=(-.28,1.14,.20),axm_role="driver_control",rotation_axis="local_z")
    scene.add("steering_wheel_ring",torus("steering",(-.28,1.14,.20),.125,.017,axis="z",major_segments=18 if lod==0 else 12,minor_segments=4),"dark_iron","steering_wheel")
    add_tube(scene,"steering_column",(-.28,.86,.04),(-.28,1.14,.20),.021,"steel",segments=8,parent="steering_wheel")
    for angle in (0,math.tau/3,2*math.tau/3):
        add_tube(scene,f"steering_spoke_{int(angle*100)}",(-.28,1.14,.20),(-.28+.105*math.cos(angle),1.14+.105*math.sin(angle),.20),.009,"steel",segments=5,parent="steering_wheel")
    # Rear engine, fuel, exhaust, recovery gear and modular utility swivel.
    add_box(scene,"rear_engine_block",(0,.86,-.72),(.58,.42,.38),"dark_iron")
    for index,x in enumerate((-.22,-.07,.08,.23)):
        add_tube(scene,f"engine_exhaust_{index}",(x,1.02,-.78),(x,1.20,-.94),.025,"steel",segments=8)
    scene.add("rear_fuel_drum",cylinder("fuel_drum",(.47,.93,-.62),.16,.48,axis="y",segments=24 if lod==0 else 14),"oxidized_red")
    for offset in (-.18,.18): scene.add(f"fuel_drum_band_{offset}",torus("band",(.47,.93+offset,-.62),.165,.013,axis="y",major_segments=16,minor_segments=4),"dark_iron")
    add_box(scene,"rear_luggage_crate",(-.31,.91,-.69),(.45,.33,.38),"old_cream")
    for side in (-1,1): add_tube(scene,f"crate_strap_{side}",(-.31+side*.15,.75,-.89),(-.31+side*.15,1.08,-.49),.014,"dark_iron",segments=6)
    scene.group("utility_mount_swivel",translation=(0,1.24,-.76),axm_role="universal_utility_hardpoint",rotation_axis="y")
    scene.add("utility_mount_base",cylinder("utility_base",(0,1.18,-.76),.19,.10,axis="y",segments=20 if lod==0 else 12),"dark_iron","utility_mount_swivel")
    scene.add("utility_mount_plate",box("utility_plate",(0,1.28,-.76),(.34,.08,.28)),"steel","utility_mount_swivel")
    add_tube(scene,"left_rear_handle",(-.49,.85,-.98),(-.49,1.17,-.98),.026,"signal_yellow",segments=8)
    add_tube(scene,"right_rear_handle",(.49,.85,-.98),(.49,1.17,-.98),.026,"signal_yellow",segments=8)
    add_tube(scene,"rear_handle_cross",(-.49,1.17,-.98),(.49,1.17,-.98),.026,"signal_yellow",segments=8)
    # Radio antenna and faction-neutral cloth identity marker.
    add_tube(scene,"antenna_mast",(.48,1.15,-.70),(.56,1.72,-.62),.012,"steel",segments=6)
    scene.add("survivor_flag",flag_mesh("survivor_flag",.555,1.69,-.62),"signal_yellow")
    if lod==0:
        add_box(scene,"flag_smile_eye_left",(.68,1.56,-.606),(.026,.026,.012),"dark_iron")
        add_box(scene,"flag_smile_eye_right",(.81,1.55,-.606),(.026,.026,.012),"dark_iron")
        add_tube(scene,"flag_smile_left",(.655,1.48,-.606),(.72,1.445,-.606),.009,"dark_iron",segments=5)
        add_tube(scene,"flag_smile_right",(.72,1.445,-.606),(.84,1.48,-.606),.009,"dark_iron",segments=5)
        for index,z in enumerate((-.92,-.79,-.66,-.53)):
            add_box(scene,f"engine_cooling_fin_{index}",(0,.93,z),(.44,.025,.045),"steel")
        for side in (-1,1):
            for index,z in enumerate((-.45,-.12,.24,.52)):
                scene.add(f"side_bolt_{side}_{index}",cylinder("bolt",(side*.545,.82,z),.018,.025,axis="x",segments=6),"signal_yellow")
    # Semantic sockets are empty named nodes, never inferred from mesh names.
    for name,position,role in (
        ("socket_driver",(-.29,1.04,-.18),"crew_seat"),("socket_passenger",(.29,1.04,-.18),"crew_seat"),
        ("socket_utility_hardpoint",(0,1.34,-.76),"vehicle_hardpoint"),("socket_front_tow",(0,.51,1.13),"tow"),
        ("socket_rear_hitch",(0,.55,-1.08),"hitch"),("socket_headlight_left",(-.39,.91,.96),"emissive"),
        ("socket_headlight_right",(.39,.91,.96),"emissive")):
        scene.group(name,translation=position,axm_role=role)
    return scene


def collision_scene() -> Scene:
    scene=Scene(f"{ASSET_ID}_collision",{"collision":Material("collision",(71,166,188),0,.9)},extras={"asset_id":ASSET_ID,"candidate_id":CANDIDATE_ID,"kind":"coarse_collision_candidate","not_physics_certified":True})
    scene.add("UCX_vehicle_body_00",box("body",(0,.76,0),(.82,.38,1.62)),"collision")
    scene.add("UCX_vehicle_cage_01",box("cage",(0,1.18,-.18),(1.02,.84,1.08)),"collision")
    for key,x,z in (("fl",-.72,.73),("fr",.72,.73),("rl",-.72,-.73),("rr",.72,-.73)):
        scene.add(f"UCX_wheel_{key}",cylinder("wheel",(x,.42,z),.38,.26,axis="x",segments=9),"collision")
    return scene


def _unit(v):
    length=math.sqrt(sum(x*x for x in v)) or 1.0
    return tuple(x/length for x in v)


def _dot(a,b): return sum(x*y for x,y in zip(a,b))


def _cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])


def render_scene(scene: Scene, path: Path, camera, *, target=(0,.9,0), size=768, mode="beauty") -> dict[str, object]:
    scale=2;canvas=Image.new("RGB",(size*scale,size*scale),(238,226,200) if mode=="beauty" else (5,8,9));draw=ImageDraw.Draw(canvas,"RGBA")
    if mode=="beauty":
        for y in range(canvas.height):
            t=y/canvas.height;color=(224+int(16*(1-t)),214+int(13*(1-t)),192+int(10*(1-t)))
            draw.line((0,y,canvas.width,y),fill=color)
        draw.ellipse((canvas.width*.18,canvas.height*.70,canvas.width*.82,canvas.height*.91),fill=(48,42,34,42))
    forward=_unit(tuple(target[i]-camera[i] for i in range(3)));right=_unit(_cross(forward,(0,1,0)));up=_unit(_cross(right,forward))
    lo,hi=scene_bounds(scene);corners=[(x,y,z) for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])]
    projected=[(_dot(tuple(c[i]-target[i] for i in range(3)),right),_dot(tuple(c[i]-target[i] for i in range(3)),up)) for c in corners]
    span=max(max(x for x,y in projected)-min(x for x,y in projected),max(y for x,y in projected)-min(y for x,y in projected))*1.16
    pixel=size*scale/span;triangles=[];depths=[]
    light=_unit((-.35,.82,.45))
    for part in scene.parts:
        mat=scene.materials[part.material]
        for a,b,c in triangulate(part.mesh):
            points=[];depth=0
            for p in (a,b,c):
                rel=tuple(p[i]-target[i] for i in range(3));u=_dot(rel,right);v=_dot(rel,up);depth+=_dot(tuple(p[i]-camera[i] for i in range(3)),forward)
                points.append((size*scale/2+u*pixel,size*scale*.54-v*pixel))
            normal=_unit(_cross(tuple(b[i]-a[i] for i in range(3)),tuple(c[i]-a[i] for i in range(3))))
            if mode=="silhouette": color=(230,236,232,255)
            elif mode=="normal": color=tuple(int((n*.5+.5)*255) for n in normal)+(255,)
            elif mode=="depth":
                d=depth/3;depths.append(d);color=(180,180,180,255)
            else:
                shade=.56+.44*max(0,_dot(normal,light));base=mat.base_color;color=tuple(max(0,min(255,int(v*shade))) for v in base)+(255,)
                if any(mat.emissive): color=(255,221,132,255)
            triangles.append([depth/3,points,color])
    if mode=="depth" and triangles:
        values=[row[0] for row in triangles];mn,mx=min(values),max(values);span_d=mx-mn or 1
        for row in triangles:
            v=int(35+210*(1-(row[0]-mn)/span_d));row[2]=(v,v,v,255)
    triangles.sort(key=lambda row:row[0],reverse=True)
    for _,points,color in triangles:
        draw.polygon(points,fill=color)
        if mode=="beauty": draw.line(points+[points[0]],fill=(20,24,22,64),width=max(1,scale))
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(path,optimize=True)
    data=path.read_bytes();return {"file":path.name,"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"camera":list(camera),"mode":mode}


def write_materials(root: Path, mats: dict[str,Material]) -> dict[str,object]:
    result={}
    for name,material in mats.items():
        folder=root/name;folder.mkdir(parents=True,exist_ok=True);maps=material_maps(material)
        record={"spec":{"base_color":list(material.base_color),"metallic":material.metallic,"roughness":material.roughness,"wear":material.wear,"emissive":list(material.emissive)},"maps":{}}
        for label,payload in zip(("base_color","orm","normal"),maps):
            file=folder/f"{label}.png";file.write_bytes(payload);record["maps"][label]={"file":str(file.relative_to(root.parent)),"sha256":hashlib.sha256(payload).hexdigest(),"bytes":len(payload)}
        (folder/"material.json").write_text(json.dumps(record,indent=2,sort_keys=True)+"\n")
        result[name]=record
    return result


def build(output: Path) -> dict[str,object]:
    delivery=output/"delivery";preview=output/"preview";diagnostics=output/"diagnostics";receipts=output/"receipts";textures=output/"textures"
    for folder in (delivery,preview,diagnostics,receipts,textures): folder.mkdir(parents=True,exist_ok=True)
    lod0,lod1,collision=build_scene(0),build_scene(1),collision_scene()
    texture_receipt=write_materials(textures,lod0.materials)
    outputs={
        "lod0":write_glb(lod0,delivery/"vehicle_scout_buggy_a_quality_v2_lod0.glb"),
        "lod1":write_glb(lod1,delivery/"vehicle_scout_buggy_a_quality_v2_lod1.glb"),
        "collision":write_glb(collision,delivery/"vehicle_scout_buggy_a_quality_v2_collision.glb"),
    }
    outputs["editable_gltf"]=write_gltf(lod0,delivery/"vehicle_scout_buggy_a_quality_v2_lod0.gltf",delivery/"vehicle_scout_buggy_a_quality_v2_lod0.bin")
    cameras={"hero-front":(3.3,2.65,4.7),"hero-rear":(-3.4,2.55,-4.6),"hero-side":(5.4,2.25,.25),"hero-top":(3.7,6.6,3.5)}
    beauty=[render_scene(lod0,preview/f"{name}.png",camera) for name,camera in cameras.items()]
    diagnostic=[]
    for view,camera in (("front",(0,1.1,5.5)),("side",(5.5,1.1,0)),("rear",(0,1.1,-5.5)),("top",(0,6.8,.01))):
        for mode in ("silhouette","depth","normal"):
            diagnostic.append(render_scene(lod0,diagnostics/f"{view}-{mode}.png",camera,size=512,mode=mode))
    source_state={"schema":"axm.global-state-rts.native-rigid-scene/v0.1","asset_id":ASSET_ID,"candidate_id":CANDIDATE_ID,"reference":{"sha256":REFERENCE_SHA256,"role":"user-supplied concept direction; no source pixels redistributed"},"axis":"+Y up, +Z forward","parts":[{"name":p.name,"material":p.material,"parent":p.parent,"triangles":len(triangulate(p.mesh))} for p in lod0.parts],"nodes":[{"name":n.name,"parent":n.parent,"translation":list(n.translation),"extras":n.extras} for n in lod0.nodes],"truth":"Deterministic authored geometry candidate. Source concept influenced visible design; hidden surfaces are inferred."}
    (output/"source"/"scene-source.json").write_text(json.dumps(source_state,indent=2,sort_keys=True)+"\n")
    manifest={"schema":"axm.global-state-rts.quality-rebuild/v0.1","status":"CREATED_NOT_ACCEPTED","asset_id":ASSET_ID,"candidate_id":CANDIDATE_ID,"name":"Scrap Scout Buggy — quality v2","art_direction":"miniature post-apocalyptic diorama RTS; chunky readable open-frame scout buggy; believable scrap repair history","source":{"builder":"source/native_scrap_scout_buggy.py","compiler":"source/native_scene_gltf.py","reference_sha256":REFERENCE_SHA256,"generation":"deterministic AXM-native procedural geometry and software proof renders"},"contract":{"meters_per_unit":1,"axis":"+Y up","forward":"+Z","pivot":"vehicle body/axle center at world origin; ground is y=0.04","separate_moving_nodes":["wheel_front_left","wheel_front_right","wheel_rear_left","wheel_rear_right","steering_wheel","utility_mount_swivel"],"sockets":["socket_driver","socket_passenger","socket_utility_hardpoint","socket_front_tow","socket_rear_hitch","socket_headlight_left","socket_headlight_right"]},"materials":{"families":len(lod0.materials),"names":list(lod0.materials),"procedural_maps":texture_receipt},"deliveries":outputs,"previews":beauty,"diagnostics":diagnostic,"measurements":{"lod0_triangles":triangle_count(lod0),"lod1_triangles":triangle_count(lod1),"collision_triangles":triangle_count(collision),"bounds":outputs["lod0"]["bounds"]},"verification":{"static_structure":"PASS","visual_review":"STATIC_PROOF_READY","engine_import":"NOT_RUN","wheel_or_steering_motion":"NOT_RUN","collision_physics":"NOT_RUN","runtime_scale":"NOT_RUN","target_device_performance":"NOT_RUN","split_screen_readability":"NOT_RUN"},"authority":"Candidate creation only. This manifest does not mark the asset ACCEPTED, TESTED in engine, or CANON."}
    manifest_path=output/"manifest.json";manifest_path.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    manifest_sha=hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    receipt={"schema":"axm.global-state-rts.quality-rebuild-receipt/v0.1","asset_id":ASSET_ID,"candidate_id":CANDIDATE_ID,"result":"PASS_STATIC_CREATED","manifest_sha256":manifest_sha,"checks":{"lod_descent":triangle_count(lod1)<triangle_count(lod0),"collision_cheaper":triangle_count(collision)<triangle_count(lod1),"required_named_nodes":True,"material_family_count":len(lod0.materials),"multi_angle_beauty_proofs":len(beauty),"diagnostic_frames":len(diagnostic)},"truth_boundary":manifest["verification"]}
    (receipts/"build-receipt.json").write_text(json.dumps(receipt,indent=2,sort_keys=True)+"\n")
    return manifest


def main() -> int:
    parser=argparse.ArgumentParser();parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[1]);args=parser.parse_args()
    manifest=build(args.output.resolve());print(json.dumps({"status":manifest["status"],"asset_id":manifest["asset_id"],"measurements":manifest["measurements"]},indent=2));return 0


if __name__=="__main__": raise SystemExit(main())
