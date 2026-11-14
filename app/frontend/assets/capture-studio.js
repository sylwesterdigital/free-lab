/* FREELAB v0.10.15 — one phone-sized workspace for the same authenticated
 * source/branch operations used in XR. No automatic inference or image upload. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let clouds=[],chosen=null,busy=false,expanded=true,requestedCapture=null;
const FL=()=>window.FreeLab;
const inform=message=>{const hint=$('captureStatus');if(hint)hint.textContent=message;FL()?.notify?.(message);};
const kindLabel=item=>item.type==='capture'?'SOURCE PHOTO':'SEGMENT / BRANCH';
function getItem(key){for(const cloud of clouds){if(`capture:${cloud.id}`===key)return {type:'capture',cid:cloud.id,record:cloud,cloud};
  for(const o of cloud.objects||[])if(`object:${o.id}`===key)return {type:'object',cid:cloud.id,oid:o.id,record:o,cloud};}return null;}
function node(container,item,depth=0){const button=document.createElement('button');button.type='button';button.className='capture-node';
 button.classList.toggle('selected',chosen===`${item.type}:${item.record.id}`);button.style.setProperty('--branch-depth',String(Math.min(depth,6)));
 const image=document.createElement('img');image.loading='lazy';image.alt='';image.src=item.type==='capture'?item.record.image_url:'/api/objects/'+item.record.id+'/image';
 const detail=document.createElement('span');detail.className='capture-node-copy';
 const title=document.createElement('strong');title.textContent=item.type==='capture'?'SOURCE '+item.cid:(item.record.label||'Segment');
 const subtitle=document.createElement('small');subtitle.textContent=item.type==='capture'?(item.record.description||'Tap to inspect source'):(item.record.description||'Tap to continue branch');
 detail.append(title,subtitle);button.append(image,detail);button.onclick=()=>{chosen=`${item.type}:${item.record.id}`;render();};container.append(button);
}
function render(){const box=$('captureTree');box.replaceChildren();if(!clouds.length){const empty=document.createElement('p');empty.className='capture-tree-empty';empty.textContent='Capture your first source to grow its segments. Nothing is automatically uploaded.';box.append(empty);}
 for(const cloud of clouds){const group=document.createElement('section');group.className='capture-cloud';const header=document.createElement('div');header.className='capture-cloud-head';const n=document.createElement('span');n.textContent='SOURCE '+cloud.id+' · '+(cloud.objects||[]).length+' BRANCHES';header.append(n);group.append(header);
  node(group,{type:'capture',cid:cloud.id,record:cloud,cloud});
  const branchBox=document.createElement('div');branchBox.className='capture-branches';
  const byParent=new Map();const descendants=new Set();for(const o of (cloud.objects||[]).filter(x=>x.shelf!=='bin')){const parent=(Number.isInteger(o.parent_object_id)&&o.parent_object_id>0)?o.parent_object_id:0;
   if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(o);}
  function addBranch(parent,depth){for(const obj of byParent.get(parent)||[]){if(descendants.has(obj.id))continue;descendants.add(obj.id);
    node(branchBox,{type:'object',cid:cloud.id,oid:obj.id,record:obj,cloud},depth);addBranch(obj.id,depth+1);}}
  addBranch(0,0);for(const obj of cloud.objects||[])if(!descendants.has(obj.id)){node(branchBox,{type:'object',cid:cloud.id,oid:obj.id,record:obj,cloud},0);}
  group.append(branchBox);box.append(group);
 }
 const item=chosen&&getItem(chosen);$('captureSelection').classList.toggle('hidden',!item);
 if(item){$('captureSelectedLabel').textContent=item.type==='capture'?'Source '+item.cid:item.record.label||'Segment';
  $('captureSelectedKind').textContent=kindLabel(item);$('captureSelectedDescription').textContent=item.record.description||'Select an action to explore or grow this image.';
  $('captureRefineRow').classList.add('hidden');$('captureDescribe').textContent='DESCRIBE';}
 $('captureWorkbench').classList.toggle('minimized',!expanded);
 $('captureGridToggle').textContent=expanded?'Hide grid':'Show grid';
}
async function load(choose=null){if(!FL()?.getState()?.user)return;const data=await FL().listXRClouds();clouds=(data||[]).filter(c=>c.id>0&&!c.hidden);if(choose)chosen=choose;
 if(chosen&&!getItem(chosen))chosen=null;if(!chosen&&clouds.length)chosen='capture:'+clouds[0].id;render();}
async function execute(job,message){if(busy)return;busy=true;const ids=['captureShutter','captureRecognize','captureRefineApply','captureDescribe','captureMake3D'];
 for(const id of ids)$(id).disabled=true;try{if(message)$('captureStatus').textContent=message;await job();}
 catch(e){inform(e.message||String(e));}finally{busy=false;for(const id of ids)$(id).disabled=false;}}
async function ensureFrame(item){if(item.type==='capture'&&requestedCapture!==item.cid){await FL().useXRFrame(item.record.image_url);requestedCapture=item.cid;}}
async function saveSource(){const app=FL();const state=app.getState();let frame=state.snapshot;
 if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)&&state.snapshotOrigin!=='upload')frame=app.snapshot();
 if(!frame)throw Error('Allow the camera or import a photo before capturing');
 const result=await app.api('/captures',{method:'POST',body:JSON.stringify({image:frame})});requestedCapture=result.id;
 $('captureViewportHint').textContent='CAPTURE STORED · SELECT EXTRACT TO GROW SEGMENTS';
 expanded=true;await load('capture:'+result.id);inform('Source '+result.id+' saved privately. EXTRACT begins an explicit AI request.');
}
function selected(){const item=chosen&&getItem(chosen);if(!item)throw Error('Take a photo or select a saved source first');return item;}
function paid(action){return window.confirm(action+' sends a request to an external AI provider and may incur charges. Continue?');}
async function recognize(){const item=selected();if(!paid('EXTRACT'))return;
 await execute(async()=>{await ensureFrame(item);const result=await FL().recognizeXR(item.cid,item.oid||null,true);
  await load(chosen);inform('Extracted '+(result.items||[]).length+' segments. Select any segment to branch again.');},'Extracting objects with Meta + SAM…');}
async function segment(){const item=selected();const noun=$('captureRefineText').value.trim();if(noun.length<2){inform('Enter an object to segment, e.g. chair');return;}
 if(!paid('REFINE'))return;await execute(async()=>{await ensureFrame(item);const r=await FL().segmentXR(item.cid,noun,item.oid||null,true);await load(chosen);
 inform('Created '+(r.items||[]).length+' private child segments.');},'Creating cutouts with SAM…');}
async function describe(){const item=selected();if(!paid('DESCRIBE'))return;await execute(async()=>{
 const result=await FL().describeXR(item.cid,item.oid||null,'',false);const area=$('captureDescriptionResult');area.textContent=result.description||'No description returned';area.classList.remove('hidden');
 inform(result.cached?'Loaded saved description':'Description saved to source dialogue');},'Describing selected image…');}
function promptEditor(voice=false){const item=selected();FL().openPromptEditor({captureId:item.cid,objectId:item.oid||null,label:item.record.label||'source'},'',async()=>{
 await load(chosen);inform('New image generated. Select it in the branch grid.');});
 if(voice){$('xrPromptVoice').focus();inform('Press VOICE in the editor to record, then stop to transcribe. Applying an edit is a separate request.');}}
async function generate3D(){const item=selected();if(!window.confirm('Submit a paid image-to-3D job for this selected source or segment?'))return;
 await execute(async()=>{const result=await FL().createXR3D(item.cid,item.oid||null);inform('3D job '+result.id+' submitted. Check its status in Collection → Your 3D Models.');},'Submitting 3D job…');}
function theater(){const item=selected();const url=item.type==='capture'?item.record.image_url:'/api/objects/'+item.record.id+'/image';
 $('galleryImage').src=url;$('galleryTitle').textContent=item.record.label||'Source '+item.cid;$('galleryDetail').textContent=item.record.description||kindLabel(item);
 $('galleryFilmstrip').replaceChildren();$('desktopGallery').classList.remove('hidden');}
function openForUpload(){if($('cameraPanel').classList.contains('hidden'))$('cameraPanel').classList.remove('hidden');expanded=true;render();}
function beginNew(){const state=FL().getState();requestedCapture=null;
 if(state.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted)){FL().resumeCamera();$('captureViewportHint').textContent='LIVE CAMERA · CAPTURE A NEW SOURCE';}
 else{$('fileInput').click();} }
function setup(){if(!$('captureShutter'))return;
 $('captureShutter').onclick=()=>execute(saveSource,'Saving private source…');
 $('captureNewSource').onclick=beginNew;$('captureUpload').onclick=()=>$('fileInput').click();
 $('captureGridToggle').onclick=()=>{expanded=!expanded;render();};$('captureReload').onclick=()=>execute(()=>load(),'Refreshing sources…');
 $('captureRecognize').onclick=recognize;$('captureDescribe').onclick=describe;
 $('captureRefine').onclick=()=>{$('captureRefineRow').classList.toggle('hidden');$('captureRefineText').focus();};
 $('captureRefineApply').onclick=segment;$('capturePrompt').onclick=()=>promptEditor(false);$('captureVoice').onclick=()=>promptEditor(true);
 $('captureMake3D').onclick=generate3D;$('captureTheater').onclick=theater;
 window.addEventListener('freelab-photo-ready',()=>{requestedCapture=null;$('captureViewportHint').textContent='PHOTO READY · PRESS CAPTURE TO SAVE AS SOURCE';openForUpload();});
 $('cameraButton')?.addEventListener('click',()=>load().catch(e=>inform(e.message)));
 const watch=new MutationObserver(()=>{if(!$('cameraPanel').classList.contains('hidden')){load().catch(()=>{});}});
 watch.observe($('cameraPanel'),{attributes:true,attributeFilter:['class']});
}
document.addEventListener('DOMContentLoaded',setup);
})();
