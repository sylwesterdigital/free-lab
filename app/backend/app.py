"""Flask API: identity-scoped private object collection with optional Meta inference."""
from __future__ import annotations
import base64,hashlib,hmac,io,json,math,os,re,secrets,sqlite3,threading,time,urllib.request,urllib.error,subprocess,sys,tempfile,csv
from pathlib import Path
from datetime import datetime,timezone
from functools import wraps
from contextlib import closing
from flask import Flask,abort,g,jsonify,request,send_file,session,Response
from itsdangerous import URLSafeTimedSerializer,BadSignature,SignatureExpired
from werkzeug.middleware.proxy_fix import ProxyFix
from . import db,providers,secrets as keyvault,sam,provider_checks,media,meshy3d,aholo3d,tripo3d,glb_preview,glb_xr,model_cache,avatar_optimizer

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
                  MAX_CONTENT_LENGTH=22_000_000,JSON_SORT_KEYS=False)
app.wsgi_app=ProxyFix(app.wsgi_app,x_for=1,x_proto=1,x_host=0)
db.init(DB)
avatar_optimizer.init(DB)
IMAGE_DIR.mkdir(parents=True,exist_ok=True)
MODEL_DIR.mkdir(parents=True,exist_ok=True)

# XR preview preparation is a bounded read-only conversion of an already completed
# paid job. Never regenerate or submit a provider task from a preview request.
_xr_preview_guard=threading.Lock()
_xr_preview_active=set()
_XR_PREVIEW_CONCURRENT=1  # Avoid multiple simultaneous headless Blender instances.

# Offload Tripo polling, signed downloads and model conversion. Neither a paid
# provider call nor an external network request runs inside an XR HTTP response.
_xr_poll_guard=threading.Lock()
_xr_poll_active=set()
_xr_poll_times={}

# A signed Tripo GLB URL can expire before the wearer next opens Collection.
# Active tasks therefore have a bounded server-side watch which saves the file
# as soon as the provider finishes, independently of XR frame rendering.
_xr_monitor_guard=threading.Lock()
_xr_monitor_active=set()
_XR_MONITOR_CONCURRENT=3

_thumb_guard=threading.Lock()
_thumb_active=set()
_THUMBNAIL_CONCURRENT=1

_XR_TEXTURE_REVISION='uv-seam-v2'

def _xr_preview_revision_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.xr.revision'

def _xr_preview_json_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.xr.json'

def _xr_preview_stage_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.xr.stage'

def _xr_preview_error_version_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.xr.error.version'

def _xr_preview_stage(owner,jid,label):
    # Only short, non-sensitive labels. No private URLs or full provider errors.
    _xr_preview_stage_path(owner,jid).write_text(label[:60])

def _xr_preview_heartbeat(pending,stop):
    # Background Blender can run for four minutes; this heartbeat distinguishes
    # live conversions from abandoned .pending markers after worker restarts.
    while not stop.wait(5):
        if not pending.exists():return
        try:pending.touch()
        except OSError:return

def _model_thumb_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.thumb.png'

def _model_thumb_error_path(owner,jid):
    return MODEL_DIR/f'{owner}_{jid}.thumb.error'

def _job_source_image_url(row):
    if row['object_id']:
        return '/api/objects/'+str(row['object_id'])+'/image'
    if row['capture_id']:
        return '/api/captures/'+str(row['capture_id'])+'/image'
    return None

def _model_thumbnail_worker(owner,jid):
    con=None
    try:
        con=db.connect(DB)
        row=con.execute('SELECT status,model_path FROM jobs_3d WHERE id=? AND owner_id=?',(jid,owner)).fetchone()
        if not row or row['status']!='SUCCEEDED':return
        name=row['model_path'] or ''
        if not re.fullmatch(r'[0-9]+_[0-9]+\.glb',name) or name!=f'{owner}_{jid}.glb':return
        file=MODEL_DIR/name
        if not file.is_file():return
        # One heavyweight Blender process across all Gunicorn workers. Never
        # hold a web request while rendering; the thumbnail endpoint serves the
        # saved 2D source until the render is complete.
        import fcntl
        with open(MODEL_DIR/'.thumbnail-render.lock','a+b') as render_lock:
            try:fcntl.flock(render_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return
            try:
                png=avatar_optimizer.render_thumbnail(file.read_bytes(),size=640)
                target=_model_thumb_path(owner,jid)
                target.write_bytes(png)
                _model_thumb_error_path(owner,jid).unlink(missing_ok=True)
            finally:fcntl.flock(render_lock.fileno(),fcntl.LOCK_UN)
    except Exception as e:
        try:_model_thumb_error_path(owner,jid).write_text(str(e)[:180])
        except OSError:pass
    finally:
        if con is not None:con.close()
        with _thumb_guard:_thumb_active.discard((owner,jid))

def _ensure_model_thumbnail(owner,jid):
    target=_model_thumb_path(owner,jid)
    if target.is_file():return True
    failed=_model_thumb_error_path(owner,jid)
    if failed.is_file() and time.time()-failed.stat().st_mtime<12*3600:return False
    if not avatar_optimizer.blender_command():return False
    with _thumb_guard:
        identity=(owner,jid)
        if identity in _thumb_active:return False
        if len(_thumb_active)>=_THUMBNAIL_CONCURRENT:return False
        _thumb_active.add(identity)
    threading.Thread(target=_model_thumbnail_worker,args=(owner,jid),daemon=True,
                     name=f'freelab-thumb-{jid}').start()
    return False

def _xr_decode_isolated(raw,texture_edge):
    """Bounded child-process GLB decode: protect Gunicorn from expensive geometry.

    The subprocess reads a private temporary GLB and writes only the decoded JSON.
    No credentials, external URLs, paid requests or Flask state cross this boundary.
    """
    if len(raw)<1_500_000:
        return glb_xr.decode_visual(raw,texture_edge=texture_edge)
    with tempfile.TemporaryDirectory(prefix='freelab-xr-decode-') as folder:
        input_path=Path(folder)/'source.glb';output_path=Path(folder)/'preview.json'
        input_path.write_bytes(raw)
        os.chmod(input_path,0o600)
        def limits():
            if sys.platform.startswith('linux'):
                import resource
                resource.setrlimit(resource.RLIMIT_AS,(850_000_000,850_000_000))
                resource.setrlimit(resource.RLIMIT_CPU,(65,65))
        try:
            completed=subprocess.run([sys.executable,'-m','backend.glb_xr',str(input_path),str(output_path),str(texture_edge)],
                       cwd=str(APP_ROOT),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE,timeout=85,check=False,
                       preexec_fn=limits if sys.platform.startswith('linux') else None)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('Quest model decoder timed out; try a lower-poly model') from exc
        except OSError as exc:
            raise ValueError('Quest model decoder could not start') from exc
        if completed.returncode or not output_path.is_file():
            raise ValueError('Quest model decoding failed in isolated worker; try XR-ready P2 quality')
        if output_path.stat().st_size>18_000_000:
            raise ValueError('Quest model preview exceeds decoded geometry budget')
        return json.loads(output_path.read_text())

def _xr_existing_job_worker(owner,jid,key):
    # Read-only recovery of an already paid job. All database access belongs to
    # this thread; never use Flask request globals or share SQLite connections.
    output,error,pending=_xr_preview_paths(owner,jid)
    prepared=_xr_preview_json_path(owner,jid)
    con=None;stop=threading.Event()
    beat=threading.Thread(target=_xr_preview_heartbeat,args=(pending,stop),daemon=True,name=f'freelab-xr-heartbeat-{jid}')
    beat.start()
    try:
        _xr_preview_stage(owner,jid,'Checking saved model')
        con=db.connect(DB)
        row=con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,owner)).fetchone()
        if not row or row['status']!='SUCCEEDED':raise ValueError('3D job is not completed')
        texture_edge=(row['xr_texture_edge'] if 'xr_texture_edge' in row.keys() and row['xr_texture_edge'] in (512,640,1024,2048) else 640)
        if output.is_file():raw=output.read_bytes()
        elif row['model_path'] and (MODEL_DIR/row['model_path']).is_file():
            raw=(MODEL_DIR/row['model_path']).read_bytes()
        else:
            url=row['glb_url']
            if row['provider']=='tripo':
                if not key:raise ValueError('Tripo key unavailable for read-only model recovery')
                _xr_preview_stage(owner,jid,'Checking Tripo result')
                info=tripo3d.status(row['provider_task'],key)
                if info['status']!='SUCCEEDED':raise ValueError('Tripo task status: '+str(info['status']))
                url=info['glb_url'] or url
                if url:
                    with con:con.execute('UPDATE jobs_3d SET glb_url=?,thumbnail_url=? WHERE id=? AND owner_id=?',
                      (url,info['thumbnail_url'] or row['thumbnail_url'],jid,owner))
            if not url:raise ValueError('Provider reported success but supplied no downloadable GLB URL')
            _xr_preview_stage(owner,jid,'Downloading generated GLB')
            name=model_cache.store(url,row['provider'],MODEL_DIR,owner,jid)
            with con:con.execute('UPDATE jobs_3d SET model_path=?,cache_error=? WHERE id=? AND owner_id=?',
                                  (name,'',jid,owner))
            raw=(MODEL_DIR/name).read_bytes()
        thumb_worker=globals().get('_ensure_model_thumbnail')
        if callable(thumb_worker):thumb_worker(owner,jid)
        _xr_preview_stage(owner,jid,'Preparing Quest geometry')
        # H-series meshes can be many times larger than the rendered preview.
        # Avoid a multi-second Python triangle walk on very dense originals:
        # prefer the bounded, separate Blender conversion if available.
        use_blender=len(raw)>10_000_000 and bool(avatar_optimizer.blender_command())
        if not use_blender:
            try:result=_xr_decode_isolated(raw,texture_edge)
            except (ValueError,TypeError,KeyError,IndexError):use_blender=True
        if use_blender:
            if not avatar_optimizer.blender_command():
                raise ValueError('Quest conversion required but headless Blender is unavailable')
            _xr_preview_stage(owner,jid,'Optimizing GLB for Quest')
            optimized=avatar_optimizer.optimize_xr_preview(raw)
            _xr_preview_stage(owner,jid,'Decoding optimized mesh')
            result=_xr_decode_isolated(optimized,texture_edge)
            temp=MODEL_DIR/(f'{owner}_{jid}.xr.glb.tmp-'+secrets.token_hex(4))
            try:
                with temp.open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(optimized)
                temp.replace(output)
            finally:temp.unlink(missing_ok=True)
        _xr_preview_stage(owner,jid,'Saving textured XR model')
        encoded=json.dumps(result,separators=(',',':')).encode('utf-8')
        if len(encoded)>18_000_000:raise ValueError('Quest decoded mesh exceeds 18 MB preview limit')
        temp=MODEL_DIR/(f'{owner}_{jid}.xr.json.tmp-'+secrets.token_hex(4))
        try:
            with temp.open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(encoded)
            temp.replace(prepared)
            _xr_preview_revision_path(owner,jid).write_text(_XR_TEXTURE_REVISION)
        finally:temp.unlink(missing_ok=True)
        error.unlink(missing_ok=True)
        _xr_preview_error_version_path(owner,jid).unlink(missing_ok=True)
    except Exception as exc:
        # Keep signed URLs, credentials and server filesystem paths private.
        reason=str(exc).replace('\n',' ')[:170]
        reason=re.sub(r'https?://\S+','[provider link]',reason)
        reason=re.sub(r'/[^ \t]+','[server file]',reason)
        error.write_text(reason or 'Unable to prepare completed GLB for Quest')
        _xr_preview_error_version_path(owner,jid).write_text(VERSION)
        if con is not None:
            try:
                with con:con.execute('UPDATE jobs_3d SET cache_error=? WHERE id=? AND owner_id=?',
                    ((reason or 'XR preview preparation failed')[:180],jid,owner))
            except sqlite3.Error:pass
    finally:
        stop.set();beat.join(timeout=1)
        if con is not None:con.close()
        pending.unlink(missing_ok=True)
        _xr_preview_stage_path(owner,jid).unlink(missing_ok=True)
        with _xr_preview_guard:_xr_preview_active.discard((owner,jid))

def _xr_ensure_preview_worker(owner,jid,key):
    output,error,pending=_xr_preview_paths(owner,jid)
    with _xr_preview_guard:
        identity=(owner,jid)
        if identity in _xr_preview_active:return 'PREPARING'
        if pending.is_file():
            if time.time()-pending.stat().st_mtime<45:return 'PREPARING'
            pending.unlink(missing_ok=True)
        if len(_xr_preview_active)>=_XR_PREVIEW_CONCURRENT:return 'WAITING'
        _xr_preview_active.add(identity);pending.touch()
    threading.Thread(target=_xr_existing_job_worker,args=(owner,jid,key),daemon=True,
                     name=f'freelab-glb-recovery-{jid}').start()
    return 'PREPARING'

def _xr_poll_task_worker(owner,jid,key):
    con=None
    try:
        con=db.connect(DB)
        row=con.execute('SELECT * FROM jobs_3d WHERE owner_id=? AND id=?',(owner,jid)).fetchone()
        if not row or row['status'] not in ('PENDING','IN_PROGRESS','UNKNOWN'):return
        adapter={'aholo':aholo3d,'meshy':meshy3d,'tripo':tripo3d}.get(row['provider'])
        if not adapter or not key:return
        info=adapter.status(row['provider_task'],key)
        with con:
            con.execute("""UPDATE jobs_3d SET status=?,progress=?,credits=?,glb_url=?,thumbnail_url=?,error=?,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_id=?""",
            (info['status'],info['progress'],info['credits'],info['glb_url'] or row['glb_url'],
             info['thumbnail_url'] or row['thumbnail_url'],info['error'],jid,owner))
        if info['status']=='SUCCEEDED' and row['provider']=='tripo':
            _xr_ensure_preview_worker(owner,jid,key)
    except Exception:
        # A transient poll failure does not change a provider task to FAILED.
        pass
    finally:
        if con is not None:con.close()
        with _xr_poll_guard:_xr_poll_active.discard((owner,jid))

def _xr_ensure_task_poll(owner,jid,key):
    with _xr_poll_guard:
        identity=(owner,jid);now=time.monotonic()
        if identity in _xr_poll_active or now-_xr_poll_times.get(identity,0)<12:return
        if len(_xr_poll_active)>=2:return
        _xr_poll_times[identity]=now;_xr_poll_active.add(identity)
    threading.Thread(target=_xr_poll_task_worker,args=(owner,jid,key),daemon=True,
                     name=f'freelab-3d-status-{jid}').start()


def _xr_monitor_job(owner,jid,key):
    # This is a recovery-capable, read-only task monitor. It never creates a
    # second paid Tripo task. Each thread owns its SQLite connection.
    try:
        deadline=time.monotonic()+8*60
        failures=0
        while time.monotonic()<deadline:
            try:
                with closing(db.connect(DB)) as con:
                    row=con.execute('SELECT provider,provider_task,status,glb_url,thumbnail_url FROM jobs_3d WHERE owner_id=? AND id=?',
                                    (owner,jid)).fetchone()
                if row is None:return
                if row['status'] in ('FAILED','CANCELED'):return
                if row['status']=='SUCCEEDED':
                    if row['provider']=='tripo':_xr_ensure_preview_worker(owner,jid,key)
                    return
                adapter={'aholo':aholo3d,'meshy':meshy3d,'tripo':tripo3d}.get(row['provider'])
                if not adapter or not key:return
                info=adapter.status(row['provider_task'],key)
                with closing(db.connect(DB)) as con:
                    with con:
                        con.execute("""UPDATE jobs_3d SET status=?,progress=?,credits=?,glb_url=?,thumbnail_url=?,error=?,
                          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_id=?""",
                          (info['status'],info['progress'],info['credits'],info['glb_url'] or row['glb_url'],
                           info['thumbnail_url'] or row['thumbnail_url'],info['error'],jid,owner))
                failures=0
                if info['status']=='SUCCEEDED':
                    # Fetch the provider model immediately while its signed URL
                    # is fresh. Cache/Quest decoding occurs in another worker.
                    if row['provider']=='tripo':_xr_ensure_preview_worker(owner,jid,key)
                    return
                if info['status'] in ('FAILED','CANCELED'):return
            except Exception:
                # Temporary DNS/API failures do not turn a paid task into FAILED.
                failures+=1
            time.sleep(min(25,9+failures*3))
    finally:
        with _xr_monitor_guard:_xr_monitor_active.discard((owner,jid))


def _xr_ensure_job_monitor(owner,jid,key):
    if not key:return False
    with _xr_monitor_guard:
        identity=(owner,jid)
        if identity in _xr_monitor_active:return False
        if len(_xr_monitor_active)>=_XR_MONITOR_CONCURRENT:return False
        _xr_monitor_active.add(identity)
    threading.Thread(target=_xr_monitor_job,args=(owner,jid,key),daemon=True,
                     name=f'freelab-tripo-monitor-{jid}').start()
    return True


def _xr_preview_paths(owner,jid):
    base=f'{owner}_{jid}.xr'
    return MODEL_DIR/(base+'.glb'), MODEL_DIR/(base+'.error'), MODEL_DIR/(base+'.pending')


def _xr_prepare_worker(owner,jid,raw):
    output,error,pending=_xr_preview_paths(owner,jid)
    temp=MODEL_DIR/(f'{owner}_{jid}.xr.tmp-'+secrets.token_hex(5))
    try:
        ready=avatar_optimizer.optimize_xr_preview(raw)
        # A conversion is successful only if Quest's actual decoder can use it.
        glb_xr.decode_visual(ready)
        with temp.open('xb') as f:
            os.fchmod(f.fileno(),0o600)
            f.write(ready)
        temp.replace(output)
        error.unlink(missing_ok=True)
    except Exception as e:
        # No traceback, credentials, URLs or local file paths are returned to users.
        message=str(e).replace('\n',' ')[:180]
        message=re.sub(r'/[^ \t\"\']+', '[server file]', message)
        error.write_text(message or 'Quest GLB conversion failed')
    finally:
        temp.unlink(missing_ok=True)
        pending.unlink(missing_ok=True)
        with _xr_preview_guard:_xr_preview_active.discard((owner,jid))


def _xr_prepare_preview(owner,jid,raw):
    output,error,pending=_xr_preview_paths(owner,jid)
    if error.is_file():return ('FAILED',error.read_text()[:200])
    with _xr_preview_guard:
        key=(owner,jid)
        if key in _xr_preview_active:return ('PREPARING','Optimizing the model for Quest')
        if pending.is_file() and time.time()-pending.stat().st_mtime<330:
            return ('PREPARING','Optimizing the model for Quest')
        if len(_xr_preview_active)>=_XR_PREVIEW_CONCURRENT:
            return ('WAITING','XR model preparation queued; retry shortly')
        pending.touch()
        _xr_preview_active.add(key)
        threading.Thread(target=_xr_prepare_worker,args=(owner,jid,raw),daemon=True,
                         name=f'freelab-xr-model-{jid}').start()
    return ('PREPARING','Optimizing the model for Quest')

@app.before_request
def before():
    if request.path.startswith('/api/'):
        max_body=(22_000_000 if request.path=='/api/me/avatar-3d/optimize' and request.method=='POST'
                  else 5_800_000 if request.path=='/api/me/avatar-3d' and request.method=='PUT' else 4_250_000)
        if request.content_length and request.content_length>max_body:abort(413)
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
        if not g.user:return jsonify(error='Session expired or missing. Sign in again before requesting private 3D assets.',code='AUTH_REQUIRED'),401
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
    if row['operation'] in ('image_edit','mix') and str(row['label']).lstrip().lower().startswith('edited '):
        result['label']=db.canonical_edit_label(row['label'])
    try:result['spatial']=json.loads(row['spatial_json'] or '{}')
    except (ValueError,TypeError):result['spatial']={}
    result['has_image']=bool(row['image_name'])
    return result

# Account-isolated, bounded descriptive activity records. All scores are client-reported.
AGENCY_ACTIVITIES=frozenset(('shapes','math','hands','throw','sort','chain','cubes','frames','five','thumbs'))
AGENCY_MODES=frozenset(('free','timed','daily'))

@app.post('/api/agency/sessions')
@require_user
def agency_session_begin():
    v=body();activity=v.get('activity');mode=v.get('mode','free');level=v.get('level',0)
    if type(activity) is not str or activity not in AGENCY_ACTIVITIES or type(mode) is not str or mode not in AGENCY_MODES or type(level) is not int or not 0<=level<=3:
        return jsonify(error='Invalid activity, mode, or level'),400
    uid=secrets.token_hex(16)
    with g.con:
        g.con.execute('INSERT INTO agency_sessions(id,owner_id,activity,mode,level) VALUES(?,?,?,?,?)',
                      (uid,g.user['id'],activity,mode,level))
    return jsonify(id=uid),201

@app.patch('/api/agency/sessions/<session_id>')
@require_user
def agency_session_update(session_id):
    if not re.fullmatch(r'[a-f0-9]{32}',session_id):abort(404)
    v=body()
    valid={'duration_ms':14400000,'correct':100000,'errors':100000,'points':100000}
    if any(type(v.get(k,0)) is not int or not 0<=v.get(k,0)<=limit for k,limit in valid.items()) or type(v.get('finished',False)) is not bool:
        return jsonify(error='Invalid activity measurements'),400
    with g.con:
        row=g.con.execute('SELECT finished FROM agency_sessions WHERE id=? AND owner_id=?',(session_id,g.user['id'])).fetchone()
        if not row:abort(404)
        if row['finished']:return jsonify(ok=True,finished=True)
        g.con.execute('''UPDATE agency_sessions SET duration_ms=MAX(duration_ms,?),
            correct=MAX(correct,?),errors=MAX(errors,?),points=MAX(points,?),finished=?
            WHERE id=? AND owner_id=?''',
            (v.get('duration_ms',0),v.get('correct',0),v.get('errors',0),v.get('points',0),
             int(v.get('finished',False)),session_id,g.user['id']))
    return jsonify(ok=True,finished=v.get('finished',False))

@app.post('/api/agency/sessions/<session_id>/events')
@require_user
def agency_event(session_id):
    # An accepted answer, not headset pose or motion tracking. Bounded and profile scoped.
    if not re.fullmatch(r'[a-f0-9]{32}',session_id):abort(404)
    v=body();hand=v.get('handedness','none');kind=v.get('input_kind','unknown')
    correct=v.get('correct');response_ms=v.get('response_ms',0);offset=v.get('offset_minutes',0)
    if hand not in ('left','right','none') or kind not in ('hand','controller','unknown') or type(correct) is not bool or type(response_ms) is not int or not 0<=response_ms<=600_000 or type(offset) is not int or not -840<=offset<=840:
        return jsonify(error='Invalid interaction metadata'),400
    with g.con:
        row=g.con.execute('SELECT finished FROM agency_sessions WHERE id=? AND owner_id=?',(session_id,g.user['id'])).fetchone()
        if not row:abort(404)
        if row['finished']:return jsonify(ok=True,recorded=False)
        count=g.con.execute('SELECT COUNT(*) FROM agency_events WHERE session_id=?',(session_id,)).fetchone()[0]
        if count>=2000:return jsonify(error='Session event limit reached'),429
        g.con.execute('INSERT INTO agency_events(session_id,owner_id,handedness,input_kind,correct,response_ms,offset_minutes) VALUES(?,?,?,?,?,?,?)',
                      (session_id,g.user['id'],hand,kind,int(correct),response_ms,offset))
    return jsonify(ok=True,recorded=True),201

def agency_days():
    days=request.args.get('days','30')
    if days not in ('7','30','90','365','all'):abort(400)
    return days

def agency_rows(days):
    # All time is bounded by one user's records; per-user data never crosses profiles.
    if days=='all':return g.con.execute('SELECT * FROM agency_sessions WHERE owner_id=? ORDER BY started_at DESC',(g.user['id'],)).fetchall()
    return g.con.execute("SELECT * FROM agency_sessions WHERE owner_id=? AND started_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now',?) ORDER BY started_at DESC",
                         (g.user['id'],f'-{days} days')).fetchall()

def agency_observations(days):
    # No raw event data leaves this function; chart data retains only daily aggregates.
    import datetime as _dt
    event_rows=g.con.execute('''SELECT e.* FROM agency_events e JOIN agency_sessions s ON s.id=e.session_id
        WHERE e.owner_id=? AND s.owner_id=? '''+('' if days=='all' else "AND e.at_utc>=strftime('%Y-%m-%dT%H:%M:%fZ','now',?) ")+'ORDER BY e.at_utc',
        (g.user['id'],g.user['id']) if days=='all' else (g.user['id'],g.user['id'],f'-{days} days')).fetchall()
    inputs={};by_day={};dayparts={name:{'period':name,'attempts':0,'correct':0,'response_ms':0} for name in ('Night','Morning','Afternoon','Evening')}
    for e in event_rows:
        name=e['input_kind']+' '+e['handedness'];row=inputs.setdefault(name,{'input':name,'attempts':0,'correct':0,'response_ms':0})
        local=_dt.datetime.fromisoformat(e['at_utc'].replace('Z','+00:00'))+_dt.timedelta(minutes=e['offset_minutes'])
        hour=local.hour;part='Night' if hour<6 else 'Morning' if hour<12 else 'Afternoon' if hour<18 else 'Evening'
        day=local.date().isoformat()
        d=by_day.setdefault((day,name),{'day':day,'input':name,'attempts':0,'correct':0,'response_ms':0})
        for group in (row,dayparts[part],d):
            group['attempts']+=1;group['correct']+=e['correct'];group['response_ms']+=e['response_ms']
    return {'events':len(event_rows),'inputs':sorted(inputs.values(),key=lambda r:-r['attempts']),
            'by_day':[v for k,v in sorted(by_day.items())], 'dayparts':list(dayparts.values()),
            'time_context':'Device local offset at each interaction; time-of-day comparisons are observational, not controlled'}

@app.get('/api/agency/dashboard')
@require_user
def agency_dashboard():
    days=agency_days();rows=agency_rows(days)
    daily={};activities={};total={'sessions':0,'duration_ms':0,'free_ms':0,'correct':0,'errors':0,'points':0}
    for r in rows:
        key=r['started_at'][:10];activity=r['activity'];duration=r['duration_ms']
        d=daily.setdefault(key,{'day':key,'sessions':0,'duration_ms':0,'free_ms':0,'correct':0,'errors':0,'points':0})
        a=activities.setdefault(activity,{'activity':activity,'sessions':0,'duration_ms':0,'free_ms':0,'correct':0,'errors':0,'points':0})
        for metric,val in (('sessions',1),('duration_ms',duration),('free_ms',duration if r['mode']=='free' else 0),
                           ('correct',r['correct']),('errors',r['errors']),('points',r['points'])):
            total[metric]+=val;d[metric]+=val;a[metric]+=val
    observation=agency_observations(days)
    return jsonify(period=days,timezone='UTC',total=total,daily=sorted(daily.values(),key=lambda x:x['day']),
                   activities=sorted(activities.values(),key=lambda x:x['sessions'],reverse=True),observation=observation,
                   methodology={'metric':'descriptive play telemetry','scores':'self-reported by the client; not a cognitive assessment',
                   'duration':'elapsed time in an activity, excluding HOW TO PLAY playback; pauses and idle time may be included',
                   'start':'recording begins with this release; historical sessions cannot be reconstructed from the server',
                   'privacy':'private to the signed-in profile; external aggregate analysis only on explicit consent'} )

@app.get('/api/agency/export.csv')
@require_user
def agency_export():
    days=agency_days();rows=agency_rows(days);output=io.StringIO()
    writer=csv.writer(output);writer.writerow(('session_id','started_at_utc','activity','mode','level','duration_seconds','correct','errors','points','finished'))
    for row in rows:
        writer.writerow((row['id'],row['started_at'],row['activity'],row['mode'],row['level'],
                        round(row['duration_ms']/1000,3),row['correct'],row['errors'],row['points'],row['finished']))
    return Response(output.getvalue(),mimetype='text/csv',headers={'Content-Disposition':'attachment; filename="freelab-agency-'+days+'d.csv"','Cache-Control':'private, no-store'})

@app.post('/api/agency/analyse')
@require_user
def agency_analyse():
    # This is a user-initiated, paid, external request. No individual event log is sent.
    v=body();voice=v.get('style','Scientist');days=str(v.get('days','30'))
    if voice not in ('Scientist','Coach','Buddy','Satire') or days not in ('7','30','90','365','all') or v.get('consent') is not True:
        return jsonify(error='Choose a style and explicitly consent to sharing aggregated play metrics with Meta'),400
    key=provider_key('meta')
    if not key:return jsonify(error='Meta Model API key is not configured. No data was shared.'),503
    rows=agency_rows(days)
    if not rows:return jsonify(error='No recorded sessions in this period; play activities before requesting analysis'),409
    totals={'sessions':len(rows),'play_minutes':round(sum(r['duration_ms'] for r in rows)/60000,1),
            'correct':sum(r['correct'] for r in rows),'mistakes':sum(r['errors'] for r in rows)}
    activities={}
    for r in rows:
        item=activities.setdefault(r['activity'],{'sessions':0,'correct':0,'mistakes':0,'minutes':0})
        item['sessions']+=1;item['correct']+=r['correct'];item['mistakes']+=r['errors'];item['minutes']+=r['duration_ms']/60000
    # Only aggregates leave this server. No identity, source images, raw prompts, precise timestamps or event records.
    observations=agency_observations(days)
    prompt={'app':'FREELAB: exploratory XR activities including matching, gestures, arithmetic, throwing and free play',
            'measurement':'user-reported in-game outcomes, session time, not a standardized cognitive test',
            'days':days,'total':totals,'activities':activities,
            'inputs':observations['inputs'],'dayparts':observations['dayparts'],
            'day_by_input':observations['by_day'][-60:]}
    tone={'Scientist':'A careful observational research assistant. Note limits, confounds and sample size.',
          'Coach':'Encouraging, specific practice suggestions with uncertainty.',
          'Buddy':'Friendly, plain-language, light humor, factual.',
          'Satire':'Gentle playful satire about the games, no ridicule of the player or clinical insinuations.'}[voice]
    instructions=('Write 90-140 words addressing the user. '+tone+' Only describe patterns supported by the provided aggregates. '
        'Never diagnose, estimate IQ/brain health, attribute causes, or claim improvement without controlled comparable tasks. '
        'When evidence is weak say so. Do not assume that more correct answers mean improved cognition. '
        'Finish with one optional next experiment the user can try.')
    digest=hashlib.sha256(json.dumps(prompt,sort_keys=True).encode()).hexdigest()
    limits=analysis_inference_limits()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'meta-analysis',**limits)
    except ValueError as e:return jsonify(error=str(e)),429
    payload=json.dumps({'model':os.getenv('META_ANALYSIS_MODEL','muse-spark-1.3'),
       'messages':[{'role':'system','content':instructions},{'role':'user','content':json.dumps(prompt)}],
       'max_tokens':300,'temperature':0.55}).encode()
    req=urllib.request.Request('https://api.meta.ai/v1/chat/completions',data=payload,method='POST',
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','Accept':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=35) as res: result=json.load(res)
        comment=str(result['choices'][0]['message']['content']).strip()[:1800]
        if not comment:raise ValueError('Model returned empty text')
        db.finish_inference(g.con,call,'succeeded',result.get('usage',{}))
        return jsonify(comment=comment,style=voice,provider='Meta Model API',shared='aggregated sessions only',diagnostic=False)
    except (urllib.error.HTTPError,urllib.error.URLError,KeyError,ValueError,TimeoutError) as e:
        db.finish_inference(g.con,call,'failed')
        return jsonify(error='Meta analysis unavailable; no interpretation generated'),502

@app.get('/api/agency/events.csv')
@require_user
def agency_events_export():
    days=agency_days();output=io.StringIO()
    writer=csv.writer(output);writer.writerow(('session_id','at_utc','handedness','input_kind','correct','response_ms','offset_minutes'))
    rows=g.con.execute('''SELECT e.session_id,e.at_utc,e.handedness,e.input_kind,e.correct,e.response_ms,e.offset_minutes
        FROM agency_events e JOIN agency_sessions s ON s.id=e.session_id WHERE e.owner_id=? AND s.owner_id=? '''+
        ('' if days=='all' else "AND e.at_utc>=strftime('%Y-%m-%dT%H:%M:%fZ','now',?) ")+'ORDER BY e.at_utc',
        (g.user['id'],g.user['id']) if days=='all' else (g.user['id'],g.user['id'],f'-{days} days')).fetchall()
    for row in rows:writer.writerow(tuple(row))
    return Response(output.getvalue(),mimetype='text/csv',headers={'Content-Disposition':'attachment; filename="freelab-interactions.csv"','Cache-Control':'private, no-store'})

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
MAX_AVATAR_GLB=4_000_000

def valid_avatar_glb(raw,limit=MAX_AVATAR_GLB):
    if not isinstance(raw,bytes) or not 20<=len(raw)<=limit:return False
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
    if not isinstance(data,str) or len(data)>5_400_000 or not data.startswith('data:model/gltf-binary;base64,'):
        return jsonify(error='Upload one self-contained GLB model no larger than 4 MB'),400
    try:raw=base64.b64decode(data.split(',',1)[1],validate=True)
    except (ValueError,base64.binascii.Error):return jsonify(error='Invalid GLB encoding'),400
    if not valid_avatar_glb(raw):return jsonify(error='Invalid, oversized or externally linked GLB avatar'),422
    with g.con:g.con.execute('''INSERT INTO user_avatar_models(user_id,glb) VALUES(?,?) ON CONFLICT(user_id)
      DO UPDATE SET glb=excluded.glb,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',(g.user['id'],raw))
    return jsonify(ok=True,bytes=len(raw),limit=MAX_AVATAR_GLB)

@app.post('/api/me/avatar-3d/optimize')
@require_user
def optimize_3d_avatar():
    """Opt-in: queue one private 4 MB target from a <=16 MB self-contained GLB."""
    value=body().get('glb','')
    if not isinstance(value,str) or not value.startswith('data:model/gltf-binary;base64,') or len(value)>21_400_000:
        return jsonify(error='Avatar optimization accepts a single GLB up to 16 MB'),400
    try:raw=base64.b64decode(value.split(',',1)[1],validate=True)
    except (ValueError,base64.binascii.Error):return jsonify(error='Invalid GLB encoding'),400
    if not valid_avatar_glb(raw,limit=avatar_optimizer.MAX_UPLOAD):
        return jsonify(error='Invalid or externally linked GLB avatar (16 MB maximum)'),422
    try:jid=avatar_optimizer.submit(DB,g.user['id'],raw,valid_avatar_glb)
    except ValueError as e:return jsonify(error=str(e)),409
    except RuntimeError as e:return jsonify(error=str(e)),503
    return jsonify(id=jid,status='QUEUED',original_size=len(raw),target_size=MAX_AVATAR_GLB),202

@app.get('/api/me/avatar-3d/optimize/<int:job_id>')
@require_user
def avatar_optimization_status(job_id):
    job=avatar_optimizer.status(DB,g.user['id'],job_id)
    if not job:abort(404)
    return jsonify(**job)

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
        if not re.fullmatch(r'[a-f0-9]{32}\.(jpg|png)',name):continue
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

def selected_3d_provider():
    # Keep the existing SQLite profile_settings CHECK untouched in deployed
    # databases; Tripo is recorded in a separate, schema-additive table.
    override=g.con.execute('SELECT provider FROM profile_3d_provider_override WHERE user_id=?',(g.user['id'],)).fetchone()
    if override:return override['provider']
    legacy=g.con.execute('SELECT model_3d FROM profile_settings WHERE user_id=?',(g.user['id'],)).fetchone()
    return legacy['model_3d'] if legacy else 'auto'

def preferred_3d_provider():
    value=selected_3d_provider()
    if value=='auto':return next((p for p in ('aholo','meshy','tripo') if provider_key(p)), 'aholo')
    return value

def quality_3d_selection(owner, preset=None, texture_quality=None):
    row=g.con.execute('SELECT preset,texture_quality,xr_texture_edge FROM profile_3d_quality WHERE user_id=?',(owner,)).fetchone()
    return {'preset':preset or (row['preset'] if row else 'xr'),
            'texture_quality':texture_quality or (row['texture_quality'] if row else 'standard'),
            'xr_texture_edge':row['xr_texture_edge'] if row else 1024}

@app.route('/api/preferences/3d/quality', methods=['GET','PUT'])
@require_user
def quality_3d_preference():
    if request.method=='GET':
        prefs=quality_3d_selection(g.user['id'])
        return jsonify(**prefs,choices={k:{**v} for k,v in tripo3d.PRESETS.items()},
                       texture_levels=list(tripo3d.TEXTURE_LEVELS))
    v=body()
    if v.get('preset') not in tripo3d.PRESETS or v.get('texture_quality') not in tripo3d.TEXTURE_LEVELS or v.get('xr_texture_edge') not in (512,1024,2048):
        return jsonify(error='Choose a valid 3D preset, texture detail and XR texture limit'),400
    with g.con:
        g.con.execute('''INSERT INTO profile_3d_quality(user_id,preset,texture_quality,xr_texture_edge)
        VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET preset=excluded.preset,
        texture_quality=excluded.texture_quality,xr_texture_edge=excluded.xr_texture_edge''',
        (g.user['id'],v['preset'],v['texture_quality'],v['xr_texture_edge']))
    return jsonify(**quality_3d_selection(g.user['id']))

@app.route('/api/preferences/3d',methods=['GET','PUT'])
@require_user
def model_3d_preference():
    if request.method=='GET':
        return jsonify(provider=preferred_3d_provider(),selected=selected_3d_provider(),
            available={k:bool(provider_key(k)) for k in ('aholo','meshy','tripo')})
    v=body();value=v.get('provider')
    if value not in ('auto','aholo','meshy','tripo'):return jsonify(error='Choose AHOLO, Meshy, or Tripo'),400
    with g.con:
        if value=='tripo':
            g.con.execute('INSERT INTO profile_settings(user_id,model_3d) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET model_3d=excluded.model_3d',(g.user['id'],'auto'))
            g.con.execute('INSERT INTO profile_3d_provider_override(user_id,provider) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider',(g.user['id'],'tripo'))
        else:
            g.con.execute('DELETE FROM profile_3d_provider_override WHERE user_id=?',(g.user['id'],))
            g.con.execute('INSERT INTO profile_settings(user_id,model_3d) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET model_3d=excluded.model_3d',(g.user['id'],value))
    return jsonify(provider=preferred_3d_provider(),selected=value)

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

def _library_thumbnail(image_name, image_sha, owner_id):
    """Private, reusable low-bandwidth XR gallery image. Originals remain unchanged."""
    from PIL import Image,ImageOps,UnidentifiedImageError
    source=IMAGE_DIR/image_name
    if not source.is_file():abort(404)
    folder=IMAGE_DIR/'.xr-thumbnails';folder.mkdir(exist_ok=True)
    # SHA is derived from the stored object, never from user-supplied path text.
    digest=re.sub('[^a-f0-9]','',str(image_sha).lower())[:64]
    target=folder/f'{owner_id}-{digest}-224.jpg'
    if not target.is_file():
        try:
            with Image.open(source) as image:
                image=ImageOps.exif_transpose(image)
                if image.width*image.height>36_000_000:abort(413)
                image.thumbnail((224,224),Image.Resampling.LANCZOS)
                if image.mode!='RGB':
                    rgb=Image.new('RGB',image.size,(31,39,35));
                    if 'A' in image.getbands():rgb.paste(image,mask=image.getchannel('A'))
                    else:rgb.paste(image.convert('RGB'))
                    image=rgb
                tmp=folder/f'.{owner_id}-{digest}-{secrets.token_hex(6)}.jpg'
                try:
                    image.save(tmp,'JPEG',quality=62,optimize=True,progressive=True)
                    os.replace(tmp,target)
                finally:tmp.unlink(missing_ok=True)
        except (UnidentifiedImageError,OSError,ValueError):abort(404)
    response=send_file(target,mimetype='image/jpeg',conditional=True,max_age=86400)
    response.headers['Cache-Control']='private, max-age=86400'
    response.headers['Vary']='Cookie'
    return response

@app.get('/api/captures/<int:cid>/thumbnail')
@require_user
def capture_xr_thumbnail(cid):
    row=g.con.execute('SELECT image_name,sha256 FROM captures WHERE owner_id=? AND id=?',(g.user['id'],cid)).fetchone()
    if not row:abort(404)
    return _library_thumbnail(row['image_name'],row['sha256'],g.user['id'])

@app.get('/api/objects/<int:oid>/thumbnail')
@require_user
def object_xr_thumbnail(oid):
    row=g.con.execute('SELECT image_name,sha256 FROM objects WHERE owner_id=? AND id=?',(g.user['id'],oid)).fetchone()
    if not row or not row['image_name']:abort(404)
    return _library_thumbnail(row['image_name'],row['sha256'],g.user['id'])

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
    rows=g.con.execute('SELECT * FROM objects WHERE owner_id=? ORDER BY id DESC LIMIT 2000',(g.user['id'],)).fetchall()
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

def analysis_inference_limits():
    """Operator-controlled *separate* budget for explicitly requested progress summaries.

    Set in /etc/free-lab.env, not in frontend code or a versioned release.
    Disabled by default; zero means unlimited for that dimension.
    """
    enabled=os.getenv('FREE_LAB_ANALYSIS_ENFORCE_LIMITS','0').strip().lower() in ('1','true','yes','on')
    if not enabled:return {'daily_cap':0,'user_cap':0,'cooldown':0}
    def number(name):
        try:return max(0,min(100000,int(os.getenv(name,'0'))))
        except (ValueError,TypeError):return 0
    return {'daily_cap':number('FREE_LAB_ANALYSIS_DAILY_LIMIT'),
            'user_cap':number('FREE_LAB_ANALYSIS_USER_DAILY_LIMIT'),
            'cooldown':number('FREE_LAB_ANALYSIS_COOLDOWN_SECONDS')}

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
                   video={},three_d={p:{'available':bool(provider_key(p)),'async':True} for p in ('aholo','meshy','tripo')},message='3D provider preference selects Aholo, Meshy or Tripo; no silent fallback.')

def job_3d_dict(row):
    owner=row['owner_id']
    thumb=_model_thumb_path(owner,row['id'])
    source_url=_job_source_image_url(row)
    can_render=row['status']=='SUCCEEDED' and bool(row['model_path']) and bool(avatar_optimizer.blender_command())
    thumbnail_url=('/api/media/3d/'+str(row['id'])+'/thumbnail' if thumb.is_file() or can_render else row['thumbnail_url'] or source_url)
    thumbnail_kind=('blender' if thumb.is_file() else 'rendering' if can_render else 'provider' if row['thumbnail_url'] else 'source' if source_url else '')
    return {'id':row['id'],'capture_id':row['capture_id'],'object_id':row['object_id'],
            'provider':row['provider'],'model_id':row['model_id'] or None,
            'quality_preset':row['quality_preset'],'texture_quality':row['texture_quality'],
            'face_limit':row['face_limit'],'xr_texture_edge':row['xr_texture_edge'],
            'transform':json.loads(row['transform_json'] or '{}'), 'status':row['status'],'progress':row['progress'],
            'credits':row['credits'],'thumbnail_url':thumbnail_url,'thumbnail_kind':thumbnail_kind,
            'source_image_url':source_url,
            'error':row['error'],'created_at':row['created_at'],
            'cached':bool(row['model_path']),'cache_error':row['cache_error'],
            'glb_url':('/api/media/3d/'+str(row['id'])+'/asset' if row['model_path'] else row['glb_url'])}

@app.get('/api/media/3d')
@require_user
def jobs_3d():
    # No Tripo auth/decryption or background task creation on a plain list GET.
    # Repeated room/XR collection reads must remain cheap even during conversion.
    rows=g.con.execute('SELECT * FROM jobs_3d WHERE owner_id=? ORDER BY id DESC LIMIT 100',(g.user['id'],)).fetchall()
    return jsonify(jobs=[job_3d_dict(row) for row in rows])

@app.get('/api/media/3d/check')
@require_user
def media_3d_check():
    """Read-only capability test, no provider calls or credits charged."""
    provider=preferred_3d_provider()
    jobs=g.con.execute('SELECT id,status,error,created_at FROM jobs_3d WHERE owner_id=? AND provider=? ORDER BY id DESC LIMIT 3',
                       (g.user['id'],provider)).fetchall()
    configured=bool(provider_key(provider))
    check={'verified':False,'message':'Provider key not configured; no request sent.'}
    if provider=='tripo' and configured:
        check=provider_checks.check('tripo',provider_key(provider))
    elif configured:check={'verified':False,'message':'Key configured. No live read-only test is requested for this provider.'}
    return jsonify(provider=provider,configured=configured,billable=False,
        verified=bool(check.get('verified')),connection=check,
        notice='Tripo balance test is read-only and free. Model generation requires separate paid confirmation.',
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
        return jsonify(error='Image + text guided 3D currently requires AHOLO. Clear guidance or select AHOLO. No paid task submitted.'),422
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
        elif provider=='meshy':task=meshy3d.submit(raw,key)
        elif provider=='tripo':
            setting=quality_3d_selection(g.user['id'],preset=v.get('quality_preset'))
            setting['texture_quality']=v.get('texture_quality') or setting['texture_quality']
            options=tripo3d.generation_options(setting['preset'],setting['texture_quality'])
            task=tripo3d.submit(raw,key,prompt.strip(),setting['preset'],setting['texture_quality'])
        else:raise ValueError('Unsupported 3D provider')
        with g.con:
            job=g.con.execute('''INSERT INTO jobs_3d(owner_id,capture_id,object_id,provider,provider_task,model_id,
              quality_preset,face_limit,texture_quality,xr_texture_edge) VALUES(?,?,?,?,?,?,?,?,?,?)''',
              (g.user['id'],cid,oid,provider,task,options['model'] if provider=='tripo' else '',
               setting['preset'] if provider=='tripo' else '',options['face_limit'] if provider=='tripo' else 0,
               setting['texture_quality'] if provider=='tripo' else '',setting['xr_texture_edge'] if provider=='tripo' else 640)).lastrowid
        db.finish_inference(g.con,call,'ok')
        _xr_ensure_job_monitor(g.user['id'],job,key)
        return jsonify(id=job,status='PENDING',provider=provider,paid_task_submitted=True),202
    except (ValueError,RuntimeError,OSError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502

@app.get('/api/media/3d/<int:jid>')
@require_user
def media_3d_status(jid):
    row=g.con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    # A room-state request must never wait for a provider network call.
    if row['status'] in ('PENDING','IN_PROGRESS','UNKNOWN'):
        _xr_ensure_task_poll(g.user['id'],jid,provider_key(row['provider']))
    elif row['status']=='SUCCEEDED' and not row['model_path']:
        owner=g.user['id'];output,failed,pending=_xr_preview_paths(owner,jid)
        if not failed.is_file():
            key=provider_key('tripo') if row['provider']=='tripo' else None
            _xr_ensure_preview_worker(owner,jid,key)
    elif row['status']=='SUCCEEDED' and row['model_path']:
        _ensure_model_thumbnail(g.user['id'],jid)
    return jsonify(job_3d_dict(row))


@app.patch('/api/media/3d/<int:jid>/transform')
@require_user
def update_3d_transform(jid):
    # Transform is relative to the image's spatial pose; moving the source
    # automatically moves its attached 3D object without another paid task.
    v=body();offset=v.get('offset');rotation=v.get('rotation');size=v.get('scale');axis_scale=v.get('axis_scale',[1,1,1])
    def bounded(values,length,limit):
        return isinstance(values,list) and len(values)==length and all(
            type(x) in (int,float) and math.isfinite(x) and abs(x)<=limit for x in values)
    if not bounded(offset,3,3) or not bounded(rotation,4,1.1) or not (type(size) in (int,float) and math.isfinite(size) and .2<=size<=4) or not (bounded(axis_scale,3,4) and all(.2<=x<=4 for x in axis_scale)):
        return jsonify(error='Invalid 3D position, rotation or scale'),400
    norm=math.sqrt(sum(x*x for x in rotation))
    if norm<.2 or norm>1.8:return jsonify(error='Invalid 3D orientation'),400
    # Backward compatibility: v0.10.45 clients could send unequal XYZ scales.
    # Store one proportional scale instead, never a distorted GLB shape.
    uniform_size=min(4,max(.2,float(size)*math.prod(float(x) for x in axis_scale)**(1/3)))
    transform={'offset':[round(float(x),4) for x in offset],
               'rotation':[round(float(x/norm),6) for x in rotation], 'scale':round(uniform_size,4),
               'axis_scale':[1.0,1.0,1.0]}
    with g.con:
        changed=g.con.execute('UPDATE jobs_3d SET transform_json=? WHERE id=? AND owner_id=?',
                              (json.dumps(transform,separators=(',',':')),jid,g.user['id']))
    if not changed.rowcount:abort(404)
    return jsonify(job_id=jid,transform=transform,saved=True)

@app.get('/api/media/3d/<int:jid>/thumbnail')
@require_user
def private_3d_thumbnail(jid):
    row=g.con.execute('SELECT id,owner_id,capture_id,object_id,status,model_path FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    thumb=_model_thumb_path(g.user['id'],jid)
    if thumb.is_file():
        resp=send_file(thumb,mimetype='image/png',max_age=0)
        resp.headers['Cache-Control']='private, no-store'
        return resp
    if row['status']=='SUCCEEDED' and row['model_path']:
        _ensure_model_thumbnail(g.user['id'],jid)
    # While Blender renders, serve the exact source image as a temporary poster.
    # Never expose someone else's capture, and never claim it is a 3D render.
    if row['object_id']:
        origin=g.con.execute('SELECT image_name FROM objects WHERE id=? AND owner_id=? AND shelf!=?',
                             (row['object_id'],g.user['id'],'bin')).fetchone()
    else:
        origin=None
    if not origin and row['capture_id']:
        origin=g.con.execute('SELECT image_name FROM captures WHERE id=? AND owner_id=?',
                             (row['capture_id'],g.user['id'])).fetchone()
    if origin and re.fullmatch(r'[a-f0-9]{32}\.(jpg|png)',origin['image_name'] or ''):
        image=IMAGE_DIR/origin['image_name']
        if image.is_file():
            resp=send_file(image,mimetype='image/png' if image.suffix=='.png' else 'image/jpeg',max_age=0)
            resp.headers['Cache-Control']='private, no-store';return resp
    abort(404)

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

def _model_pipeline_diagnostics(row, jid, owner):
    """Owner-only, read-only inspection: no provider calls, no credentials or URLs."""
    converted,failed,pending=_xr_preview_paths(owner,jid)
    provider=row['provider'];known=('aholo','meshy','tripo')
    valid_url=(tripo3d.safe_file_url(row['glb_url'],trusted_task=True) if provider=='tripo'
               else meshy3d.safe_file_url(row['glb_url']) if provider=='meshy'
               else aholo3d.safe_preview_url(row['glb_url']) if provider=='aholo' else None)
    result={'job_id':jid,'provider':provider,'model_id':row['model_id'] or None,
            'model_note':('Model version was not recorded when this older task was submitted' if not row['model_id'] else ''),
            'provider_status':row['status'],'progress':row['progress'],
            'provider_task':row['provider_task'][:96],
            'source_capture_id':row['capture_id'],'source_object_id':row['object_id'],
            'blender_available':bool(avatar_optimizer.blender_command()),
            'cache_error':row['cache_error'] or '',
            'preview_error':failed.read_text()[:180] if failed.is_file() else '',
            'model':{'cached':False,'bytes':0,'compression':[], 'meshes':None,'triangles':None},
            'steps':[],'stage':'generation','next_action':''}
    steps=result['steps']
    steps.append({'name':'generation','state':row['status'],'detail':str(row['error'] or '')[:160]})
    if row['status']!='SUCCEEDED':
        result['stage']='generation';result['next_action']='Wait for the provider task to finish, or inspect its failure status.'
        return result
    steps.append({'name':'provider output','state':'READY' if valid_url or row['model_path'] else 'MISSING',
                  'detail':'Tripo/Meshy/AHOLO output URL verified by allowlist' if valid_url else 'No approved provider download URL'})
    if not valid_url and not row['model_path']:
        result['stage']='provider output';result['next_action']='Refresh the existing provider task to obtain a valid model URL; do not regenerate.'
        return result
    raw=None;name=row['model_path']
    if name==f'{owner}_{jid}.glb':
        file=MODEL_DIR/name
        if file.is_file():
            result['model']['cached']=True;result['model']['bytes']=file.stat().st_size
            if file.stat().st_size<=model_cache.MAX_MODEL:
                raw=file.read_bytes()
    steps.append({'name':'private GLB download','state':'SAVED' if raw else 'NOT_CACHED',
                  'detail':(str(result['model']['bytes'])+' bytes stored' if raw else (row['cache_error'] or 'Not cached yet; model URL still required'))[:180]})
    if not raw:
        result['stage']='private download';result['next_action']='Refresh this job read-only to retry the private GLB download; review cache error.'
        return result
    try:
        if len(raw)>glb_xr.MAX_FILE:
            steps.append({'name':'GLB structure','state':'LARGE','detail':'Original is '+str(round(len(raw)/1_000_000,1))+' MB; Blender prepares a separate Quest copy'})
            result['stage']='Quest conversion';result['next_action']='Wait for the separate Quest preview copy to finish.'
            return result
        doc,_=glb_xr.chunks(raw)
        exts=doc.get('extensionsUsed') or []
        meshes=doc.get('meshes') or []
        compressions=sorted({str(ext)[:65] for ext in exts if ext in ('KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_mesh_quantization')})
        result['model'].update(compression=compressions,meshes=len(meshes),
                               triangles=sum(len(m.get('primitives',[])) for m in meshes))
        steps.append({'name':'GLB structure','state':'VALID','detail':str(len(meshes))+' meshes; '+(', '.join(compressions) if compressions else 'no declared geometry compression')})
    except (ValueError,TypeError,KeyError) as e:
        steps.append({'name':'GLB structure','state':'INVALID','detail':str(e)[:160]})
        result['stage']='GLB structure';result['next_action']='The cached provider file is not a valid supported GLB.'
        return result
    if converted.is_file():
        steps.append({'name':'Quest conversion','state':'READY','detail':str(converted.stat().st_size)+' bytes prepared'})
        try:
            glb_xr.decode_visual(converted.read_bytes())
            steps.append({'name':'Quest geometry','state':'READY','detail':'Prepared mesh can be decoded; if invisible check XR GPU and source attachment'})
            result['stage']='XR placement';result['next_action']='Model bytes are Quest-ready. Inspect XR renderer and source visibility if still absent.'
        except (ValueError,TypeError) as e:
            steps.append({'name':'Quest geometry','state':'FAILED','detail':str(e)[:160]})
            result['stage']='Quest decoder';result['next_action']='Retry XR preparation of the existing model; no generation task will be submitted.'
        return result
    if failed.is_file():
        steps.append({'name':'Quest conversion','state':'FAILED','detail':result['preview_error']})
        result['stage']='Blender conversion';result['next_action']='Inspect converter error; tap the XR status cube again or use Retry XR preview in Collection.'
        return result
    if pending.is_file() and time.time()-pending.stat().st_mtime<330:
        steps.append({'name':'Quest conversion','state':'RUNNING','detail':'Blender preview preparation is running'})
        result['stage']='Blender conversion';result['next_action']='Wait for the preparation worker; it does not submit another paid 3D job.'
        return result
    try:
        glb_xr.decode_visual(raw)
        steps.append({'name':'Quest geometry','state':'READY','detail':'Original cached GLB is directly decodable'})
        result['stage']='XR placement';result['next_action']='Check Quest GPU loading and source visibility; server geometry is valid.'
    except (ValueError,TypeError) as e:
        steps.append({'name':'Quest geometry','state':'NEEDS_CONVERSION','detail':str(e)[:160]})
        result['stage']='Blender conversion' if result['blender_available'] else 'Blender unavailable'
        result['next_action']=('Retry XR preview preparation; no paid generation.' if result['blender_available']
                              else 'Install or configure headless Blender on the server; use the desktop 3D viewer meanwhile.')
    return result


@app.get('/api/media/3d/<int:jid>/diagnostics')
@require_user
def media_3d_diagnostics(jid):
    row=g.con.execute('SELECT * FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    return jsonify(_model_pipeline_diagnostics(row,jid,g.user['id']))


@app.post('/api/media/3d/<int:jid>/preview/retry')
@require_user
def media_3d_preview_retry(jid):
    row=g.con.execute('SELECT status FROM jobs_3d WHERE id=? AND owner_id=?',(jid,g.user['id'])).fetchone()
    if not row:abort(404)
    if row['status']!='SUCCEEDED':return jsonify(error='Provider generation is not completed'),409
    owner=g.user['id'];output,error,pending=_xr_preview_paths(owner,jid)
    cached=_xr_preview_json_path(owner,jid)
    with _xr_preview_guard:
        if (owner,jid) in _xr_preview_active or (pending.exists() and time.time()-pending.stat().st_mtime<330):
            return jsonify(error='Quest conversion is already in progress'),409
        error.unlink(missing_ok=True)
    cached.unlink(missing_ok=True);pending.unlink(missing_ok=True)
    _xr_preview_revision_path(owner,jid).unlink(missing_ok=True)
    _xr_preview_error_version_path(owner,jid).unlink(missing_ok=True)
        # A converted GLB was already validated; do not discard it.
    return jsonify(status='READY_TO_RETRY',job_id=jid,paid_generation=False,
                   message='Preview errors cleared; next read-only preview request will retry decoding or Blender preparation.')


@app.get('/api/media/3d/<int:jid>/preview')
@require_user
def media_3d_preview(jid):
    # No provider API, GLB download, JSON mesh decode or Blender in the request.
    row=g.con.execute('SELECT status,provider,provider_task,model_path FROM jobs_3d WHERE id=? AND owner_id=?',
                      (jid,g.user['id'])).fetchone()
    if not row:abort(404)
    if row['status']!='SUCCEEDED':
        return jsonify(error='3D model still generating',stage='generation',code='JOB_NOT_FINISHED',job_id=jid),409
    owner=g.user['id'];cached=_xr_preview_json_path(owner,jid)
    output,failed,pending=_xr_preview_paths(owner,jid)
    revision=_xr_preview_revision_path(owner,jid)
    if cached.is_file() and revision.is_file() and revision.read_text() == _XR_TEXTURE_REVISION:
        response=app.response_class(cached.read_bytes(),mimetype='application/json')
        response.headers['Cache-Control']='private, no-store'
        return response
    if cached.is_file():
        # Old previews have welded together atlas UV seams. Rebuild from the
        # already purchased GLB; no new Tripo generation or model download.
        cached.unlink(missing_ok=True)
        revision.unlink(missing_ok=True)
    if failed.is_file():
        marker=_xr_preview_error_version_path(owner,jid)
        # Previously failed jobs should be retried ONCE on this new deployment,
        # not stranded indefinitely behind an error from obsolete conversion code.
        if not marker.is_file() or marker.read_text().strip()!=VERSION:
            failed.unlink(missing_ok=True);marker.unlink(missing_ok=True)
        else:
            return jsonify(error=failed.read_text()[:180],stage='XR model preparation',code='PREVIEW_FAILED',job_id=jid),422
    key=provider_key('tripo') if row['provider']=='tripo' else None
    state=_xr_ensure_preview_worker(owner,jid,key)
    progress_label=_xr_preview_stage_path(owner,jid)
    stage=progress_label.read_text()[:60] if progress_label.is_file() else 'Preparing model'
    return jsonify(status=state,stage=stage,job_id=jid,
                   message='Preparing existing model without submitting another paid task',paid_generation=False),202

@app.post('/api/media/text-to-image')
@require_user
def generate_text_only_image():
    """Generate a new saved source from a text instruction; no camera required."""
    v=body();prompt=v.get('prompt','')
    if not isinstance(prompt,str) or not 3<=len(prompt.strip())<=750:
        return jsonify(error='Prompt must be 3–750 characters'),400
    if v.get('confirm_paid') is not True:return jsonify(error='Explicit image generation consent required'),400
    key=request_meta_key(v)
    if not key:return jsonify(error='Configure Meta API key first'),503
    digest=hashlib.sha256(prompt.strip().encode()+secrets.token_bytes(12)+b'|muse-image-1.0:text').hexdigest()
    try:call=db.begin_inference(g.con,g.user['id'],digest,'muse-image-1.0',
        daily_cap=application_inference_limits()['daily_cap'],user_cap=application_inference_limits()['user_cap'],
        cooldown=application_inference_limits()['cooldown'])
    except ValueError as e:return jsonify(error=str(e)),429
    try:
        jpeg,usage=media.generate_meta_image(prompt.strip(),key)
        name=secrets.token_hex(16)+'.jpg';dest=IMAGE_DIR/name;dest.write_bytes(jpeg)
        try:
            with g.con:
                cid=g.con.execute('INSERT INTO captures(owner_id,image_name,sha256,description) VALUES(?,?,?,?)',
                     (g.user['id'],name,hashlib.sha256(jpeg).hexdigest(),prompt.strip()[:240])).lastrowid
        except Exception:
            dest.unlink(missing_ok=True);raise
        db.finish_inference(g.con,call,'ok',usage)
        return jsonify(capture_id=cid,image_url=f'/api/captures/{cid}/image',provider='meta',usage=usage),201
    except (ValueError,RuntimeError,OSError) as e:
        db.finish_inference(g.con,call,'error');return jsonify(error=str(e)),502


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
        # Traverse the saved parent chain rather than prepend visible strings.
        edit_generation=1
        if parent:
            ancestor=g.con.execute('SELECT label,operation,parent_object_id FROM objects WHERE id=? AND owner_id=?',(parent,g.user['id'])).fetchone()
            visited=set()
            while ancestor and ancestor['parent_object_id'] not in visited:
                if ancestor['operation'] in ('image_edit','mix'):
                    edit_generation+=1
                if ancestor['parent_object_id'] is None:break
                visited.add(ancestor['parent_object_id'])
                ancestor=g.con.execute('SELECT label,operation,parent_object_id FROM objects WHERE id=? AND owner_id=?',(ancestor['parent_object_id'],g.user['id'])).fetchone()
        try:
            with g.con:
                new_id=g.con.execute('''INSERT INTO objects(owner_id,label,description,provider,image_name,sha256,capture_id,parent_object_id,operation)
                       VALUES(?,?,?,?,?,?,?,?,?)''',(g.user['id'],db.canonical_edit_label(label, edit_generation)[:80],prompt.strip()[:240],
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

def _room_card_info(r, now):
    '''Owner/guest usage only; private assets are never enumerated from other rooms.'''
    rid = r['id']
    stats = g.con.execute('''SELECT COUNT(*) AS sessions,
        COALESCE(SUM(MAX(0,COALESCE(ended_at,last_seen_at)-started_at)),0) AS seconds,
        MAX(last_seen_at) AS accessed FROM room_sessions WHERE room_id=?''', (rid,)).fetchone()
    latest = g.con.execute('''SELECT started_at,last_seen_at,ended_at
        FROM room_sessions WHERE room_id=? ORDER BY last_seen_at DESC,id DESC LIMIT 1''', (rid,)).fetchone()
    host = g.con.execute('''SELECT last_seen_at FROM room_sessions WHERE room_id=? AND role='host'
        ORDER BY id DESC LIMIT 1''', (rid,)).fetchone()
    live = bool(r['active'] and host and host['last_seen_at'] >= now-50)
    visitors = g.con.execute('''SELECT COUNT(*) FROM room_presence
        WHERE room_id=? AND last_seen>=?''', (rid,now-35)).fetchone()[0]
    # The background is a capture explicitly published to this room, never an
    # arbitrary image from the room owner's private collection.
    try:
        cards = json.loads(r['state_json']).get('cards', [])
    except (ValueError, TypeError, AttributeError):
        cards = []
    thumbnail = False
    media_count = 0
    if isinstance(cards,list):
        media_count=sum(isinstance(card,dict) and card.get('kind') in ('capture','object') for card in cards[-72:])
        for card in reversed(cards[-72:]):
            if not isinstance(card,dict) or card.get('kind') not in ('capture','object') or type(card.get('id')) is not int:
                continue
            table='captures' if card['kind']=='capture' else 'objects'
            extra='hidden=0' if card['kind']=='capture' else "shelf!='bin'"
            found=g.con.execute(f'''SELECT image_name FROM {table} WHERE id=? AND owner_id=? AND image_name IS NOT NULL AND image_name!='' AND {extra}''',
                (card['id'],r['owner_id'])).fetchone()
            if found:
                image_root=IMAGE_DIR.resolve()
                image_path=(image_root/found['image_name']).resolve()
                if image_path.is_relative_to(image_root) and image_path.is_file():
                    thumbnail=True
                    break
    can_view_thumb = r['visibility']=='public' or r['owner_id']==g.user['id'] or r['invited']==1
    last_seen = stats['accessed']
    # For rooms created prior to tracking, preserve a truthful last activity
    # timestamp from the published state; do not invent historical sessions.
    fallback = r['updated_at'] if not last_seen else None
    return {
      'active':live,'participant_count':visitors+(1 if live else 0),'media_count':media_count,
      'session_count':stats['sessions'],'total_session_seconds':stats['seconds'],
      'last_session_seconds':max(0, (latest['ended_at'] if latest['ended_at'] is not None else latest['last_seen_at'])-latest['started_at']) if latest else None,
      'last_accessed_at':datetime.fromtimestamp(last_seen,timezone.utc).isoformat().replace('+00:00','Z') if last_seen else fallback,
      'thumbnail_url':f'/api/rooms/{rid}/thumbnail' if thumbnail and can_view_thumb else None,
    }

@app.get('/api/rooms')
@require_user
def list_rooms():
    rows=g.con.execute('''SELECT r.*,u.display_name AS owner_name,
     m.accepted AS invited FROM live_rooms r JOIN users u ON u.id=r.owner_id
     LEFT JOIN room_members m ON m.room_id=r.id AND m.user_id=?
     WHERE r.owner_id=? OR r.visibility='public' OR m.user_id=?
     ORDER BY r.active DESC,r.updated_at DESC LIMIT 100''',(g.user['id'],g.user['id'],g.user['id'])).fetchall()
    now=int(time.time())
    cards=[{**_room_dict(r),**_room_card_info(r,now),'owner':r['owner_name'],
      'joined':r['owner_id']==g.user['id'] or r['invited']==1,
      'mine':r['owner_id']==g.user['id'],
      'invited':r['invited']==0} for r in rows]
    cards.sort(key=lambda item:(not item['active'],item['last_accessed_at'] or ''),reverse=False)
    return jsonify(rooms=cards)

@app.get('/api/rooms/<int:rid>/thumbnail')
@require_user
def room_thumbnail(rid):
    '''Small room-scoped image only, never unrestricted private media access.'''
    r=_room_access(rid,require_join=False)
    if not r or (r['visibility']=='private' and not _room_access(rid)):
        abort(404)
    try:
        cards=json.loads(r['state_json']).get('cards',[])
    except (ValueError,TypeError,AttributeError):
        cards=[]
    if not isinstance(cards,list):abort(404)
    for card in reversed(cards[-72:]):
        if not isinstance(card,dict) or type(card.get('id')) is not int:continue
        if card.get('kind')=='capture':
            item=g.con.execute('''SELECT image_name FROM captures WHERE id=? AND owner_id=? AND hidden=0''',
                               (card['id'],r['owner_id'])).fetchone()
        elif card.get('kind')=='object':
            item=g.con.execute('''SELECT image_name FROM objects WHERE id=? AND owner_id=? AND shelf!='bin' ''',
                               (card['id'],r['owner_id'])).fetchone()
        else:continue
        if not item or not item['image_name']:continue
        image_root=IMAGE_DIR.resolve()
        path=(image_root/item['image_name']).resolve()
        if not path.is_relative_to(image_root) or not path.is_file() or path.stat().st_size>16*1024*1024:continue
        try:
            from PIL import Image,ImageOps
            with Image.open(path) as source:
                preview=ImageOps.fit(ImageOps.exif_transpose(source).convert('RGB'),(680,380),method=Image.Resampling.LANCZOS)
                output=io.BytesIO()
                preview.save(output,format='JPEG',quality=76,optimize=True)
            output.seek(0)
            response=send_file(output,mimetype='image/jpeg',max_age=0)
            response.headers['Cache-Control']='private, no-store'
            return response
        except (OSError,ValueError,Image.DecompressionBombError):continue
    abort(404)

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
    if r and request.method=='PUT':
        with g.con:db.record_room_session(g.con,r['id'],g.user['id'],'host',True)
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
        with g.con:
            g.con.execute('''INSERT INTO room_presence(room_id,user_id,last_seen) VALUES(?,?,?)
                ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen=excluded.last_seen''',(rid,g.user['id'],int(time.time())))
            db.record_room_session(g.con,rid,g.user['id'],'visitor',True)
    return jsonify(ok=True)

@app.delete('/api/rooms/<int:rid>/presence')
@require_user
def room_leave_presence(rid):
    with g.con:
        g.con.execute('DELETE FROM room_presence WHERE room_id=? AND user_id=?',(rid,g.user['id']))
        db.record_room_session(g.con,rid,g.user['id'],'visitor',False)
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
    with g.con:
        g.con.execute('''UPDATE live_rooms SET state_json=?,active=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?''',(payload,int(active),r['id']))
        db.record_room_session(g.con,r['id'],g.user['id'],'host',active)
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
