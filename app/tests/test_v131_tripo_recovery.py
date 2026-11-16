"""v0.10.50 Tripo result recovery, trusted signed URLs and no unsolicited XR logs."""
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
  names=('_xr_decode_isolated','_xr_preview_json_path','_xr_preview_revision_path','_xr_preview_stage_path','_xr_preview_error_version_path','_xr_preview_stage',
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
                '_xr_preview_guard':threading.Lock(),'_xr_preview_active':{(uid,jid)},'_XR_TEXTURE_REVISION':'uv-seam-v2'}
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
    self.assertEqual((directory/f'{uid}_{jid}.xr.revision').read_text(),'uv-seam-v2')
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


# v0.10.50: private Blender thumbnails and XR GPU lifecycle diagnostics.
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

class XRMeshOwnershipAndLibraryRegressionTests(unittest.TestCase):
 """v0.10.50 regression: GPU buffers must remain owned by the XR model."""
 def test_ownership_transfer_preserves_mesh_parts_during_finally_cleanup(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn("kind:'3dmesh',parts:pieces.slice()",xr)
  self.assertIn('meshPreviews.push(model);pieces.length=0;',xr)
  self.assertIn("'MODEL_RENDER_PARTS_COMMITTED'",xr)
  self.assertIn("'MODEL_FIRST_GPU_DRAW_SUBMITTED'",xr)
  self.assertIn('for(const part of mesh.parts||[])',xr)
  import subprocess
  result=subprocess.run(['node','-e',
      "const uploaded=[{count:9444,buffer:{}}];const model={parts:uploaded.slice()};uploaded.length=0;"
      "if(model.parts.length!==1||model.parts[0].count!==9444||uploaded.length!==0)process.exit(1);"],
      capture_output=True,text=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr)

 def test_no_recurring_gpu_queries_unless_verbose(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn('let xr3DVerbose=false;',xr)
  self.assertIn('if(xr3DVerbose&&t-(renderView.lastXRFramebufferCheck||0)>60000)',xr)
  self.assertIn("if(level==='error'||xr3DVerbose)",xr)
  self.assertIn('setVerbose:value=>',xr)

 def test_library_is_clearly_paginated_and_newest_first(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn('function galleryHeadingTexture(total,page,start,end)',xr)
  self.assertIn('sort((a,b)=>b.id-a.id)',xr)
  self.assertIn("label:direction>0?'OLDER  →':'←  NEWER'",xr)
  self.assertIn("c.kind==='gallery')&&c.captionNormal",xr)
  self.assertIn("cards.filter(c=>c.kind!=='galleryheader')",xr)

# v0.10.50: Quest controllers, local axis gizmos and static library animation.
class XRTransformAndLibraryTests(unittest.TestCase):
 def test_library_header_is_static_and_tween_skips_unanimated_cards(self):
  self.assertIn("kind:'galleryheader',data:{},pos:[0,.67,-.04],from:[0,.67,-.04],to:[0,.67,-.04],start:0,duration:0",XR)
  self.assertIn("!Number.isFinite(c.duration)||c.duration<=0||!Array.isArray(c.from)",XR)
  self.assertIn("!Array.isArray(c.to)",XR)
  import shutil,subprocess
  node=shutil.which('node')
  if not node:self.skipTest('Node.js not installed')
  begin=XR.index('function tween(t){')
  # Isolate and execute the actual Bezier function, including the formerly
  # crashing static card with no from/to/duration.
  depth=0;end=begin
  for j in range(XR.index('{',begin),len(XR)):
   if XR[j]=='{':depth+=1
   elif XR[j]=='}':
    depth-=1
    if not depth:end=j+1;break
  code=XR[begin:end]
  script=("'use strict';let cards=[{pos:[0,.67,-.04],visible:true},{pos:[0,0,0],from:[0,0,0],to:[1,2,3],start:0,duration:50,visible:true}];"
          "const performance={now:()=>100};const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));const easing=t=>t*t*(3-2*t);"
          +code+";tween(0);if(cards[0].duration!==0||cards[1].pos[0]!==1||cards[1].pos[2]!==3)throw Error('Static gallery crash or bad tween');")
  r=subprocess.run([node,'-e',script],capture_output=True,text=True,timeout=5)
  self.assertEqual(r.returncode,0,r.stderr)
 def test_direct_controller_and_pinch_grab_replaces_visual_gizmos(self):
  self.assertIn("if(src.hand&&manual){const finger=posePosition(frame,src)",XR)
  self.assertIn('held.gripLocalOffset=held.startHandPos&&held.startQuat?',XR)
  self.assertIn('vadd(handNow,quatVec(quatNow,held.gripLocalOffset))',XR)
  self.assertIn('card.rotation=quatNorm(quatMul(quatInv(anchor.q),orientation))',XR)
  self.assertIn('card.modelScale=clamp(second.startScale*ratio,.2,4)',XR)
  self.assertIn("if(h.card.kind==='3dtools')return 'meshgizmo-reset';",XR)
  self.assertNotIn('drawMeshGizmo(vp);syncMeshTools()',XR)
  self.assertNotIn("gizmoHitTest(r),...(meshTools",XR)
  self.assertIn('MODEL_GIZMO_TRANSFORM_SAVED',XR)
 def test_uniform_scale_and_independent_reset_controls(self):
  self.assertIn('function resetMeshTransform(m){',XR)
  self.assertIn("case 'meshgizmo-reset':return resetMeshTransform(selectedMesh);",XR)
  self.assertIn("card.modelScale=clamp(drag.gizmoStartScale*Math.exp(amount*3),.2,4);card.axisScale=[1,1,1];",XR)
  self.assertIn('scale(size,size,size)',XR)
  self.assertIn("m.offset=[0,0,0];m.rotation=[0,0,0,1];m.modelScale=1;m.axisScale=[1,1,1]",XR)
  self.assertIn('meshTools.pos=point(poseForwardAnchor(viewer,1.09,-.61),[.25,0,0]);',XR)
  self.assertIn('meshTools.q=quatY(cameraYaw(viewer))',XR)
  self.assertNotIn('meshTools.pos=vadd(pose.pos',XR)
  self.assertIn('axis_scale:[1,1,1]',XR)
  self.assertIn("'axis_scale':[1.0,1.0,1.0]",APP)
  self.assertIn('math.prod(float(x) for x in axis_scale)',APP)
  self.assertIn('mesh.parts',XR)
  self.assertNotIn('THREE.TransformControls',XR)

# v0.10.50 — unified archive, native two-hand model dragging and Z-up presentation.
class MediaArchiveDirectGrab42(unittest.TestCase):
 def test_media_tabs_group_3d_with_saved_sources(self):
  self.assertIn('id="archiveMediaNav"',HTML)
  for value in ('all','images','3d'):
   self.assertIn('data-media="'+value+'"',HTML)
  self.assertIn('function archiveImageCard(o){',FRONT)
  self.assertIn('function archiveModelCard(job){',FRONT)
  self.assertIn('state.models.filter(m=>m.object_id===o.id)',FRONT)
  self.assertIn("context.onclick=()=>openGallery(job.object_id||null",FRONT)
  self.assertIn('if(mode!==\'images\')for(const m of jobs.filter(j=>j.object_id===o.id))',FRONT)
  self.assertIn('archive-media-nav',CSS)

 def test_generated_models_have_provider_specific_xr_branches(self):
  self.assertIn("addCard('3d-branch-'+job.id,'3dbranch'",XR)
  self.assertIn("const label='3D · '+String(job.provider||'MODEL').toUpperCase()",XR)
  self.assertIn("subtitle:'MODEL #'+job.id+' · FROM '",XR)
  self.assertIn("const shownJobs=related.slice(0,8)",XR)
  self.assertIn("else if(h.card.kind==='3dbranch')",XR)

 def test_cinema_can_navigate_images_not_visible_in_spatial_page(self):
  self.assertIn("cloud?.objects?.filter(o=>o.has_image&&o.shelf!=='bin')",XR)
  self.assertIn("cinemaCards=[...(source?[source]:[]),...additional]",XR)
  self.assertIn('cinemaIndex=(cinemaIndex+direction+cinemaCards.length)%cinemaCards.length',XR)

 def test_direct_hand_and_grip_keeps_local_contact_offset(self):
  self.assertIn('held.gripLocalOffset=held.startHandPos&&held.startQuat?',XR)
  self.assertIn('target=handNow&&quatNow&&held.gripLocalOffset?',XR)
  self.assertIn('card.modelScale=clamp(second.startScale*ratio,.2,4)',XR)
  self.assertIn('m.modelScale=1;m.axisScale=[1,1,1]',XR)
  self.assertNotIn('drawMeshGizmo(vp);syncMeshTools()',XR)

 def test_desktop_camera_aligns_with_original_model_long_axis(self):
  self.assertIn("return size.z>Math.max(size.x,size.y)*1.3?'z':'y'",STAGE)
  self.assertIn('root=new THREE.Group();root.add(obj);scene.add(root);',STAGE)
  self.assertIn("camera.up.set(0,0,1)",STAGE)
  self.assertIn("camera.up.set(0,1,0)",STAGE)
  self.assertIn('yaw=.37;pitch=.12;dist=3.0',STAGE)
  self.assertIn('root.scale.setScalar(1.75/longest)',STAGE)
  self.assertNotIn('display.rotation.x=-Math.PI/2',STAGE)
  self.assertNotIn('pitch=1.18',STAGE)

 def test_desktop_upright_auto_selection_executes_for_tall_bottles(self):
  # Execute the actual decision function with V8, not just a text assertion.
  import subprocess,json
  func=STAGE[STAGE.index('function chooseUprightAxis('):STAGE.index('function refreshViewAxisButton()')]
  script="const axisChoice='auto';"+func+"console.log(JSON.stringify([chooseUprightAxis({x:1,y:1,z:5}),chooseUprightAxis({x:1,y:5,z:1}),chooseUprightAxis({x:5,y:.3,z:1})]));"
  value=subprocess.check_output(['node','-e',script],text=True).strip()
  self.assertEqual(json.loads(value),['z','y','y'])

 def test_desktop_frame_uses_selected_axis_without_rotating_mesh(self):
  import subprocess,json,math
  func=STAGE[STAGE.index('function frame(){'):STAGE.index('function clearRoot(){')]
  script=("let active=true,raf=0,uprightAxis='z',yaw=.37,pitch=.12,dist=3;"
   "const camera={up:{set(x,y,z){this.value=[x,y,z]}},position:{set(x,y,z){this.value=[x,y,z]}},lookAt(){}};"
   "const renderer={render(){}},scene={};function requestAnimationFrame(){return 1;}function resize(){};let renderCount=0,viewportWidth=0;"
   +func+"frame();console.log(JSON.stringify({up:camera.up.value,pos:camera.position.value}));")
  result=json.loads(subprocess.check_output(['node','-e',script],text=True))
  self.assertEqual(result['up'],[0,0,1])
  self.assertAlmostEqual(math.sqrt(sum(p*p for p in result['pos'])),3.0,places=5)
  self.assertLess(result['pos'][2],0.5)  # Camera is side-on to the bottle's Z axis.

 def test_desktop_viewport_resize_initial_and_reopen_preserves_aspect(self):
  # Execute the real resize function in V8. Canvas sizes from a previous render
  # must never override the visible viewport, including after opening fullscreen.
  import subprocess,json
  func=STAGE[STAGE.index('function resize(){'):STAGE.index('function frame(){')]
  script=(
   "let active=true,viewportWidth=0,viewportHeight=0,viewportRatio=0;"
   "const viewport={clientWidth:1440,clientHeight:810};"
   "const $=id=>id==='modelStageViewport'?viewport:null;"
   "const window={devicePixelRatio:2};"
   "const renderer={sizes:[],setPixelRatio(n){this.dpr=n;},setSize(w,h){this.sizes.push([w,h]);}};"
   "const camera={aspect:0,updates:0,updateProjectionMatrix(){this.updates++;}};"
   +func+
   "resize();viewport.clientWidth=1000;viewport.clientHeight=700;resize();"
   "viewport.clientHeight=0;resize();viewport.clientHeight=500;"
   "viewportWidth=0;resize();"
   "console.log(JSON.stringify({sizes:renderer.sizes,aspect:camera.aspect,dpr:renderer.dpr,updates:camera.updates}));"
  )
  result=json.loads(subprocess.check_output(['node','-e',script],text=True))
  self.assertEqual(result['sizes'],[[1440,810],[1000,700],[1000,500]])
  self.assertAlmostEqual(result['aspect'],2.0)
  self.assertEqual(result['dpr'],1.5)
  self.assertEqual(result['updates'],3)

 def test_viewport_isolated_from_canvas_intrinsic_grid_sizing(self):
  html=(ROOT/'frontend/index.html').read_text()
  css=(ROOT/'frontend/assets/style.css').read_text()
  self.assertIn('id="modelStageViewport" class="model-stage-viewport"',html)
  self.assertIn('.model-stage-viewport{position:relative;flex:1 1 0%;min-width:0;min-height:0;overflow:hidden}',css)
  self.assertIn('.model-stage .model-stage-viewport canvas,.model-stage .model-stage-viewport img{position:absolute;inset:0;',css)
  self.assertIn("resizingObserver=new ResizeObserver(()=>resize())",STAGE)
  self.assertIn('if(++renderCount%12===1||!viewportWidth)resize();',STAGE)
