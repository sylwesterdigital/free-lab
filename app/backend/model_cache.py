"""Bounded private GLB cache. No arbitrary URL fetch and no redirects.
3D provider download URLs often expire quickly; preserve successful assets per user.
"""
from __future__ import annotations
import os,urllib.request,urllib.error
from pathlib import Path
from . import meshy3d,aholo3d,tripo3d
MAX_MODEL=64_000_000

def store(url,provider,folder:Path,owner:int,jid:int):
    good=(aholo3d.safe_preview_url(url) if provider=='aholo' else tripo3d.safe_file_url(url,trusted_task=True) if provider=='tripo' else meshy3d.safe_file_url(url) if provider=='meshy' else None)
    if not good:raise ValueError('Provider output URL is missing or invalid; retry the existing task without regeneration')
    # A Tripo model URL is an authenticated task result, not a user request.
    folder.mkdir(parents=True,exist_ok=True)
    name=f'{owner}_{jid}.glb'
    dest=folder/name
    if dest.is_file():
        size=dest.stat().st_size
        with dest.open('rb') as existing:head=existing.read(12)
        if (20<=size<=MAX_MODEL and len(head)==12 and head[:4]==b'glTF'
            and int.from_bytes(head[4:8],'little')==2
            and int.from_bytes(head[8:12],'little')==size):return name
        # An interrupted/invalid cached file is not a successful download.
        dest.unlink(missing_ok=True)
    request=urllib.request.Request(good,headers={'User-Agent':'FREELAB-3D-PrivateCache/0.10.19'})
    with (tripo3d.open_model_download(good,timeout=20) if provider=='tripo'
          else urllib.request.build_opener(meshy3d.NoRedirect).open(request,timeout=15)) as response:
        if response.headers.get('Content-Length') and int(response.headers['Content-Length'])>MAX_MODEL:
            raise ValueError('Generated model exceeds private cache limit of 64 MB')
        raw=response.read(MAX_MODEL+1)
    if len(raw)>MAX_MODEL:raise ValueError('Generated model exceeds 64 MB')
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
