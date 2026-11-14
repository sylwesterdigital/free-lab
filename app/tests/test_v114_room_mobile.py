"""Release v0.10.16: MIME gate, mobile capture parity and readable spatial labels."""
from pathlib import Path
import json,re,sqlite3,tempfile,unittest,subprocess
from backend import db
from deploy import install
ROOT=Path(__file__).resolve().parents[1]

class RoomMobile114(unittest.TestCase):
 def test_all_es_modules_use_explicit_javascript_type(self):
  nginx=install.NGINX
  self.assertIn('location ~ \\.mjs$',nginx)
  self.assertIn('types { application/javascript mjs; }',nginx)
  self.assertIn('default_type application/javascript;',nginx)
  self.assertIn('verify_local_es_modules()', (ROOT/'deploy/install.py').read_text())
  # The watcher is a repository-root deployment tool, not part of the
  # application directory copied to /var/www/.../releases/vX.Y.Z.
  # Validate watcher content when present in the developer/ZIP staging tree;
  # never require it on the deployed Ubuntu application filesystem.
  watcher_path=ROOT.parent/'watch-free-lab.sh'
  if watcher_path.is_file():
   watcher=watcher_path.read_text()
   self.assertIn("'assets/room-viewer.mjs'",watcher)
   self.assertIn("VERSION='0.9.1'",watcher)
 def test_webgl_loop_and_fixed_size_spatial_labels(self):
  rooms=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('/assets/room-viewer.mjs?v=0.10.16',rooms)
  room=(ROOT/'frontend/assets/room-viewer.mjs').read_text()
  for phrase in ('requestAnimationFrame(tick)','renderer.render(scene,camera)','updateScreenLabels()','screenPoint.project(camera)','roomFPS','roomLabels','roomInspectDescription'):
   self.assertIn(phrase,room)
  css=(ROOT/'frontend/assets/style.css').read_text()
  self.assertIn('.room-world-label strong{font-size:clamp(',css)
  self.assertIn('#roomCanvas{position:absolute!important;',css)
 def test_mobile_capture_has_real_workflow_and_explicit_cost_guard(self):
  js=(ROOT/'frontend/assets/capture-studio.js').read_text()
  for phrase in ("FL().listXRClouds()","/captures'","FL().recognizeXR(","FL().segmentXR(","FL().describeXR(","FL().openPromptEditor(","FL().createXR3D(","FL().resumeCamera()", "window.confirm(", "captureShutter"):
   self.assertIn(phrase,js)
  self.assertNotIn('setInterval(',js)
  for value in ('captureShutter','captureTree','captureSelection','captureRefineApply','captureVoice','captureMake3D'):
   self.assertIn('id="'+value+'"',(ROOT/'frontend/index.html').read_text())
 def test_xr_menu_is_white_by_default_pink_hover_and_theater_transparent(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn('active?p.accent:p.text',xr)
  self.assertIn('spatialCaptionTexture(',xr)
  self.assertIn('dist/1.25',xr)
  self.assertNotIn("rrect(ctx,fullWidth-90,h-96,61,61,18,'#283b32')",xr)
 def test_profile_photo_schema_is_non_destructive_and_private(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'existing.sqlite3';db.init(path)
   with db.connect(path) as con:
    uid=db.create_user(con,'tester','Long-password-1234')
    con.execute("INSERT INTO user_avatars(user_id,mime,pixels) VALUES(?,?,?)",(uid,'image/jpeg',b'photo-data'))
   db.init(path)
   with db.connect(path) as con:
    self.assertEqual(con.execute('SELECT mime FROM user_avatars WHERE user_id=?',(uid,)).fetchone()[0],'image/jpeg')
  back=(ROOT/'backend/app.py').read_text()
  self.assertIn("@app.put('/api/me/avatar')",back)
  self.assertIn("@app.get('/api/me/avatar')",back)
  self.assertIn("@require_user",back)
 def test_release_metadata_and_brand_cleanup(self):
  page=(ROOT/'frontend/index.html').read_text()
  self.assertIn('WORKWORK.FUN',page)
  self.assertIn('github.com/sylwesterdigital/free-lab',page)
  self.assertIn('brand-version',page)
  for legacy in ('FREELAB LABORATORY © 2026','BUILT FOR CURIOSITY','LIVE EXPERIMENT /'):
   self.assertNotIn(legacy,page)
  self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.16')
 def test_frontend_syntax(self):
  for f in ('room-viewer.mjs','scene.mjs','capture-studio.js','app.js','xr.js'):
   p=ROOT/'frontend/assets'/f
   r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True,timeout=8)
   self.assertEqual(r.returncode,0,r.stderr)

if __name__=='__main__':unittest.main()
