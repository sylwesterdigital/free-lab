/* FREELAB shared-room transport. Render loop is isolated in room-viewer.mjs;
 * state polling does not control the graphics frame rate. No camera pixels are shared. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let own=null, selected=0, pollTimer=null, heartbeatTimer=null, inFlight=false, publishing=false, lastSent=0, retryAfter=0, roomFailures=0;
let roomSnapshot=[], roomFilter='all', roomSort='recent', roomListTimer=null;
let viewer=null, viewerLoad=null;
let lastScene={pose:[0,1.5,0],q:[0,0,0,1],cards:[],shapes:[]};
async function req(path,opts={}){
 const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});
 const body=await r.text();let d;try{d=JSON.parse(body);}catch(_){throw Error('Room server unavailable (HTTP '+r.status+'). Retrying shortly.');}if(!r.ok)throw Error(d.error||'Room HTTP '+r.status);return d;
}
async function start(visibility='private'){
 const r=await req('/rooms/mine',{method:'PUT',body:JSON.stringify({visibility})});own=r.room;return own;
}
function end(){if(!own)return;req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:false,...lastScene,shapes:[]})}).catch(()=>{});}
async function publish(pose,cards,orientation,shapes=[]){
 if(!own||publishing||Date.now()<retryAfter||Date.now()-lastSent<1500)return;
 lastSent=Date.now();lastScene={pose,q:orientation||[0,0,0,1],cards:cards.slice(0,72),shapes:shapes.slice(0,32)};publishing=true;
 try{await req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:true,...lastScene})});roomFailures=0;retryAfter=0;}
 catch(e){roomFailures=Math.min(roomFailures+1,5);retryAfter=Date.now()+Math.min(20000,1500*(2**roomFailures));if(roomFailures===1)console.warn('Room sync paused:',e.message);}finally{publishing=false;}
}
function make(tag,cls,label){
 const element=document.createElement(tag);if(cls)element.className=cls;
 if(label!==undefined)element.textContent=String(label);
 return element;
}
function when(value){
 if(!value)return 'No visits yet';
 const d=new Date(value),ms=d.getTime();if(!Number.isFinite(ms))return 'Not available';
 const elapsed=Date.now()-ms;
 if(elapsed<60_000)return 'Just now';
 if(elapsed<3_600_000)return Math.max(1,Math.floor(elapsed/60_000))+' min ago';
 if(elapsed<86_400_000)return Math.max(1,Math.floor(elapsed/3_600_000))+' hr ago';
 if(elapsed<7*86_400_000)return Math.max(1,Math.floor(elapsed/86_400_000))+' days ago';
 return d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
}
function duration(seconds){
 if(seconds===null||seconds===undefined||!Number.isFinite(Number(seconds)))return '—';
 const n=Math.max(0,Math.round(Number(seconds))),h=Math.floor(n/3600),m=Math.floor((n%3600)/60);
 if(h)return h+'h '+(m?m+'m':'');
 if(m)return m+' min';
 return n?'Less than 1 min':'0 min';
}
function stat(label,value,tip){const cell=make('div','room-stat'),v=make('strong','room-stat-value',value),t=make('span','room-stat-label',label);
 if(tip)v.title=tip;cell.append(v,t);return cell;}
function renderRooms(){
 const box=$('roomList');if(!box)return;
 box.replaceChildren();
 const all=roomSnapshot;
 const live=all.filter(x=>x.active).length;
 const summary=$('roomSummary');if(summary)summary.textContent=all.length+' rooms · '+live+' live now';
 const filters=document.querySelectorAll('[data-room-filter]');
 for(const b of filters)b.setAttribute('aria-pressed',String(b.dataset.roomFilter===roomFilter));
 const visible=all.filter(r=>roomFilter==='all'||roomFilter==='live'&&r.active||roomFilter==='mine'&&r.mine);
 visible.sort((a,b)=>roomSort==='sessions'?(b.session_count||0)-(a.session_count||0):roomSort==='name'?
  String(a.owner).localeCompare(String(b.owner)):
  Number(Boolean(b.active))-Number(Boolean(a.active))||(b.last_accessed_at?Date.parse(b.last_accessed_at):0)-(a.last_accessed_at?Date.parse(a.last_accessed_at):0));
 if(!visible.length){box.append(make('p','room-empty',!all.length?'No rooms yet. Start XR to create your first room.':'No rooms match this filter.'));return;}
 for(const room of visible){
  const row=make('article','room-entry');row.style.setProperty('--room-hue',String(155+(Number(room.id)%7)*20));
  const cover=make('div','room-cover'),ambient=make('div','room-cover-ambient');cover.append(ambient);
  if(room.thumbnail_url&&/^\/api\/rooms\/\d+\/thumbnail$/.test(room.thumbnail_url)){
   const picture=make('img','room-cover-photo');picture.src=room.thumbnail_url;picture.alt='Last shared image from '+room.owner+' room';
   picture.loading='lazy';picture.decoding='async';picture.onerror=()=>picture.remove();cover.append(picture);
  }
  const shade=make('div','room-cover-shade');cover.append(shade);
  const top=make('div','room-cover-top');
  const status=make('span','room-status '+(room.active?'is-live':'is-offline'),room.active?'LIVE':'OFFLINE');
  const visibility=make('span','room-visibility',room.visibility==='private'?'PRIVATE':'PUBLIC');
  top.append(status,visibility);cover.append(top);
  const hero=make('div','room-cover-title');
  hero.append(make('span','room-cover-eyebrow','SPATIAL ROOM'),make('h3','',room.owner));
  if(room.thumbnail_url)hero.append(make('span','room-cover-caption','Last shared image'));
  else hero.append(make('span','room-cover-caption','Private spatial world'));
  cover.append(hero);row.append(cover);
  const body=make('div','room-card-body');
  const details=make('div','room-card-metadata');
  const participants=make('span','room-participant-line',(room.participant_count||0)+' here now · '+(room.media_count||0)+' images');
  const owner=make('span','room-owner-line',room.mine?'YOUR ROOM':room.invited?'INVITED':'SHARED ROOM');
  details.append(owner,participants);body.append(details);
  const stats=make('div','room-stats');
  const last=room.last_accessed_at?new Date(room.last_accessed_at):null;
  stats.append(stat('Last active',when(room.last_accessed_at),last&&Number.isFinite(last.getTime())?last.toLocaleString():''),
    stat('Sessions',room.session_count||0),
    stat('Last session',duration(room.last_session_seconds)),
    stat('Total time',duration(room.total_session_seconds)));
  body.append(stats);
  const actions=make('div','room-card-actions');
  const btn=make('button','room-primary-action',room.joined?'View room':room.invited?'Accept invite':'Join room');
  btn.type='button';btn.onclick=async()=>{
   btn.disabled=true;btn.textContent='Connecting…';
   try{await req('/rooms/'+room.id+'/join',{method:'POST'});await watch(room.id);}
   catch(e){window.FreeLabDialog?.message(e.message);btn.disabled=false;btn.textContent=room.joined?'View room':room.invited?'Accept invite':'Join room';}
  };
  actions.append(btn);body.append(actions);row.append(body);box.append(row);
 }
}
async function list(){
 const r=await req('/rooms');roomSnapshot=Array.isArray(r.rooms)?r.rooms:[];renderRooms();
}
async function invite(){const profiles=(await req('/rooms/users')).users;const box=$('roomInviteList');box.replaceChildren();for(const u of profiles){
 const b=document.createElement('button');b.textContent='Invite @'+u.username;b.onclick=async()=>{
  try{if(!own)await start('private');await req('/rooms/mine/invite',{method:'POST',body:JSON.stringify({user_id:u.id})});b.textContent='Invitation sent';b.disabled=true;}
  catch(e){window.FreeLabDialog?.message(e.message);}
 };box.append(b);
}}
async function ensureViewer(){
 if(viewer)return viewer;
 if(!viewerLoad)viewerLoad=import('/assets/room-viewer.mjs?v=0.10.68').then(m=>m.createRoomViewer({
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
  if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh(id);},1200);
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
 for(const filter of document.querySelectorAll('[data-room-filter]'))filter.onclick=()=>{roomFilter=filter.dataset.roomFilter;renderRooms();};
 $('roomSort').onchange=()=>{roomSort=$('roomSort').value;renderRooms();};
 $('roomsRefresh').onclick=()=>list().catch(e=>window.FreeLabDialog?.message(e.message));
 $('roomButton').onclick=async()=>{
  $('roomsPanel').classList.remove('hidden');
  await list().catch(e=>{const box=$('roomList');if(box)box.textContent='Could not load rooms: '+e.message;});
  await invite().catch(console.warn);
  if(roomListTimer)clearInterval(roomListTimer);
  roomListTimer=setInterval(()=>{if(!$('roomsPanel').classList.contains('hidden')&&$('roomViewer').classList.contains('hidden')&&document.visibilityState!=='hidden')void list().catch(()=>{});},30000);
 };
 $('roomsClose').onclick=()=>{if(roomListTimer)clearInterval(roomListTimer);roomListTimer=null;$('roomsPanel').classList.add('hidden');leave();};$('roomLeave').onclick=leave;
 const chooser=$('roomChooser');$('roomPrivate').onclick=()=>selectXRVisibility('private');
 $('roomPublic').onclick=()=>selectXRVisibility('public');
 $('roomConfirm').onclick=()=>{const visibility=chooser.dataset.visibility||'private';chooser.classList.add('hidden');
  const creating=start(visibility).catch(e=>window.FreeLab?.notify?.('Room setup: '+e.message));
  window.FreeLabXR.start({requireDepth:chooser.dataset.depth==='true'}).catch(e=>{end();window.FreeLab?.notify?.(e.message);});void creating;
 };
 $('roomCancel').onclick=()=>chooser.classList.add('hidden');
}
function selectXRVisibility(value){
 const chooser=$('roomChooser'),isPrivate=value!=='public';chooser.dataset.visibility=isPrivate?'private':'public';
 for(const [id,selected] of [['roomPrivate',isPrivate],['roomPublic',!isPrivate]]){
  const card=$(id);card.classList.toggle('chosen',selected);card.setAttribute('aria-pressed',String(selected));
  const mark=card.querySelector('.room-visibility-select');
  if(mark){mark.textContent=selected?'SELECTED ✓':'CHOOSE THIS ROOM ○';}
 }
 $('roomConfirm').textContent=isPrivate?'Enter private room':'Enter public room';
}
function chooseXR(requireDepth=false){const p=$('roomChooser');p.dataset.depth=String(Boolean(requireDepth));selectXRVisibility('private');p.classList.remove('hidden');}
window.FreeLabRooms={init,chooseXR,previewLocal,start,end,publish,list};
})();
