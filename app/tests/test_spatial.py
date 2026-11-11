"""No-billing tests for encrypted keys, SAM coordinates and release markers."""
import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from cryptography.fernet import Fernet
from backend import db,sam,secrets

class VaultTests(unittest.TestCase):
 def setUp(self):
  self.root=tempfile.TemporaryDirectory()
  self.dbpath=Path(self.root.name)/'vault.sqlite3'
  db.init(self.dbpath);self.con=db.connect(self.dbpath)
  self.ctx=patch.dict(os.environ,{'FREE_LAB_VAULT_KEY':Fernet.generate_key().decode('ascii')})
  self.ctx.start()
 def tearDown(self):
  self.con.close();self.ctx.stop();self.root.cleanup()
 def test_round_trip_stays_encrypted_at_rest(self):
  value='super-secret-model-api-key-12345'
  secrets.set_key(self.con,'meta',value)
  self.assertEqual(secrets.get_key(self.con,'meta'),value)
  blob=self.con.execute('SELECT ciphertext FROM provider_secrets WHERE provider=?',('meta',)).fetchone()[0]
  self.assertNotIn(value.encode(),blob)
  self.assertNotIn(value,json.dumps(secrets.status(self.con)))
  secrets.delete_key(self.con,'meta');self.assertIsNone(secrets.get_key(self.con,'meta'))
 def test_reject_invalid_names_and_values(self):
  with self.assertRaises(ValueError):secrets.set_key(self.con,'evil','a'*20)
  with self.assertRaises(ValueError):secrets.set_key(self.con,'meta','x\n'*15)
  with self.assertRaises(ValueError):secrets.set_key(self.con,'meta','short')
 def test_missing_vault_key_fails_closed(self):
  secrets.set_key(self.con,'meta','test-secret-encrypted-long-enough')
  with patch.dict(os.environ,{'FREE_LAB_VAULT_KEY':Fernet.generate_key().decode('ascii')}):
   with self.assertRaises(RuntimeError):secrets.get_key(self.con,'meta')

class SamTests(unittest.TestCase):
 def test_box_parser(self):
  text='<0f>0<|box;x1=11;y1=22;x2=39;y2=44;w=100;h=90|><|mask;x=0;y=0;data=...|>,1<|box;x1=10;y1=20;x2=999;y2=999;w=100;h=90|>'
  self.assertEqual(sam.parse_boxes(text),[{'box':[11,22,39,44],'image_size':[100,90]}])
 def test_bad_text(self):
  self.assertEqual(sam.parse_boxes(''),[])
  self.assertEqual(sam.parse_boxes(None),[])

if __name__=='__main__':unittest.main()
