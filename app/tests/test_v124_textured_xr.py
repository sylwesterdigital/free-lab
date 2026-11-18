"""v0.10.72: models remain attached to saved sources; bounded textured GLB previews.
No AI requests, no provider costs and no remote network.
"""
import io,json,math,struct,unittest
from pathlib import Path
from PIL import Image
from backend import glb_xr

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
B=(ROOT/'backend/app.py').read_text()


def glb_fixture():
    # Quad, wrapped in a translating scene node. The original GLB has an embedded
    # red/blue material texture and indexed triangles, not just bare positions.
    positions=struct.pack('<12f',0,0,0, 1,0,0, 0,1,0, 1,1,0)
    uvs=struct.pack('<8f',0,0, 1,0, 0,1, 1,1)
    indices=struct.pack('<6H',0,1,2, 2,1,3)
    p=Image.new('RGB',(8,8),(222,38,42));p.putpixel((6,6),(15,70,225))
    buf=io.BytesIO();p.save(buf,format='PNG');image=buf.getvalue()
    chunks=[positions,uvs,indices,image]
    offsets=[];data=b''
    for chunk in chunks:
        offsets.append(len(data));data+=chunk+b'\0'*((-len(chunk))%4)
    views=[{'buffer':0,'byteOffset':offsets[i],'byteLength':len(chunks[i])} for i in range(4)]
    obj={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(data)}],
         'bufferViews':views,
         'accessors':[{'bufferView':0,'componentType':5126,'count':4,'type':'VEC3'},
                      {'bufferView':1,'componentType':5126,'count':4,'type':'VEC2'},
                      {'bufferView':2,'componentType':5123,'count':6,'type':'SCALAR'}],
         'images':[{'bufferView':3,'mimeType':'image/png'}],
         'textures':[{'source':0}],
         'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'baseColorFactor':[1,1,1,1]}}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':0,'TEXCOORD_0':1},'indices':2,'material':0}]}],
         'nodes':[{'mesh':0,'translation':[8,0,-6]}],
         'scenes':[{'nodes':[0]}],'scene':0}
    json_raw=json.dumps(obj,separators=(',',':')).encode();json_raw+=b' '*((-len(json_raw))%4)
    total=12+8+len(json_raw)+8+len(data)
    return struct.pack('<4sII',b'glTF',2,total)+struct.pack('<I4s',len(json_raw),b'JSON')+json_raw+struct.pack('<I4s',len(data),b'BIN\x00')+data


class TexturedXR124(unittest.TestCase):
    def test_mesh_keeps_surface_and_embedded_texture(self):
        result=glb_xr.decode_visual(glb_fixture())
        self.assertEqual(result['triangles'],2)
        self.assertFalse(result['texture_omitted'])
        part=result['parts'][0]
        self.assertEqual(part['triangles'],2)
        self.assertEqual(len(part['positions']),18)
        self.assertEqual(len(part['uvs']),12)
        self.assertTrue(part['texture'].startswith('data:image/jpeg;base64,'))
        self.assertLessEqual(max(abs(n) for n in part['positions']),.51)
        self.assertIn(1.,part['uvs'])

    def test_no_external_or_invalid_glb(self):
        with self.assertRaises(ValueError):glb_xr.decode_visual(b'bad')
        with self.assertRaises(ValueError):glb_xr.decode_visual(glb_fixture()[:-5])
        with self.assertRaises(ValueError):glb_xr.decode_visual(b'x'*(glb_xr.MAX_FILE+1))

    def test_dense_surface_clusters_instead_of_scattered_triangles(self):
        triangles=[]
        # Continuous source surface: each cell contributes two adjacent faces.
        for y in range(110):
            for x in range(110):
                a=((x/110,y/110,0),(0,0));b=(((x+1)/110,y/110,0),(1,0))
                c=((x/110,(y+1)/110,0),(0,1));d=(((x+1)/110,(y+1)/110,0),(1,1))
                triangles.append((a,b,c));triangles.append((c,b,d))
        sampled,changed=glb_xr.triangle_cluster(triangles,1.0,3000)
        self.assertTrue(changed)
        self.assertLessEqual(len(sampled),3000)
        self.assertGreater(len(sampled),50)
        self.assertTrue(all(len(set(v[0] for v in face))==3 for face in sampled))

    def test_texture_seams_survive_dense_mesh_simplification(self):
        # Many triangles share spatial cells but carry different face-corner
        # UVs. The old clustering routine copied the first UV for every cell.
        triangles=[]
        for y in range(95):
            for x in range(95):
                a=(x/95,y/95,0);b=((x+1)/95,y/95,0)
                c=(x/95,(y+1)/95,0);d=((x+1)/95,(y+1)/95,0)
                # UV seams vary by face across otherwise identical geometry.
                u=x/95;v=y/95
                triangles.append(((a,(u,v)),(b,(u+.02,v)),(c,(u,v+.03))))
                triangles.append(((c,(u+.40,v+.50)),(b,(u+.42,v+.50)),(d,(u+.42,v+.53))))
        original_uv={tuple(tuple(v[1]) for v in tri) for tri in triangles}
        result,changed=glb_xr.triangle_cluster(triangles,1,3500)
        self.assertTrue(changed)
        self.assertLessEqual(len(result),3500)
        self.assertGreater(len(result),50)
        self.assertTrue(all(tuple(tuple(v[1]) for v in tri) in original_uv for tri in result))

    def test_gltf_khr_texture_transform_applies_per_corner(self):
        import math
        attrs={'TEXCOORD_0':2,'TEXCOORD_1':3}
        data={2:[(0,0),(1,1)],3:[(.25,.5),(.5,.75)]}
        info={'texCoord':0,'extensions':{'KHR_texture_transform':{'texCoord':1,
              'offset':[.2,.1],'scale':[2,1],'rotation':math.pi/2}}}
        values=glb_xr.texture_coordinates(info,attrs,lambda index,*_:data[index],2)
        self.assertAlmostEqual(values[0][0],-.3)
        self.assertAlmostEqual(values[0][1],.6)
        self.assertAlmostEqual(values[1][0],-.55)
        self.assertAlmostEqual(values[1][1],1.1)
        self.assertIsNone(glb_xr.texture_coordinates({'texCoord':1},{'TEXCOORD_0':2},lambda *_:[],2))

    def test_desktop_upright_model_is_not_squashed_by_top_down_camera(self):
        source=(ROOT/'frontend/assets/model-stage.mjs').read_text()
        self.assertIn('root=new THREE.Group();root.add(obj);scene.add(root)',source)
        self.assertIn('root.scale.setScalar(1.75/longest)',source)
        self.assertIn('root.position.copy(center).multiplyScalar(-root.scale.x)',source)
        self.assertIn("camera.up.set(0,0,1)",source)
        self.assertIn("camera.up.set(0,1,0)",source)
        self.assertIn('yaw=.37;pitch=.12;dist=3.0',source)
        self.assertNotIn('display.rotation.x=-Math.PI/2',source)
        self.assertNotIn('root.scale.multiplyScalar(scale)',source)

    def test_xr_textured_shader_and_source_lifecycle(self):
        self.assertIn('const XMV=',XR)
        self.assertIn('const XMF=',XR)
        self.assertIn('attribute vec2 aUV',XR)
        self.assertIn('gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false)',XR)
        self.assertIn('meshWorldPose(mesh)',XR)
        self.assertIn('clearCollectionMeshes();closeImageMenu()',XR)
        self.assertIn('void reopenCloudModels(id)',XR)
        self.assertIn("captureId,objectId,kind:'3dmesh',parts:pieces",XR)
        self.assertIn('gl.drawArrays(gl.TRIANGLES,0,part.count)',XR)
        self.assertIn('glb_xr.decode_visual(raw,texture_edge=texture_edge)',B)
        self.assertIn('FROM jobs_3d WHERE id=? AND owner_id=?',B)

if __name__=='__main__':unittest.main()
