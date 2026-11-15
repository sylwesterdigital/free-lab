"""v0.10.37 Tripo result recovery, trusted signed URLs and no unsolicited XR logs."""
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import tripo3d
ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'backend/app.py').read_text()
FRONT=(ROOT/'frontend/assets/app.js').read_text()
STAGE=(ROOT/'frontend/assets/model-stage.mjs').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
CSS=(ROOT/'frontend/assets/style.css').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
CACHE=(ROOT/'backend/model_cache.py').read_text()

class Tripo31(unittest.TestCase):
 def test_tripo_v3_signed_download_and_legacy_variants(self):
  cloud='https://tripo-output.s3.us-east-1.amazonaws.com/u/model.glb?X-Amz-Signature=123'
  out={'model_url':cloud}
  self.assertEqual(tripo3d.task_model_url(out),cloud)
  self.assertEqual(tripo3d.task_model_url({'pbr_model':{'url':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'model_urls':{'glb':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'base_model':{'href':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'model_url':'https://127.0.0.1/test','pbr_model':cloud}),cloud)
  with patch.object(tripo3d,'request_api',return_value={'status':'success','progress':100,'output':out}):
   result=tripo3d.status('a-real-task-id01','private')
   self.assertEqual(result['status'],'SUCCEEDED')
   self.assertEqual(result['glb_url'],cloud)
 def test_only_authenticated_task_results_use_cloud_hosts(self):
  signed='https://tripo-output.s3.us-east-1.amazonaws.com/3d.glb'
  self.assertIsNone(tripo3d.safe_file_url(signed))
  self.assertEqual(tripo3d.safe_file_url(signed,trusted_task=True),signed)
  for url in ('http://storage.googleapis.com/3d.glb','https://127.0.0.1/3d.glb',
              'https://169.254.169.254/latest/meta-data','https://localhost.local/3d.glb',
              'https://user:pw@files.example.com/model.glb','https://localhost/model.glb',
              'https://host.invalid/model.glb'):
   self.assertIsNone(tripo3d.safe_file_url(url,trusted_task=True),url)
 def test_reject_private_dns_addresses(self):
  from unittest.mock import Mock
  with patch.object(tripo3d.socket,'getaddrinfo',return_value=[(2,1,6,'',('10.0.0.4',443))]):
   with self.assertRaises(ValueError):tripo3d.verify_public_download_host('https://files.example.com/model.glb')
  with patch.object(tripo3d.socket,'getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):
   self.assertTrue(tripo3d.verify_public_download_host('https://files.example.com/model.glb'))
 def test_existing_jobs_recovered_by_read_only_status(self):
  self.assertIn("tripo3d.status(row['provider_task'],key)",APP)
  self.assertIn("if row['provider']=='tripo'",APP)
  self.assertIn('name=model_cache.store(',APP)
  self.assertIn("tripo3d.open_model_download(good",CACHE)
  self.assertIn('def _xr_existing_job_worker(owner,jid,key):',APP)

 def test_async_quest_preview_does_not_download_during_request(self):
  section=APP.split("@app.get('/api/media/3d/<int:jid>/preview')",1)[1].split("@app.post('/api/media/text-to-image')",1)[0]
  self.assertIn('_xr_ensure_preview_worker(owner,jid,key)',section)
  self.assertIn('return jsonify(status=state,',section)
  self.assertNotIn('tripo3d.status(',section)
  self.assertNotIn('model_cache.store(',section)
  self.assertNotIn('glb_xr.decode_visual(',section)
  self.assertIn('cached.read_bytes()',section)
 def test_poll_does_not_block_request_or_charge(self):
  section=APP.split("@app.get('/api/media/3d/<int:jid>')",1)[1].split("@app.get('/api/media/3d/<int:jid>/asset')",1)[0]
  self.assertIn('_xr_ensure_task_poll(',section)
  self.assertNotIn('.status(row[',section)
  self.assertNotIn('model_cache.store(',section)
  self.assertIn('return jsonify(job_3d_dict(row))',section)
  worker=APP.split('def _xr_existing_job_worker(',1)[1].split('def _xr_ensure_preview_worker(',1)[0]
  self.assertNotIn('tripo3d.submit(',worker)
  self.assertIn('model_cache.store(',worker)
  self.assertIn('avatar_optimizer.optimize_xr_preview(raw)',worker)
 def test_room_reduces_publish_rate_and_survives_non_json_gateway(self):
  room=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('lastSent<1500',room)
  self.assertIn('retryAfter=Date.now()',room)
  self.assertIn('body=await r.text()',room)
  self.assertIn("Room server unavailable (HTTP ",room)

 def test_quest_recovery_worker_heartbeats_and_restarts_after_crash(self):
  self.assertIn('def _xr_preview_heartbeat(pending,stop):',APP)
  self.assertIn('if time.time()-pending.stat().st_mtime<45:',APP)
  self.assertIn('stop.set();beat.join(timeout=1)',APP)
  self.assertIn("_xr_preview_stage(owner,jid,'Downloading generated GLB')",APP)
  self.assertIn("_xr_preview_stage(owner,jid,'Optimizing GLB for Quest')",APP)
  self.assertIn("stage=progress_label.read_text()[:60]",APP)
  self.assertIn('use_blender=len(raw)>10_000_000',APP)
  self.assertIn('MAX_MODEL=64_000_000',CACHE)
  self.assertIn('marker.read_text().strip()!=VERSION',APP)
  self.assertIn('_xr_preview_error_version_path(owner,jid).write_text(VERSION)',APP)
  from backend import avatar_optimizer
  self.assertIn('input_limit=MAX_MODEL',__import__('inspect').getsource(avatar_optimizer.optimize_xr_preview))

 def test_completed_model_worker_publishes_quest_geometry_and_cleans_pending(self):
  # Exercise the actual worker without Flask, network or billable provider calls.
  import ast, json, os, re, sqlite3, tempfile, threading, time, secrets
  from backend import db, glb_xr, model_cache
  from test_v124_textured_xr import glb_fixture
  from types import SimpleNamespace
  source=ast.parse(APP)
  names=('_xr_decode_isolated','_xr_preview_json_path','_xr_preview_stage_path','_xr_preview_error_version_path','_xr_preview_stage',
         '_xr_preview_heartbeat','_xr_preview_paths','_xr_existing_job_worker')
  functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in names]
  with tempfile.TemporaryDirectory() as tmp:
   directory=Path(tmp);database=directory/'a.db';uid,jid=2,3
   with db.connect(database) as con:
    con.execute('CREATE TABLE jobs_3d (id INTEGER PRIMARY KEY, owner_id INT, status TEXT, model_path TEXT, provider TEXT, glb_url TEXT, provider_task TEXT, thumbnail_url TEXT, cache_error TEXT)')
    con.execute("INSERT INTO jobs_3d VALUES(?,?,?,?,?,?,?,?,?)",(jid,uid,'SUCCEEDED',f'{uid}_{jid}.glb','tripo','','test-task','', ''))
   fixture=glb_fixture()
   environment={'MODEL_DIR':directory,'DB':database,'db':db,'glb_xr':glb_xr,'model_cache':model_cache,
                'avatar_optimizer':SimpleNamespace(blender_command=lambda:'/fake/blender',optimize_xr_preview=lambda raw:fixture),
                'threading':threading,'time':time,'os':os,'re':re,'json':json,'sqlite3':sqlite3,'secrets':secrets,'tempfile':tempfile,
                '_xr_preview_guard':threading.Lock(),'_xr_preview_active':{(uid,jid)}}
   exec(compile(ast.Module(body=functions,type_ignores=[]),'<xr-worker>','exec'),environment)
   pending=directory/f'{uid}_{jid}.xr.pending'
   for large in (False,True):
    raw=fixture if not large else fixture+b'\x00'*10_000_001
    (directory/f'{uid}_{jid}.glb').write_bytes(raw)
    pending.touch()
    environment['_xr_preview_active'].add((uid,jid))
    environment['_xr_existing_job_worker'](uid,jid,'')
    ready=directory/f'{uid}_{jid}.xr.json'
    self.assertTrue(ready.is_file())
    mesh=json.loads(ready.read_text())
    self.assertEqual(mesh['triangles'],2)
    self.assertFalse(pending.exists())
    self.assertFalse((directory/f'{uid}_{jid}.xr.stage').exists())
    self.assertFalse((directory/f'{uid}_{jid}.xr.error').exists())
    ready.unlink()
    (directory/f'{uid}_{jid}.xr.glb').unlink(missing_ok=True)

 def test_server_monitor_caches_on_provider_success_without_paid_resubmit(self):
  import ast, sqlite3, tempfile, threading, time
  from contextlib import closing
  from backend import db
  from types import SimpleNamespace
  monitor=next(n for n in ast.parse(APP).body if isinstance(n,ast.FunctionDef) and n.name=='_xr_monitor_job')
  with tempfile.TemporaryDirectory() as tmp:
   database=Path(tmp)/'status.sqlite3'
   with closing(sqlite3.connect(database)) as con:
    con.execute("""CREATE TABLE jobs_3d (id INTEGER PRIMARY KEY,owner_id INTEGER,provider TEXT,provider_task TEXT,
      status TEXT,glb_url TEXT,thumbnail_url TEXT,progress INTEGER,credits REAL,error TEXT,updated_at TEXT)""")
    con.execute("INSERT INTO jobs_3d VALUES(1,3,'tripo','task_12345678','IN_PROGRESS','','',90,0,'','')")
    con.commit()
   saved=[];guard=threading.Lock();active={(3,1)}
   tripo=SimpleNamespace(status=lambda task,key:{'status':'SUCCEEDED','progress':100,'credits':5,
       'glb_url':'https://cdn.tripo3d.ai/finished.glb','thumbnail_url':'','error':''})
   env=dict(DB=database,db=db,closing=closing,threading=threading,time=time,
            tripo3d=tripo,meshy3d=None,aholo3d=None,
            _xr_ensure_preview_worker=lambda owner,jid,key:saved.append((owner,jid,key)),
            _xr_monitor_guard=guard,_xr_monitor_active=active)
   exec(compile(ast.Module(body=[monitor],type_ignores=[]),'<monitor>','exec'),env)
   env['_xr_monitor_job'](3,1,'my-secret')
   self.assertEqual(saved,[(3,1,'my-secret')])
   self.assertNotIn((3,1),active)
   with closing(sqlite3.connect(database)) as con:
    row=con.execute('SELECT status,progress,glb_url FROM jobs_3d WHERE id=1').fetchone()
    self.assertEqual(row,('SUCCEEDED',100,'https://cdn.tripo3d.ai/finished.glb'))
  self.assertIn('pending3dJobs.unshift(',XR)
  self.assertIn('meshPollCursor=(meshPollCursor+count)%pending3dJobs.length',XR)
  self.assertIn('def _xr_ensure_job_monitor(owner,jid,key):',APP)
  self.assertIn('No Tripo auth/decryption or background task creation on a plain list GET.',APP)


 def test_private_model_list_does_not_launch_provider_network(self):
  section=APP.split("@app.get('/api/media/3d')",1)[1].split("@app.get('/api/media/3d/check')",1)[0]
  self.assertNotIn('_xr_ensure_job_monitor(',section)
  self.assertNotIn('provider_key(',section)
  self.assertIn('LIMIT 100',section)
  self.assertIn('AUTH_REQUIRED',APP)
  self.assertIn('def _xr_decode_isolated(raw,texture_edge):',APP)

 def test_isolated_glb_decoder_command_line(self):
  from backend import glb_xr
  from test_v124_textured_xr import glb_fixture
  import tempfile,subprocess,sys,json
  with tempfile.TemporaryDirectory() as t:
   inp=Path(t)/'input.glb';out=Path(t)/'output.json';inp.write_bytes(glb_fixture())
   proc=subprocess.run([sys.executable,'-m','backend.glb_xr',str(inp),str(out),'512'],
      cwd=ROOT,capture_output=True,timeout=15)
   self.assertEqual(proc.returncode,0,proc.stderr.decode(errors='replace'))
   model=json.loads(out.read_text())
   self.assertEqual(model['triangles'],2)

 def test_no_auto_debug_pane(self):
  self.assertIn('async function showMeshDiagnostics(jobId){',XR)
  self.assertNotIn('void showMeshDiagnostics(jobId);',XR)
  section=XR.split('async function showMeshDiagnostics(jobId){',1)[1].split('function meshJobCaption(job){',1)[0]
  self.assertNotIn('debugShowing=true',section)
  self.assertIn('setStatus(',section)

if __name__=='__main__':unittest.main()


# v0.10.37: private Blender thumbnails and XR GPU lifecycle diagnostics.
class ModelThumbnailTests(unittest.TestCase):
 def test_backend_exposes_thumbnail_and_source_fallback(self):
  self.assertIn('def _model_thumb_path(owner,jid):',APP)
  self.assertIn("@app.get('/api/media/3d/<int:jid>/thumbnail')",APP)
  self.assertIn("'thumbnail_url':thumbnail_url",APP)
  self.assertIn("'thumbnail_kind':thumbnail_kind",APP)
  self.assertIn("'source_image_url':source_url",APP)
  self.assertIn('_ensure_model_thumbnail(owner,jid)',APP)

 def test_gallery_renders_thumbnail_cards(self):
  self.assertIn('function modelJobPoster(job){',FRONT)
  self.assertIn('function modelJobThumb(job){',FRONT)
  self.assertIn("window.FreeLabModelStage?.open(job.id,false,null,poster||job.source_image_url||'')",FRONT)
  self.assertIn('model-job-thumb',CSS)
  self.assertIn('model-job-actions',CSS)

 def test_model_viewer_uses_loading_poster(self):
  self.assertIn('id="modelStagePoster"',HTML)
  self.assertIn("const poster=$('modelStagePoster')",STAGE)
  self.assertIn('if(posterUrl){poster.src=posterUrl;poster.classList.remove(\'hidden\');}',STAGE)
  self.assertIn('if(poster)poster.classList.add(\'hidden\');',STAGE)

if __name__=='__main__':unittest.main()

class XR3DDiagnosticsTests(unittest.TestCase):
 def test_job_load_reports_requests_results_and_failed_http(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  for event in ('MODEL_LOAD_REQUESTED','MODEL_LOAD_STARTED','MODEL_PREVIEW_HTTP_REQUEST',
                'MODEL_PREVIEW_HTTP_RESULT','MODEL_GEOMETRY_RECEIVED','MODEL_GPU_BUFFER_UPLOADED',
                'MODEL_GPU_TEXTURE_UPLOADED','MODEL_ATTACHED_TO_XR_SCENE',
                'MODEL_FIRST_GPU_DRAW_SUBMITTED','MODEL_LOAD_FAILED','MODEL_SOURCE_MISMATCH'):
   self.assertIn("'"+event+"'",xr)
  self.assertIn('console[method](\'[FREELAB XR 3D] \'+stage,entry);',xr)
  self.assertIn('window.FreeLabXR3DDiagnostics',xr)
  self.assertIn('function xrGLErrors(){',xr)
  self.assertIn("'XR_FRAMEBUFFER_STATUS'",xr)

 def test_thumbnail_endpoint_private_and_falls_back_to_source(self):
  source=APP.split("@app.get('/api/media/3d/<int:jid>/thumbnail')",1)[1].split("@app.get('/api/media/3d/<int:jid>/asset')",1)[0]
  self.assertIn('@require_user',source)
  self.assertIn("g.user['id']",source)
  self.assertIn('IMAGE_DIR/origin',source)
  self.assertIn('_ensure_model_thumbnail',source)
  self.assertIn("'Cache-Control'",source)
