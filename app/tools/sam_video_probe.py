"""Explicitly billed SAM 3.1 MP4 video probe; no background uploads.

Usage:
  python3 -m tools.sam_video_probe --file clip.mp4 --prompt chair --dry-run
  python3 -m tools.sam_video_probe --file clip.mp4 --prompt chair --send

Requires ffprobe from ffmpeg to enforce frame limits before paid inference.
Does not decode SAM mask tokens; exports tracked box summaries only.
"""
from __future__ import annotations
import argparse,json,os,hashlib,re,subprocess,sys,urllib.request,urllib.error,uuid
from pathlib import Path
from backend import sam

def frames(path):
    result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-count_frames',
      '-show_entries','stream=nb_read_frames','-of','default=noprint_wrappers=1:nokey=1',str(path)],
      capture_output=True,text=True,timeout=20,check=True)
    value=result.stdout.strip()
    if not value.isdigit():raise RuntimeError('ffprobe could not count frames; refusing an unbounded billable request')
    return int(value)

def meta_key():
    value=os.getenv('MODEL_API_KEY','')
    if value:return value
    from backend import db, secrets
    database=Path(os.getenv('FREE_LAB_DB','/var/lib/free-lab/free-lab.sqlite3'))
    if not database.is_file():return ''
    con=db.connect(database)
    try:return secrets.get_meta_key(con) or ''
    finally:con.close()

def upload(file,key):
    boundary='free-lab-'+uuid.uuid4().hex
    payload=(('--'+boundary+'\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n'
       +'--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n').encode()
       +file.read_bytes()+('\r\n--'+boundary+'--\r\n').encode())
    req=urllib.request.Request('https://api.meta.ai/v1/files',data=payload,method='POST',headers={
        'Authorization':'Bearer '+key,'Content-Type':'multipart/form-data; boundary='+boundary})
    with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)['id']

def segment(fid,prompt,key):
    data={'model':'sam-3.1','input':[{'type':'message','role':'user','content':[
      {'type':'input_text','text':prompt},{'type':'input_video','file_id':fid}]}],
      'stream':False,'store':False}
    req=urllib.request.Request('https://api.meta.ai/v1/responses',data=json.dumps(data).encode(),method='POST',
      headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=240) as response:result=json.load(response)
    text=result.get('output_text','') or ''.join(str(p.get('text','')) for item in result.get('output',[]) if isinstance(item,dict) for p in item.get('content',[]) if isinstance(p,dict))
    tracks=[]
    for fragment in re.split(r'(?=<\d+f>)',text):
        m=re.match(r'<(\d+)f>',fragment)
        if m:
            matches=sam.parse_boxes(fragment)
            tracks.append({'frame':int(m.group(1)),'boxes':matches})
    return {'model':'sam-3.1','frame_records':tracks,'mask_data_decoded':False,'usage':result.get('usage') or {}}

def main():
    p=argparse.ArgumentParser();p.add_argument('--file',type=Path,required=True);p.add_argument('--prompt',required=True)
    group=p.add_mutually_exclusive_group(required=True);group.add_argument('--send',action='store_true');group.add_argument('--dry-run',action='store_true')
    args=p.parse_args();file=args.file
    if not file.is_file() or file.suffix.lower()!='.mp4' or not 1000<=file.stat().st_size<=6_000_000:
        p.error('Supply a real .mp4 between 1 KB and 6 MB')
    if not re.fullmatch(r'[a-z0-9][a-z0-9 -]{0,58}[a-z0-9]',args.prompt.lower().strip()):p.error('One concrete noun phrase (2–60 chars) required')
    try:count=frames(file)
    except Exception as e:p.error('ffprobe required to verify frame count: '+str(e))
    if count<1 or count>100:p.error('Clip has '+str(count)+' frames; trim/downsample to 100 or fewer before paid inference')
    expected_cost=max(50,count)*0.0002
    print(json.dumps({'frames':count,'minimum_sam_video_cost_usd':round(expected_cost,4),
      'paid_request':args.send,'note':'Additional storage or other model usage not included'},indent=2))
    if args.dry_run:return
    key=meta_key()
    if not key:raise RuntimeError('No Meta Model API key in env or encrypted Ubuntu vault')
    fid=upload(file,key)
    print('Video uploaded; requesting SAM 3.1 with explicit consent.',file=sys.stderr)
    print(json.dumps(segment(fid,args.prompt.lower().strip(),key),indent=2))

if __name__=='__main__':main()
