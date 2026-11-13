"""v0.10.5: provider 503 handling without keys, billing or live network."""
import io,json,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from backend import providers
ROOT=Path(__file__).resolve().parents[1]
XR=(ROOT/'frontend/assets/xr.js').read_text()
FRONT=(ROOT/'frontend/assets/app.js').read_text()
SERVER=(ROOT/'backend/app.py').read_text()

JPEG=b'\xff\xd8'+b'JPEG-MOCK'*3
SUCCESS={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'The photograph shows a black ceramic bowl on a wooden table.'}]}], 'usage':{'total_tokens':52}}

def error(status,code='service_overloaded',retry_after='0'):
    body=json.dumps({'error':{'type':'server_error','code':code,'message':'Internal server temporarily unavailable'}}).encode()
    headers={'Retry-After':retry_after,'X-Request-ID':'req_123456'}
    return urllib.error.HTTPError(providers.API_URL,status,'Failed',headers,io.BytesIO(body))

class MetaVisionRetryTests(unittest.TestCase):
 def test_transient_503_retries_same_model_and_image(self):
    events=[error(503),error(503),io.BytesIO(json.dumps(SUCCESS).encode())]
    with patch.object(providers.urllib.request,'urlopen',side_effect=events) as request,patch.object(providers.time,'sleep') as sleep:
      description,usage=providers.describe(JPEG,'private-key')
    self.assertIn('black ceramic bowl',description)
    self.assertEqual(usage['total_tokens'],52)
    self.assertEqual(request.call_count,3)
    self.assertEqual(sleep.call_count,0) # Retry-After: 0
    for call in request.call_args_list:
      payload=json.loads(call.args[0].data)
      self.assertEqual(payload['model'],'muse-spark-1.3')
      self.assertEqual(payload['input'][0]['content'][1]['type'],'input_image')

 def test_repeat_503_has_provider_code_no_secret_and_only_three_attempts(self):
    with patch.object(providers.urllib.request,'urlopen',side_effect=[error(503) for _ in range(3)]) as request:
      with self.assertRaises(providers.MetaVisionUnavailable) as raised:
        providers.describe(JPEG,'my-private-key')
    e=raised.exception
    self.assertEqual(e.status,503)
    self.assertEqual(e.code,'service_overloaded')
    self.assertEqual(e.request_id,'req_123456')
    self.assertEqual(e.attempts,3)
    self.assertNotIn('my-private-key',str(e))
    self.assertEqual(request.call_count,3)

 def test_long_provider_retry_after_is_respected_without_blocking(self):
    with patch.object(providers.urllib.request,'urlopen',side_effect=error(503,retry_after='60')) as request,patch.object(providers.time,'sleep') as sleep:
      with self.assertRaises(providers.MetaVisionUnavailable) as raised:providers.describe(JPEG,'secret-key')
    self.assertEqual(raised.exception.retry_after,60)
    self.assertEqual(request.call_count,1)
    sleep.assert_not_called()

 def test_bad_request_and_credentials_are_not_retried(self):
    for status in (400,401,403,404):
      with self.subTest(status=status),patch.object(providers.urllib.request,'urlopen',side_effect=error(status,'invalid_request_error')) as request:
       with self.assertRaises(providers.MetaVisionUnavailable) as raised:providers.describe(JPEG,'key')
       self.assertEqual(raised.exception.status,status)
       self.assertEqual(request.call_count,1)

 def test_xr_retry_is_one_click_and_no_session_exit(self):
    self.assertIn("case 'descriptionretry':return askDescription('');",XR)
    self.assertIn("h.card.retryable?'descriptionretry':'descriptionask'",XR)
    self.assertIn('Meta is busy right now. Tap RETRY',XR)
    self.assertIn('err.upstreamStatus=result.upstream_status',FRONT)
    self.assertIn('except providers.MetaVisionUnavailable as e:',SERVER)
    self.assertIn('upstream_status=e.status',SERVER)
    self.assertNotIn('session.end()',XR.split('async function askDescription(',1)[1].split('async function describeSelected(',1)[0])

if __name__=='__main__':unittest.main()
