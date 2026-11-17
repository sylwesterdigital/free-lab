/* FREELAB Spatial Cloud 0.9.1 — camera and model calls explicitly opt-in. */
(()=>{'use strict';
/* XR_GRAPHICS_BEGIN — browser-local, whitelist-validated graphics preferences. */
(function(){
 const key='freelab-xr-graphics-v1';
 const presets=Object.freeze({
  performance:{scale:.8,antialias:false,foveation:'high'},
  balanced:{scale:1,antialias:true,foveation:'auto'},
  quality:{scale:1.2,antialias:true,foveation:'low'},
  ultra:{scale:1.5,antialias:true,foveation:'off'},
  extreme:{scale:2,antialias:true,foveation:'off'}
 });
 const scales=[.8,1,1.2,1.5,2],foveations=['auto','off','low','medium','high'];
 const defaults={preset:'balanced',...presets.balanced};
 function sanitize(raw){
  if(!raw||typeof raw!=='object')return {...defaults};
  if(Object.hasOwn(presets,raw.preset))return {preset:raw.preset,...presets[raw.preset]};
  if(raw.preset!=='custom')return {...defaults};
  return {preset:'custom',scale:scales.includes(Number(raw.scale))?Number(raw.scale):1,
   antialias:typeof raw.antialias==='boolean'?raw.antialias:true,
   foveation:foveations.includes(raw.foveation)?raw.foveation:'auto'};
 }
 function read(){try{return sanitize(JSON.parse(localStorage.getItem(key)));}catch{return {...defaults};}}
 function save(next){const previous=read();const input={...previous,...next};
  if(Object.hasOwn(presets,next?.preset))Object.assign(input,presets[next.preset]);
  else if(next?.preset==='custom'||['scale','antialias','foveation'].some(k=>Object.hasOwn(next||{},k)))input.preset='custom';
  const value=sanitize(input);try{localStorage.setItem(key,JSON.stringify(value));}catch{}return value;
 }
 function foveationValue(choice){return {off:0,low:1/3,medium:2/3,high:1}[choice];}
 window.FreeLabXRGraphics=Object.freeze({read,save,sanitize,presets,scales,foveations,foveationValue});
})();
/* XR_GRAPHICS_END */
const $=id=>document.getElementById(id);
const state={user:null,config:null,objects:[],models:[],mediaFilter:'all',filterTag:'',tab:'mine',stream:null,micStream:null,snapshot:null,snapshotOrigin:null,xr:null,sessionKeys:new Map()};
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
  if(!response.ok){
   if(response.status===401&&path!=='/login'){
    traceEvent('PRIVATE SESSION EXPIRED · sign in again before using 3D or Collection','error');
    if(state.user){state.user=null;notify('Session expired. Sign in again to access private 3D models.');
     if(!window.FreeLabXR?.isRunning?.()){$('loginView')?.classList.remove('hidden');$('main')?.classList.add('hidden');}}
   }
   const reason=response.status===502||response.status===503?'3D service temporarily unavailable (HTTP '+response.status+'). No new paid request was sent.':null;
   const err=Error(result.error||reason||'HTTP '+response.status);err.status=response.status;
   err.upstreamStatus=result.upstream_status||null;err.providerCode=result.provider_code||'';
   err.retryable=Boolean(result.retryable);err.retryAfter=result.retry_after||null;
   err.providerRequestId=result.request_id||'';throw err;}return result;
 }catch(e){if(!response)traceEvent(`${path.split('?')[0]} · NETWORK ERROR · ${e.message}`,'error');throw e;}
}
async function refresh(){try{const h=await api('/health');$('healthStatus').textContent=h.ok?'System online':'Offline';$('connectionDot').classList.toggle('good',h.ok);state.config=await api('/config');const enabled=state.config.inference_enabled||Boolean(sessionMeta());$('modelStatus').textContent=(enabled?'AI ready · on demand':'AI offline · manual mode');$('modelStatus').previousElementSibling.classList.toggle('good',enabled);}
 catch(e){$('healthStatus').textContent='Disconnected';}}
async function loadObjects(){const path=state.tab==='mine'?'/objects':'/public';const data=await api(path);state.objects=state.tab==='public'?data.objects:data.objects.filter(x=>state.tab==='bin'?x.shelf==='bin':x.shelf!=='bin');renderObjects();}
let galleryItems=[],galleryIndex=0,galleryMetadataRequest=0;
async function openGallery(objectId=null,captureId=null){
 const source=(await api('/captures')).captures;
 const objects=(await api('/objects')).objects.filter(o=>o.has_image&&o.shelf!=='bin');
 galleryItems=[];
 for(const cap of source){galleryItems.push({id:'capture:'+cap.id,cid:cap.id,oid:null,label:'Source '+cap.id,url:cap.image_url,detail:'Source photograph'});
  for(const obj of objects.filter(o=>o.capture_id===cap.id))galleryItems.push({id:'object:'+obj.id,cid:cap.id,oid:obj.id,label:obj.label,url:'/api/objects/'+obj.id+'/image',detail:'Generation '+(obj.parent_object_id?'child':'first')+' · '+obj.operation});}
 for(const obj of objects.filter(o=>!o.capture_id))galleryItems.push({id:'object:'+obj.id,cid:null,oid:obj.id,label:obj.label,url:'/api/objects/'+obj.id+'/image',detail:'Legacy library'});
 if(!galleryItems.length){notify('No saved images');return;}
 const target=captureId?'capture:'+captureId:objectId?'object:'+objectId:null;const found=target?galleryItems.findIndex(x=>x.id===target):-1;galleryIndex=found<0?0:found;
 $('desktopGallery').classList.remove('hidden');renderGallery();
}
function renderGallery(){const item=galleryItems[galleryIndex];if(!item)return;$('galleryComposer').classList.add('hidden');
 $('galleryTitle').textContent=item.label+' · '+(galleryIndex+1)+' / '+galleryItems.length;
 $('galleryImage').src=item.url;$('galleryDetail').textContent=item.detail;
 $('galleryToolMenu').open=false;$('galleryAIStatus').classList.add('hidden');
 void gallerySavedMetadata(item,++galleryMetadataRequest);
 const strip=$('galleryFilmstrip');strip.replaceChildren();
 // Limit DOM and image requests to a narrow filmstrip around the current asset.
 for(let offset=-10;offset<=10;offset++){
  const i=(galleryIndex+offset+galleryItems.length)%galleryItems.length;
  if(galleryItems.length<=21&&(offset<0||offset>=galleryItems.length))continue;
  const v=galleryItems[i],b=el('button',i===galleryIndex?'selected':'');b.type='button';b.title=v.label;
  const img=el('img');img.loading='lazy';img.src=v.url;img.alt=v.label;b.append(img);
  b.onclick=()=>{galleryIndex=i;renderGallery();};strip.append(b);
 }
 strip.querySelector('.selected')?.scrollIntoView({block:'nearest',inline:'center'});
}
async function gallerySavedMetadata(item,marker){
 if(!item.cid)return;
 try{const [notes,jobs]=await Promise.all([
  api('/media/descriptions?capture_id='+item.cid+(item.oid?'&object_id='+item.oid:'')),list3DJobs()]);
  if(marker!==galleryMetadataRequest)return;
  const last=(notes.history||[]).at(-1),job=jobs.find(j=>j.capture_id===item.cid&&(j.object_id||null)===(item.oid||null));
  const status=$('galleryAIStatus');
  if(last||job){status.classList.remove('hidden');status.textContent=last?'Saved description: '+last.answer:
      '3D · '+job.provider+' · '+job.status+(job.error?' · '+job.error:'');}
 }catch(e){traceEvent('Gallery metadata: '+e.message,'warn');}
}
function browseGallery(step){if(!galleryItems.length)return;galleryIndex=(galleryIndex+step+galleryItems.length)%galleryItems.length;renderGallery();}
function archiveImageCard(o){
 const card=el('article','object-card'),open=el('button','object-preview');open.type='button';open.title='Open '+o.label+' in full-size preview';open.setAttribute('aria-label','Open '+o.label);
 if(o.has_image){const img=el('img','object-photo');img.loading='lazy';img.alt='';img.src='/api/objects/'+o.id+'/image';open.append(img);}else open.append(el('div','object-placeholder','◈'));
 const footer=el('span','object-overlay');footer.append(el('strong','',o.label),el('small','',String(o.created_at||'').slice(0,10)+' · IMAGE · '+(o.visibility||'PRIVATE').toUpperCase()));open.append(footer);
 open.onclick=()=>openGallery(o.id).catch(e=>notify(e.message));card.append(open);
 const related=state.models.filter(m=>m.object_id===o.id);
 if(related.length){const badge=el('span','media-relationship-badge',related.length+' linked 3D '+(related.length===1?'model':'models'));card.append(badge);}
 const menu=el('details','object-menu');const summary=el('summary','','⋯');summary.title='Image actions';summary.setAttribute('aria-label','Actions for '+o.label);menu.append(summary);
 const tools=el('div','object-menu-popover');const add=(name,cb)=>{const button=el('button','',name);button.type='button';button.onclick=async()=>{menu.open=false;try{await cb();}catch(e){notify(e.message);}};tools.append(button);};
 add('Full preview',()=>openGallery(o.id));if(o.has_image)add('Download photo',()=>{downloadImage('/api/objects/'+o.id+'/image',o.label);return Promise.resolve();});
 if(state.tab==='mine'){
  add('Private',()=>changeVisibility(o.id,'private'));add('Public',()=>changeVisibility(o.id,'public'));add('Copy share link',()=>changeVisibility(o.id,'link'));
  add('Folder: '+(o.folder||'Unsorted'),()=>cycleFolder(o));add('Move to bin',()=>changeShelf(o.id,'bin'));
 }else if(state.tab==='bin'){add('Restore',()=>changeShelf(o.id,'collection'));add('Delete permanently',()=>removeObject(o.id));}
 else add('Owner: '+o.owner,()=>Promise.resolve());
 menu.append(tools);card.append(menu);return card;
}
function archiveModelCard(job){
 const card=el('article','object-card model-asset-card'),poster=modelJobPoster(job);
 card.append(modelJobThumb(job));const body=el('div','model-asset-body');
 body.append(el('span','media-kind-label','3D MODEL · '+String(job.provider||'').toUpperCase()));
 body.append(el('strong','',`Model #${job.id} · ${job.status} · ${job.progress}%`));
 const context=el('button','model-source-link',job.object_id?'From edited/extracted image #'+job.object_id:'From source capture #'+(job.capture_id||'—'));
 context.type='button';context.title='Open the source image and its branch';context.onclick=()=>openGallery(job.object_id||null,job.object_id?null:job.capture_id).catch(e=>notify(e.message));body.append(context);
 body.append(el('span','small-muted',job.credits===null?'Credits pending':job.credits+' credits'));
 if(job.error)body.append(el('span','small-muted',String(job.error).slice(0,115)));
 const view=el('button','tiny-btn','View in 3D');view.type='button';view.disabled=job.status!=='SUCCEEDED';view.onclick=()=>window.FreeLabModelStage?.open(job.id,false,null,poster||job.source_image_url||'');body.append(view);
 card.append(body);
 const menu=el('details','object-menu');const summary=el('summary','','⋯');summary.title='3D model actions';menu.append(summary);const actions=el('div','object-menu-popover');
 const action=(name,cb)=>{const button=el('button','',name);button.type='button';button.onclick=async()=>{menu.open=false;try{await cb();}catch(e){notify(e.message);}};actions.append(button);};
 action('Open source',()=>openGallery(job.object_id||null,job.object_id?null:job.capture_id));
 action('Inspect 3D pipeline',async()=>{const d=await modelXRDiagnostics(job.id);notify('3D #'+job.id+' · '+d.stage+' · '+d.next_action);});
 if(job.status==='SUCCEEDED')action('Retry XR preview',async()=>{if(await window.FreeLabDialog.confirm('Retry this saved model for Quest? No new paid generation.')){await retryXRPreview(job.id);notify('XR preparation restarted from saved model');}});
 if(job.glb_url){const link=el('a','','Download original GLB');link.href=job.glb_url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);action('Renew link',async()=>{await checkXR3D(job.id,true);await refresh3DJobs();});}
 if(!['SUCCEEDED','FAILED','CANCELED'].includes(job.status))action('Check status',async()=>{await checkXR3D(job.id);await refresh3DJobs();});
 menu.append(actions);card.append(menu);return card;
}
function collectionTags(){
 const tags=new Map();for(const o of state.objects){
  const raw=String(o.label||'').replace(/^Edited(?:\s*\(\d+\))?\s+/i,'').toLowerCase();
  const names=new Set(raw.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu)||[]);
  for(const name of names){if(/^(the|and|with|from|image|photo|object|edited|source|new|extracted|generation|original|this|that|for|lab|capture)$/.test(name))continue;
   tags.set(name,(tags.get(name)||0)+1);}
 }return [...tags].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,24);
}
function collectionFacets(){
 const region=$('collectionTags');if(!region)return;region.replaceChildren();
 const options=collectionTags();if(!options.length){region.append(el('span','facet-empty','Object filters appear as your archive grows.'));return;}
 for(const [name,count] of options){const active=state.filterTag===name,b=el('button','facet-chip'+(active?' active':''),name+' · '+count);
  b.type='button';b.setAttribute('aria-pressed',String(active));b.onclick=()=>{state.filterTag=active?'':name;renderObjects();};region.append(b);}
 if(state.filterTag&&!options.some(([t])=>t===state.filterTag)){const b=el('button','facet-chip active',state.filterTag+' · 0');b.type='button';b.onclick=()=>{state.filterTag='';renderObjects();};region.prepend(b);}
}
function collectionDateOkay(date){const d=String(date||'').slice(0,10),from=$('collectionFrom')?.value||'',to=$('collectionTo')?.value||'';
 return (!from||d>=from)&&(!to||d<=to);
}
function renderObjects(){
 const box=$('items');if(!box)return;box.replaceChildren();if(state.tab==='mine'){$('objectCount').textContent=String(state.objects.length);$('objectCounter').textContent=String(state.objects.length).padStart(2,'0');}
 const mode=state.mediaFilter||'all',term=($('collectionSearch')?.value||'').trim().toLocaleLowerCase(),show3D=state.tab==='mine';
 const objects=state.objects.filter(o=>collectionDateOkay(o.created_at)&&(!state.filterTag||String(o.label||'').toLocaleLowerCase().includes(state.filterTag))&&(!term||[o.label,o.description,o.created_at,o.folder,o.provider,o.visibility,o.operation].join(' ').toLocaleLowerCase().includes(term)));
 const jobs=show3D?state.models.filter(j=>collectionDateOkay(j.created_at)&&(!state.filterTag||String(state.objects.find(o=>o.id===j.object_id)?.label||'').toLocaleLowerCase().includes(state.filterTag))&&(!term||[j.id,j.provider,j.status,j.object_id,j.capture_id,'3D MODEL',state.objects.find(o=>o.id===j.object_id)?.label||''].join(' ').toLocaleLowerCase().includes(term))):[];
 const result=[];
 if(mode!=='3d'){
  const displayed=new Set();
  for(const o of objects){result.push({type:'image',value:o});if(mode!=='images')for(const m of jobs.filter(j=>j.object_id===o.id)){result.push({type:'3d',value:m});displayed.add(m.id);}}
  if(mode==='all')for(const m of jobs){if(!displayed.has(m.id)){result.push({type:'3d',value:m});displayed.add(m.id);}}
 }
 else for(const m of jobs)result.push({type:'3d',value:m});
 const total=mode==='images'?state.objects.length:mode==='3d'?(show3D?state.models.length:0):state.objects.length+(show3D?state.models.length:0);
 $('collectionMatchCount').textContent=result.length+' of '+total;collectionFacets();
 const context=$('archiveMediaContext');if(context)context.textContent=mode==='all'?'Original media and linked 3D generations':mode==='images'?'Image sources, edits and extracted objects':'Generated 3D models with links to their source images';
 document.querySelectorAll('[data-media]').forEach(b=>{const on=b.dataset.media===mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
 if(!result.length){const empty=el('div','empty-state');empty.append(el('strong','',term?'No matching media':mode==='3d'?'No generated 3D models':state.tab==='bin'?'Your bin is empty':'Nothing collected yet'));box.append(empty);return;}
 for(const entry of result)box.append(entry.type==='3d'?archiveModelCard(entry.value):archiveImageCard(entry.value));
}

async function galleryAI(action){const item=galleryItems[galleryIndex];if(!item)return;
 $('galleryToolMenu').open=false;const status=$('galleryAIStatus');status.classList.remove('hidden');
 if(action==='download'){downloadImage(item.url,item.label);status.textContent='Downloading image';return;}
 if(!item.cid){status.textContent='This older image has no source. Import it as a new source to use AI tools.';return;}
 if(['refine','prompt','voice'].includes(action)){
  $('galleryComposer').classList.remove('hidden');$('galleryMode').value=action==='refine'?'refine':'prompt';
  if(action==='refine'&&!$('galleryPromptText').value.trim())$('galleryPromptText').value='Improve image quality, reduce noise and sharpen details while preserving the composition.';
  $('galleryPromptText').focus();status.textContent='Write an instruction below the image and press Send.';return;
 }
 try{if(!await window.FreeLabDialog.confirm(action.toUpperCase()+' may incur a provider charge. Continue?'))return;
  status.classList.add('working');status.textContent=action==='3d'?'Submitting 3D job…':action==='describe'?'Describing image…':'Extracting…';let result;
  if(action==='extract'){result=await recognizeXR(item.cid,item.oid||null,true);status.textContent='Extracted '+(result.items||[]).length+' segments. View in Collection.';}
  else if(action==='describe'){result=await describeXR(item.cid,item.oid||null,'',false);status.textContent='Description saved: '+(result.description||'No description returned');}
  else if(action==='segment'){const noun=await window.FreeLabDialog.input('Name one object to extract (for example: chair).',{title:'Extract named object'});if(!noun?.trim())return;result=await segmentXR(item.cid,noun.trim(),item.oid||null,true);status.textContent='Created '+(result.items||[]).length+' cutouts.';}
  else if(action==='3d'){result=await createXR3D(item.cid,item.oid||null);status.textContent='3D task '+result.id+' queued. Generation continues remotely while you work.';}
 }catch(error){status.textContent='Request failed: '+error.message;}finally{status.classList.remove('working');}
}
async function galleryComposerSubmit(event){event.preventDefault();const item=galleryItems[galleryIndex],text=$('galleryPromptText').value.trim();
 if(!item?.cid||text.length<3)return;
 if(text.length>750){$('galleryAIStatus').textContent='Image edit is limited to 750 characters.';return;}
 if(!await window.FreeLabDialog.confirm('Send this image edit to Meta? A provider charge may apply.'))return;
 const status=$('galleryAIStatus'),button=$('galleryPromptSend');button.disabled=true;status.classList.remove('hidden');status.classList.add('working');status.textContent='Generating image…';
 try{await promptXR(item.cid,item.oid||null,text);status.textContent='Image generated and saved privately. Refresh Collection to inspect it.';$('galleryComposer').classList.add('hidden');await loadObjects();}
 catch(e){status.textContent='Image edit failed: '+e.message;}
 finally{status.classList.remove('working');button.disabled=false;}
}
function downloadImage(url,label='freelab-image'){
 if(typeof url!=='string'||!(url.startsWith('/api/captures/')||url.startsWith('/api/objects/')))throw Error('Only stored FREELAB images can be downloaded');
 const a=document.createElement('a');a.href=url+(url.includes('?')?'&':'?')+'download=1';a.download=(label||'freelab-image').replace(/[^a-z0-9 _-]/gi,'_').slice(0,50)+'.jpg';document.body.append(a);a.click();a.remove();
}
async function changeShelf(id,shelf){try{await api('/objects/'+id,{method:'PATCH',body:JSON.stringify({shelf})});await loadObjects();notify(shelf==='bin'?'Moved to private Bin':'Restored to collection');}catch(e){notify(e.message);}}
async function cycleFolder(o){const folders=['Unsorted','Keep','Room','Objects'];const next=folders[(folders.indexOf(o.folder)+1)%folders.length];try{await api('/objects/'+o.id,{method:'PATCH',body:JSON.stringify({folder:next})});await loadObjects();notify('Folder: '+next);}catch(e){notify(e.message);}}
async function changeVisibility(id,mode){try{const data=await api('/objects/'+id,{method:'PATCH',body:JSON.stringify({visibility:mode})});if(data.share_token){const link=location.origin+'/shared.html?token='+data.share_token;try{await navigator.clipboard.writeText(link);notify('Private share link copied')}catch{await window.FreeLabDialog.copy(link)}}else notify('Visibility set to '+mode);await loadObjects();}catch(e){notify(e.message);}}
async function removeObject(id){if(!await window.FreeLabDialog.confirm('Delete this object and its snapshot?'))return;try{await api('/objects/'+id,{method:'DELETE'});await loadObjects();notify('Object removed')}catch(e){notify(e.message)}}
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
const PROVIDER_SAFE_TESTS=new Set(['meta','aholo','meshy','tripo','openai','gemini','xai','replicate','elevenlabs']);
const ACTIVE_PROVIDERS=new Set(['meta','aholo','meshy','tripo','elevenlabs']);
let providerRows=new Map();
function profileTab(name){
 const valid=state.user?.role==='admin'?['experience','apis','users']:['experience'];
 if(!valid.includes(name))name='experience';
 document.querySelectorAll('[data-profile-tab]').forEach(button=>{const on=button.dataset.profileTab===name;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));});
 document.querySelectorAll('[data-profile-view]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.profileView!==name));
 $('profileScroll').scrollTop=0;
 if(name==='apis')loadProviderList().catch(error=>{$('apiListStatus').textContent=error.message;});
}
async function refresh3DProviderUI(){
 const control=$('profile3DProvider');if(!control)return;
 try{const data=await get3DPreference();control.value=data.selected||data.provider;
  $('profile3DProviderStatus').textContent='Using '+data.provider.toUpperCase()+' · '+(data.available?.[data.provider]?'key available':'API key not available to this profile')+' · paid 3D jobs require separate consent.';
  const other=$('capture3DProvider');if(other){other.value=data.provider;}
  const q=await get3DQuality();$('profile3DQuality').value=q.preset;$('profile3DTexture').value=q.texture_quality;
  $('profile3DXRTexture').value=String(q.xr_texture_edge);
  $('profile3DQualityStatus').textContent='New Tripo jobs: '+q.choices[q.preset].model+' · '+q.choices[q.preset].face_limit.toLocaleString()+' triangles · '+q.texture_quality+' textures. XR preview cap: '+q.xr_texture_edge+' px.';
  const inStudio=$('capture3DQuality');if(inStudio)inStudio.value=q.preset;
 }catch(e){$('profile3DProviderStatus').textContent='Could not load provider preference: '+e.message;}
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
   remove.onclick=async()=>{if(!await window.FreeLabDialog.confirm('Remove '+p.name+' key from the server?'))return;remove.disabled=true;try{await api('/admin/providers/'+p.provider,{method:'DELETE'});await loadProviderList();await refresh();}catch(error){remove.disabled=false;apiRowMessage(p.provider,error.message,true);}};controls.append(remove);
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
    const credits=r.balance&&r.balance.balance!==undefined?' · '+r.balance.balance+' credits available'+(r.balance.frozen?' ('+r.balance.frozen+' reserved)':''):'';
    const msg=r.verified?'Connected · live read-only authentication OK'+credits:r.http_status?'Authentication failed (HTTP '+r.http_status+')':r.message||'Unable to verify automatically';
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

const activityLabels={shapes:'Shape Garden',math:'Number Flow',hands:'Hand Harmony',throw:'Throw Lab',sort:'Shape Sort',chain:'Chain Lab',cubes:'Cube Lab',frames:'Spatial Frames',five:'Five Note',thumbs:'Thumb String'};
const fmtDuration=ms=>ms<60000?Math.round(ms/1000)+' sec':(ms/3600000>=1?(ms/3600000).toFixed(1)+' h':Math.round(ms/60000)+' min');
async function toggleProgress(open){
 $('progressDashboard').classList.toggle('hidden',!open);$('openProgress').setAttribute('aria-expanded',String(open));
 if(open){setLibrary(false);await loadProgress();}
}
async function loadProgress(){const period=$('progressPeriod').value,metrics=$('progressKpis'),bars=$('progressBars'),activities=$('progressActivities'),insight=$('progressInsight');
 $('progressExport').href='/api/agency/export.csv?days='+encodeURIComponent(period);
 $('progressEventsExport').href='/api/agency/events.csv?days='+encodeURIComponent(period);
 metrics.textContent='Loading your private activity history…';bars.replaceChildren();activities.replaceChildren();insight.textContent='';
 try{const data=await api('/agency/dashboard?days='+encodeURIComponent(period)),summary=data.total||{};
  metrics.replaceChildren();for(const [name,value] of [['Sessions',String(summary.sessions||0)],['Total play',fmtDuration(summary.duration_ms||0)],['Free play',fmtDuration(summary.free_ms||0)],['Correct',String(summary.correct||0)],['Points',String(summary.points||0)],['Accuracy',summary.correct+summary.errors?Math.round(summary.correct/(summary.correct+summary.errors)*100)+'%':'—']]){
   const card=el('div','progress-kpi');card.append(el('span','',name),el('strong','',value));metrics.append(card);}
  const metric=$('progressMetric').value,daily=data.daily||[],max=Math.max(metric==='duration_ms'?60000:1,...daily.map(x=>x[metric]||0));
  if(!daily.length)bars.append(el('p','small-muted','No sessions recorded for this period yet. Play an Agency activity to begin collecting data.'));
  else for(const day of daily){const item=el('div','progress-bar-col'),bar=el('div','progress-bar');bar.style.height=Math.max(4,(day[metric]||0)/max*100)+'%';bar.title=day.day+' · '+(metric==='duration_ms'?fmtDuration(day.duration_ms):String(day[metric]||0)+' '+metric.replace('_',' '));item.append(bar,el('span','',day.day.slice(5)));bars.append(item);}
  const maxSessions=Math.max(1,...(data.activities||[]).map(x=>x.sessions));
  if(!data.activities?.length)activities.append(el('p','small-muted','No activity breakdown yet.'));
  else for(const a of data.activities){const row=el('div','progress-activity'),top=el('div','progress-activity-top');top.append(el('span','',activityLabels[a.activity]||a.activity),el('span','',a.sessions+' played · '+fmtDuration(a.duration_ms)));
   const rail=el('div','progress-activity-rail'),fill=el('span');fill.style.width=a.sessions/maxSessions*100+'%';rail.append(fill);row.append(top,rail);activities.append(row);}
  const formatObservation=(r)=>r.attempts?`${r.correct}/${r.attempts} correct · ${Math.round(100*r.correct/r.attempts)}% · mean ${Math.round(r.response_ms/r.attempts)}ms`:'No recorded answers';
  for(const [id,rows,label] of [['progressInputs',data.observation?.inputs||[],'Input'],['progressDayparts',data.observation?.dayparts||[],'Period']]){
   const dest=$(id);dest.replaceChildren();
   if(!rows.some(r=>r.attempts))dest.append(el('p','small-muted','No accepted-answer events recorded yet. This measure starts in v0.10.64.'));
   else for(const row of rows){if(!row.attempts)continue;const box=el('div','progress-stat-row');
    box.append(el('strong','',row.input||row.period||label),el('span','',formatObservation(row)));dest.append(box);}
  }
  const trends=$('progressInputTrend');trends.replaceChildren();
  const observations=data.observation?.by_day||[];
  if(!observations.length)trends.append(el('p','small-muted','No dated input observations yet.'));
  else for(const d of observations.slice(-30)){
   const row=el('div','progress-trend-row'),name=el('span','',d.day.slice(5)+' · '+d.input);
   const accuracy=d.attempts?Math.round(d.correct/d.attempts*100):0;
   const rail=el('div','progress-trend-rail'),bar=el('span');bar.style.width=accuracy+'%';rail.append(bar);
   const detail=el('small','',`${d.correct}/${d.attempts} · ${accuracy}% · ${Math.round(d.response_ms/d.attempts)}ms`);
   row.append(name,rail,detail);trends.append(row);
  }
  const n=Number(summary.sessions||0),active=data.activities?.[0];insight.textContent=n===0?'No baseline yet. This dashboard starts recording with v0.10.64; earlier sessions are not represented.':
   'OBSERVED · '+n+' recorded session'+(n===1?'':'s')+' · '+(active?activityLabels[active.activity]+' was played most often. ':'')+'Comparisons are descriptive; task difficulty and sample size influence scores.';
 }catch(e){metrics.textContent='Progress unavailable · '+e.message;}}
let progressAIComment='';
async function analyseProgress(){
 const consent=$('progressAIConsent'),button=$('progressAIAnalyse'),result=$('progressAIResult');
 if(!consent.checked)return;
 button.disabled=true;result.textContent='Requesting a non-diagnostic observation from Meta…';$('progressAISpeak').disabled=true;
 try{const data=await api('/agency/analyse',{method:'POST',body:JSON.stringify({style:$('progressAIStyle').value,days:$('progressPeriod').value,consent:true})});
  progressAIComment=String(data.comment||'').slice(0,1800);result.textContent=progressAIComment||'No commentary returned';$('progressAISpeak').disabled=!progressAIComment;
 }catch(e){progressAIComment='';result.textContent='Analysis unavailable: '+e.message;}
 finally{button.disabled=!consent.checked;}
}
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
  const reset=el('button','','Reset password');reset.onclick=async()=>{const pw=await window.FreeLabDialog.input('Set a new password (12–256 characters) for @'+u.username+':');if(pw===null)return;if(pw.length<12)return notify('Password needs at least 12 characters');if(!await window.FreeLabDialog.confirm('Reset password for @'+u.username+'? This revokes existing sessions.'))return;try{await api('/admin/profiles/'+u.id+'/password',{method:'PUT',body:JSON.stringify({password:pw})});notify('Password updated');await loadAdminProfiles();}catch(e){notify(e.message);}};actions.append(reset);
  if(u.role!=='admin'){
   const block=el('button','',u.blocked?'Unblock':'Block temporarily');block.onclick=async()=>{let hours=0;if(!u.blocked){const answer=await window.FreeLabDialog.input('Block @'+u.username+' for 1, 24 or 168 hours?','24');if(answer===null)return;hours=Number(answer);if(![1,24,168].includes(hours))return notify('Choose 1, 24 or 168 hours');}if(!await window.FreeLabDialog.confirm((hours?'Block':'Unblock')+' @'+u.username+'?'))return;
    try{await api('/admin/profiles/'+u.id+'/block',{method:'PUT',body:JSON.stringify({hours})});await loadAdminProfiles();}catch(e){notify(e.message);}};actions.append(block);
   const remove=el('button','','Remove user');remove.onclick=async()=>{if(!await window.FreeLabDialog.confirm('Permanently remove @'+u.username+' and their saved data? This cannot be undone.'))return;
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
$('main').classList.remove('hidden');$('loginView').classList.add('hidden');$('profileSummary').textContent=user.display_name+' · @'+user.username+' · '+user.role;$('adminTools').classList.toggle('hidden',user.role!=='admin');document.querySelectorAll('.admin-tab').forEach(e=>e.classList.toggle('hidden',user.role!=='admin'));await refresh();await loadObjects();startBackground3DMonitor();presentLog();if(user.role==='admin'){await loadProviderList().catch(e=>notify(e.message));}}
async function init(){
 wirePromptEditor();
 $('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});$('password').value='';await afterAuth(data.user);}catch(error){$('loginError').textContent=error.message;}};
 const m=await api('/me').catch(()=>({user:null}));if(m.user)await afterAuth(m.user);else{await refresh();$('loginView').classList.remove('hidden');}
 const supportsAR=async()=>{try{return Boolean(navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar'));}catch{return false;}};
 const portalTitle=document.querySelector('.stage-portal>div>strong'),portalMode=document.querySelector('#enterXR .xr-letter strong'),portalHint=document.querySelector('.stage-portal>div>span');
 const updateEntry=async()=>{const canXR=await supportsAR();if(portalMode)portalMode.textContent=canXR?'XR':'3D';if(portalTitle)portalTitle.textContent=canXR?'ENTER SPATIAL REALITY':'ENTER 3D PREVIEW';if(portalHint)portalHint.textContent=canXR?'QUEST · IMMERSIVE AR':'BROWSER · THREE.JS · ORBIT / EXPLORE';$('depthXR').classList.toggle('hidden',!canXR);};void updateEntry();
 $('enterXR').onclick=async()=>{window.FreeLabSound?.unlock();window.FreeLabSound?.play('enter');if(!state.user)return notify('Sign in before entering 3D');if(navigator.xr)window.FreeLabRooms?.chooseXR?.();else window.FreeLabRooms.previewLocal().catch(e=>notify('3D preview: '+e.message));};
 $('depthXR')?.addEventListener('click',()=>{if(!state.user)return notify('Sign in before entering XR');if(navigator.xr)window.FreeLabRooms?.chooseXR?.(true);else window.FreeLabRooms.previewLocal().catch(e=>notify('3D preview: '+e.message));});
 document.querySelectorAll('[data-media]').forEach(button=>button.onclick=()=>{state.mediaFilter=button.dataset.media;renderObjects();});$('collectionSearch').addEventListener('input',renderObjects);$('galleryComposer').onsubmit=galleryComposerSubmit;document.querySelectorAll('[data-gallery-action]').forEach(b=>b.onclick=()=>void galleryAI(b.dataset.galleryAction));$('toggleLibrary').onclick=()=>setLibrary($('workspace').classList.contains('hidden'));$('refresh3DJobs').onclick=refresh3DJobs;
 for(const id of ['collectionFrom','collectionTo'])$(id).addEventListener('change',renderObjects);
 $('collectionClear').onclick=()=>{$('collectionSearch').value='';$('collectionFrom').value='';$('collectionTo').value='';state.filterTag='';renderObjects();};
 $('openProgress').onclick=()=>void toggleProgress(true);
 $('closeProgress').onclick=()=>void toggleProgress(false);
 $('progressPeriod').onchange=()=>void loadProgress();$('progressMetric').onchange=()=>void loadProgress();
 $('progressAIConsent').onchange=()=>{$('progressAIAnalyse').disabled=!$('progressAIConsent').checked;};
 $('progressAIAnalyse').onclick=()=>void analyseProgress();
 $('progressAISpeak').onclick=()=>{if(!progressAIComment)return;window.FreeLab.speakUpdate(progressAIComment.slice(0,500));
  if(!pref('spoken'))notify('Enable spoken updates in Settings to hear the mascot.');};

 $('closeLibrary').onclick=()=>setLibrary(false);$('galleryClose').onclick=()=>$('desktopGallery').classList.add('hidden');$('galleryPrev').onclick=()=>browseGallery(-1);$('galleryNext').onclick=()=>browseGallery(1);let swipeX=null;$('galleryImage').addEventListener('touchstart',e=>{swipeX=e.changedTouches[0].clientX;},{passive:true});$('galleryImage').addEventListener('touchend',e=>{if(swipeX!==null&&Math.abs(e.changedTouches[0].clientX-swipeX)>35)browseGallery(e.changedTouches[0].clientX<swipeX?1:-1);swipeX=null;},{passive:true});document.addEventListener('keydown',e=>{if($('desktopGallery').classList.contains('hidden'))return;if(e.key==='Escape')$('galleryClose').click();else if(e.key==='ArrowLeft')browseGallery(-1);else if(e.key==='ArrowRight')browseGallery(1);});
 document.querySelectorAll('.model-option').forEach(btn=>btn.onclick=()=>{$('modelChoice').value=btn.dataset.model;document.querySelectorAll('.model-option').forEach(b=>b.classList.toggle('selected',b===btn));});
 $('saveUploadCloud')?.addEventListener('click',async()=>{const button=$('saveUploadCloud');button.disabled=true;
  try{if(!state.snapshot)throw Error('Upload an image first');const result=await api('/captures',{method:'POST',body:JSON.stringify({image:state.snapshot})});
   notify('Image saved to Spatial Library · open LIB in XR to explore it');state.snapshotOrigin='upload';}
  catch(e){notify('Cannot save imported image · '+e.message);}finally{button.disabled=false;}});
 document.querySelectorAll('[data-profile-tab]').forEach(button=>button.onclick=()=>{profileTab(button.dataset.profileTab);if(button.dataset.profileTab==='users')loadAdminProfiles().catch(e=>notify(e.message));});
 $('segment').onclick=()=>segmentSnapshot();$('toggleScan').onclick=toggleScan;$('cancelScan').onclick=()=>$('scanConsent').classList.add('hidden');$('confirmScan').onclick=startScanConfirmed;document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScan()});
 $('armXRMic')?.addEventListener('click',async()=>{try{const result=await armMicrophone();notify(result)}catch(e){notify('Mic permission: '+e.message)}});
 for(const name of ['spoken','troll','shareExperimental','voiceConfirm']){const el=$('pref-'+name);if(el){el.checked=pref(name);el.onchange=()=>setPref(name,el.checked);}}
 const engine=$('pref-speechEngine');if(engine){engine.value=pref('speechEngine');engine.onchange=()=>setPref('speechEngine',engine.value);}
 const voice=$('pref-speechVoiceId');if(voice){voice.value=pref('speechVoiceId');voice.onchange=()=>setPref('speechVoiceId',voice.value.trim());}
 $('loadElevenVoices')?.addEventListener('click',async()=>{const result=$('voiceLookupResult');result.textContent='Checking saved ElevenLabs credential…';try{const data=await loadElevenVoices();const choices=$('pref-speechVoiceId');choices.replaceChildren();choices.append(new Option('Select voice',''));for(const v of data.voices||[])choices.append(new Option(v.name,v.id));choices.value=pref('speechVoiceId');result.textContent=data.voices?.length?'Choose your voice above. Requests are billable when ElevenLabs is enabled.':data.notice||'No voices available';}catch(e){result.textContent=e.message;}});
 const mode=$('pref-mascotMode');if(mode){mode.value=pref('mascotMode');mode.onchange=()=>{setPref('mascotMode',mode.value);if(mode.value==='none')silenceXRVoice();};}
 const hold=$('pref-frameHoldSeconds');if(hold){hold.value=String(pref('frameHoldSeconds'));hold.onchange=()=>setPref('frameHoldSeconds',Number(hold.value));}
 // XR GPU rendering is distinct from billable 3D model-generation quality.
 const graphics=window.FreeLabXRGraphics;
 const graphicsControls={preset:$('xrGraphicsPreset'),scale:$('xrGraphicsScale'),antialias:$('xrGraphicsAA'),foveation:$('xrGraphicsFoveation')};
 function graphicsStatus(message){const status=$('xrGraphicsStatus');if(status)status.textContent=message;}
 function paintGraphics(message){const q=graphics.read();for(const [key,control] of Object.entries(graphicsControls)){
  if(control)control.value=String(q[key]);}
  graphicsStatus(message||'Saved on this device. Render scale '+q.scale.toFixed(1)+'× · antialiasing '+(q.antialias?'on':'off')+' · foveation '+q.foveation+'. Re-enter XR to apply resolution and antialiasing.');
 }
 graphicsControls.preset.onchange=()=>{const q=graphics.save({preset:graphicsControls.preset.value});paintGraphics('Saved '+q.preset+' preset. Re-enter XR to apply resolution and antialiasing.');};
 for(const key of ['scale','antialias','foveation'])graphicsControls[key].onchange=()=>{
  const raw=graphicsControls[key].value;const q=graphics.save({[key]:key==='scale'?Number(raw):key==='antialias'?raw==='true':raw});
  if(key==='foveation')window.FreeLabXR?.applyGraphicsFoveation?.(q.foveation);
  paintGraphics('Custom settings saved. '+(key==='foveation'?'Foveation applied live when supported; other changes need XR re-entry.':'Re-enter XR to apply resolution or antialiasing.'));
 };
 $('xrGraphicsReset').onclick=()=>{graphics.save({preset:'balanced'});window.FreeLabXR?.applyGraphicsFoveation?.('auto');paintGraphics('Balanced preset saved. Re-enter XR to apply.');};
 $('xrGraphicsInspect').onclick=()=>{
  const info=window.FreeLabXR?.getGraphicsDiagnostics?.();if(!info?.active)return graphicsStatus('XR not active. Start an immersive session to inspect the actual framebuffer and antialiasing.');
  graphicsStatus('Active XR framebuffer: '+info.framebufferWidth+' × '+info.framebufferHeight+' px · AA '+(info.antialias?'on':'off')+' · foveation '+info.foveation+' · requested scale '+info.appliedScale+'×'+(info.fallback?' (fallback after allocation failure)':'')+'. Browser/device may cap requested resolution.');
 };
 paintGraphics();

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
 let pendingAvatarFile=null,avatarPoll=null;
 const fmtAvatar=n=>(n/1_000_000).toFixed(2)+' MB';
 const setAvatarStatus=(m,working=false)=>{const node=$('profile3DAvatarStatus');node.textContent=m;node.classList.toggle('working',working);};
 async function encodeAvatar(file){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16000)binary+=String.fromCharCode(...bytes.subarray(i,i+16000));return 'data:model/gltf-binary;base64,'+btoa(binary);}
 async function watchAvatarJob(id){clearTimeout(avatarPoll);try{const job=await api('/me/avatar-3d/optimize/'+id);
   if(job.status==='SUCCEEDED'){setAvatarStatus('Optimized to '+fmtAvatar(job.result_size)+' · saved for XR. Preview avatar to inspect.');pendingAvatarFile=null;$('profile3DAvatarOptimize').classList.add('hidden');return;}
   if(job.status==='FAILED'){setAvatarStatus('Optimization unsuccessful: '+job.error+' · original model was not replaced.');return;}
   setAvatarStatus('Blender '+job.status.toLowerCase()+' · '+fmtAvatar(job.original_size)+' → target 4.00 MB. Continue using FREELAB while it works.',true);
   avatarPoll=setTimeout(()=>watchAvatarJob(id),6000);
  }catch(err){setAvatarStatus('Optimization status unavailable: '+err.message);}}
 $('profile3DAvatarInput').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;event.target.value='';
  if(file.size>16_000_000||file.size<20||!file.name.toLowerCase().endsWith('.glb')){setAvatarStatus('Choose a GLB between 20 bytes and 16 MB.');return;}
  pendingAvatarFile=file;$('profile3DAvatarOptimize').classList.toggle('hidden',file.size<=4_000_000);
  if(file.size>4_000_000){setAvatarStatus('Local preview only · '+fmtAvatar(file.size)+' · '+fmtAvatar(file.size-4_000_000)+' reduction needed for XR. Select Optimize for XR or reduce it yourself.');window.FreeLabModelStage?.openLocal(file);return;}
  setAvatarStatus('Uploading '+fmtAvatar(file.size)+' GLB…',true);
  try{const data=await encodeAvatar(file);const reply=await api('/me/avatar-3d',{method:'PUT',body:JSON.stringify({glb:data})});
   pendingAvatarFile=null;setAvatarStatus('3D avatar saved · '+fmtAvatar(reply.bytes)+' (XR-ready).');}
  catch(err){setAvatarStatus('3D avatar upload failed: '+err.message);}
 };
 $('profile3DAvatarOptimize').onclick=async()=>{const file=pendingAvatarFile;if(!file)return;
  const ok=await window.FreeLabDialog.confirm('Optimize this '+fmtAvatar(file.size)+' GLB to a 4 MB XR-ready avatar using the server Blender worker? Geometry or texture quality may be reduced.',{title:'Optimize avatar',ok:'Optimize'});if(!ok)return;
  setAvatarStatus('Uploading private GLB to Blender optimization queue…',true);
  try{const data=await encodeAvatar(file);const result=await api('/me/avatar-3d/optimize',{method:'POST',body:JSON.stringify({glb:data})});watchAvatarJob(result.id);}
  catch(err){setAvatarStatus('Optimization could not begin: '+err.message);}
 };
 $('profile3DAvatarPreview').onclick=()=>pendingAvatarFile?window.FreeLabModelStage?.openLocal(pendingAvatarFile):window.FreeLabModelStage?.open(null,true);
 $('profile3DAvatarRemove').onclick=async()=>{if(!await window.FreeLabDialog.confirm('Remove your 3D avatar?'))return;
   try{await api('/me/avatar-3d',{method:'DELETE'});$('profile3DAvatarStatus').textContent='3D avatar removed.';}
   catch(err){$('profile3DAvatarStatus').textContent=err.message;}};
 $('profileButton').onclick=()=>{$('profilePanel').classList.remove('hidden');profileTab(state.user?.role==='admin'?'apis':'experience');void refresh3DProviderUI();};$('profile3DProvider').onchange=async()=>{const chosen=$('profile3DProvider').value;try{await save3DPreference(chosen);await refresh3DProviderUI();notify('3D provider changed to '+chosen.toUpperCase());}catch(e){notify(e.message);await refresh3DProviderUI();}};for(const field of ['profile3DQuality','profile3DTexture','profile3DXRTexture'])$(field).onchange=async()=>{
  const prefs={preset:$('profile3DQuality').value,texture_quality:$('profile3DTexture').value,xr_texture_edge:Number($('profile3DXRTexture').value)};
  try{await save3DQuality(prefs);await refresh3DProviderUI();notify('3D quality saved for new jobs');}catch(e){notify(e.message);}
 };$('closeProfile').onclick=()=>$('profilePanel').classList.add('hidden');
 $('logout').onclick=async()=>{state.sessionKeys.clear();stopScan();closeCamera();await api('/logout',{method:'POST'});location.reload()};
 $('createProfile').onsubmit=async e=>{e.preventDefault();try{await api('/admin/profiles',{method:'POST',body:JSON.stringify({username:$('newUsername').value,display_name:$('newDisplayName').value,password:$('newPassword').value})});e.target.reset();notify('New private profile created');await loadAdminProfiles();}catch(error){notify(error.message)}};
 $('logLatest').onclick=()=>logTab('latest');$('logHistory').onclick=()=>logTab('history');$('showChangelog').onclick=()=>presentLog(true);$('dismissChangelog').onclick=dismissLog;$('continueChangelog').onclick=dismissLog;
}

// Spatial cloud interface: no background inference, all writes are profile-scoped.
function cameraFrameReady(){const v=$('cameraVideo'),track=state.stream?.getVideoTracks?.()[0];return Boolean(track&&track.readyState==='live'&&!track.muted&&v?.videoWidth&&v?.videoHeight);}
function captureXRFrame(crop){
 if(!cameraFrameReady())throw Error('Quest Browser has no readable camera video; passthrough alone does not grant image access');
 const video=$('cameraVideo'),bounds=window.FreeLabFramePhoto?.cropRect(crop,video.videoWidth,video.videoHeight);
 if(!bounds)throw Error('Invalid projected frame crop');
 const canvas=document.createElement('canvas'),ratio=bounds.sw/bounds.sh;
 canvas.width=Math.max(96,Math.min(768,Math.round(bounds.sw)));
 canvas.height=Math.max(64,Math.min(768,Math.round(canvas.width/ratio)));
 canvas.getContext('2d',{alpha:false}).drawImage(video,bounds.sx,bounds.sy,bounds.sw,bounds.sh,0,0,canvas.width,canvas.height);
 let image=canvas.toDataURL('image/jpeg',.76);
 if(image.length>610000)image=canvas.toDataURL('image/jpeg',.51);
 if(image.length>610000)throw Error('Cropped camera frame exceeds image limit');
 return image;
}
async function saveXRFrame(options=null){
 // A caller may pass already captured JPEG pixels, so drawing inside the
 // spatial frame never waits for upload or captures a later camera frame.
 const crop=options&&typeof options==='object'&&Number.isFinite(options.width)?options:null;
 const prepared=options&&typeof options.image==='string'&&options.image.startsWith('data:image/jpeg;base64,')?options.image:null;
 let image=prepared;
 if(!image&&crop)image=captureXRFrame(crop);
 if(!image){if(cameraFrameReady())snapshot();if(!state.snapshot)throw Error('No readable frame. Enable camera outside XR first.');image=state.snapshot;}
 if(typeof options==='function')options(image);
 const r=await api('/captures',{method:'POST',body:JSON.stringify({image})});
 return {...r,image};
}
async function createXR3D(cid,oid,prompt='',preset=null){
 const payload={capture_id:cid,object_id:oid??null,confirm_paid:true};if(prompt.trim())payload.prompt=prompt.trim();if(preset)payload.quality_preset=preset;
 return api('/media/3d',{method:'POST',body:JSON.stringify(payload)});
}
async function checkXR3D(id,refresh=false){return api('/media/3d/'+id+(refresh?'?refresh=1':''));}
async function list3DJobs(){const response=await api('/media/3d');return response.jobs||[];}
function modelJobPoster(job){return job.thumbnail_url||job.source_image_url||'';}
function modelJobThumb(job){
 const button=el('button','model-job-thumb');button.type='button';button.title='Open 3D preview';button.setAttribute('aria-label','Open 3D preview for job '+job.id);
 const poster=modelJobPoster(job);
 if(poster){const img=el('img');img.loading='lazy';img.alt='';img.src=poster;img.onerror=()=>{if(job.source_image_url&&!img.dataset.fallback){img.dataset.fallback='1';img.src=job.source_image_url;}else{button.classList.add('empty');img.remove();button.append(el('span','',job.status==='SUCCEEDED'?'3D':'…'));}};button.append(img);}
 else{button.classList.add('empty');button.append(el('span','',job.status==='SUCCEEDED'?'3D':'…'));}
 if(job.status==='SUCCEEDED')button.onclick=()=>window.FreeLabModelStage?.open(job.id,false,null,poster||job.source_image_url||'');
 else button.disabled=true;
 return button;
}
async function refresh3DJobs(){
 try{state.models=await list3DJobs();renderObjects();}
 catch(e){traceEvent('3D media unavailable: '+e.message,'warn');renderObjects();}
}

let background3DTimer=null,background3DBusy=false,reported3DJobs=new Set();
async function background3DCheck(){if(background3DBusy||document.visibilityState==='hidden'||!state.user)return;
 background3DBusy=true;
 try{const jobs=await list3DJobs(),pending=jobs.filter(j=>!['SUCCEEDED','FAILED','CANCELED'].includes(j.status)).slice(0,2);
  for(const item of pending){try{const job=await checkXR3D(item.id);
    if(['SUCCEEDED','FAILED'].includes(job.status)&&!reported3DJobs.has(job.id)){reported3DJobs.add(job.id);notify('3D '+job.id+' '+job.status.toLowerCase()+(job.error?' · '+job.error:''));window.dispatchEvent(new CustomEvent('freelab-3d-status',{detail:job}));}
   }catch(e){traceEvent('Background 3D task '+item.id+': '+e.message,'warn');}}
  if(!$('workspace').classList.contains('hidden'))void refresh3DJobs();
 }catch(e){traceEvent('3D polling unavailable: '+e.message,'warn');}finally{background3DBusy=false;}}
function startBackground3DMonitor(){if(background3DTimer)return;background3DTimer=setInterval(background3DCheck,30000);}
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
 const [captureResponse,objectResponse]=await Promise.all([api('/captures'),api('/objects')]);
 const captures=captureResponse.captures;
 const older=objectResponse.objects.filter(o=>o.capture_id===null);
 if(older.length){
   const first=older.find(o=>o.has_image);
   captures.push({id:0,image_url:first?'/api/objects/'+first.id+'/image':null,objects:older,hidden:false,collapsed:false,legacy:true});
 }
 return captures;
}
async function updateXRObject(id,patch){await api('/objects/'+id,{method:'PATCH',body:JSON.stringify(patch)});}
async function updateXRCloud(id,patch){await api('/captures/'+id,{method:'PATCH',body:JSON.stringify(patch)});}


// Explicit media actions: a text or voice prompt never spends tokens until Apply.
async function generateXRImage(prompt){return api('/media/text-to-image',{method:'POST',body:JSON.stringify({prompt,confirm_paid:true})});}
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
   sampleRate=audio.sampleRate;source=audio.createMediaStreamSource(stream);
   zero=audio.createGain();zero.gain.value=0;analyser=audio.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.7;source.connect(analyser);
   const receiveSamples=input=>{if(stopped)return;chunks.push(new Float32Array(input));
     let sq=0;for(let i=0;i<input.length;i++)sq+=input[i]*input[i];const volume=Math.sqrt(sq/input.length);
     stateRecord.volume=stateRecord.volume*.7+volume*.3;const spectral=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(spectral);
     const sections=12;stateRecord.freq=Array.from({length:sections},(_,j)=>{
       const start=Math.floor(j*spectral.length/sections),end=Math.floor((j+1)*spectral.length/sections);let total=0;
       for(let k=start;k<end;k++)total+=spectral[k];return Math.min(1,(total/(end-start))/205);});
     if(Date.now()-stateRecord.started>89500)finish(false);
   };
   if(audio.audioWorklet&&window.AudioWorkletNode){
     await audio.audioWorklet.addModule('/assets/mic-worklet.mjs?v=0.10.66');
     proc=new AudioWorkletNode(audio,'freelab-mic-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
     proc.port.onmessage=e=>{if(e.data?.samples)receiveSamples(e.data.samples)};
   }else{
     // Compatibility for browsers without AudioWorklet; never the primary audio path.
     proc=audio.createScriptProcessor(2048,1,1);
     proc.onaudioprocess=e=>receiveSamples(e.inputBuffer.getChannelData(0));
     traceEvent('AudioWorklet unsupported; legacy microphone compatibility mode','warn');
   }
   source.connect(proc);proc.connect(zero);zero.connect(audio.destination);
 }catch(e){if(!stopped){stopped=true;recorder=null;rejectResult(e);}}})();
 return stateRecord;
}
async function recordWavPrompt(durationMs=12000){const rec=startWavPrompt();await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.min(durationMs,90000))));return rec.stop();}
function currentRecording(){return recorder;}
async function describeXR(cid,oid=null,question='',refresh=false){const payload={capture_id:cid,object_id:oid,question,refresh};if(sessionMeta())payload.session_api_key=sessionMeta();return api('/media/describe',{method:'POST',body:JSON.stringify(payload)});}
async function modelXRPreview(id){return api('/media/3d/'+id+'/preview');}
async function modelXRDiagnostics(id){return api('/media/3d/'+id+'/diagnostics');}
async function retryXRPreview(id){return api('/media/3d/'+id+'/preview/retry',{method:'POST',body:'{}'});}
async function get3DQuality(){return api('/preferences/3d/quality');}
async function save3DQuality(prefs){return api('/preferences/3d/quality',{method:'PUT',body:JSON.stringify(prefs)});}
async function save3DTransform(id,transform){return api('/media/3d/'+id+'/transform',{method:'PATCH',body:JSON.stringify(transform)});}
async function get3DPreference(){return api('/preferences/3d');}
async function save3DPreference(provider){return api('/preferences/3d',{method:'PUT',body:JSON.stringify({provider})});}

async function loadElevenVoices(){return api('/media/voices');}

let pendingPrompt=null;
function closePrompt(){document.getElementById('xrPromptEditor').classList.add('hidden');pendingPrompt=null;}
function openPromptEditor(context,initialText='',onApply=null){
 pendingPrompt={...context,onApply};const modal=document.getElementById('xrPromptEditor');
 document.getElementById('xrPromptTarget').textContent='EDIT '+(context?.label||'SELECTED PHOTO');
 document.getElementById('xrPromptText').value=initialText;
 document.getElementById('xrPromptResult').textContent='Type or speak an instruction, then apply it.';
 modal.classList.remove('hidden');document.getElementById('xrPromptText').focus();
}
function wirePromptEditor(){
 document.getElementById('xrPromptClose').onclick=closePrompt;
 let promptRecording=null;
 document.getElementById('xrPromptVoice').onclick=async()=>{
  const status=document.getElementById('xrPromptResult'),btn=document.getElementById('xrPromptVoice');
  if(!promptRecording){try{if(!micReady())await armMicrophone();promptRecording=startWavPrompt();btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg><span>Stop</span>';status.textContent='Recording voice… press Stop when finished';}
   catch(e){status.textContent='Microphone: '+e.message;}return;}
  const recording=promptRecording;promptRecording=null;btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg><span>Speak / Stop</span>';status.textContent='Transcribing with Meta…';status.classList.add('working');
  try{const wav=await recording.stop();const transcript=await transcribeXR(wav);document.getElementById('xrPromptText').value=transcript;status.textContent='Transcript ready. Press Apply when you are happy with it.';}
  catch(e){status.textContent=e.message;}
  finally{status.classList.remove('working');}
 };
 document.getElementById('xrPromptApply').onclick=async()=>{
  if(!pendingPrompt)return;const context=pendingPrompt;
  const value=document.getElementById('xrPromptText').value.trim();
  if(value.length<3)return notify('Enter a prompt of at least 3 characters');
  const button=document.getElementById('xrPromptApply');button.disabled=true;
  const status=document.getElementById('xrPromptResult');status.classList.add('working');status.textContent='Generating a new image…';
  try{const item=await promptXR(context.captureId,context.objectId,value);
    closePrompt();if(context.onApply)await context.onApply(item);notify('Generated image saved privately');}
  catch(e){status.textContent=e.message;}
  finally{status.classList.remove('working');button.disabled=false;}
 };
}

window.FreeLab={generateXRImage,cameraFrameReady,captureXRFrame,downloadImage,openGallery,silenceXRVoice,api,startWavPrompt,currentRecording,describeXR,modelXRPreview,get3DPreference,save3DPreference,get3DQuality,save3DQuality,save3DTransform,list3DJobs,modelXRDiagnostics,retryXRPreview,loadElevenVoices,createXR3D,checkXR3D,refresh3DJobs,enableXRCamera,serverDiagnostics,armMicrophone,micReady,speakUpdate,pref,setPref,traceEvent,getTrace,promptXR,transcribeXR,recordWavPrompt,openPromptEditor,closePrompt,useXRFrame,saveXRFrame,recognizeXR,segmentXR,listXRClouds,updateXRObject,updateXRCloud,openCamera,closeCamera,resumeCamera,snapshot,submitCapture,segmentSnapshot,notify,loadObjects,cameraReport,getState:()=>state};
document.addEventListener('DOMContentLoaded',()=>{window.FreeLabRooms?.init?.();init().catch(e=>notify('Initialization failed: '+e.message));const bloom=$('featureBloom');if(bloom){setTimeout(()=>window.FreeLabSound?.play('arrival'),3000);bloom.querySelectorAll('.feature-seed').forEach(button=>{button.addEventListener('mouseenter',()=>window.FreeLabSound?.hover());button.addEventListener('focus',()=>window.FreeLabSound?.hover());});}});
})();
