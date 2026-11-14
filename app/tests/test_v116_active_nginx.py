"""v0.10.23 nginx active-vhost and real browser module MIME regression checks."""
import unittest
from pathlib import Path
from deploy import install


class ActiveNginx116(unittest.TestCase):
 def test_active_vhost_parser_uses_nginx_T_included_site_not_sites_available(self):
  # Simulates an unrelated /sites-available update silently missing the actual
  # live site at /sites-enabled/legacy-free-lab.conf.
  cfg='''nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# configuration file /etc/nginx/nginx.conf:
http { include /etc/nginx/sites-enabled/*; }
# configuration file /etc/nginx/sites-enabled/legacy-free-lab.conf:
server {
    listen 443 ssl;
    server_name free-lab.cam;
    location /assets/ { try_files $uri =404; }
}
# configuration file /etc/nginx/mime.types:
types { text/html html; }
'''
  self.assertEqual(install.active_vhost_files(cfg),['/etc/nginx/sites-enabled/legacy-free-lab.conf'])

 def test_parser_ignores_commented_out_and_unrelated_vhosts(self):
  cfg='''# configuration file /etc/nginx/sites-enabled/other.conf:
server {
  # server_name free-lab.cam;
  server_name other.example;
}
# configuration file /etc/nginx/sites-enabled/free-lab.conf:
server {
  server_name free-lab.cam;  # active hostname
}
'''
  self.assertEqual(install.active_vhost_files(cfg),['/etc/nginx/sites-enabled/free-lab.conf'])

 def test_two_active_files_are_visible_as_ambiguous(self):
  cfg='''# configuration file /etc/nginx/sites-enabled/free-lab-one.conf:
server {
 server_name free-lab.cam;
}
# configuration file /etc/nginx/conf.d/free-lab-two.conf:
server {
 server_name free-lab.cam;
}
'''
  self.assertEqual(len(install.active_vhost_files(cfg)),2)

 def test_room_viewer_and_scene_have_exact_javascript_location(self):
  conf=install.NGINX
  for file in ('room-viewer.mjs','scene.mjs'):
   block=conf.split('location = /assets/'+file+' {',1)[1].split('try_files $uri =404;',1)[0] + 'try_files $uri =404;'
   self.assertIn('types { application/javascript mjs;',block)
   self.assertIn('default_type application/javascript;',block)
   self.assertIn('try_files $uri =404;',block)

 def test_installer_writes_active_and_canonical_files_and_rolls_both_back(self):
  text=Path(install.__file__).read_text()
  self.assertIn('live_site=active_nginx_target()',text)
  self.assertIn('config_files=list(dict.fromkeys((site_target,live_site)))',text)
  self.assertIn('for path in config_files:atomic_write(path,NGINX)',text)
  self.assertIn('for path,data in prior_configs.items():',text)
  self.assertIn('verify_local_es_modules()',text)


if __name__=='__main__':unittest.main()
