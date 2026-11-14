/* FREELAB shared-room transport. Render loop is isolated in room-viewer.mjs;
 * state polling does not control the graphics frame rate. No camera pixels are shared. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let own=null, selected=0, pollTimer=null, heartbeatTimer=null, inFlight=false, publishing=false, lastSent=0;
let viewer=null, viewerLoad=null;
let lastScene={pose:[0,1.5,0],q:[0,0,0,1],cards:[],shapes:[]};
async function req(path,opts={}){
 const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Room HTTP '+r.status);return d;
}
async function start(visibility='private'){
 const r=await req('/rooms/mine',{method:'PUT',body:JSON.stringify({visibility})});own=r.room;return own;
}
function end(){if(!own)return;req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:false,...lastScene,shapes:[]})}).catch(()=>{});}
async function publish(pose,cards,orientation,shapes=[]){
 if(!own||publishing||Date.now()-lastSent<250)return;
 lastSent=Date.now();lastScene={pose,q:orientation||[0,0,0,1],cards:cards.slice(0,72),shapes:shapes.slice(0,32)};publishing=true;
 try{await req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:true,...lastScene})});}
 catch(e){console.warn('Room update:',e.message);}finally{publishing=false;}
}
async function list(){const r=await req('/rooms');const box=$('roomList');if(!box)return;
 box.replaceChildren();for(const room of r.rooms){
  const row=document.createElement('article');row.className='room-entry';
  const title=document.createElement('strong');title.textContent=room.owner+' · '+(room.active?'LIVE':'OFFLINE')+' · '+room.visibility.toUpperCase();row.append(title);
  const btn=document.createElement('button');btn.textContent=room.joined?'View room':room.invited?'Accept invite':'Join';
  btn.onclick=async()=>{try{await req('/rooms/'+room.id+'/join',{method:'POST'});await watch(room.id);}catch(e){window.FreeLabDialog?.message(e.message);}};
  row.append(btn);box.append(row);
 }
 if(!r.rooms.length)box.textContent='No rooms yet. Open XR to start yours.';
}
async function invite(){const profiles=(await req('/rooms/users')).users;const box=$('roomInviteList');box.replaceChildren();for(const u of profiles){
 const b=document.createElement('button');b.textContent='Invite @'+u.username;b.onclick=async()=>{
  try{if(!own)await start('private');await req('/rooms/mine/invite',{method:'POST',body:JSON.stringify({user_id:u.id})});b.textContent='Invitation sent';b.disabled=true;}
  catch(e){window.FreeLabDialog?.message(e.message);}
 };box.append(b);
}}
async function ensureViewer(){
 if(viewer)return viewer;
 if(!viewerLoad)viewerLoad=import('/assets/room-viewer.mjs?v=0.10.19').then(m=>m.createRoomViewer({
  canvas:$('roomCanvas'),inspector:$('roomInspector'),viewer:$('roomViewer'),
  status:$('roomState'),count:$('roomImageCount'),back:()=>leave(),
 })).catch(e=>{viewerLoad=null;throw e;});
 viewer=await viewerLoad;return viewer;
}
async function refresh(id){if(selected!==id||inFlight)return;inFlight=true;
 try{const data=await req('/rooms/'+id+'/state');if(selected!==id)return;
  viewer?.setState(data.scene,id,data.room);
  $('roomState').textContent=data.room.active?'LIVE · connected':'PAUSED · last room state';
  $('roomImageCount').textContent=(data.scene?.cards?.length||0)+' images';
 }catch(e){if(selected===id)$('roomState').textContent='Connection: '+e.message;}
 finally{inFlight=false;}
}
async function watch(id){
 selected=id;await req('/rooms/'+id+'/presence',{method:'POST'});$('roomViewer').classList.remove('hidden');$('roomLobby').classList.add('hidden');
 $('roomsPanel').classList.add('room-in-session');$('roomState').textContent='Loading 3D room…';
 try{const v=await ensureViewer();if(selected!==id)return;v.start();await refresh(id);
  if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh(id);},350);
  if(heartbeatTimer)clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{if(document.visibilityState!=='hidden'&&selected===id)void req('/rooms/'+id+'/presence',{method:'POST'}).catch(()=>{});},8000);
 }catch(e){$('roomState').textContent='3D viewer unavailable: '+e.message;console.error(e);}
}
async function previewLocal(){
 const clouds=await window.FreeLab.listXRClouds();
 const cards=[];let sourceIndex=0;
 for(const source of (clouds||[]).filter(x=>!x.hidden).slice(0,10)){
  const cx=(sourceIndex%5-2)*1.9,cy=1.7+Math.floor(sourceIndex/5)*1.5;
  cards.push({kind:'capture',id:source.id,p:[cx,cy,-1.2],q:[0,0,0,1],label:'Source '+source.id,description:source.description||'',image_url:source.image_url});
  let i=0;for(const child of (source.objects||[]).filter(x=>x.shelf!=='bin').slice(0,6)){
   const angle=(i%7)*.82-2.4,r=1.1+(Math.floor(i/7)*.8);
   cards.push({kind:'object',id:child.id,p:[cx+Math.sin(angle)*r,cy+.9+Math.cos(angle)*.35,-1.2-.5*r],q:[0,0,0,1],label:child.label||'Segment',description:child.description||'',image_url:'/api/objects/'+child.id+'/image'});i++;
  }sourceIndex++;
 }
 if(!cards.length){window.FreeLab.notify('Capture a source first, then choose Enter 3D to explore its branches.');window.FreeLab.openCamera();return;}
 selected=0;$('roomsPanel').classList.remove('hidden');$('roomViewer').classList.remove('hidden');$('roomLobby').classList.add('hidden');$('roomsPanel').classList.add('room-in-session');
 const v=await ensureViewer();v.start();v.setState({pose:[0,1.5,0],q:[0,0,0,1],cards,shapes:[]},'local-preview',{active:false,visibility:'private'});
 $('roomState').textContent='PRIVATE · BROWSER 3D';$('roomImageCount').textContent=cards.length+' images';
}
function leave(){const old=selected;selected=0;if(pollTimer)clearInterval(pollTimer);pollTimer=null;if(heartbeatTimer)clearInterval(heartbeatTimer);heartbeatTimer=null;if(old)void req('/rooms/'+old+'/presence',{method:'DELETE'}).catch(()=>{});
 viewer?.stop();$('roomViewer').classList.add('hidden');$('roomLobby').classList.remove('hidden');
 $('roomsPanel').classList.remove('room-in-session');void list().catch(()=>{});
}
function init(){if(!$('roomButton'))return;
 $('roomButton').onclick=async()=>{$('roomsPanel').classList.remove('hidden');await list().catch(console.warn);await invite().catch(console.warn);};
 $('roomsClose').onclick=()=>{$('roomsPanel').classList.add('hidden');leave();};$('roomLeave').onclick=leave;
 const chooser=$('roomChooser');$('roomPrivate').onclick=()=>{chooser.dataset.visibility='private';$('roomPrivate').classList.add('chosen');$('roomPublic').classList.remove('chosen');};
 $('roomPublic').onclick=()=>{chooser.dataset.visibility='public';$('roomPublic').classList.add('chosen');$('roomPrivate').classList.remove('chosen');};
 $('roomConfirm').onclick=()=>{const visibility=chooser.dataset.visibility||'private';chooser.classList.add('hidden');
  const creating=start(visibility).catch(e=>window.FreeLab?.notify?.('Room setup: '+e.message));
  window.FreeLabXR.start({requireDepth:chooser.dataset.depth==='true'}).catch(e=>{end();window.FreeLab?.notify?.(e.message);});void creating;
 };
 $('roomCancel').onclick=()=>chooser.classList.add('hidden');
}
function chooseXR(requireDepth=false){const p=$('roomChooser');p.dataset.depth=String(Boolean(requireDepth));p.dataset.visibility='private';$('roomPrivate').classList.add('chosen');$('roomPublic').classList.remove('chosen');p.classList.remove('hidden');}
window.FreeLabRooms={init,chooseXR,previewLocal,start,end,publish,list};
})();
