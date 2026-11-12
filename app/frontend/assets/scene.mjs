/* FREELAB's original soft-body mascot, built in Three.js r181.
   Progressive enhancement: the CSS mascot remains when CDN access is unavailable.
   The XR app uses its own WebGL context and does not depend on this landing renderer. */
const canvas=document.getElementById('sceneCanvas');
const stage=document.getElementById('sceneStage');
const fallback=document.getElementById('sceneFallback');
if(canvas&&stage){
 try{
  // Load only the pinned CDN module: do not request an absent local vendor file.
  // If the CDN is unavailable, the local CSS mascot remains visible.
  const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.181.0/build/three.module.js');
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0a0e0d);scene.fog=new THREE.FogExp2(0x0b1110,.055);
  const camera=new THREE.PerspectiveCamera(38,1,.1,70);camera.position.set(0.2,3.2,8.4);camera.lookAt(0,.75,0);
  const renderer=new THREE.WebGLRenderer({canvas,alpha:false,antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.5;
  renderer.setPixelRatio(Math.min(1.65,window.devicePixelRatio||1));
  scene.add(new THREE.HemisphereLight(0xf3fff3,0x242b28,3.7));
  const key=new THREE.SpotLight(0xedfff1,130,22,Math.PI/4,.8);key.position.set(-3,7,6);scene.add(key);
  const rim=new THREE.PointLight(0x6bffa0,56,12);rim.position.set(4.4,2,-2);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,90),new THREE.MeshStandardMaterial({color:0x1b2420,roughness:.95,metalness:.04}));floor.rotation.x=-Math.PI/2;floor.position.y=-.73;scene.add(floor);
  const halo=new THREE.Mesh(new THREE.RingGeometry(.91,2.8,64),new THREE.MeshBasicMaterial({color:0x74c98c,transparent:true,opacity:.09,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.set(0,-.71,0);scene.add(halo);
  const shadowTexture=new THREE.CanvasTexture((()=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(128,128,0,128,128,125);g.addColorStop(0,'rgba(0,0,0,.72)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,256,256);return c;})());
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.8,2.8),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.65}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.705;scene.add(shadow);
  const creature=new THREE.Group();scene.add(creature);
  const plush=new THREE.MeshPhysicalMaterial({color:0x66796a,roughness:.38,metalness:.08,clearcoat:.7,clearcoatRoughness:.28});
  const darker=new THREE.MeshPhysicalMaterial({color:0x39473c,roughness:.55,clearcoat:.4});
  const eyeMat=new THREE.MeshPhysicalMaterial({color:0x08130d,roughness:.08,metalness:.2,clearcoat:1});
  const glowMat=new THREE.MeshBasicMaterial({color:0x87ffad,transparent:true,opacity:.20,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false});
  function sphere(group,size,pos,mat,detail=36){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,detail,detail*2/3),mat);mesh.scale.set(...size);mesh.position.set(...pos);group.add(mesh);return mesh;}
  const body=new THREE.Group();creature.add(body);
  sphere(body,[.82,.86,.63],[0,.08,0],plush);
  sphere(body,[.846,.885,.655],[0,.08,0],glowMat);
  const belly=sphere(body,[.48,.53,.26],[0,-.04,.48],new THREE.MeshPhysicalMaterial({color:0x8ea090,roughness:.63,clearcoat:.15}));
  const head=new THREE.Group();head.position.y=.68;body.add(head);
  sphere(head,[.70,.64,.62],[0,.22,.03],plush);
  sphere(head,[.735,.675,.65],[0,.22,.03],glowMat);
  const earL=sphere(head,[.27,.45,.23],[-.47,.66,-.01],plush);earL.rotation.z=.28;
  const earR=sphere(head,[.27,.45,.23],[.47,.66,-.01],plush);earR.rotation.z=-.28;
  sphere(head,[.13,.20,.115],[-.49,.69,.2],darker);sphere(head,[.13,.20,.115],[.49,.69,.2],darker);
  for(const side of [-1,1]){
    sphere(head,[.094,.142,.075],[side*.255,.25,.58],eyeMat);
    sphere(head,[.029,.038,.022],[side*.227,.305,.651],new THREE.MeshBasicMaterial({color:0xffffff}));
    sphere(head,[.107,.055,.036],[side*.40,.055,.53],new THREE.MeshStandardMaterial({color:0xb5979b,transparent:true,opacity:.32}));
  }
  sphere(head,[.074,.055,.06],[0,.05,.645],darker);
  const footL=sphere(body,[.34,.20,.39],[-.48,-.66,.19],darker);footL.rotation.z=.18;
  const footR=sphere(body,[.34,.20,.39],[.48,-.66,.19],darker);footR.rotation.z=-.18;
  const armL=sphere(body,[.29,.42,.31],[-.75,-.04,.03],plush);armL.rotation.z=-.24;
  const armR=sphere(body,[.29,.42,.31],[.75,-.04,.03],plush);armR.rotation.z=.24;
  // Elliptical floating contour: toy-scale visual depth cue, not a fake room scan.
  const loop=new THREE.Mesh(new THREE.TorusGeometry(2.25,.012,9,110),new THREE.MeshBasicMaterial({color:0x7cff9e,transparent:true,opacity:.23}));loop.rotation.x=1.24;loop.position.set(0,.48,-1.6);scene.add(loop);
  const dust=[];for(let i=0;i<36;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.009+(i%3)*.003,6,6),new THREE.MeshBasicMaterial({color:0xb2ffbe,transparent:true,opacity:.28+(i%4)*.06}));p.position.set((Math.random()-.5)*9,Math.random()*3+.1,(Math.random()-.5)*5-1);scene.add(p);dust.push(p);}
  let px=0,py=0;window.addEventListener('pointermove',ev=>{px=(ev.clientX/window.innerWidth-.5)*2;py=(ev.clientY/window.innerHeight-.5)*2;},{passive:true});
  function resize(){const b=stage.getBoundingClientRect();const w=Math.max(320,b.width),h=Math.max(420,b.height);renderer.setSize(w,h,false);camera.aspect=w/h;camera.position.set(w<740?0:0.0,w<740?3.5:3.2,w<740?10.2:8.4);camera.lookAt(0,.7,0);camera.updateProjectionMatrix();}
  new ResizeObserver(resize).observe(stage);resize();
  const t0=performance.now();const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function render(now){requestAnimationFrame(render);const t=(now-t0)/1000;const bounce=1-Math.pow(2,-8*Math.min(1,t/2))*Math.cos(8*Math.PI*Math.min(1,t/2));
    creature.position.set((1-bounce)*-3.5,.28+Math.sin(t*2.1)*.085+(1-bounce)*-.8,(1-bounce)*-1.4);
    creature.rotation.y=Math.sin(t*.7)*.12+px*.16;creature.rotation.z=Math.sin(t*1.25)*.05;
    body.scale.set(1+Math.sin(t*2.2)*.013,1-Math.sin(t*2.2)*.022,1+Math.sin(t*2.2)*.012);
    head.rotation.z=Math.sin(t*1.6)*.07;head.rotation.x=Math.sin(t*1.1)*.04+py*.06;
    earL.rotation.z=.28+Math.sin(t*2.8)*.06;earR.rotation.z=-.28-Math.sin(t*2.7)*.06;
    loop.rotation.z=t*.04;shadow.material.opacity=.65-.1*Math.sin(t*2.1);
    dust.forEach((p,i)=>{p.position.y+=Math.sin(t*.8+i)*.0009;});
    if(reduced){creature.position.x=0;creature.position.y=.28;creature.rotation.set(0,0,0)}
    renderer.render(scene,camera);
  }requestAnimationFrame(render);
  fallback?.classList.add('hidden');
 }catch(e){console.info('FREELAB uses its local mascot fallback when Three.js is unavailable:',e.message);canvas.style.display='none';}
}
