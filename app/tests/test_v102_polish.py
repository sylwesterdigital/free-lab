"""v0.10.6 no-network regressions: XR presentation + hand-attached geometry."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
FRAME=(ROOT/'frontend/assets/frame-lab.js').read_text()
INDEX=(ROOT/'frontend/index.html').read_text()

class MotionPolishTests(unittest.TestCase):
    def test_release_marker_and_cache_busting(self):
        self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.10.13')
        self.assertIn('xr.js?v=0.10.13',INDEX)
        self.assertIn('frame-lab.js?v=0.10.13',INDEX)

    def test_static_status_has_single_transform_and_alpha_fade(self):
        set_status=XR.split('function setStatus(',1)[1].split('function refreshToolbar(',1)[0]
        self.assertIn('statusTexture(statusText)',set_status)
        self.assertIn('const fadeIn=300,fadeOut=900',set_status)
        self.assertNotIn(".play?.('type')",set_status)
        sync=XR.split('function syncTrackedUI(',1)[1].split('function cardModel(',1)[0]
        self.assertIn('vadd(captureEye.pos',sync)
        self.assertIn('statusCard.q=captureEye.q',sync)
        self.assertIn("uniform float uOpacity",XR)
        self.assertIn("c.alpha===undefined?1",XR)

    def test_flight_orientation_and_speech_bubble(self):
        self.assertIn('mascotPointer.flightQ=quatSlerp',XR)
        self.assertIn('quatFromTo([0,1,0],norm(velocity))',XR)
        self.assertIn("size:[.45,.13]",XR)
        self.assertIn('const fadeIn=250,fadeOut=520',XR)
        self.assertIn('const eased=opening*opening*(3-2*opening)',XR)

    def test_wrist_delta_rotation_preserves_grab_contact(self):
        # This executes the actual geometry helper, not a rewritten Python equivalent.
        script=r'''
const fs=require('fs'),vm=require('vm');
const w={};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{window:w});
const g=w.FreeLabFrameLab;
const q=[0,0,Math.SQRT1_2,Math.SQRT1_2];
const pts=g.transformGrab([[1,0,0],[0,1,0]],[0,0,0],[2,0,0],[0,0,0,1],q);
const err=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
if(err(pts[0],[2,1,0])>1e-6||err(pts[1],[1,0,0])>1e-6)process.exit(2);
const t=g.transformGrab([[1,2,3]],[0,0,0],[.1,.2,.3],null,null);
if(err(t[0],[1.1,2.2,3.3])>1e-6)process.exit(3);
console.log('3D frame rotation and translation passed');
'''
        run=subprocess.run(['node','-e',script,str(ROOT/'frontend/assets/frame-lab.js')],capture_output=True,text=True,timeout=10)
        self.assertEqual(run.returncode,0,run.stderr+run.stdout)
        self.assertIn('transformGrab(',XR)

if __name__=='__main__':unittest.main()
