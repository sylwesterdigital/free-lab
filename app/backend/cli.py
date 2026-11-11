"""Initialize the first profile without exposing public registration."""
import argparse,getpass,os,sys
from . import db

def main():
    p=argparse.ArgumentParser()
    p.add_argument('command',choices=['create-admin','create-user','init'])
    p.add_argument('username',nargs='?')
    a=p.parse_args()
    path=os.getenv('FREE_LAB_DB','./var/free-lab.sqlite3');db.init(path)
    if a.command=='init': print('SQLite ready');return
    if not a.username:raise SystemExit('Username argument required')
    password=os.environ.get('FREE_LAB_BOOTSTRAP_PASSWORD') or getpass.getpass('New password (12+ characters): ')
    with db.connect(path) as con:
        try:db.create_user(con,a.username,password,role='admin' if a.command=='create-admin' else 'member')
        except Exception as exc:raise SystemExit(str(exc))
    print('Created profile:',a.username)
if __name__=='__main__':main()
