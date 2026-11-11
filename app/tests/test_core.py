import hashlib,json,os,tempfile,unittest
from pathlib import Path
from backend import db,providers

class PersistenceTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.path=Path(self.temp.name)/'db.sqlite3'
  db.init(self.path)
 def tearDown(self):self.temp.cleanup()
 def test_passwords_and_user_isolation(self):
  with db.connect(self.path) as c:
   one=db.create_user(c,'first-user','verylongpassword111')
   two=db.create_user(c,'second_user','verylongpassword222')
   self.assertNotEqual(one,two)
   self.assertTrue(db.verify_password('verylongpassword111',db.user_from_name(c,'first-user')['password_hash']))
   self.assertFalse(db.verify_password('notmypassword',db.user_from_name(c,'first-user')['password_hash']))
   with c:c.execute('INSERT INTO objects(owner_id,label) VALUES(?,?)',(one,'Coffee mug'))
   self.assertEqual(c.execute('SELECT COUNT(*) FROM objects WHERE owner_id=?',(two,)).fetchone()[0],0)
 def test_rate_limit(self):
  with db.connect(self.path) as c:
   u=db.create_user(c,'myprofile','verylongpassword111')
   i=db.begin_inference(c,u,'a'*64,'muse-ember-1.0',daily_cap=1,user_cap=1,cooldown=0)
   db.finish_inference(c,i,'ok')
   with self.assertRaises(ValueError):db.begin_inference(c,u,'b'*64,'muse-ember-1.0',daily_cap=1,user_cap=1,cooldown=0)
 def test_model_sanitization(self):
  self.assertEqual(providers.parse_detections({'objects':[{'label':'desk','description':'wood','box':[10,20,400,600]}]})[0]['label'],'desk')
  self.assertIsNone(providers.parse_detections({'objects':[{'label':'lamp','box':[500,600,1,1]}]})[0]['box'])
  with self.assertRaises(RuntimeError):providers.identify(b'\xff\xd8abc','muse-ember-1.0',api_key='')

try:
 from backend.app import app
 FLASK=True
except ImportError:
 FLASK=False

@unittest.skipUnless(FLASK,'Flask unavailable locally; REQUIRED on Ubuntu')
class ApiTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.app=app;cls.client=app.test_client()
  cls.app.config['TESTING']=True
 def test_health(self):
  data=self.client.get('/api/health').json
  self.assertTrue(data['ok'])
  self.assertEqual(data['version'],json.loads((Path(__file__).parents[1]/'version.json').read_text())['version'])
 def test_unauthenticated_private_data(self):
  self.assertEqual(self.client.get('/api/objects').status_code,401)
  self.assertEqual(self.client.post('/api/objects',json={'label':'item'}).status_code,403)

if __name__=='__main__':unittest.main()
