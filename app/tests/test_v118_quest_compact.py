"""Regression guards for v0.10.57. No network, headset, camera, or paid API calls."""
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
  self.assertIn("new XRWebGLLayer(session,gl,{alpha:true,antialias:attempt.antialias,depth:true,stencil:false,framebufferScaleFactor:attempt.scale})",XR)
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
  self.assertIn("const objects=state.objects.filter",JS)
  self.assertIn("id=\"archiveMediaNav\"",HTML)
  self.assertIn("data-media=\"3d\"",HTML)
  self.assertIn("function archiveModelCard(job){",JS)
  self.assertIn('object-overlay',JS)
  self.assertIn("el('details','object-menu')",JS)
  self.assertIn('galleryAI(action)',JS)
  self.assertIn("addEventListener('touchstart'",JS)
  self.assertIn("addEventListener('touchend'",JS)
  self.assertIn('offset=-10;offset<=10;offset++',JS)
  self.assertIn('#desktopGallery .gallery-stage>button{position:absolute',CSS)

 def test_release_versions(self):
  for name in ('version.json','frontend/version.json','changelog.json','frontend/changelog.json'):
   self.assertEqual(json.loads((ROOT/name).read_text())['version'],'0.10.57')
  self.assertIn('room-viewer.mjs?v=0.10.57',ROOMS)
  self.assertIn('xr.js?v=0.10.57',HTML)

if __name__=='__main__': unittest.main()

"""v0.10.57 Agency XR regression checks: independent labs, text aspect, focus and reachable play."""
import unittest
from pathlib import Path
XR=(Path(__file__).resolve().parents[1]/'frontend/assets/xr.js').read_text()
SOUND=(Path(__file__).resolve().parents[1]/'frontend/assets/sound.js').read_text()
class AgencySpatial55(unittest.TestCase):
    def test_no_legacy_lab_launcher_in_my_stuff(self):
        self.assertIn("xrExperience='agency-lab'", XR)
        self.assertIn('function renderAgencyLab(',XR)
        self.assertIn('function agencyEnterLab(mode)',XR)
        self.assertIn("if(xrExperience==='agency-lab'){renderAgencyLab(t,frame,pose);return;}",XR)
        self.assertNotIn('poll3d(t);pollLabSelector(frame,t,pose)',XR)
        self.assertNotIn('labSelector=new window.FreeLabLabSelector.Selector()',XR)
        self.assertIn("function activeLabMode(){return xrExperience==='agency-lab'?agencyLabMode:null;}",XR)
        self.assertIn("if(activeLabMode()!=='sort'||!shapeTargets.length)return;",XR)
        self.assertNotIn("agencyLaunchMode=id.split(':')[1];beginAgencyTransition('stuff'",XR)
    def test_large_icon_only_navigation_and_proportional_type(self):
        self.assertIn('iconOnly ? 1.72 : pill',XR)
        self.assertIn('ratio:w/h',XR)
        self.assertIn('const pxW=1440,pxH=Math.round(pxW*h/Math.max(w,.01))',XR)
        self.assertIn('if(iconOnly){const factor=',XR)
        self.assertIn('SELECT AN ACTIVITY',XR)
        self.assertIn('drawFittedText(',XR)
        self.assertIn('agencyFollow',XR)
        self.assertIn('freezeForwardUntil',XR)
    def test_games_direct_and_reachable_with_single_agency_return(self):
        self.assertIn("if(id.startsWith('agency-game:')){agencyGame=id.split(':')[1];agencyMode='free';agencyLevel=0;agencyStartGame()", XR)
        self.assertIn("agencyNavCard('agency-return','AGENCY'",XR)
        self.assertIn("agencyUiCard('agency-drag','MOVE'",XR)
        self.assertIn("agencyNode('agency-answer:'+value",XR)
        self.assertIn("agencyUiCard('answer-text:'+value",XR)
        self.assertIn('agencyHandSeed',XR)
        self.assertIn('agencyThrow',XR)
        self.assertNotIn("agencyNavCard('agency-mystuff'",XR)
    def test_transition_safety_and_table_memory(self):
        for token in ('function agencyCanInteract(', 'agencyInputUntil', 'agencyTouchWait',
                      'agencyPendingRoundAt=performance.now()+920',
                      'agencySavedTable={pos:', 'agencyLock(1050',
                      "agencyUiCard('agency-drag','MOVE'", "icon:'grab-hand'",
                      'agencyExitConfirmUntil','agencyProfileCard()','agencyPaintTransition(vp,t)'):
            self.assertIn(token,XR)
        self.assertIn("agencyNavCard('agency-mode-next'",XR)
        self.assertIn("agencyNavCard('agency-return','AGENCY'",XR)
    def test_audio_feedback(self):
        for key in ('agency-correct','agency-wrong'):
            self.assertIn(key,SOUND)
        self.assertIn("cue(result.correct?'agency-correct':'agency-wrong')",XR)

