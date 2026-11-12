"""Behavioral WebXR interaction tests: no browser, API calls or paid inference."""
import subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()

class QuestInteractionRegression(unittest.TestCase):
    def test_release_action_is_latched_before_movement(self):
        self.assertIn("if(h.id){window.FreeLab?.traceEvent?.('XR image action: '+h.id,'info');return action(h.id);}",XR)
        self.assertIn("if(!held||held.id)return",XR)
        self.assertNotIn("setVoicePhase('gesture'",XR)
        self.assertIn('mascotSay(gesture)',XR)
    def test_button_geometry_and_release_during_rotation(self):
        script=r'''
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('./frontend/assets/xr.js','utf8').replace(
 'window.FreeLabXR={start,isRunning:()=>!!session};',
 `window.FreeLabXR={start,isRunning:()=>!!session,
  hit:buttonFromHit,hitTest,drag:advanceGrab,release:grabEnd,gesture:checkStableGesture,
  setHeld:(h)=>{held=h;},getHeld:()=>held,setRoot:(m)=>{root=m;},
  getGestureIndicator:()=>voiceBadge,getMascotUntil:()=>mascotSpeechUntil};`);
let spoken=[],notices=[];
const win={FreeLab:{pref:(name)=>name==='spoken',speakUpdate:(text)=>spoken.push(text),notify:(text)=>notices.push(text),traceEvent:()=>{}}};
const performance={now:()=>1000};
vm.runInNewContext(src,{window:win,performance,console,Math,Map,WeakMap});
const xr=win.FreeLabXR;
const root=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
xr.setRoot(new Float32Array(root));
const card={kind:'source',canvasHeight:420,front:true,back:true,visible:true,
 pos:[0,0,-1],size:[.88,.63],scale:1,q:[0,0,0,1],id:'image'};
function hit(x,y,cardOverride=card){
 const hit=xr.hitTest({o:[x*.88,y*.63,0],d:[0,0,-1]},cardOverride);
 if(!hit)throw Error('XR ray did not hit card at x='+x+', y='+y);
 return xr.hit(hit);
}
function check(c,m){if(!c)throw Error(m);}
check(hit(-.30,.38)==='extract','Image EXTRACT badge does not activate');
check(hit(.28,.38)==='imagemenu','Image three-dot badge does not activate');
check(hit(.41,.38)==='imageclose','Image X does not activate');
check(hit(-.30,.10)===null,'Clicking photo itself must not Extract');
const tall={...card,canvasHeight:1080,size:[.54,1.05]};
function tallHit(x,py){let y=.5-py/tall.canvasHeight;
 let r={o:[x*tall.size[0],y*tall.size[1],0],d:[0,0,-1]};
 return xr.hit(xr.hitTest(r,tall));}
check(tallHit(-.30,55)==='extract','Portrait Extract badge');
check(tallHit(.28,55)==='imagemenu','Portrait menu badge');
check(tallHit(.41,55)==='imageclose','Portrait close badge');
// A live controller orientation change must not transform an armed button into a drag.
const input={targetRaySpace:{}};
let angle=Math.PI/4;const transform={matrix:new Float32Array(root),orientation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}};
const frame={getPose:()=>({transform})};
xr.setHeld({src:input,id:'extract',card,rayDist:1,anchor:[0,0,-1],start:0,
 moved:false,startQuat:[0,0,0,1],initialQuat:[0,0,0,1]});
xr.drag(frame);
check(!xr.getHeld().moved,'Controller rotation incorrectly dragged a pressed button');
check(card.q[1]===0,'Controller rotation incorrectly rotated a pressed button');
(async()=>{await xr.release(input,frame);
 check(notices.some(x=>x.includes('Capture a real photo first')),'Extract action lost on trigger release');
 // Stable poses should speak only from mascot and should not show a head-locked gesture alert.
 xr.gesture('right','Thumbs up',1000);xr.gesture('right','Thumbs up',2000);
 xr.gesture('left','OK',2500);xr.gesture('left','OK',3500);
 check(spoken.length===1,'Gestures should be globally rate-limited');
 check(xr.getGestureIndicator()===null,'Gesture must not open microphone HUD');
 console.log('XR card controls, controller rotation and quiet gesture tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        res=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=20)
        self.assertEqual(res.returncode,0,res.stderr or res.stdout)

if __name__=='__main__':unittest.main()
