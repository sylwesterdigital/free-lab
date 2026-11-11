/* FREELAB 0.3.0: world-locked WebXR canvas. No head-locked panel.
 * WebXR's camera/passthrough compositor is NOT an image capture API.
 * Trigger and normal finger pinch select; squeeze only takes a local snapshot.
 * Visible input rays come from source.targetRaySpace, in the local-floor reference space.
 */
(()=>{'use strict';
let session=null,gl=null,quadProgram=null,rayProgram=null,refSpace=null,canvas=null,tex=null,uiCanvas=null,ctx=null,quadBuffer=null;
let panelMatrix=null,initialPlaced=false,drag=null,hover='',status='Ready',mode='home',lastUI=0,lastClick=0,inputInfo='Waiting for hand / controller tracking';
const WIDTH=1.06,HEIGHT=.83,PIXW=800,PIXH=626;
const mouseMap=new WeakMap(); // pinch fallbacks for sources that lack native select events
const choices=['mug','chair','table','laptop','plant','glass','book'];let noun=0;
const buttons=[
 {label:'01  SNAPSHOT',x:32,y:348,w:355,h:70,id:'snapshot'},
 {label:'02  MUSE RECOGNIZE  $',x:413,y:348,w:355,h:70,id:'muse'},
 {label:'03  SAM OBJECT  $',x:32,y:432,w:355,h:70,id:'sam'},
 {label:'04  CHANGE OBJECT',x:413,y:432,w:355,h:70,id:'noun'},
 {label:'COLLECTION',x:32,y:525,w:225,h:67,id:'collection'},
 {label:'RECENTER',x:288,y:525,w:225,h:67,id:'recenter'},
 {label:'EXIT XR',x:543,y:525,w:225,h:67,id:'exit'}
];
const vertex=`attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uMVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPos,1.);}`;
const fragment=`precision mediump float;varying vec2 vUV;uniform sampler2D uTex;void main(){gl_FragColor=texture2D(uTex,vUV);}`;
const lineVertex=`attribute vec3 aPos;uniform mat4 uVP;uniform float pointSize;void main(){gl_Position=uVP*vec4(aPos,1.);gl_PointSize=pointSize;}`;
const lineFragment=`precision mediump float;uniform vec4 color;uniform int points;void main(){if(points==1&&length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=color;}`;
function mul(a,b){let o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let n=0;for(let k=0;k<4;k++)n+=a[k*4+r]*b[c*4+k];o[c*4+r]=n;}return o;}
function trans(x,y,z){return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);}
function pnt(m,x,y,z,w=1){return [m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,m[2]*x+m[6]*y+m[10]*z+m[14]*w];}
function worldToLocal(world){const m=panelMatrix;const a=world[0]-m[12],b=world[1]-m[13],c=world[2]-m[14];return [a*m[0]+b*m[1]+c*m[2],a*m[4]+b*m[5]+c*m[6],a*m[8]+b*m[9]+c*m[10]];}
function shader(type,source){let s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function makeProgram(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function init(){canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;gl=canvas.getContext('webgl',{alpha:true,antialias:true,xrCompatible:true});if(!gl)throw Error('WebGL unavailable');quadProgram=makeProgram(vertex,fragment);rayProgram=makeProgram(lineVertex,lineFragment);
 const a=[-WIDTH/2,-HEIGHT/2,0,0,1, WIDTH/2,-HEIGHT/2,0,1,1, -WIDTH/2,HEIGHT/2,0,0,0,
          -WIDTH/2,HEIGHT/2,0,0,0, WIDTH/2,-HEIGHT/2,0,1,1, WIDTH/2,HEIGHT/2,0,1,0];
 quadBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);
 gl.useProgram(quadProgram);gl.enableVertexAttribArray(gl.getAttribLocation(quadProgram,'aPos'));gl.vertexAttribPointer(gl.getAttribLocation(quadProgram,'aPos'),3,gl.FLOAT,false,20,0);
 gl.enableVertexAttribArray(gl.getAttribLocation(quadProgram,'aUV'));gl.vertexAttribPointer(gl.getAttribLocation(quadProgram,'aUV'),2,gl.FLOAT,false,20,12);
 tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);for(const prop of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,prop,gl.LINEAR);for(const prop of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,prop,gl.CLAMP_TO_EDGE);
 uiCanvas=document.createElement('canvas');uiCanvas.width=PIXW;uiCanvas.height=PIXH;ctx=uiCanvas.getContext('2d');gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
}
function rect(x,y,w,h,rad,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,rad);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.lineWidth=2;ctx.strokeStyle=stroke;ctx.stroke();}}
function label(t,x,y,size=22,color='#F2F7F3',weight=500){ctx.fillStyle=color;ctx.font=`${weight} ${size}px system-ui, sans-serif`;ctx.fillText(String(t),x,y);}
function ellip(t,max=60){t=String(t||'');return t.length>max?t.slice(0,max-1)+'…':t;}
function draw(){if(!ctx)return;ctx.clearRect(0,0,PIXW,PIXH);rect(2,2,796,622,30,'rgba(22,30,27,.96)','#8fb8a3');
 rect(22,20,756,77,23,'#303c35');rect(38,35,42,42,15,'#c9f9d0');label('FREELAB',98,66,28,'#f8faf7',750);label('GRIP HEADER TO MOVE  ⋮⋮',493,65,15,'#afc6ba',650);
 label('WORLD-ANCHORED  /  XR  /  v0.3.0',32,137,16,'#91c5aa',700);label(ellip(inputInfo,90),32,163,15,'#bcd5c3');
 const st=window.FreeLab?.getState()||{};
 const camera=window.FreeLab?.cameraReport?.()||'Camera unknown';
 label(mode==='library'?'Private objects':'Capture what you see.',32,206,36,'#fff',650);
 if(mode==='library'){
   const objects=st.objects||[];
   if(!objects.length)label('No objects saved. Take a snapshot and recognize.',32,248,19,'#d4e3d8');
   objects.slice(0,2).forEach((o,i)=>label('◌  '+ellip(o.label,48),32,245+i*33,22,'#d4e3d8'));
 }else{
   label('1. Enable the real camera before entering XR.',32,247,19,'#d4e3d8');
   label('2. Snapshot is free. Muse & SAM are billed.',32,279,19,'#d4e3d8');
   label('SAM target: '+choices[noun],32,314,20,'#cbffd4',650);
 }
 for(const b of buttons){const light=b.id==='snapshot'||b.id==='muse';rect(b.x,b.y,b.w,b.h,17,b.id===hover?'#466b56':light?'#ddf8de':'#303d35',b.id===hover?'#b7ffc5':'#4d6857');label(b.label,b.x+17,b.y+43,b.w<250?19:20,b.id===hover?'#fff':light?'#183122':'#e5f3e8',680);}
 label(ellip(camera,85),32,612,15,'#bbd9c5');label(ellip(status,92),32,338,16,'#e2e7a9');
 gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,uiCanvas);
}
function origin(frame,source){try{const pose=frame.getPose(source.targetRaySpace,refSpace);if(!pose)return null;const m=pose.transform.matrix;return {o:[m[12],m[13],m[14]],d:[-m[8],-m[9],-m[10]]};}catch{return null;}}
function hit(frame,source){if(!panelMatrix)return null;const ray=origin(frame,source);if(!ray)return null;const o=worldToLocal(ray.o),d=worldToLocal([ray.o[0]+ray.d[0],ray.o[1]+ray.d[1],ray.o[2]+ray.d[2]]).map((n,i)=>n-o[i]);
 if(Math.abs(d[2])<.0001)return null;const k=-o[2]/d[2];if(k<0||k>8)return null;const x=o[0]+k*d[0],y=o[1]+k*d[1],px=(x/WIDTH+.5)*PIXW,py=(.5-y/HEIGHT)*PIXH;
 return {px,py,dist:k,button:buttons.find(b=>px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h),header:px>20&&px<780&&py>16&&py<99};}
function recenter(pose){panelMatrix=mul(pose.transform.matrix,trans(0,0,-1.35));status='World-locked: menu stays in this room position';draw();}
function selectStart(e){const h=hit(e.frame,e.inputSource);if(!h?.header)return;const ray=origin(e.frame,e.inputSource);if(ray)drag={source:e.inputSource,start:ray.o,base:[panelMatrix[12],panelMatrix[13],panelMatrix[14]]};}
function selectEnd(e){if(drag?.source===e.inputSource)drag=null;}
function moveDrag(frame){if(!drag)return;const ray=origin(frame,drag.source);if(!ray)return;const d=ray.o.map((v,i)=>v-drag.start[i]);for(let i=0;i<3;i++)panelMatrix[12+i]=drag.base[i]+Math.max(-2.2,Math.min(2.2,d[i]));}
function setStatus(msg){status=msg;draw();window.FreeLab?.notify?.(msg);}
function action(id,pose){const now=performance.now();if(now-lastClick<350)return;lastClick=now;
 switch(id){case 'snapshot':capture(false);break;
 case 'muse':capture(true);break;
 case 'sam':segment();break;
 case 'noun':noun=(noun+1)%choices.length;status='SAM target: '+choices[noun];draw();break;
 case 'collection':mode=mode==='library'?'home':'library';draw();break;
 case 'recenter':if(pose)recenter(pose);break;
 case 'exit':session?.end();break;}}
function select(e){const h=hit(e.frame,e.inputSource);if(h?.header)return;if(h?.button)action(h.button.id,e.frame.getViewerPose(refSpace));}
async function capture(recognize){try{const report=window.FreeLab.cameraReport();if(!report.startsWith('LIVE'))throw Error('No live camera pixels. Exit XR and enable/Test Camera first.');
 window.FreeLab.snapshot();if(!recognize){setStatus('Snapshot captured locally · zero API calls');return;}
 setStatus('Sending ONE snapshot to Muse…');const ok=await window.FreeLab.submitCapture(true);setStatus(ok?'Muse objects added to private collection':'Recognition failed; see toast / usage');}
 catch(e){setStatus(e.message);}}
async function segment(){try{const report=window.FreeLab.cameraReport();if(!report.startsWith('LIVE'))throw Error('No live camera. Enable it before entering XR.');window.FreeLab.snapshot();
 setStatus('Sending ONE SAM 3.1 request for '+choices[noun]+'…');const count=await window.FreeLab.segmentSnapshot(choices[noun]);setStatus(count!==false?`${count} SAM box(es) for ${choices[noun]} · see camera panel after XR`:'SAM request failed');}
 catch(e){setStatus(e.message);}}
function describe(){if(!session)return;let h=0,c=0;for(const src of session.inputSources){if(src.hand)h++;else if(src.gamepad)c++;}inputInfo=`INPUT ${h} hand(s) + ${c} controller(s) · pinch / trigger`;draw();}
function poll(frame){moveDrag(frame);for(const src of session.inputSources){if(!src.hand||typeof frame.getJointPose!=='function')continue;const thumb=src.hand.get('thumb-tip'),index=src.hand.get('index-finger-tip');if(!thumb||!index)continue;
 try{const a=frame.getJointPose(thumb,refSpace),b=frame.getJointPose(index,refSpace);if(!a||!b)continue;const dist=Math.hypot(a.transform.position.x-b.transform.position.x,a.transform.position.y-b.transform.position.y,a.transform.position.z-b.transform.position.z);
 const was=mouseMap.get(src)||false; // Standard XR select events are preferred; this is the joint-tracking fallback.
 if(!was&&dist<.018){mouseMap.set(src,true);const h=hit(frame,src);if(h?.header){const r=origin(frame,src);if(r)drag={source:src,start:r.o,base:[panelMatrix[12],panelMatrix[13],panelMatrix[14]]};}else if(h?.button)action(h.button.id,frame.getViewerPose(refSpace));}
 else if(was&&dist>.045){mouseMap.set(src,false);if(drag?.source===src)drag=null;}
 }catch{}}
}
function drawRays(frame,vp){gl.useProgram(rayProgram);gl.uniformMatrix4fv(gl.getUniformLocation(rayProgram,'uVP'),false,vp);const loc=gl.getAttribLocation(rayProgram,'aPos');const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
 for(const src of session.inputSources){const ray=origin(frame,src);if(!ray)continue;const h=hit(frame,src);const len=h&&h.px>-50&&h.px<PIXW+50&&h.py>-50&&h.py<PIXH+50?h.dist:1.15;
 const end=ray.o.map((v,i)=>v+ray.d[i]*len);const col=src.hand?[.68,1,.73,.88]:[.48,.86,1,.9];
 gl.uniform4fv(gl.getUniformLocation(rayProgram,'color'),new Float32Array(col));gl.uniform1i(gl.getUniformLocation(rayProgram,'points'),0);gl.uniform1f(gl.getUniformLocation(rayProgram,'pointSize'),1);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([...ray.o,...end]),gl.DYNAMIC_DRAW);gl.drawArrays(gl.LINES,0,2);
 gl.uniform1i(gl.getUniformLocation(rayProgram,'points'),1);gl.uniform1f(gl.getUniformLocation(rayProgram,'pointSize'),h?.button?21:12);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(end),gl.DYNAMIC_DRAW);gl.drawArrays(gl.POINTS,0,1);
 }gl.deleteBuffer(buf);}
function frameTick(t,frame){if(!session)return;session.requestAnimationFrame(frameTick);const pose=frame.getViewerPose(refSpace);if(!pose)return;if(!initialPlaced){recenter(pose);initialPlaced=true;}
 poll(frame);if(t-lastUI>1200){const first=[...session.inputSources].map(s=>hit(frame,s)?.button?.id).find(Boolean)||'';if(first!==hover){hover=first;draw();}if(t-lastUI>1200)draw();lastUI=t;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 for(const view of pose.views){const viewport=session.renderState.baseLayer.getViewport(view);gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
 const vp=mul(view.projectionMatrix,view.transform.inverse.matrix);
 gl.useProgram(quadProgram);gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.vertexAttribPointer(gl.getAttribLocation(quadProgram,'aPos'),3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(gl.getAttribLocation(quadProgram,'aUV'),2,gl.FLOAT,false,20,12);gl.uniformMatrix4fv(gl.getUniformLocation(quadProgram,'uMVP'),false,mul(vp,panelMatrix));gl.bindTexture(gl.TEXTURE_2D,tex);gl.drawArrays(gl.TRIANGLES,0,6);
 drawRays(frame,vp); // world-space rays and cursor; not browser DOM overlays
 }}
async function start(){if(session)return;if(!navigator.xr)throw Error('WebXR not available; use Quest Browser on HTTPS');if(!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('This browser does not support immersive AR');
 init();await gl.makeXRCompatible();session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking','plane-detection','anchors']});
 session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:true})});
 try{refSpace=await session.requestReferenceSpace('local-floor');}catch{refSpace=await session.requestReferenceSpace('local');}
 initialPlaced=false;mode='home';session.addEventListener('selectstart',selectStart);session.addEventListener('selectend',selectEnd);session.addEventListener('select',select);session.addEventListener('squeeze',()=>capture(false));session.addEventListener('inputsourceschange',describe);
 session.addEventListener('end',()=>{session=null;drag=null;panelMatrix=null;initialPlaced=false;window.FreeLab?.notify?.('Exited spatial reality');});
 describe();status=window.FreeLab.cameraReport();draw();session.requestAnimationFrame(frameTick);
}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
