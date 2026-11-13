"""v0.10.12: shape matching, room permissions, provider scopes, gallery and XR navigation."""
import os,sys,tempfile,sqlite3,subprocess,unittest
from pathlib import Path
from backend import db,aholo3d
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def node(program):
 p=subprocess.run(['node','-e',program],cwd=ROOT,capture_output=True,text=True,timeout=7)
 if p.returncode:raise AssertionError((p.stderr or p.stdout)[-1200:])

class Experiments111(unittest.TestCase):
 def test_triangle_shape_geometry_and_correct_bin(self):
  node('''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/shape-sort.js','utf8'),{window:w});
  const S=w.FreeLabShapeSort;const l={thumb:[-.2,0,0],index:[.2,0,0]},r={index:[0,.3,0]};const t=S.triangle(l,r);
  if(!t||Math.abs(t.area-.06)>.001||t.corners.length!==3)throw Error('triangle shape');
  if(!S.accept('triangle','triangle')||S.accept('triangle','rectangle'))throw Error('wrong bin accepted');
  const frame={shape:'triangle',corners:t.corners};const hit=S.targetHit(frame,[{shape:'triangle',center:[0,.10,0]},{shape:'rectangle',center:[.6,.1,0]}]);
  if(!hit?.accept||hit.shape!=='triangle')throw Error('matching bin not recognized');
  const wrong=S.targetHit(frame,[{shape:'rectangle',center:[0,.1,0]}]);if(!wrong||wrong.accept)throw Error('mismatched bin accepted');
  ''')
 def test_triangle_creation_state_machine(self):
  node('''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/shape-sort.js','utf8'),{window:w});
  const D=new w.FreeLabShapeSort.TriangleDraw(),spread={left:{thumb:[-.2,0,0],index:[.2,0,0]},right:{index:[0,.3,0]}},
   joined={left:{thumb:[0,0,0],index:[.015,0,0]},right:{index:[.01,.02,0]}};
  D.update({...spread,time:1});D.update({...joined,time:100});const attach=D.update({...joined,time:260});
  if(attach.event!=='attach')throw Error('triangle contact arm');
  D.update({...spread,time:450});const place=D.update({...spread,time:790});
  if(place.event!=='place'||place.placed.shape!=='triangle'||place.placed.corners.length!==3)throw Error('triangle release');
  ''')
 def test_selection_includes_sort_mode(self):
  node('''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/lab-selector.js','utf8'),{window:w});
  const s=new w.FreeLabLabSelector.Selector();if(w.FreeLabLabSelector.MODES.length!==8||w.FreeLabLabSelector.MODES[1]!=='sort')throw Error('missing sort');
  const inp=(x,tr,axis)=>[{handedness:'left',gamepad:{mapping:'xr-standard',buttons:[{pressed:tr},{},{},{},{pressed:x}],axes:[0,0,axis,0]}}];
  s.update(inp(true,false,0));s.update(inp(false,false,0));s.update(inp(false,false,1));const sel=s.update(inp(false,true,0));
  if(sel.mode!=='sort'||sel.open)throw Error('sort selection');
  ''')
 def test_xr_wires_shape_bins_and_cinema(self):
  js=(ROOT/'frontend/assets/xr.js').read_text()
  for needle in ('placeShapeTargets','drawShapeTargets(vp,t,pose)','targetHit(df,shapeTargets)','case \'cinemaprev\'','case \'cinemanext\'','FreeLabRooms.publish','room','triangleLab.update'):
   self.assertIn(needle,js)

class Access111(unittest.TestCase):
 def test_schema_non_destructive_security_defaults(self):
  with tempfile.TemporaryDirectory() as t:
   name=Path(t)/'trial.sqlite3';db.init(name)
   with db.connect(name) as con:
    sql={r['name'] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    self.assertTrue({'provider_scopes','live_rooms','room_members','objects','captures','provider_secrets'}<=sql)
    columns={r['name'] for r in con.execute('PRAGMA table_info(live_rooms)')}
    self.assertIn('visibility',columns)
    con.execute('INSERT INTO provider_scopes(provider) VALUES(?)',('aholo',))
    self.assertEqual(con.execute('SELECT shared FROM provider_scopes').fetchone()['shared'],0)
    # Repeat the migration without dropping account, room or secrets.
   db.init(name)
   with db.connect(name) as con:self.assertEqual(con.execute('SELECT shared FROM provider_scopes').fetchone()['shared'],0)
 def test_room_access_and_media_source_gated(self):
  code=(ROOT/'backend/app.py').read_text()
  for needle in ('def _room_access','def room_media','def invite_to_room','def join_room','def update_room_state',"c.get('kind')==kind and c.get('id')==item_id",'@require_user','def provider_key'):
   self.assertIn(needle,code)
 def test_aholo_glb_output_not_false_obj(self):
  with patch.object(aholo3d,'request_api',return_value={'status':3,'outputs':[{'content':'https://storage.aholo.ai/model.obj'},{'content':'https://storage.aholo.ai/model.glb'}]}) as mock:
   result=aholo3d.status('19741','key');self.assertEqual(result['glb_url'],'https://storage.aholo.ai/model.glb')
  with patch.object(aholo3d,'request_api',return_value={'status':4,'outputs':[]}) as mock:
   result=aholo3d.status('19741','key');self.assertIn('19741',result['error'])
 def test_html_desktop_and_scope_controls(self):
  code=(ROOT/'frontend/index.html').read_text()
  for needle in ('id="roomButton"','id="roomInviteList"','id="roomChooser"','id="roomCanvas"','id="desktopGallery"','id="galleryNext"','id="providerList"','shape-sort.js','rooms.js'):
   self.assertIn(needle,code)
 def test_room_state_does_not_send_camera_pixels(self):
  code=(ROOT/'frontend/assets/xr.js').read_text()
  self.assertIn("{kind:c.kind==='source'?'capture':'object',id:c.data.id,p:",code)
  self.assertNotIn('image:target.data?.image',code)

if __name__=='__main__':unittest.main()

class TriangleTracking111(unittest.TestCase):
 def test_right_hand_base_and_closest_non_index_fingertip(self):
  node('''const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('frontend/assets/shape-sort.js','utf8'),{window:w});
  const S=w.FreeLabShapeSort;
  const left={index:[1,1,1],middle:[.01,.02,0],thumb:[1.2,1,1]},right={thumb:[0,0,0],index:[.015,0,0]};
  const t=S.triangle(left,right);if(t.base!=='right'||t.other!=='middle')throw Error('Must choose nearest fingertip on right-hand base');
  const D=new S.TriangleDraw();D.update({left:{...left,middle:[.9,.8,0]},right:{thumb:[0,0,0],index:[.9,0,0]},time:1});D.update({left,right,time:100});
  const event=D.update({left,right,time:260});if(event.event!=='attach'||D.active.other!=='middle')throw Error('Hand contact did not select correct finger');
  const spread={left:{...left,index:[0,.4,0],middle:[0,.4,0]},right:{thumb:[-.2,0,0],index:[.2,0,0]}};
  D.update({...spread,time:450});const finished=D.update({...spread,time:800});
  if(finished.event!=='place'||finished.placed.corners.length!==3)throw Error('Symmetric triangle did not complete');
  ''')
