/* FREELAB v0.10.23: explicit interactive 3D preview; does not start a separate XR context. */
const $=id=>document.getElementById(id);
let renderer=null,scene=null,camera=null,root=null,raf=0,active=false,loadingToken=0,drag=null,yaw=.48,pitch=.20,dist=2.8,lastTouchDistance=0;
let THREE=null,GLTFLoader=null;
async function loadThree(){
 if(THREE)return;
 THREE=await import('three');
 try{GLTFLoader=(await import('https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/loaders/GLTFLoader.js')).GLTFLoader;}catch{GLTFLoader=null;}

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
async function geometryFallback(url){const res=await fetch(url,{credentials:'same-origin'});let data={};try{data=await res.json();}catch{}if(!res.ok)throw Error(data.error||'Preview HTTP '+res.status);
 const pos=data.positions||[];if(!Array.isArray(pos)||!pos.length||pos.length>35000||pos.length%9)throw Error('No bounded geometry preview available');
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.computeVertexNormals();
 return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x9ce4ba,roughness:.74,metalness:.08,side:THREE.DoubleSide}));
}
async function open(id,avatar=false){const token=++loadingToken;const stage=$('modelStage');stage.classList.remove('hidden');active=true;
 $('modelStageTitle').textContent=avatar?'My 3D avatar':'3D model #'+id;
 const dl=$('modelStageDownload');dl.classList.add('hidden');dl.removeAttribute('href');state('Loading 3D model…',true);
 try{await loadThree();if(token!==loadingToken)return;
 const canvas=$('modelStageCanvas');if(!renderer){renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'default',alpha:false});renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x101c1b);camera=new THREE.PerspectiveCamera(43,1,.01,120);
  scene.add(new THREE.HemisphereLight(0xf3fffb,0x1b3535,2.4));const key=new THREE.DirectionalLight(0xffe7cb,2.7);key.position.set(2,5,4);scene.add(key);
  const edge=new THREE.DirectionalLight(0xb1d6ff,1.1);edge.position.set(-2,1,-3);scene.add(edge);}
  resize();if(!raf)frame();
  const rawUrl=avatar?'/api/me/avatar-3d':'/api/media/3d/'+id+'/asset';const fallbackUrl=avatar?'/api/me/avatar-3d/preview':'/api/media/3d/'+id+'/preview';
  // Download the actual authenticated GLB into the viewer. Only if that fails, use a bounded geometry preview.
  let object;try{if(!GLTFLoader)throw Error('GLTF loader unavailable');const response=await fetch(rawUrl,{credentials:'same-origin'});if(!response.ok)throw Error('GLB unavailable (HTTP '+response.status+')');
   const raw=await response.arrayBuffer();if(token!==loadingToken)return;
   const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(raw,'',resolve,reject));object=gltf.scene;
   dl.href=rawUrl;dl.download=avatar?'freelab-avatar.glb':'freelab-model-'+id+'.glb';dl.classList.remove('hidden');
   state('Full 3D model loaded · drag to rotate');}
  catch(e){object=await geometryFallback(fallbackUrl);state('Lightweight geometry preview · textures/animation omitted. '+e.message);}
  if(token!==loadingToken)return;fit(object);
 }catch(e){if(token===loadingToken)state('3D preview unavailable: '+e.message);}
 finally{if(token===loadingToken)$('modelStageStatus')?.classList.remove('working');}
}
function close(){++loadingToken;active=false;cancelAnimationFrame(raf);raf=0;clearRoot();$('modelStage').classList.add('hidden');}
const cv=$('modelStageCanvas');if(cv){cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);});
 cv.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};});
 cv.addEventListener('pointerup',()=>{drag=null;});cv.addEventListener('pointercancel',()=>{drag=null;});
 cv.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(1.3,Math.min(11,dist*Math.exp(e.deltaY*.001)));},{passive:false});
 cv.addEventListener('touchmove',e=>{if(e.touches.length!==2)return;const [a,b]=e.touches;const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  if(lastTouchDistance)dist=Math.max(1.3,Math.min(11,dist*(lastTouchDistance/d)));lastTouchDistance=d;},{passive:true});
 cv.addEventListener('touchend',()=>{lastTouchDistance=0;});}
$('modelStageClose')?.addEventListener('click',close);window.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)close();});window.addEventListener('resize',resize);
window.FreeLabModelStage={open,close};
