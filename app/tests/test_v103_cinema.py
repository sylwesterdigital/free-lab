"""v0.10.6: offline regression coverage of cinema compositing, status & Meta descriptions."""
import json, subprocess, unittest
from pathlib import Path
from unittest.mock import patch
from backend import providers
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
FRONT=(ROOT/'frontend/assets/app.js').read_text()
SERVER=(ROOT/'backend/app.py').read_text()
INDEX=(ROOT/'frontend/index.html').read_text()

class CinemaTests(unittest.TestCase):
 def test_full_blackout_renders_only_cinema_then_returns_to_same_session(self):
  # Must clear the actual XR framebuffer alpha to opaque before drawing,
  # rather than draw a black card that leaves a passthrough halo.
  section=XR.split('function renderCinema(frame,pose){',1)[1].split('async function action(',1)[0]
  self.assertIn('gl.clearColor(0,0,0,1)',section)
  self.assertIn('gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT',section)
  self.assertIn('if(darkroom)drawCard(darkroom,vp)',section)
  self.assertIn('if(darkClose)drawCard(darkClose,vp)',section)
  self.assertNotIn('for(const c of cards)',section)
  self.assertNotIn('drawMascot3D(',section)
  render=XR.split('function renderView(t,frame){',1)[1].split('function ringPosition(',1)[0]
  self.assertIn('if(darkroom){renderCinema(frame,pose);session.requestAnimationFrame(updateView);return;}',render)
  self.assertIn("return darkroom?closeDarkroom():session?.end()",XR)

 def test_world_space_cinema_objects_and_image_source(self):
  b=XR.split('function baseFor(c){',1)[1].split('function',1)[0]
  for name in ('darkroom','darkroomexit','cinema-floor'):
   self.assertIn("'"+name+"'",b)
  src=XR.split('function enterDarkroom(',1)[1].split('function renderCinema',1)[0]
  self.assertIn('target.data?.image',src)
  self.assertIn('img.onload',src)
  self.assertIn('gl.deleteTexture(reference.front)',src)
  self.assertIn('width*ratio',src)
  self.assertIn('Math.atan2(-headM[9]',src)
  self.assertIn("size:[.23,.23]",src)
  self.assertNotIn('session.end()',src)

 def test_compact_voice_status_is_single_line(self):
  s=XR.split('function statusTexture(value){',1)[1].split('function addCard',1)[0]
  self.assertIn('conciseStatus(value)',s)
  self.assertIn("canvas2d(720,76)",s)
  self.assertNotIn('rows.slice',s)
  self.assertIn("return 'No speech'",XR)
  voice=XR.split('async function finishVoiceRecording(){',1)[1].split('async function applyPrompt',1)[0]
  self.assertIn("setVoicePhase('idle','',0)",voice)
  self.assertNotIn("setVoicePhase('error'",voice)
  self.assertIn('No speech',voice)

 def test_mascot_head_first_and_interactions(self):
  self.assertIn('quatFromTo([0,1,0],norm(velocity))',XR)
  self.assertIn("mascotReaction=gesture==='Open palm'?'approach':'escape'",XR)
  self.assertIn("mascotReaction='escape'",XR)
  self.assertIn('touches.length>=2',XR)
  self.assertIn('mascotReactionTarget=handGesturePositions[side]',XR)

 def test_release_version(self):
  self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.18')
  self.assertIn('xr.js?v=0.10.18',INDEX)

class VisionTests(unittest.TestCase):
 def test_explicit_description_refresh_instead_of_stale_dialogue(self):
  self.assertIn('window.FreeLab.describeXR(context.captureId,context.objectId,question,!question)',XR)
  self.assertIn('refresh=false',FRONT)
  self.assertIn('refresh};',FRONT)
  self.assertIn("if not question and history and not v.get('refresh')",SERVER)
  self.assertIn('Cannot analyze this image:',XR)

 def test_vision_model_request_is_actual_image_and_spark(self):
  jpeg=b'\xff\xd8'+b'A'*12
  class Result:
   def __enter__(self): return self
   def __exit__(self,*args):return False
   def read(self):return b''
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):return False
  response={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'A blue ceramic cup is on a brown wooden desk.'}]}], 'usage':{'total_tokens':22}}
  with patch.object(providers.urllib.request,'urlopen') as openurl:
   openurl.return_value.__enter__.return_value=response
   # json.load will read directly from mocked response through unittest.mock
   with patch.object(providers.json,'load',return_value=response):
    text,usage=providers.describe(jpeg,'private-key')
   req=openurl.call_args.args[0]
   body=json.loads(req.data)
   self.assertEqual(body['model'],'muse-spark-1.3')
   self.assertTrue(any(i.get('type')=='input_image' for i in body['input'][0]['content']))
   self.assertIn('blue ceramic cup',text)
   self.assertEqual(usage['total_tokens'],22)

if __name__=='__main__':unittest.main()
