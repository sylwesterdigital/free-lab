/* FREELAB collaborative rooms v0.10.11: private by default, explicit join and invite.
 * Desktop observer uses perspective projection and polling; it never sends XR camera pixels.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id);let own=null,selected=0,timer=null,lastSent=0,publishing=false,rotation=.38,zoom=1,lastScene={pose:[0,1.5,0],cards:[]};
async function req(path,opts={}){const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'X-Free-Lab':'1',...(opts.body?{'Content-Type':'application/json'}:{})},...opts});const d=await r.json();if(!r.ok)throw Error(d.error||'Room HTTP '+r.status);return d;}
async function start(visibility='private'){const r=await req('/rooms/mine',{method:'PUT',body:JSON.stringify({visibility})});own=r.room;return own;}
function end(){if(!own)return;req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:false,pose:lastScene.pose,cards:lastScene.cards})}).catch(()=>{});}
async function publish(pose,cards){if(!own||publishing||Date.now()-lastSent<1100)return;
 lastSent=Date.now();lastScene={pose,cards:cards.slice(0,72)};publishing=true;try{await req('/rooms/mine/state',{method:'PUT',body:JSON.stringify({active:true,pose,cards:cards.slice(0,72)})});}catch(e){console.warn('Room update:',e.message);}finally{publishing=false;}}
async function list(){const r=await req('/rooms');const box=$('roomList');if(!box)return;
 box.replaceChildren();for(const room of r.rooms){const row=document.createElement('article');row.className='room-entry';const title=document.createElement('strong');title.textContent=room.owner+' · '+(room.active?'LIVE':'OFFLINE')+' · '+room.visibility.toUpperCase();row.append(title);
 const btn=document.createElement('button');btn.textContent=room.joined?'View room':room.invited?'Accept invite':'Join';btn.onclick=async()=>{try{await req('/rooms/'+room.id+'/join',{method:'POST'});await watch(room.id);}catch(e){alert(e.message);}};row.append(btn);box.append(row);}
 if(!r.rooms.length)box.textContent='No rooms yet. Open XR to start yours.';
}
async function invite(){const profiles=(await req('/rooms/users')).users;const box=$('roomInviteList');box.replaceChildren();for(const u of profiles){const b=document.createElement('button');b.textContent='Invite @'+u.username;b.onclick=async()=>{try{if(!own)await start('private');await req('/rooms/mine/invite',{method:'POST',body:JSON.stringify({user_id:u.id})});b.textContent='Invitation sent';b.disabled=true;}catch(e){alert(e.message);}};box.append(b);}}
function draw(state,rid){const canvas=$('roomCanvas');if(!canvas)return;const cw=canvas.width=1000,ch=canvas.height=630,ctx=canvas.getContext('2d');ctx.fillStyle='#141a1a';ctx.fillRect(0,0,cw,ch);
 const sky=ctx.createLinearGradient(0,0,0,ch);sky.addColorStop(0,'#0b131b');sky.addColorStop(1,'#333a39');ctx.fillStyle=sky;ctx.fillRect(0,0,cw,ch);
 const cos=Math.cos(rotation),sin=Math.sin(rotation);
 const project=p=>{let x=p[0],y=p[1],z=p[2];const px=x*cos-z*sin,pz=x*sin+z*cos,depth=8-pz;
  const sc=660*zoom/Math.max(1.2,depth);return [cw/2+px*sc,ch*.67-(y-1)*sc,sc,depth];};
 const line=(a,b,col='#8ca6b4',width=2)=>{const A=project(a),B=project(b);ctx.strokeStyle=col;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(A[0],A[1]);ctx.lineTo(B[0],B[1]);ctx.stroke();};
 // Grey floor grid and a room-sized wireframe volume around live scene.
 for(let v=-6;v<=6;v++){line([-6,0,v],[6,0,v],'#71818124');line([v,0,-6],[v,0,6],'#71818124');}
 for(let i=0;i<80;i++){const x=Math.sin(i*105.31)*3.9,y=1.8+((i*29)%70)/20,z=Math.cos(i*89.32)*4;const P=project([x,y,z]);ctx.fillStyle='#e8eef0'+(i%3?'38':'75');ctx.fillRect(P[0],P[1],1.4,1.4);}
 const verts=[[-2,0,-2],[2,0,-2],[2,0,2],[-2,0,2],[-2,3,-2],[2,3,-2],[2,3,2],[-2,3,2]];
 for(const [i,j] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])line(verts[i],verts[j],'#e8f1ff7a',2);
 const cam=Array.isArray(state.pose)?state.pose:[0,1.5,0];const P=project(cam);ctx.beginPath();ctx.arc(P[0],P[1],8,0,Math.PI*2);ctx.fillStyle='#ed9bbf';ctx.fill();ctx.font='16px system-ui';ctx.fillText('HEADSET',P[0]+12,P[1]-10);
 const cards=(state.cards||[]).map(c=>({...c,screen:project(c.p)})).sort((a,b)=>b.screen[3]-a.screen[3]);
 for(const c of cards){const [x,y,sc]=c.screen,w=Math.min(190,Math.max(40,sc*.72)),h=w*.7;ctx.fillStyle='#253a35';ctx.strokeStyle='#95d3bf';ctx.lineWidth=2;ctx.fillRect(x-w/2,y-h/2,w,h);ctx.strokeRect(x-w/2,y-h/2,w,h);
  const key=c.kind+':'+c.id;let cached=draw.images.get(key);
  if(!cached){cached=new Image();cached.src='/api/rooms/'+rid+'/media/'+c.kind+'/'+c.id;draw.images.set(key,cached);}
  if(cached.complete&&cached.naturalWidth){ctx.drawImage(cached,x-w/2+2,y-h/2+2,w-4,h-4);}
 }
 ctx.fillStyle='#dae9e2';ctx.font='16px system-ui';ctx.fillText(cards.length+' spatial images · drag to orbit · wheel to zoom',28,35);
}
draw.images=new Map();
async function refresh(){if(!selected)return;try{const data=await req('/rooms/'+selected+'/state');draw(data.scene,selected);$('roomState').textContent=(data.room.active?'LIVE':'NOT LIVE')+' · last update '+data.room.updated_at;}catch(e){$('roomState').textContent=e.message;clearInterval(timer);timer=null;}}
async function watch(id){selected=id;draw.images.clear();$('roomViewer').classList.remove('hidden');$('roomLobby').classList.add('hidden');await refresh();if(timer)clearInterval(timer);timer=setInterval(refresh,1500);}
function leave(){selected=0;clearInterval(timer);timer=null;$('roomViewer').classList.add('hidden');$('roomLobby').classList.remove('hidden');list().catch(()=>{});}
function init(){const btn=$('roomButton');if(!btn)return;btn.onclick=async()=>{$('roomsPanel').classList.remove('hidden');await list().catch(console.warn);await invite().catch(console.warn);};
 $('roomsClose').onclick=()=>{$('roomsPanel').classList.add('hidden');leave();};$('roomLeave').onclick=leave;
 const canvas=$('roomCanvas');let down=null;canvas.addEventListener('pointerdown',e=>{down=e.clientX;canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(down===null)return;rotation+=(e.clientX-down)*.006;down=e.clientX;});canvas.addEventListener('pointerup',()=>down=null);canvas.addEventListener('wheel',e=>{zoom=Math.max(.6,Math.min(1.8,zoom+(e.deltaY<0?.06:-.06)));e.preventDefault();},{passive:false});
 const chooser=$('roomChooser');$('roomPrivate').onclick=()=>{chooser.dataset.visibility='private';$('roomPrivate').classList.add('chosen');$('roomPublic').classList.remove('chosen');};$('roomPublic').onclick=()=>{chooser.dataset.visibility='public';$('roomPublic').classList.add('chosen');$('roomPrivate').classList.remove('chosen');};
 $('roomConfirm').onclick=()=>{const visibility=chooser.dataset.visibility||'private';
  chooser.classList.add('hidden'); // XR request remains in the original user-activation path.
  const creating=start(visibility).catch(e=>window.FreeLab?.notify?.('Room setup: '+e.message));
  window.FreeLabXR.start().catch(e=>{end();window.FreeLab?.notify?.(e.message);});
  void creating;
 };
 $('roomCancel').onclick=()=>chooser.classList.add('hidden');
}
function chooseXR(){const p=$('roomChooser');p.dataset.visibility='private';$('roomPrivate').classList.add('chosen');$('roomPublic').classList.remove('chosen');p.classList.remove('hidden');}
window.FreeLabRooms={init,chooseXR,start,end,publish,list};
})();
