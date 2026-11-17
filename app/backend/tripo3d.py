"""Tripo v3 opt-in image-to-model adapter.

The image is uploaded privately with multipart/form-data; Tripo receives a
file token, never a FREELAB authentication URL. Creating a task is billable.
GET balance/status operations are read-only. All outbound hosts and response
sizes are bounded, redirects are refused, and credentials never reach clients.
"""
from __future__ import annotations
import json, re, secrets, urllib.request, urllib.error, socket, ipaddress
from urllib.parse import urlsplit

BASE='https://openapi.tripo3d.ai/v3'
MODEL='v3.1-20260211'
# Explicit, bounded model choices. Tripo's texture_quality is independent of topology.
PRESETS={
 'xr':{'model':'P2-20260801','face_limit':12000},
 'balanced':{'model':'P2-20260801','face_limit':30000},
 'studio':{'model':'v3.1-20260211','face_limit':120000},
}
TEXTURE_LEVELS=('standard','detailed','extreme')
def generation_options(preset='xr',texture_quality='standard'):
    if preset not in PRESETS or texture_quality not in TEXTURE_LEVELS:
        raise ValueError('Invalid 3D geometry or texture quality setting')
    return dict(PRESETS[preset],texture=True,pbr=True,texture_quality=texture_quality)

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
        'Content-Type':content_type,'User-Agent':'FREELAB-Tripo/0.10.65'})
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

def submit(jpeg,key,prompt='',preset='xr',texture_quality='standard'):
    if prompt and not isinstance(prompt,str):raise ValueError('Invalid Tripo prompt')
    # With an image, use image-to-model; a textual instruction never vanishes
    # silently. Tripo's image-to-model endpoint does not support guidance text.
    if str(prompt or '').strip():
        raise ValueError('Tripo image-to-model does not accept a text prompt. Clear guidance or choose AHOLO.')
    generation=generation_options(preset,texture_quality)
    token=upload_image(jpeg,key)
    result=request_api('POST','/generation/image-to-model',key,{'input':token,**generation})
    task=result.get('task_id')
    if not isinstance(task,str) or not TASK_RE.fullmatch(task):
        raise RuntimeError('Tripo did not return a valid 3D task ID')
    return task

def output_url(value):
    """Tripo v2/v3 compatibility: URL strings and {url: ...}/{href: ...}."""
    if isinstance(value,str):return value.strip()
    if isinstance(value,dict):
        for name in ('url','href'):
            if isinstance(value.get(name),str):return value[name].strip()
    return ''


def task_model_url(output):
    """Prefer textured output; accept existing and legacy provider shapes."""
    if not isinstance(output,dict):return None
    urls=output.get('model_urls') if isinstance(output.get('model_urls'),dict) else {}
    for value in (output.get('model_url'),output.get('pbr_model'),urls.get('pbr_model'),
                  output.get('model'),output.get('model_mesh'),urls.get('glb'),
                  output.get('base_model'),urls.get('base_model')):
        candidate=output_url(value)
        if candidate:
            approved=safe_file_url(candidate,trusted_task=True)
            if approved:return approved
    return None


def safe_file_url(url, trusted_task=False):
    """Accept HTTPS from task output, never user-provided arbitrary fetch URLs.

    Tripo's signed models can reside on cloud object storage or its CDN rather
    than tripo3d.ai. trusted_task=True is ONLY for URLs returned by the
    authenticated Tripo task status response or persisted from that response.
    The downloader also checks all DNS addresses before opening a connection.
    """
    if not isinstance(url,str) or not url or len(url)>4096:return None
    try:
        u=urlsplit(url)
        if u.scheme.lower()!='https' or u.username or u.password or u.port not in (None,443):return None
        if not u.netloc or not u.path or u.fragment:return None
        host=(u.hostname or '').lower().rstrip('.')
        if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]',host):return None
        if '..' in host or '.' not in host:return None
        if host.endswith(('.local','.internal','.localhost','.test','.invalid')) or host in ('localhost','metadata.google.internal'):return None
        try:ipaddress.ip_address(host);return None
        except ValueError:pass
        if not trusted_task and not (host=='tripo3d.ai' or host.endswith('.tripo3d.ai') or
                                    host=='tripo3d.com' or host.endswith('.tripo3d.com')):return None
        return url
    except ValueError:return None


def verify_public_download_host(url):
    """Best-effort anti-SSRF DNS guard on authenticated Tripo model links."""
    good=safe_file_url(url,trusted_task=True)
    if not good:raise ValueError('Invalid Tripo model download URL')
    host=urlsplit(good).hostname
    try:addresses=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
    except (OSError,socket.gaierror) as e:raise ValueError('Tripo model download DNS unavailable') from e
    if not addresses:raise ValueError('Tripo download host could not be resolved')
    for addr in addresses:
        ip=ipaddress.ip_address(addr[4][0])
        if not ip.is_global:raise ValueError('Tripo model download hostname resolves to a blocked address')
    return good


class TripoModelRedirect(urllib.request.HTTPRedirectHandler):
    """Allow a few provider-controlled HTTPS redirects, never internal hosts."""
    def __init__(self):self.count=0
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        self.count+=1
        if self.count>3:raise ValueError('Tripo model download redirected too many times')
        verify_public_download_host(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def open_model_download(url,timeout=20):
    """Only for URLs obtained from the authenticated Tripo task result."""
    verified=verify_public_download_host(url)
    req=urllib.request.Request(verified,headers={'User-Agent':'FREELAB-3D-PrivateCache/0.10'})
    return urllib.request.build_opener(TripoModelRedirect()).open(req,timeout=timeout)


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
            'glb_url':task_model_url(output),
            'thumbnail_url':safe_file_url(output_url(output.get('rendered_image_url') or output.get('rendered_image') or output.get('generated_image')),trusted_task=True),
            'credits':round(credits,2) if isinstance(credits,(int,float)) and not isinstance(credits,bool) and credits>=0 else None,
            'error':error}
