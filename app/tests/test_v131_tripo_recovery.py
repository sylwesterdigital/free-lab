"""v0.10.32 Tripo result recovery, trusted signed URLs and no unsolicited XR logs."""
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import tripo3d
ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'backend/app.py').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()
CACHE=(ROOT/'backend/model_cache.py').read_text()

class Tripo31(unittest.TestCase):
 def test_tripo_v3_signed_download_and_legacy_variants(self):
  cloud='https://tripo-output.s3.us-east-1.amazonaws.com/u/model.glb?X-Amz-Signature=123'
  out={'model_url':cloud}
  self.assertEqual(tripo3d.task_model_url(out),cloud)
  self.assertEqual(tripo3d.task_model_url({'pbr_model':{'url':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'model_urls':{'glb':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'base_model':{'href':cloud}}),cloud)
  self.assertEqual(tripo3d.task_model_url({'model_url':'https://127.0.0.1/test','pbr_model':cloud}),cloud)
  with patch.object(tripo3d,'request_api',return_value={'status':'success','progress':100,'output':out}):
   result=tripo3d.status('a-real-task-id01','private')
   self.assertEqual(result['status'],'SUCCEEDED')
   self.assertEqual(result['glb_url'],cloud)
 def test_only_authenticated_task_results_use_cloud_hosts(self):
  signed='https://tripo-output.s3.us-east-1.amazonaws.com/3d.glb'
  self.assertIsNone(tripo3d.safe_file_url(signed))
  self.assertEqual(tripo3d.safe_file_url(signed,trusted_task=True),signed)
  for url in ('http://storage.googleapis.com/3d.glb','https://127.0.0.1/3d.glb',
              'https://169.254.169.254/latest/meta-data','https://localhost.local/3d.glb',
              'https://user:pw@files.example.com/model.glb','https://localhost/model.glb',
              'https://host.invalid/model.glb'):
   self.assertIsNone(tripo3d.safe_file_url(url,trusted_task=True),url)
 def test_reject_private_dns_addresses(self):
  from unittest.mock import Mock
  with patch.object(tripo3d.socket,'getaddrinfo',return_value=[(2,1,6,'',('10.0.0.4',443))]):
   with self.assertRaises(ValueError):tripo3d.verify_public_download_host('https://files.example.com/model.glb')
  with patch.object(tripo3d.socket,'getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))]):
   self.assertTrue(tripo3d.verify_public_download_host('https://files.example.com/model.glb'))
 def test_existing_jobs_recovered_by_read_only_status(self):
  self.assertIn("tripo3d.status(row['provider_task'],key)",APP)
  self.assertIn("if row['provider']=='tripo'",APP)
  self.assertIn('name=model_cache.store(',APP)
  self.assertIn("tripo3d.open_model_download(good",CACHE)
  self.assertIn('def _xr_existing_job_worker(owner,jid,key):',APP)

 def test_async_quest_preview_does_not_download_during_request(self):
  section=APP.split("@app.get('/api/media/3d/<int:jid>/preview')",1)[1].split("@app.post('/api/media/text-to-image')",1)[0]
  self.assertIn('_xr_ensure_preview_worker(owner,jid,key)',section)
  self.assertIn('return jsonify(status=state,',section)
  self.assertNotIn('tripo3d.status(',section)
  self.assertNotIn('model_cache.store(',section)
  self.assertNotIn('glb_xr.decode_visual(',section)
  self.assertIn('cached.read_bytes()',section)
 def test_poll_does_not_block_request_or_charge(self):
  section=APP.split("@app.get('/api/media/3d/<int:jid>')",1)[1].split("@app.get('/api/media/3d/<int:jid>/asset')",1)[0]
  self.assertIn('_xr_ensure_task_poll(',section)
  self.assertNotIn('.status(row[',section)
  self.assertNotIn('model_cache.store(',section)
  self.assertIn('return jsonify(job_3d_dict(row))',section)
  worker=APP.split('def _xr_existing_job_worker(',1)[1].split('def _xr_ensure_preview_worker(',1)[0]
  self.assertNotIn('tripo3d.submit(',worker)
  self.assertIn('model_cache.store(',worker)
  self.assertIn('avatar_optimizer.optimize_xr_preview(raw)',worker)
 def test_room_reduces_publish_rate_and_survives_non_json_gateway(self):
  room=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('lastSent<1500',room)
  self.assertIn('retryAfter=Date.now()',room)
  self.assertIn('body=await r.text()',room)
  self.assertIn("Room server unavailable (HTTP ",room)

 def test_no_auto_debug_pane(self):
  self.assertIn('async function showMeshDiagnostics(jobId){',XR)
  self.assertNotIn('void showMeshDiagnostics(jobId);',XR)
  section=XR.split('async function showMeshDiagnostics(jobId){',1)[1].split('function meshJobCaption(job){',1)[0]
  self.assertNotIn('debugShowing=true',section)
  self.assertIn('setStatus(',section)

if __name__=='__main__':unittest.main()
