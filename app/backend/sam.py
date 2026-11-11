"""Low-cost SAM 3.1 image probe. Box extraction only; do not claim mask decoding."""
from __future__ import annotations
import base64,json,re,urllib.request,urllib.error

RE_BOX=re.compile(r'<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>')
def parse_boxes(text):
    if not isinstance(text,str):return []
    out=[]
    for m in RE_BOX.finditer(text[:2_000_000]):
        x1,y1,x2,y2,w,h=map(int,m.groups())
        if 0<=x1<=x2<w<=8192 and 0<=y1<=y2<h<=8192:
            out.append({'box':[x1,y1,x2,y2],'image_size':[w,h]})
        if len(out)>=30:break
    return out

def segment_jpeg(jpeg,prompt,api_key):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 -]{0,58}[A-Za-z0-9]',prompt):
        raise ValueError('Use one concrete object noun phrase (2–60 characters)')
    if not jpeg.startswith(b'\xff\xd8') or len(jpeg)>450_000:raise ValueError('Invalid JPEG')
    data='data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii')
    payload={'model':'sam-3.1','input':[{'type':'message','role':'user','content':[
        {'type':'input_text','text':prompt},{'type':'input_image','image_url':data}]}],
        'stream':False,'store':False}
    req=urllib.request.Request('https://api.meta.ai/v1/responses',data=json.dumps(payload).encode('utf-8'),method='POST',
      headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json','User-Agent':'FreeLab/0.2.0'})
    try:
        with urllib.request.urlopen(req,timeout=55) as response:
            result=json.load(response)
    except urllib.error.HTTPError as e:raise RuntimeError('Meta SAM API returned HTTP '+str(e.code)) from e
    except (TimeoutError,urllib.error.URLError) as e:raise RuntimeError('Meta SAM API is unavailable') from e
    output_text=result.get('output_text','')
    if not output_text:
        output_text=''.join(str(part.get('text','')) for item in result.get('output',[]) if isinstance(item,dict)
           for part in item.get('content',[]) if isinstance(part,dict) and part.get('type')=='output_text')
    if not isinstance(output_text,str):output_text=''
    return {'model':'sam-3.1','prompt':prompt,'boxes':parse_boxes(output_text),'masks_available':bool('<|mask;' in output_text),
            'masks_decoded':False,'usage':result.get('usage') or {}}
