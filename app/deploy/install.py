#!/usr/bin/env python3
"""Root-only verified Ubuntu deploy, with symlink + nginx rollback on error."""
import argparse,hashlib,json,os,pwd,re,secrets,shutil,subprocess,sys,time,urllib.request
from pathlib import Path

DOMAIN='free-lab.cam'
# Dedicated loopback port: v0.1.0 used 8765 without a collision check.
# All service, nginx, and health endpoints use this single value.
API_PORT=18765
VAULT_KEY=Path('/etc/free-lab-vault.key')
BASE=Path('/var/www/free-lab.cam')
RELEASES=BASE/'releases'
CURRENT=BASE/'current'
DATA=Path('/var/lib/free-lab')
VENV=Path('/opt/free-lab/venv')
SITE=Path('/etc/nginx/sites-available/free-lab.cam')
UNIT=Path('/etc/systemd/system/free-lab.service')
ENV=Path('/etc/free-lab.env')
BACKUP=Path('/var/lib/free-lab/deploy-backups')

NGINX='''server {
    listen 80;
    listen [::]:80;
    server_name free-lab.cam;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name free-lab.cam;
    root /var/www/free-lab.cam/current/frontend;
    index index.html;
    access_log /var/log/nginx/free-lab.cam.access.log;
    error_log /var/log/nginx/free-lab.cam.error.log;
    ssl_certificate /etc/letsencrypt/live/free-lab.cam/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/free-lab.cam/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location /api/ {
       proxy_pass http://127.0.0.1:__FREE_LAB_PORT__;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_connect_timeout 8s;
       proxy_read_timeout 50s;
       client_max_body_size 4500k;
    }
    # Explicitly type browser ES modules. nginx's stock mime.types on some
    # Ubuntu installations does not map .mjs to JavaScript.
    location = /assets/room-viewer.mjs {
       types { application/javascript mjs; }
       default_type application/javascript;
       try_files $uri =404;
    }
    location = /assets/scene.mjs {
       types { application/javascript mjs; }
       default_type application/javascript;
       try_files $uri =404;
    }
    location ~ \.mjs$ {
       types { application/javascript mjs; }
       default_type application/javascript;
       try_files $uri =404;
    }
    # Never return the SPA's index.html for a missing JS, CSS or image asset.
    # Otherwise browsers report a misleading text/html module MIME error.
    location /assets/ {
       try_files $uri =404;
    }
    location / {
       try_files $uri $uri/ /index.html;
    }
    location ~ /\\. { deny all; }
}
'''
UNIT_TEXT='''[Unit]
Description=Free Lab spatial collection API
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=free-lab
Group=free-lab
WorkingDirectory=/var/www/free-lab.cam/current
EnvironmentFile=/etc/free-lab.env
ExecStart=/opt/free-lab/venv/bin/gunicorn --workers 2 --threads 4 --timeout 65 --bind 127.0.0.1:__FREE_LAB_PORT__ backend.app:app
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/free-lab
UMask=0077
[Install]
WantedBy=multi-user.target
'''
# Keep port declaration consistent with nginx and the unit file.
NGINX=NGINX.replace('__FREE_LAB_PORT__',str(API_PORT))
UNIT_TEXT=UNIT_TEXT.replace('__FREE_LAB_PORT__',str(API_PORT))

def run(*argv,timeout=190,env=None,cwd=None):
    subprocess.run([str(v) for v in argv],check=True,timeout=timeout,env=env,cwd=cwd)

def hashes_ok(stage,version):
    manifest=json.loads((stage/'manifest.json').read_text())
    if manifest.get('version')!=version or manifest.get('project')!='free-lab':raise RuntimeError('Invalid release manifest')
    for name,expected in manifest.get('sha256',{}).items():
        if not name.startswith('app/') or '..' in Path(name).parts:raise RuntimeError('Invalid file path')
        file=stage/name
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=expected:raise RuntimeError('Digest mismatch '+name)

def atomic_write(path,content):
    temp=path.with_name(path.name+'.free-lab-new')
    temp.write_text(content)
    os.chmod(temp,0o644)
    os.replace(temp,path)

def switch(target):
    temp=CURRENT.with_name('.current-next')
    if temp.is_symlink() or temp.exists():temp.unlink()
    temp.symlink_to(target)
    os.replace(temp,CURRENT)

def active_vhost_files(nginx_dump, host=DOMAIN):
    """Find files actually loaded by nginx for this hostname (`nginx -T`).

    A sites-available file is *not necessarily enabled*. Writing it and
    passing `nginx -t` does not mean the active server configuration changed.
    Return ordered unique filenames from the config dump, without DNS access.
    """
    header=re.compile(r'^# configuration file (.+?):\s*$', re.M)
    markers=list(header.finditer(nginx_dump))
    found=[]
    for i,marker in enumerate(markers):
        chunk=nginx_dump[marker.end():markers[i+1].start() if i+1<len(markers) else len(nginx_dump)]
        # Ignore full/inline nginx comments, not just commented-out locations.
        uncommented='\n'.join(line.split('#',1)[0] for line in chunk.splitlines())
        for names in re.findall(r'(?m)^\s*server_name\s+([^;]+);',uncommented):
            if host in names.split():
                filename=marker.group(1).strip()
                if filename not in found:found.append(filename)
                break
    return found

def active_nginx_target():
    """Resolve the existing loaded vhost, refusing to edit unrelated sites.

    We do not blindly change sites-available: the active config may be a
    separate file in sites-enabled, conf.d, or a symlink to another target.
    """
    p=subprocess.run(['nginx','-T'],capture_output=True,text=True,timeout=22,check=True)
    candidates=active_vhost_files(p.stdout)
    paths=[]
    for candidate in candidates:
        path=Path(candidate).resolve(strict=True)
        # Never overwrite the master config or anything outside nginx's tree.
        if path==Path('/etc/nginx/nginx.conf') or not path.is_relative_to('/etc/nginx'):
            raise RuntimeError('FREE LAB active nginx configuration is not a standalone /etc/nginx site: '+str(path))
        if path not in paths:paths.append(path)
    if len(paths)!=1:
        raise RuntimeError('Expected exactly one active nginx vhost config for '+DOMAIN+
                           ', found '+repr([str(p) for p in paths])+'. Refusing to modify unrelated sites.')
    active=paths[0]
    content=active.read_text()
    names=set()
    for match in re.findall(r'(?m)^\s*server_name\s+([^;]+);',content):
        names.update(match.split())
    if names-{DOMAIN}:
        raise RuntimeError('Active FREE LAB nginx config also contains unrelated server names: '+
                           ', '.join(sorted(names-{DOMAIN}))+'. Refusing destructive overwrite.')
    return active

def verify_local_es_modules():
    """Fail/rollback an installation if nginx serves ES modules as octet-stream.

    Authenticated TLS connects only to the local reverse proxy; no public DNS,
    third-party service, or credentials are involved.
    """
    import socket,ssl
    for asset in ('scene.mjs','room-viewer.mjs'):
        with socket.create_connection(('127.0.0.1',443),timeout=9) as tcp:
            with ssl.create_default_context().wrap_socket(tcp,server_hostname='free-lab.cam') as tls:
                tls.settimeout(9)
                tls.sendall((f'GET /assets/{asset} HTTP/1.1\r\nHost: free-lab.cam\r\n'
                             'Connection: close\r\nCache-Control: no-cache\r\n\r\n').encode('ascii'))
                lines=tls.makefile('rb')
                status=lines.readline(600).decode('latin-1','replace')
                headers={}
                while True:
                    line=lines.readline(4096)
                    if line in (b'\r\n',b'\n',b''):break
                    if b':' in line:
                        key,value=line.split(b':',1)
                        headers[key.decode('latin-1').strip().lower()]=value.decode('latin-1').strip()
                mime=headers.get('content-type','').split(';',1)[0].lower()
                if ' 200 ' not in status or mime not in ('application/javascript','text/javascript'):
                    raise RuntimeError(f'ES module /assets/{asset} invalid: {status.strip()}, Content-Type={mime}')

def probe_local_health(port):
    """Probe the loopback API directly, bypassing configured HTTP proxies."""
    request=urllib.request.Request(f'http://127.0.0.1:{port}/api/health',
                                   headers={'Cache-Control':'no-cache'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request,timeout=2) as response:
        payload=response.read(16000)
        return response.status,json.loads(payload)

def check_port_available_for_free_lab():
    """Refuse to replace or rely on a listener belonging to another application."""
    import socket
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        occupied=sock.connect_ex(('127.0.0.1',API_PORT))==0
    if not occupied:return
    old_version=None
    if CURRENT.is_symlink():
        try:old_version=json.loads((CURRENT/'version.json').read_text())['version']
        except (OSError,ValueError,KeyError):pass
    try:
        _,body=probe_local_health(API_PORT)
        is_ours=(old_version is not None and body.get('version')==old_version
                 and body.get('storage')=='sqlite' and body.get('ok') is True)
    except Exception:is_ours=False
    if not is_ours:
        raise RuntimeError(f'Cannot deploy: localhost:{API_PORT} is already occupied by '
                           'another application. No service or nginx files were changed.')

def readiness_diagnostics():
    """Bounded diagnostics, never print EnvironmentFile or API credentials."""
    outputs=[]
    for command in (["systemctl","is-active","free-lab"],
                    ["systemctl","status","free-lab","--no-pager","--lines=8"],
                    ["journalctl","-u","free-lab","-n","12","--no-pager","-o","cat"]):
        try:
            p=subprocess.run(command,capture_output=True,text=True,timeout=6,check=False)
            excerpt=' '.join((p.stdout+' '+p.stderr).split())[-1100:]
            outputs.append(command[0]+': '+excerpt)
        except Exception as exc:outputs.append(command[0]+': '+str(exc))
    return ' | '.join(outputs)[-2200:]

def wait_health(version):
    last='not attempted'
    for _ in range(35):
        try:
            status,body=probe_local_health(API_PORT)
            if (status==200 and isinstance(body,dict) and body.get('version')==version
                and body.get('ok') is True and body.get('storage')=='sqlite'):return
            last=('Unexpected /api/health response: HTTP '+str(status)+', '+
                  json.dumps(body,sort_keys=True,default=str)[:400]+
                  '; expected version '+version+' with ok=true and storage=sqlite')
        except Exception as exc:
            last=type(exc).__name__+': '+str(exc)
        time.sleep(1)
    raise RuntimeError('Local API failed readiness at localhost:'+str(API_PORT)+
                       '. Service diagnostics: '+readiness_diagnostics()[-850:]+
                       ' | Last health check: '+last)

def ensure_environment():
    if ENV.exists():return
    session=secrets.token_hex(48)
    text=('FREE_LAB_DATA_DIR=/var/lib/free-lab\nFREE_LAB_DB=/var/lib/free-lab/free-lab.sqlite3\n'
          'FREE_LAB_HTTPS=1\nFREE_LAB_SESSION_KEY='+session+'\n'
          'META_MODEL=muse-ember-1.0\nMODEL_API_KEY=\n'
          'FREE_LAB_ENFORCE_INFERENCE_LIMITS=0\nFREE_LAB_DAILY_LIMIT=0\nFREE_LAB_USER_DAILY_LIMIT=0\nFREE_LAB_COOLDOWN_SECONDS=0\n')
    fd=os.open(ENV,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write(text)

def ensure_secret_vault():
    """Persistent key outside releases/Git; root owned, readable by service group."""
    if not VAULT_KEY.exists():
        from cryptography.fernet import Fernet
        key=Fernet.generate_key()+b'\n'
        fd=os.open(VAULT_KEY,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o640)
        with os.fdopen(fd,'wb') as f:f.write(key)
    run('chown','root:free-lab',str(VAULT_KEY))
    os.chmod(VAULT_KEY,0o640)

def env_values():
    # Use a minimal, explicitly defined environment for CLI; no need to parse systemd env file.
    return {**os.environ,'FREE_LAB_DB':str(DATA/'free-lab.sqlite3'),
            'FREE_LAB_DATA_DIR':str(DATA),'FREE_LAB_BOOTSTRAP_PASSWORD':os.getenv('FREE_LAB_BOOTSTRAP_PASSWORD','')}

def user_count():
    import sqlite3
    p=DATA/'free-lab.sqlite3'
    if not p.exists():return 0
    with sqlite3.connect(p) as con:
        try:return con.execute('SELECT count(*) FROM users').fetchone()[0]
        except sqlite3.Error:return 0

def ensure_admin(release):
    env=env_values()
    # Setup DB under service user; never store admin password or log the CLI environment.
    run('runuser','-u','free-lab','--',str(VENV/'bin/python'),'-m','backend.cli','init',cwd=release,env=env)
    if user_count():return
    password=os.getenv('FREE_LAB_BOOTSTRAP_PASSWORD','')
    if len(password)<12:raise RuntimeError('Initial administrator password required on first deployment (12+ characters)')
    run('runuser','-u','free-lab','--',str(VENV/'bin/python'),'-m','backend.cli','create-admin','admin',cwd=release,env=env)
    print('ADMIN ACCOUNT CREATED: admin')

def install(stage,version):
    if os.geteuid()!=0:raise RuntimeError('Must run as root')
    if not version.replace('.','').isdigit() or len(version.split('.'))!=3:raise RuntimeError('Bad version')
    stage=stage.resolve();hashes_ok(stage,version)
    for cert in ('/etc/letsencrypt/live/free-lab.cam/fullchain.pem', '/etc/letsencrypt/live/free-lab.cam/privkey.pem'):
        if not Path(cert).exists():raise RuntimeError("Existing Let's Encrypt certificate required: "+cert)
    for command in ('nginx','systemctl','runuser','python3'):
        if shutil.which(command) is None:raise RuntimeError('Required command missing: '+command)
    BASE.mkdir(parents=True,exist_ok=True);RELEASES.mkdir(exist_ok=True)
    DATA.mkdir(parents=True,exist_ok=True);BACKUP.mkdir(parents=True,exist_ok=True)
    if not shutil.which('useradd'):raise RuntimeError('useradd missing')
    try:pwd.getpwnam('free-lab')
    except KeyError:run('useradd','--system','--home-dir',str(DATA),'--shell','/usr/sbin/nologin','free-lab')
    run('chown','-R','free-lab:free-lab',str(DATA))
    dest=RELEASES/('v'+version)
    if dest.exists():
        manifest=json.loads((stage/'manifest.json').read_text())
        for name,digest in manifest['sha256'].items():
            file=dest/Path(name).relative_to('app')
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=digest:raise RuntimeError('Existing release collision: '+name)
    else:shutil.copytree(stage/'app',dest,ignore=shutil.ignore_patterns('__pycache__','*.pyc','.venv','var'))
    os.chmod(dest,0o755)
    VENV.parent.mkdir(parents=True,exist_ok=True)
    if not (VENV/'bin/python').exists():run('python3','-m','venv',str(VENV),timeout=80)
    run(str(VENV/'bin/python'),'-m','pip','install','--disable-pip-version-check','-r',str(dest/'requirements.txt'),timeout=250)
    ensure_environment()
    ensure_secret_vault()
    check_port_available_for_free_lab()
    # Do not alter a preconfigured API key or persistent credentials.
    ensure_admin(dest)
    run('runuser','-u','free-lab','--',str(VENV/'bin/python'),'-m','unittest','discover','-s','tests','-v',cwd=dest,env=env_values(),timeout=65)
    # Detect which file nginx actually includes before writing anything.
    # Earlier releases updated sites-available even when the live vhost was
    # loaded from a different file, leaving .mjs at application/octet-stream.
    live_site=active_nginx_target()
    prev_target=CURRENT.resolve() if CURRENT.is_symlink() else None
    stamp=time.strftime('%Y%m%d-%H%M%S')+'-'+version.replace('.','-')
    backup=BACKUP/stamp;backup.mkdir(parents=True,exist_ok=True)
    backup.chmod(0o700)
    site_target=SITE.resolve() if SITE.is_symlink() else SITE
    config_files=list(dict.fromkeys((site_target,live_site)))
    prior_configs={file:file.read_bytes() if file.exists() else None for file in config_files}
    prev_unit=UNIT.read_bytes() if UNIT.exists() else None
    (backup/'metadata.json').write_text(json.dumps({'previous':str(prev_target) if prev_target else None,
         'version':version,'live_nginx_config':str(live_site)},indent=2))
    for i,(file,data) in enumerate(prior_configs.items()):
        if data is not None:(backup/f'nginx-{i}.conf').write_bytes(data)
    if prev_unit is not None:(backup/'unit.service').write_bytes(prev_unit)
    changed=False
    try:
        atomic_write(UNIT,UNIT_TEXT);run('systemctl','daemon-reload')
        # Update the canonical file AND the included file, if they differ.
        # Do not replace the symlink itself with a regular file.
        for path in config_files:atomic_write(path,NGINX)
        run('nginx','-t')
        # Confirm that nginx -T sees our new JS MIME directives, not a stale
        # duplicate or disabled vhost from an old configuration.
        check=subprocess.run(['nginx','-T'],capture_output=True,text=True,timeout=22,check=True)
        active_files=[Path(p).resolve(strict=True) for p in active_vhost_files(check.stdout)]
        if active_files != [live_site] or 'location = /assets/room-viewer.mjs {' not in live_site.read_text():
            raise RuntimeError('Active nginx vhost did not accept updated ES module MIME routing')
        switch(dest);changed=True
        run('systemctl','enable','free-lab')
        run('systemctl','restart','free-lab')
        wait_health(version)
        run('systemctl','reload','nginx')
        verify_local_es_modules()
        print('DEPLOYED '+version)
        print('SERVER UNIT TESTS + LOCAL HEALTH + ES MODULE MIME PASSED')
        print('PUBLIC URL https://free-lab.cam/')
    except Exception:
        # Recover *every* file changed, including the truly active nginx vhost.
        for path,data in prior_configs.items():
            if data is None:path.unlink(missing_ok=True)
            else:path.write_bytes(data)
        if prev_unit is None:UNIT.unlink(missing_ok=True)
        else:UNIT.write_bytes(prev_unit)
        if changed:
            if prev_target:switch(prev_target)
            else:CURRENT.unlink(missing_ok=True)
        run('systemctl','daemon-reload')
        run('nginx','-t')
        run('systemctl','reload','nginx')
        if prev_target:run('systemctl','restart','free-lab')
        else:run('systemctl','stop','free-lab')
        raise

def rollback():
    if os.geteuid()!=0:raise RuntimeError('root required')
    if not CURRENT.is_symlink():raise RuntimeError('Current release symlink missing')
    current=CURRENT.resolve();others=[p for p in RELEASES.iterdir() if p.is_dir() and p.resolve()!=current]
    if not others:raise RuntimeError('No previous release found')
    prev=max(others,key=lambda p:p.stat().st_mtime)
    switch(prev)
    try:
        run('systemctl','restart','free-lab')
        wait_health(json.loads((prev/'version.json').read_text())['version'])
    except Exception:
        switch(current);run('systemctl','restart','free-lab');raise
    print('ROLLED BACK to '+prev.name)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage');p.add_argument('--version');p.add_argument('--rollback',action='store_true')
    a=p.parse_args()
    try:
        if a.rollback:rollback()
        else:
            if not a.stage or not a.version:p.error('--stage and --version required')
            install(Path(a.stage),a.version)
    except Exception as e:
        print('INSTALL FAILED: '+str(e),file=sys.stderr);sys.exit(1)
