"""Regression guards for v0.10.72. No network, headset, camera, or paid API calls."""
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
   self.assertEqual(json.loads((ROOT/name).read_text())['version'],'0.10.72')
  self.assertIn('room-viewer.mjs?v=0.10.72',ROOMS)
  self.assertIn('xr.js?v=0.10.72',HTML)



"""v0.10.72 Agency XR regression checks: independent labs, text aspect, focus and reachable play."""
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
        self.assertIn("if(id.startsWith('agency-game:')){agencyGame=id.split(':')[1];agencyMode='free';agencyLevel=0;agencyShowExplainer(agencyGame,agencyStartGame)", XR)
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

# XR explainer, spatial capture, and lab colour-preview regression coverage.
import json
import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
PLAYER=(ROOT/'frontend/assets/agency-video.js').read_text()
WATCH_PATH=ROOT.parent/'watch-free-lab.sh'
INSTALL=(ROOT/'deploy/install.py').read_text()
PAGE=(ROOT/'frontend/index.html').read_text()

class AgencyMediaPlayback(unittest.TestCase):
 def run_node(self,code):
  r=subprocess.run(['node','-e',code],text=True,capture_output=True,timeout=25,cwd=ROOT)
  self.assertEqual(r.returncode,0,r.stdout+'\n'+r.stderr)
 def test_playlist_validation_and_user_first_play(self):
  self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};
const stored=new Map(),localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
const fetch=async(url,opts={})=>{
 const valid=url==='/videos/shape_garden/video_hls/index.m3u8';
 return {ok:true,headers:{get:()=>valid?'application/octet-stream':'text/html'},text:async()=>valid?'#EXTM3U\n#EXT-X-VERSION:3':'<!doctype html>'};
};
vm.runInNewContext(fs.readFileSync('frontend/assets/agency-video.js','utf8'),{window:w,localStorage,fetch,document:{},console});
(async()=>{
 const a=w.FreeLabAgencyMedia;
 if(a.folder('math')!=='number_flow'||a.folder('throw')!=='throw_lab')throw Error('Wrong published media folder');
 const first=await a.sources('shapes');
 if(!first.hls?.endsWith('/index.m3u8')||first.mp4)throw Error('HLS signature or MP4 HTML fallback not checked');
 const missing=await a.sources('math');if(missing.hls||missing.mp4)throw Error('SPA HTML mistaken for an HLS playlist');
 if(a.visited('shapes',42))throw Error('Explainer should be unseen at first login');
 a.remember('shapes',42);if(!a.visited('shapes',42)||a.visited('shapes',43))throw Error('Per-user explainer memory broken');
})().catch(e=>{console.error(e);process.exit(1)});''')
 def test_explainer_opens_before_network_and_missing_video_is_visible(self):
  # Execute the actual XR explainer state machine with an isolated mocked media
  # catalog. A missing playlist must not turn HOW TO PLAY into a silent no-op.
  self.run_node(r'''const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('frontend/assets/xr.js','utf8');
const code=source.slice(source.indexOf('function agencyVideoUser(){'),source.indexOf('function agencyProfileCard(){'));
let checks=0,launches=0,paints=0;
const media={visited:()=>false,stop:()=>{},remember:()=>{},urls:()=>({hls:'/videos/shape_garden/video_hls/index.m3u8'}),
 sources:async()=>{checks++;return {hls:null,mp4:null};}};
const ctx={window:{FreeLabAgencyMedia:media},session:{},xrExperience:'agency',agencyScreen:'play',
 agencyExplainer:null,agencyExplainerToken:0,gl:null,agencyCards:[],agencyLock:()=>{},agencyTelemetryPause:()=>{},
 agencyBuild:()=>{paints++;},console,Date,performance:{now:()=>10}};
vm.createContext(ctx);vm.runInContext(code,ctx);
ctx.agencyBuildVideoCards=()=>{paints++;};ctx.agencyVideoUpdateStatus=()=>{paints++;};
(async()=>{
 ctx.agencyShowExplainer('shapes');
 if(paints!==1||ctx.agencyScreen!=='explainer')throw Error('Missing immediate XR response to HOW TO PLAY');
 await new Promise(resolve=>setImmediate(resolve));
 if(ctx.agencyExplainer?.state!=='missing'||paints!==2)throw Error('Missing video not surfaced in XR panel');
 if(ctx.agencyExplainer?.failed)throw Error('No video should be a missing state, not playback failure');
 // The first visit may skip optional media rather than trap a new player.
 ctx.agencyShowExplainer('shapes',()=>launches++);
 await new Promise(resolve=>setImmediate(resolve));
 if(launches!==1||checks!==2)throw Error('Missing explainer blocked first-time game entry');
 media.sources=async()=>({hls:'/videos/shape_garden/video_hls/index.m3u8',mp4:null});
 media.play=async(_activity,_available)=>({ready:true,video:{}});
 ctx.agencyShowExplainer('shapes');
 await new Promise(resolve=>setImmediate(resolve));
 if(ctx.agencyExplainer?.state!=='playing')throw Error('Published video did not reach ready state');
})().catch(e=>{console.error(e);process.exitCode=1});''')
 def test_explainer_status_and_manual_retry_are_operable(self):
  self.assertIn("if(agencyScreen==='explainer'){agencyBuildVideoCards();return;}",XR)
  self.assertIn("state==='missing'?'VIDEO NOT PUBLISHED'",XR)
  self.assertIn('Publish your HLS or MP4, then tap RETRY VIDEO',XR)
  self.assertIn('./watch-free-lab.sh --sync-videos',XR)
  self.assertIn('agencyLoadExplainerMedia(++agencyExplainerToken)',XR)
  self.assertIn('returnScreen=launch?null:agencyScreen',XR)
  self.assertIn("if(launch&&media?.visited(activity,agencyVideoUser()))",XR)
  self.assertIn("if(entry.launch){agencyExplainer=null;agencyExplainerToken++;entry.launch();return;}",XR)
 def test_gpu_video_updates_only_for_new_decoded_frames(self):
  # The XR render loop may run at 72/90 Hz while the source is 30 fps.
  # A decoded frame is uploaded once; the texture is reused for the next.
  self.run_node(r'''const fs=require('fs'),vm=require('vm');
const full=fs.readFileSync('frontend/assets/xr.js','utf8');
const code=full.slice(full.indexOf('function agencyVideoFrame(){'),full.indexOf('function agencyVideoProgress('));
let alloc=0,updates=0,created=0,deleted=0;
const video={readyState:4,videoWidth:1280,videoHeight:720,currentTime:.5,getVideoPlaybackQuality:()=>({totalVideoFrames:1})};
const media={video,frameCallbackEnabled:true,frameSerial:1};
const card={id:'agency-video-image',front:null,back:null,resources:[],visible:false};
const gl={TEXTURE_2D:3553,TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,LINEAR:9729,
 TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,CLAMP_TO_EDGE:33071,RGBA:6408,UNSIGNED_BYTE:5121,
 createTexture:()=>{created++;return {id:created};},bindTexture:()=>{},texParameteri:()=>{},
 texImage2D:()=>alloc++,texSubImage2D:()=>updates++,deleteTexture:()=>deleted++};
const ctx={agencyExplainer:{state:'playing'},gl,agencyCards:[card],window:{FreeLabAgencyMedia:{current:media}},
 agencyFreeCards:xs=>xs.forEach(x=>(x.resources||[]).forEach(t=>gl.deleteTexture(t))),agencyVideoUpdateStatus:()=>{}};
vm.createContext(ctx);vm.runInContext(code,ctx);
ctx.agencyVideoFrame();if(alloc!==1||created!==1||updates!==0||!card.visible)throw Error('Initial video frame not uploaded');
ctx.agencyVideoFrame();if(alloc!==1||updates!==0)throw Error('Redundant upload without new decoded frame');
media.frameSerial=2;video.getVideoPlaybackQuality=()=>({totalVideoFrames:2});ctx.agencyVideoFrame();
if(alloc!==1||updates!==1)throw Error('Expected reused GPU texture for decoded frame');
video.videoWidth=640;video.videoHeight=360;ctx.agencyVideoFrame();
if(alloc!==2||updates!==1)throw Error('Resolution switch must reallocate texture');
const second={readyState:4,videoWidth:640,videoHeight:360,currentTime:0.5};media.video=second;media.frameSerial=0;
ctx.agencyVideoFrame();if(created!==2||deleted!==1||alloc!==3)throw Error('Video switch retained stale GPU texture');
ctx.agencyExplainer=null;ctx.agencyVideoFrame();if(alloc!==3)throw Error('Uploads persisted after explainer exit');
''')
 def test_video_surface_removed_without_depth_ghost(self):
  self.run_node(r'''const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('frontend/assets/xr.js','utf8');
const code=src.slice(src.indexOf('function agencyFreeCards('),src.indexOf('function agencyPaintTransition('));
const released=[];
const game={id:'agency-head',front:'title',resources:['title'],alpha:1};
const video={id:'agency-video-image',front:'movie',resources:['movie'],alpha:1};
const border={id:'agency-video-border',front:'edge',resources:['edge'],alpha:1};
const ctx={gl:{deleteTexture:t=>released.push(t)},performance:{now:()=>100},agencyFadingCards:[],
 agencyCards:[video,border,game],agencyNodes:[{}],entranceHover:null,agencyHoverId:null,agencyHoverInfo:null};
vm.createContext(ctx);vm.runInContext(code,ctx);ctx.agencyClearCards();
if(!released.includes('movie')||!released.includes('edge'))throw Error('Video GPU resources not released at dismissal');
if(ctx.agencyFadingCards.some(e=>e.card.id.startsWith('agency-video-')))throw Error('Invisible video stayed in transition');
if(ctx.agencyFadingCards.length!==1||ctx.agencyFadingCards[0].card.id!=='agency-head')throw Error('Other scene fade broken');
if(ctx.agencyCards.length||ctx.agencyNodes.length)throw Error('Dismissed player retains scene objects');
''')
  self.assertIn('if(color.a*uOpacity<.012)discard',XR)
  self.assertIn("if(c.kind==='agency')gl.depthMask(false)",XR)
 def test_decoder_callback_cancelled_on_media_stop(self):
  self.run_node(r'''const fs=require('fs'),vm=require('vm');
const script=fs.readFileSync('frontend/assets/agency-video.js','utf8');let callback=null,canceled=false,paused=false;
const video={style:{},setAttribute:()=>{},load:()=>{},play:async()=>{},pause:()=>{paused=true;},remove:()=>{},
 requestVideoFrameCallback:fn=>{callback=fn;return 9;},cancelVideoFrameCallback:id=>{if(id!==9)throw Error('Wrong callback');canceled=true;},
 canPlayType:()=>''};
const win={};const ctx={window:win,document:{body:{append:()=>{}},createElement:()=>video},localStorage:{},console};
vm.runInNewContext(script,ctx);
(async()=>{const a=win.FreeLabAgencyMedia;
 const state=await a.play('shapes',{hls:null,mp4:'/videos/shape_garden/video.mp4'});
 if(!state?.ready||!state.frameCallbackEnabled||!callback)throw Error('Decoded-frame callback missing');
 callback(0,{presentedFrames:7});if(state.frameSerial!==7)throw Error('Frame callback did not update serial');
 a.stop();if(!canceled||!paused||a.current!==null)throw Error('Decoder callback or media survived stop');
})().catch(e=>{console.error(e);process.exitCode=1});
''')
 def test_cube_preview_consistent_colour(self):
  self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const engine=new w.FreeLabFrameGames.Engine();engine.setMode('cubes');
const rect=(id,y)=>({id,width:.30,height:.30,corners:[[-.15,y+.15,0],[.15,y+.15,0],[.15,y-.15,0],[-.15,y-.15,0]]});
for(let i=0;i<14;i++){
 const before=engine.peekColor(),f=rect(i,1);engine.onFrame(f,'cubes',i*100);
 if(f.color!==before||engine.boxes.at(-1).color!==before)throw Error('Preview and created cube colour differ');
 if(!w.FreeLabFrameGames.PALETTE.includes(before))throw Error('Invalid palette');
}
''')
 def test_video_overlay_navigation_and_hover(self):
  self.assertIn('agency-video.js?v=0.10.72',PAGE)
  self.assertIn('agencyShowExplainer(agencyGame,agencyStartGame)',XR)
  for token in ('agencyVideoDismiss()',"'agency-video-screen'","'agency-video-play'","'agency-video-skip'", "'agency-howto'", 'agencyControlsReact(frame,t)',"agencyScreen='explainer'", 'agencySession.startedAt+=Date.now()-e.shownAt'):
   self.assertIn(token,XR)
  self.assertIn("video.currentTime/video.duration",XR)
  self.assertIn("gl.texSubImage2D",XR)
  self.assertIn("requestVideoFrameCallback(decoded)",PLAYER)
  self.assertNotIn("t-agencyVideoFrameAt<80",XR)
  self.assertNotIn("ctx.drawImage(video",XR)
  self.assertIn("agencyUiCard('agency-drag','MOVE'",XR)
  self.assertIn("const ghost=live?window.FreeLabFrameGames.boxFromFrame",XR)
  self.assertIn('if(f.manual)return',XR)
  self.assertIn('angle:x>.60?-.20:x<-.60?.20:0',XR)
  self.assertNotIn('agencyRing(vp,[x,y+.045,z]',XR)
 def test_media_lives_outside_release_and_is_synced_independently(self):
  # Tests also run against /var/www/.../releases/vX.Y.Z, where only the app
  # is installed. The watcher belongs to the ZIP and local repo, not this tree.
  self.assertIn("VIDEOS=BASE/'videos'",INSTALL)
  self.assertIn("link.symlink_to(VIDEOS,target_is_directory=True)",INSTALL)
  self.assertIn('hls.js@1.7.4',PLAYER)
  self.assertIn('/videos/hls.min.js',PLAYER)
  self.assertIn('/videos/<activity>/video_hls/index.m3u8', (ROOT/'README.md').read_text())
 def test_bundled_watcher_media_sync_when_available(self):
  if not WATCH_PATH.is_file():
   self.skipTest('The release watcher is shipped outside the server application directory')
  watcher=WATCH_PATH.read_text()
  self.assertIn('def sync_videos():',watcher)
  self.assertIn('args.sync_videos',watcher)
  self.assertIn("VERSION='0.9.6'",watcher)
  self.assertIn("'--delete'",watcher)
  self.assertIn(':/var/www/free-lab.cam/videos/',watcher)
 def test_spatial_photo_visible_prior_to_server_write(self):
  app=(ROOT/'frontend/assets/app.js').read_text()
  self.assertIn('function captureXRFrame(crop)',app)
  self.assertIn('window.FreeLab.captureXRFrame(region)',XR)
  self.assertIn('framePhotos.push({frame,texture:tex,buffer,captureId:null})',XR)
  self.assertIn('window.FreeLab.saveXRFrame({image})',XR)
  self.assertIn('drawFramePhotos(vp)',XR)
  self.assertIn('framePhotoBusy=false',XR)

class SubmissionDocsTests(unittest.TestCase):
 def test_hackathon_readme_links_brand_and_project_story(self):
  landing=(ROOT/'docs/GITHUB_README.md').read_text()
  technical=(ROOT/'README.md').read_text()
  about=(ROOT/'ABOUT.md').read_text()
  self.assertTrue(landing.startswith('# FREE-LAB.cam'))
  self.assertTrue(technical.startswith('# FREE-LAB.cam — Application & Developer Guide'))
  for doc in (landing,technical,about):
   self.assertIn('https://free-lab.cam/',doc)
   self.assertIn('https://youtu.be/rJ0nFm7jKms',doc)
   self.assertIn('My Stuff',doc)
   self.assertIn('Agency',doc)
  self.assertIn('[**Read the project story**](ABOUT.md)',landing)
  self.assertIn('[**Developer guide**](app/README.md)',landing)
  self.assertIn('[Back to README](README.md)',about)
  self.assertIn('not a diagnostic',landing.lower())

 def test_technical_readme_and_release_docs_are_separate(self):
  technical=(ROOT/'README.md').read_text()
  landing=(ROOT/'docs/GITHUB_README.md').read_text()
  self.assertIn('## Local development',technical)
  self.assertIn('## Runtime configuration',technical)
  self.assertIn('## Release & deployment',technical)
  self.assertIn('passthrough access',technical)
  self.assertIn('/videos/<activity>/video_hls/index.m3u8',technical)
  self.assertIn('./watch-free-lab.sh --sync-videos',technical)
  self.assertIn('[![FREE-LAB.cam',landing)
  self.assertNotIn('python -m pip install',landing)

 def test_repository_docs_publisher_is_gated(self):
  if not WATCH_PATH.is_file():
   self.skipTest('Watcher ships outside server application')
  watcher=WATCH_PATH.read_text()
  self.assertIn('def publish_repo_docs():',watcher)
  self.assertIn("('app/docs/GITHUB_README.md','README.md')",watcher)
  self.assertIn("('app/ABOUT.md','ABOUT.md')",watcher)
  self.assertIn('if not (args.once or args.dry_run):',watcher)
  self.assertIn('if args.publish_docs:',watcher)

if __name__ == "__main__": unittest.main()
