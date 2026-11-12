"""Regression checks for continuous, non-z-fighting XR strings; no network access."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
PAGE=(ROOT/'frontend/index.html').read_text()

class Ribbon095(unittest.TestCase):
    def node(self,source):
        result=subprocess.run(['node','-e',source],cwd=ROOT,text=True,capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr or result.stdout)

    def test_geometry_continuity_miter_and_degenerate_view(self):
        self.node(r'''const fs=require('fs'),vm=require('vm'),window={};
vm.runInNewContext(fs.readFileSync('frontend/assets/strand-geometry.js','utf8'),{window,Float32Array,Math,Array,Number});
const build=window.FreeLabStrandGeometry.buildRibbon;
function assert(ok,msg){if(!ok)throw Error(msg)}
function v(a,i){return [a[i*4],a[i*4+1],a[i*4+2]]}
function dist(a,b){return Math.hypot(...a.map((x,i)=>x-b[i]))}
function area(a,b,c){const x=b.map((p,i)=>p-a[i]),y=c.map((p,i)=>p-a[i]);return Math.hypot(x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0])}
for(const path of [
 [[0,1,0],[.2,1,0],[.4,1,0],[.6,1,0]],
 [[0,1,0],[.2,1.07,0],[.36,1.19,0],[.52,1.4,0]],
 [[0,1,0],[0,1,-.1],[0,1,-.25],[0,1,-.4]], // looking down the string
]){
 const vertices=build(path,[0,1,1],.025);
 assert(vertices.length===path.length*8,'One shared vertex pair per path joint');
 assert([...vertices].every(Number.isFinite),'No NaNs in vertices');
 for(let i=0;i<path.length;i++){
  const width=dist(v(vertices,i*2),v(vertices,i*2+1));
  assert(width>.022&&width<.038,'Bounded strand width and miter');
  assert(vertices[(i*2)*4+3]===1 && vertices[(i*2+1)*4+3]===-1,'Strand side value');
 }
 for(let i=0;i<path.length-1;i++){
  const a=v(vertices,i*2),b=v(vertices,i*2+1),c=v(vertices,(i+1)*2),d=v(vertices,(i+1)*2+1);
  assert(area(a,b,c)>.00000001&&area(c,b,d)>.00000001,'Nondegenerate ribbon strip triangles');
 }
}
assert(build([], [0,0,1],.02).length===0,'Empty paths ignored');
assert(build([[0,0,0],[0,1,0]],[0,0,1],0).length===0,'Invalid width ignored');
''')

    def test_single_pass_no_coplanar_overlap(self):
        self.assertIn('gl.TRIANGLE_STRIP', XR)
        self.assertIn('gl.depthMask(false)', XR)
        self.assertIn('gl.depthMask(true)', XR)
        self.assertIn("FreeLabStrandGeometry?.buildRibbon(path,eye,width)", XR)
        self.assertIn('uOpacity', XR)
        # A second co-planar glow/core ribbon was the direct source of flicker.
        self.assertNotIn('strandRibbon(vp,path,width*2.1,col,.15,eye)', XR)
        self.assertNotIn('strandRibbon(vp,path,width*2.25,color,.12,eye)', XR)
        self.assertNotIn('gl.drawArrays(gl.TRIANGLES,0,vertices.length/7)', XR)
        self.assertEqual(XR.count('strandRibbon(vp,path,width*2.1,col,.98,eye)'),1)
        self.assertEqual(XR.count('strandRibbon(vp,path,width*2.25,color,.98,eye)'),1)

    def test_guide_asset_version_and_no_new_billing(self):
        self.assertIn('strand-geometry.js?v=0.9.8',PAGE)
        self.assertLess(PAGE.index('strand-geometry.js?v=0.9.8'),PAGE.index('xr.js?v=0.9.8'))
        self.assertEqual(json.loads((ROOT/'version.json').read_text())['version'],'0.9.8')
        self.assertNotIn('fetch(', (ROOT/'frontend/assets/strand-geometry.js').read_text())

if __name__=='__main__':unittest.main()
