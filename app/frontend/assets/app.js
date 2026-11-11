/* FREELAB Spatial Studio 0.2.0 — camera and model calls explicitly opt-in. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={user:null,config:null,objects:[],tab:'mine',stream:null,snapshot:null,xr:null};
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
let toastTimer, scanTimer=null, scanBusy=false;
function notify(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4400);}
async function api(path,opts={}){const init={credentials:'same-origin',...opts,headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}};
 const response=await fetch('/api'+path,init);let result={};try{result=await response.json()}catch{}if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result;}
async function refresh(){try{const h=await api('/health');$('healthStatus').textContent=h.ok?'System online':'Offline';$('connectionDot').classList.toggle('good',h.ok);state.config=await api('/config');$('modelStatus').textContent=(state.config.inference_enabled?state.config.model+' · on demand':'Muse offline · manual mode');$('modelStatus').previousElementSibling.classList.toggle('good',state.config.inference_enabled);}
 catch(e){$('healthStatus').textContent='Disconnected';}}
async function loadObjects(){const path=state.tab==='mine'?'/objects':'/public';const data=await api(path);state.objects=data.objects;renderObjects();}
function renderObjects(){const box=$('items');box.replaceChildren();if(state.tab==='mine'){$('objectCount').textContent=String(state.objects.length);$('objectCounter').textContent=String(state.objects.length).padStart(2,'0');}
 if(!state.objects.length){const e=el('div','empty-state');e.append(el('span','', '◌'),el('strong','',state.tab==='mine'?'Nothing collected yet':'No public objects yet'),el('p','',state.tab==='mine'?'Upload a snapshot, enable camera, or create an entry manually.':'Objects appear here only when their owners publish them.'));box.append(e);return;}
 for(const o of state.objects){const card=el('article','object-card');let img;if(o.has_image){img=el('img','object-photo');img.loading='lazy';img.alt='Collected object';img.src=state.tab==='mine'?'/api/objects/'+o.id+'/image':'/api/objects/'+o.id+'/image';}else img=el('div','object-placeholder','◈');card.append(img);
 const b=el('div','object-body'),meta=el('div','object-meta');meta.append(el('span','',o.provider==='manual'?'MANUAL':o.provider.toUpperCase()),el('span','',o.visibility.toUpperCase()));b.append(meta,el('h3','',o.label),el('p','',o.description||'Recognized spatial object'));
 if(state.tab==='mine'){const acts=el('div','object-actions');for(const [name,mode] of [['Private','private'],['Public','public'],['Share link','link']]){const btn=el('button','tiny-btn',name);btn.onclick=()=>changeVisibility(o.id,mode);acts.append(btn);}const del=el('button','tiny-btn','Delete');del.onclick=()=>removeObject(o.id);acts.append(del);b.append(acts);}else b.append(el('span','small-muted','By '+o.owner));card.append(b);box.append(card);}}
async function changeVisibility(id,mode){try{const data=await api('/objects/'+id,{method:'PATCH',body:JSON.stringify({visibility:mode})});if(data.share_token){const link=location.origin+'/shared.html?token='+data.share_token;try{await navigator.clipboard.writeText(link);notify('Private share link copied')}catch{prompt('Copy the private share URL',link)}}else notify('Visibility set to '+mode);await loadObjects();}catch(e){notify(e.message);}}
async function removeObject(id){if(!confirm('Delete this object and its snapshot?'))return;try{await api('/objects/'+id,{method:'DELETE'});await loadObjects();notify('Object removed')}catch(e){notify(e.message)}}
async function openCamera(){ $('cameraPanel').classList.remove('hidden');if(state.stream){$('cameraVideo').classList.remove('hidden');return;}try{const devices=navigator.mediaDevices;if(!devices?.getUserMedia)throw Error('Camera API unavailable');
 const stream=await devices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:960},height:{ideal:720}}});state.stream=stream;$('cameraVideo').srcObject=stream;await $('cameraVideo').play();$('captureEmpty').classList.add('hidden');$('cameraStatus').textContent='Stream granted · inspect scene before analysis';}
 catch(e){$('cameraStatus').textContent='Camera unavailable';$('captureEmpty').classList.remove('hidden');notify('Camera access unavailable. Use Upload snapshot.');}}
function closeCamera(){stopScan();state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;$('cameraVideo').srcObject=null;$('cameraPanel').classList.add('hidden');}
function compress(source){const canvas=$('snapshotCanvas');const w=source.videoWidth||source.naturalWidth||source.width;const h=source.videoHeight||source.naturalHeight||source.height;if(!w||!h)throw Error('Image has no pixels');const scale=Math.min(1,960/Math.max(w,h));canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);canvas.getContext('2d',{alpha:false}).drawImage(source,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/jpeg',0.65);if(data.length>610000) data=canvas.toDataURL('image/jpeg',0.42);if(data.length>610000)throw Error('Image too large; choose a smaller one');state.snapshot=data;$('previewImage').src=data;$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureEmpty').classList.add('hidden');$('cameraStatus').textContent='Snapshot ready · private';$('samOverlay')?.classList.add('hidden');return data;}
function snapshot(){if(!state.stream)throw Error('No live camera. Enable camera or upload an image.');$('cameraVideo').classList.remove('hidden');return compress($('cameraVideo'));}
async function submitCapture(recognize){try{if(!state.snapshot){if(state.stream)snapshot();else throw Error('Take or upload a snapshot first');}const label=$('manualLabel').value.trim();if(!recognize&&!label)throw Error('Enter an object name first');
 $('recognize').disabled=true;$('saveManual').disabled=true;notify(recognize?'Sending one image to Meta Muse…':'Saving privately…');const result=await api('/capture',{method:'POST',body:JSON.stringify({image:state.snapshot,recognize,label,model:$('modelChoice').value})});notify('Saved '+result.ids.length+' private object'+(result.ids.length!==1?'s':''));state.tab='mine';selectTab('mine');await loadObjects();return true;}
 catch(e){notify(e.message);if(scanTimer&&/limit|wait|quota|Too many/i.test(e.message))stopScan();return false;}finally{$('recognize').disabled=false;$('saveManual').disabled=false;}}
async function saveNameOnly(){const name=$('manualLabel').value.trim();if(!name)throw Error('Enter an object label');await api('/objects',{method:'POST',body:JSON.stringify({label:name})});state.tab='mine';selectTab('mine');await loadObjects();notify('Saved private object');}
function stopScan(){if(scanTimer){clearInterval(scanTimer);scanTimer=null;}$('toggleScan').textContent='Start 20s scan';}
async function scanTick(){if(scanBusy||!state.stream||!state.user||!state.config?.inference_enabled)return;
 scanBusy=true;try{snapshot();await submitCapture(true);}catch(e){notify(e.message);stopScan();}finally{scanBusy=false;}}
function toggleScan(){if(scanTimer){stopScan();notify('Live sampling stopped');return;}
 if(!state.stream){notify('Grant camera access first; snapshots cannot be read from XR passthrough alone');return;}
 if(!state.config?.inference_enabled){notify('An administrator must configure Meta first');return;}
 if(!confirm('Start opt-in image sampling every 20 seconds? Each frame can trigger a billed Meta Muse API request and consume your daily quota. Stop at any time.'))return;
 scanTimer=setInterval(scanTick,20000);$('toggleScan').textContent='Stop scan · active';notify('Scan active · one frame every 20 seconds');scanTick();}
async function segmentSnapshot(){try{
 if(!state.snapshot){if(state.stream)snapshot();else throw Error('Take or upload a photo first');}
 const prompt=$('samPrompt').value.trim().toLowerCase();if(prompt.length<2)throw Error('Name one object to find');
 $('segment').disabled=true;notify('One charged SAM 3.1 image request…');
 const data=await api('/segment',{method:'POST',body:JSON.stringify({image:state.snapshot,prompt})});
 const overlay=$('samOverlay');const boxes=data.boxes||[];const width=boxes[0]?.image_size?.[0]||$('snapshotCanvas').width;
 const height=boxes[0]?.image_size?.[1]||$('snapshotCanvas').height;
 overlay.width=width;overlay.height=height;const ctx=overlay.getContext('2d');ctx.clearRect(0,0,width,height);
 ctx.lineWidth=Math.max(3,width/190);ctx.strokeStyle='#c1ffb4';ctx.fillStyle='#cdfdbe';ctx.font=`${Math.max(14,width/55)}px system-ui`;
 for(const found of boxes){const [x1,y1,x2,y2]=found.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.fillText(prompt,x1+5,Math.max(20,y1-7));}
 overlay.classList.remove('hidden');notify(`${boxes.length} SAM matches · mask parsing is a future feature`);
 }catch(e){notify(e.message)}finally{$('segment').disabled=false;}}
async function loadProviderList(){if(state.user?.role!=='admin')return;
 const result=await api('/admin/providers');const box=$('providerList');box.replaceChildren();
 for(const p of result.providers){const chip=el('div','provider-chip'+(p.configured?' enabled':''));chip.append(el('span','status'),el('span','',p.name+' · '+(p.configured?'Connected':'Not set')));
 if(p.source==='vault'){const del=el('button','', '×');del.title='Delete stored key';del.onclick=async()=>{if(!confirm('Delete the encrypted '+p.name+' key?'))return;try{await api('/admin/providers/'+p.provider,{method:'DELETE'});await loadProviderList();await refresh();notify('Key removed')}catch(e){notify(e.message)}};chip.append(del);}box.append(chip);}}
async function saveProvider(e){e.preventDefault();const provider=$('providerChoice').value,key=$('providerKey').value;
 if(!confirm('Store this '+provider+' credential in the encrypted server vault?'))return;
 try{await api('/admin/providers/'+provider,{method:'PUT',body:JSON.stringify({api_key:key})});$('providerKey').value='';await loadProviderList();await refresh();notify('Provider key saved on Ubuntu (encrypted)');}
 catch(e){notify(e.message);$('providerKey').value='';}}
function setLibrary(open){const p=$('workspace');p.classList.toggle('hidden',!open);$('toggleLibrary').setAttribute('aria-expanded',String(open));}

function selectTab(tab){state.tab=tab;document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.dataset.list===tab));}
function presentLog(force=false){if(!state.user)return;fetch('/changelog.json',{cache:'no-store'}).then(r=>r.json()).then(log=>{const key='free-lab-log:'+state.user.id+':'+log.version;if(!force&&localStorage.getItem(key))return;
 $('logTitle').textContent=log.title;$('logDate').textContent=log.datetime;$('logItems').replaceChildren(...log.changes.map(x=>el('li','',x)));$('changelog').classList.remove('hidden');$('changelog').dataset.key=key;}).catch(()=>{});}
function dismissLog(){const key=$('changelog').dataset.key;if(key)localStorage.setItem(key,'seen');$('changelog').classList.add('hidden');}
async function afterAuth(user){state.user=user;$('main').classList.remove('hidden');$('loginView').classList.add('hidden');$('profileSummary').textContent=user.display_name+' · @'+user.username+' · '+user.role;$('adminTools').classList.toggle('hidden',user.role!=='admin');await refresh();await loadObjects();presentLog();if(user.role==='admin')await loadProviderList().catch(e=>notify(e.message));}
async function init(){
 $('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});$('password').value='';await afterAuth(data.user);}catch(error){$('loginError').textContent=error.message;}};
 const m=await api('/me').catch(()=>({user:null}));if(m.user)await afterAuth(m.user);else{await refresh();$('loginView').classList.remove('hidden');}
 $('enterXR').onclick=async()=>{try{if(!state.user)throw Error('Sign in before entering XR');await window.FreeLabXR.start();}catch(e){notify(e.message)}};
 $('toggleLibrary').onclick=()=>setLibrary($('workspace').classList.contains('hidden'));$('closeLibrary').onclick=()=>setLibrary(false);
 $('providerForm').onsubmit=saveProvider;$('segment').onclick=segmentSnapshot;$('toggleScan').onclick=toggleScan;document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScan()});
 $('cameraButton').onclick=openCamera;$('addNameButton').onclick=()=>{$('cameraPanel').classList.remove('hidden');$('manualLabel').focus();};$('closeCamera').onclick=closeCamera;$('takeSnapshot').onclick=()=>{try{snapshot();notify('Snapshot ready')}catch(e){notify(e.message)}};
 $('fileInput').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>12*1024*1024)throw Error('Please choose an image under 12 MB');const bmp=await createImageBitmap(file);const canvas=$('snapshotCanvas');const scale=Math.min(1,960/Math.max(bmp.width,bmp.height));canvas.width=Math.round(scale*bmp.width);canvas.height=Math.round(scale*bmp.height);canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close();const preview=new Image();preview.src=canvas.toDataURL('image/jpeg',0.65);await preview.decode();$('cameraPanel').classList.remove('hidden');compress(preview);notify('Image ready — recognize or save manually');}catch(e){notify(e.message)}e.target.value='';};
 $('recognize').onclick=()=>submitCapture(true);$('saveManual').onclick=()=>{if(state.snapshot)submitCapture(false);else saveNameOnly().catch(e=>notify(e.message))};
 document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{selectTab(t.dataset.list);loadObjects().catch(e=>notify(e.message))});
 $('profileButton').onclick=()=>$('profilePanel').classList.remove('hidden');$('closeProfile').onclick=()=>$('profilePanel').classList.add('hidden');
 $('logout').onclick=async()=>{stopScan();closeCamera();await api('/logout',{method:'POST'});location.reload()};
 $('createProfile').onsubmit=async e=>{e.preventDefault();try{await api('/admin/profiles',{method:'POST',body:JSON.stringify({username:$('newUsername').value,display_name:$('newDisplayName').value,password:$('newPassword').value})});e.target.reset();notify('New private profile created')}catch(error){notify(error.message)}};
 $('showChangelog').onclick=()=>presentLog(true);$('dismissChangelog').onclick=dismissLog;$('continueChangelog').onclick=dismissLog;
}
window.FreeLab={openCamera,closeCamera,snapshot,submitCapture,segmentSnapshot,notify,loadObjects,getState:()=>state};
document.addEventListener('DOMContentLoaded',()=>init().catch(e=>notify('Initialization failed: '+e.message)));
})();
