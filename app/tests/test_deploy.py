"""Deployment consistency checks; runnable without Flask or root privileges."""
import unittest
from deploy import install

class InstallerTests(unittest.TestCase):
    def test_dedicated_api_port(self):
        self.assertEqual(install.API_PORT,18765)
        self.assertIn('proxy_pass http://127.0.0.1:18765;',install.NGINX)
        self.assertIn('--bind 127.0.0.1:18765 ',install.UNIT_TEXT)
        self.assertNotIn('127.0.0.1:8765',install.NGINX+install.UNIT_TEXT)
    def test_proxy_bypass_and_diagnostics(self):
        self.assertTrue(callable(install.probe_local_health))
        self.assertTrue(callable(install.readiness_diagnostics))
        self.assertTrue(callable(install.check_port_available_for_free_lab))

if __name__=='__main__':unittest.main()
