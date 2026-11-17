"""v0.10.68 checks: private bounded avatar workflow and no-camera text generation.
No paid services, live headset, or server Blender required.
"""
import base64,io,json,struct,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from backend import avatar_optimizer,db,media
ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'frontend/assets/app.js').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
BACK=(ROOT/'backend/app.py').read_text()
STAGE=(ROOT/'frontend/assets/model-stage.mjs').read_text()
CAPTURE=(ROOT/'frontend/assets/capture-studio.js').read_text()


def minimal_glb():
 obj={'asset':{'version':'2.0'},'buffers':[{'byteLength':0}],'scenes':[{'nodes':[]}],'scene':0}
 doc=json.dumps(obj).encode();doc+=b' ' *(-len(doc)%4)
 return struct.pack('<4sII',b'glTF',2,20+len(doc))+struct.pack('<I4s',len(doc),b'JSON')+doc

class Avatar125(unittest.TestCase):
 def test_bounded_avatar_route_and_user_visible_size(self):
  self.assertIn('MAX_AVATAR_GLB=4_000_000',BACK)
  self.assertIn('@app.post(\'/api/me/avatar-3d/optimize\')',BACK)
  self.assertIn('@app.get(\'/api/me/avatar-3d/optimize/<int:job_id>\')',BACK)
  self.assertIn('max_body=(22_000_000',BACK)
  self.assertIn('client_max_body_size 22m;', (ROOT/'deploy/install.py').read_text())
  self.assertIn('def valid_avatar_glb(raw,limit=MAX_AVATAR_GLB)',BACK)
  self.assertIn('16 MB',HTML)
  self.assertIn('4 MB',HTML)
  self.assertIn('profile3DAvatarOptimize',HTML)
  self.assertIn('openLocal(file)',APP)
  self.assertIn('openLocal:file=>open(null,false,file)',STAGE)
  self.assertIn('reduce by ',STAGE)
  self.assertNotIn('window.alert(',APP)
 def test_jobs_are_own_user_scoped_and_dispose_input_on_success(self):
  raw=minimal_glb()
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'main.sqlite';db.init(path);avatar_optimizer.init(path)
   with db.connect(path) as con:
    uid=db.create_user(con,'avtest','longpassword-avatar')
    other=db.create_user(con,'otherav','longpassword-avatar')
   with patch('backend.avatar_optimizer.blender_command',return_value='/usr/bin/blender'),patch('backend.avatar_optimizer.optimize',return_value=raw):
    jid=avatar_optimizer.submit(path,uid,raw,lambda value:value==raw)
    found=None
    for _ in range(200):
     found=avatar_optimizer.status(path,uid,jid)
     if found and found['status'] in ('SUCCEEDED','FAILED'):break
     time.sleep(.006)
   self.assertEqual(found['status'],'SUCCEEDED',found)
   self.assertIsNone(avatar_optimizer.status(path,other,jid))
   with db.connect(path) as con:
    self.assertEqual(con.execute('SELECT glb FROM user_avatar_models WHERE user_id=?',(uid,)).fetchone()['glb'],raw)
    self.assertIsNone(con.execute('SELECT input_glb FROM avatar_optimization_jobs WHERE id=?',(jid,)).fetchone()['input_glb'])
 def test_optimizer_safety_and_boundaries(self):
  self.assertEqual(avatar_optimizer.MAX_UPLOAD,16_000_000)
  self.assertEqual(avatar_optimizer.MAX_XR,4_000_000)
  self.assertIn('--disable-autoexec',(ROOT/'backend/avatar_optimizer.py').read_text())
  self.assertIn('subprocess.run(', (ROOT/'backend/avatar_optimizer.py').read_text())
  self.assertIn('export_animations=True',(ROOT/'backend/avatar_blender_worker.py').read_text())
  with self.assertRaises(ValueError):avatar_optimizer.optimize(b'0'*16_000_001,blender='blender')
  with self.assertRaises(RuntimeError):avatar_optimizer.optimize(b'0'*20,blender='/not/a/real/blender')

class AvatarRoundel67(unittest.TestCase):
 def test_settings_layout_and_spatial_room_cards(self):
  css=(ROOT/'frontend/assets/style.css').read_text()
  rooms=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('class="profile-avatar-overview"',HTML)
  self.assertIn('id="profile3DAvatarThumbnail"',HTML)
  self.assertIn('id="profile3DAvatarPlaceholder"',HTML)
  self.assertIn('class="visually-hidden"',HTML)
  self.assertIn('id="roomPrivate" class="room-visibility-card chosen"',HTML)
  self.assertIn('id="roomPublic" class="room-visibility-card"',HTML)
  self.assertIn('grid-template-columns:repeat(2,minmax(0,1fr))',css)
  self.assertIn("function selectXRVisibility(value)",rooms)
  self.assertIn("card.setAttribute('aria-pressed',String(selected))",rooms)
  self.assertIn("'Enter public room'",rooms)
  self.assertIn('profile3DAvatarSpinner',APP)
  self.assertIn("'/api/me/avatar-3d/thumbnail'",APP)
 def test_thumbnail_stale_avatar_not_saved_and_render_once(self):
  import ast,hashlib,threading,time
  backend=ast.parse(BACK)
  functions=[n for n in backend.body if isinstance(n,ast.FunctionDef) and n.name in ('_avatar_thumbnail_file','_avatar_thumbnail_marker','_avatar_thumbnail_worker')]
  self.assertEqual(len(functions),3)
  with tempfile.TemporaryDirectory() as tmp:
   data=Path(tmp);path=data/'main.sqlite';db.init(path)
   with db.connect(path) as con:
    uid=db.create_user(con,'roundeltest','longpassword-roundel')
    raw=minimal_glb();digest=hashlib.sha256(raw).hexdigest()
    with con:con.execute('INSERT INTO user_avatar_models(user_id,glb) VALUES(?,?)',(uid,raw))
   namespace=dict(AVATAR_THUMB_DIR=data,DB=path,avatar_optimizer=avatar_optimizer,hashlib=hashlib,
                  threading=threading,time=time,db=db,_admin_event=lambda *a:None,_avatar_thumb_guard=threading.Lock(),_avatar_thumb_active={(uid,digest)})
   exec(compile(ast.Module(body=functions,type_ignores=[]),'<thumbnail-test>','exec'),namespace)
   with patch.object(avatar_optimizer,'render_thumbnail',return_value=b'PNG mock') as render:
    namespace['_avatar_thumbnail_worker'](uid,digest,raw)
   target=namespace['_avatar_thumbnail_file'](uid,digest)
   self.assertEqual(target.read_bytes(),b'PNG mock')
   self.assertEqual(render.call_count,1)
   # A late Blender result for an outdated upload must not replace the new one.
   target.unlink()
   with db.connect(path) as con:
    with con:con.execute('UPDATE user_avatar_models SET glb=? WHERE user_id=?',(raw+b'changed',uid))
   with patch.object(avatar_optimizer,'render_thumbnail',return_value=b'OLD'):
    namespace['_avatar_thumbnail_worker'](uid,digest,raw)
   self.assertFalse(target.exists())
 def test_owner_only_preview_and_async_status(self):
  self.assertIn("@app.get('/api/me/avatar-3d/thumbnail')",BACK)
  self.assertIn('def own_avatar_thumbnail():',BACK)
  self.assertIn("if not row:return jsonify(status='missing'),404",BACK)
  self.assertIn("res.headers['Cache-Control']='private, no-store'",BACK)
  self.assertIn("response.status_code=202",BACK)
  self.assertIn('avatar_optimizer.render_thumbnail(raw,size=384)',BACK)
  self.assertIn('hashlib.sha256(raw).hexdigest()',BACK)

class VoiceText125(unittest.TestCase):
 def test_text_to_image_meta_contract(self):
  buf=io.BytesIO();Image.new('RGB',(24,24),'purple').save(buf,format='JPEG')
  blob=json.dumps({'status':'completed','output':[{'type':'image_generation_call','result':base64.b64encode(buf.getvalue()).decode()}],'usage':{'total_tokens':12}}).encode()
  with patch.object(media,'_request',return_value=blob) as req:
   jpg,usage=media.generate_meta_image('A bright paper lantern','fake-secret')
  self.assertTrue(jpg.startswith(b'\xff\xd8'))
  self.assertEqual(usage['total_tokens'],12)
  data=json.loads(req.call_args.args[1]);self.assertEqual(data['input'],'A bright paper lantern')
  self.assertEqual(data['model'],'muse-image-1.0');self.assertFalse(data['tools'][0]['enable_shell'])
  with self.assertRaises(ValueError):media.generate_meta_image('hi','key')
 def test_owned_private_source_endpoint_and_controls(self):
  self.assertIn("@app.post('/api/media/text-to-image')",BACK)
  self.assertIn("v.get('confirm_paid') is not True",BACK)
  self.assertIn("INSERT INTO captures(owner_id,image_name,sha256,description)",BACK)
  self.assertIn('async function generateXRImage(prompt)',APP)
  self.assertIn('await FL().generateXRImage(text)',CAPTURE)
  self.assertIn("case 'createimage':return openPrompt()",XR)
  self.assertIn('window.FreeLab.generateXRImage(promptText)',XR)
 def test_voice_default_direct_and_editor_enter(self):
  self.assertIn('id="pref-voiceConfirm"',HTML)
  self.assertIn("'shareExperimental','voiceConfirm'",APP)
  self.assertIn("if(!window.FreeLab?.pref?.('voiceConfirm'))",XR)
  self.assertIn('await confirmVoice();return;',XR)
  self.assertIn("if(evt.key==='Enter'&&!evt.isComposing)",XR)
  self.assertIn('void applyPrompt();',XR)
  self.assertIn("voicePhase==='listening'?'LISTENING",XR)
  self.assertIn('const w=960,h=Math.max(86,14+lines.length*58)',XR)
  self.assertIn('[[darkPrevious,-.245],[darkNext,0],[darkClose,.245]]',XR)
  self.assertIn("w=c.kind==='gallery'?Math.min(c.size[0]*c.scale*1.03,.27):.377*factor",XR)

if __name__=='__main__':unittest.main()

class AvatarDiagnostics68(unittest.TestCase):
 """Local regressions for server diagnostics and safe missing-avatar behavior."""
 def test_preview_and_remove_disabled_until_avatar_exists(self):
  self.assertIn('id="profile3DAvatarPreview" disabled',HTML)
  self.assertIn('id="profile3DAvatarRemove" disabled',HTML)
  self.assertIn('preview.disabled=!avatarSaved&&!pendingAvatarFile',APP)
  self.assertIn('remove.disabled=!avatarSaved',APP)
  self.assertIn("if(!pendingAvatarFile&&!avatarSaved)return;",APP)
  self.assertIn("'/me/avatar-3d/status'",APP)
  self.assertIn("avatarSaved=false;pendingAvatarFile=null;updateAvatarButtons()",APP)

 def test_thumbnail_failures_are_bounded_and_retry_is_explicit(self):
  self.assertIn("@app.get('/api/me/avatar-3d/status')\n@require_user",BACK)
  self.assertIn("@app.get('/api/me/avatar-3d/thumbnail')\n@require_user",BACK)
  self.assertIn("@app.post('/api/me/avatar-3d/thumbnail/retry')\n@require_user",BACK)
  self.assertIn('MAX_THUMBNAIL_SECONDS+35',BACK)
  self.assertIn("_avatar_thumbnail_marker(owner,digest,'rendering')",BACK)
  self.assertIn('fcntl.flock(lock.fileno(),fcntl.LOCK_EX)',BACK)
  self.assertIn("$('profile3DAvatarRetry')",APP)
  self.assertIn("response.headers.get('content-type')",APP)
  self.assertIn('img.onload=()=>',APP)
  self.assertIn('img.onerror=()=>',APP)

 def test_administrator_logs_are_bounded_and_read_only(self):
  import ast,re
  source=ast.parse(BACK)
  route=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='admin_runtime_logs')
  decorators=[ast.unparse(d) for d in route.decorator_list]
  self.assertIn('require_admin',decorators)
  self.assertIn("app.get('/api/admin/runtime-logs')",decorators)
  self.assertIn("source not in ('events','requests','journal')",BACK)
  self.assertIn('min(200,max(10,int(',BACK)
  self.assertIn("['journalctl','--unit=free-lab.service'",BACK)
  self.assertIn('capture_output=True,text=True,timeout=4',BACK)
  self.assertIn('id="profileLogs"',HTML)
  self.assertIn('data-profile-tab="logs"',HTML)
  self.assertIn('function loadAdminRuntimeLogs()',APP)
  safe=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='_safe_journal_text')
  namespace={'re':re}
  exec(compile(ast.Module(body=[safe],type_ignores=[]),'<journal-filter>','exec'),namespace)
  filtered=namespace['_safe_journal_text']('authorization: Bearer abc123\npassword=qwerty\nAll clear')
  self.assertNotIn('abc123',filtered)
  self.assertNotIn('qwerty',filtered)
  self.assertIn('All clear',filtered)

 def test_server_events_do_not_log_user_content(self):
  import ast,hashlib,os,re,datetime
  from datetime import timezone
  source=ast.parse(BACK)
  helper=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='_admin_event')
  with tempfile.TemporaryDirectory() as tmp:
   log=Path(tmp)/'events.jsonl'
   namespace={'RUNTIME_EVENTS':log,'datetime':datetime.datetime,'timezone':timezone,
              'os':os,'re':re,'json':json}
   exec(compile(ast.Module(body=[helper],type_ignores=[]),'<events>','exec'),namespace)
   namespace['_admin_event']('avatar.thumbnail.failed','Blender failed: /var/lib/freelab/private-file',7)
   data=json.loads(log.read_text())
   self.assertEqual(data['event'],'avatar.thumbnail.failed')
   self.assertEqual(data['user_id'],7)
   self.assertNotIn('/',data['message'])
   self.assertEqual(log.stat().st_mode&0o777,0o600)
