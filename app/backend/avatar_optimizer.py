"""Bounded, private GLB optimizer; headless Blender is optional, never billed.

Input is a validated embedded-only GLB. Async jobs live in SQLite so polling is
independent of a particular request/worker. Blender is invoked with a fixed script.
"""
from __future__ import annotations
import os,shutil,sqlite3,subprocess,tempfile,threading,time
from pathlib import Path
from . import db

MAX_UPLOAD=16_000_000
MAX_XR=4_000_000
MAX_SECONDS=240

MAX_THUMBNAIL_SECONDS=120


def blender_command():
    configured=os.getenv('FREE_LAB_BLENDER_BIN','').strip()
    if configured and Path(configured).is_file() and os.access(configured,os.X_OK):return configured
    return shutil.which('blender')



def init(path):
    with db.connect(path) as con:
        con.execute('''CREATE TABLE IF NOT EXISTS avatar_optimization_jobs (
          id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'QUEUED', original_size INTEGER NOT NULL,
          input_glb BLOB, result_size INTEGER, error TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)''')
        con.execute('CREATE INDEX IF NOT EXISTS avatar_opt_user ON avatar_optimization_jobs(owner_id,id DESC)')


def _convert_glb(raw, blender=None, *, input_limit=MAX_UPLOAD, output_limit=MAX_XR, xr_mode=False):
    """Convert a bounded private GLB, with no external URLs or paid provider calls."""
    if not 20 <= len(raw) <= input_limit:raise ValueError('GLB exceeds the conversion input limit')
    program=blender or blender_command()
    if not program:raise RuntimeError('Headless Blender unavailable on this server')
    root=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='fl-glb-') as work:
        src=Path(work)/'input.glb';dst=Path(work)/'output.glb'
        src.write_bytes(raw)
        cmd=[program,'--background','--factory-startup','--disable-autoexec','--threads','2',
             '--python',str(root/'avatar_blender_worker.py'),'--',str(src),str(dst),str(output_limit)]+(['XR'] if xr_mode else [])
        env={k:v for k,v in os.environ.items() if not k.startswith(('PYTHONPATH','PYTHONSTARTUP'))}
        try:r=subprocess.run(cmd,capture_output=True,text=True,timeout=MAX_SECONDS,env=env,cwd=work,check=False)
        except subprocess.TimeoutExpired:raise RuntimeError('Blender model preparation timed out') from None
        except OSError as e:raise RuntimeError('Blender executable cannot be launched') from e
        if r.returncode or not dst.is_file():
            msg=(r.stderr or r.stdout or 'unknown import/export error')[-440:].replace('\n',' ')
            raise RuntimeError('Blender could not prepare the GLB: '+msg)
        output=dst.read_bytes()
        if len(output)>output_limit:raise RuntimeError('Optimized 3D model remains too large for the XR preview budget')
        if len(output)<20 or output[:4]!=b'glTF' or int.from_bytes(output[8:12],'little')!=len(output):
            raise RuntimeError('Blender produced an invalid GLB')
        return output


def optimize(raw, blender=None):
    """Avatar conversion preserves the strict 4 MB attachment policy."""
    if not 20<=len(raw)<=MAX_UPLOAD:raise ValueError('Avatar must be 16 MB or smaller')
    return _convert_glb(raw,blender,input_limit=MAX_UPLOAD,output_limit=MAX_XR)


def optimize_xr_preview(raw, blender=None):
    """Read-only Quest preview prep from a previously paid 3D job; original is preserved."""
    from .model_cache import MAX_MODEL
    return _convert_glb(raw,blender,input_limit=MAX_MODEL,output_limit=8_000_000,xr_mode=True)


def _thumbnail_error(stderr, stdout, code):
    """Report a subprocess's terminal exception, not Blender's traceback wrapper.

    Blender typically prints the real Python exception, then finishes with the
    misleading generic 'Error: Python: Traceback (most recent call last):'.
    Prefer actionable terminal errors, including glTF/Draco shared libraries.
    """
    import re
    lines=[line.strip() for line in ((stderr or '')+'\n'+(stdout or '')).splitlines() if line.strip()]
    terminal=re.compile(r'^(?:OSError|ImportError|ModuleNotFoundError|RuntimeError|ValueError|PermissionError|FileNotFoundError|AttributeError|TypeError|KeyError|Exception):\s*.+',re.I)
    actual=next((line for line in reversed(lines) if terminal.search(line)),None)
    if not actual:
        actual=next((line for line in reversed(lines)
                     if re.search(r'\b(?:lib\S+\.so(?:\.\d+)?|cannot open shared object file|not found|DLL load failed)\b',line,re.I)),None)
    if not actual:
        actual=next((line for line in reversed(lines) if not re.search(r'^(?:Error:\s*)?(?:Python:\s*)?Traceback|^Blender quit|^Blender .*\bquit\b',line,re.I)),
                    'Renderer exited without a PNG')
    # Do not include any private input file paths or credentials in application events.
    actual=re.sub(r'(?<![\w.-])/(?:[^\s:,]+/)+', '<path>/', actual)
    actual=re.sub(r'[\r\n\x00-\x1f]+',' ',actual)[:175]
    if re.search(r'(?:draco|meshopt)',actual,re.I) and re.search(r'(?:\.so|library|shared object|not found)',actual,re.I):
        actual+=' (GLB decoder library missing or broken in server Blender)'
    return f'Blender exit {code}: {actual}'


def render_thumbnail(raw, blender=None, size=512):
    """Render a square PNG thumbnail from a private GLB using headless Blender."""
    from .model_cache import MAX_MODEL
    if not 20<=len(raw)<=MAX_MODEL:raise ValueError('GLB exceeds the thumbnail input limit')
    program=blender or blender_command()
    if not program:raise RuntimeError('Headless Blender unavailable on this server')
    size=max(256,min(1024,int(size or 512)))
    root=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='fl-glb-thumb-') as work:
        src=Path(work)/'input.glb';dst=Path(work)/'thumbnail.png'
        src.write_bytes(raw)
        cmd=[program,'--background','--factory-startup','--disable-autoexec','--threads','2',
             '--python-exit-code','12','--python',str(root/'model_thumbnail_worker.py'),
             '--',str(src),str(dst),str(size)]
        env={k:v for k,v in os.environ.items() if not k.startswith(('PYTHONPATH','PYTHONSTARTUP'))}
        try:r=subprocess.run(cmd,capture_output=True,text=True,timeout=MAX_THUMBNAIL_SECONDS,env=env,cwd=work,check=False)
        except subprocess.TimeoutExpired:raise RuntimeError('Blender thumbnail render timed out') from None
        except OSError as e:raise RuntimeError('Blender executable cannot be launched') from e
        if r.returncode or not dst.is_file():
            raise RuntimeError('Blender could not render the thumbnail: '+
                               _thumbnail_error(r.stderr,r.stdout,r.returncode))
        output=dst.read_bytes()
        if len(output)<100 or output[:8]!=b'\x89PNG\r\n\x1a\n':
            raise RuntimeError('Blender produced an invalid thumbnail')
        return output


def _worker(path,job_id,validate):
    with db.connect(path) as con:
        with con:
            claimed=con.execute("UPDATE avatar_optimization_jobs SET status='RUNNING',updated_at=? WHERE id=? AND status='QUEUED'",(int(time.time()),job_id))
        if not claimed.rowcount:return
        row=con.execute('SELECT owner_id,input_glb FROM avatar_optimization_jobs WHERE id=?',(job_id,)).fetchone()
        if row is None or row['input_glb'] is None:return
        try:
            output=optimize(bytes(row['input_glb']))
            if not validate(output):raise RuntimeError('Optimized model failed avatar validation')
            with con:
                con.execute('''INSERT INTO user_avatar_models(user_id,glb) VALUES(?,?)
                  ON CONFLICT(user_id) DO UPDATE SET glb=excluded.glb,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')''',(row['owner_id'],output))
                con.execute("UPDATE avatar_optimization_jobs SET status='SUCCEEDED',input_glb=NULL,result_size=?,updated_at=? WHERE id=?",(len(output),int(time.time()),job_id))
        except Exception as e:
            with con:con.execute("UPDATE avatar_optimization_jobs SET status='FAILED',input_glb=NULL,error=?,updated_at=? WHERE id=?",(str(e)[:600],int(time.time()),job_id))


def submit(path,uid,raw,validate):
    if not 20<=len(raw)<=MAX_UPLOAD:raise ValueError('Avatar must be 16 MB or smaller')
    if not validate(raw):raise ValueError('Invalid or externally linked GLB')
    if not blender_command():raise RuntimeError('Headless Blender unavailable on server; upload a GLB under 4 MB instead')
    now=int(time.time())
    with db.connect(path) as con:
        pending=con.execute("SELECT id FROM avatar_optimization_jobs WHERE owner_id=? AND status IN ('QUEUED','RUNNING') AND updated_at>?",(uid,now-420)).fetchone()
        if pending:raise ValueError('An avatar optimization is already in progress')
        with con:
            job=con.execute('INSERT INTO avatar_optimization_jobs(owner_id,original_size,input_glb,created_at,updated_at) VALUES(?,?,?,?,?)',(uid,len(raw),raw,now,now)).lastrowid
    thread=threading.Thread(target=_worker,args=(path,job,validate),daemon=True,name=f'freelab-avatar-{job}')
    thread.start()
    return job


def status(path,uid,job):
    with db.connect(path) as con:
        row=con.execute('SELECT id,status,original_size,result_size,error,updated_at FROM avatar_optimization_jobs WHERE id=? AND owner_id=?',(job,uid)).fetchone()
        if not row:return None
        value=dict(row)
        if value['status']=='RUNNING' and int(time.time())-value['updated_at']>MAX_SECONDS+100:
            value['status']='FAILED';value['error']='Optimizer worker interrupted or timed out; resubmit if needed'
            with con:con.execute("UPDATE avatar_optimization_jobs SET status='FAILED',input_glb=NULL,error=? WHERE id=?",(value['error'],job))
        return value
