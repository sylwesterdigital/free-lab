/* FREELAB Spatial Cloud 0.9.1 — camera and model calls explicitly opt-in. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={user:null,config:null,objects:[],tab:'mine',stream:null,micStream:null,snapshot:null,snapshotOrigin:null,xr:null,sessionKeys:new Map()};
const trace=[];const TRACE_MAX=80;
function traceEvent(message,kind='info'){const entry={at:new Date().toLocaleTimeString(),kind,message:String(message).slice(0,270)};trace.push(entry);if(trace.length>TRACE_MAX)trace.shift();window.dispatchEvent(new CustomEvent('freelab-trace',{detail:entry}));}
function getTrace(){return trace.slice(-25);}
async function serverDiagnostics(){if(state.user?.role!=='admin')return {entries:[],notice:'Server diagnostics require admin. Local request log remains available.'};return api('/admin/diagnostics');}
function pref(name){try{
 const v=localStorage.getItem('freelab-pref-'+name);
 if(name==='mascotMode')return ['2d','3d','none'].includes(v)?v:'3d';
 if(name==='frameHoldSeconds')return [1.5,3,5].includes(Number(v))?Number(v):3;
 if(name==='spoken'&&v===null)return true;
 if(name==='speechVoiceId')return v||'';
 if(name==='speechEngine')return v==='elevenlabs'?'elevenlabs':'browser';
 return v==='true';}catch{return name==='frameHoldSeconds'?3:name==='mascotMode'?'3d':name==='speechEngine'?'browser':name==='speechVoiceId'?'':name==='spoken';}}
function setPref(name,value){try{localStorage.setItem('freelab-pref-'+name,['mascotMode','frameHoldSeconds','speechVoiceId','speechEngine'].includes(name)?String(value):String(Boolean(value)));}catch{}traceEvent(name+' = '+String(value),'setting');}
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
let toastTimer, scanTimer=null, scanBusy=false;
function sessionMeta(){return state.user?.role==='admin' ? state.sessionKeys.get('meta') : null;}
function cameraReport(){if(!state.stream)return 'NO CAMERA · preflight required';const tracks=state.stream.getVideoTracks();const t=tracks[0];const video=$('cameraVideo');if(!t||t.readyState!=='live'||t.muted||!video?.videoWidth)return 'CAMERA MUTED / NO PIXELS · check Quest permission';const set=t.getSettings();return `LIVE ${video.videoWidth}×${video.videoHeight} · ${set.facingMode||'unknown facing'} · ${String(t.label||'unknown source').slice(0,40)}`;}
function notify(msg){traceEvent(msg,'status');const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4400);}
async function api(path,opts={}){
 const init={credentials:'same-origin',...opts,headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}};
 const began=performance.now();let response;
 try{response=await fetch('/api'+path,init);let result={};try{result=await response.json()}catch{}
  const duration=Math.round(performance.now()-began);
  traceEvent(`${opts.method||'GET'} ${path.replace(/\/\d+(?=\/|$)/g,'/:id')} → HTTP ${response.status} (${duration} ms)${result.error?' · '+String(result.error).slice(0,135):''}`,response.ok?'api':'error');
  if(!response.ok){const err=Error(result.error||'HTTP '+response.status);err.status=response.status;
   err.upstreamStatus=result.upstream_status||null;err.providerCode=result.provider_code||'';
   err.retryable=Boolean(result.retryable);err.retryAfter=result.retry_after||null;
   err.providerRequestId=result.request_id||'';throw err;}return result;
 }catch(e){if(!response)traceEvent(`${path.split('?')[0]} · NETWORK ERROR · ${e.message}`,'error');throw e;}
}
async function refresh(){try{const h=await api('/health');$('healthStatus').textContent=h.ok?'System online':'Offline';$('connectionDot').classList.toggle('good',h.ok);state.config=await api('/config');const enabled=state.config.inference_enabled||Boolean(sessionMeta());$('modelStatus').textContent=(enabled?'AI ready · on demand':'AI offline · manual mode');$('modelStatus').previousElementSibling.classList.toggle('good',enabled);}
 catch(e){$('healthStatus').textContent='Disconnected';}}
async function loadObjects(){const path=state.tab==='mine'?'/objects':'/public';const data=await api(path);state.objects=state.tab==='public'?data.objects:data.objects.filter(x=>state.tab==='bin'?x.shelf==='bin':x.shelf!=='bin');renderObjects();}
let galleryItems=[],galleryIndex=0;
async function openGallery(objectId=null){
 const source=(await api('/captures')).captures;
 const objects=(await api('/objects')).objects.filter(o=>o.has_image&&o.shelf!=='bin');
 galleryItems=[];
 for(const cap of source){galleryItems.push({id:'capture:'+cap.id,label:'Capture '+cap.id,url:cap.image_url,detail:'Source photograph'});
  for(const obj of objects.filter(o=>o.capture_id===cap.id))galleryItems.push({id:'object:'+obj.id,label:obj.label,url:'/api/objects/'+obj.id+'/image',detail:'Generation '+(obj.parent_object_id?'child':'first')+' · '+obj.operation});}
 for(const obj of objects.filter(o=>!o.capture_id))galleryItems.push({id:'object:'+obj.id,label:obj.label,url:'/api/objects/'+obj.id+'/image',detail:'Legacy library'});
 if(!galleryItems.length){notify('No saved images');return;}
 const found=galleryItems.findIndex(x=>x.id==='object:'+objectId);galleryIndex=found<0?0:found;
 $('desktopGallery').classList.remove('hidden');renderGallery();
}
function renderGallery(){const item=galleryItems[galleryIndex];if(!item)return;
 $('galleryTitle').textContent=item.label+' · '+(galleryIndex+1)+' / '+galleryItems.length;
 $('galleryImage').src=item.url;$('galleryDetail').textContent=item.detail;
 const strip=$('galleryFilmstrip');strip.replaceChildren();galleryItems.forEach((v,i)=>{const b=document.createElement('button');b.title=v.label;b.className=i===galleryIndex?'selected':'';const img=document.createElement('img');img.loading='lazy';img.src=v.url;b.append(img);b.onclick=()=>{galleryIndex=i;renderGallery();};strip.append(b);});strip.children[galleryIndex]?.scrollIntoView({block:'nearest',inline:'center'});
}
function browseGallery(step){if(!galleryItems.length)return;galleryIndex=(galleryIndex+step+galleryItems.length)%galleryItems.length;renderGallery();}
function renderObjects(){const box=$('items');box.replaceChildren();if(state.tab==='mine'){$('objectCount').textContent=String(state.objects.length);$('objectCounter').textContent=String(state.objects.length).padStart(2,'0');}
 if(!state.objects.length){const e=el('div','empty-state');e.append(el('span','', '◌'),el('strong','',state.tab==='bin'?'Your bin is empty':state.tab==='mine'?'Nothing collected yet':'No public objects yet'),el('p','',state.tab==='bin'?'Objects moved to the virtual bin stay private until permanently deleted.':state.tab==='mine'?'Upload a snapshot, enable camera, or create an entry manually.':'Objects appear here only when their owners publish them.'));box.append(e);return;}
 for(const o of state.objects){const card=el('article','object-card');let img;if(o.has_image){img=el('img','object-photo');img.loading='lazy';img.alt='Collected object';img.src=state.tab==='mine'?'/api/objects/'+o.id+'/image':'/api/objects/'+o.id+'/image';}else img=el('div','object-placeholder','◈');card.append(img);if(o.has_image){img.classList.add('gallery-launch');img.title='Open full-window gallery';img.onclick=()=>openGallery(o.id).catch(e=>notify(e.message));}
 const b=el('div','object-body'),meta=el('div','object-meta');meta.append(el('span','',o.provider==='manual'?'MANUAL':o.provider.toUpperCase()),el('span','',o.visibility.toUpperCase()));b.append(meta,el('h3','',o.label),el('p','',o.description||'Recognized spatial object'));
 if(state.tab==='mine'||state.tab==='bin'){const acts=el('div','object-actions');if(state.tab==='mine')for(const [name,mode] of [['Private','private'],['Public','public'],['Share link','link']]){const btn=el('button','tiny-btn',name);btn.onclick=()=>changeVisibility(o.id,mode);acts.append(btn);}if(state.tab==='mine'){
 const folder=el('button','tiny-btn',o.folder||'Unsorted');folder.title='Cycle collection folder';folder.onclick=()=>cycleFolder(o);acts.append(folder);
 const bin=el('button','tiny-btn','Move to bin');bin.onclick=()=>changeShelf(o.id,'bin');acts.append(bin);
 }else{
 const restore=el('button','tiny-btn','Restore');restore.onclick=()=>changeShelf(o.id,'collection');acts.append(restore);
 const del=el('button','tiny-btn','Permanently delete');del.onclick=()=>removeObject(o.id);acts.append(del);
 }b.append(acts);}else b.append(el('span','small-muted','By '+o.owner));card.append(b);box.append(card);}}
async function changeShelf(id,shelf){try{await api('/objects/'+id,{method:'PATCH',body:JSON.stringify({shelf})});await loadObjects();notify(shelf==='bin'?'Moved to private Bin':'Restored to collection');}catch(e){notify(e.message);}}
async function cycleFolder(o){const folders=['Unsorted','Keep','Room','Objects'];const next=folders[(folders.indexOf(o.folder)+1)%folders.length];try{await api('/objects/'+o.id,{method:'PATCH',body:JSON.stringify({folder:next})});await loadObjects();notify('Folder: '+next);}catch(e){notify(e.message);}}
async function changeVisibility(id,mode){try{const data=await api('/objects/'+id,{method:'PATCH',body:JSON.stringify({visibility:mode})});if(data.share_token){const link=location.origin+'/shared.html?token='+data.share_token;try{await navigator.clipboard.writeText(link);notify('Private share link copied')}catch{prompt('Copy the private share URL',link)}}else notify('Visibility set to '+mode);await loadObjects();}catch(e){notify(e.message);}}
async function removeObject(id){if(!confirm('Delete this object and its snapshot?'))return;try{await api('/objects/'+id,{method:'DELETE'});await loadObjects();notify('Object removed')}catch(e){notify(e.message)}}
async function enableXRCamera(){
 const video=$('cameraVideo');const track=state.stream?.getVideoTracks()[0];
 if(track?.readyState==='live'&&!track.muted){video.classList.remove('hidden');await video.play();if(video.videoWidth)return cameraReport();}
 if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera API unavailable in this browser');
 // Permission requests can fail while immersive. Report the actual browser failure, never fake passthrough pixels.
 const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:960},height:{ideal:720}}});
 try{state.stream=stream;video.srcObject=stream;video.classList.remove('hidden');await video.play();
  if(!video.videoWidth||!video.videoHeight||!stream.getVideoTracks().some(t=>t.readyState==='live'&&!t.muted))throw Error('Camera granted, but no readable frames');
  $('captureEmpty').classList.add('hidden');$('cameraStatus').textContent=cameraReport();$('captureStatus').textContent='Check that frames show the real room: '+cameraReport();
  return cameraReport();
 }catch(e){stream.getTracks().forEach(t=>t.stop());state.stream=null;video.srcObject=null;throw e;}
}
function resumeCamera(){state.snapshot=null;state.snapshotOrigin=null;$('previewImage').classList.add('hidden');$('samOverlay').classList.add('hidden');$('cameraVideo').classList.remove('hidden');$('captureEmpty').classList.add('hidden');$('cameraStatus').textContent=cameraReport();}
async function openCamera(){ $('cameraPanel').classList.remove('hidden');try{await enableXRCamera();}catch(e){$('cameraStatus').textContent='Camera unavailable';$('captureStatus').textContent=`Camera error: ${e.name||'Unknown'} · ${e.message||'Permission or device unavailable'}`;$('captureEmpty').classList.remove('hidden');notify('Camera unavailable: '+(e.message||e.name)+'. Upload an image instead.');}}
function closeCamera(){stopScan();state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;$('cameraVideo').srcObject=null;$('cameraPanel').classList.add('hidden');}
function compress(source){const canvas=$('snapshotCanvas');const w=source.videoWidth||source.naturalWidth||source.width;const h=source.videoHeight||source.naturalHeight||source.height;if(!w||!h)throw Error('Image has no pixels');const scale=Math.min(1,960/Math.max(w,h));canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);canvas.getContext('2d',{alpha:false}).drawImage(source,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/jpeg',0.65);if(data.length>610000) data=canvas.toDataURL('image/jpeg',0.42);if(data.length>610000)throw Error('Image too large; choose a smaller one');state.snapshot=data;state.snapshotOrigin='camera';$('previewImage').src=data;$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureEmpty').classList.add('hidden');$('cameraStatus').textContent='Snapshot ready · private';$('samOverlay')?.classList.add('hidden');return data;}
function snapshot(){if(!state.stream)throw Error('No live camera. Enable camera or upload an image.');$('cameraVideo').classList.remove('hidden');const frame=compress($('cameraVideo'));window.FreeLabSound?.play('shutter');return frame;}
async function submitCapture(recognize){try{if(!state.snapshot){if(state.stream)snapshot();else throw Error('Take or upload a snapshot first');}const label=$('manualLabel').value.trim();if(!recognize&&!label)throw Error('Enter an object name first');
 $('recognize').disabled=true;$('saveManual').disabled=true;notify(recognize?'Sending one image to Meta Muse…':'Saving privately…');const payload={image:state.snapshot,recognize,label,model:$('modelChoice').value};if(recognize&&sessionMeta())payload.session_api_key=sessionMeta();const result=await api('/capture',{method:'POST',body:JSON.stringify(payload)});const tokens=result.usage?.total_tokens??(result.usage?.prompt_tokens||0)+(result.usage?.completion_tokens||0);notify('Saved '+result.ids.length+' object(s)'+(recognize?` · ${tokens} Meta tokens (reported)`:' · no API billed'));if(state.user?.role==='admin')loadUsage().catch(()=>{});state.tab='mine';selectTab('mine');await loadObjects();return true;}
 catch(e){notify(e.message);if(scanTimer&&/limit|wait|quota|Too many/i.test(e.message))stopScan();return false;}finally{$('recognize').disabled=false;$('saveManual').disabled=false;}}
async function saveNameOnly(){const name=$('manualLabel').value.trim();if(!name)throw Error('Enter an object label');await api('/objects',{method:'POST',body:JSON.stringify({label:name})});state.tab='mine';selectTab('mine');await loadObjects();notify('Saved private object');}
function stopScan(){if(scanTimer){clearInterval(scanTimer);scanTimer=null;}$('toggleScan').textContent='Start 20s scan';}
async function scanTick(){if(scanBusy||!state.stream||!state.user||(!state.config?.inference_enabled&&!sessionMeta()))return;
 scanBusy=true;try{snapshot();await submitCapture(true);}catch(e){notify(e.message);stopScan();}finally{scanBusy=false;}}
function toggleScan(){if(scanTimer){stopScan();notify('Live sampling stopped');return;}
 if(!state.stream){notify('Grant camera access first; snapshots cannot be read from XR passthrough alone');return;}
 if(!state.config?.inference_enabled&&!sessionMeta()){notify('Configure the Meta key first');return;}
 $('scanConsent').classList.remove('hidden');}
function startScanConfirmed(){ $('scanConsent').classList.add('hidden');scanTimer=setInterval(scanTick,20000);$('toggleScan').textContent='Stop scan · active';notify('Scan active · one frame every 20 seconds');scanTick();}
async function segmentSnapshot(forcedPrompt=null){try{
 if(!state.snapshot){if(state.stream)snapshot();else throw Error('Take or upload a photo first');}
 const prompt=(forcedPrompt||$('samPrompt').value).trim().toLowerCase();if(prompt.length<2)throw Error('Name one object to find');
 $('segment').disabled=true;notify('One charged SAM 3.1 image request…');
 const payload={image:state.snapshot,prompt,save:true};if(sessionMeta())payload.session_api_key=sessionMeta();const data=await api('/segment',{method:'POST',body:JSON.stringify(payload)});
 const overlay=$('samOverlay');const boxes=data.boxes||[];const width=boxes[0]?.image_size?.[0]||$('snapshotCanvas').width;
 const height=boxes[0]?.image_size?.[1]||$('snapshotCanvas').height;
 overlay.width=width;overlay.height=height;const ctx=overlay.getContext('2d');ctx.clearRect(0,0,width,height);
 ctx.lineWidth=Math.max(3,width/190);ctx.strokeStyle='#c1ffb4';ctx.fillStyle='#cdfdbe';ctx.font=`${Math.max(14,width/55)}px system-ui`;
 for(const found of boxes){const [x1,y1,x2,y2]=found.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.fillText(prompt,x1+5,Math.max(20,y1-7));}
 overlay.classList.remove('hidden');notify(`${boxes.length} SAM box(es) · ${data.saved_ids?.length||0} private crop(s) saved (not mask cutouts).`);state.tab='mine';selectTab('mine');await loadObjects();if(state.user?.role==='admin')loadUsage().catch(()=>{});return boxes.length;
 }catch(e){notify(e.message);return false;}finally{$('segment').disabled=false;}}
async function loadUsage(){if(!state.user)return;const data=await api('/usage');const summary=$('usageSummary');if(!summary)return;summary.textContent=`FREE LAB rolling 24h: ${data.user_last_24h}/${data.user_cap||'unlimited'} requests for this profile · ${data.global_last_24h}/${data.global_cap||'unlimited'} overall. Local SQLite limits only; NOT a billing/spend cap. Set in /etc/free-lab.env on Ubuntu. `+((data.recent||[]).length?`Latest: ${data.recent[0].provider} / ${data.recent[0].status} / ${JSON.stringify(data.recent[0].tokens)}`:'No inference requests yet.');}
const PROVIDER_SAFE_TESTS=new Set(['meta','aholo','meshy','openai','gemini','xai','replicate','elevenlabs']);
const ACTIVE_PROVIDERS=new Set(['meta','aholo','meshy','elevenlabs']);
let providerRows=new Map();
function profileTab(name){
 const valid=state.user?.role==='admin'?['experience','apis','users']:['experience'];
 if(!valid.includes(name))name='experience';
 document.querySelectorAll('[data-profile-tab]').forEach(button=>{const on=button.dataset.profileTab===name;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));});
 document.querySelectorAll('[data-profile-view]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.profileView!==name));
 $('profileScroll').scrollTop=0;
 if(name==='apis')loadProviderList().catch(error=>{$('apiListStatus').textContent=error.message;});
}
function apiRowMessage(id,message,fail=false){const status=providerRows.get(id)?.querySelector('.api-result');if(status){status.textContent=message;status.classList.toggle('error',fail);}else $('apiListStatus').textContent=message;}
async function loadProviderList(){
 if(state.user?.role!=='admin')return;
 const [result,scopes]=await Promise.all([api('/admin/providers'),api('/admin/provider-scopes')]);
 const list=$('providerList');list.replaceChildren();providerRows=new Map();
 const extra=el('details','api-extra');const more=el('summary','', 'Other saved connections · not used by XR');extra.append(more);
 const extraList=el('div','api-extra-list');extra.append(extraList);
 for(const p of result.providers){
  const row=el('section','api-provider-row');row.dataset.provider=p.provider;
  const heading=el('div','api-provider-heading');
  const title=el('div','api-provider-identity');title.append(el('span','api-provider-name',p.name),el('span','api-provider-state'+(p.configured?' configured':''),p.configured?'● Connected':'○ Not connected'));
  const access=el('label','api-provider-access');access.setAttribute('aria-label','Share '+p.name+' with signed-in users');
  const accessLabel=el('span','',scopes.scopes?.[p.provider]?'Shared':'Private');
  const toggle=el('input');toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.checked=Boolean(scopes.scopes?.[p.provider]);toggle.disabled=!p.configured;toggle.title=p.configured?'Allow all signed-in profiles to use this server credential':'Save a server key before sharing';
  access.append(accessLabel,toggle);heading.append(title,access);row.append(heading);
  const controls=el('div','api-provider-controls');const key=el('input','api-provider-key');key.type='password';key.autocomplete='new-password';key.placeholder=p.configured?'Replace key (optional)':'Paste API key';key.setAttribute('aria-label',p.name+' API key');key.maxLength=4096;
  const save=el('button','primary-btn','Save');save.type='button';
  const test=el('button','secondary-btn','Test');test.type='button';test.title=PROVIDER_SAFE_TESTS.has(p.provider)?'Read-only authentication check':'No known safe read-only test; no request will be sent';
  controls.append(key,save,test);
  if(p.source==='vault'){
   const remove=el('button','api-remove-key','Remove');remove.type='button';remove.title='Delete encrypted server key';
   remove.onclick=async()=>{if(!confirm('Remove '+p.name+' key from the server?'))return;remove.disabled=true;try{await api('/admin/providers/'+p.provider,{method:'DELETE'});await loadProviderList();await refresh();}catch(error){remove.disabled=false;apiRowMessage(p.provider,error.message,true);}};controls.append(remove);
  }
  row.append(controls,el('p','api-result'));
  providerRows.set(p.provider,row);(ACTIVE_PROVIDERS.has(p.provider)?list:extraList).append(row);
  save.onclick=async()=>{
   const secret=key.value.trim();if(!secret)return apiRowMessage(p.provider,'Paste a key to save.',true);
   save.disabled=true;apiRowMessage(p.provider,'Saving encrypted key…');
   try{await api('/admin/providers/'+p.provider,{method:'PUT',body:JSON.stringify({api_key:secret})});key.value='';await loadProviderList();await refresh();apiRowMessage(p.provider,'Saved on server.');}
   catch(error){apiRowMessage(p.provider,error.message,true);}finally{save.disabled=false;}
  };
  test.onclick=async()=>{
   test.disabled=true;apiRowMessage(p.provider,'Testing…');
   try{const r=await api('/admin/providers/'+p.provider+'/check',{method:'POST',body:JSON.stringify(key.value.trim()?{api_key:key.value.trim()}:{})});
    const msg=r.verified?'Connected · authentication OK':r.http_status?'Authentication failed (HTTP '+r.http_status+')':r.message||'Unable to verify automatically';
    apiRowMessage(p.provider,msg,!r.verified&&Boolean(r.http_status));
   }catch(error){apiRowMessage(p.provider,error.message,true);}finally{test.disabled=false;}
  };
  toggle.onchange=async()=>{
   toggle.disabled=true;
   try{await api('/admin/provider-scopes/'+p.provider,{method:'PUT',body:JSON.stringify({shared:toggle.checked})});accessLabel.textContent=toggle.checked?'Shared':'Private';apiRowMessage(p.provider,toggle.checked?'Shared with signed-in users.':'Private to admin.');}
   catch(error){toggle.checked=!toggle.checked;apiRowMessage(p.provider,error.message,true);}
   finally{toggle.disabled=false;}
  };
 }
 if(extraList.childElementCount)list.append(extra);
 $('apiListStatus').textContent='';
}
async function xrDiagnostics(){const messages=[];messages.push('Secure context: '+window.isSecureContext);messages.push('WebXR API: '+Boolean(navigator.xr));
 if(navigator.xr)for(const mode of ['immersive-ar','immersive-vr'])try{messages.push(mode+': '+await navigator.xr.isSessionSupported(mode));}catch(e){messages.push(mode+': '+e.name);}
 messages.push('getUserMedia: '+Boolean(navigator.mediaDevices?.getUserMedia));messages.push('camera: '+cameraReport());
 if(navigator.mediaDevices?.enumerateDevices)try{const devices=await navigator.mediaDevices.enumerateDevices();messages.push('Video input devices: '+devices.filter(d=>d.kind==='videoinput').length);devices.filter(d=>d.kind==='videoinput').slice(0,5).forEach((d,i)=>messages.push(' '+(i+1)+'. '+(d.label||'unlabelled, permission needed')));}catch(e){messages.push('enumerateDevices: '+e.name);}
 messages.push('Controller/hand tracking: checked only after entering an XR session.');messages.push('WebXR passthrough does NOT expose a readable camera frame.');
 $('xrDiagnostics').textContent=messages.join('\n');}
function setLibrary(open){const p=$('workspace');p.classList.toggle('hidden',!open);$('toggleLibrary').setAttribute('aria-expanded',String(open));if(open)refresh3DJobs();}

function selectTab(tab){state.tab=tab;document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.dataset.list===tab));}
let currentLog=null;
function logTab(tab){
 const latest=tab==='latest';$('logLatest').classList.toggle('active',latest);$('logHistory').classList.toggle('active',!latest);
 $('logLatest').setAttribute('aria-selected',String(latest));$('logHistory').setAttribute('aria-selected',String(!latest));
 $('logItems').classList.toggle('hidden',!latest);$('logArchive').classList.toggle('hidden',latest);
 $('logTitle').textContent=latest?currentLog?.title||'Release notes':'Past releases';
 $('logDate').textContent=latest?currentLog?.datetime||'':'Browse previous changes';
 document.querySelector('.log-scroll').scrollTop=0;
}
function presentLog(force=false){if(!state.user)return;fetch('/changelog.json',{cache:'no-store'}).then(r=>r.json()).then(log=>{
 const key='free-lab-log:'+state.user.id+':'+log.version;if(!force&&localStorage.getItem(key))return;
 currentLog=log;$('logItems').replaceChildren(...(log.changes||[]).map(x=>el('li','',x)));
 const box=$('logArchive');box.replaceChildren();for(const old of log.history||[]){const entry=el('details','log-history-item'),summary=el('summary','',old.title||old.version),date=el('p','',old.datetime||'');const list=el('ul');list.replaceChildren(...(old.changes||[]).map(x=>el('li','',x)));entry.append(summary,date,list);box.append(entry);}
 if(!box.children.length)box.append(el('p','small-muted','No earlier notes are included with this release.'));
 logTab('latest');$('changelog').classList.remove('hidden');$('changelog').dataset.key=key;}).catch(()=>{});}
function dismissLog(){const key=$('changelog').dataset.key;if(key)localStorage.setItem(key,'seen');$('changelog').classList.add('hidden');}
async function loadAdminProfiles(){
 if(state.user?.role!=='admin')return;const box=$('adminUsers');const data=await api('/admin/profiles');box.replaceChildren();
 for(const u of data.users||[]){const row=el('article','admin-user'),info=el('div'),actions=el('div','admin-user-actions');
  info.append(el('strong','',u.display_name+' · @'+u.username),el('small','',u.role.toUpperCase()+(u.blocked?' · BLOCKED UNTIL '+new Date(u.blocked_until*1000).toLocaleString():' · Active')+' · '+u.created_at));
  const reset=el('button','','Reset password');reset.onclick=async()=>{const pw=prompt('Set a new password (12–256 characters) for @'+u.username+':');if(pw===null)return;if(pw.length<12)return notify('Password needs at least 12 characters');if(!confirm('Reset password for @'+u.username+'? This revokes existing sessions.'))return;try{await api('/admin/profiles/'+u.id+'/password',{method:'PUT',body:JSON.stringify({password:pw})});notify('Password updated');await loadAdminProfiles();}catch(e){notify(e.message);}};actions.append(reset);
  if(u.role!=='admin'){
   const block=el('button','',u.blocked?'Unblock':'Block temporarily');block.onclick=async()=>{let hours=0;if(!u.blocked){const answer=prompt('Block @'+u.username+' for 1, 24 or 168 hours?','24');if(answer===null)return;hours=Number(answer);if(![1,24,168].includes(hours))return notify('Choose 1, 24 or 168 hours');}if(!confirm((hours?'Block':'Unblock')+' @'+u.username+'?'))return;
    try{await api('/admin/profiles/'+u.id+'/block',{method:'PUT',body:JSON.stringify({hours})});await loadAdminProfiles();}catch(e){notify(e.message);}};actions.append(block);
   const remove=el('button','','Remove user');remove.onclick=async()=>{if(!confirm('Permanently remove @'+u.username+' and their saved data? This cannot be undone.'))return;
    try{await api('/admin/profiles/'+u.id,{method:'DELETE'});notify('Account removed');await loadAdminProfiles();}catch(e){notify(e.message);}};actions.append(remove);
  }row.append(info,actions);box.append(row);
 }
}
async function afterAuth(user){state.user=user;
 const initials=(user.display_name||user.username||'ME').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 $('profileInitials').textContent=initials||'ME';
 const portrait=$('profileAvatar');portrait.onload=()=>{portrait.classList.remove('hidden');$('profileInitials').classList.add('hidden');$('settingsAvatar').src=portrait.src;$('settingsAvatar').classList.remove('hidden');$('settingsAvatarInitials').classList.add('hidden');};
 portrait.onerror=()=>{portrait.classList.add('hidden');$('profileInitials').classList.remove('hidden');$('settingsAvatar').classList.add('hidden');$('settingsAvatarInitials').classList.remove('hidden');};
 $('settingsAvatarInitials').textContent=initials||'+';portrait.src='/api/me/avatar?v='+encodeURIComponent(user.id);
$('main').classList.remove('hidden');$('loginView').classList.add('hidden');$('profileSummary').textContent=user.display_name+' · @'+user.username+' · '+user.role;$('adminTools').classList.toggle('hidden',user.role!=='admin');document.querySelectorAll('.admin-tab').forEach(e=>e.classList.toggle('hidden',user.role!=='admin'));await refresh();await loadObjects();presentLog();if(user.role==='admin'){await loadProviderList().catch(e=>notify(e.message));}}
async function init(){
 wirePromptEditor();
 $('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});$('password').value='';await afterAuth(data.user);}catch(error){$('loginError').textContent=error.message;}};
 const m=await api('/me').catch(()=>({user:null}));if(m.user)await afterAuth(m.user);else{await refresh();$('loginView').classList.remove('hidden');}
 $('enterXR').onclick=()=>{window.FreeLabSound?.unlock();window.FreeLabSound?.play('enter');if(!state.user)return notify('Sign in before entering XR');window.FreeLabRooms.chooseXR();};
 $('depthXR')?.addEventListener('click',()=>{if(!state.user)return notify('Sign in before entering XR');window.FreeLabRooms.chooseXR(true);notify('Depth is requested on XR entry. If unsupported or denied, use normal XR instead.');});
 $('toggleLibrary').onclick=()=>setLibrary($('workspace').classList.contains('hidden'));$('refresh3DJobs').onclick=refresh3DJobs;
 $('closeLibrary').onclick=()=>setLibrary(false);$('galleryClose').onclick=()=>$('desktopGallery').classList.add('hidden');$('galleryPrev').onclick=()=>browseGallery(-1);$('galleryNext').onclick=()=>browseGallery(1);let swipeX=null;$('galleryImage').addEventListener('pointerdown',e=>swipeX=e.clientX);$('galleryImage').addEventListener('pointerup',e=>{if(swipeX!==null&&Math.abs(e.clientX-swipeX)>45)browseGallery(e.clientX<swipeX?1:-1);swipeX=null;});document.addEventListener('keydown',e=>{if($('desktopGallery').classList.contains('hidden'))return;if(e.key==='Escape')$('galleryClose').click();else if(e.key==='ArrowLeft')browseGallery(-1);else if(e.key==='ArrowRight')browseGallery(1);});
 document.querySelectorAll('.model-option').forEach(btn=>btn.onclick=()=>{$('modelChoice').value=btn.dataset.model;document.querySelectorAll('.model-option').forEach(b=>b.classList.toggle('selected',b===btn));});
 $('saveUploadCloud')?.addEventListener('click',async()=>{const button=$('saveUploadCloud');button.disabled=true;
  try{if(!state.snapshot)throw Error('Upload an image first');const result=await api('/captures',{method:'POST',body:JSON.stringify({image:state.snapshot})});
   notify('Image saved to Spatial Library · open LIB in XR to explore it');state.snapshotOrigin='upload';}
  catch(e){notify('Cannot save imported image · '+e.message);}finally{button.disabled=false;}});
 document.querySelectorAll('[data-profile-tab]').forEach(button=>button.onclick=()=>{profileTab(button.dataset.profileTab);if(button.dataset.profileTab==='users')loadAdminProfiles().catch(e=>notify(e.message));});
 $('segment').onclick=()=>segmentSnapshot();$('toggleScan').onclick=toggleScan;$('cancelScan').onclick=()=>$('scanConsent').classList.add('hidden');$('confirmScan').onclick=startScanConfirmed;document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScan()});
 $('armXRMic')?.addEventListener('click',async()=>{try{const result=await armMicrophone();notify(result)}catch(e){notify('Mic permission: '+e.message)}});
 for(const name of ['spoken','troll','shareExperimental']){const el=$('pref-'+name);if(el){el.checked=pref(name);el.onchange=()=>setPref(name,el.checked);}}
 const engine=$('pref-speechEngine');if(engine){engine.value=pref('speechEngine');engine.onchange=()=>setPref('speechEngine',engine.value);}
 const voice=$('pref-speechVoiceId');if(voice){voice.value=pref('speechVoiceId');voice.onchange=()=>setPref('speechVoiceId',voice.value.trim());}
 $('loadElevenVoices')?.addEventListener('click',async()=>{const result=$('voiceLookupResult');result.textContent='Checking saved ElevenLabs credential…';try{const data=await loadElevenVoices();const choices=$('pref-speechVoiceId');choices.replaceChildren();choices.append(new Option('Select voice',''));for(const v of data.voices||[])choices.append(new Option(v.name,v.id));choices.value=pref('speechVoiceId');result.textContent=data.voices?.length?'Choose your voice above. Requests are billable when ElevenLabs is enabled.':data.notice||'No voices available';}catch(e){result.textContent=e.message;}});
 const mode=$('pref-mascotMode');if(mode){mode.value=pref('mascotMode');mode.onchange=()=>{setPref('mascotMode',mode.value);if(mode.value==='none')silenceXRVoice();};}
 const hold=$('pref-frameHoldSeconds');if(hold){hold.value=String(pref('frameHoldSeconds'));hold.onchange=()=>setPref('frameHoldSeconds',Number(hold.value));}
 $('cameraButton').onclick=()=>{window.FreeLabSound?.play('capture');openCamera();};$('cameraDiagnostic').onclick=()=>{window.FreeLabSound?.play('ready');$('xrReadiness').classList.remove('hidden');xrDiagnostics()};$('refreshXRReadiness').onclick=xrDiagnostics;$('closeXRReadiness').onclick=()=>$('xrReadiness').classList.add('hidden');$('addNameButton').onclick=()=>{window.FreeLabSound?.play('bloom');$('cameraPanel').classList.remove('hidden');$('manualLabel').focus();};$('closeCamera').onclick=closeCamera;$('takeSnapshot').onclick=()=>{try{snapshot();notify('Snapshot ready')}catch(e){notify(e.message)}};
 $('fileInput').onchange=async e=>{window.FreeLabSound?.play('bloom');const file=e.target.files?.[0];if(!file)return;try{if(file.size>12*1024*1024)throw Error('Please choose an image under 12 MB');const bmp=await createImageBitmap(file);const canvas=$('snapshotCanvas');const scale=Math.min(1,960/Math.max(bmp.width,bmp.height));canvas.width=Math.round(scale*bmp.width);canvas.height=Math.round(scale*bmp.height);canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close();const preview=new Image();preview.src=canvas.toDataURL('image/jpeg',0.65);await preview.decode();$('cameraPanel').classList.remove('hidden');compress(preview);state.snapshotOrigin='upload';window.dispatchEvent(new CustomEvent('freelab-photo-ready'));notify('Image ready — recognize or save manually');}catch(e){notify(e.message)}e.target.value='';};
 $('recognize').onclick=()=>submitCapture(true);$('saveManual').onclick=()=>{if(state.snapshot)submitCapture(false);else saveNameOnly().catch(e=>notify(e.message))};
 document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{selectTab(t.dataset.list);loadObjects().catch(e=>notify(e.message))});
 $('profileAvatarInput').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;
   try{if(file.size>8_000_000)throw Error('Image must be under 8 MB');const bmp=await createImageBitmap(file);
    const cv=document.createElement('canvas');cv.width=cv.height=192;const ctx=cv.getContext('2d');
    const side=Math.min(bmp.width,bmp.height);ctx.drawImage(bmp,(bmp.width-side)/2,(bmp.height-side)/2,side,side,0,0,192,192);bmp.close();
    const data=cv.toDataURL('image/jpeg',.76);await api('/me/avatar',{method:'PUT',body:JSON.stringify({image:data})});
    const portrait=$('profileAvatar');portrait.src='/api/me/avatar?v='+Date.now();notify('Profile picture saved');
   }catch(err){notify('Profile image: '+err.message);}e.target.value='';};
 $('profileButton').onclick=()=>{$('profilePanel').classList.remove('hidden');profileTab(state.user?.role==='admin'?'apis':'experience');};$('closeProfile').onclick=()=>$('profilePanel').classList.add('hidden');
 $('logout').onclick=async()=>{state.sessionKeys.clear();stopScan();closeCamera();await api('/logout',{method:'POST'});location.reload()};
 $('createProfile').onsubmit=async e=>{e.preventDefault();try{await api('/admin/profiles',{method:'POST',body:JSON.stringify({username:$('newUsername').value,display_name:$('newDisplayName').value,password:$('newPassword').value})});e.target.reset();notify('New private profile created');await loadAdminProfiles();}catch(error){notify(error.message)}};
 $('logLatest').onclick=()=>logTab('latest');$('logHistory').onclick=()=>logTab('history');$('showChangelog').onclick=()=>presentLog(true);$('dismissChangelog').onclick=dismissLog;$('continueChangelog').onclick=dismissLog;
}

// Spatial cloud interface: no background inference, all writes are profile-scoped.
async function saveXRFrame(onLocal){
 // XR capture always samples the current live camera, never an earlier uploaded JPEG.
 if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted))snapshot();
 if(!state.snapshot)throw Error('No readable frame. Press the central eye to enable the camera, or upload an image in the desktop view.');
 if(typeof onLocal==='function')onLocal(state.snapshot);
 const r=await api('/captures',{method:'POST',body:JSON.stringify({image:state.snapshot})});
 return {...r,image:state.snapshot};
}
async function createXR3D(cid,oid){
 const payload={capture_id:cid,object_id:oid??null,confirm_paid:true};
 return api('/media/3d',{method:'POST',body:JSON.stringify(payload)});
}
async function checkXR3D(id,refresh=false){return api('/media/3d/'+id+(refresh?'?refresh=1':''));}
async function list3DJobs(){const response=await api('/media/3d');return response.jobs||[];}
async function refresh3DJobs(){
 const panel=$('modelJobs');if(!panel)return;
 panel.replaceChildren();try{
  const response=await api('/media/3d');
  if(!response.jobs.length){panel.append(el('p','small-muted','No 3D jobs yet. Select an image in XR → 3D → Generate.'));return;}
  for(const job of response.jobs){const row=el('div','model-job');
   row.append(el('strong','',`3D · ${job.provider} · ${job.status} · ${job.progress}%`));
   row.append(el('span','small-muted',`Source #${job.capture_id||'-'} · ${job.credits===null?'Credits pending':job.credits+' credits'}`));
   if(job.error)row.append(el('p','small-muted',job.error));
   if(job.glb_url){const a=el('a','tiny-btn','Open / download GLB');a.href=job.glb_url;a.rel='noopener noreferrer';a.target='_blank';row.append(a);
    const renew=el('button','tiny-btn','Renew link');renew.onclick=async()=>{try{await checkXR3D(job.id,true);await refresh3DJobs();}catch(e){notify(e.message)}};row.append(renew);}
   if(!['SUCCEEDED','FAILED','CANCELED'].includes(job.status)){
    const button=el('button','tiny-btn','Check status');button.onclick=async()=>{try{await checkXR3D(job.id);await refresh3DJobs();}catch(e){notify(e.message)}};row.append(button);}
   panel.append(row);
  }
 }catch(e){panel.append(el('p','small-muted','3D jobs unavailable · '+e.message));}
}
async function recognizeXR(cid,objectId=null,cutouts=true){
 if(!objectId&&!state.snapshot)throw Error('Capture an image first');
 const payload={recognize:true,cutouts:Boolean(cutouts),capture_id:cid,model:$('modelChoice').value};
 if(objectId)payload.object_id=objectId;else payload.image=state.snapshot;
 if(sessionMeta())payload.session_api_key=sessionMeta();
 const result=await api('/capture',{method:'POST',body:JSON.stringify(payload)});
 state.tab='mine';selectTab('mine');await loadObjects();
 if(state.user?.role==='admin')loadUsage().catch(()=>{});
 return {items:state.objects.filter(x=>result.ids.includes(x.id)),detections:result.objects,usage:result.usage,cutouts:result.cutouts_saved||0,crops:result.rectangular_crops||0};
}
async function segmentXR(cid,noun,objectId=null,cutouts=true){
 if(!objectId&&!state.snapshot)throw Error('Capture an image first');
 const payload={prompt:noun,save:true,cutouts:Boolean(cutouts),capture_id:cid};
 if(objectId)payload.object_id=objectId;else payload.image=state.snapshot;
 if(sessionMeta())payload.session_api_key=sessionMeta();
 const result=await api('/segment',{method:'POST',body:JSON.stringify(payload)});
 state.tab='mine';selectTab('mine');await loadObjects();
 if(state.user?.role==='admin')loadUsage().catch(()=>{});
 return {items:state.objects.filter(x=>result.saved_ids.includes(x.id)),boxes:result.boxes||[],usage:result.usage};
}
async function useXRFrame(url){
 if(typeof url!=='string')throw Error('Missing stored capture image');
 if(url.startsWith('data:image/jpeg;base64,')){state.snapshot=url;return;}
 const resp=await fetch(url,{credentials:'same-origin'});if(!resp.ok)throw Error('Cannot reload private captured frame');
 const image=await createImageBitmap(await resp.blob());
 try{compress(image);}finally{image.close();}
}
async function listXRClouds(){
 const captures=(await api('/captures')).captures;
 const older=(await api('/objects')).objects.filter(o=>o.capture_id===null);
 if(older.length){
   const first=older.find(o=>o.has_image);
   captures.push({id:0,image_url:first?'/api/objects/'+first.id+'/image':null,objects:older,hidden:false,collapsed:false,legacy:true});
 }
 return captures;
}
async function updateXRObject(id,patch){await api('/objects/'+id,{method:'PATCH',body:JSON.stringify(patch)});}
async function updateXRCloud(id,patch){await api('/captures/'+id,{method:'PATCH',body:JSON.stringify(patch)});}


// Explicit media actions: a text or voice prompt never spends tokens until Apply.
async function promptXR(cid,oid,prompt,mixSources=[]){
 const payload={capture_id:cid,object_id:oid||null,prompt,provider:'meta',kind:'image'};
 if(mixSources.length)payload.mix_sources=mixSources;
 if(sessionMeta())payload.session_api_key=sessionMeta();
 const r=await api('/media/edit',{method:'POST',body:JSON.stringify(payload)});
 if(state.user?.role==='admin')loadUsage().catch(()=>{});
 await loadObjects();return r.object;
}
async function transcribeXR(wavBase64){
 const payload={wav:wavBase64};if(sessionMeta())payload.session_api_key=sessionMeta();
 return (await api('/media/transcribe',{method:'POST',body:JSON.stringify(payload)})).text;
}
async function armMicrophone(){
 const active=state.micStream?.getAudioTracks()?.[0];if(active?.readyState==='live'&&!active.muted)return 'Microphone ready for XR';
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone API not available');
 if(state.micStream){state.micStream.getTracks().forEach(t=>t.stop());state.micStream=null;}
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
 if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());throw Error('No audio input track');}
 state.micStream=stream;traceEvent('Microphone permission ready. No recording underway.');return 'Microphone granted. Dictation will stay inside XR.';
}
function micReady(){return Boolean(state.micStream?.getAudioTracks()?.some(t=>t.readyState==='live'&&!t.muted));}
let recorder=null;
let activeMascotAudio=null;
function silenceXRVoice(){try{window.speechSynthesis?.cancel?.();activeMascotAudio?.pause?.();activeMascotAudio=null;}catch{}}
function speakBrowser(value){try{if(!('speechSynthesis' in window))return;window.speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance(value.slice(0,500));utter.volume=.55;utter.rate=1.09;window.speechSynthesis.speak(utter);}catch(e){traceEvent('System voice: '+e.message,'warn');}}
let lastXRSpeech=0;
function speakUpdate(value){
 if(!pref('spoken')||window.FreeLabXRUI?.read?.().voice===false)return;
 if(window.FreeLabXR?.isRunning?.()){
  if(pref('mascotMode')==='none'||window.FreeLabXRUI?.read?.().mascot===false||window.FreeLabXR?.isListening?.())return;
  if(Date.now()-lastXRSpeech<6000)return;lastXRSpeech=Date.now();
 }
 const phrase=String(value).slice(0,500);
 if(pref('speechEngine')!=='elevenlabs'||!pref('speechVoiceId'))return speakBrowser(phrase);
 // ElevenLabs generates billed speech ONLY after it was explicitly enabled in Settings.
 fetch('/api/media/speak',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Free-Lab':'1'},
   body:JSON.stringify({text:phrase,voice_id:pref('speechVoiceId')})}).then(async response=>{
   if(!response.ok)throw Error('ElevenLabs speech HTTP '+response.status);
   const blob=await response.blob();const url=URL.createObjectURL(blob);const audio=new Audio(url);activeMascotAudio?.pause?.();activeMascotAudio=audio;
   audio.onended=()=>{URL.revokeObjectURL(url);if(activeMascotAudio===audio)activeMascotAudio=null;};audio.onerror=()=>{URL.revokeObjectURL(url);if(activeMascotAudio===audio)activeMascotAudio=null;};
   if(window.FreeLabXR?.isRunning?.()&&pref('mascotMode')==='none'){URL.revokeObjectURL(url);return;}await audio.play();
 }).catch(e=>{traceEvent(e.message+'; falling back to system speech','warn');speakBrowser(phrase);});
}
function startWavPrompt(){
 if(recorder)throw Error('Microphone already recording');
 let cancelled=false,stopped=false,resolveResult,rejectResult,audio,source,proc,zero,analyser,stream,reused,chunks=[],sampleRate=16000;
 const result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
 const stateRecord={elapsed:()=>Date.now()-(stateRecord.started||Date.now()),level:()=>stateRecord.volume||0,
    bands:()=>stateRecord.freq||[0,0,0,0,0,0,0,0,0,0,0,0],
    stop:()=>finish(false),cancel:()=>finish(true),result,started:Date.now(),volume:0,freq:[]};
 recorder=stateRecord;
 async function finish(aborted){
   if(stopped)return result;stopped=true;cancelled=aborted;
   try{proc?.disconnect();source?.disconnect();zero?.disconnect();analyser?.disconnect();if(!reused)stream?.getTracks().forEach(t=>t.stop());await audio?.close().catch(()=>{});
    if(aborted)throw Error('Recording cancelled');
    const total=chunks.reduce((n,x)=>n+x.length,0);if(total<1600)throw Error('No microphone samples recorded');
    const frames=Math.min(total,sampleRate*90),merged=new Float32Array(frames);let off=0;
    for(const c of chunks){if(off>=frames)break;const take=Math.min(c.length,frames-off);merged.set(c.subarray(0,take),off);off+=take;}
    const stride=sampleRate/16000,outSamples=Math.floor(frames/stride),out=new ArrayBuffer(44+outSamples*2),dv=new DataView(out);
    const ss=(n,where)=>{for(let i=0;i<n.length;i++)dv.setUint8(where+i,n.charCodeAt(i));};
    ss('RIFF',0);dv.setUint32(4,36+outSamples*2,true);ss('WAVE',8);ss('fmt ',12);
    dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,16000,true);
    dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);ss('data',36);dv.setUint32(40,outSamples*2,true);
    for(let i=0;i<outSamples;i++){const v=Math.max(-1,Math.min(1,merged[Math.floor(i*stride)]));dv.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
    const bytes=new Uint8Array(out);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    resolveResult(btoa(binary));
   }catch(e){rejectResult(e)}finally{if(recorder===stateRecord)recorder=null;}
   return result;
 }
 (async()=>{try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone unavailable in Quest Browser');
   stream=micReady()?state.micStream:await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true},video:false});
   reused=stream===state.micStream;if(stopped){if(!reused)stream.getTracks().forEach(t=>t.stop());return;}
   audio=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});await audio.resume();
   sampleRate=audio.sampleRate;source=audio.createMediaStreamSource(stream);proc=audio.createScriptProcessor(2048,1,1);
   zero=audio.createGain();zero.gain.value=0;source.connect(proc);proc.connect(zero);zero.connect(audio.destination);analyser=audio.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.7;source.connect(analyser);
   proc.onaudioprocess=e=>{if(stopped)return;const input=e.inputBuffer.getChannelData(0);chunks.push(new Float32Array(input));
     let sq=0;for(let i=0;i<input.length;i++)sq+=input[i]*input[i];const volume=Math.sqrt(sq/input.length);
     stateRecord.volume=stateRecord.volume*.7+volume*.3;const spectral=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(spectral);
     const sections=12;stateRecord.freq=Array.from({length:sections},(_,j)=>{
       const start=Math.floor(j*spectral.length/sections),end=Math.floor((j+1)*spectral.length/sections);let total=0;
       for(let k=start;k<end;k++)total+=spectral[k];return Math.min(1,(total/(end-start))/205);});
     if(Date.now()-stateRecord.started>89500)finish(false);
   };
 }catch(e){if(!stopped){stopped=true;recorder=null;rejectResult(e);}}})();
 return stateRecord;
}
async function recordWavPrompt(durationMs=12000){const rec=startWavPrompt();await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(durationMs,90000))));return rec.stop();}
function currentRecording(){return recorder;}
async function describeXR(cid,oid=null,question='',refresh=false){const payload={capture_id:cid,object_id:oid,question,refresh};if(sessionMeta())payload.session_api_key=sessionMeta();return api('/media/describe',{method:'POST',body:JSON.stringify(payload)});}
async function modelXRPreview(id){return api('/media/3d/'+id+'/preview');}
async function get3DPreference(){return api('/preferences/3d');}
async function save3DPreference(provider){return api('/preferences/3d',{method:'PUT',body:JSON.stringify({provider})});}

async function loadElevenVoices(){return api('/media/voices');}

let pendingPrompt=null;
function closePrompt(){document.getElementById('xrPromptEditor').classList.add('hidden');pendingPrompt=null;}
function openPromptEditor(context,initialText='',onApply=null){
 pendingPrompt={...context,onApply};const modal=document.getElementById('xrPromptEditor');
 document.getElementById('xrPromptTarget').textContent='EDIT '+(context?.label||'SELECTED PHOTO');
 document.getElementById('xrPromptText').value=initialText;
 document.getElementById('xrPromptResult').textContent='Original image will be preserved. One paid image edit is submitted only on Apply.';
 modal.classList.remove('hidden');document.getElementById('xrPromptText').focus();
}
function wirePromptEditor(){
 document.getElementById('xrPromptClose').onclick=closePrompt;
 let promptRecording=null;
 document.getElementById('xrPromptVoice').onclick=async()=>{
  const status=document.getElementById('xrPromptResult'),btn=document.getElementById('xrPromptVoice');
  if(!promptRecording){try{if(!micReady())await armMicrophone();promptRecording=startWavPrompt();btn.textContent='STOP RECORDING';status.textContent='Recording voice… press STOP when finished';}
   catch(e){status.textContent='Microphone: '+e.message;}return;}
  const recording=promptRecording;promptRecording=null;btn.textContent='VOICE';status.textContent='Transcribing with Meta (paid)…';
  try{const wav=await recording.stop();const transcript=await transcribeXR(wav);document.getElementById('xrPromptText').value=transcript;status.textContent='Transcript ready. Press Apply to edit.';}
  catch(e){status.textContent=e.message;}
 };
 document.getElementById('xrPromptApply').onclick=async()=>{
  if(!pendingPrompt)return;const context=pendingPrompt;
  const value=document.getElementById('xrPromptText').value.trim();
  if(value.length<3)return notify('Enter a prompt of at least 3 characters');
  const button=document.getElementById('xrPromptApply');button.disabled=true;
  document.getElementById('xrPromptResult').textContent='Generating one image with Meta…';
  try{const item=await promptXR(context.captureId,context.objectId,value);
    closePrompt();if(context.onApply)await context.onApply(item);notify('Generated image saved privately');}
  catch(e){document.getElementById('xrPromptResult').textContent=e.message;}
  finally{button.disabled=false;}
 };
}

window.FreeLab={silenceXRVoice,api,startWavPrompt,currentRecording,describeXR,modelXRPreview,get3DPreference,save3DPreference,list3DJobs,loadElevenVoices,createXR3D,checkXR3D,refresh3DJobs,enableXRCamera,serverDiagnostics,armMicrophone,micReady,speakUpdate,pref,setPref,traceEvent,getTrace,promptXR,transcribeXR,recordWavPrompt,openPromptEditor,closePrompt,useXRFrame,saveXRFrame,recognizeXR,segmentXR,listXRClouds,updateXRObject,updateXRCloud,openCamera,closeCamera,resumeCamera,snapshot,submitCapture,segmentSnapshot,notify,loadObjects,cameraReport,getState:()=>state};
document.addEventListener('DOMContentLoaded',()=>{window.FreeLabRooms?.init?.();init().catch(e=>notify('Initialization failed: '+e.message));const bloom=$('featureBloom');if(bloom){setTimeout(()=>window.FreeLabSound?.play('arrival'),3000);bloom.querySelectorAll('.feature-seed').forEach(button=>{button.addEventListener('mouseenter',()=>window.FreeLabSound?.hover());button.addEventListener('focus',()=>window.FreeLabSound?.hover());});}});
})();
