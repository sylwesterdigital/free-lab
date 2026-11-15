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

 def test_control_row_fixed_to_photo_bottom_not_head(self):
  section=XR.split('function layoutCinemaControls(){',1)[1].split('function cinemaFloorTexture(',1)[0]
  self.assertIn('const center=darkroom.pos,orientation=darkroom.q;',section)
  self.assertIn('lowerEdge=-Math.abs(darkroom.size[1])*.5',section)
  self.assertIn('rowY=lowerEdge-.16',section)
  self.assertIn('[[darkPrevious,-.245],[darkNext,0],[darkClose,.245]]',section)
  self.assertIn('button.q=orientation',section)
  self.assertIn('button.size=[.19,.19]',section)
  self.assertNotIn('poseForwardAnchor(',section)
  render=XR.split('function renderCinema(frame,pose){',1)[1].split('async function action(',1)[0]
  self.assertNotIn('button.pos=',render)
  self.assertNotIn('poseForwardAnchor(',render)
  self.assertIn('if(darkPrevious)drawCard(darkPrevious,vp)',render)
  self.assertIn('if(darkNext)drawCard(darkNext,vp)',render)
  self.assertIn('if(darkClose)drawCard(darkClose,vp)',render)
  init=XR.split('function enterDarkroom(targetCard=null){',1)[1].split('function navigateCinema(',1)[0]
  self.assertEqual(init.count('layoutCinemaControls();'),2)
  self.assertIn("darkPrevious=arrow('‹','cinemaprev')",init)
  self.assertIn("darkNext=arrow('›','cinemanext')",init)

 def test_runtime_theater_controls_share_image_world_space(self):
  # This specifically catches v0.10.28's false positive: layout positions looked
  # correct but arrow cardModel() inherited the collection root and X did not.
  rootpos=XR.split('function rootPos(c){',1)[1].split('}\nfunction baseFor(c){',1)[0]
  basefor=XR.split('function baseFor(c){',1)[1].split('}\nfunction cameraYaw(',1)[0]
  layout=XR.split('function layoutCinemaControls(){',1)[1].split('}\nfunction cinemaFloorTexture(',1)[0]
  program=r"""
const root=[9,8,7],cloud={offset:[6,5,4]}, darkroom={pos:[1,2,-3],q:[0,0,0,1],size:[1.5,1.2]};
let darkPrevious={kind:'cinemaprev',pos:[0,0,0]},darkNext={kind:'cinemanext',pos:[0,0,0]},darkClose={kind:'darkroomexit',pos:[0,0,0]};
function translate(){return [0,0,0];}
const vadd=(a,b)=>a.map((n,i)=>n+b[i]);
const quatVec=(q,v)=>v;
"""+'\nfunction rootPos(c){'+rootpos+'}\nfunction baseFor(c){'+basefor+'}\nfunction layoutCinemaControls(){'+layout+'}\n'+r"""
layoutCinemaControls();
const buttons=[darkPrevious,darkNext,darkClose];
for(const btn of buttons){
 if(JSON.stringify(baseFor(btn))!=='[0,0,0]')throw Error('Inherited collection root: '+btn.kind);
 if(JSON.stringify(rootPos(btn))!==JSON.stringify(btn.pos))throw Error('Translated cinema position: '+btn.kind);
 if(Math.abs(btn.pos[1]-(2-.6-.16))>1e-6)throw Error('Button is not below photo');
 if(JSON.stringify(btn.q)!==JSON.stringify(darkroom.q))throw Error('Button not image-aligned');
}
if(Math.abs(darkPrevious.pos[0]-.755)>1e-6||Math.abs(darkNext.pos[0]-1)>1e-6||Math.abs(darkClose.pos[0]-1.245)>1e-6)
 throw Error('Controls not evenly grouped');
"""
  import shutil
  if shutil.which('node'):
   result=subprocess.run(['node','-e',program],capture_output=True,text=True,timeout=6)
   self.assertEqual(result.returncode,0,result.stderr)

 def test_world_space_cinema_objects_and_image_source(self):
  b=XR.split('function baseFor(c){',1)[1].split('function',1)[0]
  for name in ('darkroom','darkroomexit','cinemaprev','cinemanext','cinema-floor'):
   self.assertIn("'"+name+"'",b)
  root_section=XR.split('function rootPos(c){',1)[1].split('function baseFor(c){',1)[0]
  for name in ('cinemaprev','cinemanext'):
   self.assertIn("'"+name+"'",root_section)
  src=XR.split('function enterDarkroom(',1)[1].split('function renderCinema',1)[0]
  self.assertIn('target.data?.image',src)
  self.assertIn('img.onload',src)
  self.assertIn('gl.deleteTexture(reference.front)',src)
  self.assertIn('width*ratio',src)
  self.assertIn('Math.atan2(-headM[9]',src)
  self.assertIn("size:[.19,.19]",src)
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
  self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.39')
  self.assertIn('xr.js?v=0.10.39',INDEX)

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
