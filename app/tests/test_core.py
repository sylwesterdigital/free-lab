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

class DetailedActivityObservationTests(unittest.TestCase):
 def test_actual_backend_aggregation_handles_hands_local_time_and_user_isolation(self):
  # Execute the same aggregation function used by dashboard and Meta analyser;
  # no Flask service, network or AI account is required for this calculation.
  import ast,types
  root=Path(__file__).parents[1]
  tree=ast.parse((root/'backend/app.py').read_text())
  fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='agency_observations')
  code=compile(ast.Module(body=[fn],type_ignores=[]),'<agency-observations>','exec')
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'db.sqlite3';db.init(path)
   with db.connect(path) as con:
    first=db.create_user(con,'metricsfirst','longsecurepassword123')
    other=db.create_user(con,'metricssecond','longsecurepassword456')
    with con:
     con.execute('INSERT INTO agency_sessions(id,owner_id,activity,mode,level) VALUES(?,?,?,?,?)',('a'*32,first,'math','free',1))
     con.execute('INSERT INTO agency_sessions(id,owner_id,activity,mode,level) VALUES(?,?,?,?,?)',('b'*32,other,'math','free',1))
     for session,owner,ts,hand,kind,correct,latency in [
      ('a'*32,first,'2026-11-17T08:00:00.000Z','left','hand',1,400),
      ('a'*32,first,'2026-11-17T10:00:00.000Z','left','hand',0,600),
      ('a'*32,first,'2026-11-17T12:00:00.000Z','right','controller',1,250),
      ('b'*32,other,'2026-11-17T08:00:00.000Z','right','hand',1,20)]:
      con.execute('INSERT INTO agency_events(session_id,owner_id,at_utc,handedness,input_kind,correct,response_ms,offset_minutes) VALUES(?,?,?,?,?,?,?,?)',
                 (session,owner,ts,hand,kind,correct,latency,60))
    scope={'g':types.SimpleNamespace(con=con,user={'id':first})};exec(code,scope)
    obs=scope['agency_observations']('all')
    self.assertEqual(obs['events'],3)
    self.assertEqual([(r['input'],r['attempts'],r['correct']) for r in obs['inputs']], [('hand left',2,1),('controller right',1,1)])
    self.assertEqual([(r['period'],r['attempts']) for r in obs['dayparts'] if r['attempts']], [('Morning',2),('Afternoon',1)])
    self.assertEqual(sum(r['attempts'] for r in obs['by_day']),3)
    self.assertEqual(obs['inputs'][0]['response_ms'],1000)

class ProductProgressGuards(unittest.TestCase):
 def test_progress_metadata_and_xr_entry_are_present(self):
  root=Path(__file__).parents[1]
  html=(root/'frontend/index.html').read_text();xr=(root/'frontend/assets/xr.js').read_text()
  app=(root/'frontend/assets/app.js').read_text();scene=(root/'frontend/assets/scene.mjs').read_text()
  for selector in ('progressDashboard','progressPeriod','progressMetric','collectionTags','collectionFrom','collectionTo'):
   self.assertIn(f'id="{selector}"',html)
  for action in ('agencyTelemetryStart(', 'agencyTelemetryStop(',"'agency-progress'",'xrGalleryHeaderHit(', 'xrGalleryControl(', 'xrGalleryArrowTexture('):
   self.assertIn(action,xr)
  self.assertNotIn('function xrGalleryFilterPanel(',xr)
  self.assertNotIn("['filter','⌕']",xr)
  self.assertIn("api('/agency/dashboard?days='",app)
  self.assertIn('collectionDateOkay(',app)
  self.assertIn("if(canvas&&stage){",scene)
  self.assertNotIn('if(canvas&&stage&&!/OculusBrowser',scene)
 def test_api_routes_are_private_and_meta_requires_opt_in(self):
  source=(Path(__file__).parents[1]/'backend/app.py').read_text()
  for endpoint in ('/api/agency/sessions','/api/agency/dashboard','/api/agency/export.csv',
                   '/api/agency/sessions/<session_id>/events','/api/agency/events.csv','/api/agency/analyse'):
   self.assertIn(endpoint,source)
  self.assertIn('scores\':\'self-reported by the client',source)
  self.assertIn('private to the signed-in profile',source)
  self.assertIn("v.get('consent') is not True",source)
  self.assertIn("provider_key('meta')",source)
  self.assertIn("'Satire'",source)
  self.assertIn("'inputs':observations['inputs']",source)
  self.assertIn("'day_by_input':observations['by_day'][-60:]",source)
  self.assertNotIn("g.user['username']",source.split("def agency_analyse():",1)[1].split("@app.get('/api/agency/events.csv')",1)[0])
