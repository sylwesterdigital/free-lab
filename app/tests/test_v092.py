"""XR 0.9.2 behavioral regressions. This suite makes no network/API calls."""
from pathlib import Path
import subprocess,unittest
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
BACKEND=(ROOT/'backend/app.py').read_text()
class XR092(unittest.TestCase):
 def test_three_independent_world_roundels(self):
  for term in ('voiceButton=makeRoundel','extractButton=makeRoundel',"if(h.card.kind==='voiceroundel')return 'voice'", "if(h.card.kind==='extractroundel')return 'extract'", "if(h.card.kind==='voiceok')return 'confirmvoice'", "if(h.card.kind==='voicecancel')return 'cancelvoice'"):
   self.assertIn(term,XR)
  self.assertIn("cards.some(c=>c.kind==='source'&&c.visible)",XR)
  self.assertIn("'voiceroundel','extractroundel','voiceok','voicecancel','diagnostics'",XR)
 def test_voice_text_transparent_and_expanding(self):
  self.assertIn("ctx.strokeStyle='#080b08'",XR)
  self.assertIn("ctx.fillStyle='#ffe64b'",XR)
  self.assertIn("const w=1024,h=Math.max(98,30+lines.length*62)",XR)
  self.assertNotIn("'HEARD',92",XR)
  self.assertIn('await window.FreeLab.recordWavPrompt(12000)',XR)
  self.assertIn('Math.min(12000,durationMs)',APP)
  self.assertIn('len(wav)>420_000',BACKEND)
  self.assertIn('len(b64)>600_000',BACKEND)
  self.assertIn("voicePending={text,context:target}",XR)
  section=XR[XR.index('async function voicePrompt()'):XR.index('async function applyPrompt()')]
  self.assertNotIn('keyboardPrompt()',section)
  self.assertIn('function confirmVoice()',XR)
  self.assertIn('function dismissVoice()',XR)
 def test_orientation_and_image_specific_progress(self):
  self.assertIn('if(toolbar&&followMode)',XR)
  self.assertIn('menuYaw=smoothYaw',XR)
  self.assertIn('inferenceCard=context.card',XR)
  self.assertIn('drawImageInference(vp,t)',XR)
  self.assertIn('return applyPrompt()',XR)
 def test_direct_grab_relative_to_ray_world_pose(self):
  script=r'''const vm=require('vm'),fs=require('fs'),src=fs.readFileSync('frontend/assets/xr.js','utf8').replace(
 'window.FreeLabXR={start,isRunning:()=>!!session};',
 `window.FreeLabXR={attachGrab,advanceGrab,buttonFromHit,syncTrackedUI,rootPos,baseFor,
  setRoot:(m)=>{root=m;rootYaw=0;},setCloud:(m)=>{cloud=m;},setHeld:(m)=>{held=m;},setLatestPose:(p)=>{latestPose=p;},
  setToolbar:(t,follow)=>{toolbar=t;followMode=follow;}, getToolbar:()=>toolbar};`);
const w={FreeLab:{notify:()=>{},pref:()=>false}};
vm.runInNewContext(src,{window:w,performance:{now:()=>1000},Math,console,WeakMap,Map});
const xr=w.FreeLabXR;
const ident=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
xr.setRoot(new Float32Array(ident));
let angle=0,position=[0,0,0];const srcInput={targetRaySpace:{}};
function pose(){const c=Math.cos(angle),s=Math.sin(angle);
 const m=[c,0,-s,0,0,1,0,0,s,0,c,0,...position,1];
 return {transform:{matrix:m,orientation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},position:{x:position[0],y:position[1],z:position[2]}}};}
const frame={getPose:()=>pose()};
const card={id:'object1',kind:'object',pos:[0,0,-1],q:[0,0,0,1],size:[.3,.3],scale:1,visible:true};
const attachment=xr.attachGrab(frame,srcInput,card,{dist:1});if(!attachment)throw Error('No attachment');
xr.setHeld({src:srcInput,id:null,card,attach:attachment,rayDist:1,worldStart:[0,0,-1],initialQuat:[0,0,0,1],start:0});
xr.setLatestPose({transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}});
position=[.3,0,0];angle=Math.PI/2;xr.advanceGrab(frame);
function close(a,b){return Math.abs(a-b)<.0001;}
if(!close(card.pos[0],-.7)||!close(card.pos[2],0))throw Error('Ray contact drift: '+card.pos);
if(!close(card.q[1],Math.SQRT1_2)||!close(card.q[3],Math.SQRT1_2))throw Error('World rotation drift: '+card.q);
const nav={pos:[0,-.5,-1],q:[0,.38,0,.925],front:true};
xr.setToolbar(nav,false);const old=nav.q.slice();xr.syncTrackedUI({transform:{matrix:pose().transform.matrix}},1016);
if(!nav.q.every((x,i)=>x===old[i]))throw Error('Pinned menu rotated with head');
// Head-follow roundels should not inherit cloud offsets or photo-world roots.
xr.setCloud({offset:[5,0,0]});
const control={kind:'voiceroundel',pos:[.1,0,-1]};
if(xr.rootPos(control)[0]!==.1)throw Error('Voice control inherited capture offset');
console.log('Direct pose grab and fixed pinned menu OK');'''
  r=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True,timeout=20)
  self.assertEqual(r.returncode,0,r.stderr or r.stdout)
if __name__=='__main__':unittest.main()
