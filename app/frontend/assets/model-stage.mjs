/* FREELAB v0.10.29: explicit interactive 3D preview; does not start a separate XR context. */
const $=id=>document.getElementById(id);
let renderer=null,scene=null,camera=null,root=null,raf=0,active=false,loadingToken=0,drag=null,yaw=.48,pitch=.20,dist=2.8,lastTouchDistance=0;
let THREE=null,GLTFLoader=null,DRACOLoader=null,draco=null;
async function loadThree(){
 if(THREE)return;
 THREE=await import('three');
 try{
  const [gltfModule,dracoModule]=await Promise.all([
   import('https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/loaders/GLTFLoader.js'),
   import('https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/loaders/DRACOLoader.js')]);
  GLTFLoader=gltfModule.GLTFLoader;DRACOLoader=dracoModule.DRACOLoader;
  draco=new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/libs/draco/gltf/');
  draco.setDecoderConfig({type:'wasm'});
 }catch(e){GLTFLoader=null;DRACOLoader=null;console.warn('FREELAB GLB/Draco decoder unavailable:',e.message);}
}
function state(message,working=false){const p=$('modelStageStatus');if(!p)return;p.textContent=message;p.classList.toggle('working',working);}
function resize(){if(!renderer||!camera)return;const canvas=$('modelStageCanvas');const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);
 renderer.setPixelRatio(Math.min(1.5,devicePixelRatio||1));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
function frame(){if(!active)return;raf=requestAnimationFrame(frame);if(!renderer||!camera||!scene)return;
 camera.position.set(Math.sin(yaw)*Math.cos(pitch)*dist,Math.sin(pitch)*dist+.08,Math.cos(yaw)*Math.cos(pitch)*dist);camera.lookAt(0,0,0);renderer.render(scene,camera);
}
function clearRoot(){if(!root)return;scene?.remove(root);root.traverse?.(o=>{o.geometry?.dispose?.();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m?.map?.dispose?.();m?.dispose?.();}});root=null;}
function fit(obj){clearRoot();root=obj;scene.add(root);const box=new THREE.Box3().setFromObject(root);if(box.isEmpty())throw Error('3D model has no visible geometry');
 const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());root.position.sub(center);const max=Math.max(size.x,size.y,size.z)||1;const scale=1.4/max;root.scale.multiplyScalar(scale);dist=2.6;yaw=.48;pitch=.18;
}
async function geometryFallback(url){const res=await fetch(url,{credentials:'same-origin'});let data={};try{data=await res.json();}catch{}
 if(res.status===202||res.status===409&&data.code==='JOB_NOT_FINISHED'){const e=Error(String(data.stage||data.error||'Waiting for the provider model'));e.retryable=true;throw e;}
 if(!res.ok)throw Error(String(data.error||'Preview HTTP '+res.status));
 // Server now provides material-aware GLB geometry as parts, not the obsolete
 // flat `positions` array. Render the same bounded textured surfaces as XR.
 const parts=Array.isArray(data.parts)?data.parts:[];
 if(!parts.length||parts.length>12)throw Error('No decoded GLB surfaces available');
 const group=new THREE.Group();let vertices=0;
 for(const part of parts){const pos=part.positions||[],uv=part.uvs||[];
  if(!Array.isArray(pos)||!pos.length||pos.length%9||!Array.isArray(uv)||uv.length!==pos.length/3*2||vertices+pos.length/3>40000)throw Error('Unexpected 3D geometry size');
  vertices+=pos.length/3;
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geom.computeVertexNormals();
  const tint=Array.isArray(part.color)?part.color:[1,1,1,1];
  const material=new THREE.MeshStandardMaterial({color:new THREE.Color(tint[0],tint[1],tint[2]),roughness:.75,metalness:.05,side:THREE.DoubleSide,transparent:tint[3]<.99,opacity:tint[3]??1});
  if(typeof part.texture==='string'&&part.texture.startsWith('data:image/')&&part.texture.length<7_000_000){
   try{const map=await new THREE.TextureLoader().loadAsync(part.texture);map.flipY=false;map.colorSpace=THREE.SRGBColorSpace;material.map=map;material.needsUpdate=true;}catch{}
  }
  group.add(new THREE.Mesh(geom,material));
 }
 return group;
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function awaitPreparedPreview(jobId,token){
 const preview='/api/media/3d/'+jobId+'/preview';
 for(let attempt=0;attempt<28&&token===loadingToken;attempt++){
  try{
   const object=await geometryFallback(preview);
   state('Quest-compatible model loaded · textured preview ready');return object;
  }catch(e){if(!e.retryable)throw e;state('3D · '+e.message+' · keep this viewer open',true);}
  if(token!==loadingToken)return null;
  await delay(4500);
 }
 if(token===loadingToken)throw Error('3D preparation is still pending. Reopen the viewer after the server finishes; no new generation needed.');
 return null;
}
async function open(id,avatar=false,localFile=null,posterUrl=''){const token=++loadingToken;const stage=$('modelStage');stage.classList.remove('hidden');active=true;
 $('modelStageTitle').textContent=localFile?'Local avatar preview · '+(localFile.size/1_000_000).toFixed(2)+' MB':avatar?'My 3D avatar':'3D model #'+id;
 const dl=$('modelStageDownload');dl.classList.add('hidden');dl.removeAttribute('href');const poster=$('modelStagePoster');if(poster){if(posterUrl){poster.src=posterUrl;poster.classList.remove('hidden');}else{poster.removeAttribute('src');poster.classList.add('hidden');}}state('Loading 3D model…',true);
 try{await loadThree();if(token!==loadingToken)return;
 const canvas=$('modelStageCanvas');if(!renderer){renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'default',alpha:false});renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x101c1b);camera=new THREE.PerspectiveCamera(43,1,.01,120);
  scene.add(new THREE.HemisphereLight(0xf3fffb,0x1b3535,2.4));const key=new THREE.DirectionalLight(0xffe7cb,2.7);key.position.set(2,5,4);scene.add(key);
  const edge=new THREE.DirectionalLight(0xb1d6ff,1.1);edge.position.set(-2,1,-3);scene.add(edge);}
  resize();if(!raf)frame();
  const rawUrl=avatar?'/api/me/avatar-3d':'/api/media/3d/'+id+'/asset';const fallbackUrl=avatar?'/api/me/avatar-3d/preview':'/api/media/3d/'+id+'/preview';
  // Download the actual authenticated GLB into the viewer. Only if that fails, use a bounded geometry preview.
  let object;try{if(!GLTFLoader)throw Error('GLTF loader unavailable');let raw;
   if(localFile){raw=await localFile.arrayBuffer();}
   else{const response=await fetch(rawUrl,{credentials:'same-origin'});if(!response.ok)throw Error('GLB unavailable (HTTP '+response.status+')');raw=await response.arrayBuffer();}
   if(token!==loadingToken)return;
   const loader=new GLTFLoader();if(draco)loader.setDRACOLoader(draco);
   const gltf=await new Promise((resolve,reject)=>loader.parse(raw,'',resolve,reject));object=gltf.scene;
   if(!localFile){dl.href=rawUrl;dl.download=avatar?'freelab-avatar.glb':'freelab-model-'+id+'.glb';dl.classList.remove('hidden');}
   state(localFile?(localFile.size>4_000_000?'Local preview only · '+(localFile.size/1_000_000).toFixed(2)+' MB · reduce by '+((localFile.size-4_000_000)/1_000_000).toFixed(2)+' MB before XR use':'Local 3D preview · ready for upload'):'Full 3D model loaded · drag to rotate');}
  catch(e){if(localFile)throw e;
   try{object=avatar?await geometryFallback(fallbackUrl):await awaitPreparedPreview(id,token);
    if(object)state('Model loaded · '+(avatar?'avatar mesh':'textured Quest preview')+' · original GLB is preserved');}
   catch(fallbackError){throw Error('GLB loader: '+e.message+' · XR preview: '+fallbackError.message);}
  }
  if(token!==loadingToken)return;fit(object);if(poster)poster.classList.add('hidden');
 }catch(e){if(token===loadingToken)state('3D preview unavailable: '+e.message);}
 finally{if(token===loadingToken)$('modelStageStatus')?.classList.remove('working');}
}
function close(){++loadingToken;active=false;cancelAnimationFrame(raf);raf=0;clearRoot();const poster=$('modelStagePoster');if(poster){poster.classList.add('hidden');poster.removeAttribute('src');}$('modelStage').classList.add('hidden');}
const cv=$('modelStageCanvas');if(cv){cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});
 cv.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};});
 cv.addEventListener('pointerup',()=>{drag=null;});cv.addEventListener('pointercancel',()=>{drag=null;});
 cv.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(1.3,Math.min(11,dist*Math.exp(e.deltaY*.001)));},{passive:false});
 cv.addEventListener('touchmove',e=>{if(e.touches.length!==2)return;const [a,b]=e.touches;const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  if(lastTouchDistance)dist=Math.max(1.3,Math.min(11,dist*(lastTouchDistance/d)));lastTouchDistance=d;},{passive:true});
 cv.addEventListener('touchend',()=>{lastTouchDistance=0;});}
$('modelStageClose')?.addEventListener('click',close);window.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)close();});window.addEventListener('resize',resize);
window.FreeLabModelStage={open,openLocal:file=>open(null,false,file),close};
