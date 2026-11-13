"""Meta Muse image recognition; one explicit, capped call per capture."""
from __future__ import annotations
import base64,json,os,re,time,urllib.error,urllib.request

API_URL='https://api.meta.ai/v1/chat/completions'
MODEL_IDS={'muse-ember-1.0','muse-spark-1.3','muse-spark-1.2','muse-spark-1.1'}

class MetaVisionUnavailable(RuntimeError):
    """A provider-side failure, not an invalid image or a FREE LAB quota."""
    def __init__(self, status, code='', retry_after=None, request_id='', attempts=1):
        self.status=int(status)
        self.code=re.sub(r'[^a-zA-Z0-9_.-]','',str(code or ''))[:64]
        self.retry_after=retry_after
        self.request_id=re.sub(r'[^a-zA-Z0-9_.-]','',str(request_id or ''))[:90]
        self.attempts=attempts
        if self.status==429:
            message='Meta rate limit reached (429)'
        elif self.status in (500,502,503,504):
            message=f'Meta temporarily unavailable ({self.status})'
        elif self.status in (401,403):
            message=f'Meta access denied ({self.status}); check model access or API key'
        elif self.status in (400,404,422):
            message=f'Meta request rejected ({self.status}); check model/input format'
        else:
            message=f'Meta vision HTTP {self.status}'
        if self.code: message+=f' · {self.code}'
        if isinstance(self.retry_after,int) and self.retry_after>0:
            message+=f' · retry after {self.retry_after}s'
        super().__init__(message)


def _vision_error(error, attempts):
    """Read only the structured error code, never log image bytes/prompts/API keys."""
    status=int(error.code)
    body=b''
    try: body=error.read(3072)
    except (OSError,ValueError): pass
    code=''
    try:
        parsed=json.loads(body)
        if isinstance(parsed,dict) and isinstance(parsed.get('error'),dict):
            code=parsed['error'].get('code','') or parsed['error'].get('type','')
    except (ValueError,TypeError,UnicodeError): pass
    headers=error.headers or {}
    raw_retry=headers.get('Retry-After','')
    try: retry_after=max(0,int(raw_retry))
    except (ValueError,TypeError): retry_after=None
    request_id=headers.get('x-request-id','') or headers.get('X-Request-ID','')
    return MetaVisionUnavailable(status,code,retry_after,request_id,attempts)


def _vision_request(req):
    """Retry only transient Meta failures, max three requests, no model switching."""
    for attempt in range(1,4):
        try:
            with urllib.request.urlopen(req,timeout=43) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            error=_vision_error(exc,attempt)
            if error.status not in (429,500,502,503,504) or attempt==3:
                raise error from exc
            # Honor explicit long Retry-After without blocking XR for a minute.
            if error.retry_after is not None and error.retry_after>4:
                raise error from exc
            delay=min(4.0, error.retry_after if error.retry_after is not None else .65*2**(attempt-1))
            if delay:time.sleep(delay)
        except (TimeoutError,urllib.error.URLError) as exc:
            if attempt==3:raise RuntimeError('Meta vision connection failed after 3 attempts') from exc
            time.sleep(.65*2**(attempt-1))
    raise RuntimeError('Meta vision request failed')
SCHEMA={
 'type':'object','additionalProperties':False,
 'properties':{
  'objects':{'type':'array','maxItems':6,'items':{
    'type':'object','additionalProperties':False,'properties':{
     'label':{'type':'string'},'description':{'type':'string'},
     'box':{'type':'array','items':{'type':'integer'},'minItems':4,'maxItems':4}
    },'required':['label','description','box']}}
 },'required':['objects']
}

def parse_detections(value):
    if not isinstance(value,dict) or not isinstance(value.get('objects'),list): raise ValueError('Unexpected model result')
    out=[]
    for obj in value['objects'][:6]:
        if not isinstance(obj,dict):continue
        label=str(obj.get('label','')).strip()[:80]
        if not label:continue
        box=obj.get('box')
        if not isinstance(box,list) or len(box)!=4 or not all(type(n) is int and 0<=n<=1000 for n in box): box=None
        if box and (box[0]>=box[2] or box[1]>=box[3]):box=None
        out.append({'label':label,'description':str(obj.get('description',''))[:240],'box':box})
    return out

def identify(jpeg, model=None, api_key=None):
    model=model or os.getenv('META_MODEL','muse-ember-1.0')
    api_key=api_key or os.getenv('MODEL_API_KEY','')
    if model not in MODEL_IDS:raise ValueError('Unrecognized Meta model ID')
    if not api_key:raise RuntimeError('MODEL_API_KEY not configured; no billed requests made')
    if not jpeg.startswith(b'\xff\xd8'):raise ValueError('Expected JPEG snapshot')
    if len(jpeg)>450_000:raise ValueError('JPEG snapshot exceeds 450KB limit')
    uri='data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii')
    payload={
      'model':model,
      'messages':[
        {'role':'system','content':'Identify only clearly visible non-person objects. Do not guess identities or private information. Use concise English noun labels. Return bounding boxes on a 0–1000 image coordinate grid; use [0,0,1000,1000] when localization is uncertain. Maximum six distinct objects.'},
        {'role':'user','content':[{'type':'text','text':'List up to six clearly visible objects for a private room inventory. Reply as structured JSON.'},
          {'type':'image_url','image_url':{'url':uri}}]}
      ],
      'response_format':{'type':'json_schema','json_schema':{'name':'spatial_objects','strict':True,'schema':SCHEMA}},
      'max_completion_tokens':1800,
      'store':False
    }
    request=urllib.request.Request(API_URL,data=json.dumps(payload).encode('utf-8'),
        headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json','User-Agent':'FreeLab/0.1'},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=38) as response:
            result=json.load(response)
    except urllib.error.HTTPError as e:
        # Do not leak response bodies or secret tokens into logs/browser.
        raise RuntimeError(f'Meta API returned HTTP {e.code}') from e
    except (TimeoutError,urllib.error.URLError) as e:
        raise RuntimeError('Meta API temporarily unreachable') from e
    try:
        content=result['choices'][0]['message']['content']
        return parse_detections(json.loads(content)),result.get('usage',{})
    except (ValueError,TypeError,KeyError,IndexError) as e:
        raise RuntimeError('Meta API returned an incompatible object response') from e


def describe(jpeg: bytes, api_key: str, model: str = 'muse-spark-1.3', question: str = '', history=None):
    """Describe the actual image only. A paid, user-initiated vision request."""
    if model not in MODEL_IDS: raise ValueError('Unsupported Meta vision model')
    if not api_key: raise RuntimeError('Meta API key not configured')
    if not jpeg.startswith(b'\xff\xd8') or len(jpeg) > 2_000_000:
        raise ValueError('Description requires an existing JPEG under 2 MB')
    uri = 'data:image/jpeg;base64,' + base64.b64encode(jpeg).decode('ascii')
    payload = {'model':model,'messages':[
       {'role':'system','content':'Describe only what is clearly visible in the supplied image. Do not identify people or invent objects, unseen surfaces, depth data, room layout or locations. Focus on objects, colors, positions within the photograph and useful visual details. Use 2-4 concise sentences in English.'},
       {'role':'user','content':[{'type':'text','text':(question.strip()[:500] if question else 'Describe what is actually visible in this image, including plausible ingredients, materials and any uncertainty. Do not describe editing instructions.')},{'type':'image_url','image_url':{'url':uri}}]}],
       'max_completion_tokens':500,'store':False}
    req=urllib.request.Request(API_URL,data=json.dumps(payload).encode('utf-8'),method='POST',
        headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json','User-Agent':'FREELAB-Describe/0.10'})
    result=_vision_request(req)
    try:
        value=result['choices'][0]['message']['content']
        if isinstance(value,list):value=' '.join(v.get('text','') for v in value if isinstance(v,dict))
        value=re.sub(r'[\x00-\x1f]+',' ',value).strip()[:1800]
        if len(value)<12:raise ValueError('Empty description')
        return value,result.get('usage',{})
    except (KeyError,ValueError,IndexError,TypeError) as e:
        raise RuntimeError('Meta response had no usable description') from e
