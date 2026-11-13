"""v0.10.9 physics games: pure WebXR-independent geometry and simulated game states."""
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
PAGE=(ROOT/'frontend/index.html').read_text()

class PhysicsGameTests(unittest.TestCase):
    def run_node(self,script):
        result=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr or result.stdout)
    def test_cuboid_gravity_and_floor_and_stacking(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('cubes');g.setFloor(0);
const frame=(id,y)=>({id,width:.4,height:.3,corners:[[ -.2,y+.15,0],[.2,y+.15,0],[.2,y-.15,0],[-.2,y-.15,0]]});
let a=frame(1,1.7),b=frame(2,2.3);
if(!g.onFrame(a).removeFrame||!g.onFrame(b).removeFrame)throw Error('frames should become boxes');
for(let t=0;t<4200;t+=12)g.update([],t,{floorY:0});
if(g.boxes.some(b=>b.center[1]-b.half[1]<-.01))throw Error('floor penetration');
if(g.boxes.some(b=>!b.center.every(Number.isFinite)))throw Error('non-finite positions');
if(g.boxes[0].center[1]>1)throw Error('gravity not acting');
if(g.boxes.length!==2)throw Error('boxes disappeared');
console.log('cube physics passed',g.boxes.map(b=>b.center));''')
    def test_chain_attach_swing_and_follow_moving_parent(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('chain');
const rectangle=(id,x)=>({id,width:.4,height:.3,corners:[[x-.2,1.8,0],[x+.2,1.8,0],[x+.2,1.5,0],[x-.2,1.5,0]]});
const f=[rectangle(1,0),rectangle(2,.32)];for(const v of f)g.onFrame(v);
const attached=g.linkOnOverlap(f,1);
if(attached?.event!=='link'||attached.parentId!==1||attached.childId!==2)throw Error('overlapping frames did not link');
const initial=JSON.stringify(f[1].corners);
f[0].corners=f[0].corners.map(p=>[p[0]+.3,p[1]+.2,p[2]]);
for(let t=0;t<600;t+=10)g.update(f,t);
if(JSON.stringify(f[1].corners)===initial)throw Error('child did not swing');
if(g.linkOnOverlap(f,2))throw Error('reverse link cycle');
if(g.links.length!==1)throw Error('duplicate or missing links');
console.log('hinge physics passed');''')
    def test_throw_has_release_velocity_and_expires(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('throw');
let f={id:12,width:.4,height:.3,corners:[[-.2,1,0],[.2,1,0],[.2,.7,0],[-.2,.7,0]]};const frames=[f];g.onFrame(f);
if(g.launch(frames,12,[.01,0,0],0))throw Error('stationary release should not throw');
const e=g.launch(frames,12,[2,0,1],0);if(e?.event!=='throw')throw Error('release velocity ignored');
g.update(frames,0);g.update(frames,100);if(f.corners[0][0]<=-.2)throw Error('not moving');
for(let t=120;t<2000;t+=16)g.update(frames,t);
if(frames.length||g.throws.length)throw Error('frame not popped after 1.6 s');''')
    def test_eight_modes_in_persistent_selector(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/lab-selector.js','utf8'),{window:w});
const a=w.FreeLabLabSelector.MODES;if(a.join('|')!=='frames|sort|chain|cubes|throw|five|thumbs|off')throw Error('mode list');
const s=new w.FreeLabLabSelector.Selector();const inp=(x,trigger,axis)=>[{handedness:'left',gamepad:{mapping:'xr-standard',buttons:[{pressed:trigger},{},{},{},{pressed:x}],axes:[0,0,axis,0]}}];
s.update(inp(true,false,0));s.update(inp(false,false,1));let u=s.update(inp(false,false,0));if(!u.open||u.index!==1)throw Error('selector must remain visible');
u=s.update(inp(false,true,0));if(u.mode!=='sort'||u.open)throw Error('trigger selection');
s.update(inp(false,false,0));s.update(inp(true,false,0));s.update(inp(false,false,1));u=s.update(inp(false,true,0));if(u.mode!=='chain')throw Error('second selection');''')

    def test_production_wiring(self):
        for token in ('window.FreeLabFrameGames.Engine()', 'frameGames?.onFrame(placed,mode,t)',
                      'frameGames?.linkOnOverlap(frameLab.frames,df.id)', 'frameGames?.launch(frameLab.frames,frameTouch.id',
                      'pollFrameGames(t,pose)', 'drawFrameCubes(vp)', 'gl.drawArrays(gl.TRIANGLES,0,36)'):
            self.assertIn(token,XR)
        self.assertIn('frame-games.js?v=0.10.11',PAGE)
        self.assertNotIn('cdn', (ROOT/'frontend/assets/frame-games.js').read_text())

if __name__=='__main__':unittest.main()
