"""Read-only credential checks. Never invokes a generation/inference endpoint.

No arbitrary hosts or URLs from the browser; all endpoints are allowlisted HTTPS.
Secrets and upstream response bodies are never returned in full or logged.
"""
from __future__ import annotations
import json
import urllib.error
import urllib.request

CHECKS = {
    'meta': ('https://api.meta.ai/v1/models', 'bearer', 'models'),
    'aholo': ('https://api.aholo.ai/global/asset/v1/token', 'raw', 'auth'),
    'meshy': ('https://api.meshy.ai/openapi/v1/balance', 'bearer', 'balance'),
    'openai': ('https://api.openai.com/v1/models', 'bearer', 'models'),
    'gemini': ('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', 'gemini', 'models'),
    'xai': ('https://api.x.ai/v1/models', 'bearer', 'models'),
    'replicate': ('https://api.replicate.com/v1/account', 'bearer', 'account'),
}


def check(provider: str, api_key: str) -> dict:
    if provider not in CHECKS:
        return {'provider': provider, 'verified': False, 'charged': False,
                'message': 'No verified read-only authentication endpoint configured; no request sent.'}
    url, auth, kind = CHECKS[provider]
    if not api_key or not isinstance(api_key, str):
        return {'provider': provider, 'verified': False, 'charged': False, 'message': 'API key is required.'}
    headers = {'Accept': 'application/json', 'User-Agent': 'FreeLab-CredentialCheck/0.3'}
    if auth == 'bearer': headers['Authorization'] = 'Bearer ' + api_key
    elif auth == 'raw': headers['Authorization'] = api_key  # Aholo explicitly forbids Bearer
    elif auth == 'gemini': headers['x-goog-api-key'] = api_key
    request = urllib.request.Request(url, headers=headers, method='GET')
    try:
        # Disable redirect following: never forward a credential to an unknown host.
        opener = urllib.request.build_opener(_NoRedirect)
        with opener.open(request, timeout=12) as res:
            payload = res.read(180_000)
        data = json.loads(payload)
        if not isinstance(data, dict):
            raise ValueError('Unexpected account response')
        result = {'provider': provider, 'verified': True, 'charged': False,
                  'test': 'Read-only authentication/account query. No inference submitted.'}
        if kind == 'balance':
            result['balance'] = {k: data[k] for k in ('balance', 'monthly_credits', 'permanent_credits', 'monthly_resets_at') if k in data}
        elif kind == 'models':
            models = data.get('data', data.get('models', []))
            if isinstance(models, list): result['models_visible'] = len(models)
            if provider == 'meta' and isinstance(models, list):
                result['meta_models'] = [m['id'] for m in models if isinstance(m,dict) and isinstance(m.get('id'),str) and (m['id'].startswith('muse-') or m['id'].startswith('sam-'))][:24]
        elif kind == 'account':
            result['account'] = str(data.get('username') or data.get('type') or 'Authenticated')[:80]
        elif kind == 'auth': result['message'] = 'Aholo issued an asset-upload authorization token; no world/Lux3D job was created.'
        result['balance_available'] = kind == 'balance'
        return result
    except urllib.error.HTTPError as e:
        return {'provider': provider, 'verified': False, 'charged': False, 'http_status': e.code,
                'message': 'Credential check returned HTTP ' + str(e.code)}
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as e:
        return {'provider': provider, 'verified': False, 'charged': False,
                'message': 'Provider unreachable, redirect refused, or invalid JSON. No inference submitted.'}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
