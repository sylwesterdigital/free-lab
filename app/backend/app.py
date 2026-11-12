"""Flask API: identity-scoped private object collection with optional Meta inference."""
from __future__ import annotations
import base64,hashlib,hmac,io,json,os,re,secrets,sqlite3,threading,time
from pathlib import Path
from functools import wraps
from flask import Flask,abort,g,jsonify,request,send_file,session
from werkzeug.middleware.proxy_fix import ProxyFix
from . import db,providers,secrets as keyvault,sam,provider_checks,media

APP_ROOT=Path(__file__).resolve().parents[1]
DATA_DIR=Path(os.getenv('FREE_LAB_DATA_DIR',APP_ROOT/'var')).resolve()
DB=Path(os.getenv('FREE_LAB_DB',DATA_DIR/'free-lab.sqlite3')).resolve()
IMAGE_DIR=DATA_DIR/'images'
VERSION=json.loads((APP_ROOT/'version.json').read_text())['version']
app=Flask(__name__,static_folder=str(APP_ROOT/'frontend'),static_url_path='')
app.config.update(SECRET_KEY=os.getenv('FREE_LAB_SESSION_KEY',secrets.token_hex(32)),
                  SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax',
                  SESSION_COOKIE_SECURE=os.getenv('FREE_LAB_HTTPS','0')=='1',
                  MAX_CONTENT_LENGTH=650_000,JSON_SORT_KEYS=False)
app.wsgi_app=ProxyFix(app.wsgi_app,x_for=1,x_proto=1,x_host=0)
db.init(DB)
IMAGE_DIR.mkdir(parents=True,exist_ok=True)

@app.before_request
def before():
    if request.path.startswith('/api/'):
        g.con=db.connect(DB)
        uid=session.get('uid')
        g.user=db.user_from_id(g.con,uid) if isinstance(uid,int) else None
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
      inference_enabled=bool(keyvault.get_meta_key(g.con)))

@app.get('/api/config')
def config():
    return jsonify(version=VERSION,model=os.getenv('META_MODEL','muse-ember-1.0'),
      inference_enabled=bool(keyvault.get_meta_key(g.con)),max_snapshots_per_day=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')))

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
    session.clear();session['uid']=u['id']
    return jsonify(user={'id':u['id'],'username':u['username'],'display_name':u['display_name'],'role':u['role']})

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

@app.get('/api/usage')
@require_user
def usage():
    global_used=g.con.execute("SELECT COUNT(*) AS n FROM inference_calls WHERE julianday(created_at)>=julianday('now')-1").fetchone()['n']
    mine=g.con.execute("SELECT COUNT(*) AS n FROM inference_calls WHERE user_id=? AND julianday(created_at)>=julianday('now')-1",(g.user['id'],)).fetchone()['n']
    recent=g.con.execute("SELECT provider,status,created_at,usage_json FROM inference_calls WHERE user_id=? ORDER BY id DESC LIMIT 20",(g.user['id'],)).fetchall()
    return jsonify(global_last_24h=global_used,user_last_24h=mine,
        global_cap=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')),
        user_cap=int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0')),
        hard_dollar_cap=False,
        recent=[{'provider':r['provider'],'status':r['status'],'time':r['created_at'],
                 'tokens':json.loads(r['usage_json'] or '{}')} for r in recent])


def request_meta_key(v):
    temp=v.get('session_api_key')
    if temp is not None:
        if not g.user or g.user['role']!='admin' or not isinstance(temp,str) or not 12<=len(temp)<=4096:
            abort(403)
        return temp
    return keyvault.get_meta_key(g.con)

@app.post('/api/segment')
@require_user
def segment_image():
    v=body()
    try:raw=decode_jpeg(v)
    except ValueError as e:return jsonify(error=str(e)),400
    cid=v.get('capture_id')
    if cid is not None:
        if type(cid) is not int or not g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone():
            return jsonify(error='Capture is not owned by this profile'),403
    prompt=str(v.get('prompt','')).strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9 -]{0,58}[a-z0-9]',prompt):
        return jsonify(error='Use one object noun phrase (2–60 characters)'),400
    api_key=request_meta_key(v)
    if not api_key:return jsonify(error='Meta key not configured'),503
    digest=hashlib.sha256(raw+prompt.encode()).hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'sam-3.1',
       daily_cap=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')),
       user_cap=int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0')))
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        result=sam.segment_jpeg(raw,prompt,api_key)
        db.finish_inference(g.con,call,'ok',result.get('usage'))
        result['saved_ids']=[]
        if v.get('save') is True and result['boxes']:
            # Persist bounded IMAGE CROPS (not mask cutouts); usable immediately in inventory.
            from PIL import Image, ImageOps
            Image.MAX_IMAGE_PIXELS=12_000_000
            photo=Image.open(io.BytesIO(raw))
            if photo.width * photo.height > 12_000_000:
                raise ValueError('JPEG resolution exceeds safe segmentation crop size')
            photo=ImageOps.exif_transpose(photo).convert('RGB')
            for box in result['boxes'][:6]:
                x1,y1,x2,y2=[int(n) for n in box['box']]
                w,h=box['image_size']; sx=photo.width/w;sy=photo.height/h
                crop=photo.crop((max(0,round(x1*sx)),max(0,round(y1*sy)),
                                 min(photo.width,round((x2+1)*sx)),min(photo.height,round((y2+1)*sy))))
                if crop.width<8 or crop.height<8:continue
                crop.thumbnail((960,960))
                name=secrets.token_hex(16)+'.jpg'
                out=IMAGE_DIR/name
                crop.save(out,format='JPEG',quality=78,optimize=True)
                try:
                    with g.con:
                        oid=g.con.execute('INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id) VALUES(?,?,?,?,?,?,?)',
                        (g.user['id'],prompt,'SAM 3.1 bounding-box crop (not a decoded segmentation mask)',
                         'sam-3.1-box',name,hashlib.sha256(out.read_bytes()).hexdigest(),cid)).lastrowid
                    result['saved_ids'].append(oid)
                except Exception:
                    out.unlink(missing_ok=True)
                    raise
        return jsonify(result)
    except (RuntimeError,ValueError) as e:
        db.finish_inference(g.con,call,'error')
        return jsonify(error=str(e)),502


@app.get('/api/captures')
@require_user
def capture_clouds():
    rows=g.con.execute('SELECT * FROM captures WHERE owner_id=? ORDER BY id DESC LIMIT 50',(g.user['id'],)).fetchall()
    result=[]
    for row in rows:
        items=g.con.execute('SELECT * FROM objects WHERE owner_id=? AND capture_id=? ORDER BY id LIMIT 80',(g.user['id'],row['id'])).fetchall()
        result.append({'id':row['id'],'image_url':f'/api/captures/{row["id"]}/image',
           'created_at':row['created_at'],'collapsed':bool(row['collapsed']),'hidden':bool(row['hidden']),
           'spatial':json.loads(row['spatial_json'] or '{}'),'objects':[item_dict(obj) for obj in items]})
    return jsonify(captures=result)

@app.post('/api/captures')
@require_user
def save_capture_cloud():
    v=body()
    try:raw=decode_jpeg(v)
    except ValueError as e:return jsonify(error=str(e)),400
    count=g.con.execute('SELECT count(*) FROM captures WHERE owner_id=?',(g.user['id'],)).fetchone()[0]
    if count>=50:return jsonify(error='50 private capture limit reached; reuse saved captures.'),429
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
    response=send_file(path,mimetype='image/jpeg',conditional=True,max_age=0)
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
        if not isinstance(c,dict) or set(c)!={'x','y','z'} or any(type(n) not in (int,float) or not -3<=n<=3 for n in c.values()):
            return jsonify(error='Invalid capture position'),400
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
    return send_file(path,mimetype='image/jpeg',conditional=True,max_age=0)

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
    return send_file(IMAGE_DIR/row['image_name'],mimetype='image/jpeg',max_age=0)

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

@app.post('/api/capture')
@require_user
def capture():
    v=body()
    try:raw=decode_jpeg(v)
    except ValueError as e:return jsonify(error=str(e)),400
    digest=hashlib.sha256(raw).hexdigest()
    cid=v.get('capture_id')
    if cid is not None:
        if type(cid) is not int or not g.con.execute('SELECT 1 FROM captures WHERE id=? AND owner_id=?',(cid,g.user['id'])).fetchone():
            return jsonify(error='Capture is not owned by this profile'),403
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
                  daily_cap=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')),
                  user_cap=int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0')))
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
            im=Image.open(io.BytesIO(raw))
            if im.width*im.height>12_000_000:return jsonify(error='Image pixels exceed 12 million'),400
            source=ImageOps.exif_transpose(im).convert('RGB')
        except Exception:return jsonify(error='Cannot decode capture JPEG'),400
    with g.con:
        for obj in detections:
            content=raw
            box=obj.get('box')
            if source is not None and box and box!=[0,0,1000,1000]:
                x1,y1,x2,y2=box
                pad=32
                left=max(0,int((x1-pad)*source.width/1000));top=max(0,int((y1-pad)*source.height/1000))
                right=min(source.width,int((x2+pad)*source.width/1000));bottom=min(source.height,int((y2+pad)*source.height/1000))
                if right-left>=12 and bottom-top>=12:
                    crop=source.crop((left,top,right,bottom));crop.thumbnail((800,800))
                    mem=io.BytesIO();crop.save(mem,format='JPEG',quality=77,optimize=True)
                    content=mem.getvalue()
            name=secrets.token_hex(16)+'.jpg';path=IMAGE_DIR/name;path.write_bytes(content)
            try:
                oid=g.con.execute('INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id) VALUES(?,?,?,?,?,?,?)',
                  (g.user['id'],obj['label'],obj['description'],model,name,hashlib.sha256(content).hexdigest(),cid)).lastrowid
            except Exception:
                path.unlink(missing_ok=True);raise
            ids.append(oid)
    return jsonify(ids=ids,objects=detections,provider=model,usage=usage),201


# Image operations use a capability router. Only image-edit is live in this release;
# unsupported media types return an explicit error before reserving billable usage.
@app.get('/api/media/capabilities')
@require_user
def media_capabilities():
    return jsonify(image_edit={'meta':{'model':'muse-image-1.0','available':bool(keyvault.get_meta_key(g.con))}},
                   speech={'meta':{'model':'muse-voice-transcribe-1.0','available':bool(keyvault.get_meta_key(g.con))}},
                   video={},three_d={},message='3D/video creation requires provider-specific adapters; no inference is submitted for those options.')

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
    raw=(IMAGE_DIR/source_name).read_bytes()
    if not raw.startswith(b'\xff\xd8') or len(raw)>2_000_000:return jsonify(error='Stored source is not a suitable JPEG'),422
    key=request_meta_key(v)
    if not key:return jsonify(error='Configure Meta API key first'),503
    digest=hashlib.sha256(raw+prompt.strip().encode('utf-8')+secrets.token_bytes(12)+b'|muse-image-1.0').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-image-1.0',
         daily_cap=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')),
         user_cap=int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0')),
         cooldown=int(os.getenv('FREE_LAB_COOLDOWN_SECONDS','20')))
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        jpeg,usage=media.edit_meta_image(raw,prompt.strip(),key)
        name=secrets.token_hex(16)+'.jpg';file=IMAGE_DIR/name;file.write_bytes(jpeg)
        try:
            with g.con:
                new_id=g.con.execute('''INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id,parent_object_id,operation)
                       VALUES(?,?,?,?,?,?,?,?,?)''',(g.user['id'],('Edited '+label)[:80],prompt.strip()[:240],
                        'muse-image-1.0',name,hashlib.sha256(jpeg).hexdigest(),cid,parent,'image_edit')).lastrowid
        except Exception:
            file.unlink(missing_ok=True);raise
        db.finish_inference(g.con,call,'ok',usage)
        return jsonify(id=new_id,object=item_dict(g.con.execute('SELECT * FROM objects WHERE id=?',(new_id,)).fetchone()),
                       usage=usage,provider='meta'),201
    except (RuntimeError,ValueError,OSError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502

@app.post('/api/media/transcribe')
@require_user
def media_transcribe():
    v=body();b64=v.get('wav','')
    if not isinstance(b64,str) or len(b64)>500_000:return jsonify(error='Speech clip too large'),400
    try:wav=base64.b64decode(b64,validate=True)
    except (ValueError,base64.binascii.Error):return jsonify(error='Invalid speech encoding'),400
    if len(wav)<80 or len(wav)>360_000 or wav[:4]!=b'RIFF' or wav[8:12]!=b'WAVE':
        return jsonify(error='Expected a short 16 kHz WAV clip (max 10 seconds)'),400
    key=request_meta_key(v)
    if not key:return jsonify(error='Meta key not configured'),503
    digest=hashlib.sha256(wav+b'|transcription').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-voice-transcribe-1.0',
         daily_cap=int(os.getenv('FREE_LAB_DAILY_LIMIT','0')),user_cap=int(os.getenv('FREE_LAB_USER_DAILY_LIMIT','0')),
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

if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.getenv('PORT','18765')),debug=False)
