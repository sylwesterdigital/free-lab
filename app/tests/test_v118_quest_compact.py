"""Regression guards for v0.10.22. No network, headset, camera, or paid API calls."""
import json
import re
import unittest
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'frontend/index.html').read_text()
JS=(ROOT/'frontend/assets/app.js').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
CAP=(ROOT/'frontend/assets/capture-studio.js').read_text()
ROOMS=(ROOT/'frontend/assets/rooms.js').read_text()
VIEW=(ROOT/'frontend/assets/room-viewer.mjs').read_text()
CSS=(ROOT/'frontend/assets/style.css').read_text()

class Ids(HTMLParser):
 def __init__(self):super().__init__();self.ids=[]
 def handle_starttag(self,tag,attrs):
  for k,v in attrs:
   if k=='id':self.ids.append(v)

class QuestCompact118(unittest.TestCase):
 def test_html_unique_ids_and_asset_links(self):
  parser=Ids();parser.feed(HTML)
  self.assertEqual(len(parser.ids),len(set(parser.ids)))
  for asset in re.findall(r'(?:src|href)="(/assets/[^\"]+)"',HTML):
   path=asset.split('?',1)[0].lstrip('/')
   self.assertTrue((ROOT/'frontend'/path).is_file(),asset)

 def test_browser_xr_session_requested_first_and_no_dom_overlay(self):
  start=XR.split('async function start(options={})',1)[1].split('window.FreeLabXR={',1)[0]
  self.assertLess(start.index("requestSession('immersive-ar'"),start.index('try{setup();'))
  self.assertNotIn("'dom-overlay'",start)
  self.assertNotIn('domOverlay:{root:',start)
  self.assertIn("optionalFeatures:['local-floor','hand-tracking']",start)
  self.assertIn("options.requireDepth?{depthSensing:",start)
  self.assertIn('await gl.makeXRCompatible()',start)
  self.assertIn('await failed?.end()',start)

 def test_quest_gpu_safety(self):
  self.assertIn("getContext('webgl2'",XR)
  self.assertIn("webglcontextlost",XR)
  self.assertIn("new XRWebGLLayer(session,gl,{alpha:true,antialias:false,depth:true,stencil:false,framebufferScaleFactor:.8})",XR)
  self.assertIn('gl.isContextLost()',XR)
  self.assertIn('/OculusBrowser|Quest|Oculus/i.test(navigator.userAgent)',(ROOT/'frontend/assets/scene.mjs').read_text())

 def test_non_xr_has_actual_private_3d_not_fake_ar(self):
  self.assertIn("canXR?'XR':'3D'",JS)
  self.assertIn('FreeLabRooms.previewLocal()',JS)
  method=ROOMS.split('async function previewLocal()',1)[1].split('function leave()',1)[0]
  self.assertIn('FreeLab.listXRClouds()',method)
  self.assertIn('v.setState(',method)
  self.assertNotIn('start(visibility)',method)
  self.assertIn("card.image_url||'/api/rooms/'",VIEW)

 def test_capture_tools_visible_on_image_with_chat_and_context_menu(self):
  for id in ('captureQuickActions','captureQuickVoice','captureQuickEye','captureQuickExtract','captureCommandForm','captureCommandMode','captureCommandText','captureMorePanel','captureGridToggle'):
   self.assertIn('id="'+id+'"',HTML)
  self.assertNotIn('Advanced camera and legacy controls',HTML)
  self.assertIn("panel.append(legacy)",CAP)
  self.assertIn("FL().recognizeXR(",CAP)
  self.assertIn("FL().segmentXR(",CAP)
  self.assertIn("FL().describeXR(",CAP)
  self.assertIn('function applyView()',CAP)
  self.assertIn("state.snapshotOrigin==='upload'",CAP)
  self.assertIn("if(item.type==='capture')requestedCapture=null",CAP)
  self.assertIn("$('cameraVideo').classList.add('hidden')",CAP)
  self.assertIn("$('previewImage').classList.add('hidden')",CAP)
  self.assertIn("function beginNew()",CAP)
  self.assertIn('window.FreeLabDialog.confirm(',CAP)

 def test_collection_actions_compact_filter_gallery_swipe(self):
  self.assertIn('id="collectionSearch"',HTML)
  self.assertIn('id="galleryToolMenu"',HTML)
  self.assertIn("$('collectionSearch').addEventListener('input',renderObjects)",JS)
  self.assertIn("const visible=state.objects.filter",JS)
  self.assertIn('object-overlay',JS)
  self.assertIn("el('details','object-menu')",JS)
  self.assertIn('galleryAI(action)',JS)
  self.assertIn("addEventListener('touchstart'",JS)
  self.assertIn("addEventListener('touchend'",JS)
  self.assertIn('offset=-10;offset<=10;offset++',JS)
  self.assertIn('#desktopGallery .gallery-stage>button{position:absolute',CSS)

 def test_release_versions(self):
  for name in ('version.json','frontend/version.json','changelog.json','frontend/changelog.json'):
   self.assertEqual(json.loads((ROOT/name).read_text())['version'],'0.10.22')
  self.assertIn('room-viewer.mjs?v=0.10.22',ROOMS)
  self.assertIn('xr.js?v=0.10.22',HTML)

if __name__=='__main__': unittest.main()
