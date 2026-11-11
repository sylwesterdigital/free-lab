#!/usr/bin/env bash
# FREE LAB — versioned release ZIP watcher for macOS M2 / Git / Ubuntu
# Usage: ./watch-free-lab.sh [--dry-run | --once | --status | --tail | --diagnose | --rollback] [--interval 3]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 - "$ROOT" "$@" <<'FREE_LAB_WATCH_PY'
from __future__ import annotations
import argparse,datetime as dt,fcntl,getpass,hashlib,json,os,re,secrets,shlex,shutil,socket,subprocess,sys,tempfile,time,urllib.request,zipfile
from pathlib import Path,PurePosixPath

ROOT=Path(sys.argv[1]).resolve();sys.argv=[sys.argv[0]]+sys.argv[2:]
UPDATES=ROOT/'updates';UPLOADS=ROOT/'uploads';STATE=ROOT/'.free-lab'
VERSION='0.2.0';PROJECT='free-lab';ZIP_RE=re.compile(r'^FREE_LAB_RELEASE_v(\d+\.\d+\.\d+)\.zip$')
REPO='git@github.com:sylwesterdigital/free-lab.git'
HOST=os.getenv('FREE_LAB_SSH_HOST','root@46.62.232.64')
PORT=os.getenv('FREE_LAB_SSH_PORT','333')
URL='https://free-lab.cam/'
LOG=None
class Failure(Exception):pass
class BadArchive(Failure):pass

def now():return dt.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')
def say(text,level='INFO'):
    line=f'{now()} [{level:5}] {text}'
    print(line,flush=True)
    if LOG:
        with LOG.open('a',encoding='utf8') as f:f.write(line+'\n')

def run(cmd,*,cwd=None,input=None,timeout=95,check=True):
    try:p=subprocess.run([str(v) for v in cmd],cwd=cwd,input=input,text=True,capture_output=True,timeout=timeout,env={**os.environ,'GIT_TERMINAL_PROMPT':'0'})
    except subprocess.TimeoutExpired:raise Failure(f'{cmd[0]} timed out')
    if check and p.returncode:raise Failure(f'{cmd[0]} failed: {(p.stderr or p.stdout)[-1600:]}')
    return p

def ssh(script,*,timeout=95):
    return run(['ssh','-p',PORT,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',HOST,'bash','-se'],
       input='set -euo pipefail\n'+script+'\n',timeout=timeout).stdout.strip()

def sha(content):return hashlib.sha256(content).hexdigest()
def version_tuple(v):return tuple(int(t) for t in v.split('.'))
def last_version():
    try:return json.loads((STATE/'deployed.json').read_text())['version']
    except (OSError,ValueError,KeyError):return '0.0.0'

def verify_watcher(content):
    text=content.decode('utf-8')
    m=re.search(r"^VERSION='(\d+\.\d+\.\d+)'",text,re.M)
    if not m or version_tuple(m.group(1))<version_tuple(VERSION):raise BadArchive('Watcher downgraded or version marker missing')
    current=ROOT/'watch-free-lab.sh'
    if current.exists() and m.group(1)==VERSION and current.read_bytes()!=content:
        raise BadArchive('Watcher changes require version bump')
    with tempfile.TemporaryDirectory(prefix='free-lab-watcher-check-') as t:
        file=Path(t)/'watch.sh';file.write_bytes(content)
        run(['bash','-n',file],timeout=20)
        body=re.search(r"<<'FREE_LAB_WATCH_PY'\n(.*?)\nFREE_LAB_WATCH_PY\s*$",text,re.S)
        if body is None:raise BadArchive('Embedded Python watcher missing')
        program=Path(t)/'watch.py';program.write_text(body.group(1))
        run(['python3','-m','py_compile',program],timeout=15)

def validate(archive,stage):
    try:z=zipfile.ZipFile(archive)
    except (zipfile.BadZipFile,OSError) as e:raise BadArchive('Invalid ZIP: '+str(e))
    with z:
        info=z.infolist();names=[f.filename for f in info if not f.is_dir()]
        if len(info)>100 or sum(f.file_size for f in info)>20*1024*1024:raise BadArchive('ZIP exceeds file count or size cap')
        if len(names)!=len(set(names)):raise BadArchive('Duplicate ZIP entries')
        for f in info:
            p=PurePosixPath(f.filename)
            if f.filename.startswith('/') or '\\' in f.filename or '..' in p.parts or (f.external_attr>>16 & 0o170000)==0o120000:
                raise BadArchive('Unsafe ZIP member: '+f.filename)
        if 'manifest.json' not in names:raise BadArchive('Manifest missing')
        try:manifest=json.loads(z.read('manifest.json'))
        except Exception as e:raise BadArchive('Cannot parse manifest: '+str(e))
        m=ZIP_RE.fullmatch(archive.name);v=manifest.get('version','')
        if not m or m.group(1)!=v or manifest.get('project')!='free-lab':raise BadArchive('Filename / version / project mismatch')
        if version_tuple(v)<=version_tuple(last_version()):raise BadArchive('Release is not newer than last deployed v'+last_version())
        files=manifest.get('sha256',{})
        required={'app/backend/app.py','app/backend/db.py','app/backend/providers.py','app/deploy/install.py','app/frontend/index.html',
          'app/frontend/assets/app.js','app/frontend/assets/xr.js','app/frontend/assets/style.css',
          'app/frontend/version.json','app/frontend/changelog.json','app/requirements.txt','app/version.json','app/changelog.json','app/README.md'}
        if not isinstance(files,dict) or not required.issubset(files):raise BadArchive('Missing required application files')
        expected=set(files)|{'manifest.json','watch-free-lab.sh'}
        if set(names)!=expected:raise BadArchive('Unexpected or missing release files: '+str(set(names)^expected))
        if manifest.get('watcher',{}).get('path')!='watch-free-lab.sh':raise BadArchive('Watcher missing from manifest')
        watcher=z.read('watch-free-lab.sh')
        if manifest['watcher'].get('sha256')!=sha(watcher):raise BadArchive('Watcher checksum differs')
        verify_watcher(watcher)
        (stage/'watch-free-lab.sh').write_bytes(watcher)
        for name,expected_digest in files.items():
            p=PurePosixPath(name)
            if (not name.startswith('app/') or len(p.parts)<2 or not re.fullmatch('[A-Za-z0-9_./-]+',name)
                or '__pycache__' in p.parts or name.endswith(('.pyc','.pyo'))):raise BadArchive('Unsafe path '+name)
            if not re.fullmatch('[0-9a-f]{64}',str(expected_digest)):raise BadArchive('Invalid digest '+name)
            content=z.read(name)
            if sha(content)!=expected_digest:raise BadArchive('SHA256 mismatch '+name)
            dest=stage/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content)
        (stage/'manifest.json').write_bytes(z.read('manifest.json'))
        for marker in ('app/version.json','app/frontend/version.json','app/changelog.json','app/frontend/changelog.json'):
            data=json.loads((stage/marker).read_text())
            if data.get('version')!=v:raise BadArchive('Version mismatch: '+marker)
        if f'<meta name="free-lab-version" content="{v}">' not in (stage/'app/frontend/index.html').read_text():raise BadArchive('HTML version marker mismatch')
        if 'ENTER SPATIAL REALITY' not in (stage/'app/frontend/index.html').read_text() or 'id="enterXR"' not in (stage/'app/frontend/index.html').read_text():raise BadArchive('Missing WebXR portal UX')
        if not (stage/'app/frontend/assets/scene.mjs').is_file() or not (stage/'app/backend/secrets.py').is_file():raise BadArchive('Spatial scene or encrypted vault missing')
        for p in (stage/'app').rglob('*.py'):run(['python3','-m','py_compile',p],timeout=15)
        for p in (stage/'app/frontend/assets').glob('*.js'):run(['node','--check',p],timeout=15)
        for p in (stage/'app/frontend/assets').glob('*.mjs'):run(['node','--check',p],timeout=15)
        tested=run(['python3','-m','unittest','discover','-s','tests','-v'],cwd=stage/'app',timeout=75)
        if 'FAILED' in tested.stdout+tested.stderr:raise BadArchive('Local tests failed')
        if 'skipped=' in tested.stderr:say('Flask tests skipped locally; they are mandatory after server pip install','WARN')
        for cache in (stage/'app').rglob('__pycache__'):shutil.rmtree(cache,ignore_errors=True)
        say(f'Checksums, all {len(files)} files, Python, JavaScript and tests passed','PASS')
        return v,manifest

def preflight(stage):
    if not (ROOT/'.git').exists():raise Failure('Place watcher in your Git repository root')
    if run(['git','branch','--show-current'],cwd=ROOT).stdout.strip()!='main':raise Failure('Only main can deploy')
    origin=run(['git','remote','get-url','origin'],cwd=ROOT).stdout.strip()
    if origin not in (REPO,'ssh://git@github.com/sylwesterdigital/free-lab.git'):
        raise Failure('Unexpected Git origin: '+origin)
    changes=run(['git','status','--porcelain=v1','--untracked-files=all'],cwd=ROOT).stdout.splitlines()
    for line in changes:
        name=line[3:]
        if line.startswith('?? ') and (name.startswith(('uploads/','updates/','.free-lab/')) or name=='.DS_Store'):continue
        if name=='watch-free-lab.sh' and not name.startswith(' D') and (ROOT/name).is_file() and (ROOT/name).read_bytes()==(stage/'watch-free-lab.sh').read_bytes():continue
        raise Failure('Local worktree has unrelated modifications. Commit/stash first: '+line)
    remote=run(['git','ls-remote','origin','refs/heads/main'],cwd=ROOT,timeout=65).stdout.strip()
    if remote:
        run(['git','fetch','--no-tags','origin','main'],cwd=ROOT,timeout=65)
        check=run(['git','merge-base','--is-ancestor','FETCH_HEAD','HEAD'],cwd=ROOT,check=False)
        if check.returncode:raise Failure('GitHub main is ahead or diverged: reconcile first')
    if not re.fullmatch('[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+',HOST) or not PORT.isdigit() or not 1<=int(PORT)<=65535:
        raise Failure('Invalid SSH host or port')
    # nginx and TLS already exist at the user's server; do not run certbot or overwrite certificates.
    check=ssh('''test "$(id -u)" -eq 0
     command -v nginx >/dev/null
     command -v python3 >/dev/null
     command -v systemctl >/dev/null
     command -v runuser >/dev/null
     test -r /etc/letsencrypt/live/free-lab.cam/fullchain.pem
     test -r /etc/letsencrypt/live/free-lab.cam/privkey.pem
     nginx -t >/dev/null 2>&1
     python3 -m venv --help >/dev/null 2>&1
     echo SERVER_READY''',timeout=35)
    if 'SERVER_READY' not in check:raise Failure('Ubuntu preflight failed')
    say(f'Git main / GitHub / SSH {HOST}:{PORT} / nginx / TLS / Python ready','PASS')
    # First install needs a password before we deploy, and it never enters ZIP, Git, or logs.
    count=ssh('''if test -f /var/lib/free-lab/free-lab.sqlite3; then
python3 - <<'COUNT'
import sqlite3
try:
 con=sqlite3.connect('file:/var/lib/free-lab/free-lab.sqlite3?mode=ro',uri=True)
 print(con.execute('SELECT count(*) FROM users').fetchone()[0])
except Exception:print(0)
COUNT
else echo 0; fi''')
    return count.strip()=='0'

def first_password():
    if not sys.stderr.isatty():raise Failure('First deployment requires interactive ./watch-free-lab.sh --once for admin password')
    pw=getpass.getpass('First FREE LAB admin password (12+ chars): ')
    if len(pw)<12:raise Failure('Password must have at least 12 characters')
    confirm=getpass.getpass('Confirm password: ')
    if pw!=confirm:raise Failure('Passwords do not match')
    return pw

def deploy(stage,v,pw):
    remote='/var/www/.free-lab-stage-'+re.sub('[^0-9.]','',v)+'-'+secrets.token_hex(6)
    quoted=shlex.quote(remote)
    ssh('mkdir -m 700 -- '+quoted)
    try:
        run(['scp','-r','-P',PORT,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',str(stage/'app'),str(stage/'manifest.json'),HOST+':'+remote+'/'],timeout=190)
        check=ssh('''python3 - <<'VERIFY'
import hashlib,json,pathlib
root=pathlib.Path('''+repr(remote)+''')
m=json.loads((root/'manifest.json').read_text())
for name,digest in m['sha256'].items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise SystemExit('Remote digest mismatch: '+name)
print('REMOTE_DIGEST_OK')
VERIFY''',timeout=50)
        if 'REMOTE_DIGEST_OK' not in check:raise Failure('Remote release verification failed')
        say('Remote staging SHA256 verified','PASS')
        # Bash script passed only over authenticated SSH stdin; never echoed or logged.
        result=ssh('export FREE_LAB_BOOTSTRAP_PASSWORD='+shlex.quote(pw)+'\npython3 '+quoted+'/app/deploy/install.py --stage '+quoted+' --version '+shlex.quote(v),timeout=470)
        for line in result.splitlines():
            if line.startswith(('DEPLOYED','SERVER UNIT','PUBLIC URL','ADMIN ACCOUNT')):say(line,'PASS')
    finally:
        try:ssh('rm -rf -- '+quoted,timeout=30)
        except Exception as e:say('Remote staging cleanup error: '+str(e),'WARN')

def public_get(path):
    req=urllib.request.Request(URL+path+'?verify='+str(int(time.time())),headers={'Cache-Control':'no-cache','User-Agent':'FreeLabRelease/0.1'})
    with urllib.request.urlopen(req,timeout=25) as r:
        if r.status!=200:raise Failure('HTTP '+str(r.status)+' at '+path)
        return r.read(1_000_000)

def verify_public(v):
    header=json.loads(public_get('version.json'))
    health=json.loads(public_get('api/health'))
    home=public_get('').decode('utf-8')
    if header.get('version')!=v or health.get('version')!=v or not health.get('ok') or health.get('storage')!='sqlite':
        raise Failure('Public version / API health did not match')
    if f'<meta name="free-lab-version" content="{v}">' not in home:
        raise Failure('Public HTML is not updated')
    say('Verified public HTTPS frontend + Flask + SQLite at '+URL,'PASS')

def save_local_and_git(stage,v,manifest):
    members=sorted(manifest['sha256'])+['watch-free-lab.sh']
    pre=[]
    for name in members:
        src=stage/name;dest=ROOT/name
        if not src.is_file() or dest.is_symlink():raise Failure('Unsafe local target '+name)
        if dest.exists() and run(['git','ls-files','--error-unmatch','--',name],cwd=ROOT,check=False).returncode!=0:
            # Watcher itself is a special initial new file.
            if name!='watch-free-lab.sh' or dest.read_bytes()!=src.read_bytes():
                raise Failure('Refusing untracked file collision '+name)
        pre.append((src,dest))
    with tempfile.TemporaryDirectory(prefix='free-lab-git-backup-',dir=STATE) as d:
        originals=[]
        for _,dest in pre:
            target=Path(d)/dest.relative_to(ROOT)
            if dest.is_file():
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,target)
                originals.append((dest,target))
            else:originals.append((dest,None))
        committed=False
        try:
            for source,dest in pre:
                dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
            (ROOT/'watch-free-lab.sh').chmod(0o755)
            run(['git','add','--',*members],cwd=ROOT)
            diff=run(['git','diff','--cached','--quiet'],cwd=ROOT,check=False)
            if diff.returncode==1:run(['git','commit','-m','Release FREE LAB v'+v],cwd=ROOT)
            elif diff.returncode:raise Failure('Git staging check failed')
            committed=True
        except Exception:
            if not committed:
                for dest,backup in originals:
                    if backup:shutil.copy2(backup,dest)
                    else:dest.unlink(missing_ok=True)
                run(['git','reset','--quiet','--',*members],cwd=ROOT,check=False)
            raise
    head=run(['git','rev-parse','HEAD'],cwd=ROOT).stdout.strip()
    pushed=run(['git','push','-u','origin','main'],cwd=ROOT,timeout=145,check=False)
    remote=run(['git','ls-remote','origin','refs/heads/main'],cwd=ROOT,timeout=65).stdout
    if not remote.startswith(head+'\t'):raise Failure('Public server is LIVE but GitHub push unverified: '+pushed.stderr[-700:])
    say('GitHub origin/main verified at '+head[:12],'PASS')

def diagnose():
    """Read-only remote startup diagnostics; never print environment files or secrets."""
    script=r'''
echo '=== FREE LAB service ==='
systemctl is-active free-lab || true
systemctl status free-lab --no-pager --lines=18 || true
echo '=== Local API ports ==='
python3 - <<'PORTS'
import json,urllib.request,urllib.error
for port in (8765,18765):
    url=f'http://127.0.0.1:{port}/api/health'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url,timeout=3) as response:
            raw=response.read(1000).decode('utf-8','replace')
            print(port,'HTTP',response.status,raw[:700])
    except Exception as e:print(port,type(e).__name__,str(e)[:300])
PORTS
echo '=== Port listeners ==='
if command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E '(:8765|:18765)' || true; fi
echo '=== Recent FREE LAB service journal ==='
journalctl -u free-lab -n 22 --no-pager -o cat || true
'''
    say('Read-only Ubuntu diagnostics for free-lab service','STEP')
    print(ssh(script,timeout=50))

def mark_deployed(v):
    tmp=STATE/'deployed.json.new'
    tmp.write_text(json.dumps({'version':v,'utc':dt.datetime.now(dt.timezone.utc).isoformat(),'url':URL},indent=2)+'\n')
    os.replace(tmp,STATE/'deployed.json')

def release(file,dry_run):
    with tempfile.TemporaryDirectory(prefix='free-lab-release-',dir=STATE) as dir:
        stage=Path(dir)
        say('[1/4] Validating ZIP, manifest, checksums, syntax, tests','STEP')
        v,manifest=validate(file,stage)
        if dry_run:
            say(f'DRY RUN PASSED v{v}; no Git, SSH, billing or site changes','PASS');return
        say('[2/4] Checking GitHub, SSH, nginx and certificates','STEP')
        new=preflight(stage)
        pw=first_password() if new else ''
        say('[3/4] Deploying and verifying public HTTPS','STEP')
        deploy(stage,v,pw)
        verify_public(v)
        say('[4/4] Applying release source and pushing GitHub main','STEP')
        save_local_and_git(stage,v,manifest)
        mark_deployed(v)
        say(f'RELEASE COMPLETE v{v} — {URL}','PASS')

def main():
    global LOG
    p=argparse.ArgumentParser(description='FREE LAB secure release watcher')
    opts=p.add_mutually_exclusive_group()
    for opt in ('once','dry-run','status','tail','diagnose','rollback'):opts.add_argument('--'+opt,action='store_true')
    p.add_argument('--interval',type=int,default=3)
    args=p.parse_args()
    if args.interval<1:p.error('--interval must be 1+')
    for folder in (UPDATES,UPLOADS,STATE,STATE/'logs',UPDATES/'processed',UPDATES/'rejected'):
        folder.mkdir(parents=True,exist_ok=True)
    STATE.chmod(0o700)
    if args.status:
        say('Watcher '+VERSION+' | last verified '+last_version())
        try:say('Public health: '+str(json.loads(public_get('api/health'))),'PASS')
        except Exception as e:say(str(e),'WARN')
        return 0
    if args.tail:
        logs=sorted((STATE/'logs').glob('*.log'),reverse=True)
        if not logs:say('No logs yet','WARN');return 0
        print('\n'.join(logs[0].read_text().splitlines()[-120:]));return 0
    if args.diagnose:
        diagnose();return 0
    if args.rollback:
        script='python3 /var/www/free-lab.cam/current/deploy/install.py --rollback'
        say(ssh(script,timeout=130),'WARN')
        say('Server rolled back. Git main and SQLite data not rolled back.','WARN')
        return 0
    lock=(STATE/'watch.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise Failure('Watcher already running')
    say('FREE LAB WATCHER v'+VERSION+' active — uploads/ + updates/ → free-lab.cam')
    next_try={}
    while True:
        all_zips=sorted([*UPLOADS.glob('*.zip'),*UPDATES.glob('*.zip')],key=lambda x:x.name)
        known=[(version_tuple(ZIP_RE.fullmatch(f.name).group(1)),f) for f in all_zips if ZIP_RE.fullmatch(f.name)]
        # A failed v0.1.0 archive may remain in uploads/. Never retry it before v0.1.1.
        highest=max((version for version,_ in known),default=None)
        candidate=[f for version,f in known if version==highest] if highest else all_zips
        if (args.once or args.dry_run) and not candidate:
            say('No release ZIP found in uploads/ or updates/','WARN');return 1
        had_error=False
        for f in candidate:
            match=ZIP_RE.fullmatch(f.name)
            if not match:
                say('Ignoring ZIP with unrelated filename: '+f.name,'WARN');continue
            if version_tuple(match.group(1))<=version_tuple(last_version()):
                say('Previously deployed version ignored: '+f.name,'WARN');continue
            if not (args.once or args.dry_run) and (time.time()-f.stat().st_mtime<5 or next_try.get(str(f),0)>time.time()):continue
            stamp=dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            LOG=STATE/'logs'/(stamp+'-'+f.stem+'.log')
            try:
                say('=== RELEASE START '+f.name+' ===','STEP')
                release(f,args.dry_run)
                if not args.dry_run:
                    destination=UPDATES/'processed'/f.name
                    if destination.exists():destination=UPDATES/'processed'/(stamp+'-'+f.name)
                    f.rename(destination)
            except BadArchive as e:
                had_error=True;say('ARCHIVE REJECTED: '+str(e),'FAIL')
                if not args.dry_run:f.rename(UPDATES/'rejected'/f.name)
            except Exception as e:
                had_error=True;say('RELEASE ERROR: '+str(e),'FAIL')
                if not args.dry_run:
                    next_try[str(f)]=time.time()+90
                    say('ZIP retained. Network/deploy can be retried; server may be updated before GitHub.','WARN')
            say('=== RELEASE FINISHED '+f.name+' ===','STEP');LOG=None
        if args.once or args.dry_run:return 1 if had_error else 0
        time.sleep(args.interval)

if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:print('\nWatcher stopped');sys.exit(0)
    except Exception as e:say(str(e),'FAIL');sys.exit(1)
FREE_LAB_WATCH_PY
