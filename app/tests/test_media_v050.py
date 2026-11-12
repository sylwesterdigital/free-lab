"""v0.5.0: deterministic, no-network media, privacy, routing and XR invariants."""
import base64,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from backend import db,media
APP=Path(__file__).parents[1]

def test_jpeg():
    img=Image.new('RGB',(32,32),(96,167,104));buff=io.BytesIO();img.save(buff,'JPEG');return buff.getvalue()

class MediaModelTests(unittest.TestCase):
    def test_image_edit_uses_meta_model_and_source_without_server_storage(self):
        output=base64.b64encode(test_jpeg()).decode()
        result={'status':'completed','output':[{'type':'message','content':[]},
               {'type':'image_generation_call','result':output}],
               'usage':{'input_tokens':7,'output_tokens':8}}
        seen={}
        def fake_request(url,data,key,ctype,**kw):
            seen['url']=url;seen['payload']=json.loads(data);seen['key']=key;return json.dumps(result).encode()
        with patch.object(media,'_request',fake_request):
            jpeg,usage=media.edit_meta_image(test_jpeg(),'Improve lighting','test-key-that-was-not-shared')
        self.assertTrue(jpeg.startswith(b'\xff\xd8'))
        self.assertEqual(usage['input_tokens'],7)
        self.assertEqual(seen['payload']['model'],'muse-image-1.0')
        self.assertFalse(seen['payload']['store'])
        self.assertTrue(seen['payload']['input'][0]['content'][1]['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertTrue(seen['url'].endswith('/responses'))
        self.assertFalse(seen['payload']['tools'][0]['enable_web_search'])
    def test_result_parsing_does_not_invent_image(self):
        with self.assertRaises(RuntimeError):media.extract_image({'output':[{'type':'message','content':[]}]})
    def test_transcript_is_not_an_inferred_model_result(self):
        with patch.object(media,'_request',return_value=json.dumps({'turns':[{'text':'Improve quality'}]}).encode()):
            self.assertEqual(media.transcribe_meta(b'RIFF....WAVE','example-key'),'Improve quality')
    def test_garbage_image_rejected_before_network(self):
        with self.assertRaises(ValueError):media.edit_meta_image(b'BAD','improve quality','test-key')

class StorageTests(unittest.TestCase):
    def test_parent_links_and_cloud_position_upgrade_preserves_rows(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'private.sqlite';db.init(path)
            with db.connect(path) as c:
                user=db.create_user(c,'spatial-user','strong-passphrase-123')
                with c:
                    cid=c.execute('INSERT INTO captures(owner_id,image_name,sha256) VALUES(?,?,?)',(user,'original.jpg','a'*64)).lastrowid
                    a=c.execute('INSERT INTO objects(owner_id,label,capture_id) VALUES(?,?,?)',(user,'Lamp',cid)).lastrowid
                    c.execute('UPDATE captures SET spatial_json=? WHERE id=?',(json.dumps({'x':.4,'y':-.2,'z':.1}),cid))
                    c.execute('INSERT INTO objects(owner_id,label,capture_id,parent_object_id,operation) VALUES(?,?,?,?,?)',
                              (user,'Edited Lamp',cid,a,'image_edit'))
            db.init(path)
            with db.connect(path) as c:
                self.assertEqual(c.execute('SELECT label FROM objects WHERE id=?',(a,)).fetchone()[0],'Lamp')
                self.assertEqual(c.execute('SELECT parent_object_id FROM objects WHERE label=?',('Edited Lamp',)).fetchone()[0],a)
                self.assertEqual(json.loads(c.execute('SELECT spatial_json FROM captures WHERE id=?',(cid,)).fetchone()[0])['x'],.4)
    def test_zero_quota_means_optional_not_hidden_cap(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'x.sqlite';db.init(path)
            with db.connect(path) as c:
                uid=db.create_user(c,'nobudget','strong-passphrase-123')
                for i in range(3):
                    db.begin_inference(c,uid,'digest-'+str(i),'muse-image-1.0',daily_cap=0,user_cap=0,cooldown=0)
                self.assertEqual(c.execute('SELECT count(*) FROM inference_calls').fetchone()[0],3)

class UIContractTests(unittest.TestCase):
    def test_immersive_follow_not_mixed_with_saved_card_root(self):
        s=(APP/'frontend/assets/xr.js').read_text()
        self.assertIn('function viewerAnchor',s)
        self.assertIn('function syncTrackedUI(pose,t)',s)
        self.assertIn('function toggleFollow()',s)
        self.assertIn('source frame',s.lower())
        start=s.index('async function runExtract()')
        end=s.index('async function runSam()',start)
        self.assertIn('bloomChildren(found)',s[start:end])
        self.assertNotIn('showCloud(',s[start:end])
    def test_prompt_requires_explicit_apply(self):
        s=(APP/'frontend/assets/app.js').read_text()
        self.assertIn("document.getElementById('xrPromptApply').onclick",s)
        self.assertIn('async function recordWavPrompt(durationMs=12000)',s)
        self.assertIn('async function promptXR(',s)
        self.assertIn('async function keyboardPrompt()', (APP/'frontend/assets/xr.js').read_text())

if __name__=='__main__':unittest.main()
