import unittest,subprocess,os,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
BACK=(ROOT/'backend/app.py').read_text()
INSTALL=(ROOT/'deploy/install.py').read_text()
class Capture098(unittest.TestCase):
 def test_no_immersive_preview(self):
  for x in ('function showLivePreview(', 'function updateLivePreview(', 'drawCard(cameraPreview,vp)', 'showLivePreview();'):
   self.assertNotIn(x,XR)
 def test_source_extract_and_roundel(self):
  self.assertIn("if(card.kind==='source'&&px>=27&&px<=225)return 'extract'",XR)
  self.assertIn("kind==='source'&&data.saved!==false",XR)
  self.assertIn("function sourceCard(data){return addCard('source','source'",XR)
  self.assertIn("function extractionAvailable(){return Boolean(cloud&&Number.isInteger(cloud.id)&&cloud.id>0",XR)
 def test_failed_saving_cleans_pending(self):
  self.assertIn('CAPTURE SAVE FAILED',XR)
  self.assertIn('cards=cards.filter(c=>c!==pending)',XR)
  self.assertIn('if(!Number.isInteger(item?.id)||item.id<=0)',XR)
  self.assertIn('const card=sourceCard(data);',XR)
  self.assertIn('Commit the new capture as one transition',XR)
  self.assertIn('SAVE FAILED:',XR)
 def test_no_implicit_limits(self):
  self.assertIn('FREE_LAB_ENFORCE_INFERENCE_LIMITS',BACK)
  self.assertNotIn('FREE_LAB_CAPTURE_LIMIT',BACK)
  self.assertNotIn('count>=50',BACK)
  self.assertNotIn('SELECT count(*) FROM captures',BACK)
  self.assertIn('FREE_LAB_ENFORCE_INFERENCE_LIMITS=0',INSTALL)
  self.assertNotIn('nextPaidAt=performance.now()+20000;',XR)
  self.assertNotIn("if(performance.now()<nextPaidAt)",XR)
 def test_server_guard_defaults_without_flask(self):
  script='''import sys,os,types
sys.path.insert(0,'.')
try:from backend.db import begin_inference
except ImportError:raise SystemExit(2)
'''
  r=subprocess.run([sys.executable,'-c',script],cwd=ROOT,text=True,capture_output=True,timeout=15)
  self.assertEqual(r.returncode,0,r.stderr)
if __name__=='__main__':unittest.main()
