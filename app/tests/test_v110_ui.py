"""XR v0.10.19: persistent visual preferences, image modes and spatial lineage."""
import io,subprocess,unittest
from pathlib import Path
from PIL import Image
from backend import sam
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
BACK=(ROOT/'backend/app.py').read_text()

class UX110(unittest.TestCase):
 def test_persistent_controller_settings_and_palette(self):
  script=r"""
  const ui=require('./frontend/assets/xr-ui.js');
  for(let i=0;i<1000;i++){
   const p=ui.generate();
   if(ui.contrast(p.panel,p.text)<7)throw Error('Poor text contrast');
   if(!ui.fonts.includes(p.font))throw Error('Unapproved font');
  }
  for(const mode of ui.choices){if(ui.contrast(ui.base[mode].panel,ui.base[mode].text)<7)throw Error('Base theme low contrast: '+mode)}
  const bad=ui.valid({theme:'invalid',masked:'yes',processing:'veryfast',voice:false});
  if(bad.theme!=='current'||bad.masked!==true||bad.voice!==false)throw Error('Unexpected bad preference');
  const p=ui.valid({theme:'liquid',borders:false,voice:false,processing:'glow'});
  if(p.theme!=='liquid'||p.borders!==false||p.voice!==false||p.processing!=='glow')throw Error('Preferences invalid');
  """
  r=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True,timeout=20)
  self.assertEqual(r.returncode,0,r.stderr)
  for v in ("['config','⚙']",'configTexture()',"case 'config':return showConfig()",'function configHit(hit)',"card.kind==='config'",'refreshToolbar()',"case 'themerandom'",'function cardBack(c)'):
   self.assertIn(v,XR)
 def test_switches_affect_real_backend_and_rendering(self):
  for flag in ('borders','backgrounds','mascot','experimental','masked','voice'):
   self.assertIn("['"+flag+"'",XR)
  self.assertIn('const payload={recognize:true,cutouts:Boolean(cutouts)',APP)
  self.assertIn('cutouts:Boolean(cutouts)',APP)
  self.assertIn("v.get('cutouts') is not False",BACK)
  self.assertIn('sam.rectangle_jpeg(photo,region)',BACK)
  self.assertIn('uiSettings.voice!==false',XR)
  self.assertIn('uiSettings.experimental===false',XR)
 def test_two_image_rendering_modes_from_sam(self):
  im=Image.new('RGBA',(8,8),(240,12,24,255))
  region={'box':[1,1,6,6],'image_size':(8,8),'width':5,'height':5,'raster':bytes([0]+[255]*24)}
  raw=sam.cutout_png(im,region)
  jpg=sam.rectangle_jpeg(im,region)
  self.assertTrue(raw.startswith(b'\x89PNG'))
  self.assertTrue(jpg.startswith(b'\xff\xd8'))
  with Image.open(io.BytesIO(raw)) as out:self.assertEqual(out.getpixel((0,0))[3],0)
  with Image.open(io.BytesIO(jpg)) as out:self.assertEqual(out.mode,'RGB')
 def test_generator_and_tree_view_are_infinite_in_storage(self):
  self.assertIn('addAncestors(tree,next)',XR)
  self.assertNotIn("addCard('branchback'",XR)
  self.assertIn('function navigationTexture(title)',XR)
  self.assertIn('tree.chain.slice(0,-1)',XR)
  self.assertIn("else if(h.card.kind==='ancestor')",XR)
  self.assertIn("uiSettings.processing||'spin'",XR)
  for key in ('spin','glow','gradient','particles1','particles2','particles3'):
   self.assertIn(key,(ROOT/'frontend/assets/xr-ui.js').read_text())
 def test_mascot_comet_wake(self):
  self.assertIn('mascotTrailAt',XR)
  self.assertIn('if(flight>.09',XR)
  self.assertIn("mascotReaction==='escape'",XR)
  self.assertIn('particles.length<170',XR)
  self.assertIn('trailDim',XR)
if __name__=='__main__':unittest.main()
