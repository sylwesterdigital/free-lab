"""Headless Blender worker. Run only via avatar_optimizer.optimize with fixed argv.
Preserves rigs/animations when possible; reduces textures, mesh detail and exports GLB.
"""
import bpy,sys,os
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]
source,destination,limit=args[0],args[1],int(args[2])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)
meshes=[o for o in bpy.data.objects if o.type=='MESH']
if not meshes:raise RuntimeError('GLB has no mesh objects')
# Clean loose vertices / coincident geometry without flattening the avatar rig.
for obj in meshes:
    if obj.data.shape_keys:continue
    try:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.delete_loose()
        bpy.ops.mesh.merge_by_distance(threshold=0.00001)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception:
        try:bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:pass
    obj.select_set(False)
# Conservative first, then gradually optimize until <= 4MB.
for level,texture_edge in [(1.0,2048),(.82,1536),(.62,1024),(.42,768),(.24,512),(.13,384)]:
    for image in bpy.data.images:
        if image.type!='IMAGE' or image.size[0]<1 or image.size[1]<1:continue
        largest=max(image.size)
        if largest>texture_edge:
            factor=texture_edge/largest
            image.scale(max(1,int(image.size[0]*factor)),max(1,int(image.size[1]*factor)))
    # Each mesh is decimated only from the current saved state and never below 250 faces.
    if level<1.0:
        for obj in meshes:
            if not obj.data or len(obj.data.polygons)<500 or obj.data.shape_keys:continue
            bpy.context.view_layer.objects.active=obj
            obj.select_set(True)
            try:
                modifier=obj.modifiers.new('FREELAB reduce geometry','DECIMATE')
                modifier.ratio=0.78 if level>.4 else 0.62
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            except Exception:
                try:obj.modifiers.remove(modifier)
                except Exception:pass
            obj.select_set(False)
    bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',export_animations=True,
                                export_apply=False,export_image_format='AUTO',export_yup=True)
    if Path(destination).stat().st_size<=limit:break
print('FREELAB GLB OUTPUT:',Path(destination).stat().st_size)
