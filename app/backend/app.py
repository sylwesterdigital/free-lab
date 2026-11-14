"""Flask API: identity-scoped private object collection with optional Meta inference."""
from __future__ import annotations
import base64,hashlib,hmac,io,json,os,re,secrets,sqlite3,threading,time,urllib.request,urllib.error
from pathlib import Path
from functools import wraps
from flask import Flask,abort,g,jsonify,request,send_file,session
from itsdangerous import URLSafeTimedSerializer,BadSignature,SignatureExpired
from werkzeug.middleware.proxy_fix import ProxyFix
from . import db,providers,secrets as keyvault,sam,provider_checks,media,meshy3d,aholo3d,glb_preview,model_cache

APP_ROOT=Path(__file__).resolve().parents[1]
DATA_DIR=Path(os.getenv('FREE_LAB_DATA_DIR',APP_ROOT/'var')).resolve()
DB=Path(os.getenv('FREE_LAB_DB',DATA_DIR/'free-lab.sqlite3')).resolve()
IMAGE_DIR=DATA_DIR/'images'
MODEL_DIR=DATA_DIR/'models'
VERSION=json.loads((APP_ROOT/'version.json').read_text())['version']
app=Flask(__name__,static_folder=str(APP_ROOT/'frontend'),static_url_path='')
app.config.update(SECRET_KEY=os.getenv('FREE_LAB_SESSION_KEY',secrets.token_hex(32)),
                  SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax',
                  SESSION_COOKIE_SECURE=os.getenv('FREE_LAB_HTTPS','0')=='1',
                  MAX_CONTENT_LENGTH=4_250_000,JSON_SORT_KEYS=False)
app.wsgi_app=ProxyFix(app.wsgi_app,x_for=1,x_proto=1,x_host=0)
db.init(DB)
IMAGE_DIR.mkdir(parents=True,exist_ok=True)
MODEL_DIR.mkdir(parents=True,exist_ok=True)

@app.before_request
def before():
    if request.path.startswith('/api/'):
        g.con=db.connect(DB)
        uid=session.get('uid')
        g.user=db.user_from_id(g.con,uid) if isinstance(uid,int) else None
        if g.user and (g.user['blocked_until']>int(time.time()) or session.get('revision',0)!=g.user['auth_revision']):
            session.clear();g.user=None
        # CSRF: all writes require same-origin custom header + Origin/Referer validation.
        if request.method not in ('GET','HEAD','OPTIONS'):
            origin=request.headers.get('Origin','')
            host=request.host_url.rstrip('/')
            if origin and origin.rstrip('/')!=host:abort(403)
            if request.headers.get('X-Free-Lab')!='1':abort(403)

@app.teardown_request
def close_db(e):
    con=getattr(g,'con',None)
    if con is not None:con.close()

def require_user(fn):
    @wraps(fn)
    def wrapper(*args,**kw):
        if not g.user:return jsonify(error='Sign in first'),401
        return fn(*args,**kw)
    return wrapper

def require_admin(fn):
    @wraps(fn)
    @require_user
    def wrapper(*args,**kw):
        if g.user['role']!='admin':abort(403)
        return fn(*args,**kw)
    return wrapper

def body():
    v=request.get_json(silent=True)
    if not isinstance(v,dict):abort(400)
    return v

def item_dict(row):
    result={k:row[k] for k in ('id','label','description','provider','visibility','created_at','capture_id','folder','shelf','parent_object_id','operation')}
    try:result['spatial']=json.loads(row['spatial_json'] or '{}')
    except (ValueError,TypeError):result['spatial']={}
    result['has_image']=bool(row['image_name'])
    return result

@app.get('/api/health')
def health():
    try:g.con.execute('SELECT 1').fetchone();ok=True
    except sqlite3.Error:ok=False
    return jsonify(ok=ok,version=VERSION,storage='sqlite',model=os.getenv('META_MODEL','muse-ember-1.0'),
      inference_enabled=bool(provider_key('meta')))

@app.get('/api/config')
def config():
    return jsonify(version=VERSION,model=os.getenv('META_MODEL','muse-ember-1.0'),
      inference_enabled=bool(provider_key('meta')),max_snapshots_per_day=application_inference_limits()['daily_cap'])

@app.get('/api/me')
def me():
    u=g.user
    return jsonify(user={k:u[k] for k in ('id','username','display_name','role')} if u else None)

@app.post('/api/login')
def login():
    v=body();name=str(v.get('username',''))[:64];pw=str(v.get('password',''))[:257]
    # Public HTTPS login endpoint: bounded attempts per source IP, across Gunicorn workers.
    fingerprint=hashlib.sha256((str(app.secret_key)+'|'+request.remote_addr).encode()).hexdigest()
    with g.con:
        g.con.execute("DELETE FROM auth_attempts WHERE julianday(created_at) < julianday('now')-1")
        attempts=g.con.execute("SELECT COUNT(*) FROM auth_attempts WHERE fingerprint=? AND julianday(created_at) > julianday('now')-(10.0/1440)",(fingerprint,)).fetchone()[0]
        if attempts>=15:return jsonify(error='Too many login attempts; try again later'),429
        g.con.execute('INSERT INTO auth_attempts(fingerprint) VALUES(?)',(fingerprint,))
    # uniform failure response; avoid nonexistent account enumeration
    u=db.user_from_name(g.con,name)
    dummy=db.hash_password('dummy-password') if u is None else u['password_hash']
    if not db.verify_password(pw,dummy) or not u: return jsonify(error='Invalid credentials'),401
    if u['blocked_until']>int(time.time()):return jsonify(error='Account temporarily blocked. Contact your administrator.'),403
    session.clear();session['uid']=u['id'];session['revision']=u['auth_revision']
    return jsonify(user={'id':u['id'],'username':u['username'],'display_name':u['display_name'],'role':u['role']})

@app.get('/api/me/avatar')
@require_user
def get_my_avatar():
    avatar=g.con.execute('SELECT mime,pixels FROM user_avatars WHERE user_id=?',(g.user['id'],)).fetchone()
    if not avatar:abort(404)
    response=send_file(io.BytesIO(avatar['pixels']),mimetype=avatar['mime'],max_age=0)
    response.headers['Cache-Control']='private, no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    return response

@app.put('/api/me/avatar')
@require_user
def set_my_avatar():
    raw_data=body().get('image','')
    if not isinstance(raw_data,str) or len(raw_data)>280000:
        return jsonify(error='Profile photo must be a small PNG or JPEG'),400
    match=re.fullmatch(r'data:(image/jpeg|image/png);base64,([A-Za-z0-9+/=]+)',raw_data)
    if not match:return jsonify(error='Use PNG or JPEG image data'),400
    try:payload=base64.b64decode(match.group(2),validate=True)
    except Exception:return jsonify(error='Invalid image encoding'),400
    mime=match.group(1)
    if len(payload)>190000 or len(payload)<48 or not ((mime=='image/png' and payload.startswith(b'\x89PNG\r\n\x1a\n')) or
                                                  (mime=='image/jpeg' and payload.startswith(b'\xff\xd8\xff'))):
        return jsonify(error='Invalid or oversized profile photo'),400
    with g.con:g.con.execute('''INSERT INTO user_avatars(user_id,mime,pixels) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,pixels=excluded.pixels,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',
      (g.user['id'],mime,payload))
    return jsonify(ok=True)

# Small, private GLB avatar. The full original, including rigging, is retained.
# XR guests receive only the bounded geometry preview; animated rigs are not yet synchronized.
MAX_AVATAR_GLB=2_000_000

def valid_avatar_glb(raw):
    if not isinstance(raw,bytes) or not 20<=len(raw)<=MAX_AVATAR_GLB:return False
    if raw[:4]!=b'glTF' or int.from_bytes(raw[4:8],'little')!=2 or int.from_bytes(raw[8:12],'little')!=len(raw):return False
    try:
        import struct
        chunk_len,chunk_type=struct.unpack_from('<I4s',raw,12)
        if chunk_type!=b'JSON' or chunk_len>500000 or 20+chunk_len>len(raw):return False
        document=json.loads(raw[20:20+chunk_len])
        if not isinstance(document,dict) or document.get('asset',{}).get('version')!='2.0':return False
        # Do not allow external URLs or embedded executable extensions in private shared-avatar files.
        for buff in document.get('buffers',[]):
            if 'uri' in buff:return False
        for image in document.get('images',[]):
            if 'uri' in image:return False
        return True
    except (ValueError,TypeError,KeyError,UnicodeError):return False

@app.put('/api/me/avatar-3d')
@require_user
def upload_3d_avatar():
    data=body().get('glb','')
    if not isinstance(data,str) or len(data)>2_800_000 or not data.startswith('data:model/gltf-binary;base64,'):
        return jsonify(error='Upload one self-contained GLB model no larger than 2 MB'),400
    try:raw=base64.b64decode(data.split(',',1)[1],validate=True)
    except (ValueError,base64.binascii.Error):return jsonify(error='Invalid GLB encoding'),400
    if not valid_avatar_glb(raw):return jsonify(error='Invalid, oversized or externally linked GLB avatar'),422
    with g.con:g.con.execute('''INSERT INTO user_avatar_models(user_id,glb) VALUES(?,?) ON CONFLICT(user_id)
      DO UPDATE SET glb=excluded.glb,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',(g.user['id'],raw))
    return jsonify(ok=True,bytes=len(raw),limit=MAX_AVATAR_GLB)

@app.get('/api/me/avatar-3d')
@require_user
def own_3d_avatar():
    row=g.con.execute('SELECT glb FROM user_avatar_models WHERE user_id=?',(g.user['id'],)).fetchone()
    if not row:abort(404)
    response=send_file(io.BytesIO(row['glb']),mimetype='model/gltf-binary',as_attachment=True,download_name='freelab-avatar.glb',max_age=0)
    response.headers['Cache-Control']='private, no-store';response.headers['X-Content-Type-Options']='nosniff'
    return response

@app.delete('/api/me/avatar-3d')
@require_user
def remove_3d_avatar():
    with g.con:g.con.execute('DELETE FROM user_avatar_models WHERE user_id=?',(g.user['id'],))
    return jsonify(ok=True)

@app.get('/api/me/avatar-3d/preview')
@require_user
def own_avatar_preview():
    row=g.con.execute('SELECT glb FROM user_avatar_models WHERE user_id=?',(g.user['id'],)).fetchone()
    if not row:abort(404)
    try:return jsonify(**glb_preview.decode(row['glb']))
    except (ValueError,KeyError,IndexError,TypeError) as e:return jsonify(error=str(e)),422

@app.post('/api/logout')
def logout():
    session.clear();return jsonify(ok=True)

@app.post('/api/admin/profiles')
@require_admin
def create_profile():
    v=body()
    try:uid=db.create_user(g.con,str(v.get('username','')),str(v.get('password','')),
                            str(v.get('display_name','')),role='member')
    except (ValueError,sqlite3.IntegrityError) as e:return jsonify(error=str(e)),400
    return jsonify(id=uid),201


@app.get('/api/admin/profiles')
@require_admin
def admin_list_profiles():
    rows=g.con.execute('SELECT id,username,display_name,role,created_at,blocked_until FROM users ORDER BY role DESC,id LIMIT 200').fetchall()
    return jsonify(users=[{**dict(row),'blocked':row['blocked_until']>int(time.time())} for row in rows])

@app.put('/api/admin/profiles/<int:uid>/password')
@require_admin
def admin_change_password(uid):
    v=body();password=v.get('password','')
    if not isinstance(password,str) or not 12<=len(password)<=256:return jsonify(error='Password must be 12–256 characters'),400
    if not g.con.execute('SELECT id FROM users WHERE id=?',(uid,)).fetchone():abort(404)
    with g.con:g.con.execute('UPDATE users SET password_hash=?,auth_revision=auth_revision+1 WHERE id=?',(db.hash_password(password),uid))
    return jsonify(ok=True,reauthentication_required=uid==g.user['id'])

@app.put('/api/admin/profiles/<int:uid>/block')
@require_admin
def admin_block_profile(uid):
    v=body();hours=v.get('hours')
    if type(hours) is not int or hours not in (0,1,24,168):return jsonify(error='Choose unblock, 1 hour, 24 hours, or 7 days'),400
    target=g.con.execute('SELECT id,role FROM users WHERE id=?',(uid,)).fetchone()
    if not target:abort(404)
    if uid==g.user['id'] or target['role']=='admin':return jsonify(error='Admin accounts cannot be blocked here'),403
    until=int(time.time()+hours*3600) if hours else 0
    with g.con:g.con.execute('UPDATE users SET blocked_until=?,auth_revision=auth_revision+1 WHERE id=?',(until,uid))
    return jsonify(ok=True,blocked_until=until)

@app.delete('/api/admin/profiles/<int:uid>')
@require_admin
def admin_delete_profile(uid):
    target=g.con.execute('SELECT role FROM users WHERE id=?',(uid,)).fetchone()
    if not target:abort(404)
    if target['role']=='admin' or uid==g.user['id']:return jsonify(error='Administrator accounts cannot be removed here'),403
    # Record filenames before cascade, delete only if the remaining DB has no references.
    filenames=[row[0] for row in g.con.execute('SELECT image_name FROM captures WHERE owner_id=? UNION SELECT image_name FROM objects WHERE owner_id=?',(uid,uid)) if row[0]]
    with g.con:g.con.execute('DELETE FROM users WHERE id=?',(uid,))
    for name in filenames:
        if not re.fullmatch('[a-f0-9]{32}\.(jpg|png)',name):continue
        if g.con.execute('SELECT 1 FROM captures WHERE image_name=? UNION SELECT 1 FROM objects WHERE image_name=?',(name,name)).fetchone():continue
        try:(IMAGE_DIR/name).unlink(missing_ok=True)
        except OSError:pass
    return jsonify(ok=True)

@app.get('/api/admin/providers')
@require_admin
def get_providers():
    return jsonify(providers=keyvault.status(g.con))

@app.put('/api/admin/providers/<provider>')
@require_admin
def save_provider(provider):
    if provider not in keyvault.PROVIDERS:abort(404)
    key=body().get('api_key')
    try:keyvault.set_key(g.con,provider,key)
    except ValueError as e:return jsonify(error=str(e)),400
    except (OSError,RuntimeError):return jsonify(error='Server vault unavailable: ask server administrator'),503
    return jsonify(ok=True,provider=provider,configured=True)

@app.delete('/api/admin/providers/<provider>')
@require_admin
def remove_provider(provider):
    if provider not in keyvault.PROVIDERS:abort(404)
    keyvault.delete_key(g.con,provider)
    return jsonify(ok=True,provider=provider)

@app.post('/api/admin/providers/<provider>/check')
@require_admin
def check_provider(provider):
    if provider not in keyvault.PROVIDERS:abort(404)
    supplied=body().get('api_key')
    if supplied is not None and (not isinstance(supplied,str) or len(supplied)>4096 or len(supplied)<12):
        return jsonify(error='Invalid temporary key'),400
    key=supplied or keyvault.get_key(g.con,provider) or (os.getenv('MODEL_API_KEY','') if provider=='meta' else '')
    if not key:return jsonify(error='Choose a session key or save a server key first'),400
    result=provider_checks.check(provider,key)
    return jsonify(result)

def provider_key(provider):
    """Admin vault keys are private by default. Shared scope requires admin opt-in."""
    if not g.user:return None
    if g.user['role']!='admin':
        record=g.con.execute('SELECT shared FROM provider_scopes WHERE provider=?',(provider,)).fetchone()
        if not record or record['shared']!=1:return None
    return keyvault.get_meta_key(g.con) if provider=='meta' else keyvault.get_key(g.con,provider)

@app.get('/api/admin/provider-scopes')
@require_admin
def provider_scopes():
    rows=g.con.execute('SELECT provider,shared FROM provider_scopes').fetchall()
    return jsonify(scopes={r['provider']:bool(r['shared']) for r in rows})

@app.put('/api/admin/provider-scopes/<provider>')
@require_admin
def update_provider_scope(provider):
    if provider not in keyvault.PROVIDERS:abort(404)
    v=body()
    if type(v.get('shared')) is not bool:return jsonify(error='Shared must be true or false'),400
    with g.con:
        g.con.execute('INSERT INTO provider_scopes(provider,shared) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET shared=excluded.shared',(provider,int(v['shared'])))
    return jsonify(provider=provider,shared=v['shared'])

def preferred_3d_provider():
    r=g.con.execute('SELECT model_3d FROM profile_settings WHERE user_id=?',(g.user['id'],)).fetchone()
    value=r['model_3d'] if r else 'auto'
    if value=='auto':
        return 'aholo' if provider_key('aholo') else 'meshy'
    return value

@app.route('/api/preferences/3d',methods=['GET','PUT'])
@require_user
def model_3d_preference():
    if request.method=='GET':
        return jsonify(provider=preferred_3d_provider(),available={k:bool(provider_key(k)) for k in ('aholo','meshy')})
    v=body();value=v.get('provider')
    if value not in ('auto','aholo','meshy'):return jsonify(error='Choose Aholo or Meshy'),400
    with g.con:
        g.con.execute('INSERT INTO profile_settings(user_id,model_3d) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET model_3d=excluded.model_3d',(g.user['id'],value))
    return jsonify(provider=preferred_3d_provider())

@app.get('/api/usage')
@require_user
def usage():
    global_used=g.con.execute("SELECT COUNT(*) AS n FROM inference_calls WHERE julianday(created_at)>=julianday('now')-1").fetchone()['n']
    mine=g.con.execute("SELECT COUNT(*) AS n FROM inference_calls WHERE user_id=? AND julianday(created_at)>=julianday('now')-1",(g.user['id'],)).fetchone()['n']
    recent=g.con.execute("SELECT provider,status,created_at,usage_json FROM inference_calls WHERE user_id=? ORDER BY id DESC LIMIT 20",(g.user['id'],)).fetchall()
    return jsonify(global_last_24h=global_used,user_last_24h=mine,
        global_cap=application_inference_limits()['daily_cap'],
        user_cap=application_inference_limits()['user_cap'],
        hard_dollar_cap=False,
        recent=[{'provider':r['provider'],'status':r['status'],'time':r['created_at'],
                 'tokens':json.loads(r['usage_json'] or '{}')} for r in recent])


def request_meta_key(v):
    temp=v.get('session_api_key')
    if temp is not None:
        if not g.user or g.user['role']!='admin' or not isinstance(temp,str) or not 12<=len(temp)<=4096:
            abort(403)
        return temp
    return provider_key('meta')

@app.post('/api/segment')
@require_user
def segment_image():
    v=body()
    cid=v.get('capture_id')
    if cid is not None:
        if type(cid) is not int or not g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone():
            return jsonify(error='Capture is not owned by this profile'),403
    parent_id=v.get('object_id')
    if parent_id is not None:
        if type(parent_id) is not int or not cid:
            return jsonify(error='A valid source object and capture are required'),400
        src=g.con.execute('SELECT image_name FROM objects WHERE id=? AND capture_id=? AND owner_id=? AND shelf!=?',
                          (parent_id,cid,g.user['id'],'bin')).fetchone()
        if not src or not src['image_name']:
            return jsonify(error='Selected object is unavailable for this profile'),404
        source=IMAGE_DIR/src['image_name']
        if not source.is_file():return jsonify(error='Selected image missing from server'),404
        raw=source.read_bytes()
        if len(raw)>10_000_000 or not (raw.startswith(b'\xff\xd8') or raw.startswith(b'\x89PNG\r\n\x1a\n')):
            return jsonify(error='Selected object must be a saved image'),422
    else:
        try:raw=decode_jpeg(v)
        except ValueError as e:return jsonify(error=str(e)),400
    prompt=str(v.get('prompt','')).strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9 -]{0,58}[a-z0-9]',prompt):
        return jsonify(error='Use one object noun phrase (2–60 characters)'),400
    api_key=request_meta_key(v)
    if not api_key:return jsonify(error='Meta key not configured'),503
    digest=hashlib.sha256(raw+prompt.encode()).hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'sam-3.1',
       daily_cap=application_inference_limits()['daily_cap'],
       user_cap=application_inference_limits()['user_cap'])
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        from PIL import Image, ImageOps
        model_jpeg=sam.jpeg_for_model(raw)
        result=sam.segment_jpeg(model_jpeg,prompt,api_key)
        regions=result.pop('_regions',[])
        db.finish_inference(g.con,call,'ok',result.get('usage'))
        result['saved_ids']=[]
        if v.get('save') is True and regions:
            Image.MAX_IMAGE_PIXELS=12_000_000
            photo=Image.open(io.BytesIO(raw))
            if photo.width*photo.height>12_000_000:
                raise ValueError('Image resolution exceeds safe segmentation size')
            for region in regions[:8]:
                masked=v.get('cutouts') is not False
                try:content=sam.cutout_png(photo,region) if masked else sam.rectangle_jpeg(photo,region)
                except ValueError:continue
                name=secrets.token_hex(16)+('.png' if masked else '.jpg');out=IMAGE_DIR/name
                out.write_bytes(content)
                try:
                    with g.con:
                        oid=g.con.execute('''INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id,parent_object_id,operation)
                          VALUES(?,?,?,?,?,?,?,?,?)''',
                        (g.user['id'],prompt,'SAM 3.1 cutout' if masked else 'SAM 3.1 rectangular crop',
                         'sam-3.1-mask' if masked else 'sam-3.1-box',name,hashlib.sha256(content).hexdigest(),cid,parent_id,'segmentation')).lastrowid
                    result['saved_ids'].append(oid)
                except Exception:
                    out.unlink(missing_ok=True)
                    raise
        result['cutouts_saved']=len(result['saved_ids']) if v.get('cutouts') is not False else 0
        result['rectangular_crops']=len(result['saved_ids']) if v.get('cutouts') is False else 0
        return jsonify(result)
    except (RuntimeError,ValueError) as e:
        db.finish_inference(g.con,call,'error')
        return jsonify(error=str(e)),502


@app.get('/api/captures')
@require_user
def capture_clouds():
    rows=g.con.execute('SELECT * FROM captures WHERE owner_id=? ORDER BY id DESC',(g.user['id'],)).fetchall()
    result=[]
    for row in rows:
        items=g.con.execute('SELECT * FROM objects WHERE owner_id=? AND capture_id=? ORDER BY id',(g.user['id'],row['id'])).fetchall()
        result.append({'id':row['id'],'image_url':f'/api/captures/{row["id"]}/image',
           'created_at':row['created_at'],'collapsed':bool(row['collapsed']),'hidden':bool(row['hidden']),
           'spatial':json.loads(row['spatial_json'] or '{}'),'description':row['description'],'objects':[item_dict(obj) for obj in items]})
    return jsonify(captures=result)

@app.post('/api/captures')
@require_user
def save_capture_cloud():
    v=body()
    try:raw=decode_jpeg(v)
    except ValueError as e:return jsonify(error=str(e)),400
    name=secrets.token_hex(16)+'.jpg';dest=IMAGE_DIR/name;dest.write_bytes(raw)
    try:
        with g.con:
            cid=g.con.execute('INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)',
                  (g.user['id'],name,hashlib.sha256(raw).hexdigest())).lastrowid
    except Exception:
        dest.unlink(missing_ok=True);raise
    return jsonify(id=cid,image_url=f'/api/captures/{cid}/image',created=True),201

@app.get('/api/captures/<int:cid>/image')
@require_user
def capture_cloud_image(cid):
    row=g.con.execute('SELECT image_name FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone()
    if not row:abort(404)
    path=IMAGE_DIR/row['image_name']
    if not path.is_file():abort(404)
    response=send_file(path,mimetype='image/jpeg',conditional=True,max_age=0,as_attachment=request.args.get('download')=='1',download_name=f'freelab-source-{cid}.jpg')
    response.headers['Cache-Control']='private, no-store'
    return response

@app.patch('/api/captures/<int:cid>')
@require_user
def update_capture_cloud(cid):
    v=body();fields=[];values=[]
    for field in ('hidden','collapsed'):
        if field in v:
            if type(v[field]) is not bool:return jsonify(error='Capture flag must be boolean'),400
            fields.append(field+'=?');values.append(int(v[field]))
    if 'spatial' in v:
        c=v['spatial']
        allowed={'x':(-3,3),'y':(-3,3),'z':(-3,3),'qx':(-1,1),'qy':(-1,1),'qz':(-1,1),'qw':(-1,1)}
        if (not isinstance(c,dict) or not {'x','y','z'}.issubset(c) or set(c)-set(allowed)
            or (set(c)&{'qx','qy','qz','qw'} and not {'qx','qy','qz','qw'}.issubset(c))
            or any(type(n) not in (int,float) or not allowed[k][0]<=n<=allowed[k][1] for k,n in c.items())):
            return jsonify(error='Invalid capture transform'),400
        fields.append('spatial_json=?');values.append(json.dumps(c))
    if not fields:return jsonify(error='No supported capture update'),400
    with g.con:
        changed=g.con.execute('UPDATE captures SET '+','.join(fields)+' WHERE id=? AND owner_id=?',
                             (*values,cid,g.user['id'])).rowcount
    if not changed:abort(404)
    return jsonify(ok=True)

@app.get('/api/objects')
@require_user
def objects():
    rows=g.con.execute('SELECT * FROM objects WHERE owner_id=? ORDER BY id DESC LIMIT 200',(g.user['id'],)).fetchall()
    return jsonify(objects=[item_dict(row) for row in rows])

@app.get('/api/public')
def public():
    rows=g.con.execute("SELECT objects.*,users.display_name AS owner FROM objects JOIN users ON users.id=objects.owner_id WHERE objects.visibility='public' ORDER BY objects.id DESC LIMIT 100").fetchall()
    return jsonify(objects=[dict(item_dict(r),owner=r['owner']) for r in rows])

@app.get('/api/objects/<int:oid>/image')
def image(oid):
    row=g.con.execute('SELECT * FROM objects WHERE id=?',(oid,)).fetchone()
    if not row or not row['image_name']:abort(404)
    user=getattr(g,'user',None)
    if row['visibility']!='public' and (not user or user['id']!=row['owner_id']):abort(404)
    path=IMAGE_DIR/row['image_name']
    if not path.is_file():abort(404)
    return send_file(path,mimetype='image/png' if path.suffix.lower()=='.png' else 'image/jpeg',conditional=True,max_age=0,as_attachment=request.args.get('download')=='1',download_name=f'freelab-object-{oid}'+path.suffix.lower())

@app.get('/api/shared/<token>')
def shared(token):
    if not re.fullmatch('[A-Za-z0-9_-]{32,80}',token):abort(404)
    digest=hashlib.sha256(token.encode()).hexdigest()
    row=g.con.execute("SELECT objects.*,users.display_name AS owner FROM objects JOIN users ON users.id=objects.owner_id WHERE share_hash=? AND visibility='link'",(digest,)).fetchone()
    if not row:abort(404)
    return jsonify(object=dict(item_dict(row),owner=row['owner']))

@app.get('/api/shared/<token>/image')
def shared_image(token):
    if not re.fullmatch('[A-Za-z0-9_-]{32,80}',token):abort(404)
    digest=hashlib.sha256(token.encode()).hexdigest()
    row=g.con.execute("SELECT image_name FROM objects WHERE share_hash=? AND visibility='link'",(digest,)).fetchone()
    if not row or not row['image_name']:abort(404)
    return send_file(IMAGE_DIR/row['image_name'],mimetype='image/png' if row['image_name'].endswith('.png') else 'image/jpeg',max_age=0)

@app.post('/api/objects')
@require_user
def create_object():
    v=body();label=str(v.get('label','')).strip()[:80]
    if not label:return jsonify(error='Object label required'),400
    description=str(v.get('description',''))[:240]
    with g.con:
        oid=g.con.execute('INSERT INTO objects(owner_id,label,description) VALUES(?,?,?)',
                          (g.user['id'],label,description)).lastrowid
    return jsonify(id=oid),201

@app.patch('/api/objects/<int:oid>')
@require_user
def update_object(oid):
    v=body()
    fields=[];args=[];token=None
    if 'visibility' in v:
        mode=v['visibility']
        if mode not in ('private','public','link'):return jsonify(error='Invalid visibility'),400
        token=secrets.token_urlsafe(32) if mode=='link' else None
        hashed=hashlib.sha256(token.encode()).hexdigest() if token else None
        fields.extend(('visibility=?','share_hash=?'));args.extend((mode,hashed))
    if 'folder' in v:
        folder=str(v['folder']).strip()[:32]
        if not re.fullmatch(r'[A-Za-z0-9 _-]{1,32}',folder):return jsonify(error='Invalid folder'),400
        fields.append('folder=?');args.append(folder)
    if 'shelf' in v:
        if v['shelf'] not in ('collection','bin'):return jsonify(error='Invalid shelf'),400
        fields.append('shelf=?');args.append(v['shelf'])
        if v['shelf']=='bin':fields.extend(('visibility=?','share_hash=?'));args.extend(('private',None))
    if 'spatial' in v:
        value=v['spatial']
        if not isinstance(value,dict) or set(value)-{'x','y','z','scale','rotation','qx','qy','qz','qw'}:
            return jsonify(error='Invalid spatial transform'),400
        allowed={'x':(-2.5,2.5),'y':(-2.0,2.0),'z':(-1.5,1.5),'scale':(.45,3),'rotation':(-6.29,6.29),'qx':(-1,1),'qy':(-1,1),'qz':(-1,1),'qw':(-1,1)}
        for k,x in value.items():
            lo,hi=allowed[k]
            if type(x) not in (float,int) or not lo<=x<=hi:
                return jsonify(error='Transform out of bounds'),400
        fields.append('spatial_json=?');args.append(json.dumps(value))
    if not fields:return jsonify(error='No supported update'),400
    with g.con:
        changed=g.con.execute('UPDATE objects SET '+','.join(fields)+' WHERE id=? AND owner_id=?',
                             (*args,oid,g.user['id'])).rowcount
    if not changed:abort(404)
    return jsonify(ok=True,share_token=token)

@app.delete('/api/objects/<int:oid>')
@require_user
def delete_object(oid):
    with g.con:
        row=g.con.execute('SELECT image_name FROM objects WHERE id=? AND owner_id=?',(oid,g.user['id'])).fetchone()
        if not row:abort(404)
        g.con.execute('DELETE FROM objects WHERE id=? AND owner_id=?',(oid,g.user['id']))
    if row['image_name']:
        try:(IMAGE_DIR/row['image_name']).unlink(missing_ok=True)
        except OSError:pass
    return jsonify(ok=True)

def decode_jpeg(v):
    image=v.get('image','')
    if not isinstance(image,str) or len(image)>620_000:raise ValueError('Image must be a compressed JPEG under 450KB')
    if not image.startswith('data:image/jpeg;base64,'):raise ValueError('Expected JPEG data URL')
    try:raw=base64.b64decode(image.split(',',1)[1],validate=True)
    except (ValueError,base64.binascii.Error):raise ValueError('Invalid image encoding')
    if len(raw)>450_000 or len(raw)<100 or not (raw.startswith(b'\xff\xd8') and raw.endswith(b'\xff\xd9')):raise ValueError('Invalid or oversized JPEG')
    return raw

def application_inference_limits():
    """No implicit paid-request quota. Opt in through the protected server environment."""
    if os.getenv('FREE_LAB_ENFORCE_INFERENCE_LIMITS','0').strip().lower() not in ('1','true','yes','on'):
        return {'daily_cap':0,'user_cap':0,'cooldown':0}
    return {'daily_cap':max(0,int(os.getenv('FREE_LAB_DAILY_LIMIT','0'))),
            'user_cap':max(0,int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0'))),
            'cooldown':max(0,int(os.getenv('FREE_LAB_COOLDOWN_SECONDS','0')))}

@app.post('/api/capture')
@require_user
def capture():
    v=body()
    cid=v.get('capture_id')
    if cid is not None:
        if type(cid) is not int or not g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone():
            return jsonify(error='Capture is not owned by this profile'),403
    parent_id=v.get('object_id')
    source_original=None
    if parent_id is not None:
        if type(parent_id) is not int or not cid:
            return jsonify(error='A private capture and selected object are required'),400
        src=g.con.execute('SELECT image_name FROM objects WHERE id=? AND capture_id=? AND owner_id=? AND shelf!=?',
                          (parent_id,cid,g.user['id'],'bin')).fetchone()
        if not src or not src['image_name']:
            return jsonify(error='Selected object is not available for this profile'),404
        source_path=IMAGE_DIR/src['image_name']
        if not source_path.is_file():return jsonify(error='Selected object image missing'),404
        raw=source_path.read_bytes()
        if not 100<len(raw)<=10_000_000 or not (raw.startswith(b'\xff\xd8') or raw.startswith(b'\x89PNG\r\n\x1a\n')):
            return jsonify(error='Selected object must be a saved JPEG or PNG'),422
        source_original=raw
        raw=sam.jpeg_for_model(raw)
    else:
        try:raw=decode_jpeg(v)
        except ValueError as e:return jsonify(error=str(e)),400
    if source_original is None:source_original=raw
    digest=hashlib.sha256(raw).hexdigest()
    use_model=v.get('recognize') is True
    if use_model and not request_meta_key(v):
        return jsonify(error='Meta API key not configured. Save a manual snapshot instead.'),503
    # For a manual snapshot, use a user-supplied label. Never pretend a mock prediction is AI.
    if not use_model and not str(v.get('label','')).strip():
        return jsonify(error='Label required for manual snapshot'),400
    detections=[];usage={};call=None;model='manual'
    if use_model:
        model=str(v.get('model') or os.getenv('META_MODEL','muse-ember-1.0'))
        if model not in providers.MODEL_IDS:return jsonify(error='Unsupported Muse model'),400
        try:call=db.begin_inference(g.con,g.user['id'],digest,model,
                  daily_cap=application_inference_limits()['daily_cap'],
                  user_cap=application_inference_limits()['user_cap'])
        except ValueError as e:return jsonify(error=str(e)),429
        try:
            detections,usage=providers.identify(raw,model,api_key=request_meta_key(v))
            db.finish_inference(g.con,call,'ok',usage)
        except Exception as e:
            db.finish_inference(g.con,call,'error')
            return jsonify(error=str(e)),502
        if not detections:return jsonify(error='No recognizable objects found; nothing stored'),422
    else: detections=[{'label':str(v['label']).strip()[:80],'description':str(v.get('description',''))[:240],'box':None}]
    ids=[]
    # Muse's approximate 0-1000 boxes produce tangible image cards. These are
    # rough bounding-box crops, NOT pixel-accurate SAM masks.
    source=None
    if use_model:
        from PIL import Image,ImageOps
        Image.MAX_IMAGE_PIXELS=12_000_000
        try:
            im=Image.open(io.BytesIO(source_original))
            if im.width*im.height>12_000_000:return jsonify(error='Image pixels exceed 12 million'),400
            source=ImageOps.exif_transpose(im).convert('RGBA')
        except Exception:return jsonify(error='Cannot decode capture JPEG'),400
    regions_by_id={}
    if use_model and v.get('cutouts') is True and source is not None:
        # A single paid SAM request receives up to 8 Muse candidate boxes, rather
        # than one costly model call per object. The mask refines each box.
        prompt_boxes=[];indices=[]
        for idx,item in enumerate(detections[:8]):
            bounds=item.get('box')
            if not isinstance(bounds,(list,tuple)) or len(bounds)!=4:continue
            try:
                a,b,c,d=[int(x) for x in bounds]
                box=(max(0,int(a*source.width/1000)),max(0,int(b*source.height/1000)),
                     min(source.width,int(c*source.width/1000)+1),min(source.height,int(d*source.height/1000)+1))
            except (TypeError,ValueError):continue
            if box[2]-box[0]<4 or box[3]-box[1]<4:continue
            prompt_boxes.append(box);indices.append(idx)
        if prompt_boxes:
            try:mask_call=db.begin_inference(g.con,g.user['id'],hashlib.sha256(raw+b'|sam-cutouts|'+secrets.token_bytes(12)).hexdigest(),
                  'sam-3.1',daily_cap=application_inference_limits()['daily_cap'],user_cap=application_inference_limits()['user_cap'])
            except ValueError as e:return jsonify(error='SAM mask call not permitted: '+str(e)),429
            try:
                response=sam.segment_jpeg(sam.jpeg_for_model(raw),'',request_meta_key(v),object_boxes=prompt_boxes)
                for region in response.pop('_regions',[]):
                    if region['object_id'].isdigit():
                        n=int(region['object_id'])
                        if n<len(indices):regions_by_id[indices[n]]=region
                db.finish_inference(g.con,mask_call,'ok',response.get('usage'))
            except (RuntimeError,ValueError) as e:
                db.finish_inference(g.con,mask_call,'error')
                return jsonify(error='Object detection worked, but SAM cutouts failed: '+str(e)),502
    cutout_count=0
    with g.con:
        for idx,obj in enumerate(detections):
            content=raw
            box=obj.get('box')
            region=regions_by_id.get(idx)
            if region is not None:
                try:content=sam.cutout_png(source,region);cutout_count+=1
                except ValueError:region=None
            if region is None and source is not None and box and box!=[0,0,1000,1000]:
                x1,y1,x2,y2=box
                pad=32
                left=max(0,int((x1-pad)*source.width/1000));top=max(0,int((y1-pad)*source.height/1000))
                right=min(source.width,int((x2+pad)*source.width/1000));bottom=min(source.height,int((y2+pad)*source.height/1000))
                if right-left>=12 and bottom-top>=12:
                    crop=source.crop((left,top,right,bottom));crop.thumbnail((800,800))
                    mem=io.BytesIO();crop.convert('RGB').save(mem,format='JPEG',quality=77,optimize=True)
                    content=mem.getvalue()
            name=secrets.token_hex(16)+('.png' if region is not None else '.jpg');path=IMAGE_DIR/name;path.write_bytes(content)
            try:
                oid=g.con.execute('''INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id,parent_object_id,operation)
                  VALUES(?,?,?,?,?,?,?,?,?)''',
                  (g.user['id'],obj['label'],obj['description'],model+'+sam-3.1-mask' if region is not None else model,name,hashlib.sha256(content).hexdigest(),cid,
                   parent_id,'nested_extraction' if parent_id is not None else 'recognition')).lastrowid
            except Exception:
                path.unlink(missing_ok=True);raise
            ids.append(oid)
    return jsonify(ids=ids,objects=detections,provider=model,usage=usage,cutouts_saved=cutout_count,rectangular_crops=len(ids)-cutout_count),201


# Image operations use a capability router. Only image-edit is live in this release;
# unsupported media types return an explicit error before reserving billable usage.
# Bounded process-local server request diagnostics. Per-worker, never a full systemd journal.
from collections import deque
import time as _diagnostic_time
from threading import Lock as _DiagnosticLock
_DIAGNOSTICS=deque(maxlen=90)
_DIAGNOSTICS_LOCK=_DiagnosticLock()
@app.before_request
def diagnostic_clock():
    if request.path.startswith('/api/'):
        g._api_started=_diagnostic_time.monotonic()

@app.after_request
def diagnostic_response(response):
    if hasattr(g,'_api_started') and request.path not in ('/api/health', '/api/admin/diagnostics'):
        path=request.path
        # Avoid logging user-provided names, query values or secret identifiers.
        import re as _re
        path=_re.sub(r'/\d+(?=/|$)','/:id',path)
        path=_re.sub(r'/admin/providers/[^/]+','/admin/providers/:provider',path)
        entry={'time':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='seconds'),
               'method':request.method,'path':path[:100],'status':response.status_code,
               'duration_ms':round((_diagnostic_time.monotonic()-g._api_started)*1000)}
        with _DIAGNOSTICS_LOCK:_DIAGNOSTICS.append(entry)
    return response

@app.get('/api/admin/diagnostics')
@require_admin
def admin_diagnostics():
    with _DIAGNOSTICS_LOCK:recent=list(_DIAGNOSTICS)[-35:]
    return jsonify(entries=recent,scope='current Python worker only',notice='No payloads, image content, credentials or prompts are collected.')

@app.get('/api/media/capabilities')
@require_user
def media_capabilities():
    return jsonify(image_edit={'meta':{'model':'muse-image-1.0','available':bool(provider_key('meta'))}},
                   speech={'meta':{'model':'muse-voice-transcribe-1.0','available':bool(provider_key('meta'))}},
                   video={},three_d={p:{'available':bool(provider_key(p)),'async':True} for p in ('aholo','meshy')},message='3D provider preference selects Aholo or Meshy; no silent fallback.')

def job_3d_dict(row):
    return {'id':row['id'],'capture_id':row['capture_id'],'object_id':row['object_id'],
            'provider':row['provider'],'status':row['status'],'progress':row['progress'],
            'credits':row['credits'],'thumbnail_url':row['thumbnail_url'],
            'error':row['error'],'created_at':row['created_at'],
            'cached':bool(row['model_path']),'cache_error':row['cache_error'],
            'glb_url':('/api/media/3d/'+str(row['id'])+'/asset' if row['model_path'] else row['glb_url'])}

@app.get('/api/media/3d')
@require_user
def jobs_3d():
    rows=g.con.execute('SELECT * FROM jobs_3d WHERE owner_id=? ORDER BY id DESC LIMIT 500',(g.user['id'],)).fetchall()
    return jsonify(jobs=[job_3d_dict(row) for row in rows])

@app.get('/api/media/3d/check')
@require_user
def media_3d_check():
    """Read-only capability test, no provider calls or credits charged."""
    provider=preferred_3d_provider()
    jobs=g.con.execute('SELECT id,status,error,created_at FROM jobs_3d WHERE owner_id=? AND provider=? ORDER BY id DESC LIMIT 3',
                       (g.user['id'],provider)).fetchall()
    return jsonify(provider=provider,configured=bool(provider_key(provider)),billable=False,
        notice='Configuration check only; a real generation requires confirming a paid task.',
        recent=[{'id':r['id'],'status':r['status'],'error':r['error'],'created_at':r['created_at']} for r in jobs])

@app.get('/api/media/3d/source/<token>')
def signed_3d_source(token):
    """Private JPEG made temporarily fetchable by a selected 3D provider only.
    Signed URLs expire in two hours; ordinary capture endpoints remain authenticated.
    """
    try:info=URLSafeTimedSerializer(str(app.secret_key),salt='freelab-aholo-image-v1').loads(token,max_age=7200)
    except (BadSignature,SignatureExpired):abort(404)
    with db.connect(DB) as con:
        if info.get('oid'):
            row=con.execute('SELECT image_name FROM objects WHERE id=? AND capture_id=? AND owner_id=? AND shelf!=?',
                 (info['oid'],info['cid'],info['uid'],'bin')).fetchone()
        else:
            row=con.execute('SELECT image_name FROM captures WHERE id=? AND owner_id=? AND hidden=0',(info['cid'],info['uid'])).fetchone()
    if not row or not (IMAGE_DIR/row['image_name']).is_file():abort(404)
    resp=send_file(IMAGE_DIR/row['image_name'],mimetype='image/png' if row['image_name'].endswith('.png') else 'image/jpeg',max_age=0)
    resp.headers['Cache-Control']='private, no-store';return resp

@app.post('/api/media/3d')
@require_user
def media_3d_start():
    v=body()
    if v.get('confirm_paid') is not True:return jsonify(error='Explicit paid-task confirmation required'),400
    provider=preferred_3d_provider()
    if v.get('provider') not in (None,'auto',provider):return jsonify(error='Provider selection changed. Reopen 3D settings to confirm.'),409
    prompt=v.get('prompt','')
    if not isinstance(prompt,str) or len(prompt)>750:
        return jsonify(error='3D guidance must be at most 750 characters'),400
    cid=v.get('capture_id');oid=v.get('object_id')
    if type(cid) is not int or cid<=0:return jsonify(error='Capture ID required'),400
    cap=g.con.execute('SELECT image_name FROM captures WHERE id=? AND owner_id=? AND hidden=0',(cid,g.user['id'])).fetchone()
    if not cap:abort(404)
    name=cap['image_name']
    if oid is not None:
        if type(oid) is not int or oid<=0:return jsonify(error='Invalid object ID'),400
        obj=g.con.execute('SELECT image_name FROM objects WHERE id=? AND capture_id=? AND owner_id=? AND shelf!=?',(oid,cid,g.user['id'],'bin')).fetchone()
        if not obj or not obj['image_name']:abort(404)
        name=obj['image_name']
    if provider!='aholo' and prompt.strip():
        return jsonify(error='Text-guided 3D requires Aholo. Switch 3D provider in Settings; no paid task submitted.'),422
    key=provider_key(provider)
    if not key:return jsonify(error=f'{provider.upper()} is not configured or not shared with this profile. Check Admin → API scope.'),503
    raw=sam.jpeg_for_model((IMAGE_DIR/name).read_bytes())
    digest=hashlib.sha256(raw+secrets.token_bytes(16)+provider.encode()).hexdigest()
    limits=application_inference_limits()
    try:call=db.begin_inference(g.con,g.user['id'],digest,provider+'-image-to-3d',daily_cap=limits['daily_cap'],user_cap=limits['user_cap'],cooldown=limits['cooldown'])
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        if provider=='aholo':
            task=aholo3d.submit_image(raw,key,prompt.strip())
        else:task=meshy3d.submit(raw,key)
        with g.con:
            job=g.con.execute("INSERT INTO jobs_3d(owner_id,capture_id,object_id,provider,provider_task) VALUES(?,?,?,?,?)",(g.user['id'],cid,oid,provider,task)).lastrowid
        db.finish_inference(g.con,call,'ok')
        return jsonify(id=job,status='PENDING',provider=provider,paid_task_submitted=True),202
    except (ValueError,RuntimeError,OSError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502

@app.get('/api/media/3d/<int:jid>')
@require_user
def media_3d_status(jid):
    row=g.con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    # The read-only status call never creates an additional billable task.
    if row['status'] in ('PENDING','IN_PROGRESS','UNKNOWN') or (row['status']=='SUCCEEDED' and request.args.get('refresh')=='1'):
        key=provider_key(row['provider'])
        if not key:return jsonify(error=row['provider'].upper()+' key missing: cannot poll task'),503
        try:info=(aholo3d.status(row['provider_task'],key) if row['provider']=='aholo' else meshy3d.status(row['provider_task'],key))
        except (RuntimeError,ValueError) as e:return jsonify(error=str(e)),502
        with g.con:
            g.con.execute('''UPDATE jobs_3d SET status=?,progress=?,credits=?,glb_url=?,thumbnail_url=?,error=?,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_id=?''',
                  (info['status'],info['progress'],info['credits'],info['glb_url'],info['thumbnail_url'],info['error'],jid,g.user['id']))
        row=g.con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if row['status']=='SUCCEEDED' and row['glb_url'] and not row['model_path'] and (not row['cache_error'] or request.args.get('refresh')=='1'):
        try:
            filename=model_cache.store(row['glb_url'],row['provider'],MODEL_DIR,g.user['id'],jid)
            with g.con:g.con.execute('UPDATE jobs_3d SET model_path=?,cache_error=? WHERE id=? AND owner_id=?',(filename,'',jid,g.user['id']))
        except (ValueError,OSError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError) as e:
            with g.con:g.con.execute('UPDATE jobs_3d SET cache_error=? WHERE id=? AND owner_id=?',(str(e)[:200],jid,g.user['id']))
        row=g.con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    return jsonify(job_3d_dict(row))


@app.get('/api/media/3d/<int:jid>/asset')
@require_user
def private_3d_asset(jid):
    row=g.con.execute('SELECT model_path FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    name=row['model_path']
    if not name or not re.fullmatch(r'[0-9]+_[0-9]+\.glb',name) or name!=f'{g.user["id"]}_{jid}.glb':abort(404)
    file=MODEL_DIR/name
    if not file.is_file():abort(404)
    resp=send_file(file,mimetype='model/gltf-binary',as_attachment=True,download_name=f'freelab-model-{jid}.glb')
    resp.headers['Cache-Control']='private, no-store'
    return resp

@app.get('/api/media/3d/<int:jid>/preview')
@require_user
def media_3d_preview(jid):
    """Return small bounded geometry, not a 20-100MB textured model to Quest."""
    row=g.con.execute('SELECT status,provider,glb_url,model_path FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    if row['status']!='SUCCEEDED' or not (row['model_path'] or (meshy3d.safe_file_url(row['glb_url']) if row['provider']=='meshy' else aholo3d.safe_preview_url(row['glb_url']))):
        return jsonify(error='3D model not ready for preview'),409
    try:
        if row['model_path']:
            if row['model_path']!=f'{g.user["id"]}_{jid}.glb':abort(404)
            raw=(MODEL_DIR/row['model_path']).read_bytes()
        else:
            req=urllib.request.Request(row['glb_url'],headers={'User-Agent':'FREELAB-GeometryPreview/0.10'})
            opener=urllib.request.build_opener(meshy3d.NoRedirect)
            with opener.open(req,timeout=18) as response:
                if response.headers.get('Content-Length') and int(response.headers['Content-Length'])>glb_preview.MAX_FILE:
                    return jsonify(error='3D model larger than the safe XR preview limit; use Library download'),413
                raw=response.read(glb_preview.MAX_FILE+1)
        geometry=glb_preview.decode(raw)
        return jsonify(**geometry)
    except urllib.error.HTTPError as e:return jsonify(error=f'3D model download HTTP {e.code}; renew the link in Library'),502
    except (ValueError,OSError,KeyError,IndexError,TypeError) as e:return jsonify(error=str(e)),422

@app.post('/api/media/edit')
@require_user
def media_edit():
    v=body()
    prompt=v.get('prompt')
    if not isinstance(prompt,str) or not 3<=len(prompt.strip())<=750:
        return jsonify(error='Prompt must be 3–750 characters'),400
    if v.get('kind','image')!='image':return jsonify(error='Only image editing is connected. No provider charged.'),422
    if v.get('provider','meta')!='meta':return jsonify(error='Image provider not connected yet. Select Meta; no request charged.'),422
    cid=v.get('capture_id');oid=v.get('object_id')
    if type(cid) is not int or cid<=0:return jsonify(error='Select a private capture first'),400
    cap=g.con.execute('SELECT * FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone()
    if not cap:abort(404)
    source_name=cap['image_name'];parent=None;label='Capture '+str(cid)
    if oid is not None:
        if type(oid) is not int or oid<=0:return jsonify(error='Invalid object ID'),400
        obj=g.con.execute('SELECT * FROM objects WHERE id=? AND owner_id=? AND capture_id=?',(oid,g.user['id'],cid)).fetchone()
        if not obj or not obj['image_name'] or obj['shelf']=='bin':abort(404)
        source_name=obj['image_name'];parent=oid;label=obj['label']
    mix_sources=v.get('mix_sources',[])
    if not isinstance(mix_sources,list) or (mix_sources and len(mix_sources)!=2):
        return jsonify(error='Mix requires exactly two source cards'),400
    raws=[]
    if mix_sources:
        seen=set()
        for source in mix_sources:
            if not isinstance(source,dict) or len(source)!=1 or not set(source).issubset({'object_id','capture_id'}):
                return jsonify(error='Invalid Mix source'),400
            kind,source_id=next(iter(source.items()))
            if type(source_id) is not int or source_id<=0 or (kind,source_id) in seen:
                return jsonify(error='Mix source must be a unique positive ID'),400
            seen.add((kind,source_id))
            if kind=='object_id':
                row=g.con.execute('SELECT image_name,capture_id FROM objects WHERE id=? AND owner_id=? AND shelf!=?',
                    (source_id,g.user['id'],'bin')).fetchone()
            else:
                row=g.con.execute('SELECT image_name,id AS capture_id FROM captures WHERE id=? AND owner_id=?',
                    (source_id,g.user['id'])).fetchone()
            if not row or not row['image_name']:return jsonify(error='Mix source not available for this profile'),404
            raw=(IMAGE_DIR/row['image_name']).read_bytes()
            raw=sam.jpeg_for_model(raw)
            raws.append(raw)
            if len(raws)==1:
                if row['capture_id']:cid=row['capture_id']
                parent=source_id if kind=='object_id' else None
        label='Mix of two images'
    else:
        raws=[sam.jpeg_for_model((IMAGE_DIR/source_name).read_bytes())]
    if any(not raw.startswith(b'\xff\xd8') or len(raw)>2_000_000 for raw in raws):return jsonify(error='Stored source is not a suitable JPEG'),422
    key=request_meta_key(v)
    if not key:return jsonify(error='Configure Meta API key first'),503
    digest=hashlib.sha256(b''.join(raws)+prompt.strip().encode('utf-8')+secrets.token_bytes(12)+b'|muse-image-1.0').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-image-1.0',
         daily_cap=application_inference_limits()['daily_cap'],
         user_cap=application_inference_limits()['user_cap'],
         cooldown=application_inference_limits()['cooldown'])
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        jpeg,usage=media.edit_meta_images(raws,prompt.strip(),key) if mix_sources else media.edit_meta_image(raws[0],prompt.strip(),key)
        name=secrets.token_hex(16)+'.jpg';file=IMAGE_DIR/name;file.write_bytes(jpeg)
        try:
            with g.con:
                new_id=g.con.execute('''INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id,parent_object_id,operation)
                       VALUES(?,?,?,?,?,?,?,?,?)''',(g.user['id'],('Edited '+label)[:80],prompt.strip()[:240],
                        'muse-image-1.0',name,hashlib.sha256(jpeg).hexdigest(),cid,parent,'mix' if mix_sources else 'image_edit')).lastrowid
        except Exception:
            file.unlink(missing_ok=True);raise
        db.finish_inference(g.con,call,'ok',usage)
        return jsonify(id=new_id,object=item_dict(g.con.execute('SELECT * FROM objects WHERE id=?',(new_id,)).fetchone()),
                       usage=usage,provider='meta'),201
    except (RuntimeError,ValueError,OSError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502


@app.post('/api/media/describe')
@require_user
def media_describe():
    v=body();cid=v.get('capture_id');oid=v.get('object_id')
    if type(cid) is not int or cid<=0:return jsonify(error='Select an image to describe'),400
    cap=g.con.execute('SELECT id,image_name FROM captures WHERE id=? AND owner_id=? AND hidden=0',(cid,g.user['id'])).fetchone()
    if not cap:abort(404)
    obj=None
    if oid is not None:
        if type(oid) is not int:return jsonify(error='Invalid object ID'),400
        obj=g.con.execute('SELECT id,image_name FROM objects WHERE id=? AND owner_id=? AND capture_id=? AND shelf!=?',(oid,g.user['id'],cid,'bin')).fetchone()
        if not obj or not obj['image_name']:abort(404)
    question=str(v.get('question') or '').strip()[:500]
    rows=g.con.execute("SELECT question,answer FROM image_dialogue WHERE owner_id=? AND capture_id=? AND object_id IS ? ORDER BY id DESC LIMIT 10",(g.user['id'],cid,oid)).fetchall()
    history=[{'question':r['question'],'answer':r['answer']} for r in reversed(rows)]
    if not question and history and not v.get('refresh'):
        return jsonify(description=history[-1]['answer'],cached=True,history=history,capture_id=cid,object_id=oid)
    key=request_meta_key(v)
    if not key:return jsonify(error='META API NOT CONFIGURED. No paid request started.'),503
    raw=sam.jpeg_for_model((IMAGE_DIR/(obj or cap)['image_name']).read_bytes())
    limits=application_inference_limits();digest=hashlib.sha256(raw+secrets.token_bytes(12)+b'vision-chat').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-vision-dialogue',daily_cap=limits['daily_cap'],user_cap=limits['user_cap'],cooldown=limits['cooldown'])
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        prior=(' Previous conversation: '+' '.join(f"Q: {r['question']} A: {r['answer']}" for r in history[-3:])) if history else ''
        answer,usage=providers.describe(raw,key,question=(question+prior)[:500] if question else '')
        with g.con:
            g.con.execute('INSERT INTO image_dialogue(owner_id,capture_id,object_id,question,answer) VALUES(?,?,?,?,?)',(g.user['id'],cid,oid,question,answer))
        db.finish_inference(g.con,call,'ok',usage)
        return jsonify(description=answer,cached=False,model='muse-spark-1.3',history=history+[{'question':question,'answer':answer}],usage=usage,capture_id=cid,object_id=oid)
    except providers.MetaVisionUnavailable as e:
        db.finish_inference(g.con,call,'error')
        return (jsonify(error=str(e),provider='meta',model='muse-spark-1.3',
                        upstream_status=e.status,provider_code=e.code,
                        request_id=e.request_id,retry_after=e.retry_after,
                        attempts=e.attempts,retryable=e.status in (429,500,502,503,504)),
                503 if e.status in (500,502,503,504) else 429 if e.status==429 else 502)
    except (OSError,ValueError,RuntimeError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502

@app.get('/api/media/descriptions')
@require_user
def media_description_history():
    try:cid=int(request.args.get('capture_id','0'))
    except ValueError:return jsonify(error='Invalid source'),400
    raw=request.args.get('object_id','')
    try:oid=int(raw) if raw else None
    except ValueError:return jsonify(error='Invalid segment'),400
    if cid<=0 or (oid is not None and oid<=0):return jsonify(error='Invalid image'),400
    cap=g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=? AND hidden=0',(cid,g.user['id'])).fetchone()
    if not cap:abort(404)
    if oid is not None and not g.con.execute('SELECT 1 FROM objects WHERE id=? AND capture_id=? AND owner_id=? AND shelf!=?',
        (oid,cid,g.user['id'],'bin')).fetchone():abort(404)
    rows=g.con.execute('SELECT question,answer,created_at FROM image_dialogue WHERE owner_id=? AND capture_id=? AND object_id IS ? ORDER BY id DESC LIMIT 30',
        (g.user['id'],cid,oid)).fetchall()
    return jsonify(history=[{'question':r['question'],'answer':r['answer'],'created_at':r['created_at']} for r in reversed(rows)],cached=True)

@app.get('/api/media/voices')
@require_user
def media_voices():
    """Optional read-only ElevenLabs voice listing; never triggers generation."""
    key=provider_key('elevenlabs')
    if not key:return jsonify(voices=[],notice='ElevenLabs API key not configured')
    req=urllib.request.Request('https://api.elevenlabs.io/v2/voices?page_size=30',
         headers={'xi-api-key':key,'Accept':'application/json','User-Agent':'FREELAB/0.10'})
    try:
        with urllib.request.urlopen(req,timeout=12) as response:data=json.load(response)
        voices=[{'id':v['voice_id'],'name':str(v.get('name','Voice'))[:70]} for v in data.get('voices',[])
                if isinstance(v,dict) and isinstance(v.get('voice_id'),str)]
        return jsonify(voices=voices[:30])
    except (OSError,ValueError,KeyError) as e:return jsonify(error='Voice catalog unavailable; use browser speech'),502

@app.post('/api/media/speak')
@require_user
def media_speak():
    """An explicitly opted-in paid TTS request; key never enters the browser."""
    v=body();phrase=v.get('text','');voice=v.get('voice_id','')
    if not isinstance(phrase,str) or not 1<=len(phrase.strip())<=500:
        return jsonify(error='Speech text must be 1-500 characters'),400
    if not isinstance(voice,str) or not re.fullmatch(r'[A-Za-z0-9_-]{12,64}',voice):
        return jsonify(error='Choose a valid ElevenLabs voice from Settings'),400
    key=provider_key('elevenlabs')
    if not key:return jsonify(error='ElevenLabs key not configured'),503
    url='https://api.elevenlabs.io/v1/text-to-speech/'+voice+'?output_format=mp3_44100_128'
    data=json.dumps({'text':phrase.strip(),'model_id':'eleven_flash_v2_5'}).encode()
    req=urllib.request.Request(url,data=data,method='POST',headers={'xi-api-key':key,
           'Content-Type':'application/json','Accept':'audio/mpeg','User-Agent':'FREELAB/0.10'})
    try:
        with urllib.request.urlopen(req,timeout=35) as response:audio=response.read(950_001)
        if not 100<=len(audio)<=950_000:raise RuntimeError('Speech response was empty or too large')
        response=app.response_class(audio,mimetype='audio/mpeg');response.headers['Cache-Control']='private, no-store';return response
    except urllib.error.HTTPError as e:return jsonify(error=f'ElevenLabs speech HTTP {e.code}; fallback to browser voice'),502
    except (OSError,RuntimeError) as e:return jsonify(error='ElevenLabs unavailable; fallback to browser voice'),502

@app.post('/api/media/transcribe')
@require_user
def media_transcribe():
    v=body();b64=v.get('wav','')
    if not isinstance(b64,str) or len(b64)>4_000_000:return jsonify(error='Speech clip too large (90 seconds maximum)'),400
    try:wav=base64.b64decode(b64,validate=True)
    except (ValueError,base64.binascii.Error):return jsonify(error='Invalid speech encoding'),400
    if len(wav)<80 or len(wav)>2_900_000 or wav[:4]!=b'RIFF' or wav[8:12]!=b'WAVE':
        return jsonify(error='Expected a 16 kHz WAV recording (up to 90 seconds)'),400
    key=request_meta_key(v)
    if not key:return jsonify(error='Meta key not configured'),503
    digest=hashlib.sha256(wav+b'|transcription').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-voice-transcribe-1.0',
         daily_cap=application_inference_limits()['daily_cap'],user_cap=application_inference_limits()['user_cap'],
         cooldown=0)
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        transcript=media.transcribe_meta(wav,key)
        db.finish_inference(g.con,call,'ok',{})
        return jsonify(text=transcript[:750])
    except (RuntimeError,ValueError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502

@app.get('/')
def home():
    return app.send_static_file('index.html')

@app.errorhandler(413)
def too_large(e):return jsonify(error='Request body is too large'),413
@app.errorhandler(403)
def forbidden(e):return jsonify(error='Forbidden'),403
@app.errorhandler(404)
def not_found(e):return jsonify(error='Not found'),404

# --- Collaborative room transport: authenticated, opt-in, bounded, polling based ---
def _room_access(room_id,require_join=True):
    r=g.con.execute('SELECT * FROM live_rooms WHERE id=?',(room_id,)).fetchone()
    if not r:return None
    if r['owner_id']==g.user['id']:return r
    joined=g.con.execute('SELECT accepted FROM room_members WHERE room_id=? AND user_id=?',(room_id,g.user['id'])).fetchone()
    if joined and joined['accepted']==1:return r
    if not require_join and (r['visibility']=='public' or joined):return r
    return None

def _room_dict(r):
    return {'id':r['id'],'owner_id':r['owner_id'],'visibility':r['visibility'],
            'active':bool(r['active']),'updated_at':r['updated_at']}

@app.get('/api/rooms')
@require_user
def list_rooms():
    rows=g.con.execute('''SELECT r.*,u.display_name AS owner_name,
     m.accepted AS invited FROM live_rooms r JOIN users u ON u.id=r.owner_id
     LEFT JOIN room_members m ON m.room_id=r.id AND m.user_id=?
     WHERE r.owner_id=? OR r.visibility='public' OR m.user_id=?
     ORDER BY r.active DESC,r.updated_at DESC LIMIT 100''',(g.user['id'],g.user['id'],g.user['id'])).fetchall()
    return jsonify(rooms=[{**_room_dict(r),'owner':r['owner_name'],
      'joined':r['owner_id']==g.user['id'] or r['invited']==1,
      'invited':r['invited']==0} for r in rows])

@app.get('/api/rooms/users')
@require_user
def room_users():
    rows=g.con.execute('SELECT id,display_name,username FROM users WHERE id!=? ORDER BY display_name LIMIT 100',(g.user['id'],)).fetchall()
    return jsonify(users=[dict(r) for r in rows])

@app.route('/api/rooms/mine',methods=['GET','PUT'])
@require_user
def own_room():
    if request.method=='PUT':
        v=body();visibility=v.get('visibility')
        if visibility not in ('private','public'):return jsonify(error='Choose public or private'),400
        with g.con:
            g.con.execute('''INSERT INTO live_rooms(owner_id,visibility,active) VALUES(?,?,1)
                 ON CONFLICT(owner_id) DO UPDATE SET visibility=excluded.visibility,active=1''',(g.user['id'],visibility))
    r=g.con.execute('SELECT * FROM live_rooms WHERE owner_id=?',(g.user['id'],)).fetchone()
    return jsonify(room=_room_dict(r) if r else None)

@app.post('/api/rooms/mine/invite')
@require_user
def invite_to_room():
    v=body();other=v.get('user_id')
    if type(other) is not int or other==g.user['id']:return jsonify(error='Select another profile'),400
    if not g.con.execute('SELECT 1 FROM users WHERE id=?',(other,)).fetchone():abort(404)
    r=g.con.execute('SELECT id FROM live_rooms WHERE owner_id=?',(g.user['id'],)).fetchone()
    if not r:return jsonify(error='Start your room first'),409
    with g.con:g.con.execute('''INSERT INTO room_members(room_id,user_id,accepted) VALUES(?,?,0)
     ON CONFLICT(room_id,user_id) DO UPDATE SET accepted=0''',(r['id'],other))
    return jsonify(invited=True,room_id=r['id'])

@app.post('/api/rooms/<int:rid>/join')
@require_user
def join_room(rid):
    r=_room_access(rid,require_join=False)
    if not r:abort(404)
    if r['owner_id']!=g.user['id']:
        with g.con:g.con.execute('''INSERT INTO room_members(room_id,user_id,accepted) VALUES(?,?,1)
            ON CONFLICT(room_id,user_id) DO UPDATE SET accepted=1''',(rid,g.user['id']))
    return jsonify(joined=True,room_id=rid)

@app.post('/api/rooms/<int:rid>/presence')
@require_user
def room_heartbeat(rid):
    r=_room_access(rid)
    if not r:abort(404)
    if r['owner_id']!=g.user['id']:
        with g.con:g.con.execute('''INSERT INTO room_presence(room_id,user_id,last_seen) VALUES(?,?,?)
            ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen=excluded.last_seen''',(rid,g.user['id'],int(time.time())))
    return jsonify(ok=True)

@app.delete('/api/rooms/<int:rid>/presence')
@require_user
def room_leave_presence(rid):
    with g.con:g.con.execute('DELETE FROM room_presence WHERE room_id=? AND user_id=?',(rid,g.user['id']))
    return jsonify(ok=True)

@app.get('/api/rooms/mine/visitors')
@require_user
def room_my_visitors():
    room=g.con.execute('SELECT id FROM live_rooms WHERE owner_id=?',(g.user['id'],)).fetchone()
    if not room:return jsonify(visitors=[])
    rows=g.con.execute('''SELECT u.id,u.display_name,u.username FROM room_presence p
         JOIN room_members m ON m.room_id=p.room_id AND m.user_id=p.user_id AND m.accepted=1
         JOIN users u ON u.id=p.user_id WHERE p.room_id=? AND p.last_seen>=? AND u.blocked_until<=?
         ORDER BY p.last_seen DESC LIMIT 12''',(room['id'],int(time.time())-25,int(time.time()))).fetchall()
    return jsonify(visitors=[{**dict(row),'avatar_preview_url':('/api/rooms/'+str(room['id'])+'/avatar/'+str(row['id'])+'/preview' if g.con.execute('SELECT 1 FROM user_avatar_models WHERE user_id=?',(row['id'],)).fetchone() else None)} for row in rows])

@app.get('/api/rooms/<int:rid>/avatar/<int:uid>/preview')
@require_user
def room_guest_avatar_preview(rid,uid):
    room=_room_access(rid)
    if not room:abort(404)
    visitor=g.con.execute('SELECT 1 FROM room_presence WHERE room_id=? AND user_id=? AND last_seen>=?',(rid,uid,int(time.time())-35)).fetchone()
    if not visitor and uid!=room['owner_id']:abort(404)
    row=g.con.execute('SELECT glb FROM user_avatar_models WHERE user_id=?',(uid,)).fetchone()
    if not row:abort(404)
    try:return jsonify(**glb_preview.decode(row['glb']))
    except (ValueError,TypeError,KeyError,IndexError) as e:return jsonify(error=str(e)),422

@app.put('/api/rooms/mine/state')
@require_user
def update_room_state():
    v=body();active=v.get('active')
    if type(active) is not bool:return jsonify(error='active must be boolean'),400
    cards=v.get('cards',[]);pose=v.get('pose',[]);shapes=v.get('shapes',[])
    if not isinstance(cards,list) or len(cards)>72 or not isinstance(pose,list) or len(pose)!=3:return jsonify(error='Invalid room state'),400
    def coords(q):return isinstance(q,list) and len(q)==3 and all(type(x) in (float,int) and abs(x)<100 for x in q)
    if not coords(pose):return jsonify(error='Invalid headset position'),400
    if not isinstance(shapes,list) or len(shapes)>32:return jsonify(error='Maximum 32 shared shapes'),400
    clean_shapes=[]
    for shape in shapes:
        if not isinstance(shape,dict) or shape.get('kind') not in ('frame','triangle') or not isinstance(shape.get('corners'),list):
            return jsonify(error='Invalid shared shape'),400
        corners=shape['corners']
        if len(corners) not in (3,4) or not all(coords(p) for p in corners):return jsonify(error='Invalid frame corners'),400
        clean_shapes.append({'kind':shape['kind'],'corners':[[round(float(x),3) for x in point] for point in corners]})
    def quaternion(q):return isinstance(q,list) and len(q)==4 and all(type(x) in (float,int) and abs(x)<=1.001 for x in q) and 0.9<sum(float(x)**2 for x in q)<1.1
    orientation=v.get('q',[0,0,0,1])
    if not quaternion(orientation):return jsonify(error='Invalid headset orientation'),400
    clean=[]
    for c in cards:
        if not isinstance(c,dict) or not coords(c.get('p')):return jsonify(error='Invalid card position'),400
        kind=c.get('kind');ident=c.get('id')
        if kind not in ('object','capture') or type(ident) is not int or ident<1:return jsonify(error='Invalid card identity'),400
        if kind=='object':owned=g.con.execute('SELECT 1 FROM objects WHERE id=? AND owner_id=? AND shelf!=?',(ident,g.user['id'],'bin')).fetchone()
        else:owned=g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=? AND hidden=0',(ident,g.user['id'])).fetchone()
        if not owned:abort(403)
        if 'q' in c and not quaternion(c['q']):return jsonify(error='Invalid card orientation'),400
        item={'id':ident,'kind':kind,'p':[round(float(x),3) for x in c['p']]}
        if 'q' in c:item['q']=[round(float(x),4) for x in c['q']]
        clean.append(item)
    r=g.con.execute('SELECT id FROM live_rooms WHERE owner_id=?',(g.user['id'],)).fetchone()
    if not r:return jsonify(error='Create a room before updating'),409
    payload=json.dumps({'pose':pose,'q':[round(float(x),4) for x in orientation],'cards':clean,'shapes':clean_shapes},separators=(',',':'))
    with g.con:g.con.execute('''UPDATE live_rooms SET state_json=?,active=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?''',(payload,int(active),r['id']))
    return jsonify(ok=True)

@app.get('/api/rooms/<int:rid>/state')
@require_user
def read_room_state(rid):
    r=_room_access(rid)
    if not r:abort(404)
    try:scene=json.loads(r['state_json'])
    except (ValueError,TypeError):scene={}
    # Spectators see only published media, but each published card has enough
    # title/description/parent context to navigate the same spatial image tree.
    # Access is checked above for both the state and media endpoints.
    published=scene.get('cards',[]) if isinstance(scene,dict) else []
    owner=r['owner_id']
    objects=[c['id'] for c in published if isinstance(c,dict) and c.get('kind')=='object' and type(c.get('id')) is int]
    captures=[c['id'] for c in published if isinstance(c,dict) and c.get('kind')=='capture' and type(c.get('id')) is int]
    metadata={}
    if objects:
        marks=','.join('?' for _ in objects)
        rows=g.con.execute(f'''SELECT id,label,description,parent_object_id,capture_id,created_at
          FROM objects WHERE owner_id=? AND shelf!='bin' AND id IN ({marks})''',(owner,*objects)).fetchall()
        metadata.update({('object',row['id']):dict(row) for row in rows})
    if captures:
        marks=','.join('?' for _ in captures)
        rows=g.con.execute(f'''SELECT id,description,created_at
          FROM captures WHERE owner_id=? AND hidden=0 AND id IN ({marks})''',(owner,*captures)).fetchall()
        metadata.update({('capture',row['id']):{'label':'Capture '+str(row['id']),
          'description':row['description'],'created_at':row['created_at']} for row in rows})
    scene['cards']=[{**c,**metadata[(c['kind'],c['id'])]} for c in published
        if isinstance(c,dict) and (c.get('kind'),c.get('id')) in metadata]
    guests=g.con.execute('''SELECT u.id,u.display_name FROM room_presence p JOIN users u ON u.id=p.user_id
        WHERE p.room_id=? AND p.user_id!=? AND p.last_seen>=? LIMIT 12''',(rid,owner,int(time.time())-35)).fetchall()
    scene['visitors']=[{'id':v['id'],'name':v['display_name'],
      'avatar_preview_url':('/api/rooms/'+str(rid)+'/avatar/'+str(v['id'])+'/preview'
       if g.con.execute('SELECT 1 FROM user_avatar_models WHERE user_id=?',(v['id'],)).fetchone() else None)} for v in guests]
    return jsonify(room=_room_dict(r),scene=scene)

@app.get('/api/rooms/<int:rid>/media/<kind>/<int:item_id>')
@require_user
def room_media(rid,kind,item_id):
    r=_room_access(rid)
    if not r:abort(404)
    try:published=json.loads(r['state_json']).get('cards',[])
    except (ValueError,TypeError,AttributeError):published=[]
    if not any(c.get('kind')==kind and c.get('id')==item_id for c in published if isinstance(c,dict)):abort(404)
    if kind=='object':item=g.con.execute('SELECT image_name FROM objects WHERE id=? AND owner_id=? AND shelf!=?',(item_id,r['owner_id'],'bin')).fetchone()
    elif kind=='capture':item=g.con.execute('SELECT image_name FROM captures WHERE id=? AND owner_id=? AND hidden=0',(item_id,r['owner_id'])).fetchone()
    else:abort(404)
    if not item or not item['image_name']:abort(404)
    path=(IMAGE_DIR/item['image_name']).resolve()
    if not path.is_relative_to(IMAGE_DIR) or not path.is_file():abort(404)
    return send_file(path,mimetype='image/png' if path.suffix.lower()=='.png' else 'image/jpeg',max_age=0)

if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.getenv('PORT','18765')),debug=False)
