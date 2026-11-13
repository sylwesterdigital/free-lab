"""v0.10.1: no-network release regression checks for critical provider and XR paths."""
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from backend import db, aholo3d

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'backend/app.py').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
FRONT=(ROOT/'frontend/assets/app.js').read_text()
INDEX=(ROOT/'frontend/index.html').read_text()

class ImageDialogueTests(unittest.TestCase):
    def test_private_thread_and_preferences_schema(self):
        with tempfile.TemporaryDirectory() as t:
            f=Path(t)/'db.sqlite';db.init(f)
            with db.connect(f) as c:
                a=db.create_user(c,'oneuser','long-secure-password111')
                b=db.create_user(c,'twouser','long-secure-password222')
                with c:
                    cid=c.execute('INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)',(a,'abc.jpg','a'*64)).lastrowid
                    c.execute('INSERT INTO image_dialogue(owner_id,capture_id,object_id,question,answer) VALUES(?,?,?,?,?)',(a,cid,None,'What ingredients?','Possibly rice.'))
                    c.execute('INSERT INTO profile_settings(user_id,model_3d) VALUES(?,?)',(a,'aholo'))
                self.assertEqual(c.execute('SELECT count(*) FROM image_dialogue WHERE owner_id=?',(b,)).fetchone()[0],0)
                self.assertIsNone(c.execute('SELECT model_3d FROM profile_settings WHERE user_id=?',(b,)).fetchone())
                self.assertEqual(c.execute('SELECT model_3d FROM profile_settings WHERE user_id=?',(a,)).fetchone()[0],'aholo')
            db.init(f) # idempotent schema upgrade
    def test_image_chat_not_refine_prompt(self):
        section=APP.split("@app.post('/api/media/describe')",1)[1].split("@app.get('/api/media/voices')",1)[0]
        self.assertIn('image_dialogue',section)
        self.assertNotIn("row['description']",section)
        self.assertIn('providers.describe(raw,key,question=',section)
        self.assertIn('owner_id=?',section)
    def test_provider_choice_not_hardcoded_meshy(self):
        self.assertIn('provider=preferred_3d_provider()',APP)
        self.assertIn('provider=provider,paid_task_submitted=True',APP)
        self.assertIn("provider=='aholo'",APP)
        self.assertIn('aholo3d.submit',APP)
        self.assertIn('aholo3d.status',APP)
        self.assertNotIn("provider:'meshy'",FRONT)
        self.assertIn('id="preferred3D"',INDEX)
        self.assertIn("response=await window.FreeLab.list3DJobs", XR.replace('oldJobs=await window.FreeLab.list3DJobs','response=await window.FreeLab.list3DJobs'))

class AholoAdapterTests(unittest.TestCase):
    def test_aholo_create_endpoint_payload_and_key_header(self):
        with patch.object(aholo3d,'request_api',return_value=12345) as call:
            result=aholo3d.submit('https://free-lab.cam/api/media/3d/source/abcdef','private-secret')
            self.assertEqual(result,'12345')
            self.assertEqual(call.call_args.args[0],'POST')
            self.assertEqual(call.call_args.args[3]['version'],'G1-Turbo')
            self.assertEqual(call.call_args.args[2],'private-secret')
        with self.assertRaises(ValueError):aholo3d.submit('https://127.0.0.1/private','secret')
    def test_status_and_glb_detection(self):
        done={'status':3,'outputs':[{'content':'https://files.example.org/result.zip'},{'content':'https://files.example.org/model.glb'}]}
        with patch.object(aholo3d,'request_api',return_value=done):
            result=aholo3d.status('123','secret')
        self.assertEqual(result['status'],'SUCCEEDED');self.assertTrue(result['glb_url'].endswith('.glb'))
        with patch.object(aholo3d,'request_api',return_value={'status':4,'message':'Credits unavailable'}):
            self.assertEqual(aholo3d.status('123','secret')['status'],'FAILED')
    def test_signed_private_image_url(self):
        self.assertIn("URLSafeTimedSerializer(str(app.secret_key)",APP)
        self.assertIn('max_age=7200',APP)
        self.assertIn("IMAGE_DIR/row['image_name']",APP)
        self.assertIn("'private, no-store'",APP)

class SpatialXRTests(unittest.TestCase):
    def test_eye_pitched_cloud_and_log(self):
        self.assertIn('lookingQuat(pos,viewer)',XR)
        self.assertIn('quatSlerp(debugPanel.q,lookingQuat',XR)
        self.assertIn('quatMul(quatY(-rootYaw),lookingQuat',XR)
        self.assertIn('Math.atan2(d[1],Math.hypot(d[0],d[2]))',XR)
    def test_darkroom_keeps_xr_session(self):
        self.assertIn('function enterDarkroom()',XR)
        self.assertIn("case 'darkroomexit':return closeDarkroom()",XR)
        self.assertIn("return 'darkroom'",XR)
        self.assertIn("'cinema-curtain'",XR)
        body=XR.split('function enterDarkroom(){',1)[1].split('function closeSelectedCard()',1)[0]
        self.assertNotIn('session.end()',body)
    def test_typed_status_and_mascot_speech(self):
        self.assertIn('function typeStatus(t)',XR)
        self.assertIn("FreeLabSound?.play?.('type')",XR)
        self.assertIn('Math.exp(-dt*1.45)',XR)
        self.assertIn("speakUpdate?.('Welcome to FreeLab!",XR)
    def test_old_library_pages_and_frame_touch(self):
        self.assertIn('galleryPage*8',XR)
        self.assertIn("gallerynav'+direction",XR)
        self.assertIn('function pollPlacedFrameTouch(',XR)
        self.assertIn("get('pinky-finger-tip')",XR)
    def test_no_new_arbitrary_quota(self):
        self.assertNotIn('MAX_CAPTURES_PER_PROFILE=50',APP)
        self.assertIn('daily_cap=limits',APP)

if __name__=='__main__': unittest.main()
