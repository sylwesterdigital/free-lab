"""Regression: camera video cannot occupy the Extract button (no GPU or paid requests)."""
import subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
class XR097Preview(unittest.TestCase):
 def test_three_controls_and_disjoint_live_camera_preview(self):
  script=r'''
const fs=require('fs'),vm=require('vm');
const code=fs.readFileSync('frontend/assets/xr.js','utf8').replace(
 'window.FreeLabXR={start,isRunning:()=>!!session};',
 `window.FreeLabXR={syncTrackedUI,extractionAvailable,pick,buttonFromHit,
 setState:(data)=>{captureEye=data.eye;voiceButton=data.voice;extractButton=data.extract;cameraPreview=data.preview;cloud=data.cloud;cards=data.cards;},
 get:()=>({eye:captureEye,voice:voiceButton,extract:extractButton,preview:cameraPreview})};`);
const w={FreeLab:{}};vm.runInNewContext(code,{window:w,console,performance:{now:()=>1000},Map,WeakMap});
const xr=w.FreeLabXR;
const center=[0,1.25,-1.05],eye={kind:'captureeye',pos:[...center],q:[0,0,0,1],size:[.099,.099],scale:1,front:true,visible:true};
const voice={kind:'voiceroundel',pos:[0,0,0],q:[0,0,0,1],size:[.089,.089],scale:1,front:true,visible:true};
const extract={kind:'extractroundel',pos:[0,0,0],q:[0,0,0,1],size:[.089,.089],scale:1,front:true,visible:true};
const preview={kind:'capturepreview',pos:[0,0,0],q:[0,0,0,1],size:[.29,.19],scale:1,front:true,visible:true};
const photo={kind:'source',pos:[0,0,-1.42],front:true,visible:true};
xr.setState({eye,voice,extract,preview,cloud:null,cards:[]});
const pose={transform:{matrix:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1.43,0,1])}};
xr.syncTrackedUI(pose,1000);
const c=xr.get();
if(!c.extract.visible)throw Error('Extract disappears when camera is active');
if(xr.extractionAvailable())throw Error('Extract must be disabled until capture');
const dy=c.preview.pos[1]-c.extract.pos[1];
const minGap=dy-(c.preview.size[1]+c.extract.size[1])*.5;
if(minGap<.045)throw Error('LIVE camera preview overlays the Extract control: gap='+minGap);
if(Math.abs(c.extract.pos[0]-c.eye.pos[0]-.163)>.0001)throw Error('Right Extract position was moved');
// Camera preview is NEVER a click target; the segmentation roundel retains its action.
const r={o:[c.extract.pos[0],c.extract.pos[1],0],d:[0,0,-1]};
const hit=xr.pick(r);if(!hit||hit.card.kind!=='extractroundel'||xr.buttonFromHit(hit)!=='extract')throw Error('Segmentation hit target blocked');
xr.setState({eye,voice,extract,preview,cloud:{legacy:false,collapsed:false},cards:[photo]});
xr.syncTrackedUI(pose,1016);
if(!xr.extractionAvailable()||!xr.get().extract.visible)throw Error('Available Extract must be visible after photo');
if(xr.get().preview.visible)throw Error('Camera preview should hide after photo becomes active');
'''
  r=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=20)
  self.assertEqual(r.returncode,0,r.stderr or r.stdout)
 def test_preview_is_not_in_pick_targets(self):
  fn=XR[XR.index('function pick(r)'):XR.index('function imageButtonAt(')]
  self.assertNotIn('cameraPreview',fn)
  self.assertIn("const inactive=kind==='extract'&&!extractionAvailable();",XR)
if __name__=='__main__':unittest.main()
