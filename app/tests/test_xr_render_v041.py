"""Regression guards for the v0.4.0 Quest renderer failure. No model API calls."""
import re,unittest
from pathlib import Path
from deploy import install

APP=Path(__file__).resolve().parents[1]

class WebXRBootTests(unittest.TestCase):
    def test_all_texture_parameters_use_three_arguments(self):
        src=(APP/'frontend/assets/xr.js').read_text()
        matches=re.findall(r'gl\.texParameteri\(([^()]*)\)',src)
        self.assertEqual(len(matches),4)
        for call in matches:
            self.assertEqual(len(call.split(',')),3,call)
        self.assertIn('gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE',src)
    def test_disable_unneeded_multisampling_in_quest_layer(self):
        src=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn("new XRWebGLLayer(session,gl,{alpha:true,antialias:false})",src)
        self.assertIn("getContext('webgl',{alpha:true,antialias:false,xrCompatible:true})",src)
    def test_no_missing_local_three_import(self):
        scene=(APP/'frontend/assets/scene.mjs').read_text()
        self.assertNotIn("import('/assets/",scene)
        self.assertNotIn('import("/assets/',scene)
        self.assertNotIn('/assets/vendor/three.module.js',scene)
    def test_missing_assets_produce_404_not_html(self):
        self.assertIn('location /assets/',install.NGINX)
        self.assertIn('try_files $uri =404;',install.NGINX)
    def test_release_includes_041_version(self):
        self.assertEqual(__import__('json').loads((APP/'version.json').read_text())['version'],'0.10.0')

if __name__=='__main__':unittest.main()
