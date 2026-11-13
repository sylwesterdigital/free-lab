"""v0.9.9 contract and geometry tests, offline / no model billing."""
import json
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
UI=(ROOT/'frontend/assets/app.js').read_text()
BACK=(ROOT/'backend/app.py').read_text()

class CameraAndSegmentation099(unittest.TestCase):
 def test_camera_has_clear_readiness_states(self):
  for text in ('CAMERA OFF  ·  PRESS THE EYE TO ENABLE',
               'CAMERA ON  ·  PRESS THE EYE TO CAPTURE',
               'SAVING CAPTURE  ·  PLEASE WAIT',
               'PHOTO READY  ·  PRESS ✳ TO EXTRACT',
               'Camera ENABLED'.upper()):
   self.assertIn(text,XR)
  self.assertIn('function liveCameraState(){',XR)
  self.assertIn("track?.readyState==='live'&&!track.muted&&video?.videoWidth>0",XR)
  self.assertIn("ctx.createRadialGradient(160,160,93,160,160,149)",XR)
  self.assertIn("kind:'status',size:[.47,.071]",XR)
  self.assertIn("if(!cameraLive){",XR)
  self.assertIn("XR capture always samples the current live camera",UI)
  self.assertIn('if(cameraHint)drawCard(cameraHint,vp)',XR)
 def test_one_capture_animation_only_after_save(self):
  block=XR.split('async function makeCapture(){',1)[1].split('function bloomChildren(',1)[0]
  self.assertEqual(block.count('const card=sourceCard({...data,decodedImage:decoded});'),1)
  self.assertEqual(block.count('animate(card,card.pos,0,980);'),1)
  self.assertNotIn('pending=addCard',block)
  self.assertLess(block.index('await window.FreeLab.saveXRFrame()'),block.index('const card=sourceCard({...data,decodedImage:decoded});'))
  self.assertIn('SAVE FAILED:',block)
  self.assertIn('await decoded.decode()',block)
  self.assertIn('sourceCard({...data,decodedImage:decoded})',block)
 def test_nested_segmentation_scoped_to_parent_owner(self):
  segment=BACK.split('@app.post(\'/api/segment\')',1)[1].split("@app.get('/api/captures')",1)[0]
  self.assertIn("parent_id=v.get('object_id')",segment)
  self.assertIn('id=? AND capture_id=? AND owner_id=?',segment)
  self.assertIn("shelf!=?",segment)
  self.assertIn("raw=source.read_bytes()",segment)
  self.assertIn('parent_object_id,operation',segment)
  self.assertIn("'segmentation'",segment)
  self.assertIn('payload.object_id=objectId',UI)
  self.assertIn('else payload.image=state.snapshot',UI)
  self.assertIn('segmentXR(cloud.id,noun,item.id)',XR)
  self.assertIn('recognizeXR(cloud.id,id)',XR)
  self.assertIn('payload.object_id=objectId',UI)
  self.assertIn('nested_extraction',BACK)
  self.assertIn("case 'segment':return selected?.kind==='source'?runExtract():extractParts()",XR)
  self.assertIn("['segment','✳']",XR)
 def test_upward_forward_and_camera_facing_geometry(self):
  script=r'''const vm=require('vm'),fs=require('fs');
const src=fs.readFileSync('frontend/assets/xr.js','utf8').replace(
  'window.FreeLabXR={start,isRunning:()=>!!session};',
  `window.FreeLabXR={ringPosition,facingQuat,faceCloudCards,setScene:(m,c)=>{root=m;rootYaw=0;cards=c;},getCards:()=>cards};`);
const w={FreeLab:{notify:()=>{},pref:()=>false}};
vm.runInNewContext(src,{window:w,performance:{now:()=>1000},Math,console,WeakMap,Map});
const xr=w.FreeLabXR;const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
xr.setScene(identity,[]);
for(let i=0;i<10;i++){const p=xr.ringPosition(i,10);if(!(p[1]>.4&&p[2]>.03))throw Error('Card behind or below photo '+i+': '+p);}
const object={kind:'object',pos:[-.55,.5,.17],q:[0,0,0,1],scale:1,visible:true};
xr.setScene(identity,[object]);
// Head moves right; card should rotate towards it rather than preserve the capture's old yaw.
const pose={transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,1,0,.3,1]}};
for(let i=0;i<40;i++)xr.faceCloudCards(pose,i*16);
const yaw=2*Math.atan2(object.q[1],object.q[3]);
const desired=Math.atan2(1.55,.13);if(Math.abs(yaw-desired)>.05)throw Error('Card does not face viewer: '+yaw);
console.log('Upper fan and upright camera-facing geometry passed');'''
  r=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=15)
  self.assertEqual(r.returncode,0,r.stderr or r.stdout)
 def test_release_manifest_marker(self):
  self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.7')
  self.assertIn('function extractionAvailable()',XR)

if __name__=='__main__':unittest.main()
