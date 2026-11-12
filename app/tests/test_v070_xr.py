"""Safety and release regressions for v0.7: keyboard, voice, mixing, diagnostics."""
import base64, io, json, pathlib, subprocess, unittest
from unittest.mock import patch
from PIL import Image
from backend import media
ROOT=pathlib.Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
SOUND=(ROOT/'frontend/assets/sound.js').read_text()
SERVER=(ROOT/'backend/app.py').read_text()

class XRTests(unittest.TestCase):
 def test_eye_half_size_and_portal(self):
  self.assertIn('size:[.099,.099]',XR)
  self.assertIn('<small>ENTER</small><strong>XR</strong>',HTML)
 def test_xr_keyboard_never_ends_session(self):
  region=XR.split('async function keyboardPrompt(){',1)[1].split('async function changeObject',1)[0]
  self.assertIn('session?.isSystemKeyboardSupported',region)
  self.assertIn('xrKeyboard.focus()',region)
  self.assertIn('oninput',region)
  self.assertNotIn('session.end(',region)
  self.assertNotIn('window.FreeLab.openPromptEditor',region)
 def test_mic_lifecycle_and_voice_find(self):
  self.assertIn('async function armMicrophone()',APP)
  self.assertIn('reused=stream===state.micStream',APP)
  self.assertIn('if(!reused)stream.getTracks().forEach',APP)
  self.assertIn('async function voicePrompt()',XR)
  self.assertIn('async function respondFind(name)',XR)
  self.assertIn('await showCloud(location.id)',XR)
  self.assertIn('return respondFind(finding)',XR)
  self.assertIn('session remains open',XR) if 'session remains open' in XR else self.assertNotIn('session.end()', XR.split('async function finishVoiceRecording()',1)[1].split('async function applyPrompt()',1)[0])
  self.assertIn('id="armXRMic"',HTML)
 def test_card_close_and_bin_restore(self):
  self.assertIn("text(ctx,'×',fullWidth-57",XR)
  self.assertIn('Card hidden in XR · still saved privately',XR)
  self.assertIn('async function binSource()',XR)
  self.assertIn("kind==='bincloud'",XR)
  self.assertIn("cue('paper')",XR)
  self.assertIn("play('shutter')",APP)
  self.assertIn('noiseBurst',SOUND)
 def test_context_tooling_and_mixing(self):
  self.assertNotIn("case 'mix':return mixAdd()",XR)
  self.assertIn('mixBucket.length===2',XR)
  self.assertIn('mix_sources',APP)
  self.assertIn('mix_sources',SERVER)
  self.assertIn('owner_id=?',SERVER)
  self.assertIn('Restore this image with more detail and a higher resolution',XR)
  self.assertIn('bloomChildren([o],context.card)',XR)
 def test_diagnostics_are_admin_only_and_body_free(self):
  self.assertIn("@app.get('/api/admin/diagnostics')",SERVER)
  self.assertIn('@require_admin\ndef admin_diagnostics',SERVER)
  self.assertIn("'method':request.method",SERVER)
  self.assertNotIn('request.data',SERVER[SERVER.index('def diagnostic_response'):SERVER.index('@app.get(\'/api/admin/diagnostics\')')])
  self.assertIn("case 'debug':debugShowing=!debugShowing",XR)
  self.assertIn("if(t-serverPoll>6000)",XR)
 def test_optional_mascot_and_device_voice(self):
  self.assertIn('function mascotTexture()',XR)
  self.assertIn("mascotMode()!=='3d'",XR)
  for setting in ('mascotMode','spoken','troll'):self.assertIn('id="pref-'+setting+'"',HTML)
 def test_actual_speech_find_phrase(self):
  part=XR.split('function findLabel(phrase){',1)[1].split('\nasync function respondFind',1)[0]
  js='function findLabel(phrase){'+part+'\nfor(const p of ["where is my backpack?","Find my backpack", "highlight the backpack"]){ if(findLabel(p)!=="backpack")throw Error(p+" => "+findLabel(p));}'
  result=subprocess.run(['node','-e',js],capture_output=True,text=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)

class ImageCompositionTests(unittest.TestCase):
 @staticmethod
 def photo(color):
  out=io.BytesIO();Image.new('RGB',(40,32),color).save(out,format='JPEG');return out.getvalue()
 def test_two_references_are_forwarded_without_paid_network(self):
  one,two=self.photo('red'),self.photo('blue')
  res={'status':'completed','output':[{'type':'image_generation_call','result':base64.b64encode(one).decode()}],'usage':{'total_tokens':24}}
  with patch.object(media,'_request',return_value=json.dumps(res).encode()) as mock:
   output,usage=media.edit_meta_images([one,two],'Combine both sources carefully','demo-fake-key')
  self.assertTrue(output.startswith(b'\xff\xd8'))
  self.assertEqual(usage['total_tokens'],24)
  payload=json.loads(mock.call_args.args[1])
  content=payload['input'][0]['content']
  self.assertEqual([x['type'] for x in content],['input_text','input_image','input_image'])
  self.assertFalse(payload['store'])
 def test_rejects_more_than_two_references_prior_to_network(self):
  photo=self.photo('green')
  with patch.object(media,'_request') as request:
   with self.assertRaises(ValueError):media.edit_meta_images([photo]*3,'mix','test')
   request.assert_not_called()

if __name__=='__main__':unittest.main()
