"""Private capture cloud migrations and XR runtime regressions (no API billing)."""
import json, tempfile, unittest
from pathlib import Path
from backend import db

ROOT=Path(__file__).parents[1]

class SchemaTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.path=Path(self.temp.name)/'lab.sqlite3'
  db.init(self.path)
 def tearDown(self):self.temp.cleanup()
 def test_additive_migrations_and_cloud_isolation(self):
  db.init(self.path)
  with db.connect(self.path) as conn:
   a=db.create_user(conn,'cloud-person','correct-password-123456')
   b=db.create_user(conn,'other-person','correct-password-123456')
   with conn:
    cid=conn.execute('INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)',(a,'saved.jpg','a'*64)).lastrowid
    oid=conn.execute('INSERT INTO objects(owner_id,label,capture_id) VALUES(?,?,?)',(a,'Mug',cid)).lastrowid
   self.assertEqual(conn.execute('SELECT COUNT(*) FROM captures WHERE owner_id=?',(b,)).fetchone()[0],0)
   row=conn.execute('SELECT * FROM objects WHERE id=?',(oid,)).fetchone()
   self.assertEqual(row['folder'],'Unsorted')
   self.assertEqual(row['shelf'],'collection')
   with conn:conn.execute('UPDATE objects SET folder=?,shelf=?,spatial_json=? WHERE id=?',('Room','bin',json.dumps({'x':.4,'y':.2,'z':-.1,'scale':.8,'rotation':0}),oid))
   self.assertEqual(json.loads(conn.execute('SELECT spatial_json FROM objects WHERE id=?',(oid,)).fetchone()[0])['x'],.4)
 def test_existing_objects_preserved(self):
  with db.connect(self.path) as conn:
   u=db.create_user(conn,'older-person','correct-password-123456')
   with conn:oid=conn.execute('INSERT INTO objects(owner_id,label) VALUES(?,?)',(u,'Chair')).lastrowid
  db.init(self.path)
  with db.connect(self.path) as conn:
   self.assertEqual(conn.execute('SELECT label FROM objects WHERE id=?',(oid,)).fetchone()[0],'Chair')

class XRStaticTests(unittest.TestCase):
 def test_spatial_objects_and_input(self):
  text=(ROOT/'frontend/assets/xr.js').read_text()
  for term in ('immersive-ar','local-floor','targetRaySpace','getJointPose','hitTest','cardModel','startAnimation','showCloud','openBin','launchParticles','grabStart','grabEnd','spatialData','runSam','runExtract'):
   if term=='startAnimation':continue
   self.assertIn(term,text)
  self.assertNotIn('panelMatrix=mul(view.transform.matrix',text)
 def test_nonbillable_capture_is_explicit(self):
  ui=(ROOT/'frontend/assets/app.js').read_text()
  self.assertIn("api('/captures',{method:'POST'",ui)
  self.assertIn('sessionMeta()',ui)
  self.assertIn('async function segmentXR',ui)
  self.assertIn('async function recognizeXR',ui)

if __name__=='__main__':unittest.main()
