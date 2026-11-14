"""FREELAB v0.10.23: source-only regressions. Never contacts paid providers."""
import json,re,tempfile,unittest
from pathlib import Path
from backend import db,model_cache,glb_preview
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'frontend/index.html').read_text()
CAP=(ROOT/'frontend/assets/capture-studio.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
VIEWER=(ROOT/'frontend/assets/model-stage.mjs').read_text()
BACK=(ROOT/'backend/app.py').read_text()
WATCH=(ROOT.parent/'watch-free-lab.sh').read_text() if (ROOT.parent/'watch-free-lab.sh').exists() else ''

class InlineModelAvatar122(unittest.TestCase):
 def test_send_from_composer_without_second_editor(self):
  self.assertIn("default:await submitImageEdit(text)",CAP)
  self.assertIn("case 'refine':await refineImage(text)",CAP)
  self.assertIn("const result=await FL().promptXR(item.cid,item.oid||null,text)",CAP)
  self.assertIn("window.FreeLabModelStage?.open(jobId)",CAP)
  self.assertNotIn('FL().openPromptEditor(',CAP)
  self.assertIn('id="galleryComposer"',HTML)
  self.assertIn('galleryComposerSubmit',APP)
  self.assertIn("status.classList.add('working')",APP)
 def test_real_3d_stage_and_private_bounded_cache(self):
  self.assertIn('GLTFLoader()',VIEWER)
  self.assertIn('geometryFallback',VIEWER)
  self.assertIn('requestAnimationFrame(frame)',VIEWER)
  self.assertIn('id="modelStageCanvas"',HTML)
  self.assertIn('View in 3D',APP)
  self.assertEqual(model_cache.MAX_MODEL,32_000_000)
  self.assertEqual(glb_preview.MAX_FILE,32_000_000)
  self.assertIn("@app.get('/api/media/3d/<int:jid>/asset')",BACK)
  self.assertIn("@app.get('/api/media/3d/<int:jid>/preview')",BACK)
 def test_small_avatar_migrates_without_data_loss(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'user.sqlite';db.init(path)
   with db.connect(path) as con:
    uid=db.create_user(con,'avataruser','long-strong-password')
    con.execute('INSERT INTO user_avatar_models(user_id,glb) VALUES(?,?)',(uid,b'glTF'+b'0'*16))
   db.init(path)
   with db.connect(path) as con:
    self.assertEqual(con.execute('SELECT glb FROM user_avatar_models WHERE user_id=?',(uid,)).fetchone()['glb'],b'glTF'+b'0'*16)
 def test_avatar_ownership_and_model_limit(self):
  for route in ("@app.put('/api/me/avatar-3d')","@app.get('/api/me/avatar-3d')","@app.delete('/api/me/avatar-3d')","@app.get('/api/me/avatar-3d/preview')","@app.get('/api/rooms/<int:rid>/avatar/<int:uid>/preview')"):
   self.assertIn(route,BACK)
  self.assertIn('MAX_AVATAR_GLB=2_000_000',BACK)
  self.assertIn('valid_avatar_glb(raw)',BACK)
  self.assertIn('_room_access(rid)',BACK)
  self.assertIn('profile3DAvatarInput',HTML)
  self.assertIn('profile3DAvatarInput',APP)
  self.assertIn('spawnGuestAvatar(',XR)
 def test_frame_uses_camera_pixels_not_xr_compositor(self):
  self.assertIn('async function captureFrameCamera(frame,crop)',XR)
  self.assertIn('window.FreeLab?.cameraFrameReady?.()',XR)
  self.assertIn('void captureFrameCamera(placed,bounds)',XR)
  self.assertIn('drawFramePhotos(vp)',XR)
  self.assertIn('getVideoTracks',APP)
  self.assertNotIn('gl.readPixels(',XR)
 def test_controls_and_downloads(self):
  self.assertIn('followOffset=[0,-.85,-1.16]',XR)
  self.assertIn('poseForwardAnchor(pose,1.04,-.49)',XR)
  self.assertIn('[[darkPrevious,.02],[darkNext,.16],[darkClose,.30]]',XR)
  self.assertIn('data-capture-tool="download"',HTML)
  self.assertIn('data-gallery-action="download"',HTML)
  self.assertIn('downloadImage(',APP)
  self.assertIn('as_attachment=request.args.get(\'download\')==\'1\'',BACK)
 def test_watcher_nul_status_and_release_consistency(self):
  if WATCH:
   self.assertIn("VERSION='0.9.2'",WATCH)
   self.assertIn("'--porcelain=v1','-z'",WATCH)
   self.assertIn(".stdout.split('\\0')",WATCH)
  for file in ('version.json','frontend/version.json','changelog.json','frontend/changelog.json'):
   self.assertEqual(json.loads((ROOT/file).read_text())['version'],'0.10.23')
  for src in re.findall(r'(?:src|href)="(/assets/[^"]+)"',HTML):
   self.assertTrue((ROOT/'frontend'/src.split('?')[0].lstrip('/')).is_file(),src)
if __name__=='__main__':unittest.main()
