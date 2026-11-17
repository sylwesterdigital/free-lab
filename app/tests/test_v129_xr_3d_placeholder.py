"""v0.10.67: offline XR 3D job cubes and private GLB preview preparation."""
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
  self.assertIn('meshWorldPose(mesh)',XR)
 def test_explicit_quest_conversion_lifecycle(self):
  self.assertIn("@app.get('/api/media/3d/<int:jid>/preview')",BACK)
  self.assertIn('glb_xr.decode_visual(raw)',BACK)
  self.assertIn('avatar_optimizer.optimize_xr_preview(raw)',BACK)
  self.assertIn("return jsonify(status=state,stage=stage",BACK)
  self.assertIn('threading.Thread(target=_xr_existing_job_worker',BACK)
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
  with self.assertRaises(ValueError):avatar_optimizer.optimize_xr_preview(b'\0'*65_000_000,blender='/fake/blender')
 def test_private_model_diagnostics_and_retry_are_read_only(self):
  self.assertIn("@app.get('/api/media/3d/<int:jid>/diagnostics')",BACK)
  self.assertIn("@app.post('/api/media/3d/<int:jid>/preview/retry')",BACK)
  self.assertIn('def _model_pipeline_diagnostics(row, jid, owner):',BACK)
  self.assertIn('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',BACK)
  self.assertIn('model_id',BACK)
  self.assertIn('glb_xr.chunks(raw)',BACK)
  self.assertIn('avatar_optimizer.blender_command()',BACK)
  self.assertIn('paid_generation=False',BACK)
  self.assertIn('error.unlink(missing_ok=True)',BACK)
  self.assertIn('pending.unlink(missing_ok=True)',BACK)
  self.assertNotIn("tripo3d.submit(",BACK.split('def media_3d_diagnostics(')[1].split("@app.get('/api/media/3d/<int:jid>/preview')")[0])
 def test_xr_job_badge_is_inspectable_and_failure_recoverable(self):
  self.assertIn('...meshJobBadges.values()',XR)
  self.assertIn("if(h.card.kind==='3djob')return '3djobdiagnostics'",XR)
  self.assertIn('return showMeshDiagnostics(h.card.jobId)',XR)
  self.assertIn('window.FreeLab.modelXRDiagnostics(jobId)',XR)
  self.assertIn('window.FreeLab.retryXRPreview(jobId)',XR)
  self.assertIn('meshPreviewFailures.delete(jobId)',XR)
  self.assertIn('TAP CUBE AGAIN TO RETRY',XR)
  self.assertNotIn('void showMeshDiagnostics(jobId);',XR)
  self.assertNotIn('debugShowing=true;debugLast=0;return;',XR)
 def test_pin_model_version_in_additive_migration(self):
  import tempfile
  from backend import db
  with tempfile.TemporaryDirectory() as temp:
   dbfile=Path(temp)/'test.sqlite3';db.init(dbfile)
   with db.connect(dbfile) as conn:
    cols={r['name'] for r in conn.execute('PRAGMA table_info(jobs_3d)')}
    self.assertIn('model_id',cols)
   db.init(dbfile)
  self.assertIn("options['model'] if provider=='tripo'",BACK)
 def test_desktop_readable_diagnostics_from_current_job_without_generation(self):
  app=(ROOT/'frontend/assets/app.js').read_text()
  self.assertIn("async function modelXRDiagnostics(id){return api('/media/3d/'+id+'/diagnostics');}",app)
  self.assertIn("async function retryXRPreview(id){return api('/media/3d/'+id+'/preview/retry'",app)
  self.assertIn('Inspect 3D pipeline',app)
  self.assertIn('Retry XR preview',app)
 def test_pipeline_diagnostic_stages_with_cached_test_glb(self):
  import ast,tempfile,time
  from backend import tripo3d, meshy3d, aholo3d, model_cache
  from test_v124_textured_xr import glb_fixture
  method=next(n for n in ast.parse(BACK).body if isinstance(n,ast.FunctionDef) and n.name=='_model_pipeline_diagnostics')
  with tempfile.TemporaryDirectory() as t:
   folder=Path(t);owner=3;jid=13
   paths=lambda o,i:(folder/f'{o}_{i}.xr.glb',folder/f'{o}_{i}.xr.error',folder/f'{o}_{i}.xr.pending')
   env=dict(MODEL_DIR=folder, _xr_preview_paths=paths,glb_xr=glb_xr,
            avatar_optimizer=avatar_optimizer,model_cache=model_cache,
            tripo3d=tripo3d,meshy3d=meshy3d,aholo3d=aholo3d,time=time)
   exec(compile(ast.Module(body=[method],type_ignores=[]),'<private diagnostic>','exec'),env)
   inspect=env['_model_pipeline_diagnostics']
   row={'provider':'tripo','model_id':'v3.1-20260211','status':'SUCCEEDED','progress':100,
         'error':'','provider_task':'faketask98765','glb_url':'https://cdn.tripo3d.ai/output/test.glb',
         'capture_id':7,'object_id':None,'model_path':'3_13.glb','cache_error':''}
   test_glb=glb_fixture();(folder/'3_13.glb').write_bytes(test_glb)
   report=inspect(row,jid,owner)
   self.assertEqual(report['stage'],'XR placement')
   self.assertEqual(report['model']['bytes'],len(test_glb))
   self.assertEqual(report['model_id'],'v3.1-20260211')
   self.assertEqual(report['steps'][-1]['state'],'READY')
   (folder/'3_13.glb').unlink()
   self.assertEqual(inspect(row,jid,owner)['stage'],'private download')
   (folder/'3_13.glb').write_bytes(test_glb)
   paths(owner,jid)[1].write_text('Headless Blender could not import geometry')
   report=inspect(row,jid,owner)
   self.assertEqual(report['stage'],'Blender conversion')
   self.assertIn('import geometry',report['preview_error'])
 def test_original_glb_decoder_remains_available_for_supported_meshes(self):
  from test_v124_textured_xr import glb_fixture
  model=glb_xr.decode_visual(glb_fixture())
  self.assertEqual(model['triangles'],2)
  self.assertFalse(model['texture_omitted'])

if __name__=='__main__':unittest.main()
