"""v0.8 spatial UI, provider safety and billable task lifecycle, all offline."""
import base64, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from backend import db, meshy3d

APP=Path(__file__).parents[1]
class MeshyAdapterTests(unittest.TestCase):
    def test_payload_is_private_data_uri_and_no_task_without_provider_id(self):
        jpeg=b'\xff\xd8'+b'data-bytes'
        seen={}
        def fake(method,url,key,payload):
            seen.update(method=method,url=url,key=key,payload=payload)
            return {'result':'12345678-aaaa-bbbb-cccc-012345678999'}
        with patch.object(meshy3d,'request',fake):
            task=meshy3d.submit(jpeg,'private-meshy-key')
        self.assertTrue(task.startswith('1234'))
        self.assertEqual(seen['method'],'POST')
        self.assertEqual(seen['payload']['ai_model'],'meshy-6-lite')
        self.assertTrue(seen['payload']['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(base64.b64decode(seen['payload']['image_url'].split(',',1)[1]),jpeg)
    def test_task_status_is_sanitized_and_bounded(self):
        with patch.object(meshy3d,'request',return_value={
           'status':'SUCCEEDED','progress':101,'model_urls':{'glb':'http://example.invalid/evil.glb'},
           'thumbnail_url':'https://assets.meshy.ai/model.png','consumed_credits':30}):
            s=meshy3d.status('12345678','key')
        self.assertEqual(s['progress'],100)
        self.assertEqual(s['credits'],30)
        self.assertIsNone(s['glb_url'])
        self.assertTrue(s['thumbnail_url'].startswith('https://assets.meshy.ai/'))
    def test_bad_host_and_bad_task_rejected_pre_network(self):
        with self.assertRaises(ValueError):meshy3d.request('GET','https://evil.com','key')
        with self.assertRaises(ValueError):meshy3d.status('../../bad','key')
        with self.assertRaises(ValueError):meshy3d.submit(b'bad','key')
    def test_migration_retains_captures_and_3d_jobs(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'test.db';db.init(path)
            with db.connect(path) as c:
                user=db.create_user(c,'demouser','good-long-password-123')
                with c:
                    cap=c.execute('INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)',
                        (user,'snapshot.jpg','a'*64)).lastrowid
                    c.execute('INSERT INTO jobs_3d(owner_id,capture_id,provider_task) VALUES(?,?,?)',(user,cap,'12345678'))
            db.init(path)
            with db.connect(path) as c:
                self.assertEqual(c.execute('SELECT COUNT(*) FROM jobs_3d WHERE owner_id=?',(user,)).fetchone()[0],1)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM captures WHERE owner_id=?',(user,)).fetchone()[0],1)

class XRContractTests(unittest.TestCase):
    def test_headset_ui_decoupled_from_photo_world(self):
        xr=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn("'voiceroundel','extractroundel','voiceok','voicecancel','diagnostics'",xr)
        self.assertIn('syncTrackedUI(pose,t)',xr)
        self.assertIn('followOffset',xr)
        self.assertIn('if(toolbar&&followMode)',xr)
        self.assertIn('root=viewerAnchor(latestPose,-.03,1.42)',xr)
        self.assertIn("if(c.kind==='contextbar'",xr) if False else self.assertIn("if(c.kind==='contextbar'",xr)
        self.assertIn('drawHands(frame,vp)',xr)
        self.assertIn("'depth-sensing'",xr)
    def test_3d_has_explicit_confirmation_and_private_job_list(self):
        xr=(APP/'frontend/assets/xr.js').read_text()
        app=(APP/'frontend/assets/app.js').read_text()
        backend=(APP/'backend/app.py').read_text()
        self.assertIn("case '3d':return open3d()",xr)
        self.assertIn("case 'submit3d':return submit3d()",xr)
        self.assertIn('confirm_paid:true',app)
        self.assertIn("v.get('confirm_paid') is not True",backend)
        self.assertIn("WHERE id=? AND owner_id=?",backend)
        self.assertIn('id="modelJobs"',(APP/'frontend/index.html').read_text())

if __name__=='__main__':unittest.main()
