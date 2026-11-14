"""v0.10.21 regression tests; never call paid providers or remote server."""
from __future__ import annotations
import json,tempfile,unittest,struct
from pathlib import Path
from unittest.mock import patch
from backend import aholo3d,db,model_cache

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'frontend/index.html').read_text()
CAP=(ROOT/'frontend/assets/capture-studio.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
CSS=(ROOT/'frontend/assets/style.css').read_text()
B=(ROOT/'backend/app.py').read_text()

class UI119(unittest.TestCase):
 def test_dialog_loaded_before_app_and_no_native_dialog_calls(self):
  self.assertLess(HTML.index('assets/dialog.js'),HTML.index('assets/app.js'))
  for code in (CAP,APP,(ROOT/'frontend/assets/rooms.js').read_text()):
   for forbidden in ('window.confirm(', 'window.prompt(', 'window.alert('):self.assertNotIn(forbidden,code)
  self.assertIn('FreeLabDialog.confirm(',CAP)
  self.assertIn('FreeLabDialog.input(',APP)
  self.assertIn('role="alertdialog"',(ROOT/'frontend/assets/dialog.js').read_text())
 def test_three_icons_mic_and_multiline_composer(self):
  self.assertIn('id="captureQuickActions"',HTML)
  self.assertIn('id="captureQuickVoice"',HTML)
  self.assertIn('id="captureQuickEye"',HTML)
  self.assertIn('id="captureQuickExtract"',HTML)
  self.assertIn('<textarea rows="3" id="captureCommandText"',HTML)
  self.assertIn('data-capture-tool="3d"',HTML)
  self.assertIn('viewBox="0 0 24 24"',HTML)
  self.assertIn('capture-viewport.inspecting',CSS)
  self.assertIn('data-gallery-action="segment"',HTML)
  self.assertIn('data-capture-tool="segment"',HTML)
  self.assertIn('Extract named object',HTML)
  self.assertIn('Refine image',HTML)
 def test_audio_worklet_and_fallback(self):
  self.assertIn("audio.audioWorklet.addModule('/assets/mic-worklet.mjs?v=0.10.21')",APP)
  self.assertIn("new AudioWorkletNode(audio,'freelab-mic-recorder'",APP)
  self.assertIn('audio.createScriptProcessor(2048,1,1)',APP)
  self.assertIn("registerProcessor('freelab-mic-recorder'",(ROOT/'frontend/assets/mic-worklet.mjs').read_text())
 def test_ai_status_persistent_notes_and_job_polling(self):
  self.assertIn('captureViewport',CAP)
  self.assertIn("panel.classList.add('processing')",CAP)
  self.assertIn("FL().api('/media/descriptions?capture_id='",CAP)
  self.assertIn('monitorJob(result.id,chosen)',CAP)
  self.assertIn('FL().api(\'/media/3d/check\')',CAP)
  self.assertIn('generate3D(text)',CAP)
  self.assertIn('function resizeComposer()',CAP)
  self.assertIn('refineImage(text)',CAP)
  self.assertIn("if(id==='segment')",CAP)
  self.assertIn("poseForwardAnchor(pose,1.04,-.60)",(ROOT/'frontend/assets/xr.js').read_text())
 def test_private_read_only_routes(self):
  self.assertIn("@app.get('/api/media/descriptions')",B)
  self.assertIn("@app.get('/api/media/3d/check')",B)
  self.assertIn("@app.get('/api/media/3d/<int:jid>/asset')",B)
  self.assertIn('model_cache.store(',B)
 def test_versioned_files(self):
  for f in ('version.json','changelog.json','frontend/version.json','frontend/changelog.json'):
   self.assertEqual(json.loads((ROOT/f).read_text())['version'],'0.10.21')
  self.assertIn('room-viewer.mjs?v=0.10.21',(ROOT/'frontend/assets/rooms.js').read_text())


 def test_prompt_editor_theater_and_xr_layout_hotfixes(self):
  self.assertIn('How should this image evolve?',HTML)
  self.assertNotIn('Meta automatically uses Muse Image',HTML)
  self.assertIn('roomImagePrev',HTML)
  self.assertIn('roomImageNext',HTML)
  self.assertIn('cycleSelected(', (ROOT/'frontend/assets/room-viewer.mjs').read_text())
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn("['voice','🎤']",xr)
  self.assertIn('followOffset=[0,-.77,-1.16]',xr)
  self.assertIn('ai-live-text',CSS)

class Provider119(unittest.TestCase):
 def test_aholo_direct_image_submits_data_url(self):
  with patch.object(aholo3d,'request_api',return_value={'taskid':993}) as call:
   self.assertEqual(aholo3d.submit_image(b'\xff\xd8'+b'0'*100,b'key'),'993')
   self.assertEqual(call.call_args.args[1],aholo3d.CREATE)
   payload=call.call_args.args[3]
   self.assertTrue(payload['img'].startswith('data:image/jpeg;base64,'))
   self.assertEqual(payload['outputFormat'],['glb'])
   self.assertEqual(payload['version'],'G1-Turbo')
 def test_aholo_prompt_uses_text_to_3d_not_ignored(self):
  with patch.object(aholo3d,'request_api',return_value=871) as call:
   self.assertEqual(aholo3d.submit_image(b'\xff\xd8'+b'0'*100,'key','Make this a cartoon'),'871')
   self.assertEqual(call.call_args.args[1],aholo3d.TEXT_CREATE)
   self.assertEqual(call.call_args.args[3]['prompt'],'Make this a cartoon')
   self.assertEqual(call.call_args.args[3]['style'],'cartoon')
  with self.assertRaises(ValueError):aholo3d.submit_image(b'not a jpeg','key')
 def test_aholo_terminal_failure_surfaced(self):
  with patch.object(aholo3d,'request_api',return_value={'status':4,'errorInfo':{'message':'Image unsuitable'}}):
   r=aholo3d.status('1234','key');self.assertEqual(r['status'],'FAILED');self.assertIn('Image unsuitable',r['error'])
 def test_model_cache_private_bounded_persistent(self):
  raw=b'glTF'+struct.pack('<II',2,20)+b'\0'*8
  class FakeResponse:
   headers={'Content-Length':str(len(raw))}
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,*a):return raw
  class FakeOpener:
   def open(self,*a,**kw):return FakeResponse()
  with tempfile.TemporaryDirectory() as t:
   with patch('urllib.request.build_opener',return_value=FakeOpener()):
    name=model_cache.store('https://cdn.meshy.ai/test.glb','meshy',Path(t),7,12)
    self.assertEqual(name,'7_12.glb')
    self.assertEqual((Path(t)/name).read_bytes(),raw)
    self.assertEqual(model_cache.store('https://cdn.meshy.ai/test.glb','meshy',Path(t),7,12),name)
   with self.assertRaises(ValueError):model_cache.store('http://localhost/admin','meshy',Path(t),7,12)
 def test_db_upgrades_for_existing_jobs(self):
  with tempfile.TemporaryDirectory() as t:
   file=Path(t)/'test.sqlite';db.init(file)
   with db.connect(file) as con:
    cols={r['name'] for r in con.execute('PRAGMA table_info(jobs_3d)')}
    self.assertIn('model_path',cols)
    self.assertIn('cache_error',cols)
   db.init(file)

if __name__=='__main__':unittest.main()
