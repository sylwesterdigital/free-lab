"""v0.10.6: recursive image ancestry, pagination, and no silent depth cap."""
import subprocess, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
JS=ROOT/'frontend/assets/cloud-tree.js'
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'backend/app.py').read_text()
DB=(ROOT/'backend/db.py').read_text()

class TreeTests(unittest.TestCase):
 def test_parent_relationships_in_operations(self):
  self.assertIn('parent_object_id',DB)
  self.assertIn("parent_id,'nested_extraction'",APP)
  self.assertIn("parent,'mix' if mix_sources else 'image_edit'",APP)
 def test_no_silent_capture_or_object_truncation(self):
  self.assertNotIn('ORDER BY id LIMIT 80',APP)
  self.assertNotIn('FROM captures WHERE owner_id=? ORDER BY id DESC LIMIT 500',APP)
  self.assertNotIn('.slice(0,MAX_CLOUD)',XR)
  self.assertIn('branchNavigation(tree)',XR)
  self.assertIn('async function upBranch()',XR)
  self.assertIn("case 'branch':",XR)
 def test_arbitrary_depth_and_sibling_pages(self):
  script=r"""
  const {view,pageOfChild}=require(process.argv[1]);
  let a=[];for(let n=1;n<=130;n++)a.push({id:n,parent_object_id:n===1?null:n-1,shelf:'collection'});
  for(let n=1;n<=130;n++){let v=view(a,n,0);if(n<130&&v.children[0].id!==n+1)throw Error('broken chain at '+n);}
  let v=view(a,130,0);if(v.chain.length!==130)throw Error('depth capped');
  for(let n=131;n<155;n++)a.push({id:n,parent_object_id:100,shelf:'collection'});
  const first=view(a,100,0),last=view(a,100,3);
  if(first.totalChildren!==25||first.children.length!==7||last.children.length!==4)throw Error('paging broken');
  if(pageOfChild(a,100,154)!==3)throw Error('last child page incorrect');
  if(view(a,101,0).chain.length!==101)throw Error('long ancestry lost');
  if(view(a,null,0).children.length!==1)throw Error('root parent mismatch');
  console.log('recursive tree passed');
  """
  p=subprocess.run(['node','-e',script,str(JS)],capture_output=True,text=True,timeout=10)
  self.assertEqual(p.returncode,0,p.stderr or p.stdout)

if __name__=='__main__':unittest.main()
