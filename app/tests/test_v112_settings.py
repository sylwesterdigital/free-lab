"""Settings v0.10.12: one key per provider and a fixed-height scroll area."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'frontend/index.html').read_text()
JS=(ROOT/'frontend/assets/app.js').read_text()
CSS=(ROOT/'frontend/assets/style.css').read_text()
XR=(ROOT/'frontend/assets/xr.js').read_text()

class Settings112(unittest.TestCase):
 def test_three_tab_navigation_and_no_legacy_stacked_forms(self):
  for name in ('experience','apis','users'):
   self.assertIn('data-profile-tab="'+name+'"',HTML)
   self.assertIn('data-profile-view="'+name+'"',HTML)
  self.assertIn('id="profileScroll"',HTML)
  self.assertNotIn('Private API vault',HTML)
  self.assertNotIn('id="usageSummary"',HTML)
  self.assertNotIn('id="providerChoices"',HTML)
  self.assertNotIn('name="keyMode"',HTML)
  self.assertNotIn('id="preferred3D"',HTML)
 def test_provider_rows_have_server_only_save_and_test(self):
  for needle in ("api('/admin/providers')","api('/admin/provider-scopes')","'/admin/providers/'+p.provider+'/check'", "'/admin/providers/'+p.provider", "'/admin/provider-scopes/'+p.provider", "type='password'", 'api-provider-row', 'providerRows.set(p.provider,row)'):
   self.assertIn(needle,JS)
  self.assertIn('key.value.trim()',JS)
  self.assertNotIn('name="keyMode"',HTML)
 def test_opaque_fixed_header_and_independent_scroll(self):
  self.assertIn('#profilePanel .profile-fixed-header',CSS)
  self.assertIn('#profilePanel .profile-scroll{flex:1;min-height:0;overflow-y:auto;',CSS)
  self.assertIn('overflow:hidden;padding:0;',CSS)
 def test_xr_provider_control(self):
  for needle in ("'3D GENERATION'","'config3dnext'","window.FreeLab?.save3DPreference?.(value)","'NO KEY FOR THIS PROFILE'",'config3DAvailable'):
   self.assertIn(needle,XR)

if __name__=='__main__':unittest.main()
