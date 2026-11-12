"""Version 0.3 regression: no billed endpoints in provider key tests, quotas persist."""
import json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
from backend import db,provider_checks,secrets as vault
from cryptography.fernet import Fernet

class ProviderChecks(unittest.TestCase):
    def test_allowlisted_readonly_only(self):
        self.assertEqual(set(provider_checks.CHECKS), {'meta','aholo','meshy','openai','gemini','xai','replicate','elevenlabs'})
        for url, auth,kind in provider_checks.CHECKS.values():
            self.assertTrue(url.startswith('https://'))
            self.assertTrue(url.endswith(('/models','/token','/balance','/account','pageSize=1','/user')))
        for name in ('tripo','fal','malicious'):
            with patch('urllib.request.build_opener') as fake:
                result=provider_checks.check(name,'a'*25)
                self.assertFalse(result['verified']);fake.assert_not_called()
    def test_aholo_key_not_bearer(self):
        response=MagicMock();response.read.return_value=b'{}';response.__enter__.return_value=response
        opener=MagicMock();opener.open.return_value=response
        with patch('urllib.request.build_opener',return_value=opener):
            result=provider_checks.check('aholo','my-private-credential-123')
        self.assertTrue(result['verified']);self.assertEqual(opener.open.call_args.args[0].headers.get('Authorization'),'my-private-credential-123')
        self.assertNotIn('my-private-credential-123',str(result))
    def test_meshy_balance_sanitized(self):
        response=MagicMock();response.read.return_value=b'{"balance":100,"monthly_credits":90,"api_key":"DO_NOT_RETURN"}';response.__enter__.return_value=response
        opener=MagicMock();opener.open.return_value=response
        with patch('urllib.request.build_opener',return_value=opener): result=provider_checks.check('meshy','my-private-credential-123')
        self.assertEqual(result['balance']['balance'],100)
        self.assertNotIn('DO_NOT_RETURN',str(result))

class LedgerMigration(unittest.TestCase):
    def test_usage_column_persists(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'data.db';db.init(p);db.init(p)
            con=db.connect(p);user=db.create_user(con,'tester','secure-password-123','Test')
            cid=db.begin_inference(con,user,'digest0','muse-ember-1.0',cooldown=0)
            db.finish_inference(con,cid,'ok',{'prompt_tokens':8,'completion_tokens':12,'other_secret':'x'})
            rec=con.execute('SELECT usage_json FROM inference_calls WHERE id=?',(cid,)).fetchone()['usage_json']
            self.assertEqual(json.loads(rec),{'prompt_tokens':8,'completion_tokens':12})
            con.close()
