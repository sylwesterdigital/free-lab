"""Aholo Lux3D image-to-3D adapter; no silent provider fallback.
Billable POST is invoked only after explicit user confirmation.
The private JPEG is exposed to Aholo using a time-limited, signed URL.
"""
from __future__ import annotations
import json,urllib.request,urllib.error
from urllib.parse import urlencode,urlparse
from .meshy3d import NoRedirect
BASE='https://api.aholo.ai/global/lux3d/v1/generate/'
CREATE=BASE+'img-to-3d/task/create'
STATUS=BASE+'task/get'

def request_api(method,url,key,payload=None):
    if not key:raise ValueError('Aholo key not configured')
    if url!=CREATE and not (url.startswith(STATUS+'?taskid=') and url[len(STATUS+'?taskid='):].isdigit()):
        raise ValueError('Unexpected Aholo endpoint')
    body=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(url,method=method,data=body,headers={'Authorization':key,'Content-Type':'application/json','Accept':'application/json','User-Agent':'FREELAB-Aholo/0.10.1'})
    try:
        with urllib.request.build_opener(NoRedirect).open(req,timeout=35) as resp:raw=resp.read(128_001)
        if len(raw)>128_000:raise RuntimeError('Aholo response exceeded size limit')
        obj=json.loads(raw)
    except urllib.error.HTTPError as e:raise RuntimeError(f'Aholo HTTP {e.code}; check API key and credits') from e
    except (OSError,ValueError,TimeoutError) as e:raise RuntimeError('Aholo request failed or returned invalid JSON') from e
    if not isinstance(obj,dict) or str(obj.get('c'))!='0':raise RuntimeError('Aholo: '+str(obj.get('m') or 'provider rejected the request')[:160])
    return obj['d']

def submit(image_url,key):
    p=urlparse(image_url)
    if p.scheme!='https' or p.hostname!='free-lab.cam' or not p.path.startswith('/api/media/3d/source/'):
        raise ValueError('3D input must be a signed FREE LAB HTTPS image link')
    result=request_api('POST',CREATE,key,{'img':image_url,'version':'G1-Turbo'})
    task=result.get('taskid') if isinstance(result,dict) else result
    if not str(task).isdigit():raise RuntimeError('Aholo returned no task ID')
    return str(task)

def allowed_download_url(url):
    if not isinstance(url,str) or len(url)>3000:return None
    u=urlparse(url)
    # Do not allow the server to fetch arbitrary URLs: returned links remain browser-download only.
    if u.scheme!='https' or not u.hostname or u.username or u.password:return None
    return url

def status(task,key):
    if not str(task).isdigit():raise ValueError('Invalid Aholo task ID')
    result=request_api('GET',STATUS+'?'+urlencode({'taskid':str(task)}),key)
    if not isinstance(result,dict):raise RuntimeError('Aholo task response invalid')
    state=int(result.get('status',-1));mapped={0:'PENDING',1:'IN_PROGRESS',3:'SUCCEEDED',4:'FAILED',6:'CANCELED'}.get(state,'UNKNOWN')
    urls=result.get('outputs') or []
    glb=None
    if isinstance(urls,list):
        for o in urls:
            if isinstance(o,dict):
                u=allowed_download_url(o.get('content') or o.get('url'))
                if u and ('.glb' in u.lower() or str(o.get('format','')).lower()=='glb'):
                    glb=u;break
    if not glb and isinstance(urls,list) and len(urls)>1 and isinstance(urls[1],dict):
        # Lux3D G1 task outputs are ordered ZIP, GLB, (optional PLY).
        glb=allowed_download_url(urls[1].get('content') or urls[1].get('url'))
    return {'status':mapped,'progress':100 if state==3 else (40 if state==1 else 0),
            'credits':None,'glb_url':glb,'thumbnail_url':None,
            'error':str(result.get('message') or result.get('error') or '')[:180] if state==4 else ''}


def safe_preview_url(url):
    """Explicitly allow only documented provider/CDN domains for bounded server fetches."""
    from urllib.parse import urlparse
    if not isinstance(url,str) or len(url)>3000:return None
    u=urlparse(url)
    hostname=(u.hostname or '').lower()
    suffixes=('.aholo.ai','.kujiale.com','.aliyuncs.com','.myqcloud.com','.amazonaws.com')
    if u.scheme!='https' or u.username or u.password or u.port not in (None,443):return None
    if not any(hostname.endswith(suf) and hostname!=suf[1:] for suf in suffixes):return None
    return url
