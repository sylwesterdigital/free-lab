"""v0.10.9 physics games: pure WebXR-independent geometry and simulated game states."""
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
PAGE=(ROOT/'frontend/index.html').read_text()

class PhysicsGameTests(unittest.TestCase):
    def run_node(self,script):
        result=subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr or result.stdout)
    def test_cuboid_gravity_and_floor_and_stacking(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('cubes');g.setFloor(0);
const frame=(id,y)=>({id,width:.4,height:.3,corners:[[ -.2,y+.15,0],[.2,y+.15,0],[.2,y-.15,0],[-.2,y-.15,0]]});
let a=frame(1,1.7),b=frame(2,2.3);
if(!g.onFrame(a).removeFrame||!g.onFrame(b).removeFrame)throw Error('frames should become boxes');
for(let t=0;t<4200;t+=12)g.update([],t,{floorY:0});
if(g.boxes.some(b=>b.center[1]-b.half[1]<-.01))throw Error('floor penetration');
if(g.boxes.some(b=>!b.center.every(Number.isFinite)))throw Error('non-finite positions');
if(g.boxes[0].center[1]>1)throw Error('gravity not acting');
if(g.boxes.length!==2)throw Error('boxes disappeared');
console.log('cube physics passed',g.boxes.map(b=>b.center));''')
    def test_chain_attach_swing_and_follow_moving_parent(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('chain');
const rectangle=(id,x)=>({id,width:.4,height:.3,corners:[[x-.2,1.8,0],[x+.2,1.8,0],[x+.2,1.5,0],[x-.2,1.5,0]]});
const f=[rectangle(1,0),rectangle(2,.32)];for(const v of f)g.onFrame(v);
const attached=g.linkOnOverlap(f,1);
if(attached?.event!=='link'||attached.parentId!==1||attached.childId!==2)throw Error('overlapping frames did not link');
const initial=JSON.stringify(f[1].corners);
f[0].corners=f[0].corners.map(p=>[p[0]+.3,p[1]+.2,p[2]]);
for(let t=0;t<600;t+=10)g.update(f,t);
if(JSON.stringify(f[1].corners)===initial)throw Error('child did not swing');
if(g.linkOnOverlap(f,2))throw Error('reverse link cycle');
if(g.links.length!==1)throw Error('duplicate or missing links');
console.log('hinge physics passed');''')
    def test_throw_has_release_velocity_and_expires(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/frame-games.js','utf8'),{window:w});
const g=new w.FreeLabFrameGames.Engine();g.setMode('throw');
let f={id:12,width:.4,height:.3,corners:[[-.2,1,0],[.2,1,0],[.2,.7,0],[-.2,.7,0]]};const frames=[f];g.onFrame(f);
if(g.launch(frames,12,[.01,0,0],0))throw Error('stationary release should not throw');
const e=g.launch(frames,12,[2,0,1],0);if(e?.event!=='throw')throw Error('release velocity ignored');
g.update(frames,0);g.update(frames,100);if(f.corners[0][0]<=-.2)throw Error('not moving');
for(let t=120;t<2000;t+=16)g.update(frames,t);
if(frames.length||g.throws.length)throw Error('frame not popped after 1.6 s');''')
    def test_eight_modes_in_persistent_selector(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/lab-selector.js','utf8'),{window:w});
const a=w.FreeLabLabSelector.MODES;if(a.join('|')!=='frames|sort|chain|cubes|throw|five|thumbs|off')throw Error('mode list');
const s=new w.FreeLabLabSelector.Selector();const inp=(x,trigger,axis)=>[{handedness:'left',gamepad:{mapping:'xr-standard',buttons:[{pressed:trigger},{},{},{},{pressed:x}],axes:[0,0,axis,0]}}];
s.update(inp(true,false,0));s.update(inp(false,false,1));let u=s.update(inp(false,false,0));if(!u.open||u.index!==1)throw Error('selector must remain visible');
u=s.update(inp(false,true,0));if(u.mode!=='sort'||u.open)throw Error('trigger selection');
s.update(inp(false,false,0));s.update(inp(true,false,0));s.update(inp(false,false,1));u=s.update(inp(false,true,0));if(u.mode!=='chain')throw Error('second selection');''')

    def test_production_wiring(self):
        for token in ('window.FreeLabFrameGames.Engine()', 'frameGames?.onFrame(placed,mode,t)',
                      'frameGames?.linkOnOverlap(frameLab.frames,df.id)', 'frameGames?.launch(frameLab.frames,frameTouch.id',
                      'pollFrameGames(t,pose)', 'drawFrameCubes(vp)', 'gl.drawArrays(gl.TRIANGLES,0,36)'):
            self.assertIn(token,XR)
        self.assertIn('frame-games.js?v=0.10.54',PAGE)
        self.assertNotIn('cdn', (ROOT/'frontend/assets/frame-games.js').read_text())

if __name__=='__main__':unittest.main()

class CognitiveAgencyTests(unittest.TestCase):
    """Actual JS game logic, desktop/XR entry points and safe offline progress."""
    def run_node(self, source):
        result=subprocess.run(['node','-e',source],cwd=ROOT,text=True,capture_output=True,timeout=25)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
    def test_games_run_offline_with_daily_seed_and_timeouts(self):
        self.run_node(r'''const fs=require('fs'),vm=require('vm'),w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/shape-sort.js','utf8'),{window:w,Date,Math});
const A=w.FreeLabAgency;
if(Object.keys(A.GAMES).join('|')!=='shapes|math|hands')throw Error('Three games missing');
let clock=100000,storage={v:'',getItem(){return this.v},setItem(_k,value){this.v=value;}};
const start=(game,mode,level)=>new A.Session({game,mode,level,user:7,date:'2026-11-16',now:()=>clock,storage});
for(const level of [0,1,2,3]){const s=start('shapes','free',level);const q=s.question;
 if(q.options.length!==(level===0?2:3)||!q.options.some(x=>x.id===q.target.id))throw Error('Invalid target options');
 const bad=q.options.find(x=>x.id!==q.target.id).id;
 if(s.answer(bad).correct||s.errors!==1||s.score!==0)throw Error('Shape mismatch not counted');
 if(!s.answer(q.target.id).correct||s.score!==1)throw Error('Shape match failed');
}
const d1=start('math','daily',2),d2=start('math','daily',2);
if(JSON.stringify(d1.question)!==JSON.stringify(d2.question))throw Error('Daily challenge not repeatable');
for(let i=0;i<8;i++){if(!d1.question.options.includes(d1.question.answer))throw Error('Math answer missing');
 d1.answer(d1.question.answer);}
if(!d1.completed||d1.score!==8)throw Error('Daily completion missing');
const h=start('hands','free',0);let proper=h.question.hand==='L'?'left':'right';
if(h.answer(proper==='left'?'right':'left',proper==='left'?'right':'left').correct)throw Error('Wrong hand accepted');
if(!h.answer(proper,proper).correct)throw Error('Correct hand refused');
const t=start('math','timed',0);clock+=120000;
if(t.remaining()!==0||!t.tick()||!t.completed||t.answer(t.question.answer).accepted)throw Error('Timer not enforced');
if(!storage.v.includes('"completed":true'))throw Error('Progress not stored');
''')
    def test_xr_first_entrance_is_not_a_browser_gate(self):
        html=(ROOT/'frontend/index.html').read_text()
        app=(ROOT/'frontend/assets/app.js').read_text()
        source=(ROOT/'frontend/assets/shape-sort.js').read_text()
        xr=(ROOT/'frontend/assets/xr.js').read_text()
        self.assertIn('id="enterXR"',html)
        for item in ('id="experienceGate"','id="chooseMyStuff"','id="chooseAgency"',
                     'id="agencyStudio"','id="agencyContent"'):
            self.assertNotIn(item,html)
        self.assertIn('window.FreeLabXR.start()',app)
        self.assertIn("xrExperience='entrance'",xr)
        self.assertIn("'xr-mystuff'",xr)
        self.assertIn("'xr-agency'",xr)
        self.assertIn("case 'home':if(agencyLabMode)",xr)
        self.assertIn("agencyEnter('entrance');return;case 'labstuff':",xr)
        self.assertNotIn('start({experience:',source)
        self.assertIn('freelab-agency-v1-',source)
        self.assertNotIn('fetch(',source[source.index('/* Cognitive Agency'):])
    def test_agency_uses_spatial_geometry_not_fake_3d_panels(self):
        xr=(ROOT/'frontend/assets/xr.js').read_text()
        for item in ('agencyGeometry(type)','agencySolid(vp,','agencyRing(vp,',
                     "'agency-shape'", "'agency-bin:'",'agencyWorld(vp,t)',
                     'agencyNodeDistance(r,n)','agencyContact(p)',
                     'gl.drawArrays(gl.TRIANGLES,0,geom.count)',
                     'agencyTip(frame,src)', "'handtarget'","agencyEnter('stuff')"):
            self.assertIn(item,xr)
        self.assertIn('agencyPointerEnd(frame,src)',xr)
        self.assertNotIn("xrExperience=options.experience==='agency'",xr)
    def test_quest_reuses_native_xr_renderer_with_hands_and_controller(self):
        xr=(ROOT/'frontend/assets/xr.js').read_text()
        for snippet in ("xrExperience==='agency'",'renderAgencyView(t,frame,pose)',
                        'agencyPointerStart(e.frame,e.inputSource)',
                        'agencyPointerEnd(e.frame,e.inputSource)',
                        "src.hand.get('index-finger-tip')",
                        "node.type==='handtarget'", "agencyGame==='shapes'", "agencyGame==='math'"):
            self.assertIn(snippet,xr)
        self.assertIn("xrExperience!=='stuff'",xr)

    def test_xr_entrance_is_exactly_two_labelled_rectangles(self):
        xr=(ROOT/'frontend/assets/xr.js').read_text()
        entrance=xr.split("if(xrExperience==='entrance'){",1)[1].split("}else if(agencyScreen==='lobby')",1)[0]
        self.assertEqual(entrance.count('agencyEntrancePanel('),2)
        self.assertIn("agencyEntrancePanel('xr-mystuff','MY STUFF'",entrance)
        self.assertIn("agencyEntrancePanel('xr-agency','AGENCY'",entrance)
        self.assertNotIn('agencyButton(',entrance)
        self.assertNotIn('agencySolid(',entrance)
        self.assertIn("if(xrExperience==='entrance')return;",xr)
        self.assertIn("agencyNode(id,...body.pos,'panel'",xr)
        self.assertIn("const t=((n.angle?0:n.pos[2])-o[2])/d[2]",xr)
        self.assertIn("if(node.type==='panel')return;",xr)
    def test_premium_entrance_has_transparency_inertia_and_proximity(self):
        xr=(ROOT/'frontend/assets/xr.js').read_text()
        self.assertIn('function entranceTexture(kind,hot=false)',xr)
        self.assertIn('function entranceTitleTexture(title,description)',xr)
        self.assertIn('function entranceArt(ctx,kind,hot)',xr)
        self.assertIn('function entranceUpdate(frame,pose,t)',xr)
        self.assertIn("if(xrExperience==='entrance')entranceUpdate(frame,pose,t)",xr)
        self.assertIn('const ENTRANCE_DEPTH=.99',xr)
        self.assertIn('card.entranceAttention=previous+(target-previous)*a',xr)
        self.assertIn('card.pos[2]=card.basePos[2]+v*',xr)
        self.assertIn('const targetYaw=Math.abs(delta)>.14',xr)
        self.assertIn('window.FreeLabSound?.hover?.()',xr)
        self.assertIn("cue('enter',src)",xr)
        self.assertIn("agencyNode(id,...body.pos,'panel'",xr)
        self.assertNotIn('rgba(17,28,42,.97)',xr)
        self.assertNotIn('rgba(12,19,35,.95)',xr)
        self.assertIn("ctx.clearRect(0,0,1200,1380)",xr)
        self.assertIn('prefers-reduced-motion: reduce',xr)

    def test_angling_of_entrance_panels_keeps_rays_and_touch_precise(self):
        # Execute the production geometric functions against rotated XR panels.
        self.run_node(r'''const fs=require('fs'),vm=require('vm');const src=fs.readFileSync('frontend/assets/xr.js','utf8');
const extract=name=>{const start=src.indexOf('function '+name+'(');if(start<0)throw Error('missing '+name);
 const brace=src.indexOf('{',start);let depth=0;for(let i=brace;i<src.length;i++){
 if(src[i]==='{')depth++;if(src[i]==='}'&&!--depth)return src.slice(start,i+1);
 }throw Error('unclosed '+name);};
const prefix=`const agencyRoot=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const agencyNodes=[{id:'xr-mystuff',type:'panel',pos:[-.246,0,.024],size:[.438,.555],angle:.095,card:{scale:1.025}},
{id:'xr-agency',type:'panel',pos:[.246,0,.024],size:[.438,.555],angle:-.095,card:{scale:1.025}}];
const vsub=(a,b)=>a.map((n,i)=>n-b[i]),length=a=>Math.hypot(...a);`;
const js=prefix+['matmul','translate','rotateY','point','inverse','agencyWorldPoint','agencyNodeDistance','agencyContact'].map(extract).join('\n')+`
const vunit=a=>a.map(x=>x/Math.hypot(...a));
for(const n of agencyNodes){
 const center=point(matmul(translate(...n.pos),rotateY(n.angle)),[0,0,0]);
 const origin=[0,0,1],direction=vunit(vsub(center,origin)),hit=agencyNodeDistance({o:origin,d:direction},n);
 if(!(hit>.1&&hit<2))throw Error('ray missed angled panel '+n.id);
 const fingertip=point(matmul(translate(...n.pos),rotateY(n.angle)),[0,0,.025]);
 if(agencyContact(fingertip)?.id!==n.id)throw Error('fingertip missed angled panel '+n.id);
}
if(agencyNodeDistance({o:[1.25,0,1],d:[0,0,-1]},agencyNodes[1])!==null)throw Error('outside ray selected angled panel');
if(agencyContact([0,.5,.02])!==null)throw Error('outside fingertip selected angled panel');`;
vm.runInNewContext(js,{});''')

    def test_xr_rectangular_panel_controller_and_fingertip_hit_regions(self):
        # Execute the actual production ray/card and fingertip contact functions
        # with a static reference frame, no XR session, server or provider calls.
        self.run_node(r'''const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('frontend/assets/xr.js','utf8');
const extract=name=>{const start=src.indexOf('function '+name+'(');if(start<0)throw Error('missing '+name);
 const brace=src.indexOf('{',start);let depth=0;for(let i=brace;i<src.length;i++){
  if(src[i]==='{')depth++;if(src[i]==='}'&&!--depth)return src.slice(start,i+1);
 }throw Error('unclosed '+name);};
const prefix=`const agencyRoot=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const agencyNodes=[{id:'xr-mystuff',type:'panel',pos:[-.405,0,.02],size:[.71,.78]},
{id:'xr-agency',type:'panel',pos:[.405,0,.02],size:[.71,.78]}];
const point=(m,p,w=1)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]*w,
 m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]*w,m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]*w];
const inverse=m=>m,vsub=(a,b)=>a.map((n,i)=>n-b[i]),length=a=>Math.hypot(...a);
`;
const test=`const left=agencyNodes[0],right=agencyNodes[1];
const ray=(x,y,z=1)=>({o:[x,y,z],d:[0,0,-1]});
if(Math.abs(agencyNodeDistance(ray(-.405,0),left)-.98)>1e-5)throw Error('left ray misses');
if(agencyNodeDistance(ray(.405,0),left)!==null)throw Error('left ray overlaps right card');
if(Math.abs(agencyNodeDistance(ray(.405,0),right)-.98)>1e-5)throw Error('right ray misses');
if(agencyNodeDistance(ray(1.5,0),right)!==null)throw Error('ray outside card hits');
if(agencyNodeDistance(ray(-.405,.7),left)!==null)throw Error('ray above card hits');
if(agencyContact([-.405,0,.05])?.id!=='xr-mystuff')throw Error('left finger contact misses');
if(agencyContact([.405,0,.05])?.id!=='xr-agency')throw Error('right finger contact misses');
if(agencyContact([.405,.7,.05])!==null)throw Error('finger outside card hits');
if(agencyContact([.405,0,.3])!==null)throw Error('finger too far from surface hits');
`;
vm.runInNewContext(prefix+extract('agencyWorldPoint')+extract('agencyNodeDistance')+
 extract('agencyContact')+test,{});
''')
