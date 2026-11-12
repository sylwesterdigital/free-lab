"""Only verified Meta media integrations. Never expose API keys or external media URLs."""
from __future__ import annotations
import base64, io, json, urllib.request, urllib.error, uuid
from PIL import Image,ImageOps,UnidentifiedImageError

META='https://api.meta.ai/v1'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def _request(url, data, key, content_type, timeout=100, accept='application/json', limit=18_000_000):
    r=urllib.request.Request(url,data=data,method='POST',headers={
      'Authorization':'Bearer '+key,'Content-Type':content_type,'Accept':accept,'User-Agent':'FREELAB-SpatialMedia/0.5'})
    try:
        with urllib.request.build_opener(NoRedirect).open(r,timeout=timeout) as response:
            blob=response.read(limit+1)
            if len(blob)>limit:raise RuntimeError('Provider image response exceeded size limit')
            return blob
    except urllib.error.HTTPError as e:raise RuntimeError(f'Meta media API returned HTTP {e.code}') from e
    except (urllib.error.URLError, TimeoutError) as e:raise RuntimeError('Meta media request failed or timed out') from e

def _valid_jpeg(content):
    Image.MAX_IMAGE_PIXELS=12_000_000
    try:
        with Image.open(io.BytesIO(content)) as inp:
            if inp.width*inp.height>12_000_000:raise ValueError('Provider image has too many pixels')
            img=ImageOps.exif_transpose(inp).convert('RGB')
            img.thumbnail((1600,1600))
            out=io.BytesIO();img.save(out,format='JPEG',quality=83,optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError,OSError) as e:raise RuntimeError('Provider did not return a supported image') from e

def extract_image(result):
    """Meta Responses API: choose image_generation_call by type, not index."""
    for item in result.get('output',[]):
        if isinstance(item,dict) and item.get('type')=='image_generation_call' and isinstance(item.get('result'),str):
            try:return base64.b64decode(item['result'],validate=True)
            except (ValueError,base64.binascii.Error):pass
    raise RuntimeError('Meta returned no image generation result; no object was saved')

def edit_meta_image(jpeg:bytes,prompt:str,key:str):
    if not jpeg.startswith(b'\xff\xd8'):raise ValueError('Expected a JPEG source image')
    uri='data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii')
    payload={
        'model':'muse-image-1.0','store':False,
        'input':[{'role':'user','content':[{'type':'input_text','text':prompt},
                    {'type':'input_image','image_url':uri}]}],
        'tools':[{'type':'image_generation','enable_web_search':False,
                  'enable_image_search':False,'enable_shell':False,'reasoning_strength':'low',
                  'output_format':'jpeg'}]
    }
    response=_request(META+'/responses',json.dumps(payload).encode(),key,'application/json',timeout=115)
    try:result=json.loads(response)
    except (ValueError,TypeError) as e:raise RuntimeError('Meta returned a non-JSON image response') from e
    if result.get('status') not in ('completed',None):raise RuntimeError('Meta image generation did not complete')
    return _valid_jpeg(extract_image(result)),result.get('usage',{})

def _multipart_request(wav):
    boundary='freelab_'+uuid.uuid4().hex
    settings=json.dumps({'model':'muse-voice-transcribe-1.0','audioEncoding':'WAV','mode':'PUSH_TO_TALK'}).encode()
    data=(b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n'+settings+b'\r\n'
          +b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="audio"; filename="prompt.wav"\r\nContent-Type: audio/wav\r\n\r\n'+wav+b'\r\n'
          +b'--'+boundary.encode()+b'--\r\n')
    return data,'multipart/form-data; boundary='+boundary

def transcribe_meta(wav:bytes,key:str):
    data,ctype=_multipart_request(wav)
    response=_request(META+'/asr/transcribe',data,key,ctype,timeout=45,limit=500_000)
    try:payload=json.loads(response)
    except (ValueError,TypeError) as e:raise RuntimeError('Transcription response is not JSON') from e
    # Documented buffered response contains speech turns; tolerate top-level transcript variants.
    if isinstance(payload.get('text'),str):return payload['text'].strip()
    if isinstance(payload.get('transcript'),str):return payload['transcript'].strip()
    turns=payload.get('turns') or payload.get('segments') or []
    output=' '.join(str(t.get('text') or t.get('transcript') or '').strip() for t in turns if isinstance(t,dict))
    if output.strip():return output.strip()
    raise RuntimeError('Meta did not return transcribable text')
