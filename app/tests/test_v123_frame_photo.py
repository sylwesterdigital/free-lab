"""v0.10.23: FRAME photo orientation/crop/grab regression; no Quest or paid calls."""
import subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
HTML=(ROOT/'frontend/index.html').read_text()

class PhotoFrame123(unittest.TestCase):
 def test_projected_crop_and_panel_contact_geometry(self):
  code=r'''
  const a=require('./frontend/assets/frame-photo.js'),assert=require('node:assert/strict');
  const corners=[[-.3,.22,-2],[.3,.22,-2],[.3,-.22,-2],[-.3,-.22,-2]];
  const id=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const proj=[2,0,0,0,0,2,0,0,0,0,-1,-1,0,0,-1,0];
  const view={projectionMatrix:proj,transform:{inverse:{matrix:id}}};
  const crop=a.projectedCrop(corners,[view,view]);
  assert.ok(crop);assert.ok(crop.x>.25&&crop.x<.5);assert.ok(crop.width<.6);
  assert.ok(crop.height<.6);assert.ok(crop.calibration.startsWith('approximate'));
  const r=a.cropRect(crop,1200,900);
  assert.ok(r.sw<1200&&r.sh<900);assert.ok(r.sw>20&&r.sh>20);
  assert.ok(Math.abs(r.sw/r.sh-a.frameAspect(corners))<.02);
  assert.ok(a.panelContact([0,0,-2.05],corners));
  assert.equal(a.panelContact([0,0,-2.4],corners),null);
  assert.equal(a.panelContact([2,2,-2],corners),null);
  const left=a.projectedCrop(corners,[view]);assert.ok(left.width<1);
  assert.equal(a.projectedCrop(corners,[]),null);
  '''
  r=subprocess.run(['node','-e',code],cwd=ROOT,capture_output=True,text=True,timeout=15)
  self.assertEqual(r.returncode,0,r.stderr)
 def test_frame_uses_cropped_jpeg_and_top_first_uv(self):
  self.assertIn('frame-photo.js?v=0.10.23',HTML)
  self.assertIn('window.FreeLabFramePhoto?.projectedCrop(placed.corners,latestPose?.views||[])',XR)
  self.assertIn('window.FreeLab.saveXRFrame(region)',XR)
  self.assertIn('window.FreeLabFramePhoto?.cropRect(crop,video.videoWidth,video.videoHeight)',APP)
  self.assertIn('drawImage(video,bounds.sx,bounds.sy,bounds.sw,bounds.sh',APP)
  self.assertIn('[[0,0,0],[1,1,0],[2,1,1],[0,0,0],[2,1,1],[3,0,1]]',XR)
  self.assertIn("if(typeof options==='function')options(image)",APP)
  self.assertIn('frameNearestGrab(index)',XR)
  self.assertIn('panelContact(p,f.corners,.15)',XR)
  self.assertIn('FRAME PHOTO',XR)
 def test_saved_photo_moves_with_frame_and_is_disposed(self):
  self.assertIn('item.frame.corners',XR)
  self.assertIn('frameLab?.frames?.includes(item.frame)',XR)
  self.assertIn('gl.deleteTexture(item.texture);gl.deleteBuffer(item.buffer);framePhotos.splice(i,1)',XR)
  self.assertIn('FreeLabFrameLab.transformGrab',XR)
  self.assertIn('PHOTO / FRAME GRABBED',XR)

if __name__=='__main__':unittest.main()
