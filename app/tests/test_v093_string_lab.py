"""WebXR thumb-string lab unit tests; no API, server, camera, or audio device required."""
import subprocess, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XR = (ROOT/'frontend/assets/xr.js').read_text()
AUDIO = (ROOT/'frontend/assets/sound.js').read_text()
INDEX = (ROOT/'frontend/index.html').read_text()
STRING = (ROOT/'frontend/assets/string-lab.js').read_text()

class StringLab093(unittest.TestCase):
 def node(self, source):
  result = subprocess.run(['node','-e',source],cwd=ROOT,text=True,capture_output=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stderr or result.stdout)

 def test_state_machine_touch_stretch_snap_rearm(self):
  self.node(r'''const vm=require('node:vm'),fs=require('node:fs');
const w={};vm.runInNewContext(fs.readFileSync('frontend/assets/string-lab.js','utf8'),{window:w,Math,Number,Array});
const s=new w.FreeLabStringLab.Experiment();s.setEnabled(true);const l=[0,1.1,0];
function step(ms,x){return s.update({left:l,right:x===null?null:[x,1.1,0],time:ms});}
if(step(0,.029).mode!=='idle')throw Error('Touch must debounce');
if(step(90,.030).mode!=='idle')throw Error('Early attach');
let a=step(175,.030);if(a.mode!=='linked'||a.event!=='attach')throw Error('Missing two-tip attach');
const z=step(300,.42);if(z.mode!=='linked'||z.span<.41)throw Error('Rope not tracking moving fingers');
const snap=step(500,1.015);if(snap.event!=='snap'||snap.mode!=='snapped'||!snap.broken)throw Error('1m should snap');
for(const t of [600,900,1300])if(step(t,.015).mode!=='snapped')throw Error('Broken string reattached');
if(step(2300,.02).mode!=='idle')throw Error('Break must expire');
if(step(2360,.02).mode!=='idle')throw Error('Rearm cannot happen while touching');
step(2480,.15);step(2570,.028);if(step(2750,.028).event!=='attach')throw Error('Second touch should reattach');
if(s.toggle()!==false||s.update({left:l,right:[.02,1.1,0],time:2900}).mode!=='off')throw Error('Toggle off');
''')

 def test_right_thumbstick_edge_and_hand_sources(self):
  self.node(r'''const fs=require('node:fs'),vm=require('node:vm');const w={};
vm.runInNewContext(fs.readFileSync('frontend/assets/string-lab.js','utf8'),{window:w});
const f=w.FreeLabStringLab.isRightThumbstickPressed;
const controller=(handedness,pressed)=>({handedness,gamepad:{mapping:'xr-standard',buttons:[{}, {}, {}, {pressed}]}});
if(f([controller('left',true)]))throw Error('Left should not toggle');
if(!f([controller('right',true)]))throw Error('Right button 3 should toggle');
if(f([{...controller('right',true),hand:{}}]))throw Error('Hand gamepad must not toggle');
if(f([controller('right',false)]))throw Error('No press');
''')

 def test_renderer_uses_real_thumb_tips_and_billboard(self):
  for expected in ('src.hand.get(\'thumb-tip\')', 'drawStringLab(vp,t,pose)',
                   'pollStringLab(frame,t)', 'strandRibbon(', 'gl.TRIANGLES',
                   'window.FreeLabStringLab.Experiment()',
                   "src.gamepad.mapping==='xr-standard'"):
   # The last raw gamepad check lives in the separate module, not XR.
   self.assertIn(expected, XR+STRING)
  self.assertIn("window.FreeLabSound?.stringStop?.();stringLab?.setEnabled(false)",XR)
  self.assertIn('stringSnap',AUDIO)
  self.assertIn('stringUpdate',AUDIO)
  self.assertIn('string-lab.js?v=0.9.3',INDEX)
  self.assertNotIn('fetch(',STRING)

if __name__=='__main__':unittest.main()
