"""v0.6.0 static + dynamic UI regressions, strictly offline."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
HTML=(ROOT/'frontend/index.html').read_text()
CSS=(ROOT/'frontend/assets/style.css').read_text()
SOUND=(ROOT/'frontend/assets/sound.js').read_text()

class SpatialInteractionTests(unittest.TestCase):
    def test_single_toolbar_and_no_fixed_footer(self):
        self.assertIn('function currentTools()',XR)
        self.assertIn('function updateEditbar(){',XR)
        self.assertIn('if(editbar)drawCard(editbar,vp)',XR)
        self.assertIn('if(h.card.kind===\'toolbar\'&&h.y>.37)return null',XR)
        self.assertIn('class="feature-bloom"',HTML)
        self.assertNotIn('class="action-bar"',HTML)
        self.assertIn('calc(3s + var(--delay))',CSS)
        for id in ('cameraButton','cameraDiagnostic','addNameButton','fileInput'):
            self.assertEqual(HTML.count('id="'+id+'"'),1)
    def test_iris_and_on_demand_camera(self):
        self.assertIn('function paintEye(',XR)
        self.assertIn('captureEye',XR)
        self.assertIn('enableXRCamera()',XR)
        self.assertIn('press the eye again to CAPTURE',XR)
        self.assertIn('async function enableXRCamera()',APP)
        self.assertIn('video.videoWidth',APP)
        self.assertNotIn('function updateLivePreview(',XR)
        self.assertNotIn('LIVE CAMERA · REAL PIXELS',XR)
        self.assertNotIn('showLivePreview()',XR)
        self.assertIn("if(!cameraLive){",XR)
        self.assertNotIn('toDataURL(\'image/jpeg\')',XR)  # camera pixels never extracted from passthrough WebGL framebuffer
    def test_photo_aspect_no_cover_and_in_place_save(self):
        self.assertIn('const factor=Math.min(frameWidth/image.width,frameHeight/image.height)',XR)
        self.assertIn('function cardDimensions(',XR)
        self.assertIn('const item=await window.FreeLab.saveXRFrame();',XR)
        self.assertNotIn('pending=addCard',XR)
        self.assertNotIn('await showCloud(data.id);',XR[XR.index('async function makeCapture()'):XR.index('function bloomChildren(')])
    def test_pinned_orientation_and_safe_grab(self):
        self.assertIn('if(toolbar&&followMode)',XR)
        self.assertIn('toolbar.q=quatY(menuYaw)',XR)
        self.assertIn('followOffset=point(rotateY(-yaw),d,0)',XR)
        self.assertIn("session.addEventListener('squeezestart'",XR)
        self.assertIn("session.addEventListener('squeezeend'",XR)
        self.assertNotIn("session.addEventListener('squeeze',",XR)
    def test_web_audio_and_haptic(self):
        self.assertIn("createOscillator",SOUND)
        self.assertIn("arrival:[[392",SOUND)
        self.assertIn('hapticActuators',XR)
        self.assertIn("window.FreeLabSound?.play('enter')",APP)
        self.assertIn('sound.js?v=0.10.5',HTML)
    def test_prompt_improve_preserves_source(self):
        self.assertIn("case 'refine':return restoreSelected()",XR)
        self.assertIn('return applyPrompt()',XR)
        self.assertIn('bloomChildren([o],context.card)',XR)
        self.assertIn('original image stays in the room',XR)
    def test_dynamic_aspect_calculation(self):
        # The function used in the browser is exercised directly in Node for portrait and landscape photos.
        match=re.search(r'function cardDimensions\(width,height,kind\)\{.*?\n return \[widthMetres,widthMetres\*aspect\];\}',XR,re.S)
        self.assertIsNotNone(match)
        js="const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));"+match.group(0)+'''
            for (const [w,h,k] of [[1200,800,'source'],[500,1600,'object'],[2000,280,'object']]) {
              const [pw,ph]=cardDimensions(w,h,k); const screenAspect=(ph/pw);
              const expected=Math.min(1.8,Math.max(.335,h/w));
              if (!(pw>0 && ph>0) || Math.abs(screenAspect - h/w)>.8) throw Error('Invalid aspect ratio');
            }
        '''
        result=subprocess.run(['node','-e',js],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
