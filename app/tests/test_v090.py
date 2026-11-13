"""Regression checks for the v0.9.0 interactive XR release; no network/billed calls."""
import json, subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
WATCH=(ROOT.parent/'watch-free-lab.sh').read_text() if (ROOT.parent/'watch-free-lab.sh').exists() else ''

class XRMenuTests(unittest.TestCase):
    def test_only_one_context_popover(self):
        self.assertIn('let imageMenuOpen=false',XR)
        self.assertIn('if(imageMenuOpen&&selected',XR)
        self.assertIn('function toggleImageMenu(card)',XR)
        self.assertNotIn('case \'mix\':return mixAdd()',XR)
        self.assertNotIn('case \'folder\':return changeObject',XR)
        self.assertNotIn("['contextbar','3dbar']",XR)
    def test_source_extract_and_image_options_hitboxes(self):
        self.assertIn("if(card.kind==='source'&&px>=27&&px<=225)return 'extract'",XR)
        self.assertIn("if(px>=442&&px<=512)return 'imagemenu'",XR)
        self.assertIn("if(px>=510&&px<=582)return 'imageclose'",XR)
        self.assertIn('if(!held||held.id)return',XR)
        self.assertIn('c.canvasHeight=h',XR)
    def test_restore_is_direct_and_image_edit_preserves_parent(self):
        self.assertIn("case 'refine':return restoreSelected()",XR)
        self.assertIn('return applyPrompt();',XR)
        self.assertIn('bloomChildren([o],context.card)',XR)
        self.assertIn('case \'submit3d\':return submit3d()',XR)
        self.assertIn('closeImageMenu();busy=true;',XR)
    def test_voice_keeps_XR_and_keyboard_sends_on_enter(self):
        self.assertIn('tickVoiceIndicator(t,pose)',XR)
        self.assertIn("setVoicePhase('listening'",XR)
        self.assertIn("setVoicePhase('processing'",XR)
        self.assertIn("evt.key==='Enter'",XR)
        self.assertNotIn('session?.end()',XR[XR.index('async function keyboardPrompt'):XR.index('async function changeObject')])
    def test_3d_mascot_and_separate_hand_input(self):
        self.assertIn('function drawMascot3D(',XR)
        self.assertIn('mascotVertexCount',XR)
        self.assertIn('function pollGestures(',XR)
        self.assertIn('mascotMode()',XR)
        self.assertIn('id="pref-mascotMode"',HTML)
        self.assertIn('gestures.js?v=0.10.8',HTML)
    def test_watchers_are_colored_and_silent(self):
        if not WATCH:
            # Ubuntu ships application files, not the macOS release watcher.
            self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.8')
            return
        self.assertIn("VERSION='0.9.0'",WATCH)
        self.assertIn("'PASS':'\\033[1;32m'",WATCH)
        self.assertIn("'FAIL':'\\033[1;31m'",WATCH)
        self.assertIn("UPDATES/'superseded'",WATCH)
        self.assertNotIn('Previously deployed version ignored:',WATCH)
        self.assertIn("spacing();LOG=None",WATCH)
    def test_js_hitboxes_and_gestures_in_node(self):
        script=r'''
const fs=require('fs'),vm=require('vm');
const g=require('./frontend/assets/gestures.js');
function assert(b,m){if(!b)throw Error(m)}
const hand={wrist:[0,0,0],'thumb-metacarpal':[-.02,.02,0],'thumb-tip':[-.02,.12,0],
 'index-finger-tip':[.03,.07,0],'index-finger-metacarpal':[.03,.04,0],
 'middle-finger-tip':[.01,.07,0],'middle-finger-metacarpal':[.01,.04,0]};
for(const n of ['index','middle','ring','pinky']){
 hand[n+'-finger-metacarpal'] ||= [.03,.03,0];
 hand[n+'-finger-phalanx-proximal']=[.03,.06,0];
 hand[n+'-finger-tip']=[.03,.062,0];
}
assert(g.classify(hand)==='Thumbs up','Expected thumbs-up');
hand['thumb-tip']=[-.02,-.10,0];assert(g.classify(hand)==='Thumbs down','Expected thumbs down');
const left={wrist:[-.10,0,0],'index-finger-tip':[0,.12,0],'thumb-tip':[0,.06,0]};
const right={wrist:[.10,0,0],'index-finger-tip':[.025,.12,0],'thumb-tip':[.025,.06,0]};
assert(g.heart(left,right),'Expected two-hand heart');
const win={};const code=fs.readFileSync('./frontend/assets/xr.js','utf8').replace(
 'window.FreeLabXR={start,isRunning:()=>!!session};',
 'window.FreeLabXR={start,isRunning:()=>!!session,hit:buttonFromHit};');
vm.runInNewContext(code,{window:win,performance:{now:()=>0},console});
const hit=win.FreeLabXR.hit,card={kind:'source',canvasHeight:420};
assert(hit({card,x:-.30,y:.38})==='extract','Extract should be top-left');
assert(hit({card,x:.28,y:.38})==='imagemenu','Menu should be top-right');
assert(hit({card,x:.41,y:.38})==='imageclose','Close should be top-right');
assert(!hit({card,x:-.30,y:.10}),'Photo body must not trigger extract');
console.log('Node XR hitboxes and gestures passed');
'''
        r=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True,timeout=15)
        self.assertEqual(r.returncode,0,r.stderr)

if __name__=='__main__':unittest.main()
