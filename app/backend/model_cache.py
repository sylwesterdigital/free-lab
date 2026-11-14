"""Bounded private GLB cache. No arbitrary URL fetch and no redirects.
3D provider download URLs often expire quickly; preserve successful assets per user.
"""
from __future__ import annotations
import os,urllib.request,urllib.error
from pathlib import Path
from . import meshy3d,aholo3d
MAX_MODEL=32_000_000

def store(url,provider,folder:Path,owner:int,jid:int):
    good=(aholo3d.safe_preview_url(url) if provider=='aholo' else meshy3d.safe_file_url(url))
    if not good:raise ValueError('Provider output URL uses an unsupported download host; use the provider link while valid')
    folder.mkdir(parents=True,exist_ok=True)
    name=f'{owner}_{jid}.glb'
    dest=folder/name
    if dest.is_file() and dest.stat().st_size>=20:return name
    request=urllib.request.Request(good,headers={'User-Agent':'FREELAB-3D-PrivateCache/0.10.19'})
    with urllib.request.build_opener(meshy3d.NoRedirect).open(request,timeout=15) as response:
        if response.headers.get('Content-Length') and int(response.headers['Content-Length'])>MAX_MODEL:
            raise ValueError('Generated model exceeds private cache limit of 32 MB')
        raw=response.read(MAX_MODEL+1)
    if len(raw)>MAX_MODEL:raise ValueError('Generated model exceeds 32 MB')
    if len(raw)<20 or raw[:4]!=b'glTF' or int.from_bytes(raw[4:8],'little')!=2 or int.from_bytes(raw[8:12],'little')!=len(raw):
        raise ValueError('Provider download is not a valid GLB 2.0 container')
    temporary=folder/(name+'.tmp-'+os.urandom(5).hex())
    try:
        with temporary.open('xb') as stream:
            os.fchmod(stream.fileno(),0o600)
            stream.write(raw)
        temporary.replace(dest)
    finally:temporary.unlink(missing_ok=True)
    return name
