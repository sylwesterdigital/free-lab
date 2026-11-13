"""Five-finger string laboratory: offline, zero billable operations."""
import subprocess
import unittest
from pathlib import Path

APP=Path(__file__).resolve().parents[1]
XR=(APP/'frontend/assets/xr.js').read_text()
SOUND=(APP/'frontend/assets/sound.js').read_text()
HTML=(APP/'frontend/index.html').read_text()
MODULE=(APP/'frontend/assets/finger-lab.js').read_text()

class FiveFingerLab094(unittest.TestCase):
 def node(self,code):
  p=subprocess.run(['node','-e',code],cwd=APP,capture_output=True,text=True,timeout=20)
  self.assertEqual(p.returncode,0,p.stderr or p.stdout)
 def test_five_strings_independent_and_rearmed(self):
  self.node(r'''const fs=require('fs'),vm=require('vm');const window={};
vm.runInNewContext(fs.readFileSync('frontend/assets/finger-lab.js','utf8'),{window,Math,Number,Array});
const {Experiment,FINGERS,gradient}=window.FreeLabFingerLab;
function assert(x,m){if(!x)throw Error(m)}
assert(FINGERS.length===5,'Five notes expected');
assert(FINGERS.map(f=>f.note).join(',')==='C4,D4,E4,F4,G4','C-major mapping');
const ex=new Experiment(()=>.5);ex.setEnabled(true);
const a={};const b={};for(const f of FINGERS){a[f.id]=[0,1.2,0];b[f.id]=[.029,1.2,0];}
let u=ex.update({left:a,right:b,time:0});assert(u.events.length===0,'Must debounce');
u=ex.update({left:a,right:b,time:160});assert(u.events.length===5,'Five attachments should occur independently');
assert(u.strands.every(s=>s.mode==='linked'),'All linked');
assert(new Set(u.strands.map(s=>s.limit)).size>=4,'Different break distances required');
for(const s of u.strands){const f=FINGERS.find(v=>v.id===s.id);
 assert(Math.abs(s.limit-f.breakAt)<.0001,'Seeded jitter');
 const c0=gradient(f,0),c1=gradient(f,1);assert(c0.some((v,i)=>v!==c1[i]),'Colour must change');}
b.thumb=[.80,1.2,0];u=ex.update({left:a,right:b,time:270});
assert(u.events.length===1&&u.events[0].type==='snap'&&u.events[0].id==='thumb','Thumb alone should snap');
assert(u.strands.filter(s=>s.mode==='linked').length===4,'Other four remain playing');
for(const t of [450,800,1700]){u=ex.update({left:a,right:b,time:t});assert(u.strands[0].mode==='snapped','Broken string must not reattach');}
u=ex.update({left:a,right:b,time:2000});assert(u.strands[0].mode==='idle','Fragment expiration');
b.thumb=[.02,1.2,0];u=ex.update({left:a,right:b,time:2100});
assert(u.strands[0].mode==='idle','Needs touch transition and debounce');
u=ex.update({left:a,right:b,time:2300});assert(u.strands[0].mode==='linked','Reattach after separation');
assert(ex.toggle()===false,'Off');assert(ex.update({left:a,right:b,time:2500}).enabled===false,'No work off');
''')
 def test_jitter_is_bounded(self):
  self.node(r'''const fs=require('fs'),vm=require('vm');const w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/finger-lab.js','utf8'),{window:w});
const f=w.FreeLabFingerLab.FINGERS, E=w.FreeLabFingerLab.Experiment;
for(const seed of [0,1]){const ex=new E(()=>seed);ex.setEnabled(true);const l={},r={};
for(const p of f){l[p.id]=[0,0,0];r[p.id]=[.023,0,0];}
ex.update({left:l,right:r,time:0});const snap=ex.update({left:l,right:r,time:160});
for(const s of snap.strands){const p=f.find(x=>x.id===s.id);const expected=p.breakAt+(seed===0?-.06:.06);
if(Math.abs(s.limit-expected)>.00001)throw Error('Random snap jitter outside range');}}
''')
 def test_left_stick_mapping(self):
  self.node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/finger-lab.js','utf8'),{window:w});
const fn=w.FreeLabFingerLab.isLeftThumbstickPressed;
const control=(handedness,pressed)=>({handedness,gamepad:{mapping:'xr-standard',buttons:[{},{},{},{pressed}]}});
if(fn([control('right',true)])||fn([control('left',false)]))throw Error('Wrong button');
if(!fn([control('left',true)]))throw Error('Left thumbstick should toggle');
if(fn([{...control('left',true),hand:{}}]))throw Error('Hand must not toggle');
''')
 def test_webxr_and_synth_integration(self):
  for token in ('pollFingerLab(frame,t)','drawFingerLab(vp,t,pose)',
                "src.hand.get(f.joint)","window.FreeLabFingerLab.Experiment()",
                'stringLab?.setEnabled(false)', 'fingerLab?.setEnabled(false)',
                'fingersStopAll?.()'):
   self.assertIn(token,XR)
  for token in ('fingerAttach','fingerUpdate','fingerSnap','fingerStop','fingersStopAll'):
   self.assertIn(token,SOUND)
  self.assertIn('finger-lab.js?v=0.10.9',HTML)
  self.assertNotIn('fetch(',MODULE)

if __name__=='__main__':unittest.main()
