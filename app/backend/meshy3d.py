"""Opt-in Meshy image-to-3D job adapter. Never fetch arbitrary URLs or expose API keys.

The POST is a billable operation; GET checks are read-only. Image bytes are passed
as a data URI so private source photographs never need to be publicly exposed.
"""
from __future__ import annotations
import base64, json, re, urllib.request, urllib.error
from urllib.parse import urlparse

API='https://api.meshy.ai/openapi/v1/image-to-3d'
TASK_RE=re.compile(r'^[a-zA-Z0-9_-]{8,96}$')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def request(method, url, key, payload=None):
    if url!=API and not (url.startswith(API+'/') and TASK_RE.fullmatch(url[len(API)+1:])):
        raise ValueError('Disallowed provider URL')
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(url,data=data,method=method,headers={
        'Authorization':'Bearer '+key,'Accept':'application/json',
        'Content-Type':'application/json','User-Agent':'FREELAB-3D/0.8'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=35) as resp:
            raw=resp.read(128_001)
            if len(raw)>128_000:raise RuntimeError('Meshy response too large')
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'Meshy returned HTTP {exc.code}. Check credits and API access.') from exc
    except (urllib.error.URLError,TimeoutError) as exc:
        raise RuntimeError('Meshy connection timed out or failed') from exc
    try:result=json.loads(raw)
    except ValueError as exc:raise RuntimeError('Meshy did not return JSON') from exc
    if not isinstance(result,dict):raise RuntimeError('Invalid Meshy response')
    return result

def submit(jpeg:bytes,key:str):
    if not jpeg.startswith(b'\xff\xd8') or len(jpeg)>2_000_000:
        raise ValueError('Expected an existing private JPEG under 2 MB')
    if not key:raise ValueError('Configure the Meshy key in the server vault')
    result=request('POST',API,key,{'image_url':'data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii'),
       'ai_model':'meshy-6-lite','should_texture':True,'target_formats':['glb']})
    job=result.get('result')
    if not isinstance(job,str) or not TASK_RE.fullmatch(job):raise RuntimeError('Meshy did not return a valid task ID')
    return job

def safe_file_url(value):
    if not isinstance(value,str):return None
    u=urlparse(value)
    if u.scheme!='https' or u.username or u.password or u.hostname not in ('assets.meshy.ai','cdn.meshy.ai'):
        return None
    return value if len(value)<4096 else None

def status(task:str,key:str):
    if not TASK_RE.fullmatch(task):raise ValueError('Invalid task ID')
    r=request('GET',API+'/'+task,key)
    state=r.get('status','UNKNOWN')
    if state not in ('PENDING','IN_PROGRESS','SUCCEEDED','FAILED','CANCELED'):state='UNKNOWN'
    progress=r.get('progress',0)
    credits=r.get('consumed_credits')
    urls=r.get('model_urls') or {}
    return {'status':state,'progress':min(100,max(0,int(progress or 0))),
            'glb_url':safe_file_url(urls.get('glb')) if isinstance(urls,dict) else None,
            'thumbnail_url':safe_file_url(r.get('thumbnail_url')),
            'credits':credits if type(credits) is int and 0<=credits<1_000_000 else None,
            'error':str(r.get('task_error') or '')[:180] if state=='FAILED' else ''}
