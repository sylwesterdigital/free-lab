"""v0.10.9: transparent masks, streamed SAM output and recursive PNG input."""
import io,json,subprocess,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from PIL import Image
from backend import sam
ROOT=Path(__file__).resolve().parents[1]

class FakeParser:
 def push(self,v):self.data=v;return ()
 def finish(self,outcome):
  box=SimpleNamespace(object_id='0',left=1,top=1,right=4,bottom=4)
  mask=SimpleNamespace(width=3,height=3,encoding='one_bit',payload='test')
  item=SimpleNamespace(object_id='0',mask=mask)
  return SimpleNamespace(result=SimpleNamespace(records=(box,item),diagnostics=()))

class FakeMetaParser:
 def __init__(self):self.last=None
 def image_segmentation_format(self):return SimpleNamespace(create_parser=lambda:FakeParser())
 def records_of_kind(self,records,kind):return (records[0],) if kind=='box' else (records[1],)
 def decode_mask_to_raster(self,mask):return bytes((0,1,0,1,1,1,0,1,0))
 def build_object_prompt(self,*,size,objects):
  self.last=(size,objects)
  return '<0f>0<|box;x1=1;y1=1;x2=3;y2=3;w=6;h=6|>'
 def FramePrompt(self,**kwargs):return kwargs
 def PromptBox(self,*args):return args
 def PromptObject(self,**kwargs):return kwargs
 def CompletedOutcome(self):return object()

class TestSamCutouts109(unittest.TestCase):
 def photo(self):
  im=Image.new('RGB',(6,6),'red');b=io.BytesIO();im.save(b,format='JPEG');return b.getvalue()
 def fake_stream(self,text):
  response={'status':'completed','usage':{'input_tokens':3}}
  return io.BytesIO((
    'data: '+json.dumps({'type':'response.output_text.delta','delta':text})+'\n\n'+
    'data: '+json.dumps({'type':'response.content_part.done','part':{'type':'output_text','text':text}})+'\n\n'+
    'data: '+json.dumps({'type':'response.completed','response':response})+'\n\n'
   ).encode())
 def test_stream_reads_complete_mask_and_usage(self):
  output='<0f>0<|box;x1=1;y1=1;x2=3;y2=3;w=6;h=6|><|mask;x=0;y=0;data=3,3,!!!!!!(QO(0lu8?|>'
  fake=FakeMetaParser()
  with mock.patch.dict('sys.modules',{'meta_sam_parser':fake}):
   with mock.patch.object(sam.urllib.request,'urlopen',return_value=mock.MagicMock(__enter__=lambda _:self.fake_stream(output),__exit__=lambda *args:False)) as req:
    result=sam.segment_jpeg(self.photo(),'red apple','key-for-test-abcdefgh')
  self.assertTrue(result['masks_decoded']);self.assertTrue(result['masks_available'])
  self.assertEqual(result['boxes'][0]['box'],[1,1,3,3]);self.assertEqual(result['boxes'][0]['image_size'],[6,6])
  self.assertEqual(result['usage'],{'input_tokens':3})
  body=json.loads(req.call_args.args[0].data)
  self.assertTrue(body['stream']);self.assertEqual(body['metadata']['mask_encoding'],'one_bit')
  self.assertNotIn('_regions',json.dumps({k:v for k,v in result.items() if k!='_regions'}))
 def test_mask_cutout_is_alpha_png_not_crop(self):
  im=Image.new('RGBA',(6,6),(250,70,50,255))
  region={'box':[1,1,4,4],'image_size':(6,6),'width':3,'height':3,
    'raster':bytes((0,1,0,1,1,1,0,1,0))}
  raw=sam.cutout_png(im,region)
  self.assertTrue(raw.startswith(b'\x89PNG\r\n\x1a\n'))
  with Image.open(io.BytesIO(raw)) as out:
   self.assertEqual(out.size,(3,3));self.assertEqual(out.mode,'RGBA')
   self.assertEqual(out.getpixel((0,0))[3],0)
   self.assertEqual(out.getpixel((1,1))[3],255)
 def test_transparent_child_can_be_sent_back_to_vision(self):
  im=Image.new('RGBA',(160,160),(255,0,0,0))
  for x in range(40,120):
   for y in range(30,130):im.putpixel((x,y),(50,120,200,255))
  b=io.BytesIO();im.save(b,format='PNG')
  jpeg=sam.jpeg_for_model(b.getvalue())
  self.assertTrue(jpeg.startswith(b'\xff\xd8'));self.assertLess(len(jpeg),450_001)
 def test_incomplete_stream_rejected(self):
  s=io.BytesIO(b'data: {"type":"response.output_text.delta","delta":"x"}\n\n')
  with self.assertRaisesRegex(RuntimeError,'before completion'):sam._stream_text(s)
 def test_payload_does_not_expose_binary_masks(self):
  from pathlib import Path
  back=(ROOT/'backend/app.py').read_text()
  xr=(ROOT/'frontend/assets/xr.js').read_text()
  ui=(ROOT/'frontend/assets/app.js').read_text()
  self.assertIn("regions=result.pop('_regions',[])",back)
  self.assertIn('cutout_png(photo,region)',back)
  self.assertIn('object_boxes=prompt_boxes',back)
  self.assertIn('cutouts:Boolean(cutouts)',ui)
  self.assertIn("if(!cutout||back)panelSkin",xr)
  self.assertIn('if(color.a<.012)discard',xr)
  self.assertIn('meta-sam-parser==0.2.0',(ROOT/'requirements.txt').read_text())

if __name__=='__main__':unittest.main()
