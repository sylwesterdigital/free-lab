"""Regression guards for the v0.4.0 Quest renderer failure. No model API calls."""
import re,unittest
from pathlib import Path
from deploy import install

APP=Path(__file__).resolve().parents[1]

class WebXRBootTests(unittest.TestCase):
    def test_all_texture_parameters_use_three_arguments(self):
        src=(APP/'frontend/assets/xr.js').read_text()
        matches=re.findall(r'gl\.texParameteri\(([^()]*)\)',src)
        self.assertGreaterEqual(len(matches),4)
        for call in matches:
            self.assertEqual(len(call.split(',')),3,call)
        self.assertIn('gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE',src)
    def test_configurable_xr_antialias_and_framebuffer_scale(self):
        src=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn('framebufferScaleFactor:attempt.scale',src)
        self.assertIn('antialias:attempt.antialias',src)
        self.assertIn('xrCreateGraphicsLayer()',src)
        self.assertIn('xrGraphicsRequested?.antialias!==false',src)
        self.assertIn('xrGraphicsFailures',src)
        self.assertIn('applyGraphicsFoveation:xrApplyFoveation',src)
    def test_settings_quality_controls_present(self):
        page=(APP/'frontend/index.html').read_text()
        for tag in ('xrGraphicsPreset','xrGraphicsScale','xrGraphicsAA','xrGraphicsFoveation','xrGraphicsStatus','xrGraphicsInspect'):
            self.assertIn('id="'+tag+'"',page)
        src=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn('function graphicsTexture()',src)
        self.assertIn("case 'configgraphics'",src)
    def test_quality_preferences_validated(self):
        import subprocess,json
        source=(APP/'frontend/assets/app.js').read_text()
        part=source.split('/* XR_GRAPHICS_BEGIN')[1].split('*/',1)[1].split('/* XR_GRAPHICS_END')[0]
        program=("const vm=require('vm');const assert=require('assert');const store=new Map();"
          "const context={window:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}};"
          "vm.createContext(context);vm.runInContext("+json.dumps(part)+",context);"
          "const q=context.window.FreeLabXRGraphics;assert.equal(q.read().scale,1);"
          "assert.equal(q.save({preset:'extreme'}).scale,2);"
          "assert.equal(q.save({scale:1.2}).preset,'custom');"
          "assert.equal(q.save({foveation:'off'}).foveation,'off');"
          "store.set('freelab-xr-graphics-v1',JSON.stringify({preset:'custom',scale:20,antialias:'bad',foveation:'bad'}));"
          "assert.equal(q.read().scale,1);assert.equal(q.read().antialias,true);assert.equal(q.read().foveation,'auto');")
        output=subprocess.run(['node','-e',program],text=True,capture_output=True,timeout=20)
        self.assertEqual(output.returncode,0,output.stderr)
    def test_no_missing_local_three_import(self):
        scene=(APP/'frontend/assets/scene.mjs').read_text()
        self.assertNotIn("import('/assets/",scene)
        self.assertNotIn('import("/assets/',scene)
        self.assertNotIn('/assets/vendor/three.module.js',scene)
    def test_missing_assets_produce_404_not_html(self):
        self.assertIn('location /assets/',install.NGINX)
        self.assertIn('try_files $uri =404;',install.NGINX)
    def test_release_includes_041_version(self):
        self.assertEqual(__import__('json').loads((APP/'version.json').read_text())['version'],'0.10.57')

if __name__=='__main__':unittest.main()
