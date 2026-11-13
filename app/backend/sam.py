"""Meta SAM 3.1 still-image segmenter with verified mask decoding.

The API returns base85 arithmetic-coded masks, not ordinary bitmap/base64
bytes. Use Meta's published meta-sam-parser rather than silently dropping the
mask or attempting to reverse engineer the codec.
"""
from __future__ import annotations
import base64, io, json, re, urllib.error, urllib.request
from PIL import Image, ImageFilter, ImageOps

MAX_SAM_STREAM = 5_000_000
MAX_MASK_PIXELS = 12_000_000
RE_BOX = re.compile(r'<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>')

def parse_boxes(text):
    """Compatibility with historical box diagnostics, never used as a mask."""
    if not isinstance(text, str): return []
    out = []
    for m in RE_BOX.finditer(text[:MAX_SAM_STREAM]):
        x1,y1,x2,y2,w,h=map(int,m.groups())
        if 0<=x1<=x2<w<=8192 and 0<=y1<=y2<h<=8192:
            out.append({'box':[x1,y1,x2,y2],'image_size':[w,h]})
        if len(out)>=30:break
    return out

def _stream_text(response):
    """Read the bounded SSE output-text lane, rejecting incomplete responses."""
    chunks=[];length=0;completed=False;failure=None;complete_text=None
    for raw_line in response:
        if len(raw_line)>MAX_SAM_STREAM:raise RuntimeError('SAM mask response exceeded safe size')
        if not raw_line.startswith(b'data: '):continue
        try:event=json.loads(raw_line[6:])
        except (ValueError,UnicodeDecodeError):continue
        kind=event.get('type','')
        if kind=='response.output_text.delta':
            delta=event.get('delta','')
            if isinstance(delta,str):
                length+=len(delta)
                if length>MAX_SAM_STREAM:raise RuntimeError('SAM mask response exceeded safe size')
                chunks.append(delta)
        elif kind in ('response.output_text.done','response.content_part.done'):
            part=event.get('part') or {}
            value=event.get('text') if kind=='response.output_text.done' else part.get('text')
            if isinstance(value,str) and (kind=='response.output_text.done' or part.get('type')=='output_text'):
                complete_text=value
        elif kind=='response.completed':
            completed=True
            response_data=event.get('response') or {}
            if response_data.get('status') not in ('completed',None):failure='SAM response incomplete'
            usage=response_data.get('usage') or {}
            return _final_text(chunks,complete_text,completed,failure),usage
        elif kind in ('response.failed','response.incomplete','error'):
            info=event.get('response') or event.get('error') or {}
            message=info.get('message') or info.get('status') or kind
            raise RuntimeError('Meta SAM failed: '+str(message)[:180])
    raise RuntimeError('Meta SAM stream ended before completion')

def _final_text(chunks,complete_text,completed,failure):
    if not completed or failure:raise RuntimeError(failure or 'SAM stream incomplete')
    output=''.join(chunks)
    if complete_text is not None:
        if output and output!=complete_text:raise RuntimeError('Meta SAM returned inconsistent output text')
        output=complete_text
    if len(output)>MAX_SAM_STREAM:raise RuntimeError('SAM output exceeded safe size')
    return output

def _read_segmentation(text):
    from meta_sam_parser import CompletedOutcome, image_segmentation_format, records_of_kind, decode_mask_to_raster
    parser=image_segmentation_format().create_parser()
    parser.push(text)
    parsed=parser.finish(CompletedOutcome()).result
    if getattr(parsed,'diagnostics',None):
        errors=[d for d in parsed.diagnostics if getattr(d,'severity',None)=='error']
        if errors:raise RuntimeError('Meta SAM produced malformed segmentation data')
    boxes={b.object_id:b for b in records_of_kind(parsed.records,'box')}
    results=[]
    for item in records_of_kind(parsed.records,'mask'):
        b=boxes.get(item.object_id)
        if b is None:continue
        mask=item.mask
        if mask.width*mask.height>MAX_MASK_PIXELS:raise RuntimeError('SAM mask pixels exceed safe limit')
        raster=decode_mask_to_raster(mask)
        if len(raster)!=mask.width*mask.height:raise RuntimeError('Invalid decoded SAM mask size')
        if not any(raster):continue
        # Box coordinates are half-open in Meta's official parser.
        if mask.width!=b.right-b.left or mask.height!=b.bottom-b.top:
            raise RuntimeError('Meta SAM mask and box dimensions disagree')
        results.append({'object_id':str(item.object_id), 'box':[b.left,b.top,b.right,b.bottom],
            'image_size':None, 'width':mask.width,'height':mask.height,'raster':raster})
        if len(results)>=16:break
    return results

def segment_jpeg(jpeg,prompt,api_key,*,object_boxes=None):
    if not jpeg.startswith(b'\xff\xd8') or len(jpeg)>450_000:raise ValueError('Invalid JPEG')
    if object_boxes is None:
        if not isinstance(prompt,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 -]{0,58}[A-Za-z0-9]',prompt):
            raise ValueError('Use one concrete object noun phrase (2–60 characters)')
        text=prompt
    else:
        # Meta's official prompt formatter handles stable integer object IDs.
        from meta_sam_parser import build_object_prompt, FramePrompt, PromptBox, PromptObject
        with Image.open(io.BytesIO(jpeg)) as im:dimensions=im.size
        text=build_object_prompt(size=dimensions,objects=[PromptObject(id=i,
            prompts=[FramePrompt(frame=0,box=PromptBox(*bounds))])
            for i,bounds in enumerate(object_boxes) if bounds is not None])
    data='data:image/jpeg;base64,'+base64.b64encode(jpeg).decode('ascii')
    payload={'model':'sam-3.1','input':[{'type':'message','role':'user','content':[
        {'type':'input_text','text':text},{'type':'input_image','image_url':data}]}],
        'stream':True,'store':False,'metadata':{'mask_encoding':'one_bit'}}
    req=urllib.request.Request('https://api.meta.ai/v1/responses',data=json.dumps(payload).encode(),method='POST',
      headers={'Authorization':'Bearer '+api_key,'Content-Type':'application/json','Accept':'text/event-stream','User-Agent':'FREELAB/0.10.10'})
    try:
        with urllib.request.urlopen(req,timeout=43) as response:
            output_text,usage=_stream_text(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError('Meta SAM HTTP '+str(e.code)) from e
    except (TimeoutError,urllib.error.URLError) as e:
        raise RuntimeError('Meta SAM unavailable') from e
    regions=_read_segmentation(output_text) if output_text else []
    with Image.open(io.BytesIO(jpeg)) as im:
        for region in regions:region['image_size']=im.size
    public=[{'box':[r['box'][0],r['box'][1],r['box'][2]-1,r['box'][3]-1],
             'object_id':r['object_id'],'image_size':list(r['image_size'])} for r in regions]
    return {'model':'sam-3.1','prompt':text if object_boxes is None else 'box prompts',
        'boxes':public,'masks_available':bool(regions),'masks_decoded':bool(regions),
        'usage':usage,'_regions':regions}

def cutout_png(source_image,region,max_side=960):
    """Apply actual decoded SAM raster to source RGBA, with no rectangular matte."""
    src=ImageOps.exif_transpose(source_image).convert('RGBA')
    x1,y1,x2,y2=region['box']
    # Input coordinates are relative to the model's source dimensions.
    w,h=region.get('image_size') or src.size
    if not all(isinstance(v,int) for v in (x1,y1,x2,y2,w,h)) or not (0<=x1<x2<=w and 0<=y1<y2<=h):
        raise ValueError('Invalid cutout bounds')
    x1=round(x1*src.width/w);x2=round(x2*src.width/w)
    y1=round(y1*src.height/h);y2=round(y2*src.height/h)
    if x2-x1<3 or y2-y1<3:raise ValueError('Cutout too small')
    crop=src.crop((x1,y1,x2,y2))
    a=Image.frombytes('L',(region['width'],region['height']),
        bytes(255 if v else 0 for v in region['raster']))
    if a.size!=crop.size:a=a.resize(crop.size,Image.Resampling.NEAREST)
    if max(crop.size)>150:a=a.filter(ImageFilter.GaussianBlur(0.5))
    # Preserve existing alpha when extracting a subpart of another PNG cutout.
    from PIL import ImageChops
    crop.putalpha(ImageChops.multiply(crop.getchannel('A'),a))
    crop.thumbnail((max_side,max_side),Image.Resampling.LANCZOS)
    mem=io.BytesIO();crop.save(mem,format='PNG',optimize=True,compress_level=6)
    return mem.getvalue()

def jpeg_for_model(raw,limit=450_000):
    """Convert saved transparent children to bounded neutral-backed JPEG for AI.

    The private original PNG is never modified; its alpha is retained when
    writing a subsequent cutout from the mask.
    """
    if raw.startswith(b'\xff\xd8') and len(raw)<=limit:return raw
    if len(raw)>10_000_000:raise ValueError('Saved image too large for model input')
    with Image.open(io.BytesIO(raw)) as im:
        if im.width*im.height>MAX_MASK_PIXELS:raise ValueError('Saved image exceeds safe pixel size')
        src=ImageOps.exif_transpose(im).convert('RGBA')
    for side in (960,800,640,512):
        im=src.copy();im.thumbnail((side,side),Image.Resampling.LANCZOS)
        canvas=Image.new('RGB',im.size,(216,222,218));canvas.paste(im,mask=im.getchannel('A'))
        for quality in (83,70,55):
            mem=io.BytesIO();canvas.save(mem,format='JPEG',quality=quality,optimize=True)
            if 100<len(mem.getvalue())<=limit:return mem.getvalue()
    raise ValueError('Cannot prepare image within SAM input limit')


def rectangle_jpeg(source_image,region,max_side=960):
    """Opt-in rectangular crop from the same SAM detection, preserving original photos."""
    src=ImageOps.exif_transpose(source_image).convert('RGBA')
    x1,y1,x2,y2=region['box']
    w,h=region.get('image_size') or src.size
    if not all(isinstance(v,int) for v in (x1,y1,x2,y2,w,h)) or not (0<=x1<x2<=w and 0<=y1<y2<=h):
        raise ValueError('Invalid region bounds')
    a,b,c,d=round(x1*src.width/w),round(y1*src.height/h),round(x2*src.width/w),round(y2*src.height/h)
    if c-a<3 or d-b<3:raise ValueError('Region too small')
    crop=src.crop((a,b,c,d))
    bg=Image.new('RGB',crop.size,(216,222,218));bg.paste(crop,mask=crop.getchannel('A'))
    bg.thumbnail((max_side,max_side),Image.Resampling.LANCZOS)
    output=io.BytesIO();bg.save(output,format='JPEG',quality=83,optimize=True)
    return output.getvalue()
