"""Encrypted, administrator-managed provider credentials. Never serialize plaintext secrets."""
from __future__ import annotations
import os
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

PROVIDERS={
 'meta': 'Meta Model API (Muse + SAM 3.1)',
 'aholo': 'Aholo Labs (Lux3D + reconstruction)',
 'openai': 'OpenAI API',
 'gemini': 'Google Gemini API',
 'xai': 'xAI / Grok Imagine',
 'meshy': 'Meshy 3D generation',
 'tripo': 'Tripo 3D generation',
 'fal': 'fal.ai model gateway',
 'replicate': 'Replicate model gateway',
 'elevenlabs': 'ElevenLabs text-to-speech',
}

def cipher():
    value=os.environ.get('FREE_LAB_VAULT_KEY')
    if not value:
        file=Path(os.environ.get('FREE_LAB_VAULT_KEY_FILE','/etc/free-lab-vault.key'))
        value=file.read_text(encoding='ascii').strip()
    return Fernet(value.encode('ascii'))

def set_key(con, provider, secret):
    if provider not in PROVIDERS:raise ValueError('Unsupported provider')
    if not isinstance(secret,str) or not 12<=len(secret)<=4096 or any(ord(c)<33 or ord(c)>126 for c in secret):
        raise ValueError('API key must be 12–4096 printable characters without whitespace')
    ciphertext=cipher().encrypt(secret.encode('ascii'))
    with con:
        con.execute("INSERT INTO provider_secrets(provider,ciphertext,updated_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) "
                    'ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at',(provider,ciphertext))

def get_key(con, provider):
    if provider not in PROVIDERS:return None
    row=con.execute('SELECT ciphertext FROM provider_secrets WHERE provider=?',(provider,)).fetchone()
    if not row:return None
    try:return cipher().decrypt(row['ciphertext']).decode('ascii')
    except InvalidToken:raise RuntimeError('The server secret vault key does not match its encrypted database records')

def get_meta_key(con):
    return get_key(con,'meta') or os.environ.get('MODEL_API_KEY','')

def status(con):
    rows=con.execute('SELECT provider,updated_at FROM provider_secrets').fetchall()
    configured={row['provider']:row['updated_at'] for row in rows}
    return [{'provider':pid,'name':name,'configured':pid in configured or (pid=='meta' and bool(os.environ.get('MODEL_API_KEY'))),
             'source':'vault' if pid in configured else ('environment' if pid=='meta' and os.environ.get('MODEL_API_KEY') else 'none'),
             'updated_at':configured.get(pid)} for pid,name in PROVIDERS.items()]

def delete_key(con, provider):
    if provider not in PROVIDERS:raise ValueError('Unsupported provider')
    with con:con.execute('DELETE FROM provider_secrets WHERE provider=?',(provider,))
