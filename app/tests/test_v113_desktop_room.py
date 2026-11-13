"""Desktop room: continuous Three.js scene, authenticated image tree and pose transport."""
from pathlib import Path
import subprocess,unittest
ROOT=Path(__file__).resolve().parents[1]

class DesktopRoom113(unittest.TestCase):
 def test_room_viewer_is_threejs_with_independent_frame_loop(self):
  js=(ROOT/'frontend/assets/room-viewer.mjs').read_text()
  for expected in ('THREE','three.module.js','WebGLRenderer','requestAnimationFrame(tick)',
                   'PerspectiveCamera','GridHelper','Raycaster','new T.Vector3','setState(payload,rid,room)',
                   'createRoomViewer','keydown','pointermove','ArrowLeft','setPixelRatio',
                   'intersectObjects','roomInspectDescription','rebuildLinks','roomControlMode'):
   self.assertIn(expected,js)
  self.assertNotIn("getContext('2d')",(ROOT/'frontend/assets/rooms.js').read_text())
 def test_old_canvas_is_now_full_viewport_threejs_with_inspector(self):
  html=(ROOT/'frontend/index.html').read_text();css=(ROOT/'frontend/assets/style.css').read_text()
  for phrase in ('id="roomCanvas"','id="roomInspector"','id="roomInspectDescription"',
                 'id="roomInspectRelatives"','id="roomControlMode"','id="roomControlFit"',
                 'id="roomImageLightbox"'):
   self.assertIn(phrase,html)
  self.assertIn('#roomCanvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important',css)
 def test_published_images_keep_perspective_and_metadata_without_camera_pixels(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  backend=(ROOT/'backend/app.py').read_text();rooms=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('q:worldCardQuat(c)',xr)
  self.assertIn('q.x,q.y,q.z,q.w',xr)
  self.assertIn('def quaternion(q)',backend)
  self.assertIn('Invalid card orientation',backend)
  self.assertIn('Invalid headset orientation',backend)
  self.assertIn("('object',row['id']):dict(row)",backend)
  self.assertIn("'description':row['description']",backend)
  self.assertIn("r=_room_access(rid)",backend)
  self.assertIn("roomId",(ROOT/'frontend/assets/room-viewer.mjs').read_text())
  self.assertIn('lastSent<250',rooms)
  self.assertIn('350',rooms)
  self.assertNotIn('cameraPixels',rooms)
 def test_node_module_parses_and_exports_viewer(self):
  for name in ('rooms.js','room-viewer.mjs','xr.js'):
   result=subprocess.run(['node','--check',str(ROOT/'frontend/assets'/name)],capture_output=True,text=True,timeout=10)
   self.assertEqual(result.returncode,0,result.stderr)
  code="import(process.argv[1]).then(m=>{if(typeof m.createRoomViewer!=='function')throw Error('Missing viewer')})"
  result=subprocess.run(['node','--input-type=module','-e',code,str(ROOT/'frontend/assets/room-viewer.mjs')],capture_output=True,text=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
