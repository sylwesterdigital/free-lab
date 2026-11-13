"""FREE LAB v0.10.6 — vision request format compared with robot observation sample.
All tests are offline; never contact the paid model endpoint.
"""
import io,json,unittest,urllib.error
from unittest.mock import patch
from backend import providers

MOCK_JPEG=b"\xff\xd8"+b"JPEG-MOCK"*5
BODY={"status":"completed","id":"resp_demo","output":[
  {"type":"reasoning","summary":[]},
  {"type":"message","role":"assistant","content":[
    {"type":"output_text","text":"A dark ceramic bowl is on a pale table with a blurred background."}]}],
  "usage":{"input_tokens":128,"output_tokens":82,"total_tokens":210}}

class VisionResponsesTests(unittest.TestCase):
 def test_observation_uses_actual_jpeg_and_plain_text_in_responses_api(self):
  with patch.object(providers.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(BODY).encode())) as call:
   answer,usage=providers.describe(MOCK_JPEG,'secret-key',question='What is in this image?')
  self.assertIn('ceramic bowl',answer)
  self.assertEqual(usage['total_tokens'],210)
  request=call.call_args.args[0]
  self.assertEqual(request.full_url,'https://api.meta.ai/v1/responses')
  payload=json.loads(request.data)
  self.assertEqual(payload['model'],'muse-spark-1.3')
  self.assertFalse(payload['store'])
  self.assertEqual(payload['reasoning']['effort'],'low')
  contents=payload['input'][0]['content']
  self.assertEqual(contents[0],{'type':'input_text','text':'What is in this image?'})
  self.assertEqual(contents[1]['type'],'input_image')
  self.assertTrue(contents[1]['image_url'].startswith('data:image/jpeg;base64,'))
  self.assertNotIn('secret-key',request.data.decode())
  self.assertEqual(request.get_header('Authorization'),'Bearer secret-key')
 def test_multiple_reasoning_items_are_not_visible_description(self):
  data=dict(BODY,output=[{'type':'reasoning','content':[{'type':'output_text','text':'not shown'}]},
     {'type':'message','role':'assistant','content':[{'type':'output_text','text':'Visible actual scene description.'}]}])
  self.assertEqual(providers._response_text(data),'Visible actual scene description.')
 def test_missing_visible_text_reports_clear_error(self):
  with self.assertRaisesRegex(RuntimeError,'no readable description'):
   providers._response_text({'status':'completed','output':[{'type':'reasoning'}]})
 def test_provider_failure_retains_status_for_ui_without_leaking_image(self):
  raw=b'{"error":{"code":"service_unavailable","message":"Back soon"}}'
  exc=urllib.error.HTTPError(providers.RESPONSES_URL,503,'Unavail',{'X-Request-ID':'req_789','Retry-After':'60'},io.BytesIO(raw))
  with patch.object(providers.urllib.request,'urlopen',side_effect=exc):
   with self.assertRaises(providers.MetaVisionUnavailable) as raised:
    providers.describe(MOCK_JPEG,'secret-key')
  self.assertEqual(raised.exception.status,503)
  self.assertEqual(raised.exception.request_id,'req_789')
  self.assertNotIn('secret-key',str(raised.exception))
 def test_incomplete_response_does_not_store_fake_description(self):
  with self.assertRaisesRegex(RuntimeError,'not completed'):
   providers._response_text({'status':'incomplete','output':[]})

if __name__=='__main__':unittest.main()
