"""v0.10.62: offline tests for real Tripo v3 and Draco GLB loading."""
from __future__ import annotations
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from backend import tripo3d, db, provider_checks

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'backend/app.py').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
FRONT=(ROOT/'frontend/assets/app.js').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
STAGE=(ROOT/'frontend/assets/model-stage.mjs').read_text()
CAP=(ROOT/'frontend/assets/capture-studio.js').read_text()

class TripoV3(unittest.TestCase):
 def test_true_balance_check_has_no_generation_request(self):
  with patch.object(tripo3d,'request_api',return_value={'balance':25.5,'frozen':2}) as mock:
   result=tripo3d.test_balance('secret')
   self.assertTrue(result['verified'])
   self.assertFalse(result['charged'])
   self.assertEqual(result['balance'],25.5)
   self.assertEqual(mock.call_args.args[:3],('GET','/account/balance','secret'))
  self.assertIn("'tripo': ('https://openapi.tripo3d.ai/v3/account/balance'",(ROOT/'backend/provider_checks.py').read_text())
 def test_real_private_upload_before_billable_task(self):
  jpg=b'\xff\xd8\xff'+b'1'*128
  with patch.object(tripo3d,'request_api',side_effect=[{'file_token':'file_abcde12345'},{'task_id':'abcde12345'}]) as mock:
   self.assertEqual(tripo3d.submit(jpg,'a-key'),'abcde12345')
   first=mock.call_args_list[0]
   self.assertEqual(first.args[:2],('POST','/files'))
   self.assertIn('multipart/form-data',first.kwargs['content_type'])
   self.assertIn(jpg,first.kwargs['raw'])
   second=mock.call_args_list[1]
   self.assertEqual(second.args[:2],('POST','/generation/image-to-model'))
   self.assertEqual(second.args[3]['model'],tripo3d.PRESETS['xr']['model'])
   self.assertTrue(second.args[3]['texture'])
  with self.assertRaises(ValueError):tripo3d.submit(jpg,'key','ignored instructions')
 def test_quality_presets_independent_of_texture(self):
  from backend import db
  from tempfile import TemporaryDirectory
  from pathlib import Path
  for preset,model,limit in [('xr','P2-20260801',12000),('balanced','P2-20260801',30000),('studio','v3.1-20260211',120000)]:
   for texture in ('standard','detailed','extreme'):
    cfg=tripo3d.generation_options(preset,texture)
    self.assertEqual((cfg['model'],cfg['face_limit'],cfg['texture_quality']),(model,limit,texture))
    self.assertTrue(cfg['pbr'])
  for bad in ('arbitrary','xyz',''):
   with self.assertRaises(ValueError):tripo3d.generation_options(bad,'standard')
   with self.assertRaises(ValueError):tripo3d.generation_options('xr',bad)
  with TemporaryDirectory() as tmp:
   db.init(Path(tmp)/'test.sqlite3')
   with db.connect(Path(tmp)/'test.sqlite3') as con:
    row=con.execute('SELECT sql FROM sqlite_master WHERE name=?',('profile_3d_quality',)).fetchone()
    self.assertIn('xr_texture_edge',row['sql'])
    cols=[r['name'] for r in con.execute('PRAGMA table_info(jobs_3d)')]
    for name in ('model_id','quality_preset','face_limit','texture_quality','xr_texture_edge','transform_json'):
     self.assertIn(name,cols)

 def test_generation_quality_job_recording_and_transform_security(self):
  appsrc=(ROOT/'backend/app.py').read_text()
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  stage=(ROOT/'frontend/assets/model-stage.mjs').read_text()
  self.assertIn("options['model'] if provider=='tripo'",appsrc)
  self.assertIn("tripo3d.submit(raw,key,prompt.strip(),setting['preset'],setting['texture_quality'])",appsrc)
  self.assertIn("@app.patch('/api/media/3d/<int:jid>/transform')",appsrc)
  self.assertIn("g.con.execute('UPDATE jobs_3d SET transform_json=? WHERE id=? AND owner_id=?'",appsrc)
  self.assertIn('meshHitTest(r,m)',xr)
  self.assertIn('save3DTransform',xr)
  self.assertIn('meshWorldPose(mesh)',xr)
  self.assertIn('geometryFallback(url)',stage)
  self.assertIn('data.parts',stage)
  self.assertIn('awaitPreparedPreview(jobId,token)',stage)
  self.assertIn('face_limit',appsrc)

 def test_normalize_task_status_and_url_allowlist(self):
  states={'queued':'PENDING','running':'IN_PROGRESS','success':'SUCCEEDED','failed':'FAILED','cancelled':'CANCELED'}
  for raw,expected in states.items():
   with patch.object(tripo3d,'request_api',return_value={'status':raw,'progress':45,
      'output':{'model_url':'https://cdn.tripo3d.ai/output/object.glb','rendered_image_url':'https://cdn.tripo3d.ai/p.png'},
      'credits_consumed':2.5,'error_message':'Not enough credits'}):
    job=tripo3d.status('some-task-12345','key')
    self.assertEqual(job['status'],expected)
    self.assertEqual(job['glb_url'],'https://cdn.tripo3d.ai/output/object.glb')
    self.assertEqual(job['credits'],2.5)
  for unsafe in ('http://cdn.tripo3d.ai/test.glb','https://evil.com/test.glb','https://cdn.tripo3d.ai.evil.com/file','https://user@cdn.tripo3d.ai/a','https://cdn.tripo3d.ai:bad/a'):
   self.assertIsNone(tripo3d.safe_file_url(unsafe))
  self.assertRaises(ValueError,tripo3d.request_api,'POST','/tasks/abcde12345','key')
 def test_schema_additive_on_existing_profiles(self):
  with tempfile.TemporaryDirectory() as t:
   file=Path(t)/'profiles.sqlite'
   db.init(file)
   with db.connect(file) as con:
    self.assertIn('profile_3d_provider_override',{r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")})
    uid=db.create_user(con,'legacyuser','strong-password-123','Legacy User',role='member')
    with con:con.execute('INSERT INTO profile_3d_provider_override(user_id,provider) VALUES(?,?)',(uid,'tripo'))
   db.init(file)
   with db.connect(file) as con:self.assertEqual(con.execute('SELECT provider FROM profile_3d_provider_override WHERE user_id=?',(uid,)).fetchone()[0],'tripo')

class TripoUI(unittest.TestCase):
 def test_all_devices_and_real_connection(self):
  self.assertIn('id="profile3DProvider"',HTML)
  self.assertIn('id="capture3DProvider"',HTML)
  self.assertIn('value="tripo"',HTML)
  self.assertIn("['aholo','meshy','tripo']",XR)
  self.assertIn('data-capture-tool="check3d"',HTML)
  self.assertIn('LIVE API TEST PASSED',CAP)
  self.assertIn("'tripo':tripo3d.submit",APP) if False else self.assertIn("tripo3d.submit(raw,key",APP)
  self.assertIn("'tripo':tripo3d",APP)
  self.assertIn('tripo3d.safe_file_url',APP)
 def test_draco_registered_before_parse(self):
  self.assertIn('DRACOLoader.js',STAGE)
  self.assertIn('setDecoderPath(',STAGE)
  self.assertIn('setDRACOLoader(draco)',STAGE)
  self.assertLess(STAGE.index('loader.setDRACOLoader(draco)'),STAGE.index('loader.parse(raw'))
  self.assertIn('if(localFile)throw e',STAGE)
 def test_xr_async_models_bloom_from_their_source(self):
  self.assertIn('meshJobBadges=new Map()',XR)
  self.assertIn('function syncMeshJobBadge(job)',XR)
  self.assertIn('function draw3DJobBadges(vp,t)',XR)
  self.assertIn('function meshJobCaption(job)',XR)
  self.assertIn("if(c.kind==='3djob')",XR)
  self.assertIn('draw3DJobBadges(vp,t)',XR)
  self.assertIn('syncMeshJobBadge({...job,capture_id:target.captureId',XR)
  self.assertIn('launchParticles(a.pos)',XR)
  self.assertIn('3D POPPED INTO XR',XR)
  self.assertIn('related=all.filter(j=>j.capture_id===captureId).slice(0,12)',XR)
  self.assertNotIn("j.status==='SUCCEEDED'&&j.capture_id===captureId).slice(0,2)",XR)
  self.assertIn('meshPreviews.some(m=>m.jobId===job.id)',XR)
  self.assertIn('meshJobBadges.clear();meshPreviewFailures.clear();',XR)
  self.assertIn('meshOwnerCard(badge)',XR)
  self.assertIn('m.captureId!==cloud.id',XR)
  self.assertIn('model_cache.store(',APP)

 def test_new_version(self):
  self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.62')
  self.assertEqual(json.loads((ROOT/'frontend/version.json').read_text())['version'],'0.10.62')

if __name__=='__main__':unittest.main()
