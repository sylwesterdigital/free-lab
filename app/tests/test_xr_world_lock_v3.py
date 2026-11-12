"""Guard against regression to headset-following/imaginary camera capability."""
import unittest
from pathlib import Path

APP=Path(__file__).resolve().parents[1]

class XRWorldLockTests(unittest.TestCase):
    def test_fixed_room_pose_not_viewer_following(self):
        text=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn('root=viewerAnchor(pose,-.04,1.35)',text)
        self.assertIn('followBase=viewerAnchor(pose,-.21,.85)',text)
        self.assertIn('matmul(vp,cardModel(c))',text)
        self.assertIn('targetRaySpace',text)
        self.assertIn('getJointPose',text)
        self.assertNotIn('root=matmul(view.transform.matrix',text)
    def test_no_native_scan_confirm_and_credential_storage(self):
        app=(APP/'frontend/assets/app.js').read_text()
        html=(APP/'frontend/index.html').read_text()
        self.assertIn('scanConsent',app)
        self.assertIn('sessionKeys:new Map()',app)
        self.assertIn('keyMode',html)
        self.assertIn('data-provider="aholo"',html)
        self.assertIn('id="cameraDiagnostic"',html)
