"""v0.10.9: executable local selector and swept mascot collision regressions."""
import subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()

class SelectorAndMascot108(unittest.TestCase):
 def node(self,script):
  result=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stderr or result.stdout)

 def test_no_controller_lab_selector(self):
  self.assertFalse((ROOT/'frontend/assets/lab-selector.js').exists())
  self.assertNotIn('FreeLabLabSelector',XR)
  self.assertIn("agencyEnterLab(mode)",XR)
  self.assertIn("if(xrExperience==='agency-lab'){renderAgencyLab(t,frame,pose);return;}",XR)
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
  for token in ("mascotHitUntil=t+1000", "launchMascotSparks(event.position,t)", "cue('impact')", "const warm=impact>0"):
   self.assertIn(token,XR)
  self.assertIn("if(name==='impact')",(ROOT/'frontend/assets/sound.js').read_text())

if __name__=='__main__':unittest.main()
