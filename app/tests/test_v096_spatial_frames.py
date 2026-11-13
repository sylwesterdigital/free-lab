"""Spatial frames and left-controller mode selector: executable no-billing tests."""
import subprocess
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
XR = (ROOT/'frontend/assets/xr.js').read_text()
PAGE = (ROOT/'frontend/index.html').read_text()

class SpatialFrames096(unittest.TestCase):
    def node(self, js):
        result = subprocess.run(['node','-e',js],cwd=ROOT,capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr or result.stdout)

    def test_frames_attach_stretch_detach_rearm_and_world_lock(self):
        self.node(r'''const fs=require('fs'),vm=require('vm'),window={};
vm.runInNewContext(fs.readFileSync('frontend/assets/frame-lab.js','utf8'),{window,Math,Number,Array});
const F=window.FreeLabFrameLab, e=new F.Experiment();
function ok(c,m){if(!c)throw Error(m)}
ok(e.setHoldSeconds(3)===3,'default hold');
ok(e.setHoldSeconds(5)===5,'five-second configuration');
ok(e.setHoldSeconds(15)===3,'invalid holds reset');
e.setEnabled(true);
const left={index:[-.18,1.42,0],thumb:[-.18,1.33,0]},right={index:[.18,1.42,0],thumb:[.18,1.33,0]};
const nearL={index:[-.020,1.42,0],thumb:[-.020,1.33,0]};
const nearR={index:[.020,1.42,0],thumb:[.020,1.33,0]};
let v=e.update({left,right,time:0});ok(v.mode==='idle','starts idle');
v=e.update({left:nearL,right:nearR,time:100});ok(v.mode==='idle','requires stable contact');
v=e.update({left:nearL,right:nearR,time:270});ok(v.mode==='forming'&&v.event==='attach','fingertip formation required');
v=e.update({left,right,time:400});ok(v.event==='countdown','begin timer after stretching');
ok(v.live.width>.35&&v.live.height>.08,'real sized rectangle');
const vertices=v.live.corners;ok(vertices.length===4,'four nodes');
const edge=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
ok(Math.abs(dot(edge(vertices[1],vertices[0]),edge(vertices[3],vertices[0])))<.000001,'true rectangular corners');
v=e.update({left,right,time:2300});ok(v.mode==='forming'&&v.progress<1,'not detached early');
v=e.update({left,right,time:3400});ok(v.mode==='cooldown'&&v.event==='place','3s hold releases frame');
ok(e.frames.length===1,'persistent detached frame');
const saved=JSON.stringify(e.frames[0].corners);e.update({left,right,time:3500});
ok(JSON.stringify(e.frames[0].corners)===saved,'detached vertices do not follow hands');
e.setEnabled(false);ok(e.frames.length===1,'switching modes preserves frames');
e.setEnabled(true);ok(e.frames.length===1,'return to frames keeps them');
e.update({left,right,time:3600});e.update({left:nearL,right:nearR,time:3900});
e.update({left:nearL,right:nearR,time:4070});e.update({left,right,time:4100});
v=e.update({left,right,time:7100});ok(e.frames.length===2&&v.event==='place','repeat creates another room frame');
e.clear();ok(e.frames.length===0,'XR end clears session frames');
''')

    def test_loss_of_tracking_does_not_place_a_frame(self):
        self.node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/frame-lab.js','utf8'),{window:w});
const e=new w.FreeLabFrameLab.Experiment();e.setEnabled(true);
let a={index:[-.2,1.4,0],thumb:[-.2,1.3,0]},b={index:[.2,1.4,0],thumb:[.2,1.3,0]};
e.update({left:a,right:b,time:0});a={index:[-.02,1.4,0],thumb:[-.02,1.3,0]};b={index:[.02,1.4,0],thumb:[.02,1.3,0]};
e.update({left:a,right:b,time:100});e.update({left:a,right:b,time:300});
const result=e.update({left:a,right:null,time:450});if(result.mode!=='idle'||e.frames.length)throw Error('lost hand must abort current frame');
''')

    def test_selector_press_tilt_release_and_deadzone(self):
        self.node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/lab-selector.js','utf8'),{window:w});
const S=new w.FreeLabLabSelector.Selector();
function inp(pressed,x){return [{handedness:'left',gamepad:{mapping:'xr-standard',buttons:[{},{},{},{pressed}],axes:[0,0,x,0]}}]}
let u=S.update(inp(true,0));if(!u.open||u.event!=='open'||u.index!==0)throw Error('frames should be default from disabled mode');
u=S.update(inp(true,-.8));if(u.index!==3||u.event!=='step')throw Error('wrap left to off');
u=S.update(inp(true,-.8));if(u.index!==3)throw Error('held joystick must not auto-repeat');
S.update(inp(true,0));u=S.update(inp(true,-.9));if(u.index!==2)throw Error('second left step after neutral');
S.update(inp(true,0));u=S.update(inp(true,-.9));if(u.index!==1)throw Error('five strings selection');
S.update(inp(true,0));u=S.update(inp(true,-.9));if(u.index!==0)throw Error('frames selection');
u=S.update(inp(false,0));if(u.open||u.mode!=='frames'||u.event!=='select')throw Error('release should activate highlighted experiment');
if(S.update([]).event!==null)throw Error('idle must not retrigger');
if(w.FreeLabLabSelector.input([{handedness:'right',gamepad:{mapping:'xr-standard',buttons:[{},{},{},{pressed:true}],axes:[0,0,1,0]}}]).pressed)throw Error('right hand cannot open selector');
''')

    def test_integration_menu_near_controller_and_frozen_frames(self):
        for token in ('pollLabSelector(frame,t,pose)', 'pollFrameLab(frame,t)', 'drawSpatialFrames(vp,t,pose)',
                      'window.FreeLabFrameLab.Experiment()', 'window.FreeLabLabSelector.Selector()',
                      "frame.getJointPose?.(src.hand.get(jointName),refSpace)",
                      "labMenu.q=quatY(cameraYaw(pose))",'for(const f of frameLab.frames)',
                      "window.FreeLab?.pref?.('frameHoldSeconds')",'gl.TRIANGLE_STRIP'):
            self.assertIn(token,XR)
        self.assertIn('lab-selector.js?v=0.10.5',PAGE)
        self.assertIn('frame-lab.js?v=0.10.5',PAGE)
        self.assertIn('id="pref-frameHoldSeconds"',PAGE)
        for name in ('frame-lab.js','lab-selector.js'):
            self.assertNotIn('fetch(', (ROOT/'frontend/assets'/name).read_text())

if __name__ == '__main__':unittest.main()
