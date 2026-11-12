"""SQLite persistence and account isolation: no external DB required."""
from __future__ import annotations
import hashlib, hmac, os, secrets, sqlite3, time
from pathlib import Path

SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS captures (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 image_name TEXT NOT NULL, sha256 TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
 collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS captures_owner ON captures(owner_id,id DESC);
CREATE TABLE IF NOT EXISTS objects (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT 'manual',
 image_name TEXT, sha256 TEXT, visibility TEXT NOT NULL DEFAULT 'private'
 CHECK(visibility IN ('private','public','link')),
 share_hash TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS objects_owner ON objects(owner_id, id DESC);
CREATE INDEX IF NOT EXISTS objects_share ON objects(share_hash);
CREATE TABLE IF NOT EXISTS inference_calls (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 image_sha256 TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS inference_recent ON inference_calls(created_at);
CREATE TABLE IF NOT EXISTS provider_secrets (
 provider TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (fingerprint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS auth_attempts_recent ON auth_attempts(fingerprint,created_at);
'''

def connect(path):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(str(path),timeout=10,check_same_thread=False)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=5000')
    con.execute('PRAGMA journal_mode=WAL')
    return con

def init(path):
    with connect(path) as con:
        con.executescript(SCHEMA)
        # Non-destructive migration: preserve existing profiles, objects and vault.
        fields={row['name'] for row in con.execute('PRAGMA table_info(inference_calls)')}
        if 'usage_json' not in fields:
            con.execute("ALTER TABLE inference_calls ADD COLUMN usage_json TEXT NOT NULL DEFAULT '{}' ")
        fields={row['name'] for row in con.execute('PRAGMA table_info(objects)')}
        for name,definition in (
            ('capture_id','INTEGER REFERENCES captures(id) ON DELETE SET NULL'),
            ('folder',"TEXT NOT NULL DEFAULT 'Unsorted'"),
            ('shelf',"TEXT NOT NULL DEFAULT 'collection'"),
            ('spatial_json',"TEXT NOT NULL DEFAULT '{}'")):
            if name not in fields:con.execute('ALTER TABLE objects ADD COLUMN '+name+' '+definition)

def hash_password(password, salt=None):
    salt=salt or secrets.token_bytes(16)
    dk=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,600_000)
    return f'pbkdf2_sha256$600000${salt.hex()}${dk.hex()}'

def verify_password(password, stored):
    try:
        _,n,salt,digest=stored.split('$')
        if not (100_000<=int(n)<=1_000_000): return False
        actual=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),bytes.fromhex(salt),int(n))
        return hmac.compare_digest(actual,bytes.fromhex(digest))
    except (ValueError,TypeError,AttributeError): return False

def create_user(con, username, password, display_name=None, role='member'):
    if not (3<=len(username)<=32 and username.replace('_','').replace('-','').isalnum() and username.isascii()):
        raise ValueError('Username must be 3–32 ASCII letters, numbers, _ or -')
    if len(password)<12 or len(password)>256: raise ValueError('Password must be 12–256 characters')
    name=(display_name or username).strip()[:64]
    if not name: raise ValueError('Display name required')
    with con:
        return con.execute('INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,?)',
                           (username,name,hash_password(password),role)).lastrowid

def user_from_id(con,uid):
    return con.execute('SELECT id,username,display_name,role FROM users WHERE id=?',(uid,)).fetchone()

def user_from_name(con,name):
    return con.execute('SELECT * FROM users WHERE username=?',(name,)).fetchone()

def begin_inference(con,uid,digest,provider,daily_cap=24,user_cap=8,cooldown=20):
    """Reserve one paid request in a SQLite IMMEDIATE transaction across processes."""
    con.execute('BEGIN IMMEDIATE')
    try:
        global_day=con.execute("SELECT COUNT(*) FROM inference_calls WHERE julianday(created_at) >= julianday('now') - 1").fetchone()[0]
        user_day=con.execute("SELECT COUNT(*) FROM inference_calls WHERE user_id=? AND julianday(created_at) >= julianday('now') - 1",(uid,)).fetchone()[0]
        recent=con.execute("SELECT COUNT(*) FROM inference_calls WHERE user_id=? AND julianday(created_at) >= julianday('now') - (? / 86400.0)",(uid,cooldown)).fetchone()[0]
        duplicate=con.execute("SELECT COUNT(*) FROM inference_calls WHERE user_id=? AND image_sha256=? AND status='ok'",(uid,digest)).fetchone()[0]
        if duplicate: raise ValueError('This image was already analysed; use the saved record')
        if global_day>=daily_cap or user_day>=user_cap: raise ValueError('Daily inference budget reached')
        if recent: raise ValueError('Wait before making another model request')
        call=con.execute('INSERT INTO inference_calls(user_id,image_sha256,provider,status) VALUES(?,?,?,?)',
                         (uid,digest,provider,'reserved')).lastrowid
        con.commit()
        return call
    except Exception:
        con.rollback()
        raise

def finish_inference(con, call, status, usage=None):
    import json
    values=usage if isinstance(usage,dict) else {}
    # Store token counters, never image content or provider responses.
    safe={k:int(values[k]) for k in ('prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens')
          if k in values and isinstance(values[k],int) and 0<=values[k]<1_000_000_000}
    with con:
        con.execute('UPDATE inference_calls SET status=?, usage_json=? WHERE id=?',(status,json.dumps(safe),call))

