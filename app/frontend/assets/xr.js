/* FREELAB 0.9.2 — Voice roundels, direct grabs and stable pinned controls.
   Minimal WebGL WebXR renderer: real camera input only, no fake passthrough pixels.
   World-positioned photos, yaw-upright follow toolbar, image derivatives, spatial grab.
   Flat grey floating controls, double-sided, draggable spatial cards.
*/
(()=>{'use strict';
let gl,canvas,program,lineProgram,quad,rayBuffer,refSpace,session,root,poseReady=false;
let meshUniforms=null;
let toolbar=null,editbar=null,statusCard=null,cloud=null,clouds=[],cards=[],zones=[],selected=null,held=null;
let imageMenuOpen=false,voiceBadge=null,voicePhase='idle',voiceMessage='',voiceUntil=0,voicePending=null,voiceOk=null,voiceCancel=null,voiceResultStamp=0;
let mascotProgram=null,mascotBuffer=null,mascotVertexCount=0,mascotMood='curious',mascotMoodUntil=0,mascotVelocity=[.25,.22,.19],lastMascotTick=0;
let gestureDebounce=new Map(),lastGesturePoll=0,gestureDisplay='',lastGestureAnnouncement=-100000;
let mascotSpeech=null,mascotSpeechUntil=0,gestureSpeechTimes=new Map();
let pointerHover=null,lastFrame=0,lastUi=0,lastAction=0,latestPose=null,nextPaidAt=0,busy=false,mode='capture',statusText='Capture your space',statusUntil=0;
let followMode=true,followBase=null,eyeBase=null,captureEye=null,voiceButton=null,extractButton=null,eyeResource=null,cameraPreview=null,previewResource=null,lastPreview=0,eyeState='idle',eyeUntil=0,rootYaw=0,menuYaw=0,promptPanel=null,promptContext=null,promptText='',xrDomOverlay=false;
let debugPanel=null,debugShowing=false,debugLast=0,serverPoll=0,serverDiagnostic=[],mascotPointer=null,mascotTex=null,lastAvatar=0,mixBucket=[],xrKeyboard=null;
let followOffset=[0,-.53,-1.16],followWorld=null,eyeWorld=null,depthState='unknown',depthChecked=false,depthFeature=false,depthBinding=null,meshyJob=null,meshyPollAt=0,meshConfirm=null;
let particles=[],handPinch=new WeakMap(),lastNative=new WeakMap(),clickState=new WeakMap(),lastEyeUpdate=0,lastMicUpdate=0,inferenceCard=null,inferenceStarted=0;
const PW=600,PH=420,MAX_CLOUD=10,TAU=2*Math.PI;
// One navigation pill. Image-specific actions belong only to the selected card.
const tools=[['gallery','▣'],['follow','◎'],['debug','≡'],['exit','×']];
// A context menu only exists after clicking the image's ···, never in parallel by default.
const sourceTools=[['refine','✦'],['prompt','✎'],['voice','♫'],['3d','⬡'],['closemenu','×']];
const objectTools=[['refine','✦'],['prompt','✎'],['voice','♫'],['3d','⬡'],['closemenu','×']];
function currentTools(){return tools;}
function imageTools(){return selected?.kind==='source'?sourceTools:objectTools;}
function cue(name,src){window.FreeLabSound?.play(name);if(src)haptic(src,name==='hover'?.16:.35,name==='hover'?23:55);}
function haptic(src,strength=.25,ms=35){try{const gamepad=src?.gamepad;const a=gamepad?.hapticActuators?.[0];if(a?.pulse){a.pulse(strength,ms).catch?.(()=>{});}else gamepad?.vibrationActuator?.playEffect?.('dual-rumble',{duration:ms,strongMagnitude:strength,weakMagnitude:strength*.7})?.catch?.(()=>{});}catch{}}

const promptTools=[['voice','◎'],['apply','↗'],['cancel','×']];
const threeDTools=[['submit3d','⬡'],['cancel3d','×']];
const V=`attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uMVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPos,1.);}`;
const F=`precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform bool uFlip;void main(){vec2 uv=vec2(uFlip?1.-vUV.x:vUV.x,vUV.y);gl_FragColor=texture2D(uTex,uv);}`;
const LV=`attribute vec3 aPos;uniform mat4 uVP;uniform float uSize;void main(){gl_Position=uVP*vec4(aPos,1.);gl_PointSize=uSize;}`;
const LF=`precision mediump float;uniform vec4 uColor;uniform bool uPoint;void main(){if(uPoint&&length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=uColor;}`;
const MV=`attribute vec3 aPos;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat4 uModel;varying vec3 vNormal;void main(){vNormal=normalize(mat3(uModel)*aNormal);gl_Position=uMVP*vec4(aPos,1.);}`;
const MF=`precision mediump float;varying vec3 vNormal;uniform vec4 uColor;void main(){vec3 n=normalize(vNormal);float light=.55+.40*max(dot(n,normalize(vec3(-.3,.75,.65))),0.);gl_FragColor=vec4(uColor.rgb*light+.09*uColor.rgb,uColor.a);}`;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const vadd=(a,b)=>a.map((x,i)=>x+b[i]);const vsub=(a,b)=>a.map((x,i)=>x-b[i]);const vmul=(a,k)=>a.map(x=>x*k);
const length=a=>Math.hypot(...a);const norm=a=>vmul(a,1/(length(a)||1));
function matmul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let i=0;i<4;i++)s+=a[i*4+r]*b[c*4+i];o[c*4+r]=s;}return o;}
function translate(x=0,y=0,z=0){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);}
function rotateY(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);}
function scale(x,y,z){return new Float32Array([x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1]);}
function quatNorm(a){const d=Math.hypot(...a)||1;return a.map(v=>v/d);}
function quatMul(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X,w*W-x*X-y*Y-z*Z];}
function quatInv(a){return [-a[0],-a[1],-a[2],a[3]];}
function quatY(yaw){return [0,Math.sin(yaw/2),0,Math.cos(yaw/2)];}
function blend(a,b,s){return a.map((v,i)=>v+(b[i]-v)*s);}
function smoothYaw(a,b,alpha){return a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*alpha;}
// The card and the toolbar use different world-space roots; the headset cannot pull a saved photo along with it.
function poseForwardAnchor(pose,metres,below=0){return viewerAnchor(pose,below,metres);}
function quatMatrix(q){const [x,y,z,w]=quatNorm(q),xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
 return new Float32Array([1-2*(yy+zz),2*(xy+wz),2*(xz-wy),0,2*(xy-wz),1-2*(xx+zz),2*(yz+wx),0,2*(xz+wy),2*(yz-wx),1-2*(xx+yy),0,0,0,0,1]);}
function inputPose(frame,src){try{
 // Use exactly the same target-ray space for orientation, position and pointing.
 // GripSpace differs from TargetRaySpace and causes card/hand rotation drift.
 let p=src.targetRaySpace?frame.getPose(src.targetRaySpace,refSpace):null;
 if(!p&&src.hand)p=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace);
 if(!p&&src.gripSpace)p=frame.getPose(src.gripSpace,refSpace);
 return p||null;
 }catch{return null;}}
function poseQuat(frame,src){const q=inputPose(frame,src)?.transform?.orientation;return q?quatNorm([q.x,q.y,q.z,q.w]):null;}
function posePosition(frame,src){const q=inputPose(frame,src)?.transform?.position;return q?[q.x,q.y,q.z]:null;}
function quatVec(q,v){return point(quatMatrix(q),v,0);}
function worldCardQuat(c){return quatNorm(quatMul(quatY(rootYaw),c.q||[0,0,0,1]));}
function attachGrab(frame,src,card){
 const devicePos=posePosition(frame,src),deviceQuat=poseQuat(frame,src);
 if(!devicePos||!deviceQuat)return null;
 const center=point(root,rootPos(card));
 return {localPoint:quatVec(quatInv(deviceQuat),vsub(center,devicePos)),
         localQuat:quatNorm(quatMul(quatInv(deviceQuat),worldCardQuat(card)))};
}
function yawFromMatrix(m){return Math.atan2(m[8],m[10]);}
function viewerAnchor(pose,below,away){const m=pose.transform.matrix,yaw=yawFromMatrix(m);
 return matmul(translate(m[12],m[13],m[14]),matmul(rotateY(yaw),translate(0,below,-away)));}
function point(m,p,w=1){return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]*w,m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]*w,m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]*w];}
// Inverse for a general 3x3 affine basis, including card scale and rotation.
function inverse(m){const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];const D=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(D)<1e-8)return null;
 const k=1/D,A=(e*i-f*h)*k,B=(c*h-b*i)*k,C=(b*f-c*e)*k,E=(f*g-d*i)*k,G=(a*i-c*g)*k,H=(c*d-a*f)*k,I=(d*h-e*g)*k,J=(b*g-a*h)*k,K=(a*e-b*d)*k;
 const x=m[12],y=m[13],z=m[14];return new Float32Array([A,E,I,0,B,G,J,0,C,H,K,0,-A*x-B*y-C*z,-E*x-G*y-H*z,-I*x-J*y-K*z,1]);}
function compile(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function shader(v,f){const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function setup(){canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;gl=canvas.getContext('webgl',{alpha:true,antialias:false,xrCompatible:true});if(!gl)throw Error('WebGL is unavailable');program=shader(V,F);lineProgram=shader(LV,LF);mascotProgram=shader(MV,MF);initializeMascotSphere();
 const a=[-.5,-.5,0,0,1,.5,-.5,0,1,1,-.5,.5,0,0,0,-.5,.5,0,0,0,.5,-.5,0,1,1,.5,.5,0,1,0];
 quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);rayBuffer=gl.createBuffer();
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
}
// A real perspective-shaded 3D mascot. No billboard textures, CDN or downloaded GLB.
function initializeMascotSphere(){const data=[];const seg=20,rings=14;
 const vertex=(u,v)=>{const theta=Math.PI*v,phi=2*Math.PI*u;return [Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)];};
 for(let j=0;j<rings;j++)for(let i=0;i<seg;i++){
  const a=vertex(i/seg,j/rings),b=vertex((i+1)/seg,j/rings),c=vertex(i/seg,(j+1)/rings),d=vertex((i+1)/seg,(j+1)/rings);
  for(const v of [a,c,b,b,c,d])data.push(...v,...v);
 }
 mascotVertexCount=data.length/6;mascotBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mascotBuffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
}
function mascotMode(){return window.FreeLab?.pref?.('mascotMode')||'3d';}
function mascotEmotion(type,ms=3300){mascotMood=type;mascotMoodUntil=performance.now()+ms;}
function drawMascot3D(vp,t){if(!mascotPointer?.visible||mascotMode()!=='3d'||!mascotProgram)return;
 const m=mascotPointer,now=t/1000,bounce=Math.sin(now*3)*.007,smile=mascotMood==='happy';
 const blink=mascotMood==='sleepy'? .18: Math.pow(Math.max(0,Math.sin(now*.43)),44)*.86;
 const yaw=cameraYaw(latestPose),base=matmul(translate(m.pos[0],m.pos[1]+bounce,m.pos[2]),matmul(rotateY(yaw),scale(.53,.53,.53)));
 gl.useProgram(mascotProgram);gl.bindBuffer(gl.ARRAY_BUFFER,mascotBuffer);
 const loc=gl.getAttribLocation(mascotProgram,'aPos'),norm=gl.getAttribLocation(mascotProgram,'aNormal');
 gl.enableVertexAttribArray(loc);gl.enableVertexAttribArray(norm);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(norm,3,gl.FLOAT,false,24,12);
 function oval(x,y,z,sx,sy,sz,rgba){const model=matmul(base,matmul(translate(x,y,z),scale(sx,sy,sz)));
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uModel'),false,model);
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uMVP'),false,matmul(vp,model));
  gl.uniform4fv(gl.getUniformLocation(mascotProgram,'uColor'),rgba);gl.drawArrays(gl.TRIANGLES,0,mascotVertexCount);}
 const body=[.45,.73,.53,1],ear=[.30,.49,.35,1],light=[.74,.86,.75,1],eyes=[.035,.095,.049,1];
 oval(0,0,0, .106,.123,.078,body);oval(0,.11,0,.09,.09,.082,body);
 oval(-.061,.19,-.009,.032,.065,.034,ear);oval(.061,.19,-.009,.032,.065,.034,ear);
 oval(-.06,-.032,.03,.043,.050,.042,body);oval(.06,-.032,.03,.043,.05,.042,body);
 oval(-.07,-.116,.045,.041,.024,.045,ear);oval(.07,-.116,.045,.041,.024,.045,ear);
 oval(0,-.018,.072,.058,.073,.026,light);
 for(const sign of [-1,1]){oval(sign*.036,.126,.076,.014,.023*(1-blink)+.002,.008,eyes);
  oval(sign*.031,.135,.084,.004,.006*(1-blink)+.001,.003,[1,1,1,1]);}
 oval(0,.085,.089,.010,smile?.006:.005,.008,ear);
 if(smile){oval(-.014,.066,.090,.004,.005,.003,ear);oval(.014,.066,.090,.004,.005,.003,ear);}
 // A tiny luminous rim near the head gives volume without obscuring the source photo.
}
// The subtitle has no card/background and expands with recognized text.
// It is not a fixed-width, cropped HEARD notification.
function voiceIndicatorTexture(t){
 const processing=voicePhase==='processing';
 const message=processing?'·  ·  ·':voiceMessage;
 const words=String(message||'').slice(0,600).split(/\s+/);
 const probe=canvas2d(16,16)[1];probe.font='bold 43px system-ui';
 const lines=[];let current='';const maxWidth=980;
 for(const word of words){const maybe=current?current+' '+word:word;
  if(probe.measureText(maybe).width>maxWidth&&current){lines.push(current);current=word;}else current=maybe;
 }
 if(current)lines.push(current);
 const w=1024,h=Math.max(98,30+lines.length*62);
 const [c,ctx]=canvas2d(w,h);ctx.clearRect(0,0,w,h);
 ctx.font='bold 43px system-ui';ctx.textBaseline='middle';ctx.textAlign='center';
 for(let i=0;i<lines.length;i++){
  ctx.strokeStyle='#080b08';ctx.lineWidth=9;ctx.lineJoin='round';
  ctx.strokeText(lines[i],w/2,47+i*62);
  ctx.fillStyle='#ffe64b';ctx.fillText(lines[i],w/2,47+i*62);
 }
 return {tex:texture(c),aspect:h/w};
}
function setVoicePhase(type,message,ms=7500){
 voicePhase=type;voiceMessage=String(message||'');voiceUntil=ms===Infinity?Infinity:performance.now()+ms;
 if(voiceBadge?.front&&gl)gl.deleteTexture(voiceBadge.front);voiceBadge=null;
}
function tickVoiceIndicator(t,pose){
 if(voicePhase==='idle'||voicePhase==='listening')return;
 if(!voiceBadge&&voiceUntil>t){const v=voiceIndicatorTexture(t);
  voiceBadge={id:'voice-status',kind:'status',pos:[0,0,0],q:[0,0,0,1],size:[.93,.93*v.aspect],scale:1,visible:true,front:v.tex,back:v.tex};}
 if(!voiceBadge)return;
 if(voiceUntil<t){if(gl)gl.deleteTexture(voiceBadge.front);voiceBadge=null;voicePhase='idle';return;}
 if(voicePhase==='processing'&&t%480<38){const v=voiceIndicatorTexture(t);
  gl.deleteTexture(voiceBadge.front);voiceBadge.front=v.tex;voiceBadge.back=v.tex;}
 const anchor=point(poseForwardAnchor(pose,1.0,.14),[0,0,0]);
 voiceBadge.pos=blend(voiceBadge.pos,anchor,.22);voiceBadge.q=quatY(cameraYaw(pose));
}
function canvas2d(w=PW,h=PH){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function rrect(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(ctx,msg,x,y,size=24,color='#fff',weight=600,align='left'){ctx.font=`${weight} ${size}px system-ui, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(msg),x,y);ctx.textAlign='left';}
function wrapping(ctx,str,x,y,width,lh=30,lines=4){ctx.font='22px system-ui';const words=String(str||'').split(/\s+/);let out='',n=0;for(const word of words){const test=out?out+' '+word:word;if(ctx.measureText(test).width>width&&out){text(ctx,out,x,y+n*lh,21,'#d4ded9',450);out=word;n++;if(n>=lines)return;}else out=test;}if(out)text(ctx,out,x,y+n*lh,21,'#d4ded9',450);}
function texture(c){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);return t;}
function cardTexture(imageSrc,labelText,sub='PRIVATE CAPTURE',back=false,onDimensions=null){
 // Canvas and geometry both adapt to the source dimensions: never stretch or center-crop an object.
 const resource={tex:null,canvas:null};
 const paint=(image=null)=>{const fullWidth=600,frameWidth=566;
  const frameHeight=image?clamp(Math.round(frameWidth*image.height/image.width),112,1000):310;
  const h=back?420:frameHeight+110;const [c,ctx]=canvas2d(fullWidth,h);resource.canvas=c;
  rrect(ctx,0,0,fullWidth,h,29,'#343c38');
  if(back){rrect(ctx,18,18,fullWidth-36,h-36,24,'#424a46');text(ctx,'FREELAB / OBJECT',40,65,19,'#a7c0b0',670);text(ctx,labelText.slice(0,25),40,130,37,'#fff',690);wrapping(ctx,sub,40,175,fullWidth-86,32,6);}
  else{
   rrect(ctx,17,17,frameWidth,frameHeight,18,'#131a17');
   if(image){const factor=Math.min(frameWidth/image.width,frameHeight/image.height);const w=image.width*factor,hh=image.height*factor;
    ctx.drawImage(image,17+(frameWidth-w)*.5,17+(frameHeight-hh)*.5,w,hh);}
   else text(ctx,'◎',fullWidth/2,frameHeight/2+53,102,'#9baea2',250,'center');
   if(sub.includes('SOURCE FRAME')){rrect(ctx,35,30,182,54,24,'#d6f3dc');text(ctx,'✳ EXTRACT',126,66,21,'#213b2b',690,'center');}
   text(ctx,labelText.slice(0,34),28,h-58,27,'#f4fff6',680);text(ctx,sub.slice(0,56),28,h-23,15,'#c4d3c7',540);
  }
  if(!back){rrect(ctx,fullWidth-150,27,55,55,26,'#28352f');text(ctx,'···',fullWidth-122,64,31,'#ffffff',630,'center');
   rrect(ctx,fullWidth-84,27,55,55,26,'#28352f');text(ctx,'×',fullWidth-57,68,37,'#ffffff',440,'center');}
  else{rrect(ctx,fullWidth-85,27,55,55,26,'#28352f');text(ctx,'×',fullWidth-57,68,39,'#ffffff',400,'center');}
  if(resource.tex){gl.bindTexture(gl.TEXTURE_2D,resource.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);}else resource.tex=texture(c);
  if(image&&onDimensions)onDimensions(c.width,c.height);
 };
 paint();
 if(imageSrc){const img=new Image();img.decoding='async';img.onload=()=>{if(gl&&resource.tex)paint(img);};img.onerror=()=>{};img.src=imageSrc;}
 return resource;
}
function cardDimensions(width,height,kind){const aspect=height/Math.max(1,width),base=kind==='source'?.88:kind==='object'?.37:.35;
 const limit=kind==='source'?.95:kind==='object'?.60:.54;const widthMetres=Math.min(base,limit/aspect);
 return [widthMetres,widthMetres*aspect];}
function toolbarTexture(kind){
 const context=kind==='context';const names=context?(meshConfirm?[['submit3d','⬡'],['cancel3d','×']]:imageTools()):tools;
 const w=context?300:540,h=context?names.length*76+24:116;
 const [c,ctx]=canvas2d(w,h);rrect(ctx,0,0,w,h,context?32:54,'#363d39');
 const labels={gallery:'LIB',follow:followMode?'PIN':'FOLLOW',debug:'LOG',exit:'EXIT',
  refine:'RESTORE AI · paid',prompt:'PROMPT', '3d':'GENERATE 3D',closemenu:'CLOSE',submit3d:'CONFIRM 3D · paid',cancel3d:'CANCEL'};
 if(context){names.forEach(([id,glyph],idx)=>{const y=18+idx*76,active=pointerHover===id;
   if(active)rrect(ctx,10,y,w-20,69,21,'#52695b');
   text(ctx,glyph,42,y+44,36,active?'#d0ffdc':'#f4f7f4',550,'center');
   text(ctx,labels[id]||id,82,y+43,id==='refine'?21:24,'#f3f7f3',580);
 });}else{const step=w/names.length;names.forEach(([id,glyph],idx)=>{const cx=step*(idx+.5),active=pointerHover===id;
   if(active)rrect(ctx,cx-step*.43,5,step*.86,h-10,28,'#52695b');
   text(ctx,glyph,cx,55,40,active?'#d0ffdc':'#f2f7f2',580,'center');
   text(ctx,labels[id]||id,cx,96,19,'#f2f6f2',590,'center');
 });}
 return texture(c);
}
function promptTexture(){const t=toolbarTexture('prompt');return t;}
function eyeTexture(){const [c,ctx]=canvas2d(320,320);const t=texture(c);return {canvas:c,ctx,tex:t};}
function paintEye(t){if(!captureEye||!eyeResource||!gl)return;const {canvas:c,ctx,tex}=eyeResource;ctx.clearRect(0,0,320,320);
 const isBusy=eyeState==='activating'||eyeState==='snapping';const pulse=isBusy?Math.sin(t*.017)*.5+.5:Math.sin(t*.002)*.5+.5;
 const iris=isBusy?62+pulse*15:64+pulse*4;const blink=isBusy?Math.abs(Math.sin(t*.014))*.35:Math.pow(Math.max(0,Math.cos(t*.00095)),24)*.19;
 ctx.beginPath();ctx.arc(160,160,147,0,TAU);ctx.fillStyle='#343e38';ctx.fill();
 ctx.beginPath();ctx.ellipse(160,160,118,80*(1-blink),0,0,TAU);ctx.fillStyle='#e3f3e4';ctx.fill();
 ctx.beginPath();ctx.arc(160,160,iris,0,TAU);ctx.fillStyle=eyeState==='error'?'#a75e5e':'#5f8e75';ctx.fill();
 ctx.beginPath();ctx.arc(160,160,36,0,TAU);ctx.fillStyle='#16221b';ctx.fill();
 ctx.beginPath();ctx.ellipse(143,138,15,19,-.3,0,TAU);ctx.fillStyle='#fff';ctx.fill();
 ctx.strokeStyle=isBusy?'#d5ffd8':'#84bb90';ctx.lineWidth=6;ctx.beginPath();ctx.arc(160,160,141,t*.001,t*.001+Math.PI*(isBusy?1.6:1.05));ctx.stroke();
 gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
}
function roundelTexture(kind){
 kind=kind==='voiceroundel'?'mic':kind==='extractroundel'?'extract':kind;
 const [c,ctx]=canvas2d(256,256);
 const disabled=busy&&voicePhase!=='listening';
 ctx.beginPath();ctx.arc(128,128,118,0,TAU);
 ctx.fillStyle=disabled?'#303932':'#36433b';ctx.fill();
 if(kind==='mic'){
  const live=voicePhase==='listening',processing=voicePhase==='processing';
  ctx.strokeStyle=live?'#ff6265':'#f4fff4';ctx.lineWidth=13;ctx.lineCap='round';
  ctx.beginPath();ctx.roundRect(103,65,50,93,24);ctx.stroke();
  ctx.beginPath();ctx.arc(128,141,49,0,Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(128,190);ctx.lineTo(128,206);ctx.moveTo(101,208);ctx.lineTo(155,208);ctx.stroke();
  if(live){const glow=15+Math.sin(performance.now()*.012)*9;ctx.strokeStyle='#ff6568';ctx.lineWidth=7;ctx.beginPath();ctx.arc(128,128,100+glow*.35,0,TAU);ctx.stroke();}
  if(processing){ctx.fillStyle='#ffe64b';for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(86+i*42,222,6,0,TAU);ctx.fill();}}
 }else if(kind==='extract'){
  ctx.font='124px system-ui';ctx.fillStyle=disabled?'#819187':'#d9ffe0';ctx.textAlign='center';ctx.fillText('✳',128,173);
 }else{
  ctx.font='bold 94px system-ui';ctx.textAlign='center';ctx.fillStyle='#1d3227';
  ctx.fillText(kind==='ok'?'OK':'×',128,161);
 }
 return texture(c);
}
function makeRoundel(id,kind,size){const t=roundelTexture(kind);return {id,kind,size:[size,size],pos:[0,0,0],q:[0,0,0,1],scale:1,visible:true,front:t,back:t,resources:[t]};}
function refreshRoundel(card,kind){if(!card||!gl)return;const t=roundelTexture(kind);gl.deleteTexture(card.front);card.front=t;card.back=t;card.resources=[t];}
function syncRoundels(pose){
 if(!captureEye)return;
 const yaw=cameraYaw(pose),frame=rotateY(yaw);
 const offset=(x,y,z)=>point(frame,[x,y,z],0);
 if(voiceButton){voiceButton.pos=vadd(captureEye.pos,offset(-.163,0,0));voiceButton.q=quatY(yaw);}
 if(extractButton){extractButton.visible=!!cloud&&cards.some(c=>c.kind==='source'&&c.visible)&&!cloud.collapsed;
  extractButton.pos=vadd(captureEye.pos,offset(.163,0,0));extractButton.q=quatY(yaw);}
 if(voicePending){const center=point(poseForwardAnchor(pose,.97,-.045),[0,0,0]);
  if(voiceOk){voiceOk.pos=vadd(center,offset(-.087,0,0));voiceOk.q=quatY(yaw);}
  if(voiceCancel){voiceCancel.pos=vadd(center,offset(.087,0,0));voiceCancel.q=quatY(yaw);}
 }
}
function updateMicVisual(t){if(!voiceButton||t-lastMicUpdate<110)return;lastMicUpdate=t;refreshRoundel(voiceButton,'mic');}
function previewTexture(){const [c,ctx]=canvas2d(384,282);return {tex:texture(c),canvas:c,ctx};}
function updateLivePreview(t){if(!cameraPreview||!previewResource||!cameraPreview.visible||t-lastPreview<190)return;
 lastPreview=t;const video=document.getElementById('cameraVideo');if(!video||video.videoWidth<1||video.videoHeight<1||video.readyState<2)return;
 const {tex,canvas:c,ctx}=previewResource;ctx.clearRect(0,0,c.width,c.height);rrect(ctx,0,0,c.width,c.height,28,'#323c35');
 const w=352,h=222,k=Math.min(w/video.videoWidth,h/video.videoHeight),dw=video.videoWidth*k,dh=video.videoHeight*k;
 try{ctx.drawImage(video,16+(w-dw)/2,16+(h-dh)/2,dw,dh);
  text(ctx,'LIVE CAMERA · REAL PIXELS',19,c.height-20,17,'#dcf9df',660);
  gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
 }catch(e){cameraPreview.visible=false;setStatus('Camera stream cannot be rendered in XR: '+e.message,9500);}}
function showLivePreview(){if(!cameraPreview){previewResource=previewTexture();cameraPreview={id:'live-preview',kind:'capturepreview',size:[.33,.24],pos:[.37,.012,-.07],q:[0,0,0,1],scale:1,visible:true,front:previewResource.tex,back:previewResource.tex,resources:[previewResource.tex]};}
 cameraPreview.visible=true;lastPreview=0;}
function setEyeState(value,ms=950){eyeState=value;eyeUntil=performance.now()+ms;}

function mascotTexture(){const [c,ctx]=canvas2d(200,240);ctx.clearRect(0,0,200,240);
 ctx.fillStyle='#5f8266';ctx.beginPath();ctx.ellipse(52,54,27,51,-.3,0,TAU);ctx.ellipse(148,54,27,51,.3,0,TAU);ctx.fill();
 ctx.fillStyle='#81a38a';ctx.beginPath();ctx.ellipse(100,143,83,85,0,0,TAU);ctx.ellipse(100,83,79,76,0,0,TAU);ctx.fill();
 ctx.fillStyle='#bfdbc1';ctx.beginPath();ctx.ellipse(100,171,46,42,0,0,TAU);ctx.fill();
 ctx.fillStyle='#0b1810';for(const x of [72,127]){ctx.beginPath();ctx.ellipse(x,90,11,17,0,0,TAU);ctx.fill();}
 ctx.fillStyle='#ffffff';for(const x of [68,123]){ctx.beginPath();ctx.arc(x,84,4,0,TAU);ctx.fill();}
 ctx.fillStyle='#42674b';ctx.beginPath();ctx.ellipse(100,117,7,5,0,0,TAU);ctx.fill();return texture(c);}
function debugTexture(){const [c,ctx]=canvas2d(820,370);rrect(ctx,0,0,c.width,c.height,28,'#313c36');text(ctx,'XR / SERVER DIAGNOSTICS · NO REQUEST BODIES',24,36,23,'#cefad5',690);
 const messages=['DEPTH: '+depthState,...(window.FreeLab?.getTrace?.()||[]).filter(x=>['error','api','warn'].includes(x.kind)).slice(-6).map(x=>x.at+' '+x.message),...serverDiagnostic.slice(-5).map(x=>x.time.slice(11,19)+' '+x.method+' '+x.path+' · HTTP '+x.status+' · '+x.duration_ms+'ms')];
 if(!messages.length)messages.push('No recorded errors. Extract and API requests appear here when available.');
 messages.slice(-8).forEach((msg,i)=>text(ctx,String(msg).slice(0,92),24,80+i*34,18,'#ebf4ea',490));return texture(c);}
async function loadServerDiagnostic(){if(!session||!debugShowing)return;try{const data=await window.FreeLab.serverDiagnostics();serverDiagnostic=data.entries||[];}catch(e){serverDiagnostic=[{time:new Date().toISOString(),method:'INFO',path:'Server diagnostics: '+e.message,status:'-',duration_ms:0}];}}
function updateDebugCard(t){if(!debugShowing||!toolbar||!gl)return;if(!debugPanel){const tex=debugTexture();debugPanel={id:'diagnostics',kind:'status',pos:[0,-.32,0],q:[0,0,0,1],size:[.90,.39],scale:1,visible:true,front:tex,back:tex};}
 if(t-debugLast>1200){debugLast=t;const tex=debugTexture();gl.deleteTexture(debugPanel.front);debugPanel.front=tex;debugPanel.back=tex;}
 if(t-serverPoll>6000){serverPoll=t;loadServerDiagnostic();}}
function zoneTexture(icon,labelName){const [c,ctx]=canvas2d(200,200);rrect(ctx,0,0,200,200,96,'#414a45');text(ctx,icon,100,121,95,'#eefcf0',450,'center');text(ctx,labelName,100,172,20,'#c3d5c8',580,'center');return texture(c);}
function statusTexture(value){const [c,ctx]=canvas2d(740,94);rrect(ctx,0,0,c.width,c.height,40,'#3b4340');text(ctx,value.slice(0,57),c.width/2,58,27,'#f3f8f2',540,'center');return texture(c);}
function addCard(id,kind,data,loc,size){let c;
 const front=cardTexture(data.image||null,data.label||'',data.subtitle||'',false,(w,h)=>{if(c){c.size=cardDimensions(w,h,kind);c.canvasHeight=h;c.buttonBand=.5-86/h;}});
 const back=cardTexture(null,data.label||'',`FOLDER: ${data.folder||'Unsorted'}. ${data.description||'Object from your personal space'}`,true);
 c={id,kind,data,front:front.tex,back:back.tex,resources:[front.tex,back.tex],pos:[...loc],from:[...loc],to:[...loc],start:0,duration:0,scale:1,rot:0,q:[0,0,0,1],visible:true,size,canvasHeight:420,buttonBand:.28,original:[...loc]};cards.push(c);return c;}

function setStatus(value,ms=6000){statusText=String(value);statusUntil=performance.now()+ms;
 window.FreeLab?.notify?.(statusText);refreshToolbar();}
function refreshToolbar(){if(!toolbar||!gl)return;const newTexture=toolbarTexture('main');if(toolbar.front)gl.deleteTexture(toolbar.front);toolbar.front=newTexture;toolbar.back=newTexture;toolbar.resources=[newTexture];}

function animate(c,to,delay=0,ms=950,shrinking=false){c.from=[...c.pos];c.to=[...to];c.start=performance.now()+delay;c.duration=ms;c.shrinking=shrinking;}
function easing(t){return t*t*(3-2*t);}
function tween(t){const now=performance.now();for(const c of cards){if(c.duration<=0)continue;if(now<c.start)continue;const k=clamp((now-c.start)/c.duration,0,1),e=easing(k);
 // Arcing Bezier trajectory with an overshoot along depth. Keep final coordinates stable.
 const a=c.from,b=c.to,u=1-e;
 const c1=[a[0]+(b[0]-a[0])*.16,a[1]+.42,a[2]+.22];
 const c2=[b[0]-(b[0]-a[0])*.19,b[1]+.23,b[2]+.15];
 // A true cubic Bezier path (source -> two floating control points -> destination).
 c.pos=[0,1,2].map(i=>u*u*u*a[i]+3*u*u*e*c1[i]+3*u*e*e*c2[i]+e*e*e*b[i]);
 if(c.shrinking)c.animScale=Math.max(.018,1-e);else c.animScale=Math.max(.03,e);
 if(k===1){c.duration=0;c.pos=[...b];c.animScale=c.shrinking?0:1;c.visible=!c.shrinking;}
 }}
function launchParticles(center){for(let i=0;i<45;i++){const a=Math.random()*TAU,s=Math.random()*.85+.14;particles.push({p:vadd(center,[Math.cos(a)*.12,Math.sin(a)*.12,Math.random()*.2]),v:[Math.cos(a)*s,Math.sin(a)*s,(Math.random()-.5)*s],born:performance.now(),ttl:750+Math.random()*650});}}
function clearCards(){if(!gl)return;closeImageMenu();for(const c of cards)for(const t of c.resources||[])gl.deleteTexture(t);cards=[];selected=null;}
function rootPos(c){return cloud&&!['toolbar','status','captureeye','capturepreview','voiceroundel','extractroundel','voiceok','voicecancel','diagnostics'].includes(c.kind)?vadd(c.pos,cloud.offset||[0,0,0]):c.pos;}
function baseFor(c){if(c.kind==='pointer-mascot'||['toolbar','status','captureeye','capturepreview','voiceroundel','extractroundel','voiceok','voicecancel','diagnostics'].includes(c.kind))return translate();return root;}
function cameraYaw(pose){return yawFromMatrix(pose.transform.matrix);}
function syncTrackedUI(pose,t){
 const yaw=cameraYaw(pose),head=pose.transform.matrix;
 // An upright, camera-facing toolbar with spatial inertia, no accidental inherited pivot.
 if(followMode&&toolbar&&!held?.card?.kind?.includes('toolbar')){
  const desired=point(head,[0,0,0]);const yawMatrix=rotateY(yaw),offset=point(yawMatrix,followOffset,0);
  const target=vadd(desired,offset),alpha=1-Math.exp(-Math.min(.08,(t-lastFrame||16)/1000)*7.5);
  toolbar.pos=blend(toolbar.pos,target,alpha);
 }
 if(toolbar&&followMode){menuYaw=smoothYaw(menuYaw,yaw,Math.min(.24,1-Math.exp(-Math.min(.08,(t-lastFrame||16)/1000)*8.5)));toolbar.q=quatY(menuYaw);}
 // Eye is deliberately smaller and trails the gaze instead of being cemented to the face.
 if(captureEye){const target=point(poseForwardAnchor(pose,1.02,-.18),[0,0,0]);
  const a=1-Math.exp(-Math.min(.08,(t-lastFrame||16)/1000)*3.1);
  captureEye.pos=blend(captureEye.pos,target,a);captureEye.q=quatY(yaw);syncRoundels(pose);}
 if(cameraPreview){cameraPreview.pos=vadd(captureEye?.pos||[head[12],head[13],head[14]],point(rotateY(yaw),[.30,0,-.03],0));cameraPreview.q=quatY(yaw);}
 if(debugPanel){debugPanel.pos=vadd(toolbar?.pos||[head[12],head[13]-.5,head[14]-1.1],[0,-.38,0]);debugPanel.q=quatY(yaw);}
 lastFrame=t;
}
function cardModel(c){
 if(c.kind==='contextbar'&&c.parentCard){const parent=c.parentCard,sc=parent.scale*(parent.animScale===undefined?1:parent.animScale);
  // A single vertical popover floats to the right of its image. Its 3 cm relief prevents z-fighting.
  const x=parent.size[0]*sc*.5+c.size[0]*.52+.035;
  return matmul(baseFor(parent),matmul(translate(...rootPos(parent)),matmul(quatMatrix(parent.q||quatY(parent.rot||0)),matmul(translate(x,0,.038),scale(c.size[0],c.size[1],1)))));}
 const p=rootPos(c),sc=c.scale*(c.animScale===undefined?1:c.animScale);
 return matmul(baseFor(c),matmul(translate(...p),matmul(quatMatrix(c.q||quatY(c.rot||0)),scale(c.size[0]*sc,c.size[1]*sc,1))));}
function cardBack(c){return quatMatrix(c.q||quatY(c.rot||0))[10]<0;}
function drawCard(c,vp){if(!c.visible||!c.front||c.animScale===0)return;const tex=cardBack(c)?c.back:c.front;
 gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,quad);const loc=gl.getAttribLocation(program,'aPos'),uv=gl.getAttribLocation(program,'aUV');gl.enableVertexAttribArray(loc);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12);
 gl.uniformMatrix4fv(gl.getUniformLocation(program,'uMVP'),false,matmul(vp,cardModel(c)));gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(gl.getUniformLocation(program,'uTex'),0);gl.uniform1i(gl.getUniformLocation(program,'uFlip'),cardBack(c)?1:0);gl.drawArrays(gl.TRIANGLES,0,6);}
function line(vp,vertices,color,points=false,size=6){if(!vertices.length)return;gl.useProgram(lineProgram);gl.bindBuffer(gl.ARRAY_BUFFER,rayBuffer);const loc=gl.getAttribLocation(lineProgram,'aPos');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram,'uVP'),false,vp);gl.uniform4fv(gl.getUniformLocation(lineProgram,'uColor'),color);gl.uniform1i(gl.getUniformLocation(lineProgram,'uPoint'),points?1:0);gl.uniform1f(gl.getUniformLocation(lineProgram,'uSize'),size);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices.flat()),gl.DYNAMIC_DRAW);gl.drawArrays(points?gl.POINTS:gl.LINES,0,vertices.length);}
function decoration(vp){if(!cloud||cloud.collapsed||cloud.hidden)return;const core=point(root,vadd([0,0,0],cloud.offset||[0,0,0]));const lines=[];
 for(const c of cards.filter(x=>x.kind==='object'&&x.visible&&x.animScale!==0)){const target=point(root,rootPos(c)),ctrl=vadd(vmul(vadd(core,target),.5),[0,.18,.05]),curve=[];for(let i=0;i<=12;i++){const t=i/12,u=1-t;curve.push(vadd(vadd(vmul(core,u*u),vmul(ctrl,2*t*u)),vmul(target,t*t)));}for(let i=1;i<curve.length;i++)lines.push(curve[i-1],curve[i]);}
 if(lines.length)line(vp,lines,[.45,.91,.61,.22]);
 if(busy){const ring=[],t=performance.now()*.003;for(let i=0;i<50;i++){const a=i*TAU/50+t;ring.push(point(root,vadd(cloud.offset||[0,0,0],[Math.cos(a)*.45,.07+Math.sin(a)*.35,.04])));}line(vp,ring,[.64,1,.69,.85],true,5);}
 }
function drawImageInference(vp,t){
 if(!busy||!inferenceCard||!inferenceCard.visible)return;
 const age=(t-inferenceStarted)/1000,phase=t*.004;
 const mat=cardModel(inferenceCard),points=[],rays=[];
 for(let i=0;i<64;i++){
  const a=i*TAU/64+phase,r=.64+.07*Math.sin(age*3+i*.4),w=Math.sin(a)*r,h=Math.cos(a)*r;
  const p=point(mat,[w,h,.045+.025*Math.sin(phase+i)]);points.push(p);
  if(i%5===0)rays.push(point(mat,[w*.78,h*.78,.04]),p);
 }
 line(vp,points,[.85,1,.71,.86],true,5+Math.sin(phase*3)*2);
 line(vp,rays,[.58,1,.76,.22]);
}
function highlightCards(vp,t){for(const c of cards){if(!c.visible||!(c.highlightUntil>t))continue;
 const m=cardModel(c),vertices=[[-.54,-.54,0],[.54,-.54,0],[.54,.54,0],[-.54,.54,0]].map(p=>point(m,p));line(vp,vertices,[.65,1,.75,.8],true,5);}}
function sparkles(vp,t){const ps=[];particles=particles.filter(p=>t-p.born<p.ttl);for(const p of particles){const u=clamp((t-p.born)/1000,0,2);ps.push(point(root,vadd(p.p,vmul(p.v,u))));}if(ps.length)line(vp,ps,[.75,1,.78,.66],true,4);}
function place(pose){root=viewerAnchor(pose,-.04,1.45);rootYaw=yawFromMatrix(pose.transform.matrix);poseReady=true;
 if(!toolbar){menuYaw=cameraYaw(pose);const h=pose.transform.matrix,world=point(h,[0,0,0]),off=point(rotateY(cameraYaw(pose)),followOffset,0);toolbar={id:'toolbar',kind:'toolbar',size:[.67,.135],pos:vadd(world,off),q:quatY(cameraYaw(pose)),scale:1,visible:true,front:toolbarTexture('main'),back:null,resources:[]};toolbar.back=toolbar.front;toolbar.resources=[toolbar.front];}
 if(!captureEye){eyeResource=eyeTexture();captureEye={id:'captureeye',kind:'captureeye',size:[.099,.099],pos:point(poseForwardAnchor(pose,1.02,-.18),[0,0,0]),q:quatY(cameraYaw(pose)),scale:1,visible:true,front:eyeResource.tex,back:eyeResource.tex,resources:[eyeResource.tex]};paintEye(performance.now());}
 if(!voiceButton)voiceButton=makeRoundel('voice-roundel','voiceroundel',.089);
 if(!extractButton)extractButton=makeRoundel('extract-roundel','extractroundel',.089);
 syncRoundels(pose);
 if(window.FreeLab?.getState?.()?.stream?.getVideoTracks?.().some(t=>t.readyState==='live'&&!t.muted))showLivePreview();
 // No persistent folder/bin/mix drop targets or third-level navigation.
 setStatus('Select the central eye to enable camera or capture · drag toolbar header',7000);}
function toggleFollow(){if(!toolbar)return;
 followMode=!followMode;
 if(followMode&&latestPose){const h=latestPose.transform.matrix,yaw=cameraYaw(latestPose);const delta=vsub(toolbar.pos,[h[12],h[13],h[14]]);followOffset=point(rotateY(-yaw),delta,0);}
 if(!followMode)menuYaw=Math.atan2(quatMatrix(toolbar.q)[8],quatMatrix(toolbar.q)[10]);
 refreshToolbar();cue('pin');setStatus(followMode?'FOLLOW · smooth tracking':'PINNED · fixed room position and orientation',5500);}

function ray(frame,src){try{const sp=src.targetRaySpace?frame.getPose(src.targetRaySpace,refSpace):null;if(sp){const m=sp.transform.matrix;return {o:[m[12],m[13],m[14]],d:norm([-m[8],-m[9],-m[10]])};}
 if(src.hand){const a=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace),b=frame.getJointPose(src.hand.get('wrist'),refSpace);if(a&&b){const o=[a.transform.position.x,a.transform.position.y,a.transform.position.z];const w=[b.transform.position.x,b.transform.position.y,b.transform.position.z];return {o,d:norm(vsub(o,w))};}}
 }catch{}return null;}
function hitTest(r,c){if(!r||!c.visible||!c.front||c.animScale===0)return null;const m=cardModel(c),inv=inverse(m);if(!inv)return null;const o=point(inv,r.o),d=point(inv,r.d,0);if(Math.abs(d[2])<1e-6)return null;const k=-o[2]/d[2];if(k<=0||k>6)return null;const x=o[0]+d[0]*k,y=o[1]+d[1]*k;if(Math.abs(x)>.5||Math.abs(y)>.5)return null;const hitWorld=point(m,[x,y,0]);const dist=length(vsub(hitWorld,r.o));return {card:c,x,y,dist};}
function pick(r){const opts=[...cards,toolbar,captureEye,voiceButton,extractButton,voiceOk,voiceCancel,promptPanel,editbar].filter(Boolean),all=opts.map(c=>hitTest(r,c)).filter(Boolean).sort((a,b)=>a.dist-b.dist);return all[0]||null;}
function imageButtonAt(card,x,y){
 // Hit regions are in the SAME 600-pixel canvas coordinates as cardTexture.
 // Image aspect ratios change canvas height; fixed normalized-Y thresholds do not work.
 if(!card||!['source','object'].includes(card.kind))return null;
 const px=(x+.5)*600,py=(.5-y)*(card.canvasHeight||420);
 if(py<21||py>93)return null; // generous 9px tolerance for Quest hand-point rays
 if(card.kind==='source'&&px>=27&&px<=225)return 'extract';
 if(px>=442&&px<=512)return 'imagemenu';
 if(px>=510&&px<=582)return 'imageclose';
 return null;
}
function buttonFromHit(h){if(!h)return null;if(h.card.kind==='captureeye')return 'capture';
 if(h.card.kind==='voiceroundel')return 'voice';
 if(h.card.kind==='extractroundel')return 'extract';
 if(h.card.kind==='voiceok')return 'confirmvoice';
 if(h.card.kind==='voicecancel')return 'cancelvoice';
 if(h.card.kind==='toolbar'&&h.y>.37)return null; // blank top strip can still be grabbed
 if(h.card.kind==='contextbar'){const list=meshConfirm?[['submit3d'],['cancel3d']]:imageTools();
  return list[clamp(Math.floor((.5-h.y)*list.length),0,list.length-1)][0];}
 if(h.card.kind==='toolbar'){const idx=clamp(Math.floor((h.x+.5)*tools.length),0,tools.length-1);return tools[idx][0];}
 return imageButtonAt(h.card,h.x,h.y);
}

function grabStart(frame,src,manual=false){const r=ray(frame,src),h=pick(r);if(!h)return;
 if(held){if(!held.second&&held.card===h.card&&held.card.kind==='object'&&held.src!==src){
  const a=posePosition(frame,held.src),b=posePosition(frame,src);
  if(a&&b)held.second={src,firstDist:length(vsub(a,b)),startScale:held.card.scale};}
  return;
 }
 const id=buttonFromHit(h);held={src,hit:h,rayDist:h.dist,start:performance.now(),last:r?.o,card:h.card,
 moved:false,manual,id,wasSelected:selected===h.card,initial:[...h.card.pos],lastHit:r?.o,
 startQuat:poseQuat(frame,src),initialQuat:[...(h.card.q||[0,0,0,1])],
 worldStart:!id&&['source','object'].includes(h.card.kind)?point(root,rootPos(h.card)):null,
 attach:!id&&['source','object'].includes(h.card.kind)?attachGrab(frame,src,h.card):null};
 if(['object','source'].includes(h.card.kind)){selected=h.card;updateEditbar();}cue('grab',src);}
async function grabEnd(src,frame){if(held?.second?.src===src){held.second=null;return;}if(!held||held.src!==src)return;const h=held;held=null;cue('release',src);
 // XR controllers rotate slightly between trigger-down and trigger-up. Once a
 // button was hit, release must ACTIVATE it and never be interpreted as a drag.
 if(h.id){window.FreeLab?.traceEvent?.('XR image action: '+h.id,'info');return action(h.id);}
 if(h.moved){
 if(h.card.kind==='source'&&cloud?.id){
     try{const [x,y,z]=(cloud.offset||[0,0,0]);const [qx,qy,qz,qw]=h.card.q||[0,0,0,1];await window.FreeLab.updateXRCloud(cloud.id,{spatial:{x,y,z,qx,qy,qz,qw}});}catch(e){setStatus('Source position not saved: '+e.message);}
   }
   if(h.card.kind==='object'&&h.card.data?.id){
   try{await window.FreeLab.updateXRObject(h.card.data.id,{spatial:spatialData(h.card)})}catch(e){setStatus('Position not saved: '+e.message);}
 }return;}
 if(h.card.kind==='object'){selected=h.card;imageMenuOpen=false;updateEditbar();setStatus(h.card.data.label+' · drag to move/rotate · ··· for actions',7500);}
 else if(h.card.kind==='source'){selected=h.card;imageMenuOpen=false;updateEditbar();setStatus('EXTRACT is the green top-left button · ··· for tools',8000);}
 else if(h.card.kind==='gallery'){await showCloud(h.card.data.id);}
 else if(h.card.kind==='bincloud'){try{await window.FreeLab.updateXRCloud(h.card.data.id,{hidden:false});await openBin();setStatus('Capture restored · open it from LIB');}catch(e){setStatus('Restore failed: '+e.message);}}
 else if(h.card.kind==='binitem'){try{await window.FreeLab.updateXRObject(h.card.data.id,{shelf:'collection'});await openBin();setStatus('Object restored from Bin');}catch(e){setStatus(e.message);}}
}
function spatialData(c){return {x:+c.pos[0].toFixed(3),y:+c.pos[1].toFixed(3),z:+c.pos[2].toFixed(3),scale:+c.scale.toFixed(3),rotation:+c.rot.toFixed(3),qx:+(c.q||[0,0,0,1])[0].toFixed(5),qy:+(c.q||[0,0,0,1])[1].toFixed(5),qz:+(c.q||[0,0,0,1])[2].toFixed(5),qw:+(c.q||[0,0,0,1])[3].toFixed(5)};}
function updateEditbar(){
 if(editbar?.front&&gl)gl.deleteTexture(editbar.front);
 editbar=null;
 if(imageMenuOpen&&selected&&['object','source'].includes(selected.kind)&&gl){const tex=toolbarTexture('context');
  const rows=meshConfirm?2:imageTools().length;
  editbar={id:'context-actions',kind:'contextbar',parentCard:selected,size:[.325,rows*.079],pos:[0,0,0],scale:1,q:[0,0,0,1],visible:true,front:tex,back:tex,resources:[tex]};}
 refreshToolbar();}
function closeImageMenu(){imageMenuOpen=false;meshConfirm=null;updateEditbar();}
function toggleImageMenu(card){if(selected===card&&imageMenuOpen){closeImageMenu();return;}
 selected=card;imageMenuOpen=true;meshConfirm=null;updateEditbar();cue('pin');}

function advanceGrab(frame){
 if(!held||held.id)return;const r=ray(frame,held.src);if(!r)return;
 const card=held.card;
 if(['source','object'].includes(card.kind)&&held.attach){
  const devicePos=posePosition(frame,held.src),deviceQuat=poseQuat(frame,held.src);
  if(!devicePos||!deviceQuat)return;
  const attached=held.attach;
  // Preserve exact initial hand/controller-to-card offset and orientation.
  // The ray intersection stays locked to the originally grabbed point.
  const worldCenter=vadd(devicePos,quatVec(deviceQuat,attached.localPoint));
  const invRoot=inverse(root);if(!invRoot)return;
  const localCenter=point(invRoot,worldCenter);
  const q=quatNorm(quatMul(quatY(-rootYaw),quatMul(deviceQuat,attached.localQuat)));
  if(card.kind==='source'&&cloud){cloud.offset=vsub(localCenter,card.pos);}
  else card.pos=vsub(localCenter,cloud?.offset||[0,0,0]);
  card.q=q;
  const transl=length(vsub(worldCenter,held.worldStart||worldCenter));
  if(!held.worldStart)held.worldStart=worldCenter;
  if(transl>.007||Math.abs(q[0]-held.initialQuat[0])+Math.abs(q[1]-held.initialQuat[1])+Math.abs(q[2]-held.initialQuat[2])>.015)held.moved=true;
  if(card.kind==='object'&&held.second){const a=posePosition(frame,held.src),b=posePosition(frame,held.second.src);
   if(a&&b&&held.second.firstDist>.04){card.scale=clamp(held.second.startScale*length(vsub(a,b))/held.second.firstDist,.45,3);held.moved=true;}}
  return;
 }
 if(card.kind==='toolbar'){
  const next=vadd(r.o,vmul(r.d,held.rayDist));if(!held.anchor){held.anchor=next;return;}
  const delta=vsub(next,held.anchor);
  if(length(delta)>.008||held.moved){held.moved=true;card.pos=vadd(card.pos,delta);
   if(followMode&&latestPose){const h=latestPose.transform.matrix,yaw=cameraYaw(latestPose);
    const d=vsub(card.pos,[h[12],h[13],h[14]]);followOffset=point(rotateY(-yaw),d,0);
    followOffset=[clamp(followOffset[0],-.9,.9),clamp(followOffset[1],-1,.05),clamp(followOffset[2],-1.9,-.5)];}}
  held.anchor=next;
 }
}
function pinchPoll(frame,src){if(!src.hand||typeof frame.getJointPose!=='function')return;try{const a=frame.getJointPose(src.hand.get('thumb-tip'),refSpace),b=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace);if(!a||!b)return;const p=a.transform.position,q=b.transform.position,dist=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),prev=handPinch.get(src)||false;
 if(!prev&&dist<.022&&(performance.now()-(lastNative.get(src)||0)>350)){handPinch.set(src,true);grabStart(frame,src,true);}
 else if(prev&&dist>.047){handPinch.set(src,false);if(held?.src===src)grabEnd(src,frame);}
 }catch{}}
function updateHover(frame){let found=null,source=null;for(const src of session.inputSources){const hit=pick(ray(frame,src));if(hit){found=buttonFromHit(hit)||hit.card.id;source=src;break;}}
 if(pointerHover===found)return;pointerHover=found;if(found){window.FreeLabSound?.hover();haptic(source,.17,25);}refreshToolbar();}

const handBones=[['wrist','thumb-metacarpal'],['thumb-metacarpal','thumb-phalanx-proximal'],['thumb-phalanx-proximal','thumb-phalanx-distal'],['thumb-phalanx-distal','thumb-tip'],
 ...['index','middle','ring','pinky'].flatMap(n=>[['wrist',n+'-finger-metacarpal'],[n+'-finger-metacarpal',n+'-finger-phalanx-proximal'],[n+'-finger-phalanx-proximal',n+'-finger-phalanx-intermediate'],[n+'-finger-phalanx-intermediate',n+'-finger-phalanx-distal'],[n+'-finger-phalanx-distal',n+'-finger-tip']])];
function drawHands(frame,vp){for(const src of session.inputSources){if(!src.hand||!frame.getJointPose)continue;const joints=new Map();
 for(const joint of src.hand.values()){try{const p=frame.getJointPose(joint,refSpace);if(p){const pos=p.transform.position;joints.set(joint.jointName,[pos.x,pos.y,pos.z]);}}catch{}}
 // Hand skeleton is real tracked XR joint data (not a video-derived mesh).
 const lines=[];for(const [a,b] of handBones)if(joints.has(a)&&joints.has(b))lines.push(joints.get(a),joints.get(b));
 if(lines.length)line(vp,lines,[.58,1,.70,.78]);if(joints.size)line(vp,[...joints.values()],[.78,1,.81,.95],true,8);
 }}
function pollGestures(frame,t){if(t-lastGesturePoll<120)return;lastGesturePoll=t;
 const recognizer=window.FreeLabGestures;if(!recognizer||!frame?.getJointPose)return;
 const hands={};for(const src of session.inputSources){if(!src.hand)continue;const j={};
 for(const joint of src.hand.values()){try{const pose=frame.getJointPose(joint,refSpace);if(pose){const q=pose.transform.position;j[joint.jointName]=[q.x,q.y,q.z];}}catch{}}
 if(src.handedness==='left'||src.handedness==='right')hands[src.handedness]=j;
 const gesture=recognizer.classify(j);const side=src.handedness||'hand';checkStableGesture(side,gesture,t);}
 if(recognizer.heart(hands.left,hands.right))checkStableGesture('both','Heart',t);
}
function checkStableGesture(side,gesture,t){const prev=gestureDebounce.get(side)||{value:null,started:t,said:0};
 if(gesture!==prev.value){gestureDebounce.set(side,{value:gesture,started:t,said:0});return;}
 if(!gesture||t-prev.started<850||prev.said)return;
 // Mark this pose handled, even if the global cooldown is still active.
 gestureDebounce.set(side,{...prev,said:t});
 const key=side+':'+gesture;
 if(t-lastGestureAnnouncement<6000||t-(gestureSpeechTimes.get(key)||-100000)<15000)return;
 lastGestureAnnouncement=t;gestureSpeechTimes.set(key,t);
 mascotEmotion(gesture==='Thumbs down'?'confused':'happy',2900);
 window.FreeLab?.traceEvent?.('XR gesture '+side+': '+gesture,'info');
 const funny={'Thumbs up':'Tiny scientist approves!','Thumbs down':'Oof. Tough review.','OK':'All okay, captain.','Heart':'Even a lab needs love.',
  'Forward':'Forward, explorer!','Point':'I see your point.','Fist':'Imaginary fist bump!','Open palm':'High five!'};
 mascotSay(gesture);
 // Audio speaks from the mascot's reaction, not from a giant flashing eye-level banner.
 if(window.FreeLab?.pref?.('spoken'))window.FreeLab.speakUpdate?.(window.FreeLab?.pref?.('troll')?(funny[gesture]||gesture):gesture);
}
function mascotSpeechTexture(message){const [c,ctx]=canvas2d(460,85);
 ctx.clearRect(0,0,460,85);
 // Small unobtrusive label at the mascot; not the eye-following microphone HUD.
 rrect(ctx,2,8,456,67,33,'rgba(32,49,39,.90)');
 text(ctx,String(message).slice(0,28),230,53,30,'#e2ffe8',620,'center');
 return texture(c);
}
function mascotSay(message,ms=2800){
 if(mascotSpeech?.front&&gl)gl.deleteTexture(mascotSpeech.front);
 mascotSpeech=null;mascotSpeechUntil=performance.now()+ms;
 if(mascotMode()==='none'||!gl)return;
 const tex=mascotSpeechTexture(message);
 mascotSpeech={id:'mascot-speech',kind:'pointer-mascot',size:[.245,.045],pos:[0,0,0],q:[0,0,0,1],scale:1,visible:true,front:tex,back:tex};
}
function tickMascotSpeech(t){
 if(!mascotSpeech)return;
 if(t>mascotSpeechUntil||!mascotPointer?.visible||mascotMode()==='none'){
  if(mascotSpeech.front)gl.deleteTexture(mascotSpeech.front);mascotSpeech=null;return;
 }
 const yaw=cameraYaw(latestPose);
 mascotSpeech.pos=vadd(mascotPointer.pos,point(rotateY(yaw),[0,.148,.009],0));
 mascotSpeech.q=quatY(yaw);
}
function depthCapability(frame,view){if(depthChecked)return;depthChecked=true;
 try{if(typeof XRWebGLBinding==='function'&&session?.enabledFeatures?.has?.('depth-sensing')){
  depthBinding=new XRWebGLBinding(session,gl);const info=depthBinding.getDepthInformation(view);
  depthState=info?'GPU depth available (occlusion not enabled)':'Depth feature enabled; waiting for texture';
 }else if(typeof frame.getDepthInformation==='function'&&session?.enabledFeatures?.has?.('depth-sensing')){
  const info=frame.getDepthInformation(view);depthState=info?'CPU depth available (occlusion not enabled)':'Depth feature enabled; waiting for data';
 }else depthState='No depth-sensing permission or API';
 }catch(e){depthState='Depth query unavailable: '+e.message;}
 window.FreeLab?.traceEvent?.('XR depth: '+depthState,'api');}
function updateView(t,frame){if(!session)return;
 try {renderView(t,frame);}catch(e){console.error('FREELAB XR rendering stopped:',e);window.FreeLab?.notify?.('XR renderer error: '+(e?.message||String(e)));session?.end().catch(()=>{});}
}
function updateMascot(frame,t){const mode=mascotMode();if(mode==='none'){if(mascotPointer)mascotPointer.visible=false;return;}
 if(!session)return;const dt=Math.min(.04,Math.max(0,(t-(lastMascotTick||t))/1000));lastMascotTick=t;
 let rayOne=null;for(const src of session.inputSources){rayOne=ray(frame,src);if(rayOne)break;}
 if(!mascotPointer){const tex=mode==='2d'?mascotTexture():null;
  mascotPointer={id:'pointer-mascot',kind:'pointer-mascot',size:[.125,.16],pos:[0,0,0],q:[0,0,0,1],scale:1,visible:true,front:tex,back:tex};}
 const h=rayOne?pick(rayOne):null;
 if(rayOne){const hit=vadd(rayOne.o,vmul(rayOne.d,Math.max(.20,(h?.dist||1.20)-.03)));
  // Stay at the side of the point instead of masking the target being selected.
  const offset=point(rotateY(cameraYaw(latestPose)),[.10,.075,0],0);const dest=vadd(hit,offset);
  mascotPointer.pos=blend(mascotPointer.pos,dest,1-Math.exp(-dt*9.5));
 }else{
  // Elastic idle bounce in a small virtual volume; not a claim of real-wall collision.
  const m=mascotPointer;const home=latestPose?point(poseForwardAnchor(latestPose,1.15,-.18),[0,0,0]):[0,1.1,-1.2];
  for(let i=0;i<3;i++){m.pos[i]+=mascotVelocity[i]*dt;const bound=i===1?.22:.50;
   if(m.pos[i]>home[i]+bound){m.pos[i]=home[i]+bound;mascotVelocity[i]=-Math.abs(mascotVelocity[i]);}
   if(m.pos[i]<home[i]-bound){m.pos[i]=home[i]-bound;mascotVelocity[i]=Math.abs(mascotVelocity[i]);}}
 }
 mascotPointer.q=quatY(cameraYaw(latestPose));mascotPointer.visible=true;
 if(t>mascotMoodUntil){mascotMood=(Math.floor(t/34000)%5===4)?'sleepy':'curious';}
}

function renderView(t,frame){const pose=frame.getViewerPose(refSpace);if(!pose){session.requestAnimationFrame(updateView);return;}latestPose=pose;if(!poseReady)place(pose);syncTrackedUI(pose,t);
 poll3d(t);advanceGrab(frame);for(const src of session.inputSources)pinchPoll(frame,src);pollGestures(frame,t);tween(t);updateMascot(frame,t);tickMascotSpeech(t);tickVoiceIndicator(t,pose);updateMicVisual(t);updateDebugCard(t);if(captureEye&&t-lastEyeUpdate>67){if(eyeState!=='idle'&&t>eyeUntil)eyeState='idle';paintEye(t);lastEyeUpdate=t;}updateLivePreview(t);if(t-lastUi>150){updateHover(frame);lastUi=t;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 for(const view of pose.views){const vp0=session.renderState.baseLayer.getViewport(view);gl.viewport(vp0.x,vp0.y,vp0.width,vp0.height);const vp=matmul(view.projectionMatrix,view.transform.inverse.matrix);
 decoration(vp);for(const c of cards)drawCard(c,vp);if(toolbar)drawCard(toolbar,vp);if(editbar)drawCard(editbar,vp);if(captureEye)drawCard(captureEye,vp);if(voiceButton)drawCard(voiceButton,vp);if(extractButton?.visible)drawCard(extractButton,vp);if(voiceOk)drawCard(voiceOk,vp);if(voiceCancel)drawCard(voiceCancel,vp);if(cameraPreview?.visible)drawCard(cameraPreview,vp);if(promptPanel)drawCard(promptPanel,vp);if(debugShowing&&debugPanel)drawCard(debugPanel,vp);if(voiceBadge)drawCard(voiceBadge,vp);sparkles(vp,t);drawImageInference(vp,t);highlightCards(vp,t);drawHands(frame,vp);depthCapability(frame,view);
 for(const src of session.inputSources){const r=ray(frame,src);if(!r)continue;const h=pick(r),end=vadd(r.o,vmul(r.d,h?.dist||1.2));const colour=src.hand?[.72,1,.75,.7]:[.77,.88,1,.72];line(vp,[r.o,end],colour);line(vp,[end],colour,true,h?16:9);}
 if(mascotPointer?.visible){if(mascotMode()==='2d'){if(!mascotPointer.front){mascotTex=mascotTexture();mascotPointer.front=mascotTex;mascotPointer.back=mascotTex;}drawCard(mascotPointer,vp);}else drawMascot3D(vp,t);}
 if(mascotSpeech)drawCard(mascotSpeech,vp);
 }session.requestAnimationFrame(updateView);}
function ringPosition(i,n){const a=(i/(Math.max(5,n)))*TAU-.32;const rings=n>6&&i>=6?1.15:1;const radiusX=.76*rings,radiusY=.48*rings;return [Math.cos(a)*radiusX,Math.sin(a)*radiusY+.03,-.10+Math.sin(i*2.4)*.18];}
function sourceCard(data){return addCard('source','source',{label:data.legacy?'LEGACY ARCHIVE':'CAPTURE  '+String(data.id).padStart(2,'0'),subtitle:data.legacy?'OLDER SAVED OBJECTS · NOT A ROOM FRAME':'SOURCE FRAME  ·  PRIVATE',image:data.image||data.image_url,description:'Captured real pixels, not the WebXR passthrough compositor'},[0,.07,0],[.88,.63]);}
async function showCloud(id){if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}closePrompt();const next=clouds.find(c=>c.id===id);if(!next){setStatus('Capture not found');return;}clearCards();mode='capture';cloud={...next,offset:['x','y','z'].map(k=>Number(next.spatial?.[k])||0)};
 if(next.hidden&&id>0){next.hidden=false;window.FreeLab.updateXRCloud(id,{hidden:false}).catch(()=>{});}
 const src=sourceCard(next);if(['qx','qy','qz','qw'].every(k=>typeof next.spatial?.[k]==='number'))src.q=quatNorm([next.spatial.qx,next.spatial.qy,next.spatial.qz,next.spatial.qw]);src.animScale=.08;animate(src,src.pos,0,660);
 const visible=next.objects.filter(o=>o.shelf!=='bin').slice(0,MAX_CLOUD);
 visible.forEach((o,i)=>{const target=spatialLoc(o,i,visible.length),card=addCard('item'+o.id,'object',{
   ...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:o.operation==='image_edit'?'AI VARIATION · PRIVATE':o.provider==='sam-3.1-box'?'REFINED REGION · PRIVATE':'EXTRACTED · PRIVATE'},[0,.05,-.08],[.3,.35]);card.pos=[0,.05,-.08];card.animScale=.06;card.original=target;card.scale=clamp(o.spatial?.scale||1,.45,3);card.rot=o.spatial?.rotation||0;card.q=['qx','qy','qz','qw'].every(k=>typeof o.spatial?.[k]==='number')?quatNorm([o.spatial.qx,o.spatial.qy,o.spatial.qz,o.spatial.qw]):quatY(card.rot);animate(card,target,i*55,1050);});
 if(next.collapsed&&id>0){next.collapsed=false;window.FreeLab.updateXRCloud(id,{collapsed:false}).catch(()=>{});}
 selected=null;updateEditbar();setStatus(`${next.objects.length} saved object(s)  •  pinch/trigger to move`,5000);
 // Reuse the saved JPEG for additional explicit Muse/SAM operations.
 if(id>0)await window.FreeLab.useXRFrame?.(next.image||next.image_url).catch(e=>setStatus(e.message));
}
function spatialLoc(o,i,n){const pos=ringPosition(i,n);if(o.spatial&&typeof o.spatial.x==='number')return [o.spatial.x,o.spatial.y,o.spatial.z];return pos;}
async function openGallery(){if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}mode='gallery';selected=null;updateEditbar();clearCards();cloud=null;
 try{clouds=await window.FreeLab.listXRClouds();}catch(e){setStatus(e.message);return;}
 const previews=clouds.filter(x=>!x.hidden).slice(0,MAX_CLOUD);for(let i=0;i<previews.length;i++){const c=previews[i],col=i%4,row=Math.floor(i/4);addCard('gallery'+c.id,'gallery',{id:c.id,image:c.image_url,label:'CAPTURE '+c.id,subtitle:c.objects.length+' OBJECT(S)'},[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);}
 setStatus(previews.length?`${previews.length} saved capture(s) · select one to open`:'No saved captures yet · press +');}
async function binSource(){if(!selected||selected.kind!=='source'||!cloud?.id)return setStatus('Choose a source capture first');
 const id=cloud.id;try{await window.FreeLab.updateXRCloud(id,{hidden:true});cue('paper');
  setStatus('Capture stored in hidden Bin · reopen from BIN to restore',10000);
  const entry=clouds.find(c=>c.id===id);if(entry)entry.hidden=true;
  const destination=[0,.07,.01];cards.forEach((c,i)=>animate(c,destination,i*30,650,true));
  setTimeout(()=>{if(cloud?.id===id){clearCards();cloud=null;selected=null;updateEditbar();}},950);
 }catch(e){setStatus('Could not bin capture: '+e.message);}}
async function openBin(){mode='bin';selected=null;updateEditbar();clearCards();cloud=null;
 try{clouds=await window.FreeLab.listXRClouds();}catch(e){setStatus(e.message);return;}
 const hidden=clouds.filter(x=>x.hidden).slice(0,5);const binned=clouds.flatMap(x=>x.objects).filter(x=>x.shelf==='bin').slice(0,MAX_CLOUD-hidden.length);
 const sources=[...hidden.map(c=>({kind:'bincloud',data:{id:c.id,image:c.image_url,label:'HIDDEN CAPTURE '+c.id,subtitle:'SELECT TO RESTORE'}})),
  ...binned.map(o=>({kind:'binitem',data:{...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:'BIN  ·  SELECT TO RESTORE'}}))];
 sources.forEach((entry,i)=>{const col=i%4,row=Math.floor(i/4);addCard(entry.kind+entry.data.id,entry.kind,entry.data,[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);});
 setStatus(sources.length?`${sources.length} item(s) in Bin · select to restore`:'Bin is empty');}
async function makeCapture(){if(busy)return;busy=true;
 try{
  const state=window.FreeLab.getState();const track=state.stream?.getVideoTracks()?.[0];
  const cameraLive=track?.readyState==='live'&&!track.muted;
  if(!cameraLive&&state.snapshotOrigin!=='upload'){
   setEyeState('activating',8000);setStatus('REQUESTING CAMERA · grant browser permission if shown',9000);
   try{const report=await window.FreeLab.enableXRCamera();showLivePreview();setEyeState('ready',1200);cue('ready');setStatus('CAMERA LIVE · check the small preview, then select the eye again to save',12000);}
   catch(e){setEyeState('error',1500);cue('error');setStatus('CAMERA ACCESS FAILED · '+(e.message||e.name)+' · try upload outside XR',14000);}
   return;
  }
  setEyeState('snapping',2200);setStatus('CAPTURING · original image preserved',11000);
  let pending=null;
  const item=await window.FreeLab.saveXRFrame(image=>{
   if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}
   clearCards();cloud=null;mode='capture';pending=addCard('source','source',{
   image,label:'CAPTURE · SAVING',subtitle:'SAVING PRIVATE FRAME · NO MODEL BILLING'},[0,.07,0],[.88,.63]);
   pending.animScale=.05;animate(pending,pending.pos,0,850);
  });
  const data={...item,objects:[],hidden:false,collapsed:false,offset:[0,0,0]};clouds.unshift(data);
  cloud={...data,offset:[0,0,0]};
  if(pending){const newLabel='CAPTURE '+String(data.id).padStart(2,'0');
    pending.data={...pending.data,label:newLabel,subtitle:'SOURCE FRAME · PRIVATE'};
    const newer=cardTexture(data.image||data.image_url,newLabel,'SOURCE FRAME · PRIVATE',false,(w,h)=>{pending.size=cardDimensions(w,h,'source');});
    const old=pending.front;pending.front=newer.tex;pending.resources[0]=newer.tex;if(old)gl.deleteTexture(old);
  }
  if(cameraPreview)cameraPreview.visible=false;selected=null;updateEditbar();setEyeState('ready',1500);cue('ready');
  setStatus('CAPTURE '+data.id+' READY · select image EXTRACT to reveal objects',10000);
 }catch(e){setEyeState('error',1200);cue('error');setStatus('CAPTURE FAILED · '+e.message,13000);}finally{busy=false;}}

function bloomChildren(items,parent=null){if(!cloud||!items?.length)return;
 const original=parent||cards.find(c=>c.kind==='source');const origin=original?[...original.pos]:[0,0,0];
 const existing=cards.filter(c=>c.kind==='object').length;
 items.slice(0,Math.max(0,MAX_CLOUD-existing)).forEach((o,i)=>{
  const target=parent?vadd(origin,[(i%3+1)*.38,.32-(i%5)*.18,-.17-i*.04]):spatialLoc(o,existing+i,existing+items.length);
  const card=addCard('item'+o.id,'object',{...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,
    subtitle:o.operation==='image_edit'?'AI VARIATION · PRIVATE':'EXTRACTED OBJECT · PRIVATE'},origin,[.3,.35]);
  card.animScale=.04;card.original=target;animate(card,target,i*110,900);launchParticles(origin);
 });
}
async function runExtract(){if(!cloud||cloud.legacy)return setStatus('Capture a real photo first, then Extract');if(busy)return setStatus('AI is working · wait for the current request');
 if(performance.now()<nextPaidAt)return setStatus('Wait before another AI request');busy=true;inferenceCard=cards.find(c=>c.kind==='source');inferenceStarted=performance.now();
 setStatus('EXTRACTING · source stays in place · 1 paid analysis',14000);
 try{const result=await window.FreeLab.recognizeXR(cloud.id);nextPaidAt=performance.now()+20000;
  const found=result.items||[];if(!found.length)window.FreeLab?.traceEvent?.('Extract response contained no recognized object items','warn');cloud.objects=[...cloud.objects,...found];
  const persisted=clouds.find(x=>x.id===cloud.id);if(persisted)persisted.objects=cloud.objects;
  bloomChildren(found);cue('bloom');mascotMood=found.length?'happy':'confused';mascotMoodUntil=performance.now()+3200;
  let quote=found.length?`Found ${found.length} objects`:'No objects found';
  if(found.length&&window.FreeLab?.pref?.('troll')){const jokes=['Your room has been officially inspected by a very small expert.','That is a surprisingly respectable collection of stuff.','Found objects! None of them offered me a snack.'];quote+=' . '+jokes[Math.floor(Math.random()*jokes.length)];}
  window.FreeLab?.speakUpdate?.(quote);setStatus(found.length?`${found.length} objects bloomed from your photo`:'No clear objects found · check LOG for API details',8500);
 }catch(e){setStatus('Extract failed · '+e.message,12000);}finally{busy=false;inferenceCard=null;}}
async function runSam(){if(!cloud||busy||cloud.legacy)return setStatus('Capture and Extract a real photo first');
 const item=selected?.data;if(!item||selected.kind!=='object')return setStatus('Select an extracted object before refining its region');
 if(performance.now()<nextPaidAt)return setStatus('Wait before another AI request');
 const noun=String(item.label||'').trim().toLowerCase().replace(/[^a-z0-9 -]/g,'').slice(0,58);
 if(noun.length<2)return setStatus('Select a concrete object');
 busy=true;setStatus('REFINING REGION · one billed segmentation',15000);
 try{const result=await window.FreeLab.segmentXR(cloud.id,noun);nextPaidAt=performance.now()+20000;
   const items=result.items||[];cloud.objects.push(...items);
   const persisted=clouds.find(x=>x.id===cloud.id);if(persisted)persisted.objects=cloud.objects;
   bloomChildren(items,selected);setStatus(`${items.length} extra image region(s) saved · bounding crops`,9500);
 }catch(e){setStatus('Refine failed · '+e.message,12000);}finally{busy=false;}}
function updatePromptTexture(){if(!promptPanel)return;gl.deleteTexture(promptPanel.front);promptPanel.front=toolbarTexture('prompt');promptPanel.back=promptPanel.front;}
function currentPromptTarget(){const card=selected?.kind==='object'||selected?.kind==='source'?selected:cards.find(c=>c.kind==='source');
 if(!card||!cloud?.id||cloud.legacy)return null;
 const first=mixBucket.length===2?mixBucket[0]:null;return {card,captureId:first?.captureId||cloud.id,objectId:first?.source?.object_id||(card.kind==='object'?card.data.id:null),label:card.data?.label||'Capture'};}
function mixSource(card){if(card?.kind==='source'&&cloud?.id)return {capture_id:cloud.id};if(card?.kind==='object'&&card.data?.id)return {object_id:card.data.id};return null;}
function mixAdd(){const src=mixSource(selected);if(!src)return setStatus('Select a photo card before adding it to MIX');
 const key=JSON.stringify(src);if(mixBucket.some(item=>JSON.stringify(item.source)===key))return setStatus('This image is already in Mix');
 if(mixBucket.length===2)mixBucket=[];
 mixBucket.push({source:src,label:selected.data.label,card:selected,captureId:cloud.id});cue('bloom');launchParticles(rootPos(selected));
 if(mixBucket.length===2){const p=mixBucket[0].card;selected=p;openPrompt('Combine these two reference images into one coherent photograph, keeping recognizable subjects from both.');setStatus('MIX · 2 images ready · speak or type, then APPLY (one paid image edit)',18000);}
 else setStatus('MIX · 1 / 2 images · select another photo and press MIX or drag to the mixing bucket',12000);
}
function openPrompt(prefill=''){const target=currentPromptTarget();if(!target)return setStatus('Capture or select a photo first');
 promptContext=target;promptText=prefill;
 closeImageMenu();
 setStatus('PROMPT · Quest keyboard opens in XR · Enter sends the instruction',12000);
 keyboardPrompt();}

function closePrompt(){if(promptPanel?.front)gl.deleteTexture(promptPanel.front);promptPanel=null;
 xrKeyboard?.blur();document.getElementById('xrPromptEditor')?.classList.add('hidden');
 document.getElementById('xrPromptEditor')?.classList.remove('xr-native-open');
 promptContext=null;promptText='';}
function findLabel(phrase){const clean=phrase.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const m=clean.match(/^(?:where (?:is|are) (?:my |the |a )?|find (?:my |the |a )?|show (?:me )?(?:my |the )?|locate (?:my |the )?|highlight (?:my |the )?)(.+?)(?: please)?$/);
 return m?.[1]?.trim()||null;}
async function respondFind(name){const word=name.toLowerCase();const visible=cards.filter(c=>c.visible&&['object','source'].includes(c.kind));
 let matches=visible.filter(c=>{const searchable=(c.data?.label||'')+' '+(c.data?.description||'');return searchable.toLowerCase().includes(word)||word.split(' ').some(w=>w.length>3&&searchable.toLowerCase().includes(w));});
 if(!matches.length){const location=clouds.find(c=>c.objects?.some(o=>o.shelf!=='bin'&&((o.label||'')+' '+(o.description||'')).toLowerCase().includes(word)));
  if(location){await showCloud(location.id);matches=cards.filter(c=>c.kind==='object'&&c.data?.shelf!=='bin'&&((c.data?.label||'')+' '+(c.data?.description||'')).toLowerCase().includes(word));}}
 for(const c of matches){launchParticles(rootPos(c));c.highlightUntil=performance.now()+4500;}
 if(matches.length){selected=matches[0];updateEditbar();}
 const msg=matches.length?`Found ${matches.length} ${name} match${matches.length===1?'':'es'} · sparkling cards are highlighted`:`No matching ${name} in the visible collection. Try EXTRACT.`;
 setStatus(msg,11000);window.FreeLab?.speakUpdate?.(matches.length?`Found ${matches.length} matching images`:`I did not find ${name}`);
 if(matches.length&&window.FreeLab?.pref?.('troll'))window.FreeLab?.speakUpdate?.('There it is. Excellent hiding skills, very suspicious.');
}
function dismissVoice(){
 voicePending=null;for(const c of [voiceOk,voiceCancel])if(c?.front&&gl)gl.deleteTexture(c.front);voiceOk=null;voiceCancel=null;setVoicePhase('idle','',0);
}
async function confirmVoice(){
 if(!voicePending||busy)return;
 const transcript=voicePending.text;const context=voicePending.context;
 dismissVoice();cue('ready');
 const finding=findLabel(transcript);if(finding)return respondFind(finding);
 const direct=transcript.toLowerCase().trim();
 if(/^(extract|segment|recognize)( the (image|picture|objects?))?[.!]?$/.test(direct))return runExtract();
 if(/^(take (a )?(photo|picture|snapshot)|capture)( now)?[.!]?$/.test(direct))return makeCapture();
 if(!context){setStatus('HEARD · '+transcript+' · select an image to use this instruction',13000);return;}
 promptContext=context;promptText=transcript;
 // The user accepted with OK: submit without opening a keyboard or second menu.
 return applyPrompt();
}
async function voicePrompt(){
 if(busy||voicePhase==='listening'||voicePhase==='processing')return;
 dismissVoice();
 if(!window.FreeLab?.micReady?.()){
  try{await window.FreeLab.armMicrophone();}catch(e){setStatus('MICROPHONE PERMISSION · '+e.message+' · XR stays open',12000);return;}
 }
 const target=currentPromptTarget();
 busy=true;setVoicePhase('listening','',18000);cue('ready');
 try{
  const wav=await window.FreeLab.recordWavPrompt(12000);
  setVoicePhase('processing','·  ·  ·',25000);
  const text=String(await window.FreeLab.transcribeXR(wav)||'').trim();if(!text)throw Error('No recognizable speech');
  voicePending={text,context:target};setVoicePhase('heard',text,Infinity);mascotEmotion('happy');
  voiceOk=makeRoundel('voice-accept','voiceok',.080);refreshRoundel(voiceOk,'ok');
  voiceCancel=makeRoundel('voice-reject','voicecancel',.080);refreshRoundel(voiceCancel,'cancel');
  if(latestPose)syncRoundels(latestPose);
  setStatus('Voice ready · choose OK to act or × to record again',12000);
 }catch(e){setVoicePhase('error','Could not recognize speech: '+e.message,14000);setStatus('VOICE FAILED · '+e.message,14000);}
 finally{busy=false;}
}
async function applyPrompt(){if(!promptContext)return openPrompt();if(busy)return;
 if(!promptText.trim())return setStatus('Speak or Type your instruction before Apply');
 const context=promptContext;busy=true;inferenceCard=context.card;inferenceStarted=performance.now();setStatus('GENERATING · original image stays in the room',24000);
 try{const o=await window.FreeLab.promptXR(context.captureId,context.objectId,promptText);
  if(cloud&&cloud.id===context.captureId){cloud.objects.push(o);bloomChildren([o],context.card);cue('bloom');}else{const destination=clouds.find(c=>c.id===context.captureId);if(destination)destination.objects.push(o);setStatus('Created image saved · open its source capture in LIB',9000);}
  setStatus('New AI image saved as a child · one image charged',10000);mixBucket=[];closePrompt();
 }catch(e){setStatus('Image edit failed · '+e.message,13000);}finally{busy=false;inferenceCard=null;}}
async function keyboardPrompt(){if(!promptContext)return openPrompt();
 // Meta Quest Browser 26.1+: focusing an actual DOM input opens the OS keyboard inside WebXR.
 // Never end the XR session; if unsupported, keep the scene and offer voice instead.
 if(!session?.isSystemKeyboardSupported){setStatus('XR native keyboard support not reported · trying standard input focus without leaving XR',10000);}
 if(!xrKeyboard){xrKeyboard=document.createElement('input');xrKeyboard.type='text';xrKeyboard.id='freelab-xr-native-input';
  xrKeyboard.autocomplete='off';xrKeyboard.maxLength=750;xrKeyboard.setAttribute('aria-label','XR image editing prompt');
  Object.assign(xrKeyboard.style,{position:'fixed',top:'12px',left:'12px',width:'min(60vw,420px)',height:'46px',opacity:'1',background:'#33423b',color:'#ffffff',border:'0',borderRadius:'23px',fontSize:'17px',padding:'0 16px',zIndex:'25'});
  (document.getElementById('xrPromptEditor')||document.body).appendChild(xrKeyboard);
  xrKeyboard.oninput=()=>{promptText=xrKeyboard.value.slice(0,750);setStatus('TEXT: '+promptText.slice(0,72)+' · press Enter to send',25000);};
  xrKeyboard.onkeydown=evt=>{if(evt.key==='Enter'&&!evt.isComposing){evt.preventDefault();promptText=xrKeyboard.value.trim();xrKeyboard.blur();applyPrompt();}};
  xrKeyboard.onblur=()=>{if(promptContext)setStatus('Keyboard closed · reopen PROMPT to submit with Enter',9000);};
 }
 const editor=document.getElementById('xrPromptEditor');editor?.classList.remove('hidden');editor?.classList.add('xr-native-open');
 xrKeyboard.value=promptText||'';xrKeyboard.focus();setStatus('QUEST KEYBOARD · Enter sends the image instruction',24000);
}
async function changeObject(op){if(!selected?.data?.id)return setStatus('Select an object card first');const c=selected,id=c.data.id;
 try{
 if(op==='folder'){const options=['Unsorted','Keep','Room','Objects'];const next=options[(options.indexOf(c.data.folder)+1)%options.length];await window.FreeLab.updateXRObject(id,{folder:next});c.data.folder=next;const fresh=cardTexture(null,c.data.label,`FOLDER: ${next}. ${c.data.description||''}`,true);gl.deleteTexture(c.back);c.back=fresh.tex;c.resources[1]=fresh.tex;setStatus('Moved to folder · '+next);}
 if(op==='bin'){await window.FreeLab.updateXRObject(id,{shelf:'bin'});cue('paper');c.data.shelf='bin';animate(c,[0,-.1,-.2],0,680,true);launchParticles(c.pos);selected=null;updateEditbar();setStatus('Object moved to virtual Bin · use Gallery to restore');}
 if(op==='restore'){await window.FreeLab.updateXRObject(id,{shelf:'collection'});c.data.shelf='collection';setStatus('Object restored to collection');}
 
 }catch(e){setStatus('Save failed · '+e.message);}}
async function collapse(){if(!cloud)return openGallery();if(cloud.collapsed){await showCloud(cloud.id);return;}
 cloud.collapsed=true;const dest=vadd([0,.07,.01],cloud.offset||[0,0,0]);cards.forEach((c,i)=>{animate(c,dest,i*35,950,true);});launchParticles(dest);
 if(cloud.id>0)window.FreeLab.updateXRCloud(cloud.id,{collapsed:true}).catch(e=>setStatus(e.message));setStatus('Cloud collapsing · tap ▣ for saved captures',4500);
 setTimeout(()=>{if(cloud?.collapsed){clearCards();cloud=null;selected=null;updateEditbar();}},1350);}
async function submit3d(){if(!meshConfirm||busy)return;const target=meshConfirm;
 closeImageMenu();busy=true;setStatus('3D job starting · Meshy charges credits only after confirmation',11000);
 try{const job=await window.FreeLab.createXR3D(target.captureId,target.objectId);meshyJob=job.id;meshyPollAt=0;
  setStatus('3D generation queued · Meshy · job '+String(job.id).slice(0,8)+' · use LOG for status',14000);
 }catch(e){setStatus('3D generation failed · '+e.message,16000);}finally{busy=false;}}
function close3d(){meshConfirm=null;updateEditbar();}
function open3d(){if(!selected||!['source','object'].includes(selected.kind)||!cloud?.id)return setStatus('Select an image to generate a 3D model');
 closePrompt();meshConfirm={captureId:cloud.id,objectId:selected.kind==='object'?selected.data.id:null,label:selected.data.label};
 imageMenuOpen=true;updateEditbar();setStatus('PAID 3D JOB · select CONFIRM 3D to queue, or CANCEL. Navigation stays active.',16000);}

async function poll3d(t){if(!meshyJob||t-meshyPollAt<14000)return;meshyPollAt=t;
 try{const job=await window.FreeLab.checkXR3D(meshyJob);if(job.status==='SUCCEEDED'){setStatus('3D MODEL READY · GLB available in the Collection / 3D Models panel',17000);cue('bloom');meshyJob=null;}
 else if(['FAILED','CANCELED'].includes(job.status)){setStatus('3D job '+job.status+' · '+(job.error||'review provider account'),14000);meshyJob=null;}
 else if(debugShowing)setStatus('3D generation '+job.progress+'% · '+job.status,5500);
 }catch(e){setStatus('3D polling issue · '+e.message,12000);}}
function closeSelectedCard(){if(!selected)return;const c=selected;closeImageMenu();if(c.kind==='source')return collapse();
 animate(c,c.pos,0,320,true);selected=null;setStatus('Card hidden in XR · still saved privately');}
async function restoreSelected(){const target=currentPromptTarget();if(!target)return setStatus('Select an image first');
 promptContext=target;promptText='Restore this image with more detail and a higher resolution. Preserve the original subject, composition and identity; do not invent new objects.';
 closeImageMenu();setStatus('RESTORE · sending one paid image edit · original remains in the room',14000);
 return applyPrompt();}
async function action(id){const t=performance.now();if(t-lastAction<200)return;lastAction=t;
 if(busy&&['capture','extract','voice','refine','prompt','3d','submit3d','apply'].includes(id))return;
 switch(id){case 'capture':return makeCapture();case 'extract':return runExtract();
 case '3d':return open3d();case 'submit3d':return submit3d();case 'cancel3d':return close3d();
 case 'voice':return voicePrompt();case 'confirmvoice':return confirmVoice();case 'cancelvoice':dismissVoice();return setStatus('Voice cancelled · tap microphone to record again',7000);case 'closemenu':return closeImageMenu();
 case 'imagemenu':return toggleImageMenu(selected);case 'imageclose':return selected?.kind==='source'?collapse():closeSelectedCard();
 case 'debug':debugShowing=!debugShowing;if(debugShowing){serverPoll=0;loadServerDiagnostic();}return setStatus(debugShowing?'LOG OPEN · API errors and server request status':'LOG CLOSED',6500);
 case 'prompt':return openPrompt();case 'refine':return restoreSelected();case 'apply':return applyPrompt();
 case 'follow':return toggleFollow();case 'gallery':return openGallery();
 case 'exit':return session?.end();}}

async function start(){if(session)return;if(!navigator.xr||!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('Use Meta Quest Browser with immersive-ar support');
 setup();await gl.makeXRCompatible();session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking','plane-detection','anchors','dom-overlay','depth-sensing'],depthSensing:{usagePreference:['gpu-optimized','cpu-optimized'],dataFormatPreference:['luminance-alpha','float32']},domOverlay:{root:document.getElementById('xrPromptEditor')}});xrDomOverlay=Boolean(session.domOverlayState);session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:false})});
 try{refSpace=await session.requestReferenceSpace('local-floor');}catch{refSpace=await session.requestReferenceSpace('local');}poseReady=false;depthChecked=false;depthState='not requested';
 session.addEventListener('selectstart',e=>{lastNative.set(e.inputSource,performance.now());grabStart(e.frame,e.inputSource);});
 session.addEventListener('selectend',e=>{lastNative.set(e.inputSource,performance.now());grabEnd(e.inputSource,e.frame);});
 session.addEventListener('squeezestart',e=>{lastNative.set(e.inputSource,performance.now());grabStart(e.frame,e.inputSource);});
 session.addEventListener('squeezeend',e=>{lastNative.set(e.inputSource,performance.now());grabEnd(e.inputSource,e.frame);});
 session.addEventListener('end',()=>{cue('release');session=null;poseReady=false;held=null;clearCards();if(voiceBadge?.front)gl.deleteTexture(voiceBadge.front);voiceBadge=null;dismissVoice();gestureDebounce.clear();gestureSpeechTimes.clear();lastGestureAnnouncement=-100000;if(mascotSpeech?.front)gl.deleteTexture(mascotSpeech.front);mascotSpeech=null;cloud=null;for(const z of zones)gl.deleteTexture(z.front);zones=[];if(toolbar?.front)gl.deleteTexture(toolbar.front);if(editbar?.front)gl.deleteTexture(editbar.front);if(statusCard?.front)gl.deleteTexture(statusCard.front);if(captureEye?.front)gl.deleteTexture(captureEye.front);if(voiceButton?.front)gl.deleteTexture(voiceButton.front);if(extractButton?.front)gl.deleteTexture(extractButton.front);voiceButton=null;extractButton=null;inferenceCard=null;if(cameraPreview?.front)gl.deleteTexture(cameraPreview.front);cameraPreview=null;previewResource=null;captureEye=null;eyeResource=null;toolbar=null;statusCard=null;editbar=null;if(promptPanel?.front)gl.deleteTexture(promptPanel.front);promptPanel=null;document.getElementById('xrPromptEditor')?.classList.add('hidden');document.getElementById('xrPromptEditor')?.classList.remove('xr-native-open');if(debugPanel?.front)gl.deleteTexture(debugPanel.front);debugPanel=null;debugShowing=false;if(mascotPointer?.front)gl.deleteTexture(mascotPointer.front);mascotPointer=null;mixBucket=[];xrKeyboard?.remove();xrKeyboard=null;window.FreeLab?.notify?.('Exited spatial collection');});
 const saved=await window.FreeLab.listXRClouds().catch(()=>[]);clouds=saved;setStatus('CAPTURE → EXTRACT → PROMPT · camera pixels required',8500);session.requestAnimationFrame(updateView);
}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
