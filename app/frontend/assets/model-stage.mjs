/* FREELAB v0.10.29: explicit interactive 3D preview; does not start a separate XR context. */
const $=id=>document.getElementById(id);
let renderer=null,scene=null,camera=null,root=null,raf=0,active=false,loadingToken=0,drag=null,yaw=.48,pitch=.20,dist=2.8,lastTouchDistance=0;
let THREE=null,GLTFLoader=null,DRACOLoader=null,draco=null;
let uprightAxis='y',axisChoice='auto',modelBounds=null;
let viewportWidth=0,viewportHeight=0,viewportRatio=0,resizingObserver=null,renderCount=0;
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
// The visible VIEWPORT defines the WebGL size. Reading the canvas's intrinsic
// dimensions during initial grid layout used to produce a stretched first frame
// until a manual browser resize updated the camera's aspect ratio.
function resize(){
 if(!active||!renderer||!camera)return;
 const viewport=$('modelStageViewport');
 if(!viewport)return;
 const w=Math.round(viewport.clientWidth),h=Math.round(viewport.clientHeight);
 if(w<2||h<2)return;  // Hidden or not yet laid out: do not apply a bogus aspect.
 const ratio=Math.min(1.5,window.devicePixelRatio||1);
 if(w===viewportWidth&&h===viewportHeight&&ratio===viewportRatio)return;
 viewportWidth=w;viewportHeight=h;viewportRatio=ratio;
 renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);
 camera.aspect=w/h;camera.updateProjectionMatrix();
}
function frame(){if(!active)return;raf=requestAnimationFrame(frame);if(!renderer||!camera||!scene)return;
 // Correct first-open and viewport changes independently of window.resize.
 if(++renderCount%12===1||!viewportWidth)resize();
 // Rotate the camera around the object's original long axis; never rotate or
 // non-uniformly scale the imported GLB to force a portrait presentation.
 const horizontal=Math.cos(pitch)*dist,vertical=Math.sin(pitch)*dist;
 if(uprightAxis==='z'){
  camera.up.set(0,0,1);
  camera.position.set(Math.sin(yaw)*horizontal,Math.cos(yaw)*horizontal,vertical);
 }else if(uprightAxis==='x'){
  camera.up.set(1,0,0);
  camera.position.set(vertical,Math.sin(yaw)*horizontal,Math.cos(yaw)*horizontal);
 }else{
  camera.up.set(0,1,0);
  camera.position.set(Math.sin(yaw)*horizontal,vertical,Math.cos(yaw)*horizontal);
 }
 camera.lookAt(0,0,0);renderer.render(scene,camera);
}
function clearRoot(){if(!root)return;scene?.remove(root);root.traverse?.(o=>{o.geometry?.dispose?.();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m?.map?.dispose?.();m?.dispose?.();}});root=null;}
function chooseUprightAxis(size){
 if(axisChoice==='x'||axisChoice==='y'||axisChoice==='z')return axisChoice;
 // glTF geometry is usually Y-up. Some generated GLBs genuinely use Z as
 // their long axis; orient the VIEW instead of rotating the imported geometry.
 // Requiring a strong Z dominance avoids standing flat packaging on an edge.
 return size.z>Math.max(size.x,size.y)*1.3?'z':'y';
}
function refreshViewAxisButton(){
 const button=$('modelStageAxis');if(!button)return;
 button.textContent=axisChoice==='auto'?'Upright · Auto':'Upright · '+uprightAxis.toUpperCase();
 button.title='Change viewing orientation without changing the model';
}
function fit(obj){
 clearRoot();
 // Preserve ALL GLB node transforms, vertex positions, proportions, and UVs.
 // Only the viewer camera decides what looks upright; a wrong 90° scene
 // rotation was responsible for the squat bottle on desktop.
 root=new THREE.Group();root.add(obj);scene.add(root);
 const box=new THREE.Box3().setFromObject(root);
 if(box.isEmpty())throw Error('3D model has no visible geometry');
 const size=box.getSize(new THREE.Vector3());
 const center=box.getCenter(new THREE.Vector3());
 const longest=Math.max(size.x,size.y,size.z)||1;
 root.scale.setScalar(1.75/longest);
 root.position.copy(center).multiplyScalar(-root.scale.x);
 modelBounds=size.clone();uprightAxis=chooseUprightAxis(size);refreshViewAxisButton();
 yaw=.37;pitch=.12;dist=3.0;
 console.info('[FREELAB 3D VIEWER] GLB framing',{
  bounds:[size.x,size.y,size.z].map(v=>Number(v.toFixed(4))),
  upright:uprightAxis,upMode:axisChoice,displayScale:Number(root.scale.x.toFixed(6)),
  originalNodeTransformsPreserved:true,uniformScale:true
 });
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
async function open(id,avatar=false,localFile=null,posterUrl=''){const token=++loadingToken;const stage=$('modelStage');stage.classList.remove('hidden');active=true;axisChoice='auto';uprightAxis='y';modelBounds=null;refreshViewAxisButton();
 $('modelStageTitle').textContent=localFile?'Local avatar preview · '+(localFile.size/1_000_000).toFixed(2)+' MB':avatar?'My 3D avatar':'3D model #'+id;
 const dl=$('modelStageDownload');dl.classList.add('hidden');dl.removeAttribute('href');const poster=$('modelStagePoster');if(poster){if(posterUrl){poster.src=posterUrl;poster.classList.remove('hidden');}else{poster.removeAttribute('src');poster.classList.add('hidden');}}state('Loading 3D model…',true);
 try{await loadThree();if(token!==loadingToken)return;
 const canvas=$('modelStageCanvas');if(!renderer){renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'default',alpha:false});renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x101c1b);camera=new THREE.PerspectiveCamera(43,1,.01,120);
  scene.add(new THREE.HemisphereLight(0xf3fffb,0x1b3535,2.4));const key=new THREE.DirectionalLight(0xffe7cb,2.7);key.position.set(2,5,4);scene.add(key);
  const edge=new THREE.DirectionalLight(0xb1d6ff,1.1);edge.position.set(-2,1,-3);scene.add(edge);}
  viewportWidth=0;viewportHeight=0;viewportRatio=0;renderCount=0;
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
  // Asset readiness can change the dialog layout; remeasure before displaying it.
  viewportWidth=0;resize();requestAnimationFrame(()=>{if(token===loadingToken)resize();});
 }catch(e){if(token===loadingToken)state('3D preview unavailable: '+e.message);}
 finally{if(token===loadingToken)$('modelStageStatus')?.classList.remove('working');}
}
function close(){++loadingToken;active=false;cancelAnimationFrame(raf);raf=0;viewportWidth=0;viewportHeight=0;clearRoot();const poster=$('modelStagePoster');if(poster){poster.classList.add('hidden');poster.removeAttribute('src');}$('modelStage').classList.add('hidden');}
const cv=$('modelStageCanvas');if(cv){cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});
 cv.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};});
 cv.addEventListener('pointerup',()=>{drag=null;});cv.addEventListener('pointercancel',()=>{drag=null;});
 cv.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(1.3,Math.min(11,dist*Math.exp(e.deltaY*.001)));},{passive:false});
 cv.addEventListener('touchmove',e=>{if(e.touches.length!==2)return;const [a,b]=e.touches;const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  if(lastTouchDistance)dist=Math.max(1.3,Math.min(11,dist*(lastTouchDistance/d)));lastTouchDistance=d;},{passive:true});
 cv.addEventListener('touchend',()=>{lastTouchDistance=0;});}
$('modelStageAxis')?.addEventListener('click',()=>{
 if(!active||!modelBounds)return;
 const options=['auto','y','z','x'];axisChoice=options[(options.indexOf(axisChoice)+1)%options.length];
 uprightAxis=chooseUprightAxis(modelBounds);refreshViewAxisButton();
});
$('modelStageClose')?.addEventListener('click',close);window.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)close();});window.addEventListener('resize',resize);
// DevTools docking, browser chrome and CSS layout changes may resize the viewer
// without a window resize event. Observe its actual display region.
if(typeof ResizeObserver!=='undefined'){
 const viewport=$('modelStageViewport');
 if(viewport){resizingObserver=new ResizeObserver(()=>resize());resizingObserver.observe(viewport);}
}

// Capture the authenticated user's current GLB as a 384px WebGL thumbnail.
// Used only if private server Blender cannot decode the model (e.g. missing Draco).
// This is a temporary, isolated renderer; it does not open the model viewer.
async function renderAvatarThumbnail(){
 await loadThree();
 if(!THREE||!GLTFLoader)throw Error('This browser cannot load the GLB decoder');
 if(!globalThis.crypto?.subtle)throw Error('Secure browser hashing unavailable');
 const response=await fetch('/api/me/avatar-3d',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Avatar GLB unavailable (HTTP '+response.status+')');
 const raw=await response.arrayBuffer();
 if(raw.byteLength<20||raw.byteLength>4_000_000)throw Error('Avatar exceeds safe browser thumbnail budget');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));
 const sha256=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
 const loader=new GLTFLoader();if(draco)loader.setDRACOLoader(draco);
 let object=null,renderer=null;
 try{
  object=(await new Promise((resolve,reject)=>loader.parse(raw,'',g=>resolve(g.scene),reject)));
  const bounds=new THREE.Box3().setFromObject(object);
  if(bounds.isEmpty())throw Error('GLB has no visible geometry');
  const center=bounds.getCenter(new THREE.Vector3());
  const size=bounds.getSize(new THREE.Vector3());
  const span=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(span)||span<=0)throw Error('GLB bounds are invalid');
  const group=new THREE.Group();group.add(object);
  const scale=1.75/span;group.scale.setScalar(scale);group.position.copy(center).multiplyScalar(-scale);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x19302b);scene.add(group);
  scene.add(new THREE.HemisphereLight(0xf3fffb,0x28443e,2.4));
  const key=new THREE.DirectionalLight(0xffe6cc,2.6);key.position.set(3,5,4);scene.add(key);
  const edge=new THREE.DirectionalLight(0xb6dafa,1.2);edge.position.set(-3,1,-3);scene.add(edge);
  const camera=new THREE.PerspectiveCamera(38,1,.01,50);
  if(size.z>Math.max(size.x,size.y)*1.3){camera.up.set(0,0,1);camera.position.set(2.2,3.2,1.7);}
  else{camera.position.set(2.2,1.5,3.5);}
  camera.lookAt(0,0,0);
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=384;
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setSize(384,384,false);renderer.setPixelRatio(1);
  renderer.render(scene,camera);
  const image=canvas.toDataURL('image/png');
  if(!image.startsWith('data:image/png;base64,')||image.length>1_500_000)throw Error('Browser thumbnail exceeds safe upload size');
  return {sha256,image};
 }finally{
  if(object)object.traverse(o=>{o.geometry?.dispose?.();for(const m of (Array.isArray(o.material)?o.material:[o.material])){m?.map?.dispose?.();m?.dispose?.();}});
  renderer?.dispose();renderer?.forceContextLoss();
 }
}

window.FreeLabModelStage={open,openLocal:file=>open(null,false,file),close,renderAvatarThumbnail};
