/* FREELAB shared-room transport. Render loop is isolated in room-viewer.mjs;
 * state polling does not control the graphics frame rate. No camera pixels are shared. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let own=null, selected=0, pollTimer=null, inFlight=false, publishing=false, lastSent=0;
let viewer=null, viewerLoad=null;
let lastScene={pose:[0,1.5,0],q:[0,0,0,1],cards:[]};
async function req(path,opts={}){
 const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Room HTTP '+r.status);return d;
}
async function start(visibility='private'){
 const r=await req('/rooms/mine',{method:'PUT',body:JSON.stringify({visibility})});own=r.room;return own;
}
function end(){if(!own)return;req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:false,...lastScene})}).catch(()=>{});}
async function publish(pose,cards,orientation){
 if(!own||publishing||Date.now()-lastSent<250)return;
 lastSent=Date.now();lastScene={pose,q:orientation||[0,0,0,1],cards:cards.slice(0,72)};publishing=true;
 try{await req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:true,...lastScene})});}
 catch(e){console.warn('Room update:',e.message);}finally{publishing=false;}
}
async function list(){const r=await req('/rooms');const box=$('roomList');if(!box)return;
 box.replaceChildren();for(const room of r.rooms){
  const row=document.createElement('article');row.className='room-entry';
  const title=document.createElement('strong');title.textContent=room.owner+' · '+(room.active?'LIVE':'OFFLINE')+' · '+room.visibility.toUpperCase();row.append(title);
  const btn=document.createElement('button');btn.textContent=room.joined?'View room':room.invited?'Accept invite':'Join';
  btn.onclick=async()=>{try{await req('/rooms/'+room.id+'/join',{method:'POST'});await watch(room.id);}catch(e){alert(e.message);}};
  row.append(btn);box.append(row);
 }
 if(!r.rooms.length)box.textContent='No rooms yet. Open XR to start yours.';
}
async function invite(){const profiles=(await req('/rooms/users')).users;const box=$('roomInviteList');box.replaceChildren();for(const u of profiles){
 const b=document.createElement('button');b.textContent='Invite @'+u.username;b.onclick=async()=>{
  try{if(!own)await start('private');await req('/rooms/mine/invite',{method:'POST',body:JSON.stringify({user_id:u.id})});b.textContent='Invitation sent';b.disabled=true;}
  catch(e){alert(e.message);}
 };box.append(b);
}}
async function ensureViewer(){
 if(viewer)return viewer;
 if(!viewerLoad)viewerLoad=import('/assets/room-viewer.mjs?v=0.10.15').then(m=>m.createRoomViewer({
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
 selected=id;$('roomViewer').classList.remove('hidden');$('roomLobby').classList.add('hidden');
 $('roomsPanel').classList.add('room-in-session');$('roomState').textContent='Loading 3D room…';
 try{const v=await ensureViewer();if(selected!==id)return;v.start();await refresh(id);
  if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh(id);},350);
 }catch(e){$('roomState').textContent='3D viewer unavailable: '+e.message;console.error(e);}
}
function leave(){selected=0;if(pollTimer)clearInterval(pollTimer);pollTimer=null;
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
  window.FreeLabXR.start().catch(e=>{end();window.FreeLab?.notify?.(e.message);});void creating;
 };
 $('roomCancel').onclick=()=>chooser.classList.add('hidden');
}
function chooseXR(){const p=$('roomChooser');p.dataset.visibility='private';$('roomPrivate').classList.add('chosen');$('roomPublic').classList.remove('chosen');p.classList.remove('hidden');}
window.FreeLabRooms={init,chooseXR,start,end,publish,list};
})();
