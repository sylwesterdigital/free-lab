"""Desktop room: continuous Three.js scene, authenticated image tree and pose transport."""
from pathlib import Path
import subprocess,unittest
ROOT=Path(__file__).resolve().parents[1]

class DesktopRoom113(unittest.TestCase):
 def test_room_viewer_is_threejs_with_independent_frame_loop(self):
  js=(ROOT/'frontend/assets/room-viewer.mjs').read_text()
  for expected in ('THREE','three.module.js','WebGLRenderer','requestAnimationFrame(tick)',
                   'PerspectiveCamera','GridHelper','Raycaster','new T.Vector3','setState(payload,rid,room)',
                   'createRoomViewer','keydown','pointermove','ArrowLeft','setPixelRatio',
                   'intersectObjects','roomInspectDescription','rebuildLinks','roomControlMode'):
   self.assertIn(expected,js)
  self.assertNotIn("getContext('2d')",(ROOT/'frontend/assets/rooms.js').read_text())
 def test_old_canvas_is_now_full_viewport_threejs_with_inspector(self):
  html=(ROOT/'frontend/index.html').read_text();css=(ROOT/'frontend/assets/style.css').read_text()
  for phrase in ('id="roomCanvas"','id="roomInspector"','id="roomInspectDescription"',
                 'id="roomInspectRelatives"','id="roomControlMode"','id="roomControlFit"',
                 'id="roomImageLightbox"'):
   self.assertIn(phrase,html)
  self.assertIn('#roomCanvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important',css)
 def test_published_images_keep_perspective_and_metadata_without_camera_pixels(self):
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  backend=(ROOT/'backend/app.py').read_text();rooms=(ROOT/'frontend/assets/rooms.js').read_text()
  self.assertIn('q:worldCardQuat(c)',xr)
  self.assertIn('q.x,q.y,q.z,q.w',xr)
  self.assertIn('def quaternion(q)',backend)
  self.assertIn('Invalid card orientation',backend)
  self.assertIn('Invalid headset orientation',backend)
  self.assertIn("('object',row['id']):dict(row)",backend)
  self.assertIn("'description':row['description']",backend)
  self.assertIn("r=_room_access(rid)",backend)
  self.assertIn("roomId",(ROOT/'frontend/assets/room-viewer.mjs').read_text())
  self.assertIn('lastSent<1500',rooms)
  self.assertIn('1200',rooms)
  self.assertNotIn('cameraPixels',rooms)
 def test_node_module_parses_and_exports_viewer(self):
  for name in ('rooms.js','room-viewer.mjs','xr.js'):
   result=subprocess.run(['node','--check',str(ROOT/'frontend/assets'/name)],capture_output=True,text=True,timeout=10)
   self.assertEqual(result.returncode,0,result.stderr)
  code="import(process.argv[1]).then(m=>{if(typeof m.createRoomViewer!=='function')throw Error('Missing viewer')})"
  result=subprocess.run(['node','--input-type=module','-e',code,str(ROOT/'frontend/assets/room-viewer.mjs')],capture_output=True,text=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()

class RoomCards045(unittest.TestCase):
 def test_room_history_migration_preserves_existing_data(self):
  import tempfile
  from backend import db
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'freelab.sqlite3';db.init(path)
   with db.connect(path) as con:
    uid=db.create_user(con,'room_owner','secure test password 123')
    con.execute("INSERT INTO live_rooms(owner_id,visibility,active) VALUES(?,?,?)",(uid,'public',1))
    con.commit()
    rid=con.execute('SELECT id FROM live_rooms').fetchone()['id']
    with con:
     db.record_room_session(con,rid,uid,'host',True,100)
     db.record_room_session(con,rid,uid,'host',True,106)
     db.record_room_session(con,rid,uid,'host',True,126)
     db.record_room_session(con,rid,uid,'host',False,137)
    self.assertEqual(con.execute('SELECT COUNT(*) FROM room_sessions').fetchone()[0],1)
    self.assertEqual(con.execute('SELECT ended_at-started_at FROM room_sessions').fetchone()[0],37)
   db.init(path)
   with db.connect(path) as con:
    self.assertEqual(con.execute('SELECT COUNT(*) FROM room_sessions').fetchone()[0],1)
    self.assertEqual(con.execute('SELECT COUNT(*) FROM live_rooms').fetchone()[0],1)

 def test_room_visits_count_once_and_crashed_visits_close_at_heartbeat(self):
  import tempfile
  from backend import db
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'visits.sqlite3';db.init(path)
   with db.connect(path) as con:
    owner=db.create_user(con,'roomowner','password a billion characters')
    visitor=db.create_user(con,'visitor2','password another billion characters')
    con.execute('INSERT INTO live_rooms(owner_id) VALUES(?)',(owner,));con.commit()
    rid=con.execute('SELECT id FROM live_rooms').fetchone()[0]
    with con:
     for second in (100,108,116,124):db.record_room_session(con,rid,owner,'host',True,second)
     db.record_room_session(con,rid,visitor,'visitor',True,107)
     db.record_room_session(con,rid,visitor,'visitor',True,114)
     db.record_room_session(con,rid,visitor,'visitor',False,128)
     # The headset vanished after 124; returning later creates a new session.
     db.record_room_session(con,rid,owner,'host',True,300)
     db.record_room_session(con,rid,owner,'host',True,306)
     db.record_room_session(con,rid,owner,'host',False,309)
     db.record_room_session(con,rid,owner,'host',False,315)
    rooms=[dict(x) for x in con.execute('SELECT role,started_at,last_seen_at,ended_at FROM room_sessions ORDER BY id')]
    self.assertEqual(len(rooms),3)
    self.assertEqual(rooms[0]['ended_at'],124)
    self.assertEqual(rooms[1]['ended_at'],128)
    self.assertEqual(rooms[2]['ended_at'],309)
    stats=con.execute('''SELECT COUNT(*),SUM(MAX(0,COALESCE(ended_at,last_seen_at)-started_at)) FROM room_sessions''').fetchone()
    self.assertEqual(tuple(stats),(3,24+21+9))

 def test_room_thumbnail_is_auth_scoped_and_only_published_media(self):
  source=(ROOT/'backend/app.py').read_text()
  start=source.index("@app.get('/api/rooms/<int:rid>/thumbnail')")
  end=source.index("@app.get('/api/rooms/users')",start)
  block=source[start:end]
  for assertion in ('@require_user','_room_access(rid,require_join=False)',"r['visibility']=='private'",'_room_access(rid)',"json.loads(r['state_json']).get('cards',[])","r['owner_id']",'hidden=0',"shelf!='bin'",'path.is_relative_to(image_root)',"ImageOps.fit",'no-store'):
   self.assertIn(assertion,block)
  self.assertNotIn('SELECT image_name FROM captures WHERE owner_id=? ORDER BY',block)

 def test_room_card_js_renders_live_stats_filters_and_safe_image_urls(self):
  program=r'''
  (async()=>{
  const fs=require('fs'),vm=require('vm');
  const elements={};const mk=(tag='div')=>({tag,children:[],className:'',dataset:{},style:{setProperty(){}},attrs:{},
   append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},
   setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;},classList:{add(){},remove(){},contains(){return false;}},
   set textContent(v){this._text=v;this.children=[];},get textContent(){return this._text||this.children.map(x=>x.textContent).join(' ');}});
  const get=id=>(elements[id]??=mk());const filters=['all','live','mine'].map(v=>{const n=mk('button');n.dataset.roomFilter=v;return n});
  const document={getElementById:get,createElement:mk,querySelectorAll:s=>s==='[data-room-filter]'?filters:[],visibilityState:'visible'};
  const rooms=[{id:1,owner:'Live owner',active:true,visibility:'public',joined:true,mine:true,invited:false,
   participant_count:2,last_accessed_at:new Date().toISOString(),session_count:3,last_session_seconds:123,total_session_seconds:400,
   thumbnail_url:'/api/rooms/1/thumbnail'},
   {id:2,owner:'Offline guest',active:false,visibility:'private',joined:false,mine:false,invited:true,
   participant_count:0,last_accessed_at:null,session_count:0,last_session_seconds:null,total_session_seconds:0,
   thumbnail_url:'https://untrusted.example/sneak.jpg'}];
  const window={};const fetch=async()=>({ok:true,text:async()=>JSON.stringify({rooms})});
  vm.runInNewContext(fs.readFileSync('frontend/assets/rooms.js','utf8'),{window,document,fetch,Date,console,setInterval,clearInterval});
  window.FreeLabRooms.init();await window.FreeLabRooms.list();
  if(get('roomList').children.length!==2)throw Error('Missing room cards');
  const first=get('roomList').children[0];
  if(!first.textContent.includes('Live owner')||!first.textContent.includes('Sessions')||!first.textContent.includes('Last active')||!first.textContent.includes('Total time'))throw Error('Missing fields');
  if(get('roomSummary').textContent!=='2 rooms · 1 live now')throw Error('Room summary');
  const cover=first.children[0];if(!cover.children.find(c=>c.tag==='img'&&c.src==='/api/rooms/1/thumbnail'))throw Error('Room image');
  if(get('roomList').children[1].children[0].children.some(c=>c.tag==='img'))throw Error('Unsafe thumbnail URL');
  filters[1].onclick();if(get('roomList').children.length!==1)throw Error('Live filter');
  filters[2].onclick();if(get('roomList').children.length!==1)throw Error('My rooms filter');
  filters[0].onclick();if(get('roomList').children.length!==2)throw Error('All filter');
  })().catch(e=>{console.error(e);process.exit(1)});
  '''
  result=subprocess.run(['node','-e',program],cwd=ROOT,capture_output=True,text=True,timeout=12)
  self.assertEqual(result.returncode,0,result.stderr[-1800:])

 def test_room_lobby_has_accessible_controls_and_card_styling(self):
  html=(ROOT/'frontend/index.html').read_text();css=(ROOT/'frontend/assets/style.css').read_text()
  for value in ('id="roomSummary"','id="roomsRefresh"','id="roomSort"','data-room-filter="live"','data-room-filter="mine"'):
   self.assertIn(value,html)
  for value in ('.room-cover-photo','.room-stats','#roomList{display:grid','.room-card-actions','.room-stat-label'):
   self.assertIn(value,css)

class RoomDataIntegration045(unittest.TestCase):
 def test_actual_room_card_api_stats_and_private_thumbnail_gates(self):
  import ast,json,time,tempfile
  from datetime import datetime,timezone
  from types import SimpleNamespace
  from backend import db
  source=(ROOT/'backend/app.py').read_text()
  definition=next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='_room_card_info')
  ns={'json':json,'datetime':datetime,'timezone':timezone}
  exec(compile(ast.Module(body=[definition],type_ignores=[]),'backend/app.py','exec'),ns)
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);database=base/'db.sqlite3';images=base/'images';images.mkdir()
   (images/'shared.jpg').write_bytes(b'proof of file presence')
   # macOS aliases /var to /private/var; reproduce the mismatch on Linux.
   alias=base/'image-alias';alias.symlink_to(images,target_is_directory=True)
   ns['IMAGE_DIR']=alias
   db.init(database)
   with db.connect(database) as con:
    owner=db.create_user(con,'roomowner045','secure test password')
    visitor=db.create_user(con,'roomguest045','secure test password')
    with con:
     con.execute("INSERT INTO live_rooms(owner_id,visibility,active) VALUES(?,'private',1)",(owner,))
     con.execute("INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)",(owner,'shared.jpg','testsha'))
     con.execute("UPDATE live_rooms SET state_json=?",(json.dumps({'cards':[{'kind':'capture','id':1}]}),))
     con.execute("INSERT INTO room_members(room_id,user_id,accepted) VALUES(?,?,0)",(1,visitor))
     db.record_room_session(con,1,owner,'host',True,int(time.time())-20)
     db.record_room_session(con,1,owner,'host',True,int(time.time())-5)
    def data():
     return con.execute('''SELECT r.*,m.accepted AS invited FROM live_rooms r
         LEFT JOIN room_members m ON m.room_id=r.id AND m.user_id=?''',(visitor,)).fetchone()
    ns['g']=SimpleNamespace(con=con,user={'id':visitor})
    unseen=ns['_room_card_info'](data(),int(time.time()))
    self.assertIsNone(unseen['thumbnail_url'],'Private invited-but-unaccepted thumbnail must remain secret')
    self.assertEqual(unseen['session_count'],1)
    self.assertEqual(unseen['media_count'],1)
    self.assertTrue(unseen['active'])
    self.assertEqual(unseen['total_session_seconds'],15)
    with con:con.execute('UPDATE room_members SET accepted=1')
    seen=ns['_room_card_info'](data(),int(time.time()))
    self.assertEqual(seen['thumbnail_url'],'/api/rooms/1/thumbnail')
    # Explicitly published image symlinks pointing outside the private
    # storage root must not produce a room thumbnail.
    outside=base/'outside.jpg';outside.write_bytes(b'private image outside storage')
    (images/'escape.jpg').symlink_to(outside)
    with con:con.execute("UPDATE captures SET image_name='escape.jpg' WHERE id=1")
    escaped=ns['_room_card_info'](data(),int(time.time()))
    self.assertIsNone(escaped['thumbnail_url'])
