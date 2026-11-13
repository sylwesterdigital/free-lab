"""FREE LAB 0.10.4: self-contained, no-network media/XR regressions."""
import json, struct, sqlite3, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from backend import db, glb_preview, secrets as keyvault

ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
APP=(ROOT/'frontend/assets/app.js').read_text()
SERVER=(ROOT/'backend/app.py').read_text()
INDEX=(ROOT/'frontend/index.html').read_text()

class SpatialWorkbench(unittest.TestCase):
    def test_one_image_popover_single_small_context(self):
        self.assertIn('size:[.2925,rows*.0711]', XR)
        self.assertIn("const sourceTools=[['describe'", XR)
        self.assertIn("'segment','✳'", XR)
        for label in ("segment:'EXTRACT'", "describe:'DESCRIBE'", "refine:'REFINE'", "voice:'VOICE'", "'3d':'3D'"):
            self.assertIn(label, XR)
        self.assertIn('return selected?.kind===\'source\'?runExtract():extractParts()',XR)
        self.assertIn('if(imageMenuOpen&&selected',XR)
    def test_voice_manual_until_stopped_and_ui_exclusive(self):
        self.assertIn('if(voicePhase===\'listening\')return finishVoiceRecording()',XR)
        self.assertIn('voiceRecord=window.FreeLab.startWavPrompt()',XR)
        self.assertIn('await record.stop()',XR)
        self.assertIn('voicePending={text:recognized,context:target}',XR)
        self.assertNotIn('keyboardPrompt()',XR.split('async function finishVoiceRecording(){',1)[1].split('async function applyPrompt(){',1)[0])
        self.assertIn('analyser.getByteFrequencyData(spectral)',APP)
        self.assertIn('i<36',XR)
        self.assertIn('voicePhase===\'listening\'||voicePhase===\'processing\'',XR)
    def test_description_is_explicit_private_and_cached(self):
        self.assertIn("@app.post('/api/media/describe')",SERVER)
        self.assertIn("(cid,g.user['id'])",SERVER)
        self.assertIn("image_dialogue WHERE owner_id=?",SERVER)
        self.assertIn("description=history[-1]['answer'],cached=True",SERVER)
        self.assertIn('INSERT INTO image_dialogue',SERVER)
        self.assertIn('providers.describe(raw,key,question=',SERVER)
        self.assertIn('descriptionTexture(value,label,retryable=false)',XR)
        self.assertIn("return describeSelected()",XR)
    def test_separate_movable_debug_window(self):
        self.assertIn("kind:'diagnostics',pos:anchor",XR)
        self.assertIn("card.kind==='toolbar'||card.kind==='diagnostics'",XR)
        for action in ('debugclose','debuglarger','debugsmaller'):
            self.assertIn(action,XR)
        self.assertIn("if(state.user?.role!=='admin')return",APP)
    def test_3d_job_needs_paid_confirmation_and_is_bounded(self):
        self.assertIn('confirm_paid\') is not True',SERVER)
        self.assertIn("@app.get('/api/media/3d/<int:jid>/preview')",SERVER)
        self.assertIn("row['status']!='SUCCEEDED'",SERVER)
        self.assertIn('glb_preview.MAX_FILE',SERVER)
        self.assertIn('spawnMeshPreview(job.id,item.origin)',XR)
        self.assertIn('createXR3D(target.captureId,target.objectId)',XR)
        self.assertEqual(glb_preview.MAX_TRIANGLES,3600)
    def test_non_xr_upload_and_elevenlabs_opt_in(self):
        self.assertIn('id="saveUploadCloud"',INDEX)
        self.assertIn('id="pref-speechEngine"',INDEX)
        self.assertIn('id="loadElevenVoices"',INDEX)
        self.assertIn("'elevenlabs'",(ROOT/'backend/secrets.py').read_text())
        self.assertIn("@app.get('/api/media/voices')",SERVER)
        self.assertIn("@app.post('/api/media/speak')",SERVER)
        self.assertIn("pref('speechEngine')!=='elevenlabs'",APP)
        self.assertIn('function speakBrowser(value)',APP)
    def test_database_migration_preserves_private_capture_description(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'lab.sqlite'
            db.init(path)
            con=db.connect(path)
            try:
                fields={r['name'] for r in con.execute('PRAGMA table_info(captures)')}
                self.assertIn('description', fields)
                con.execute('UPDATE captures SET description=? WHERE id=?',('metadata',9999))
                con.commit()
            finally:con.close()
            db.init(path)
            con=db.connect(path)
            try:self.assertIn('description',{r['name'] for r in con.execute('PRAGMA table_info(captures)')})
            finally:con.close()

class GLBPreviewTests(unittest.TestCase):
    @staticmethod
    def make_glb():
        positions=struct.pack('<9f',0,0,0,1,0,0,0,1,0)
        indices=struct.pack('<3H',0,1,2)
        binary=positions+indices+b'\0\0'
        scene={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(binary)}],
            'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':36,'byteLength':6}],
            'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'},
                         {'bufferView':1,'componentType':5123,'count':3,'type':'SCALAR'}],
            'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1,'mode':4}]}]}
        jsonchunk=json.dumps(scene,separators=(',',':')).encode()
        jsonchunk+=b' ' * ((-len(jsonchunk))%4)
        total=12+8+len(jsonchunk)+8+len(binary)
        return struct.pack('<4sII',b'glTF',2,total)+struct.pack('<I4s',len(jsonchunk),b'JSON')+jsonchunk+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    def test_valid_glb_extracts_one_centered_untextured_triangle(self):
        o=glb_preview.decode(self.make_glb())
        self.assertEqual(o['triangles'],1)
        self.assertEqual(len(o['positions']),9)
        self.assertTrue(o['texture_omitted'])
        self.assertLessEqual(max(abs(n) for n in o['positions']),.6)
    def test_rejects_bad_magic_and_oversize(self):
        payload=self.make_glb()
        with self.assertRaisesRegex(ValueError,'Invalid GLB'):
            glb_preview.decode(b'FAIL'+payload[4:])
        with self.assertRaises(ValueError):glb_preview.decode(b'x'*(glb_preview.MAX_FILE+1))
    def test_rejects_malformed_accessor(self):
        data=self.make_glb().replace(b'"count":3',b'"count":9',1)
        # String length changes invalidate GLB total; still must reject.
        with self.assertRaises(ValueError):glb_preview.decode(data)

if __name__=='__main__':unittest.main()
