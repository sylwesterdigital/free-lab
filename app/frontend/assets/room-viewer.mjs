/* FREELAB immersive desktop rooms: real-time Three.js scene, independent 60Hz-capable
 * requestAnimationFrame rendering, interpolated network pose, fly/orbit navigation.
 * Authenticated images are retrieved only from the room's media endpoint. */

let THREE;
async function loadThree(){
 if(THREE)return THREE;
 let failure;
 for(const url of ['https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js','https://unpkg.com/three@0.181.0/build/three.module.js']){
  try{THREE=await import(url);return THREE;}catch(e){failure=e;}
 }
 throw new Error('Three.js could not load. Check connection to the module CDN. '+(failure?.message||''));
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rounded=(n)=>Number.isFinite(n)?n.toFixed(1):'0';
const identifier=c=>`${c.kind}:${c.id}`;
const validPoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const text=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
function makeLabel(THREE,label,accent='#abe6ca'){
 const cv=document.createElement('canvas');cv.width=768;cv.height=136;const ctx=cv.getContext('2d');
 ctx.fillStyle='rgba(20,36,31,.94)';ctx.fillRect(0,0,768,136);
 ctx.fillStyle=accent;ctx.fillRect(0,0,6,136);
 ctx.font='600 36px system-ui,sans-serif';ctx.fillStyle='#e3eee8';
 const title=String(label||'Image').slice(0,42);ctx.fillText(title,26,62,704);
 ctx.font='400 24px system-ui,sans-serif';ctx.fillStyle='#94baa8';ctx.fillText('SELECT TO INSPECT',26,110);
 const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
 sprite.scale.set(.72,.127,1);sprite.userData.ownedTexture=tex;return sprite;
}
function headsetLabel(THREE){
 const cv=document.createElement('canvas');cv.width=512;cv.height=128;const ctx=cv.getContext('2d');
 ctx.font='700 46px system-ui';ctx.textAlign='center';ctx.fillStyle='#f0c2db';ctx.fillText('HEADSET',256,65);
 const tex=new THREE.CanvasTexture(cv);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
 sprite.position.y=.37;sprite.scale.set(.58,.145,1);return sprite;
}
function createStars(THREE){
 let seed=7719;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const p=[];for(let i=0;i<460;i++){const a=rand()*Math.PI*2,h=.9+rand()*23,r=8+rand()*35;p.push(Math.sin(a)*r,h,Math.cos(a)*r);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
 return new THREE.Points(g,new THREE.PointsMaterial({color:0xaec9c9,size:.038,transparent:true,opacity:.56,sizeAttenuation:true,depthWrite:false}));
}
function cameraModel(THREE){
 const root=new THREE.Group();const shade=new THREE.MeshStandardMaterial({color:0xeda9cf,metalness:.29,roughness:.42});
 const base=new THREE.Mesh(new THREE.SphereGeometry(.15,24,14),shade);root.add(base);
 const visor=new THREE.Mesh(new THREE.BoxGeometry(.28,.12,.105),new THREE.MeshStandardMaterial({color:0x18282d,roughness:.18,metalness:.65}));visor.position.set(0,.005,-.119);root.add(visor);
 const rim=new THREE.Mesh(new THREE.BoxGeometry(.30,.017,.12),new THREE.MeshBasicMaterial({color:0xffb1d1}));rim.position.set(0,.072,-.118);root.add(rim);
 const gaze=new THREE.Mesh(new THREE.ConeGeometry(.07,.24,16),new THREE.MeshStandardMaterial({color:0xc6ffde,transparent:true,opacity:.9,roughness:.3}));
 gaze.rotation.x=-Math.PI/2;gaze.position.z=-.29;root.add(gaze);root.add(headsetLabel(THREE));return root;
}
function createCard(THREE,roomId,card,onPick){
 const group=new THREE.Group();const w=.72,h=.47;
 const panel=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:0x182924,side:THREE.DoubleSide,transparent:true,opacity:.89,depthWrite:false}));
 panel.userData.key=identifier(card);group.add(panel);
 const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w,h)),new THREE.LineBasicMaterial({color:card.kind==='capture'?0xffa9d1:0x98dfc2,transparent:true,opacity:.76}));
 outline.position.z=.007;group.add(outline);
 const image=new THREE.Mesh(new THREE.PlaneGeometry(w-.032,h-.032),new THREE.MeshBasicMaterial({color:0xbfcfc9,side:THREE.DoubleSide,transparent:true,depthWrite:false}));
 image.position.z=.012;image.userData.key=identifier(card);group.add(image);
 const title=makeLabel(THREE,card.label||(card.kind==='capture'?'Capture':'Segment'),card.kind==='capture'?'#ffb6d4':'#a3eed1');title.position.set(0,-.31,.026);title.visible=false;group.add(title); // fixed-size captions now live in the HTML overlay
 group.position.set(...card.p);group.userData.key=identifier(card);group.userData.card=card;
 const src=card.image_url||'/api/rooms/'+encodeURIComponent(roomId)+'/media/'+card.kind+'/'+card.id;
 const photo=new Image();photo.decoding='async';
 photo.onload=()=>{
  if(!photo.naturalWidth||!group.parent)return;
  const scale=Math.min(1,960/Math.max(photo.naturalWidth,photo.naturalHeight));const cv=document.createElement('canvas');
  cv.width=Math.max(1,Math.floor(photo.naturalWidth*scale));cv.height=Math.max(1,Math.floor(photo.naturalHeight*scale));
  cv.getContext('2d',{alpha:true}).drawImage(photo,0,0,cv.width,cv.height);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=4;image.material.map?.dispose();image.material.map=tex;image.material.color.set(0xffffff);image.material.needsUpdate=true;
  const aspect=photo.naturalWidth/photo.naturalHeight;
  image.scale.set(Math.min(1,aspect*1.42),Math.min(1,1.42/aspect),1);
 };
 photo.onerror=()=>{image.material.color.set(0x4b5552);};photo.src=src;
 group.userData.hits=[panel,image];group.userData.outline=outline;group.userData.title=title;
 return group;
}
function disposeCard(group){group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.map?.dispose();m.dispose();}}});}

export async function createRoomViewer({canvas,inspector,viewer,status,count,back}){
 const T=await loadThree();
 const labelsLayer=document.getElementById('roomLabels');
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;
 const scene=new T.Scene();scene.background=new T.Color(0x0a1219);scene.fog=new T.FogExp2(0x111e25,.021);
 const camera=new T.PerspectiveCamera(60,1,.025,160);camera.position.set(2.8,2.6,6.2);
 scene.add(new T.HemisphereLight(0xc4eaf2,0x14251c,1.5));
 const light=new T.DirectionalLight(0xf0ffe9,1.55);light.position.set(-3,8,4);scene.add(light);
 const grid=new T.GridHelper(38,38,0x4d7167,0x2b4443);grid.material.transparent=true;grid.material.opacity=.28;scene.add(grid);
 const ground=new T.Mesh(new T.PlaneGeometry(160,160),new T.MeshBasicMaterial({color:0x142123,transparent:true,opacity:.18,depthWrite:false}));
 ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground);
 const stars=createStars(T);scene.add(stars);
 const roomEdges=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(5,3.6,5)),new T.LineBasicMaterial({color:0xaabcca,transparent:true,opacity:.40}));scene.add(roomEdges);
 const poseGroup=cameraModel(T);scene.add(poseGroup);poseGroup.position.set(0,1.55,0);
 const avatarTarget=new T.Vector3(0,1.55,0),avatarQuat=new T.Quaternion();
 const cards=new Map(),links=new Map(),hits=[],sharedShapes=[];let shapeKey='';
 const aim=new T.Vector3(0,1.5,0),orbit={yaw:.48,pitch:.22,radius:6.2,vyaw:0,vpitch:0,pan:new T.Vector3()};
 let selected=null,roomId=null,active=false,raf=0,lastFrame=0,mode='orbit',hover=null,pointers=new Map(),dragTravel=0;
 const keys=new Set();const raycaster=new T.Raycaster();const mouse=new T.Vector2();
 let fpsStart=0,fpsFrames=0,lastFps=0;const screenPoint=new T.Vector3();
 const button=(id,fn)=>{const b=document.getElementById(id);if(b)b.onclick=fn;return b;};
 const $=id=>document.getElementById(id);
 function select(key){selected=key;
  for(const label of labelsLayer?.children||[])label.classList.toggle('selected',label.dataset.key===key);for(const [k,g] of cards){g.userData.outline.material.color.set(k===key?0xffdc8e:g.userData.card.kind==='capture'?0xffa9d1:0x98dfc2);g.userData.outline.material.opacity=k===key?1:.76;}
  const node=key&&cards.get(key)?.userData.card;
  if(!node){inspector.classList.add('hidden');return;}
  $('roomInspectTitle').textContent=node.label||'Spatial image';
  $('roomInspectType').textContent=node.kind==='capture'?'SOURCE PHOTO':'EXTRACTED OBJECT';
  $('roomInspectDescription').textContent=node.description?.trim()||'No description saved yet.';
  $('roomInspectImage').src=node.image_url||'/api/rooms/'+roomId+'/media/'+node.kind+'/'+node.id;
  const relatives=$('roomInspectRelatives');relatives.replaceChildren();
  const parent=parentKey(node);if(parent&&cards.has(parent))addRelation(relatives,'↑ Parent',parent);
  for(const [k,g] of cards)if(parentKey(g.userData.card)===key)addRelation(relatives,'↳ '+(g.userData.card.label||'Child'),k);
  $('roomInspectMeta').textContent=(node.kind==='object'?'Branch segment':'Captured source')+' · '+(node.created_at||'Saved media');
  inspector.classList.remove('hidden');
 }
 function addRelation(container,label,key){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{select(key);focusOn(key);};container.append(b);}
 function orderedKeys(){return [...cards.keys()];}
 function cycleSelected(step=1){const ks=orderedKeys();if(!ks.length)return;const pos=Math.max(0,ks.indexOf(selected));const next=ks[(pos+step+ks.length)%ks.length];select(next);focusOn(next);if(!$('roomImageLightbox').classList.contains('hidden'))$('roomImageLarge').src=$('roomInspectImage').src;}
 function parentKey(c){return c.kind==='object'&&(Number.isInteger(c.parent_object_id)?c.parent_object_id>0:false)?'object:'+c.parent_object_id:
  c.kind==='object'&&Number.isInteger(c.capture_id)&&c.capture_id>0?'capture:'+c.capture_id:null;}
 function focusOn(key){const g=cards.get(key);if(!g)return;
  aim.copy(g.position);if(mode==='orbit'){orbit.radius=clamp(orbit.radius,1.25,7);}
  else{camera.position.copy(g.position).add(new T.Vector3(.15,.08,1.5));camera.lookAt(g.position);}
 }
 function pick(x,y){const r=canvas.getBoundingClientRect();mouse.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);
  raycaster.setFromCamera(mouse,camera);const intersections=raycaster.intersectObjects(hits,false);
  return intersections.length?intersections[0].object.userData.key:null;
 }
 function addScreenLabel(key,g){if(!labelsLayer)return;
  const label=document.createElement('div');label.className='room-world-label';label.dataset.key=key;
  const heading=document.createElement('strong');heading.textContent=g.userData.card.label||(g.userData.card.kind==='capture'?'Source image':'Segment');
  const desc=document.createElement('span');desc.textContent=g.userData.card.description||'';
  label.append(heading,desc);labelsLayer.append(label);g.userData.htmlLabel=label;
 }
 function updateScreenLabels(){if(!labelsLayer)return;
  const bounds=canvas.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  for(const g of cards.values()){const el=g.userData.htmlLabel;if(!el)continue;
   screenPoint.copy(g.position);screenPoint.y-=.37;screenPoint.project(camera);
   const visible=screenPoint.z<1&&screenPoint.z>-1&&Math.abs(screenPoint.x)<1.20&&Math.abs(screenPoint.y)<1.12;
   el.style.display=visible?'flex':'none';if(!visible)continue;
   el.style.transform=`translate3d(${((screenPoint.x+1)*.5*bounds.width).toFixed(1)}px,${((-screenPoint.y+1)*.5*bounds.height).toFixed(1)}px,0) translate(-50%,0)`;
  }
 }
 function rebuildLinks(){
  for(const [key,o] of [...links]){o.geometry.dispose();o.material.dispose();scene.remove(o);links.delete(key);}
  for(const [key,g] of cards){const pk=parentKey(g.userData.card);if(!pk||!cards.has(pk))continue;
   const geom=new T.BufferGeometry();geom.setAttribute('position',new T.BufferAttribute(new Float32Array(22*3),3));
   const l=new T.Line(geom,new T.LineBasicMaterial({color:0x92c6b5,transparent:true,opacity:.52,depthWrite:false}));l.userData={start:pk,end:key};scene.add(l);links.set(key,l);
  }
 }
 function updateLinks(){for(const l of links.values()){
  const a=cards.get(l.userData.start)?.position,b=cards.get(l.userData.end)?.position;if(!a||!b)continue;
  const p=l.geometry.attributes.position,mid=a.clone().add(b).multiplyScalar(.5).add(new T.Vector3(0,.18,.04));
  for(let i=0;i<22;i++){const t=i/21,u=1-t;const x=u*u*a.x+2*u*t*mid.x+t*t*b.x,y=u*u*a.y+2*u*t*mid.y+t*t*b.y,z=u*u*a.z+2*u*t*mid.z+t*t*b.z;p.setXYZ(i,x,y,z);}
  p.needsUpdate=true;l.geometry.computeBoundingSphere();
 }}
 function updateBounds(){let min=new T.Vector3(Infinity,Infinity,Infinity),max=new T.Vector3(-Infinity,-Infinity,-Infinity);min.min(avatarTarget);max.max(avatarTarget);
  for(const g of cards.values()){const p=g.userData.target;min.min(p);max.max(p);}
  const center=min.clone().add(max).multiplyScalar(.5);const size=max.sub(min);
  roomEdges.position.set(center.x,Math.max(1.7,center.y),center.z);
  roomEdges.scale.set(Math.max(1,size.x/5+.6),Math.max(1,size.y/3.6+.5),Math.max(1,size.z/5+.6));
  return {center,size};
 }
 function fit(){const bounds=updateBounds();aim.copy(bounds.center);orbit.radius=clamp(Math.max(4,Math.max(bounds.size.x,bounds.size.z)*1.55+2),3,28);
  if(mode==='fly'){camera.position.copy(bounds.center).add(new T.Vector3(0,1,orbit.radius));camera.lookAt(bounds.center);}
 }
 function rebuildShapes(shapes){
  const key=JSON.stringify(Array.isArray(shapes)?shapes:[]);if(shapeKey===key)return;shapeKey=key;
  for(const item of sharedShapes){scene.remove(item);item.geometry.dispose();item.material.dispose();}sharedShapes.length=0;
  for(const shape of (Array.isArray(shapes)?shapes:[]).slice(0,32)){
   if(!Array.isArray(shape.corners)||shape.corners.length<3||!shape.corners.every(validPoint))continue;
   const points=shape.corners.map(p=>new T.Vector3(...p));
   const line=new T.LineLoop(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:shape.kind==='triangle'?0xffa6d8:0x5bffdc,transparent:true,opacity:.9,depthTest:true}));
   sharedShapes.push(line);scene.add(line);
  }
 }
 function setState(payload,rid,room){
  if(!payload||!Array.isArray(payload.cards))return;
  const newRoom=roomId!==rid;roomId=rid;rebuildShapes(payload.shapes);
  if(validPoint(payload.pose))avatarTarget.set(...payload.pose);
  if(Array.isArray(payload.q)&&payload.q.length===4&&payload.q.every(Number.isFinite))avatarQuat.set(...payload.q).normalize();
  const incoming=new Set();let changed=false;
  for(const c of payload.cards){if(!validPoint(c.p)||!['object','capture'].includes(c.kind)||!Number.isInteger(c.id))continue;
   const key=identifier(c);incoming.add(key);let g=cards.get(key);
   if(!g){g=createCard(T,rid,c);cards.set(key,g);scene.add(g);addScreenLabel(key,g);hits.push(...g.userData.hits);changed=true;}
   g.userData.card=c;g.userData.target=new T.Vector3(...c.p);
   const label=g.userData.htmlLabel;if(label){label.querySelector('strong').textContent=c.label||(c.kind==='capture'?'Source image':'Segment');label.querySelector('span').textContent=c.description||'';}
   if(newRoom)g.position.copy(g.userData.target);
   if(Array.isArray(c.q)&&c.q.length===4&&c.q.every(Number.isFinite))g.userData.targetQuaternion=new T.Quaternion(...c.q).normalize();
   else g.userData.targetQuaternion=null;
  }
  for(const [key,g] of [...cards])if(!incoming.has(key)){
   hits.splice(hits.indexOf(g.userData.hits[0]),1);hits.splice(hits.indexOf(g.userData.hits[1]),1);
   g.userData.htmlLabel?.remove();scene.remove(g);disposeCard(g);cards.delete(key);changed=true;
  }
  if(changed)rebuildLinks();
  if(selected&&!cards.has(selected))select(null);
  if(selected&&cards.has(selected))select(selected);
  if(newRoom){fit();poseGroup.position.copy(avatarTarget);}
  text('roomImageCount',cards.size+' images');
 }
 function resize(){const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);const px=Math.min(2,window.devicePixelRatio||1);
  renderer.setPixelRatio(px);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 const resizer=new ResizeObserver(resize);resizer.observe(canvas);
 function changeMode(next){mode=next;const b=$('roomControlMode');if(b)b.textContent=mode==='orbit'?'Explore · WASD':'Orbit · drag';
  if(mode==='fly'){const dir=new T.Vector3().subVectors(aim,camera.position);if(dir.lengthSq()>.001)camera.quaternion.setFromRotationMatrix(new T.Matrix4().lookAt(camera.position,aim,new T.Vector3(0,1,0)));}
  else{aim.copy(camera.position).add(new T.Vector3(0,0,-orbit.radius).applyQuaternion(camera.quaternion));}
 }
 function tick(now){if(!active)return;raf=requestAnimationFrame(tick);
  const dt=lastFrame?Math.min(.06,(now-lastFrame)/1000):1/60;lastFrame=now;
  const a=1-Math.exp(-dt*8.5),qa=1-Math.exp(-dt*6.3);
  poseGroup.position.lerp(avatarTarget,a);poseGroup.quaternion.slerp(avatarQuat,qa);
  for(const g of cards.values()){
   g.position.lerp(g.userData.target,a);
   if(g.userData.targetQuaternion)g.quaternion.slerp(g.userData.targetQuaternion,qa);
   else g.quaternion.slerp(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(g.position,camera.position,new T.Vector3(0,1,0))),qa);
   g.userData.title.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion); // face the spectator despite the card's local rotation
  }
  if(mode==='orbit'){
   orbit.yaw+=orbit.vyaw;orbit.pitch=clamp(orbit.pitch+orbit.vpitch,-1.36,1.36);
   orbit.vyaw*=Math.pow(.045,dt);orbit.vpitch*=Math.pow(.045,dt);
   const c=Math.cos(orbit.pitch);
   camera.position.set(aim.x+orbit.radius*Math.sin(orbit.yaw)*c,aim.y+orbit.radius*Math.sin(orbit.pitch),aim.z+orbit.radius*Math.cos(orbit.yaw)*c);
   camera.lookAt(aim);
  }else{
   const forward=new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion);const side=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion);
   forward.y=0;forward.normalize();side.y=0;side.normalize();const speed=(keys.has('Shift')?5:2.5)*dt;
   if(keys.has('w')||keys.has('ArrowUp'))camera.position.addScaledVector(forward,speed);
   if(keys.has('s')||keys.has('ArrowDown'))camera.position.addScaledVector(forward,-speed);
   if(keys.has('a')||keys.has('ArrowLeft'))camera.position.addScaledVector(side,-speed);
   if(keys.has('d')||keys.has('ArrowRight'))camera.position.addScaledVector(side,speed);
   if(keys.has('q'))camera.position.y-=speed;if(keys.has('e'))camera.position.y+=speed;
  }
  updateLinks();updateScreenLabels();renderer.render(scene,camera);
  fpsFrames++;if(!fpsStart)fpsStart=now;
  if(now-fpsStart>=850){lastFps=Math.round(fpsFrames*1000/(now-fpsStart));text('roomFPS',lastFps+' FPS');fpsFrames=0;fpsStart=now;}

 }
 function onDown(e){if(!active)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button});dragTravel=0;canvas.setPointerCapture(e.pointerId);}
 function onMove(e){if(!active)return;const p=pointers.get(e.pointerId);if(!p){const k=pick(e.clientX,e.clientY);canvas.style.cursor=k?'pointer':'grab';return;}
  const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;dragTravel+=Math.abs(dx)+Math.abs(dy);
  if(pointers.size>=2){orbit.radius=clamp(orbit.radius+dy*.012,.55,50);return;}
  if(mode==='orbit'){
   if(e.shiftKey||p.button===2){const scale=orbit.radius*.0015;const right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion);const up=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion);aim.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);}
   else{orbit.vyaw+=dx*.00095;orbit.vpitch+=dy*.00095;orbit.vyaw=clamp(orbit.vyaw,-.055,.055);orbit.vpitch=clamp(orbit.vpitch,-.04,.04);}
  }else{
   const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-dx*.003);camera.quaternion.premultiply(q);
   const pitch=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-dy*.003);camera.quaternion.multiply(pitch);
  }
 }
 function onUp(e){const p=pointers.get(e.pointerId);if(p&&dragTravel<9){const k=pick(e.clientX,e.clientY);if(k)select(k);}pointers.delete(e.pointerId);if(!pointers.size)dragTravel=0;}
 function onWheel(e){if(!active)return;e.preventDefault();if(mode==='orbit')orbit.radius=clamp(orbit.radius*Math.exp(e.deltaY*.001),.55,55);
 else camera.position.addScaledVector(new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion),-e.deltaY*.002);}
 function onKeyDown(e){if(!active||!viewer.contains(document.activeElement)&&document.activeElement?.tagName==='INPUT')return;
  if(e.key==='Escape'){if(!$('roomImageLightbox').classList.contains('hidden')){$('roomImageLightbox').classList.add('hidden');return;}
   if(!inspector.classList.contains('hidden')){select(null);return;}back();return;}
  if(e.key.toLowerCase()==='f'){fit();return;}
  if(e.key.toLowerCase()==='v'){changeMode(mode==='orbit'?'fly':'orbit');return;}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
   if(!$('roomImageLightbox').classList.contains('hidden')){cycleSelected(e.key==='ArrowLeft'?-1:1);e.preventDefault();return;}
   if(!inspector.classList.contains('hidden')){cycleSelected(e.key==='ArrowLeft'?-1:1);e.preventDefault();return;}
  }
  keys.add(e.key.length===1?e.key.toLowerCase():e.key);
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();
 }
 function onKeyUp(e){keys.delete(e.key.length===1?e.key.toLowerCase():e.key);}
 const onBlur=()=>keys.clear();
 canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onUp);
 canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('wheel',onWheel,{passive:false});
 window.addEventListener('keydown',onKeyDown);window.addEventListener('keyup',onKeyUp);window.addEventListener('blur',onBlur);
 button('roomControlMode',()=>changeMode(mode==='orbit'?'fly':'orbit'));
 button('roomControlFit',()=>fit());button('roomInspectorClose',()=>select(null));
 button('roomInspectFull',()=>{$('roomImageLightbox').classList.remove('hidden');$('roomImageLarge').src=$('roomInspectImage').src;});
 button('roomImagePrev',()=>cycleSelected(-1));
 button('roomImageNext',()=>cycleSelected(1));
 button('roomImageClose',()=>{$('roomImageLightbox').classList.add('hidden');});
 button('roomInspectFocus',()=>selected&&focusOn(selected));
 function start(){if(active)return;active=true;resize();lastFrame=0;raf=requestAnimationFrame(tick);}
 function stop(){active=false;cancelAnimationFrame(raf);rebuildShapes([]);keys.clear();pointers.clear();select(null);$('roomImageLightbox').classList.add('hidden');}
 return {start,stop,setState,fit,select};
}
