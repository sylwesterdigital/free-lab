"""v0.10.29: offline XR 3D job cubes and private GLB preview preparation."""
import struct, unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from backend import avatar_optimizer, glb_xr

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
BACK=(ROOT/'backend/app.py').read_text()

class Cube129(unittest.TestCase):
 def test_spatial_cube_and_failure_are_not_tiny_flat_status_only(self):
  self.assertIn('function drawMeshJobCube(badge,anchor,vp,t,owner)',XR)
  self.assertIn('meshJobProgram=shader(JBV,JBF)',XR)
  self.assertIn('drawMeshJobCube(badge,shown,vp,t,owner)',XR)
  self.assertIn('owner?.size?.[0]||.55)/3',XR)
  self.assertIn("['FAILED','CANCELED','PREVIEW_ERROR'].includes(badge.status)",XR)
  self.assertIn("return '3D FAILED'",XR)
  self.assertIn("return 'XR MODEL ERROR'",XR)
  self.assertIn('gl.drawArrays(gl.TRIANGLES,0,36)',XR)
  self.assertIn('if(badge.status===\'SUCCEEDED\'&&modelVisible',XR)
  self.assertIn('meshAnchor(mesh)',XR)
 def test_explicit_quest_conversion_lifecycle(self):
  self.assertIn("@app.get('/api/media/3d/<int:jid>/preview')",BACK)
  self.assertIn('glb_xr.decode_visual(raw)',BACK)
  self.assertIn('avatar_optimizer.optimize_xr_preview(raw)',BACK)
  self.assertIn('return jsonify(status=state,message=detail,job_id=jid),202',BACK)
  self.assertIn('threading.Thread(target=_xr_prepare_worker',BACK)
  self.assertIn('raw=(MODEL_DIR/row[\'model_path\']).read_bytes()',BACK)
  self.assertIn('owner_id=?',BACK)
  self.assertIn("if(['PREPARING','WAITING'].includes(result?.status))",XR)
  self.assertIn('meshPreviewRetries.set(jobId,counter)',XR)
  self.assertIn('void spawnMeshPreview(job,origin)',XR)
  self.assertIn('meshPreviews.push(model)',XR)
  self.assertIn('meshJobBadges.clear();meshPreviewFailures.clear();',XR)
 def test_preview_optimizer_uses_dedicated_size_limit_without_modifying_original(self):
  raw=b'glTF'+struct.pack('<II',2,20)+b'\x00'*8
  def fake_run(command,**kwargs):
   pos=command.index('--');destination=Path(command[pos+2]);self.assertEqual(command[pos+3],'8000000');self.assertEqual(command[pos+4],'XR')
   destination.write_bytes(raw)
   return SimpleNamespace(returncode=0,stderr='',stdout='')
  with patch.object(avatar_optimizer.subprocess,'run',side_effect=fake_run) as run:
   result=avatar_optimizer.optimize_xr_preview(raw,blender='/fake/blender')
   self.assertEqual(result,raw)
   self.assertIn('--disable-autoexec',run.call_args.args[0])
   self.assertIn('--factory-startup',run.call_args.args[0])
   self.assertIn('XR',run.call_args.args[0])
  self.assertEqual(raw[:4],b'glTF')
  with self.assertRaises(ValueError):avatar_optimizer.optimize_xr_preview(b'\0'*33_000_000,blender='/fake/blender')
 def test_original_glb_decoder_remains_available_for_supported_meshes(self):
  from test_v124_textured_xr import glb_fixture
  model=glb_xr.decode_visual(glb_fixture())
  self.assertEqual(model['triangles'],2)
  self.assertFalse(model['texture_omitted'])

if __name__=='__main__':unittest.main()
