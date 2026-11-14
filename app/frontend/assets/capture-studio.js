/* FREELAB v0.10.21. Capture is independent from the live camera preview.
 * Source/branch actions call the same authenticated XR API functions. */
(()=>{'use strict';
const $=id=>document.getElementById(id),FL=()=>window.FreeLab;
let clouds=[],chosen=null,busy=false,expanded=false,inspecting=false,requestedCapture=null;
let metadataRequest=0,jobMonitor=null,voiceRecorder=null;
const inform=message=>{if($('captureStatus'))$('captureStatus').textContent=message;FL()?.notify?.(message);};
function keyOf(item){return item.type+':'+item.record.id;}
function getItem(key){for(const cloud of clouds){if(key==='capture:'+cloud.id)return {type:'capture',cid:cloud.id,record:cloud,cloud};for(const o of cloud.objects||[])if(key==='object:'+o.id)return {type:'object',cid:cloud.id,oid:o.id,record:o,cloud};}return null;}
function imageURL(item){return item.type==='capture'?item.record.image_url:'/api/objects/'+item.record.id+'/image';}
function label(item){return item.type==='capture'?'Source '+item.cid:(item.record.label||'Segment');}
function inspect(item){chosen=keyOf(item);inspecting=true;
 /* A different source must load its own pixels before billed extraction. */
 if(item.type==='capture')requestedCapture=null;render();void showSavedMetadata(item);
 }
function resultPanel(title,message,link=null,jobId=null){
 const area=$('captureResult');if(!area)return;area.classList.remove('hidden');area.replaceChildren();
 const heading=document.createElement('strong');heading.textContent=title;area.append(heading);
 const para=document.createElement('p');para.textContent=message||'';area.append(para);
 if(link){const a=document.createElement('a');a.textContent='View / download 3D model';a.href=link;a.rel='noopener noreferrer';a.target='_blank';area.append(a);}
 if(jobId){const check=document.createElement('button');check.type='button';check.textContent='Check 3D status';check.onclick=()=>void check3DJob(jobId);area.append(check);}
}
async function showSavedMetadata(item){
 const marker=++metadataRequest;const itemKey=keyOf(item);
 try{
  const [notes,jobs]=await Promise.all([
   FL().api('/media/descriptions?capture_id='+item.cid+(item.oid?'&object_id='+item.oid:'')),
   FL().list3DJobs()]);
  if(marker!==metadataRequest||chosen!==itemKey)return;
  const history=notes.history||[],latest=history.at(-1),job=jobs.find(j=>j.capture_id===item.cid&&(j.object_id||null)===(item.oid||null));
  if(job&&job.status==='SUCCEEDED')resultPanel('Saved 3D · '+job.provider,job.cached?'Model saved privately on FREELAB.':('Model ready but local caching failed: '+(job.cache_error||'provider link may expire')),job.glb_url||null,null);
  else if(job&&job.status==='FAILED')resultPanel('3D failed · '+job.provider,job.error||'Provider reported failure without a reason. See AHOLO dashboard for task diagnostics.',null,job.id);
  else if(latest)resultPanel('Saved description'+(history.length>1?' · '+history.length+' notes':''),latest.answer);
  else if(job)resultPanel('Saved 3D task · '+job.provider,job.status+' · '+job.progress+'% · Created '+(job.created_at||''),null,job.id);
  else{$('captureResult').replaceChildren();$('captureResult').classList.add('hidden');}
 }catch(e){if(marker===metadataRequest)resultPanel('Saved metadata unavailable',e.message);}
}
async function check3DJob(id){try{const job=await FL().checkXR3D(id);if(job.status==='SUCCEEDED')resultPanel('3D ready · '+job.provider,job.cached?'GLB stored privately.':('Provider link available; local cache issue: '+(job.cache_error||'not yet saved')),job.glb_url);
 else if(job.status==='FAILED'||job.status==='CANCELED')resultPanel('3D '+job.status.toLowerCase()+' · '+job.provider,job.error||'The provider did not supply a failure reason.',null,id);
 else resultPanel('3D '+job.status+' · '+job.provider,'Task '+id+' · '+job.progress+'%. Read-only status check; no extra generation charge.',null,id);
 if(['FAILED','SUCCEEDED','CANCELED'].includes(job.status))stopJobMonitor();return job;
 }catch(e){resultPanel('3D status unavailable',e.message,null,id);}}
function stopJobMonitor(){if(jobMonitor){clearTimeout(jobMonitor);jobMonitor=null;}}
function monitorJob(id,itemKey){stopJobMonitor();let count=0;
 const tick=async()=>{if(chosen!==itemKey||$('cameraPanel').classList.contains('hidden')){stopJobMonitor();return;}
  const job=await check3DJob(id);if(job&&['FAILED','SUCCEEDED','CANCELED'].includes(job.status))return;
  if(++count<70)jobMonitor=setTimeout(tick,13000);else resultPanel('3D task still running','Open Collection → Your 3D Models to check the result later.',null,id);
 };jobMonitor=setTimeout(tick,13000);
}
function applyView(){const item=inspecting&&chosen?getItem(chosen):null;
 $('captureQuickActions').classList.toggle('hidden',!item);
 $('captureViewport').classList.toggle('inspecting',!!item);
 if(item){$('previewImage').src=imageURL(item);$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureEmpty').classList.add('hidden');$('captureViewportHint').textContent=label(item)+' · PRIVATE · SELECT AN ACTION';}
 else{const state=FL()?.getState(),imported=state?.snapshot&&state.snapshotOrigin==='upload';
 if(imported){$('previewImage').src=state.snapshot;$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureEmpty').classList.add('hidden');$('captureViewportHint').textContent='IMPORTED PHOTO · PRESS SHUTTER TO SAVE';}
 else{$('previewImage').classList.add('hidden');const stream=state?.stream;
 if(stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)){$('cameraVideo').classList.remove('hidden');$('captureEmpty').classList.add('hidden');}
 $('captureViewportHint').textContent='LIVE CAMERA · CAPTURE A SOURCE';}}
}
function node(container,item,depth=0){const wrapper=document.createElement('div');wrapper.className='capture-tile';wrapper.classList.toggle('selected',chosen===keyOf(item));wrapper.style.setProperty('--branch-depth',Math.min(depth,5));
 const button=document.createElement('button');button.type='button';button.className='capture-node';button.setAttribute('aria-label','Inspect '+label(item));
 const img=document.createElement('img');img.src=imageURL(item);img.loading='lazy';img.alt='';
 const caption=document.createElement('span');caption.className='capture-node-copy';const name=document.createElement('strong');name.textContent=label(item);
 const date=document.createElement('small');date.textContent=String(item.record.created_at||'').slice(0,16)||(item.type==='capture'?'Source':'Segment');
 caption.append(name,date);button.append(img,caption);button.onclick=()=>inspect(item);
 const menu=document.createElement('details');menu.className='capture-node-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.title='Actions for '+label(item);summary.setAttribute('aria-label','Actions for '+label(item));menu.append(summary);
 const actions=document.createElement('div');actions.className='capture-node-popover';for(const [text,id] of [['Inspect','inspect'],['Extract','extract'],['Describe','describe'],['Extract object','segment'],['Refine image','refine'],['Edit','prompt'],['Voice','voice'],['3D','3d'],['Fullscreen','theater']]){const action=document.createElement('button');action.textContent=text;action.type='button';action.onclick=e=>{e.stopPropagation();menu.open=false;inspect(item);void activate(id);};actions.append(action);}menu.append(actions);wrapper.append(button,menu);container.append(wrapper);
}
function render(){const box=$('captureTree');box.replaceChildren();if(!clouds.length){const note=document.createElement('p');note.className='capture-tree-empty';note.textContent='Your sources will appear here. Capture an image to begin.';box.append(note);}
 for(const cloud of clouds){const group=document.createElement('section');group.className='capture-cloud';const heading=document.createElement('div');heading.className='capture-cloud-head';heading.textContent='SOURCE '+cloud.id+' · '+(cloud.objects||[]).length+' SEGMENTS';group.append(heading);
 const grid=document.createElement('div');grid.className='capture-cloud-grid';node(grid,{type:'capture',cid:cloud.id,record:cloud,cloud});
 const byParent=new Map(),visited=new Set();for(const o of cloud.objects||[]){if(o.shelf==='bin')continue;const parent=Number.isInteger(o.parent_object_id)?o.parent_object_id:0;if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(o);}
 function grow(parent,depth){for(const o of byParent.get(parent)||[]){if(visited.has(o.id))continue;visited.add(o.id);node(grid,{type:'object',cid:cloud.id,oid:o.id,record:o,cloud},depth);grow(o.id,depth+1);}}
 grow(0,0);for(const o of cloud.objects||[])if(o.shelf!=='bin'&&!visited.has(o.id))node(grid,{type:'object',cid:cloud.id,oid:o.id,record:o,cloud});group.append(grid);box.append(group);}
 const item=chosen?getItem(chosen):null;$('captureSelection').classList.toggle('hidden',!item);
 if(item){$('captureSelectedLabel').textContent=label(item);$('captureSelectedKind').textContent=item.type==='capture'?'SOURCE':'SEGMENT';$('captureSelectedDescription').textContent=item.record.description||'Ask AI about this image, or continue refining it.';}
 $('captureWorkbench').classList.toggle('minimized',!expanded);$('captureGridToggle').textContent=expanded?'Hide grid':'Library';$('captureGridToggle').setAttribute('aria-expanded',String(expanded));applyView();
}
async function load(choose=null){if(!FL()?.getState()?.user)return;const data=await FL().listXRClouds();clouds=(data||[]).filter(c=>c.id>0&&!c.hidden);if(choose)chosen=choose;if(chosen&&!getItem(chosen)){chosen=null;inspecting=false;}render();}
async function execute(job,message){if(busy)return;busy=true;
 const panel=$('captureViewport'),chip=$('captureWorking');panel.classList.add('processing');panel.setAttribute('aria-busy','true');chip.innerHTML='<span class="ai-live-text">'+(message||'Processing…')+'</span>';chip.classList.remove('hidden');
 for(const id of ['captureShutter','captureRecognize','captureRefineApply','captureDescribe','captureMake3D','captureChatSend','captureQuickExtract']){const b=$(id);if(b)b.disabled=true;}
 try{if(message)$('captureStatus').textContent=message;await job();}catch(e){resultPanel('Request failed',e.message||String(e));inform(e.message||String(e));}
 finally{busy=false;panel.classList.remove('processing');panel.removeAttribute('aria-busy');chip.classList.add('hidden');
 for(const id of ['captureShutter','captureRecognize','captureRefineApply','captureDescribe','captureMake3D','captureChatSend','captureQuickExtract']){const b=$(id);if(b)b.disabled=false;}}
}
function selected(){const item=chosen&&getItem(chosen);if(!item)throw Error('Capture a source or select an existing image first');return item;}
async function paid(action,details=''){return window.FreeLabDialog.confirm(action+' sends data to an AI provider and may incur charges.'+(details?'\n'+details:'')+'\nContinue?',{title:'Confirm paid AI operation',ok:'Continue'});}
async function ensureFrame(item){if(item.type==='capture'&&requestedCapture!==item.cid){await FL().useXRFrame(item.record.image_url);requestedCapture=item.cid;}}
async function saveSource(){const app=FL(),state=app.getState();let frame=state.snapshot;
 if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)&&state.snapshotOrigin!=='upload')frame=app.snapshot();
 if(!frame)throw Error('Enable camera or import a photograph');
 const result=await app.api('/captures',{method:'POST',body:JSON.stringify({image:frame})});requestedCapture=result.id;await load('capture:'+result.id);inspecting=true;expanded=false;render();void showSavedMetadata(selected());inform('Source '+result.id+' saved. Voice, Describe and Extract are on the image.');
}
async function recognize(){const item=selected();if(!await paid('EXTRACT'))return;
 await execute(async()=>{await ensureFrame(item);const result=await FL().recognizeXR(item.cid,item.oid||null,true);expanded=true;await load(chosen);inform('Extracted '+(result.items||[]).length+' segments. Open Library to inspect them.');},'Extracting objects…');}
async function segment(noun=null){const item=selected();const text=(noun||$('captureRefineText').value||'').trim();if(text.length<2){inform('Name one object to extract, for example chair');return;}if(!await paid('EXTRACT OBJECT'))return;
 await execute(async()=>{await ensureFrame(item);const r=await FL().segmentXR(item.cid,text,item.oid||null,true);expanded=true;$('captureRefineRow').classList.add('hidden');await load(chosen);inform('Created '+(r.items||[]).length+' named cutouts.');},'Extracting named object…');}
function refineImage(instruction=''){const seed=String(instruction||'').trim()||'Improve image quality, reduce noise, sharpen details, and improve lighting.';promptEditor(false,seed);inform('Refine opens the image editor. Adjust the prompt if needed, then apply it.');}
async function describe(query=''){const item=selected();
 if(!query.trim()){
  try{const saved=await FL().api('/media/descriptions?capture_id='+item.cid+(item.oid?'&object_id='+item.oid:''));
   const last=(saved.history||[]).at(-1);
   if(last){resultPanel('Saved description',last.answer);inform('Loaded saved description — no provider charge');return;}
  }catch(e){inform('Description cache: '+e.message);}
 }
 if(!await paid('DESCRIBE',query.trim()?'Ask a new question about the image.':'Generate a new description for this image.'))return;
 await execute(async()=>{const result=await FL().describeXR(item.cid,item.oid||null,query,false);
 resultPanel(result.cached?'Saved description':'Description saved to this image',result.description||'No description returned');
 inform(result.cached?'Loaded saved description':'Description saved');},'Describing selected image…');}
function promptEditor(voice=false,instruction=''){const item=selected();$('captureRefineRow').classList.add('hidden');FL().openPromptEditor({captureId:item.cid,objectId:item.oid||null,label:item.record.label||'source'},instruction,async()=>{expanded=true;await load(chosen);inform('Image generated. Find it in Library.');});if(voice){$('xrPromptVoice')?.focus();inform('Record your instruction, then explicitly confirm the edit.');}}
async function generate3D(instruction=''){
 const item=selected(),prompt=String(instruction||'').trim();
 if(prompt.length>750)return inform('3D guidance must be 750 characters or fewer');
 const check=await FL().api('/media/3d/check');
 if(!check.configured){resultPanel('3D unavailable',check.provider+' has no API key configured for this profile. Check Settings → APIs.');return;}
 if(!await paid('GENERATE 3D',`Provider: ${check.provider.toUpperCase()} · ${prompt?'Text-guided model + reference image':'Image-to-3D model'} · Each submission is a separate paid task.`))return;
 await execute(async()=>{
  const result=await FL().createXR3D(item.cid,item.oid||null,prompt);
  resultPanel('3D task submitted · '+result.provider,'Task '+result.id+' is queued in the background. Keep working while FREELAB checks its status.',null,result.id);
  monitorJob(result.id,chosen);inform('3D task '+result.id+' queued in the background. You can keep using the studio while it runs.');
 },'Submitting 3D task…');
}
async function connection3D(){try{const check=await FL().api('/media/3d/check');
 resultPanel('3D connection · '+check.provider,(check.configured?'API key configured.':'No usable API key for this profile.')+' This is read-only, not a generation test. '+(check.recent||[]).map(j=>'#'+j.id+' '+j.status+(j.error?' · '+j.error:'')).join(' / '));
 }catch(e){resultPanel('3D connection check failed',e.message);}}
async function recordVoice(){if(voiceRecorder){const old=voiceRecorder;voiceRecorder=null;
 resultPanel('Voice recognition','Transcribing microphone recording…');
 try{const wav=await old.stop();const text=await FL().transcribeXR(wav);$('captureCommandText').value=text;resizeComposer();resultPanel('Recognized speech','Text ready in composer. Choose an action and press send.');}
 catch(e){resultPanel('Voice recognition failed',e.message);}return;}
 try{if(!await paid('VOICE TRANSCRIPTION','Audio is processed by the configured transcription provider when recording stops.'))return;
 if(!FL().micReady())await FL().armMicrophone();voiceRecorder=FL().startWavPrompt();
 resultPanel('Recording','Speak, then press the microphone again to stop. Transcription may incur provider charges.');}
 catch(e){resultPanel('Microphone unavailable',e.message);}
}
function resizeComposer(){const field=$('captureCommandText');field.style.height='auto';field.style.height=Math.min(field.scrollHeight,150)+'px';}
function theater(){const item=selected();const id=item.type==='object'?item.oid:null;return FL().openGallery(id,item.type==='capture'?item.cid:null);}
async function activate(id){try{if(id==='inspect')return;if(id==='extract')return recognize();if(id==='describe')return describe();if(id==='segment'){$('captureRefineRow').classList.remove('hidden');return $('captureRefineText').focus();}if(id==='refine')return refineImage();if(id==='prompt')return promptEditor();if(id==='voice')return recordVoice();if(id==='3d')return generate3D();if(id==='check3d')return connection3D();if(id==='source')return beginNew();if(id==='import')return $('fileInput').click();if(id==='theater')return theater();}catch(e){inform(e.message);}}
function beginNew(){const state=FL().getState();requestedCapture=null;chosen=null;inspecting=false;expanded=false;if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)){FL().resumeCamera();render();}else{$('fileInput').click();} $('captureResult').replaceChildren();$('captureResult').classList.add('hidden');stopJobMonitor();}
async function chatSubmit(e){e.preventDefault();const mode=$('captureCommandMode').value,text=$('captureCommandText').value.trim();
 try{if(!selected())return;switch(mode){case 'extract':await recognize();break;case 'describe':await describe(text);break;case 'segment':await segment(text);break;case 'refine':refineImage(text);break;case '3d':await generate3D(text);break;default:promptEditor(false,text);break;}}catch(error){inform(error.message);} }
function setup(){if(!$('captureShutter'))return;
 const legacy=$('captureAdvancedTools'),panel=$('captureMorePanel');if(legacy&&panel)panel.append(legacy);
 $('captureShutter').onclick=()=>execute(saveSource,'Saving source privately…');$('captureNewSource').onclick=beginNew;$('captureUpload').onclick=()=>$('fileInput').click();
 $('captureGridToggle').onclick=()=>{expanded=!expanded;render();};$('captureReload').onclick=()=>execute(()=>load(),'Refreshing sources…');
 for(const [id,action] of [['captureRecognize','extract'],['captureDescribe','describe'],['captureRefine','refine'],['capturePrompt','prompt'],['captureVoice','voice'],['captureMake3D','3d'],['captureTheater','theater'],['captureQuickVoice','voice'],['captureQuickEye','describe'],['captureQuickExtract','extract'],['captureChatVoice','voice']]){$(id).onclick=()=>void activate(action);}
 $('captureRefineApply').onclick=()=>segment();$('captureCommandForm').onsubmit=chatSubmit;
 $('captureCommandText').addEventListener('input',resizeComposer);
 $('captureCommandText').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('captureCommandForm').requestSubmit();}});
 document.querySelectorAll('[data-capture-tool]').forEach(btn=>btn.onclick=()=>{$('captureMore').open=false;void activate(btn.dataset.captureTool);});
 $('captureModeButton').onclick=()=>{$('captureCommandMode').focus();$('captureCommandMode').click();};
 $('captureCommandMode').onchange=()=>{$('captureRefineRow').classList.add('hidden');$('captureCommandText').placeholder=({prompt:'Ask AI to change this image…',describe:'Ask a question about the image…',extract:'Extract all obvious objects from this source',segment:'Name one object to extract, e.g. chair',refine:'Describe how the image quality should be improved', '3d':'Generate a 3D model of the selected image'})[$('captureCommandMode').value];};
 $('captureViewportHint').textContent='LIVE CAMERA · READY TO CAPTURE';
 window.addEventListener('freelab-photo-ready',()=>{requestedCapture=null;inspecting=false;expanded=false;render();$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureViewportHint').textContent='PHOTO IMPORTED · PRESS SHUTTER TO SAVE';});
 $('cameraButton')?.addEventListener('click',()=>load().catch(e=>inform(e.message)));
 const watch=new MutationObserver(()=>{if(!$('cameraPanel').classList.contains('hidden'))load().catch(e=>inform(e.message));
 else{stopJobMonitor();if(voiceRecorder){const recording=voiceRecorder;voiceRecorder=null;void recording.result.catch(()=>{});void recording.cancel().catch(()=>{});}}});watch.observe($('cameraPanel'),{attributes:true,attributeFilter:['class']});
 render();
}
document.addEventListener('DOMContentLoaded',setup);
})();
