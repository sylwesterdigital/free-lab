"""v0.10.47 checks: private bounded avatar workflow and no-camera text generation.
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
  self.assertIn('const w=1024,h=Math.max(96,18+lines.length*76)',XR)
  self.assertIn('[[darkPrevious,-.245],[darkNext,0],[darkClose,.245]]',XR)
  self.assertIn('w=.377*factor,hh=.081*factor',XR)

if __name__=='__main__':unittest.main()
