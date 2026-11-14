"""Tripo v3 opt-in image-to-model adapter.

The image is uploaded privately with multipart/form-data; Tripo receives a
file token, never a FREELAB authentication URL. Creating a task is billable.
GET balance/status operations are read-only. All outbound hosts and response
sizes are bounded, redirects are refused, and credentials never reach clients.
"""
from __future__ import annotations
import json, re, secrets, urllib.request, urllib.error
from urllib.parse import urlsplit

BASE='https://openapi.tripo3d.ai/v3'
MODEL='v3.1-20260211'
TASK_RE=re.compile(r'^[A-Za-z0-9_-]{8,96}$')
FILE_RE=re.compile(r'^[A-Za-z0-9_-]{8,160}$')
MAX_RESPONSE=160_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def request_api(method,path,key,payload=None,raw=None,content_type='application/json'):
    paths=('/account/balance','/files','/generation/image-to-model','/generation/text-to-model')
    if path not in paths and not (path.startswith('/tasks/') and TASK_RE.fullmatch(path[7:])):
        raise ValueError('Unsupported Tripo API endpoint')
    allowed_get=path=='/account/balance' or path.startswith('/tasks/')
    allowed_post=path in ('/files','/generation/image-to-model','/generation/text-to-model')
    if not ((method=='GET' and allowed_get) or (method=='POST' and allowed_post)):
        raise ValueError('Unsupported Tripo API operation')
    if not isinstance(key,str) or not key:raise ValueError('Tripo API key not configured')
    data=raw if raw is not None else json.dumps(payload).encode('utf-8') if payload is not None else None
    if data is not None and len(data)>2_500_000:raise ValueError('Tripo request exceeds safe size limit')
    req=urllib.request.Request(BASE+path,data=data,method=method,headers={
        'Authorization':'Bearer '+key,'Accept':'application/json',
        'Content-Type':content_type,'User-Agent':'FREELAB-Tripo/0.10.27'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=35) as res:
            raw_response=res.read(MAX_RESPONSE+1)
            if len(raw_response)>MAX_RESPONSE:raise RuntimeError('Tripo response exceeds safe size limit')
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Tripo API returned HTTP {e.code}; check the API key, credits and provider dashboard') from e
    except (urllib.error.URLError,TimeoutError,OSError) as e:
        raise RuntimeError('Tripo API could not be reached') from e
    try:result=json.loads(raw_response)
    except (ValueError,UnicodeError) as e:raise RuntimeError('Tripo returned invalid JSON') from e
    if not isinstance(result,dict):raise RuntimeError('Tripo returned an invalid response')
    if result.get('code') != 0:
        code=str(result.get('code','unknown'))[:24]
        message=str(result.get('message') or 'provider rejected request')[:160]
        raise RuntimeError('Tripo code '+code+': '+message)
    data=result.get('data')
    if not isinstance(data,dict):raise RuntimeError('Tripo response missing data')
    return data

def test_balance(key):
    data=request_api('GET','/account/balance',key)
    balance=data.get('balance');frozen=data.get('frozen')
    if not isinstance(balance,(int,float)) or isinstance(balance,bool) or balance<0:
        raise RuntimeError('Tripo balance response missing numeric credit balance')
    return {'verified':True,'charged':False,'balance':round(balance,2),
            'frozen':round(frozen,2) if isinstance(frozen,(int,float)) and not isinstance(frozen,bool) else None}

def upload_image(jpeg,key):
    if not isinstance(jpeg,bytes) or not jpeg.startswith(b'\xff\xd8') or len(jpeg)>1_800_000:
        raise ValueError('Tripo requires an existing JPEG image smaller than 1.8 MB')
    boundary='freelab'+secrets.token_hex(12)
    payload=(b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="file"; filename="freelab-source.jpg"\r\n'
             b'Content-Type: image/jpeg\r\n\r\n'+jpeg+b'\r\n--'+boundary.encode()+b'--\r\n')
    data=request_api('POST','/files',key,raw=payload,content_type='multipart/form-data; boundary='+boundary)
    token=data.get('file_token')
    if not isinstance(token,str) or not FILE_RE.fullmatch(token):
        raise RuntimeError('Tripo did not return a valid upload token')
    return token

def submit(jpeg,key,prompt=''):
    if prompt and not isinstance(prompt,str):raise ValueError('Invalid Tripo prompt')
    # With an image, use image-to-model; a textual instruction never vanishes
    # silently. Tripo's image-to-model endpoint does not support guidance text.
    if str(prompt or '').strip():
        raise ValueError('Tripo image-to-model does not accept a text prompt. Clear guidance or choose AHOLO.')
    token=upload_image(jpeg,key)
    result=request_api('POST','/generation/image-to-model',key,{
        'input':token,'model':MODEL,'texture':True,'pbr':True,
        'face_limit':30000,'texture_quality':'standard'})
    task=result.get('task_id')
    if not isinstance(task,str) or not TASK_RE.fullmatch(task):
        raise RuntimeError('Tripo did not return a valid 3D task ID')
    return task

def safe_file_url(url):
    if not isinstance(url,str) or len(url)>4096:return None
    try:u=urlsplit(url)
    except ValueError:return None
    # Trust only official Tripo-controlled HTTPS download domains; do not fetch
    # arbitrary hosts or follow redirects in the private model cache.
    try:
        if u.scheme!='https' or u.username or u.password or u.port not in (None,443):return None
        host=(u.hostname or '').lower()
    except ValueError:return None
    if host!='tripo3d.ai' and not host.endswith('.tripo3d.ai'):return None
    return url

def status(task,key):
    if not isinstance(task,str) or not TASK_RE.fullmatch(task):raise ValueError('Invalid Tripo task ID')
    data=request_api('GET','/tasks/'+task,key)
    state=str(data.get('status','unknown')).lower()
    state={'queued':'PENDING','running':'IN_PROGRESS','success':'SUCCEEDED',
           'failed':'FAILED','cancelled':'CANCELED','banned':'FAILED',
           'expired':'FAILED'}.get(state,'UNKNOWN')
    raw_progress=data.get('progress',0)
    try:progress=max(0,min(100,int(raw_progress or 0)))
    except (ValueError,TypeError):progress=0
    output=data.get('output') if isinstance(data.get('output'),dict) else {}
    credits=data.get('credits_consumed')
    error=str(data.get('error_message') or data.get('error_code') or '')[:180] if state=='FAILED' else ''
    return {'status':state,'progress':progress,
            'glb_url':safe_file_url(output.get('model_url')),
            'thumbnail_url':safe_file_url(output.get('rendered_image_url')),
            'credits':round(credits,2) if isinstance(credits,(int,float)) and not isinstance(credits,bool) and credits>=0 else None,
            'error':error}
