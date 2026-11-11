"""Meta Muse image recognition; one explicit, capped call per capture."""
from __future__ import annotations
import base64,json,os,re,urllib.error,urllib.request

API_URL='https://api.meta.ai/v1/chat/completions'
MODEL_IDS={'muse-ember-1.0','muse-spark-1.3','muse-spark-1.2','muse-spark-1.1'}
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
