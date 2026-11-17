"""Headless Blender thumbnail renderer for private GLB previews.

Run only by the server with fixed argv. Imports a GLB, frames visible meshes,
and renders a square PNG thumbnail. No network access or external scripts.
"""
import bpy,sys,math
from mathutils import Vector
from pathlib import Path

args=sys.argv[sys.argv.index('--')+1:]
source,destination,size=args[0],args[1],max(256,min(1024,int(args[2])))

# Clean default scene.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.meshes):
    if not block.users:bpy.data.meshes.remove(block)

bpy.ops.import_scene.gltf(filepath=source)
meshes=[o for o in bpy.data.objects if o.type=='MESH']
if not meshes:raise RuntimeError('GLB has no mesh objects')

scene=bpy.context.scene
# The deployment server is headless. Eevee requires a graphics/display backend;
# Cycles CPU renders privately without depending on X11, EGL or a GPU context.
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=16
scene.render.threads_mode='FIXED'
scene.render.threads=2
scene.render.film_transparent=False
scene.render.resolution_x=size
scene.render.resolution_y=size
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=destination

world=bpy.data.worlds.new('FreeLabThumbnailWorld')
scene.world=world
world.use_nodes=True
bg=world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value=(0.07,0.11,0.12,1.0)
    bg.inputs[1].default_value=0.9

for obj in meshes:
    obj.select_set(False)

# Frame all mesh objects.
def world_bounds(objects):
    points=[]
    for obj in objects:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    mins=Vector((min(p.x for p in points),min(p.y for p in points),min(p.z for p in points)))
    maxs=Vector((max(p.x for p in points),max(p.y for p in points),max(p.z for p in points)))
    return mins,maxs

mins,maxs=world_bounds(meshes)
center=(mins+maxs)*0.5
size_vec=maxs-mins
radius=max(size_vec.x,size_vec.y,size_vec.z)*0.5 or 1.0

cam_data=bpy.data.cameras.new('FreeLabThumbnailCamera')
cam=bpy.data.objects.new('FreeLabThumbnailCamera',cam_data)
scene.collection.objects.link(cam)
scene.camera=cam
cam_data.type='ORTHO'
cam_data.ortho_scale=max(size_vec.x,size_vec.y,size_vec.z)*1.85 or 2.0
cam.location=center+Vector((radius*2.6,-radius*3.1,radius*2.2))

direction=center-cam.location
cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()

key=bpy.data.lights.new('FreeLabKey',type='SUN')
key.energy=2.3
key_obj=bpy.data.objects.new('FreeLabKey',key)
scene.collection.objects.link(key_obj)
key_obj.rotation_euler=(math.radians(42),0,math.radians(28))

fill=bpy.data.lights.new('FreeLabFill',type='AREA')
fill.energy=800
fill.shape='RECTANGLE'
fill.size=radius*3.5
fill.size_y=radius*3.5
fill_obj=bpy.data.objects.new('FreeLabFill',fill)
scene.collection.objects.link(fill_obj)
fill_obj.location=center+Vector((-radius*1.8,radius*1.4,radius*1.7))
fill_obj.rotation_euler=((center-fill_obj.location).to_track_quat('-Z','Y').to_euler())

Path(destination).parent.mkdir(parents=True,exist_ok=True)
bpy.ops.render.render(write_still=True)
print('FREELAB THUMBNAIL OUTPUT:',Path(destination).stat().st_size)
