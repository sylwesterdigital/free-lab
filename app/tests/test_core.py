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

class ActivityHistoryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'activity.sqlite3';db.init(self.path)
 def tearDown(self):self.temp.cleanup()
 def test_schema_preserves_ownership_and_indexes(self):
  with db.connect(self.path) as c:
   with c:
    u=db.create_user(c,'metrics_user','averysecurepassword123')
    c.execute('INSERT INTO agency_sessions(id,owner_id,activity,mode,level,duration_ms,correct,errors) VALUES(?,?,?,?,?,?,?,?)',('a'*32,u,'math','free',2,123000,7,2))
   row=c.execute('SELECT duration_ms,correct,errors FROM agency_sessions WHERE owner_id=?',(u,)).fetchone()
   self.assertEqual((row['duration_ms'],row['correct'],row['errors']),(123000,7,2))
   indexes={r['name'] for r in c.execute('PRAGMA index_list(agency_sessions)')}
   self.assertIn('agency_sessions_owner_date',indexes)
 def test_canonical_edited_name(self):
  self.assertEqual(db.canonical_edit_label('Edited Edited Edited house'),'Edited (3) house')
  self.assertEqual(db.canonical_edit_label('Edited (6) Edited house',7),'Edited (7) house')
  self.assertEqual(db.canonical_edit_label('house',4),'Edited (4) house')
  self.assertEqual(db.canonical_edit_label('Edited (3) house',1),'Edited (3) house')
 def test_nondestructive_schema_reinitialization(self):
  with db.connect(self.path) as c:
   with c:
    u=db.create_user(c,'userhistory','anotherstrongpassword123')
    c.execute('INSERT INTO agency_sessions(id,owner_id,activity,mode,level) VALUES(?,?,?,?,?)',('c'*32,u,'cubes','free',0))
  db.init(self.path)
  with db.connect(self.path) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM agency_sessions').fetchone()[0],1)

class ProductProgressGuards(unittest.TestCase):
 def test_progress_metadata_and_xr_entry_are_present(self):
  root=Path(__file__).parents[1]
  html=(root/'frontend/index.html').read_text();xr=(root/'frontend/assets/xr.js').read_text()
  app=(root/'frontend/assets/app.js').read_text();scene=(root/'frontend/assets/scene.mjs').read_text()
  for selector in ('progressDashboard','progressPeriod','progressMetric','collectionTags','collectionFrom','collectionTo'):
   self.assertIn(f'id="{selector}"',html)
  for action in ('agencyTelemetryStart(', 'agencyTelemetryStop(',"'agency-progress'",'xrGalleryFilterPanel()'):
   self.assertIn(action,xr)
  self.assertIn("api('/agency/dashboard?days='",app)
  self.assertIn('collectionDateOkay(',app)
  self.assertIn("if(canvas&&stage){",scene)
  self.assertNotIn('if(canvas&&stage&&!/OculusBrowser',scene)
 def test_api_routes_are_private_and_opt_out_of_ai(self):
  source=(Path(__file__).parents[1]/'backend/app.py').read_text()
  for endpoint in ('/api/agency/sessions','/api/agency/dashboard','/api/agency/export.csv'):
   self.assertIn(endpoint,source)
  self.assertIn('scores\':\'self-reported by the client',source)
  self.assertIn('private to the signed-in profile',source)
