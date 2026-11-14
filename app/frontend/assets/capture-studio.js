/* FREELAB v0.10.18. Capture is independent from the live camera preview.
 * Source/branch actions call the same authenticated XR API functions. */
(()=>{'use strict';
const $=id=>document.getElementById(id),FL=()=>window.FreeLab;
let clouds=[],chosen=null,busy=false,expanded=false,inspecting=false,requestedCapture=null;
const inform=message=>{if($('captureStatus'))$('captureStatus').textContent=message;FL()?.notify?.(message);};
function keyOf(item){return item.type+':'+item.record.id;}
function getItem(key){for(const cloud of clouds){if(key==='capture:'+cloud.id)return {type:'capture',cid:cloud.id,record:cloud,cloud};for(const o of cloud.objects||[])if(key==='object:'+o.id)return {type:'object',cid:cloud.id,oid:o.id,record:o,cloud};}return null;}
function imageURL(item){return item.type==='capture'?item.record.image_url:'/api/objects/'+item.record.id+'/image';}
function label(item){return item.type==='capture'?'Source '+item.cid:(item.record.label||'Segment');}
function inspect(item){chosen=keyOf(item);inspecting=true;/* A different source must load its own pixels before billed extraction. */if(item.type==='capture')requestedCapture=null;render();}
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
 const actions=document.createElement('div');actions.className='capture-node-popover';for(const [text,id] of [['Inspect','inspect'],['Extract','extract'],['Describe','describe'],['Refine','refine'],['Edit','prompt'],['Voice','voice'],['3D','3d'],['Fullscreen','theater']]){const action=document.createElement('button');action.textContent=text;action.type='button';action.onclick=e=>{e.stopPropagation();menu.open=false;inspect(item);void activate(id);};actions.append(action);}menu.append(actions);wrapper.append(button,menu);container.append(wrapper);
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
async function execute(job,message){if(busy)return;busy=true;for(const id of ['captureShutter','captureRecognize','captureRefineApply','captureDescribe','captureMake3D','captureChatSend','captureQuickExtract']){const b=$(id);if(b)b.disabled=true;}
 try{if(message)$('captureStatus').textContent=message;await job();}catch(e){inform(e.message||String(e));}
 finally{busy=false;for(const id of ['captureShutter','captureRecognize','captureRefineApply','captureDescribe','captureMake3D','captureChatSend','captureQuickExtract']){const b=$(id);if(b)b.disabled=false;}}
}
function selected(){const item=chosen&&getItem(chosen);if(!item)throw Error('Capture a source or select an existing image first');return item;}
function paid(action){return window.confirm(action+' sends an image to an AI provider and may incur charges. Continue?');}
async function ensureFrame(item){if(item.type==='capture'&&requestedCapture!==item.cid){await FL().useXRFrame(item.record.image_url);requestedCapture=item.cid;}}
async function saveSource(){const app=FL(),state=app.getState();let frame=state.snapshot;
 if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)&&state.snapshotOrigin!=='upload')frame=app.snapshot();
 if(!frame)throw Error('Enable camera or import a photograph');
 const result=await app.api('/captures',{method:'POST',body:JSON.stringify({image:frame})});requestedCapture=result.id;await load('capture:'+result.id);inspecting=true;expanded=false;render();inform('Source '+result.id+' saved. Voice, Describe and Extract are on the image.');
}
async function recognize(){const item=selected();if(!paid('EXTRACT'))return;
 await execute(async()=>{await ensureFrame(item);const result=await FL().recognizeXR(item.cid,item.oid||null,true);expanded=true;await load(chosen);inform('Extracted '+(result.items||[]).length+' segments. Open Library to inspect them.');},'Extracting objects…');}
async function segment(noun=null){const item=selected();const text=(noun||$('captureRefineText').value||'').trim();if(text.length<2){inform('Name an object to refine, for example chair');return;}if(!paid('REFINE'))return;
 await execute(async()=>{await ensureFrame(item);const r=await FL().segmentXR(item.cid,text,item.oid||null,true);expanded=true;await load(chosen);inform('Created '+(r.items||[]).length+' child segments.');},'Refining selected image…');}
async function describe(query=''){const item=selected();if(!paid('DESCRIBE'))return;
 await execute(async()=>{const result=await FL().describeXR(item.cid,item.oid||null,query,false);const area=$('captureDescriptionResult');area.textContent=result.description||'No description returned';area.classList.remove('hidden');inform(result.cached?'Loaded saved description':'Description ready');},'Describing selected image…');}
function promptEditor(voice=false,instruction=''){const item=selected();FL().openPromptEditor({captureId:item.cid,objectId:item.oid||null,label:item.record.label||'source'},instruction,async()=>{expanded=true;await load(chosen);inform('Image generated. Find it in Library.');});if(voice){$('xrPromptVoice')?.focus();inform('Record your instruction, then explicitly confirm the edit.');}}
async function generate3D(){const item=selected();if(!window.confirm('Submit a paid image-to-3D job for this image?'))return;await execute(async()=>{const result=await FL().createXR3D(item.cid,item.oid||null);inform('3D job '+result.id+' submitted. Monitor it under Collection → Your 3D Models.');},'Submitting 3D job…');}
function theater(){const item=selected();const id=item.type==='object'?item.oid:null;return FL().openGallery(id,item.type==='capture'?item.cid:null);}
async function activate(id){try{if(id==='inspect')return;if(id==='extract')return recognize();if(id==='describe')return describe();if(id==='refine'){$('captureRefineRow').classList.remove('hidden');return $('captureRefineText').focus();}if(id==='prompt')return promptEditor();if(id==='voice')return promptEditor(true);if(id==='3d')return generate3D();if(id==='theater')return theater();}catch(e){inform(e.message);}}
function beginNew(){const state=FL().getState();requestedCapture=null;chosen=null;inspecting=false;expanded=false;if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)){FL().resumeCamera();render();}else{$('fileInput').click();}}
async function chatSubmit(e){e.preventDefault();const mode=$('captureCommandMode').value,text=$('captureCommandText').value.trim();
 try{if(!selected())return;switch(mode){case 'extract':await recognize();break;case 'describe':await describe(text);break;case 'refine':await segment(text);break;case '3d':await generate3D();break;default:promptEditor(false,text);break;}}catch(error){inform(error.message);} }
function setup(){if(!$('captureShutter'))return;
 const legacy=$('captureAdvancedTools'),panel=$('captureMorePanel');if(legacy&&panel)panel.append(legacy);
 $('captureShutter').onclick=()=>execute(saveSource,'Saving source privately…');$('captureNewSource').onclick=beginNew;$('captureUpload').onclick=()=>$('fileInput').click();
 $('captureGridToggle').onclick=()=>{expanded=!expanded;render();};$('captureReload').onclick=()=>execute(()=>load(),'Refreshing sources…');
 for(const [id,action] of [['captureRecognize','extract'],['captureDescribe','describe'],['captureRefine','refine'],['capturePrompt','prompt'],['captureVoice','voice'],['captureMake3D','3d'],['captureTheater','theater'],['captureQuickVoice','voice'],['captureQuickEye','describe'],['captureQuickExtract','extract'],['captureChatVoice','voice']]){$(id).onclick=()=>void activate(action);}
 $('captureRefineApply').onclick=()=>segment();$('captureCommandForm').onsubmit=chatSubmit;
 $('captureModeButton').onclick=()=>{$('captureCommandMode').focus();$('captureCommandMode').click();};
 $('captureCommandMode').onchange=()=>{$('captureCommandText').placeholder=({prompt:'Ask AI to change this image…',describe:'Ask a question about the image…',extract:'Extract objects from this source',refine:'Which object should be segmented?', '3d':'Generate a 3D model of the selected image'})[$('captureCommandMode').value];};
 $('captureViewportHint').textContent='LIVE CAMERA · READY TO CAPTURE';
 window.addEventListener('freelab-photo-ready',()=>{requestedCapture=null;inspecting=false;expanded=false;render();$('previewImage').classList.remove('hidden');$('cameraVideo').classList.add('hidden');$('captureViewportHint').textContent='PHOTO IMPORTED · PRESS SHUTTER TO SAVE';});
 $('cameraButton')?.addEventListener('click',()=>load().catch(e=>inform(e.message)));
 const watch=new MutationObserver(()=>{if(!$('cameraPanel').classList.contains('hidden'))load().catch(e=>inform(e.message));});watch.observe($('cameraPanel'),{attributes:true,attributeFilter:['class']});
 render();
}
document.addEventListener('DOMContentLoaded',setup);
})();
