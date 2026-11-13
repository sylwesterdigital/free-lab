"""v0.10.8: executable local selector and swept mascot collision regressions."""
import subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()

class SelectorAndMascot108(unittest.TestCase):
 def node(self,script):
  result=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stderr or result.stdout)
 def test_persistent_x_left_trigger_confirm_and_cancel(self):
  self.node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/lab-selector.js','utf8'),{window:w});
const selector=new w.FreeLabLabSelector.Selector();
const s=(x,trigger,axis)=>[{handedness:'left',gamepad:{mapping:'xr-standard',buttons:[{pressed:trigger},{},{},{pressed:false},{pressed:x}],axes:[0,0,axis,0]}}];
let v=selector.update(s(true,false,0));if(v.event!=='open')throw Error('X should open');
for(let i=0;i<4;i++){v=selector.update(s(false,false,0));if(!v.open)throw Error('X release should NOT close');}
v=selector.update(s(false,false,1));if(v.index!==1||v.event!=='step')throw Error('stick step');
selector.update(s(false,false,0));v=selector.update(s(false,false,1));if(v.index!==2)throw Error('second step');
v=selector.update(s(false,true,0));if(v.event!=='select'||v.open||v.mode!=='cubes')throw Error('trigger apply');
selector.update(s(false,false,0));v=selector.update(s(true,false,0));if(!v.open)throw Error('X reopen');
selector.update(s(false,false,0));v=selector.update(s(true,false,0));if(v.event!=='cancel'||v.open||v.mode!=='cubes')throw Error('X cancel leaves active mode untouched');
''')
 def test_swept_thrown_frame_single_mascot_impact(self):
  self.node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const G=w.FreeLabFrameGames;const eng=new G.Engine();eng.setMode('throw');
let f={id:7,width:.6,height:.6,corners:[[0,1.7,-.3],[0,1.7,.3],[0,1.1,.3],[0,1.1,-.3]]};let frames=[f];eng.onFrame(f);
if(!G.frameSphereHit(f.corners,[.08,1.4,0],.10))throw Error('surface intersection');
if(G.frameSphereHit(f.corners,[2,1.4,0],.1))throw Error('false far intersection');
eng.launch(frames,7,[3,0,0],0);eng.update(frames,0,{mascot:[.15,1.4,0]});let count=0;
for(let time=20;time<400;time+=20){const u=eng.update(frames,time,{mascot:[.32,1.4,0],mascotRadius:.14});count+=u.events.filter(x=>x.event==='mascot-hit').length;}
if(count!==1)throw Error('collision must trigger exactly once: '+count);
''')
 def test_xr_wiring_and_procedural_sound(self):
  for token in ("if(sel.event==='select'||sel.event==='cancel')", "if(e.inputSource.handedness==='left'&&labSelector?.open)return", "mascotHitUntil=t+1000", "launchMascotSparks(event.position,t)", "cue('impact')", "const warm=impact>0"):
   self.assertIn(token,XR)
  self.assertIn("if(name==='impact')",(ROOT/'frontend/assets/sound.js').read_text())

if __name__=='__main__':unittest.main()
