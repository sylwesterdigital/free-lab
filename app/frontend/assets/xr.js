/* FREELAB 0.10.10 — spatial media workbench, draggable diagnostics, voice meter, bounded 3D previews.
   Minimal WebGL WebXR renderer: real camera input only, no fake passthrough pixels.
   World-positioned photos, yaw-upright follow toolbar, image derivatives, spatial grab.
   Flat grey floating controls, double-sided, draggable spatial cards.
*/
(()=>{'use strict';
let gl,canvas,program,lineProgram,quad,rayBuffer,refSpace,session,root,poseReady=false,floorReference=false;
let pending3dJobs=[],galleryPage=0,darkroom=null,darkBackdrop=null,darkClose=null,darkFloor=null,descriptionContext=null,descriptionQuestionMode=false,frameTouch=null,frameErase=null,lastMascotQuip=0,statusBorn=0,jobProvider='auto';
let meshUniforms=null;
let configPanel=null,configShowing=false,uiSettings=window.FreeLabXRUI?.read?.()||{},lastConfigTick=0,mascotTrailAt=0;
let toolbar=null,editbar=null,statusCard=null,cloud=null,clouds=[],cards=[],zones=[],selected=null,held=null;
let branchFocusId=null,branchPage=0; // Parent-based tree browsing, no fixed generation/depth limit.
let imageMenuOpen=false,voiceBadge=null,voicePhase='idle',voiceMessage='',voiceUntil=0,voicePending=null,voiceOk=null,voiceCancel=null,voiceResultStamp=0;
let mascotProgram=null,mascotBuffer=null,mascotVertexCount=0,mascotMood='curious',mascotMoodUntil=0,mascotVelocity=[.25,.22,.19],lastMascotTick=0,mascotSpeechBorn=0;
let gestureDebounce=new Map(),lastGesturePoll=0,gestureDisplay='',lastGestureAnnouncement=-100000;
let mascotSpeech=null,mascotSpeechUntil=0,gestureSpeechTimes=new Map(),mascotReaction='',mascotReactionUntil=0,mascotReactionTarget=null,mascotRayPokeAt=0,handGesturePositions={};
let pointerHover=null,lastFrame=0,lastUi=0,lastAction=0,latestPose=null,nextPaidAt=0,busy=false,mode='capture',statusText='Capture your space',statusUntil=0;
let followMode=true,followBase=null,eyeBase=null,captureEye=null,voiceButton=null,extractButton=null,extractVisualActive=null,eyeResource=null,eyeState='idle',eyeUntil=0,rootYaw=0,menuYaw=0,promptPanel=null,promptContext=null,promptText='',xrDomOverlay=false;
let cameraHint=null,cameraHintState='',lastHintCheck=0;
let debugPanel=null,debugShowing=false,debugLast=0,serverPoll=0,serverDiagnostic=[],descriptionPanel=null,meshPreviews=[],meshPreviewLoading=false,mascotPointer=null,mascotTex=null,lastAvatar=0,mixBucket=[],xrKeyboard=null;
let followOffset=[0,-.53,-1.16],followWorld=null,eyeWorld=null,depthState='unknown',depthChecked=false,depthFeature=false,depthBinding=null,meshyJob=null,meshyPollAt=0,meshConfirm=null;
let voiceRecord=null,voiceRecordStarted=0,voiceMeterLast=0,cameraHintUntil=0,meshJobOrigin=null;
let particles=[],handPinch=new WeakMap(),lastNative=new WeakMap(),clickState=new WeakMap(),lastEyeUpdate=0,lastMicUpdate=0,inferenceCard=null,inferenceStarted=0;
const PW=600,PH=420,MAX_CLOUD=10,TAU=2*Math.PI;
// One navigation pill. Image-specific actions belong only to the selected card.
const tools=[['gallery','▣'],['follow','◎'],['debug','≡'],['config','⚙'],['exit','×']];
// A context menu only exists after clicking the image's ···, never in parallel by default.
const sourceTools=[['describe','☷'],['segment','✳'],['refine','✦'],['prompt','✎'],['voice','♫'],['3d','⬡'],['closemenu','×']];
const objectTools=[['describe','☷'],['segment','✳'],['refine','✦'],['prompt','✎'],['voice','♫'],['3d','⬡'],['closemenu','×']];
function currentTools(){return tools;}
function imageTools(){
 const base=(selected?.kind==='source'?sourceTools:objectTools).filter(([id])=>id!=='voice'||uiSettings.voice!==false);
 if(!cloud||!selected)return base;
 const extras=[];
 if(selected.kind==='object')extras.push(['branch','↗']);
 if(branchFocusId!==null)extras.push(['parent','↶']);
 return [...base.slice(0,-1),...extras,base[base.length-1]];
}
function cue(name,src){window.FreeLabSound?.play(name);if(src)haptic(src,name==='hover'?.16:.35,name==='hover'?23:55);}
function haptic(src,strength=.25,ms=35){try{const gamepad=src?.gamepad;const a=gamepad?.hapticActuators?.[0];if(a?.pulse){a.pulse(strength,ms).catch?.(()=>{});}else gamepad?.vibrationActuator?.playEffect?.('dual-rumble',{duration:ms,strongMagnitude:strength,weakMagnitude:strength*.7})?.catch?.(()=>{});}catch{}}

const promptTools=[['voice','◎'],['apply','↗'],['cancel','×']];
const threeDTools=[['submit3d','⬡'],['cancel3d','×']];
const V=`attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uMVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPos,1.);}`;
const F=`precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform bool uFlip;uniform float uOpacity;void main(){vec2 uv=vec2(uFlip?1.-vUV.x:vUV.x,vUV.y);vec4 color=texture2D(uTex,uv);if(color.a<.012)discard;gl_FragColor=color*uOpacity;}`;
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
function quatX(angle){return [Math.sin(angle/2),0,0,Math.cos(angle/2)];}
function quatZ(angle){return [0,0,Math.sin(angle/2),Math.cos(angle/2)];}
function quatFromTo(from,to){
 const a=norm(from),b=norm(to),dot=clamp(a.reduce((v,n,i)=>v+n*b[i],0),-1,1);
 if(dot>.9999)return [0,0,0,1];
 if(dot<-.9999)return [1,0,0,0];
 const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 return quatNorm([cross[0],cross[1],cross[2],1+dot]);
}
// Normal points precisely from the card toward the viewer: above-eye cards pitch down,
// below-eye cards pitch up. A short easing step avoids abrupt rotations.
function lookingQuat(pos,viewer){const d=vsub(viewer,pos),yaw=Math.atan2(d[0],d[2]),pitch=-Math.atan2(d[1],Math.hypot(d[0],d[2]));return quatNorm(quatMul(quatY(yaw),quatX(pitch)));}
function quatSlerp(a,b,t){let A=quatNorm(a),B=quatNorm(b);if(A.reduce((n,x,i)=>n+x*B[i],0)<0)B=B.map(x=>-x);return quatNorm(blend(A,B,t));}

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
function attachGrab(frame,src,card,hit){
 const r=ray(frame,src);if(!r||!hit)return null;
 const worldCenter=point(root,rootPos(card));
 const hitPoint=vadd(r.o,vmul(r.d,hit.dist));
 return {worldOffset:vsub(worldCenter,hitPoint),startDistance:hit.dist};
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
function setup(){canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;gl=canvas.getContext('webgl',{alpha:true,antialias:false,xrCompatible:true});if(!gl)throw Error('WebGL is unavailable');program=shader(V,F);lineProgram=shader(LV,LF);mascotProgram=shader(MV,MF);strandProgram=shader(STRAND_V,STRAND_F);strandBuffer=gl.createBuffer();initializeMascotSphere();
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
function mascotMode(){return uiSettings.mascot===false?'none':window.FreeLab?.pref?.('mascotMode')||'3d';}
function mascotEmotion(type,ms=3300){mascotMood=type;mascotMoodUntil=performance.now()+ms;}
function drawMascot3D(vp,t){if(!mascotPointer?.visible||mascotMode()!=='3d'||!mascotProgram)return;
 const m=mascotPointer,now=t/1000,bounce=Math.sin(now*3)*.007,smile=mascotMood==='happy',impact=clamp((mascotHitUntil-t)/1000,0,1);
 const blink=mascotMood==='sleepy'? .18: Math.pow(Math.max(0,Math.sin(now*.43)),44)*.86;
 const base=matmul(translate(m.pos[0],m.pos[1]+bounce,m.pos[2]),matmul(quatMatrix(m.flightQ||quatY(cameraYaw(latestPose))),scale(.53,.53,.53)));
 gl.useProgram(mascotProgram);gl.bindBuffer(gl.ARRAY_BUFFER,mascotBuffer);
 const loc=gl.getAttribLocation(mascotProgram,'aPos'),norm=gl.getAttribLocation(mascotProgram,'aNormal');
 gl.enableVertexAttribArray(loc);gl.enableVertexAttribArray(norm);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(norm,3,gl.FLOAT,false,24,12);
 function oval(x,y,z,sx,sy,sz,rgba){const model=matmul(base,matmul(translate(x,y,z),scale(sx,sy,sz)));
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uModel'),false,model);
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uMVP'),false,matmul(vp,model));
  const warm=impact>0&&rgba[0]>.1&&rgba[0]<.95;
  const color=warm?[rgba[0]*(1-.85*impact)+1*.85*impact,rgba[1]*(1-.85*impact)+.34*.85*impact,rgba[2]*(1-.85*impact)+.03*.85*impact,rgba[3]]:rgba;
  gl.uniform4fv(gl.getUniformLocation(mascotProgram,'uColor'),color);gl.drawArrays(gl.TRIANGLES,0,mascotVertexCount);}
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
 if(impact>0){gl.depthMask(false);try{oval(0,.045,0,.165,.219,.137,[1,.34,.035,.18*impact]);}finally{gl.depthMask(true);}}
 // The luminous orange rim appears only during a brief throw impact.
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
function uiPalette(){return window.FreeLabXRUI?.palette?.(uiSettings)||{panel:'#343d38',panel2:'#26332d',text:'#f0f9f1',muted:'#b8cfc0',accent:'#ff91b5',edge:'#92b8a2',bottom:'#14251c',font:'system-ui'};}
function canvas2d(w=PW,h=PH){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function rrect(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(ctx,msg,x,y,size=24,color='#fff',weight=600,align='left'){ctx.font=`${weight} ${size}px ${uiPalette().font}, system-ui, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(msg),x,y);ctx.textAlign='left';}
function wrapping(ctx,str,x,y,width,lh=30,lines=4){ctx.font=`22px ${uiPalette().font}, system-ui`;const words=String(str||'').split(/\s+/);let out='',n=0;for(const word of words){const test=out?out+' '+word:word;if(ctx.measureText(test).width>width&&out){text(ctx,out,x,y+n*lh,21,uiPalette().text,450);out=word;n++;if(n>=lines)return;}else out=test;}if(out)text(ctx,out,x,y+n*lh,21,uiPalette().text,450);}
function texture(c){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);return t;}
function panelSkin(ctx,w,h,r=28){const p=uiPalette();if(uiSettings.backgrounds!==false){
 const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,p.panel);g.addColorStop(.82,p.panel);g.addColorStop(1,p.panel2);rrect(ctx,0,0,w,h,r,g);
 }if(uiSettings.borders!==false){ctx.save();ctx.lineWidth=2.2;ctx.strokeStyle=p.edge;ctx.globalAlpha=.65;ctx.beginPath();ctx.moveTo(r/2,2);ctx.lineTo(w-r/2,2);ctx.stroke();ctx.globalAlpha=.72;ctx.strokeStyle=p.bottom;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(r/2,h-2);ctx.lineTo(w-r/2,h-2);ctx.stroke();ctx.restore();}}
function uiUpdate(setting,value){uiSettings=window.FreeLabXRUI?.save?.({...uiSettings,[setting]:value})||{...uiSettings,[setting]:value};
 if(setting==='experimental'&&value===false){experimentalMode('off');labSelector?.reset();if(labMenu){labMenu.visible=false;}}
 if(setting==='voice'&&value===false){voiceRecord?.cancel?.();dismissVoice();}
 if(setting==='voice')updateEditbar();
 if(setting==='mascot'&&value===false){mascotSpeech=null;}
 rebuildTheme();}
function rebuildTheme(){if(!gl)return;
 if(toolbar)refreshToolbar();if(configPanel)refreshConfig();
 if(debugPanel){const old=debugPanel.front;debugPanel.front=debugTexture();debugPanel.back=debugPanel.front;if(old)gl.deleteTexture(old);}
 if(descriptionPanel&&descriptionContext){const old=descriptionPanel.front;descriptionPanel.front=descriptionTexture(descriptionPanel.message||'',descriptionContext.card?.data?.label||'IMAGE',descriptionPanel.retryable);descriptionPanel.back=descriptionPanel.front;if(old)gl.deleteTexture(old);}
 for(const c of cards){if(!c.data||!c.front)continue;
  const nav=c.kind==='branchpage';
  const a=nav?navigationTexture(c.data.label||'NEXT'):cardTexture(c.data.image||null,c.data.label||'',c.data.subtitle||'',false,
   (w,h)=>{c.canvasHeight=h;c.size=cardDimensions(w,h,c.kind);},c.kind==='source'&&c.data.saved!==false,
   c.data.decodedImage||null,String(c.data.provider||'').includes('sam-3.1-mask'));
  for(const t of new Set(c.resources||[]))gl.deleteTexture(t);
  c.front=a.tex;c.back=a.tex;c.resources=[a.tex];
 }
}
function cardTexture(imageSrc,labelText,sub='PRIVATE CAPTURE',back=false,onDimensions=null,showExtract=false,readyImage=null,cutout=false){
 // Canvas and geometry both adapt to the source dimensions: never stretch or center-crop an object.
 const resource={tex:null,canvas:null};
 const paint=(image=null)=>{const fullWidth=600,frameWidth=566;
  const frameHeight=image?clamp(Math.round(frameWidth*image.height/image.width),112,1000):310;
  const h=back?420:frameHeight+110;const [c,ctx]=canvas2d(fullWidth,h);resource.canvas=c;
  if(!cutout||back)panelSkin(ctx,fullWidth,h,29);
  if(back){text(ctx,'FREELAB / OBJECT',40,65,19,uiPalette().muted,670);text(ctx,labelText.slice(0,25),40,130,37,uiPalette().text,690);wrapping(ctx,sub,40,175,fullWidth-86,32,6);}
  else{
   if(!cutout&&uiSettings.backgrounds!==false)rrect(ctx,17,17,frameWidth,frameHeight,18,uiPalette().panel2);
   if(image){const factor=Math.min(frameWidth/image.width,frameHeight/image.height);const w=image.width*factor,hh=image.height*factor;
    ctx.drawImage(image,17+(frameWidth-w)*.5,17+(frameHeight-hh)*.5,w,hh);}
   else text(ctx,'◎',fullWidth/2,frameHeight/2+53,102,'#9baea2',250,'center');
   if(showExtract){rrect(ctx,35,30,182,54,24,'#d6f3dc');text(ctx,'✳ EXTRACT',126,66,21,'#213b2b',690,'center');}
   if(cutout&&uiSettings.backgrounds!==false)rrect(ctx,14,h-103,fullWidth-28,102,22,'rgba(29,42,35,.74)');
   text(ctx,labelText.slice(0,34),28,h-58,27,uiPalette().text,680);text(ctx,sub.slice(0,56),28,h-23,15,uiPalette().muted,540);rrect(ctx,fullWidth-90,h-96,61,61,18,'#283b32');text(ctx,'⛶',fullWidth-59,h-53,41,'#effff2',550,'center');
  }
  if(!back){rrect(ctx,fullWidth-150,27,55,55,26,'#28352f');text(ctx,'···',fullWidth-122,64,31,'#ffffff',630,'center');
   rrect(ctx,fullWidth-84,27,55,55,26,'#28352f');text(ctx,'×',fullWidth-57,68,37,'#ffffff',440,'center');}
  else{rrect(ctx,fullWidth-85,27,55,55,26,'#28352f');text(ctx,'×',fullWidth-57,68,39,'#ffffff',400,'center');}
  if(resource.tex){gl.bindTexture(gl.TEXTURE_2D,resource.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);}else resource.tex=texture(c);
  if(image&&onDimensions)onDimensions(c.width,c.height);
 };
 paint(readyImage);
 if(imageSrc&&!readyImage){const img=new Image();img.decoding='async';img.onload=()=>{if(gl&&resource.tex)paint(img);};img.onerror=()=>{};img.src=imageSrc;}
 return resource;
}
function cardDimensions(width,height,kind){const aspect=height/Math.max(1,width),base=kind==='source'?.88:kind==='object'?.37:.35;
 const limit=kind==='source'?.95:kind==='object'?.60:.54;const widthMetres=Math.min(base,limit/aspect);
 return [widthMetres,widthMetres*aspect];}
function toolbarTexture(kind){
 const context=kind==='context',names=context?(meshConfirm?[['submit3d','⬡'],['cancel3d','×']]:imageTools()):tools;
 const w=context?300:620,h=context?names.length*70+24:112,p=uiPalette(),[c,ctx]=canvas2d(w,h);
 panelSkin(ctx,w,h,context?27:47);
 const labels={gallery:'LIB',follow:followMode?'PIN':'FOLLOW',debug:'LOG',config:'CONFIG',exit:'EXIT',
 segment:'EXTRACT',describe:'DESCRIBE',refine:'REFINE',prompt:'PROMPT',voice:'VOICE','3d':'3D',branch:'OPEN BRANCH',parent:'PARENT',closemenu:'CLOSE',submit3d:'CONFIRM 3D',cancel3d:'CANCEL'};
 if(context){names.forEach(([id,glyph],idx)=>{const y=16+idx*70,active=pointerHover===id;
   text(ctx,glyph,42,y+40,32,active?'#ffffff':p.accent,640,'center');
   text(ctx,labels[id]||id,82,y+40,22,active?'#ffffff':p.accent,650);
 });}else{const step=w/names.length;names.forEach(([id,glyph],idx)=>{const cx=step*(idx+.5),active=pointerHover===id;
   text(ctx,glyph,cx,52,36,active?'#ffffff':p.accent,660,'center');
   text(ctx,labels[id]||id,cx,91,18,active?'#ffffff':p.accent,660,'center');
   if(id==='gallery'&&clouds.length){const count=clouds.filter(q=>q.id>0).length;
    ctx.beginPath();ctx.arc(cx+36,22,18,0,TAU);ctx.fillStyle=p.accent;ctx.fill();
    text(ctx,count>999?'999+':String(count),cx+36,28,count>99?13:16,p.panel2,750,'center');}
 });}
 return texture(c);
}
const configSwitches=[['borders','Borders'],['backgrounds','Panel backgrounds'],['mascot','Flying mascot'],['experimental','Experimental modes'],['masked','Transparent SAM cutouts'],['voice','Voice features']];
function configTexture(){const [c,ctx]=canvas2d(770,970),p=uiPalette();panelSkin(ctx,c.width,c.height,38);
 text(ctx,'XR  /  PERSONALIZE',36,62,26,p.muted,700);text(ctx,'×',720,65,48,p.accent,650,'center');
 text(ctx,'THEME',43,135,25,p.text,670);text(ctx,uiSettings.generated?'GENERATED':uiSettings.theme.toUpperCase(),450,135,25,p.accent,700);
 text(ctx,'◀',615,135,30,p.accent,700,'center');text(ctx,'▶',710,135,30,p.accent,700,'center');
 text(ctx,'✦  GENERATE COLOUR THEME',48,212,28,p.accent,690);
 ctx.strokeStyle=p.edge;ctx.globalAlpha=.35;ctx.beginPath();ctx.moveTo(38,251);ctx.lineTo(730,251);ctx.stroke();ctx.globalAlpha=1;
 configSwitches.forEach(([key,label],i)=>{const y=306+i*80;
  text(ctx,label,43,y,26,p.text,600);const on=uiSettings[key]!==false;
  rrect(ctx,638,y-33,91,45,24,on?p.accent:p.panel2);
  ctx.beginPath();ctx.arc(on?700:661,y-10,17,0,TAU);ctx.fillStyle=on?p.panel2:p.muted;ctx.fill();
 });
 ctx.strokeStyle=p.edge;ctx.globalAlpha=.3;ctx.beginPath();ctx.moveTo(38,782);ctx.lineTo(730,782);ctx.stroke();ctx.globalAlpha=1;
 text(ctx,'PROCESSING ANIMATION',43,841,25,p.text,670);
 text(ctx,(uiSettings.processing||'spin').toUpperCase(),430,887,26,p.accent,670);
 text(ctx,'◀',610,888,30,p.accent,700,'center');text(ctx,'▶',702,888,30,p.accent,700,'center');
 text(ctx,'Changes save automatically in this headset browser',38,938,19,p.muted,480);
 return texture(c);
}
function refreshConfig(){if(!configPanel||!gl)return;const old=configPanel.front;configPanel.front=configTexture();configPanel.back=configPanel.front;if(old)gl.deleteTexture(old);}
function showConfig(){configShowing=!configShowing;
 if(configShowing&&!configPanel){const m=latestPose?.transform.matrix;const pos=latestPose?point(poseForwardAnchor(latestPose,1.05,-.08),[0,0,0]):[0,1.3,-1];const q=latestPose?lookingQuat(pos,[m[12],m[13],m[14]]):[0,0,0,1];const tex=configTexture();
  configPanel={id:'xr-config',kind:'config',pos,q,size:[.66,.83],scale:1,visible:true,front:tex,back:tex,resources:[tex]};}
 if(configPanel)configPanel.visible=configShowing;
 if(configShowing)refreshConfig();
}
function configHit(hit){const x=(hit.x+.5)*770,y=(.5-hit.y)*970;
 if(y<90)return x>645?'configclose':null;
 if(y>=95&&y<174)return x>650?'themenext':x>565?'themeprev':null;
 if(y>=178&&y<250)return 'themerandom';
 if(y>=267&&y<744)return 'config-'+configSwitches[clamp(Math.floor((y-267)/80),0,configSwitches.length-1)][0];
 if(y>=809&&y<919)return x>650?'processingnext':x>555?'processingprev':null;
 return null;
}
function cycleSetting(key,direction){const all=key==='theme'?window.FreeLabXRUI.choices:window.FreeLabXRUI.processing;
 const current=key==='theme'?uiSettings.generated?'current':uiSettings.theme:uiSettings.processing;
 const n=all.indexOf(current),v=all[(n+direction+all.length)%all.length];
 if(key==='theme'){uiSettings.generated=null;uiUpdate('theme',v);}else uiUpdate('processing',v);
}
function promptTexture(){const t=toolbarTexture('prompt');return t;}
function eyeTexture(){const [c,ctx]=canvas2d(320,320);const t=texture(c);return {canvas:c,ctx,tex:t};}
function liveCameraState(){
 const state=window.FreeLab?.getState?.()||{};
 const video=document.getElementById('cameraVideo');
 const track=state.stream?.getVideoTracks?.()[0];
 return Boolean(track?.readyState==='live'&&!track.muted&&video?.videoWidth>0&&video?.videoHeight>0);
}
function cameraHintMode(){
 if(eyeState==='activating')return 'enabling';
 if(eyeState==='snapping')return 'saving';
 if(eyeState==='error'&&performance.now()<eyeUntil)return 'error';
 if(extractionAvailable())return 'extract';
 return liveCameraState()?'ready':'off';
}
function cameraHintTexture(state){
 const [c,ctx]=canvas2d(720,108);ctx.clearRect(0,0,c.width,c.height);
 const info={off:['CAMERA OFF  ·  PRESS THE EYE TO ENABLE','#d9dfd9'],
  enabling:['ENABLING CAMERA  ·  CHECK PERMISSION','#ffe49e'],
  ready:['CAMERA ON  ·  PRESS THE EYE TO CAPTURE','#ff9bb9'],
  saving:['SAVING CAPTURE  ·  PLEASE WAIT','#ffe49e'],
  error:['CAMERA ERROR  ·  OPEN XR LOG','#ffaaaa'],
  extract:['PHOTO READY  ·  PRESS ✳ TO EXTRACT','#d4ffd6']}[state]||['CAMERA','#fff'];
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 29px system-ui';ctx.lineWidth=6;ctx.lineJoin='round';ctx.strokeStyle='#0b0d0b';ctx.strokeText(info[0],360,60);ctx.fillStyle=info[1];ctx.fillText(info[0],360,60);return texture(c);
}
function paintEye(t){if(!captureEye||!eyeResource||!gl)return;
 const {canvas:c,ctx,tex}=eyeResource;ctx.clearRect(0,0,320,320);
 const live=liveCameraState();const off=!live,waiting=eyeState==='activating'||eyeState==='snapping';
 const pulse=.5+.5*Math.sin(t*.0047);
 ctx.beginPath();ctx.arc(160,160,145,0,TAU);ctx.fillStyle=off?'#323735':'#543740';ctx.fill();
 if(live){const glow=ctx.createRadialGradient(160,160,93,160,160,149);
  glow.addColorStop(0,'rgba(255,95,155,0)');glow.addColorStop(.63,'rgba(255,78,136,.13)');glow.addColorStop(1,`rgba(255,85,132,${.53+pulse*.30})`);
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(160,160,149,0,TAU);ctx.fill();}
 if(off){ctx.strokeStyle=waiting?'#e7c2c2':'#929d96';ctx.lineWidth=13;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(83,160);ctx.quadraticCurveTo(160,205,237,160);ctx.stroke();
  ctx.beginPath();ctx.moveTo(160,186);ctx.lineTo(160,211);ctx.stroke();}
 else{const blink=Math.pow(Math.max(0,Math.cos(t*.00095)),24)*.14;
  ctx.beginPath();ctx.ellipse(160,160,115,77*(1-blink),0,0,TAU);ctx.fillStyle='#f4fff5';ctx.fill();
  ctx.beginPath();ctx.arc(160,160,62+pulse*3,0,TAU);ctx.fillStyle='#579777';ctx.fill();
  ctx.beginPath();ctx.arc(160,160,34,0,TAU);ctx.fillStyle='#18251f';ctx.fill();
  ctx.beginPath();ctx.ellipse(142,140,14,17,0,0,TAU);ctx.fillStyle='#fff';ctx.fill();}
 ctx.strokeStyle=waiting?'#ffe4ba':live?'#ff7ca7':'#6d7871';ctx.lineWidth=live?9:5;ctx.beginPath();
 ctx.arc(160,160,140,t*.00045,t*.00045+TAU*(waiting?.8:live?.88:.58));ctx.stroke();
 gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
}
function extractionAvailable(){return Boolean(cloud&&Number.isInteger(cloud.id)&&cloud.id>0&&!cloud.legacy&&!cloud.collapsed&&cards.some(c=>c.kind==='source'&&c.visible));}
function roundelTexture(kind){
 kind=kind==='voiceroundel'?'mic':kind==='extractroundel'?'extract':kind;
 const [c,ctx]=canvas2d(256,256);
 const disabled=busy&&voicePhase!=='listening';
 const inactive=kind==='extract'&&!extractionAvailable();
 ctx.beginPath();ctx.arc(128,128,118,0,TAU);
 ctx.fillStyle=(disabled||inactive)?'#303932':kind==='mic'&&voicePhase==='listening'?'#713337':'#36433b';ctx.fill();
 if(kind==='mic'){
  const live=voicePhase==='listening',processing=voicePhase==='processing';
  ctx.strokeStyle=live?'#ff6265':'#f4fff4';ctx.lineWidth=13;ctx.lineCap='round';
  ctx.beginPath();ctx.roundRect(103,65,50,93,24);ctx.stroke();
  ctx.beginPath();ctx.arc(128,141,49,0,Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(128,190);ctx.lineTo(128,206);ctx.moveTo(101,208);ctx.lineTo(155,208);ctx.stroke();
  if(live){const bands=window.FreeLab?.currentRecording?.()?.bands?.()||[];
   for(let i=0;i<36;i++){const a=i*TAU/36-Math.PI/2;const level=bands[i%Math.max(1,bands.length)]||0;
     const outer=105+Math.min(25,3+level*65);ctx.strokeStyle=`rgba(255,${92+i%3*13},${108+i%4*10},.92)`;ctx.lineWidth=4;
     ctx.beginPath();ctx.moveTo(128+Math.cos(a)*101,128+Math.sin(a)*101);ctx.lineTo(128+Math.cos(a)*outer,128+Math.sin(a)*outer);ctx.stroke();}
   ctx.font='bold 20px system-ui';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(String(Math.ceil((performance.now()-voiceRecordStarted)/1000))+'s',128,245);}
  if(processing){ctx.fillStyle='#ffe64b';for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(86+i*42,222,6,0,TAU);ctx.fill();}}
 }else if(kind==='extract'){
  ctx.font='124px system-ui';ctx.fillStyle=(disabled||inactive)?'#7f9889':'#d9ffe0';ctx.textAlign='center';ctx.fillText('✳',128,173);
 }else{
  ctx.font='bold 76px system-ui';ctx.textAlign='center';ctx.fillStyle='#ffffff';
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
 if(voiceButton){voiceButton.visible=voicePhase!=='processing';voiceButton.pos=vadd(captureEye.pos,offset(-.163,0,0));voiceButton.q=quatY(yaw);}
 if(extractButton){
  // The right roundel is a permanent part of the three-button spatial group.
  // When no source is selected it is dimmed, NEVER replaced by camera pixels.
  extractButton.visible=voicePhase!=='listening'&&voicePhase!=='processing';const active=extractionAvailable();
  if(active!==extractVisualActive){extractVisualActive=active;if(gl)refreshRoundel(extractButton,'extract');}
  extractButton.pos=vadd(captureEye.pos,offset(.163,0,0));extractButton.q=quatY(yaw);}
 if(voicePending){const center=point(poseForwardAnchor(pose,.97,-.045),[0,0,0]);
  if(voiceOk){voiceOk.pos=vadd(center,offset(-.087,0,0));voiceOk.q=quatY(yaw);}
  if(voiceCancel){voiceCancel.pos=vadd(center,offset(.087,0,0));voiceCancel.q=quatY(yaw);}
 }
}
function updateMicVisual(t){if(!voiceButton||t-lastMicUpdate<110)return;lastMicUpdate=t;refreshRoundel(voiceButton,'mic');}
function setEyeState(value,ms=950){eyeState=value;eyeUntil=performance.now()+ms;}

function mascotTexture(){const [c,ctx]=canvas2d(200,240);ctx.clearRect(0,0,200,240);
 ctx.fillStyle='#5f8266';ctx.beginPath();ctx.ellipse(52,54,27,51,-.3,0,TAU);ctx.ellipse(148,54,27,51,.3,0,TAU);ctx.fill();
 ctx.fillStyle='#81a38a';ctx.beginPath();ctx.ellipse(100,143,83,85,0,0,TAU);ctx.ellipse(100,83,79,76,0,0,TAU);ctx.fill();
 ctx.fillStyle='#bfdbc1';ctx.beginPath();ctx.ellipse(100,171,46,42,0,0,TAU);ctx.fill();
 ctx.fillStyle='#0b1810';for(const x of [72,127]){ctx.beginPath();ctx.ellipse(x,90,11,17,0,0,TAU);ctx.fill();}
 ctx.fillStyle='#ffffff';for(const x of [68,123]){ctx.beginPath();ctx.arc(x,84,4,0,TAU);ctx.fill();}
 ctx.fillStyle='#42674b';ctx.beginPath();ctx.ellipse(100,117,7,5,0,0,TAU);ctx.fill();return texture(c);}
function debugTexture(){const [c,ctx]=canvas2d(980,520);panelSkin(ctx,c.width,c.height,28);text(ctx,'XR / SERVER DIAGNOSTICS   ·   GRAB TO MOVE',24,43,23,uiPalette().accent,690);text(ctx,'−',790,45,33,'#fff',700);text(ctx,'+',858,45,33,'#fff',700);text(ctx,'×',936,46,37,'#fff',670);
 const messages=['DEPTH: '+depthState,...(window.FreeLab?.getTrace?.()||[]).filter(x=>['error','api','warn'].includes(x.kind)).slice(-6).map(x=>x.at+' '+x.message),...serverDiagnostic.slice(-5).map(x=>x.time.slice(11,19)+' '+x.method+' '+x.path+' · HTTP '+x.status+' · '+x.duration_ms+'ms')];
 if(!messages.length)messages.push('No recorded errors. Extract and API requests appear here when available.');
 messages.slice(-11).forEach((msg,i)=>text(ctx,String(msg).slice(0,110),24,94+i*36,19,uiPalette().text,490));return texture(c);}
async function loadServerDiagnostic(){if(!session||!debugShowing)return;try{const data=await window.FreeLab.serverDiagnostics();serverDiagnostic=data.entries||[];}catch(e){serverDiagnostic=[{time:new Date().toISOString(),method:'INFO',path:'Server diagnostics: '+e.message,status:'-',duration_ms:0}];}}
function updateDebugCard(t){if(!debugShowing||!toolbar||!gl)return;if(!debugPanel){const tex=debugTexture(),anchor=latestPose?point(poseForwardAnchor(latestPose,1.35,-.12),[0,0,0]):[0,1.35,-1.35];debugPanel={id:'diagnostics',kind:'diagnostics',pos:anchor,q:latestPose?quatY(cameraYaw(latestPose)):[0,0,0,1],size:[1.1,.58],scale:1,visible:true,front:tex,back:tex};}
 if(latestPose&&!held?.card?.kind?.includes('diagnostics')){const m=latestPose.transform.matrix;debugPanel.q=quatSlerp(debugPanel.q,lookingQuat(debugPanel.pos,[m[12],m[13],m[14]]),.18);}
 if(t-debugLast>1200){debugLast=t;const tex=debugTexture();gl.deleteTexture(debugPanel.front);debugPanel.front=tex;debugPanel.back=tex;}
 if(t-serverPoll>6000){serverPoll=t;loadServerDiagnostic();}}

function descriptionTexture(value,label,retryable=false){
 const [c,ctx]=canvas2d(800,355),p=uiPalette();ctx.clearRect(0,0,c.width,c.height);
 panelSkin(ctx,800,355,38);
 text(ctx,'ABOUT · '+String(label).slice(0,34),36,50,25,p.text,680);
 const message=String(value||'No description returned.').slice(0,2000);
 let y=92,line='';ctx.font=`23px ${p.font},system-ui`;const lines=[];
 for(const word of message.split(/\s+/)){
  const next=line?line+' '+word:word;if(ctx.measureText(next).width>718&&line){lines.push(line);line=word;}else line=next;
 }if(line)lines.push(line);
 for(const row of lines.slice(-5)){text(ctx,row,37,y,22,p.text,450);y+=34;}
 text(ctx,retryable?'↻  RETRY':'⌨  ASK',132,314,24,p.accent,670,'center');
 if(uiSettings.voice!==false)text(ctx,'◎  VOICE',358,314,24,p.accent,670,'center');
 text(ctx,'×',728,62,40,p.accent,670,'center');
 return texture(c);
}
function hideDescription(){if(descriptionPanel?.front)gl.deleteTexture(descriptionPanel.front);descriptionPanel=null;descriptionContext=null;}
function showDescription(card,value,retryable=false){if(descriptionPanel?.front)gl.deleteTexture(descriptionPanel.front);
 const tex=descriptionTexture(value,card.data?.label||'IMAGE',retryable);
 const pos=point(cardModel(card),[.63,-.02,.07]);
 const viewer=latestPose?.transform?.matrix||null;
 descriptionPanel={id:'description-popup',kind:'description',retryable,message:value,pos,q:viewer?lookingQuat(pos,[viewer[12],viewer[13],viewer[14]]):worldCardQuat(card),size:[.58,.257],scale:1,visible:true,front:tex,back:tex};
 descriptionContext={card,captureId:cloud?.id,objectId:card.kind==='object'?card.data.id:null};
}
async function askDescription(question=''){
 const context=descriptionContext;if(!context||busy)return;
 busy=true;inferenceCard=context.card;inferenceStarted=performance.now();setStatus('AI LOOKING AT SELECTED IMAGE · '+(question||'DESCRIBE'),11000);
 try{const result=await window.FreeLab.describeXR(context.captureId,context.objectId,question,!question);
  if(descriptionContext===context)showDescription(context.card,result.description);
  setStatus(result.cached?'Opened saved image description':'META DESCRIPTION READY · ask a follow-up or close',8000);
  mascotSay('I found something!');mascotEmotion('happy');window.FreeLab?.speakUpdate?.(result.description);
 }catch(e){const retry=Boolean(e.retryable||[429,503,504].includes(e.upstreamStatus));
  const message=retry?'Meta is busy right now. Tap RETRY to try again.':
   ('Cannot analyze this image: '+e.message+'\nCheck LOG for details.');
  if(descriptionContext===context)showDescription(context.card,message,retry);
  setStatus(retry?'Meta is busy · retry the description':'Image analysis failed · see LOG',9500);
  window.FreeLab?.traceEvent?.('DESCRIBE FAILED · '+e.message+(e.providerRequestId?' · request '+e.providerRequestId:''),'error');}
 finally{busy=false;inferenceCard=null;}
}
async function describeSelected(){const target=currentPromptTarget();if(!target)return setStatus('Select an image to describe');
 closeImageMenu();showDescription(target.card,'Analyzing the selected image with Meta…');return askDescription('');
}
async function descriptionAskKeyboard(){if(!descriptionContext)return;descriptionQuestionMode=true;
 const editor=document.getElementById('xrPromptEditor');editor?.classList.remove('hidden');editor?.classList.add('xr-native-open');
 if(!xrKeyboard){xrKeyboard=document.createElement('input');xrKeyboard.type='text';xrKeyboard.id='freelab-xr-native-input';xrKeyboard.maxLength=500;
  Object.assign(xrKeyboard.style,{position:'fixed',top:'12px',left:'12px',width:'min(65vw,450px)',height:'46px',background:'#33423b',color:'#fff',border:0,borderRadius:'22px',fontSize:'17px',padding:'0 16px',zIndex:'25'});
  (editor||document.body).appendChild(xrKeyboard);
 }
 xrKeyboard.value='';xrKeyboard.placeholder='Ask about this image, then press Enter';
 xrKeyboard.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();const q=xrKeyboard.value.trim();xrKeyboard.blur();editor?.classList.add('hidden');editor?.classList.remove('xr-native-open');descriptionQuestionMode=false;if(q)askDescription(q);}};
 xrKeyboard.focus();setStatus('ASK ABOUT THIS PHOTO · ENTER TO SEND · LIVE META VISION',16000);
}
function zoneTexture(icon,labelName){const [c,ctx]=canvas2d(200,200);rrect(ctx,0,0,200,200,96,'#414a45');text(ctx,icon,100,121,95,'#eefcf0',450,'center');text(ctx,labelName,100,172,20,'#c3d5c8',580,'center');return texture(c);}
function conciseStatus(value){
 const v=String(value||'').trim();
 if(/no recognizable speech/i.test(v))return 'No speech';
 if(/description error|meta description/i.test(v)&&/error/i.test(v))return 'Image analysis failed · see LOG';
 if(/transcribing speech/i.test(v))return 'Listening to your message…';
 if(/camera enabled/i.test(v))return 'Camera ready';
 if(/camera off/i.test(v))return 'Enable the camera with the eye';
 if(/capture .*saved/i.test(v))return 'Saved · ready to extract';
 if(/extracting parts/i.test(v))return 'Finding more objects…';
 if(/extracting/i.test(v))return 'Finding objects…';
 if(/saving photo/i.test(v))return 'Saving photo…';
 if(/transcript ready/i.test(v))return 'Confirm or cancel the message';
 const clean=v.replace(/\s*·\s*/g,' · ').replace(/\s+/g,' ');
 return clean.length>57?clean.slice(0,54).trimEnd()+'…':clean;
}
function statusTexture(value){
 const [c,ctx]=canvas2d(720,76);ctx.clearRect(0,0,c.width,c.height);
 const msg=conciseStatus(value);
 ctx.font='600 29px system-ui';const size=Math.max(16,Math.min(29,29*688/Math.max(1,ctx.measureText(msg).width)));ctx.font=`600 ${size}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.lineWidth=3;ctx.strokeStyle='rgba(4,11,8,.84)';ctx.lineJoin='round';
 ctx.strokeText(msg,360,40);ctx.fillStyle=/error|failed|unavailable|denied/i.test(msg)?'#eab3ac':'#c2d4c5';ctx.fillText(msg,360,40);
 return texture(c);
}
function navigationTexture(title){const [c,ctx]=canvas2d(600,175),p=uiPalette();
 ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle=p.accent;ctx.font=`bold 39px ${p.font},system-ui`;ctx.textAlign='center';ctx.fillText(title,300,98);return {tex:texture(c),canvas:c};}
function addCard(id,kind,data,loc,size){let c;
 const front=kind==='branchpage'?navigationTexture(data.label||'NEXT'):cardTexture(data.image||null,data.label||'',data.subtitle||'',false,(w,h)=>{if(c){c.size=cardDimensions(w,h,kind);c.canvasHeight=h;c.buttonBand=.5-86/h;}},kind==='source'&&data.saved!==false,data.decodedImage||null,kind==='object'&&String(data.provider||'').includes('sam-3.1-mask'));
 const back=cardTexture(null,data.label||'',`FOLDER: ${data.folder||'Unsorted'}. ${data.description||'Object from your personal space'}`,true);
 const initialHeight=front.canvas?.height||420;
 c={id,kind,data,front:front.tex,back:back.tex,resources:[front.tex,back.tex],pos:[...loc],from:[...loc],to:[...loc],start:0,duration:0,scale:1,rot:0,q:[0,0,0,1],visible:true,
   size:cardDimensions(front.canvas?.width||600,initialHeight,kind),canvasHeight:initialHeight,buttonBand:.5-86/initialHeight,original:[...loc]};cards.push(c);return c;}

// Isolated thumb-string experiment. The active Quest input modality determines when
// the right controller (toggle) and two tracked thumb-tip joints (simulation) exist.
const STRAND_V=`attribute vec3 aPos;attribute float aSide;uniform mat4 uVP;varying float vSide;void main(){vSide=aSide;gl_Position=uVP*vec4(aPos,1.0);}`;
const STRAND_F=`precision mediump float;varying float vSide;uniform vec3 uColor;uniform float uOpacity;void main(){float d=abs(vSide);float core=1.0-smoothstep(.22,.43,d);float halo=1.0-smoothstep(.30,1.0,d);float a=uOpacity*(.88*core+.16*halo);if(a<.006)discard;vec3 bright=min(vec3(1.0),uColor*1.08+vec3(.09));gl_FragColor=vec4(mix(uColor,bright,core*.7),a);}`;
let strandProgram=null,strandBuffer=null,stringLab=null,stringLabState=null,rightStickDown=false,lastStringWarning=0;
let fingerLab=null,fingerLabState=null,leftStickDown=false,lastFingerWarning=0;
let frameLab=null,frameLabState=null,labSelector=null,labMenu=null,labMenuCanvas=null,labMenuIndex=-1,lastFrameWarning=0;
let triangleLab=null,shapeTargets=[],lastSortReject=0,cinemaCards=[],cinemaIndex=0,darkPrevious=null,darkNext=null;
let frameGames=null,frameGameCubeBuffer=null,lastFrameGameTick=0,mascotHitUntil=0,mascotImpactSprite=null;
function stringColor(t){const stops=[[0,[.18,1,.38]],[.36,[.66,1,.30]],[.58,[1,.93,.18]],[.78,[1,.49,.10]],[1,[1,.12,.10]]];
 for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const a=stops[i-1],b=stops[i],u=(t-a[0])/(b[0]-a[0]);return a[1].map((c,j)=>c+(b[1][j]-c)*u);}
 return stops[stops.length-1][1];}
// One connected TRIANGLE_STRIP per strand. The shader produces its core + glow
// in a single pass, with depth writes OFF so transparent pixels cannot occlude
// the bright centre or compete with a second co-planar ribbon.
function strandRibbon(vp,path,width,rgb,alpha,eye){
 if(!strandProgram||path.length<2||alpha<=.001)return;
 const vertices=window.FreeLabStrandGeometry?.buildRibbon(path,eye,width);
 if(!vertices?.length)return;
 gl.useProgram(strandProgram);gl.bindBuffer(gl.ARRAY_BUFFER,strandBuffer);
 const stride=4*4,position=gl.getAttribLocation(strandProgram,'aPos'),side=gl.getAttribLocation(strandProgram,'aSide');
 gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,stride,0);
 gl.enableVertexAttribArray(side);gl.vertexAttribPointer(side,1,gl.FLOAT,false,stride,3*4);
 gl.uniformMatrix4fv(gl.getUniformLocation(strandProgram,'uVP'),false,vp);
 gl.uniform3fv(gl.getUniformLocation(strandProgram,'uColor'),rgb);
 gl.uniform1f(gl.getUniformLocation(strandProgram,'uOpacity'),alpha);
 gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);
 gl.depthMask(false);
 try{gl.drawArrays(gl.TRIANGLE_STRIP,0,vertices.length/4);}
 finally{gl.depthMask(true);}
}
function stringLine(a,b,sag=.0){const n=28,path=[];for(let i=0;i<=n;i++){
 const u=i/n,p=blend(a,b,u);p[1]-=sag*Math.sin(Math.PI*u);path.push(p);
 }return path;}
function snappedHalf(anchor,last,side,age){const phase=Math.max(0,(age-320)/1000),fall=.5*9.8*phase*phase,progress=clamp(age/1700,0,1),path=[];
 const tip=anchor||last;
 for(let i=0;i<=16;i++){
  const u=i/16,tail=.25*u;
  // Initially one end remains fixed to its thumb. After a brief hang both
  // fragments detach and fall; with local-floor available, stop at floor height.
  const x=tip[0]+side*(.015*u+.09*u*u)+Math.sin(progress*7+u*4)*.012*u;
  const y=Math.max(.028,tip[1]-.22*u-.14*u*u-fall*(.45+.55*u));
  const z=tip[2]+.04*u+Math.sin(progress*5+u*6)*.018*u;
  path.push([x,y,z]);
 }return path;}
function pollStringLab(frame,t){if(!stringLab)return;
 const tips={};for(const src of session.inputSources){if(!src.hand||!['left','right'].includes(src.handedness))continue;
  try{const joint=src.hand.get('thumb-tip'),p=joint&&frame.getJointPose?.(joint,refSpace)?.transform?.position;
   if(p)tips[src.handedness]=[p.x,p.y,p.z];}catch{}
 }
 stringLabState=stringLab.update({left:tips.left||null,right:tips.right||null,time:t});
 if(!stringLab.enabled){window.FreeLabSound?.stringStop?.();return;}
 if(stringLabState.event==='attach'){window.FreeLabSound?.stringAttach?.();cue('bloom');}
 else if(stringLabState.event==='snap'){window.FreeLabSound?.stringSnap?.();setStatus('SNAP · separate thumbs, then touch again',4200);}
 else if(stringLabState.event==='lost'){window.FreeLabSound?.stringStop?.();}
 if(stringLabState.mode==='linked')window.FreeLabSound?.stringUpdate?.(stringLabState.span);
 else if(stringLabState.mode!=='snapped')window.FreeLabSound?.stringStop?.();
 if(!tips.left||!tips.right){if(t-lastStringWarning>15000){
  lastStringWarning=t;setStatus('STRING LAB · tracked thumbs needed; put controllers down if necessary',7500);
 }}
}
function drawStringLab(vp,t,pose){const state=stringLabState;if(!state||!stringLab?.enabled)return;
 const h=pose.transform.matrix,eye=[h[12],h[13],h[14]];
 if(state.mode==='linked'&&state.left&&state.right){
  const tension=clamp(state.span,0,1),color=stringColor(tension),width=.021-.013*tension;
  const path=stringLine(state.left,state.right,.065*(1-tension));
  strandRibbon(vp,path,width*2.25,color,.98,eye);
  line(vp,[state.left,state.right],[...color,.24],true,20);
  line(vp,[state.left,state.right],[...color,1],true,10);
 }else if(state.mode==='snapped'&&state.broken){
  const b=state.broken,age=t-b.start,fade=clamp(1-(age-540)/1040,0,1);
  const l=snappedHalf(age<450&&state.left?state.left:b.left,b.left,-1,age),r=snappedHalf(age<450&&state.right?state.right:b.right,b.right,1,age);
  for(const path of [l,r]){
   strandRibbon(vp,path,.026,stringColor(.92),fade,eye);
  }
  if(age<410){line(vp,[l[0],r[0]],[1,.31,.15,fade],true,13);}
 }
}


// Left controller thumbstick: independent five-finger lab. The hand-tracking
// modality can take over after toggling; never require controller+hand together.
function pollFingerLab(frame,t){if(!fingerLab||!fingerLab.enabled)return;
 const fingertips={left:{},right:{}};
 const fingers=window.FreeLabFingerLab.FINGERS;
 for(const src of session.inputSources){if(!src.hand||!fingertips[src.handedness])continue;
  for(const f of fingers){try{
   const joint=src.hand.get(f.joint),p=joint&&frame.getJointPose?.(joint,refSpace)?.transform?.position;
   if(p)fingertips[src.handedness][f.id]=[p.x,p.y,p.z];
  }catch{}}
 }
 fingerLabState=fingerLab.update({left:fingertips.left,right:fingertips.right,time:t});
 for(const event of fingerLabState.events){
  if(event.type==='attach')window.FreeLabSound?.fingerAttach?.(event.id,event.frequency);
  else if(event.type==='snap')window.FreeLabSound?.fingerSnap?.(event.id);
  else if(event.type==='lost')window.FreeLabSound?.fingerStop?.(event.id);
 }
 for(const strand of fingerLabState.strands){
  if(strand.mode==='linked')window.FreeLabSound?.fingerUpdate?.(strand.id,strand.hz,strand.tension);
  else if(strand.mode!=='snapped')window.FreeLabSound?.fingerStop?.(strand.id);
 }
 if((!Object.keys(fingertips.left).length||!Object.keys(fingertips.right).length)&&t-lastFingerWarning>16000){
  lastFingerWarning=t;setStatus('FIVE FINGER LAB · both tracked hands required · put controllers down',7200);
 }
}
function drawFingerLab(vp,t,pose){if(!fingerLab?.enabled||!fingerLabState?.enabled)return;
 const h=pose.transform.matrix,eye=[h[12],h[13],h[14]];
 for(const strand of fingerLabState.strands){
  if(strand.mode==='linked'&&strand.left&&strand.right){
   const col=window.FreeLabFingerLab.gradient({start:strand.start,end:strand.end},strand.tension);
   const width=.018-.010*strand.tension,path=stringLine(strand.left,strand.right,.042*(1-strand.tension));
   strandRibbon(vp,path,width*2.1,col,.98,eye);
   line(vp,[strand.left,strand.right],[...col,1],true,8);
  }else if(strand.mode==='snapped'&&strand.broken){
   const age=t-strand.broken.start,fade=clamp(1-(age-500)/1050,0,1),b=strand.broken;
   const left=snappedHalf(age<440&&strand.left?strand.left:b.left,b.left,-1,age);
   const right=snappedHalf(age<440&&strand.right?strand.right:b.right,b.right,1,age);
   for(const path of [left,right]){
    strandRibbon(vp,path,.022,strand.end,fade,eye);
   }
  }
 }
}
// Unified experimental mode selector. A miniature upright dark pill follows
// the LEFT controller after X opens it. Tilt axis[2] left/right, return to
// neutral between steps, use left trigger to confirm (X cancels).
function experimentalMenuTexture(index){
 const modes=window.FreeLabLabSelector.MODES;
 const [c,ctx]=canvas2d(600,136);rrect(ctx,0,0,600,136,64,'#29332f');
 // Five visible choices; seven selectable modes. Compact and controller-adjacent.
 for(let slot=0;slot<5;slot++){
  const j=(index+slot-2+modes.length)%modes.length,mode=modes[j];
  const x=60+slot*120,active=slot===2;
  if(active)rrect(ctx,x-54,7,108,122,52,'#c5f3d2');
  const col=active?'#1c3227':'#e6f5e9';ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';
  if(mode==='frames'||mode==='sort'||mode==='chain'||mode==='cubes'||mode==='throw'){
   ctx.strokeRect(x-22,24,44,32);
   if(mode==='sort'){ctx.beginPath();ctx.moveTo(x-18,56);ctx.lineTo(x,17);ctx.lineTo(x+18,56);ctx.closePath();ctx.stroke();}
   if(mode==='chain'){ctx.beginPath();ctx.moveTo(x-30,46);ctx.lineTo(x-11,61);ctx.lineTo(x+11,61);ctx.lineTo(x+30,46);ctx.stroke();}
   if(mode==='cubes'){ctx.strokeRect(x-12,16,43,30);ctx.beginPath();ctx.moveTo(x-22,24);ctx.lineTo(x-12,16);ctx.moveTo(x+22,24);ctx.lineTo(x+31,16);ctx.stroke();}
   if(mode==='throw'){ctx.beginPath();ctx.moveTo(x+10,60);ctx.lineTo(x+34,35);ctx.lineTo(x+20,35);ctx.moveTo(x+34,35);ctx.lineTo(x+33,49);ctx.stroke();}
  }else if(mode==='five'){for(let k=-2;k<=2;k++){ctx.beginPath();ctx.moveTo(x-22,39+k*7);ctx.lineTo(x+22,39+k*7);ctx.stroke();}}
  else if(mode==='thumbs'){ctx.beginPath();ctx.moveTo(x-24,30);ctx.lineTo(x+24,30);ctx.moveTo(x-24,46);ctx.lineTo(x+24,46);ctx.stroke();}
  else {ctx.beginPath();ctx.moveTo(x-16,24);ctx.lineTo(x+16,56);ctx.moveTo(x+16,24);ctx.lineTo(x-16,56);ctx.stroke();}
  ctx.font=active?'700 21px system-ui':'600 19px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(({frames:'FRAME',sort:'SHAPES',chain:'CHAIN',cubes:'CUBES',throw:'THROW',five:'5 NOTE',thumbs:'THUMBS',off:'OFF'})[mode],x,95);
 }
 return texture(c);
}
function experimentalMode(mode){
 const name={sort:'SHAPE SORT · create rectangles or triangles and move them to matching bins',frames:'SPATIAL FRAMES · join index tips and thumbs, then stretch',chain:'CHAIN LAB · overlap a held frame with another to link',cubes:'CUBOID LAB · draw shapes that fall and stack',throw:'THROW LAB · grab a frame and release with a quick gesture',five:'FIVE-FINGER CHORD LAB · C D E F G',thumbs:'THUMB STRING LAB · stretch and snap',off:'EXPERIMENTS OFF'};
 const drawing=['frames','sort','chain','cubes','throw'].includes(mode);
 if(mode==='sort')placeShapeTargets();else shapeTargets=[];
 triangleLab?.reset();
 stringLab?.setEnabled(mode==='thumbs');fingerLab?.setEnabled(mode==='five');frameLab?.setEnabled(drawing);frameGames?.setMode(mode);
 window.FreeLabSound?.stringStop?.();window.FreeLabSound?.fingersStopAll?.();
 if(drawing)frameLab?.setHoldSeconds(window.FreeLab?.pref?.('frameHoldSeconds')||3);
 if(mode!=='thumbs')stringLabState=null;
 if(mode!=='five')fingerLabState=null;
 if(!drawing){frameLabState=null;frameTouch=null;frameErase=null;}
 cue(mode==='off'?'release':'ready');setStatus(name[mode]||name.off,6000);
}
function pollLabSelector(frame,t,pose){if(!labSelector||uiSettings.experimental===false)return;
 const sel=labSelector.update(session.inputSources);
 if(sel.event==='select'||sel.event==='cancel'){
  if(sel.event==='select'){held=null;handPinch=new WeakMap();clickState=new WeakMap();pointerHover=null;descriptionQuestionMode=false;experimentalMode(sel.mode);}
  else cue('release',sel.source);
  if(labMenu?.front){gl.deleteTexture(labMenu.front);labMenu.front=null;}labMenu=null;labMenuIndex=-1;
 }
 if(!sel.open)return;
 if(sel.event==='step'){cue('hover',sel.source);}
 if(sel.event==='open'){window.FreeLabSound?.unlock?.();cue('pin',sel.source);}
 if(!labMenu){labMenu={id:'lab-selector',kind:'labmenu',size:[.37,.085],scale:1,visible:true,q:quatY(cameraYaw(pose)),pos:[0,0,0],front:null,back:null};}
 if(sel.index!==labMenuIndex){if(labMenu.front)gl.deleteTexture(labMenu.front);labMenu.front=experimentalMenuTexture(sel.index);labMenu.back=labMenu.front;labMenuIndex=sel.index;}
 // The menu is close to the physical controller, not head-locked or card-locked.
 const device=sel.source,controllerPose=device&&(device.gripSpace?frame.getPose(device.gripSpace,refSpace):null);
 const p=controllerPose?.transform?.position||inputPose(frame,device)?.transform?.position;
 if(p){labMenu.visible=true;const h=pose.transform.matrix,eye=[h[12],h[13],h[14]],hand=[p.x,p.y,p.z];
  const toEye=norm(vsub(eye,hand));
  labMenu.pos=vadd(hand,vadd(vmul(toEye,.095),[0,.125,0]));
  // Keep the near-field menu readable when the controller is close to the eyes.
  const dist=length(vsub(labMenu.pos,eye));if(dist<.34)labMenu.pos=vadd(eye,vmul(norm(vsub(labMenu.pos,eye)),.34));
  labMenu.q=quatY(cameraYaw(pose));
 }else labMenu.visible=Boolean(labMenu.front);
}
function trackedHandCorners(frame){const hands={left:{},right:{}};
 for(const src of session.inputSources){if(!src.hand||!hands[src.handedness])continue;
  for(const [id,jointName] of [['thumb','thumb-tip'],['index','index-finger-tip'],['middle','middle-finger-tip'],['ring','ring-finger-tip'],['pinky','pinky-finger-tip']]){
   try{const jp=frame.getJointPose?.(src.hand.get(jointName),refSpace),p=jp?.transform?.position;
    if(p)hands[src.handedness][id]=[p.x,p.y,p.z];}catch{}
  }
 }
 return hands;
}
function pollFrameLab(frame,t){if(!frameLab?.enabled)return;
 const tips=trackedHandCorners(frame);
 if(labSelector?.mode==='sort'&&triangleLab){
  const tri=triangleLab.update({left:tips.left,right:tips.right,time:t});
  if(tri.event==='attach'){frameLab.reset();cue('pin');setStatus('TRIANGLE · stretch your fingertips, then release',3000);}
  if(tri.placed){frameLab.frames.push(tri.placed);if(frameLab.frames.length>40)frameLab.frames.shift();cue('bloom');setStatus('TRIANGLE READY · carry it to the triangular bin',3200);}
  if(triangleLab.phase==='stretch'){frameLabState={live:tri.live,progress:0};return;}
 }
 const state=frameLab.update({left:tips.left,right:tips.right,time:t});frameLabState=state;
 if(state.event==='attach'){cue('grab');setStatus(`FRAME LAB · stretch frame; hold for ${frameLab.holdSeconds} seconds`,6800);}
 if(state.event==='countdown')cue('pin');
 if(state.event==='place'){
  const placed=state.frames[state.frames.length-1];const mode=labSelector?.mode||'frames';
  const game=frameGames?.onFrame(placed,mode,t);
  if(game?.removeFrame){frameLab.frames=frameLab.frames.filter(f=>f!==placed);cue('release');setStatus(`CUBOID DROPPED · ${frameGames.boxes.length} blocks`,3500);}
  else{cue('bloom');setStatus(mode==='chain'?'FRAME READY · overlap another while holding it':mode==='throw'?'FRAME READY · grab then throw':`FRAME PLACED · ${state.frames.length} room frame(s)`,4500);}
 }
 if(state.event==='lost')setStatus('FRAME TRACKING LOST · join tips again',5500);
 if(!tips.left.index&&t-lastFrameWarning>17000){lastFrameWarning=t;setStatus('FRAME LAB · enable both tracked hands (put controllers down)',6800);}
}
function distancePointToSegment(p,a,b){const e=vsub(b,a),den=length(e)**2||1;
 const u=clamp(vsub(p,a).reduce((sum,x,i)=>sum+x*e[i],0)/den,0,1);
 return length(vsub(p,vadd(a,vmul(e,u))));}
function frameNearestEdge(p){let best=null;
 for(const f of frameLab?.frames||[])for(let i=0;i<f.corners.length;i++){
  const dist=distancePointToSegment(p,f.corners[i],f.corners[(i+1)%f.corners.length]);
  if(dist<.085&&(!best||dist<best.dist))best={frame:f,dist};
 }return best;
}
function pollPlacedFrameTouch(frame,t){if(!frameLab?.frames?.length||!session||!frame.getJointPose)return;
 // An index/thumb pinch near a placed edge selects it; the frame follows that fingertip.
 // A sustained little-finger touch near an edge deletes it. No model calls.
 for(const src of session.inputSources){if(!src.hand)continue;
  const get=name=>{try{const q=frame.getJointPose(src.hand.get(name),refSpace)?.transform.position;return q?[q.x,q.y,q.z]:null;}catch{return null;}};
  const index=get('index-finger-tip'),thumb=get('thumb-tip'),pinky=get('pinky-finger-tip');
  if(!index||!thumb)continue;
  const pinch=length(vsub(index,thumb))<.036;
  if(frameTouch?.src===src){if(!pinch){
   if(labSelector?.mode==='throw'){
    const fired=frameGames?.launch(frameLab.frames,frameTouch.id,frameTouch.velocity||[0,0,0],t);
    if(fired){cue('bloom',src);setStatus('FRAME LAUNCHED',2400);}
   }
   frameTouch=null;continue;}
   const df=frameLab.frames.find(x=>x.id===frameTouch.id);
   if(!df){frameTouch=null;continue;}
   const wrist=src.hand.get('wrist');let orientation=null;
   try{const q=frame.getJointPose(wrist,refSpace)?.transform.orientation;
    if(q)orientation=[q.x,q.y,q.z,q.w];}catch{}
   // Transform from the original contact point: position AND roll/pitch/yaw stay
   // physically attached to the hand instead of following translation alone.
   df.corners=window.FreeLabFrameLab.transformGrab(
    frameTouch.corners,frameTouch.index,index,frameTouch.orientation,orientation);
   const dt=(t-(frameTouch.lastT||t))/1000;
   if(dt>.004&&dt<.16){const raw=vmul(vsub(index,frameTouch.lastIndex||index),1/dt);
    frameTouch.velocity=blend(frameTouch.velocity||raw,raw,.45);}
   frameTouch.lastIndex=[...index];frameTouch.lastT=t;
   if(labSelector?.mode==='sort'&&shapeTargets.length){
    const hit=window.FreeLabShapeSort.targetHit(df,shapeTargets);
    if(hit?.accept){frameLab.frames=frameLab.frames.filter(x=>x.id!==df.id);frameTouch=null;cue('bloom',src);launchMascotSparks(hit.center,t);setStatus('MATCH! · shape collected',2800);break;}
    if(hit&&!hit.accept&&t-lastSortReject>1350){lastSortReject=t;cue('paper',src);setStatus('WRONG BIN · match the outline',2200);}
   }
   if(labSelector?.mode==='chain'){
    const attached=frameGames?.linkOnOverlap(frameLab.frames,df.id);
    if(attached){cue('pin',src);setStatus('CHAIN LINKED · release to swing',3200);}
   }
   continue;
  }
  if(pinch&&frameLab.enabled&&!frameTouch){const nearest=frameNearestEdge(index);if(nearest){
   let orientation=null;try{const q=frame.getJointPose(src.hand.get('wrist'),refSpace)?.transform.orientation;
    if(q)orientation=[q.x,q.y,q.z,q.w];}catch{}
   frameTouch={src,id:nearest.frame.id,corners:nearest.frame.corners.map(c=>[...c]),index:[...index],orientation,lastIndex:[...index],lastT:t,velocity:[0,0,0]};
   cue('grab',src);setStatus('FRAME HELD · move and rotate your hand; release to leave in space',6200);continue;}}
  if(!pinch&&pinky&&frameLab.enabled){const hit=frameNearestEdge(pinky);
   if(hit&&hit.dist<.035){if(!frameErase||frameErase.id!==hit.frame.id)frameErase={id:hit.frame.id,since:t};
    else if(t-frameErase.since>650){frameLab.frames=frameLab.frames.filter(f=>f.id!==hit.frame.id);frameErase=null;cue('paper',src);setStatus('SPATIAL FRAME REMOVED · little finger held at edge',5800);}
   }else frameErase=null;
  }
 }
}
// Lightweight, headset-budgeted rigid cuboids, generated from hand-drawn rectangles.
// The solver runs independently of models/inference. Draw with the existing shaded mesh shader.
function cubeGeometry(){
 if(frameGameCubeBuffer)return;
 const values=[];const faces=[
  [[0,0,1],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
  [[0,0,-1],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
  [[0,1,0],[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
  [[0,-1,0],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]],
  [[1,0,0],[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],
  [[-1,0,0],[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]]
 ];
 for(const [n,vertices] of faces)for(const i of [0,1,2,0,2,3])values.push(...vertices[i].map(v=>v*.5),...n);
 frameGameCubeBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,frameGameCubeBuffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
}
function drawFrameCubes(vp){if(!frameGames?.boxes?.length||!mascotProgram)return;
 cubeGeometry();gl.useProgram(mascotProgram);gl.bindBuffer(gl.ARRAY_BUFFER,frameGameCubeBuffer);
 const p=gl.getAttribLocation(mascotProgram,'aPos'),n=gl.getAttribLocation(mascotProgram,'aNormal');
 gl.enableVertexAttribArray(p);gl.enableVertexAttribArray(n);
 gl.vertexAttribPointer(p,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(n,3,gl.FLOAT,false,24,12);
 for(const cube of frameGames.boxes){
  const q=matmul(translate(...cube.center),scale(...cube.half.map(n=>n*2)));
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uModel'),false,q);
  gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uMVP'),false,matmul(vp,q));
  gl.uniform4fv(gl.getUniformLocation(mascotProgram,'uColor'),[.32,.82,.62,.88]);
  gl.drawArrays(gl.TRIANGLES,0,36);
 }
}
function placeShapeTargets(){
 if(!latestPose)return;const m=latestPose.transform.matrix,eye=[m[12],m[13],m[14]],q=quatY(cameraYaw(latestPose));
 shapeTargets=[{shape:'triangle',center:vadd(eye,quatVec(q,[-.50,-.19,-1.35])),q},
  {shape:'rectangle',center:vadd(eye,quatVec(q,[.50,-.19,-1.35])),q}];
}
function drawShapeTargets(vp,t,pose){if(labSelector?.mode!=='sort'||!shapeTargets.length)return;
 const m=pose.transform.matrix,eye=[m[12],m[13],m[14]];
 for(const bin of shapeTargets){const local=bin.shape==='triangle'?[[-.20,-.17,0],[.20,-.17,0],[0,.21,0]]:[[-.20,-.18,0],[.20,-.18,0],[.20,.18,0],[-.20,.18,0]];
  const front=local.map(p=>vadd(bin.center,quatVec(bin.q,p.map((n,i)=>i===2?n+.11:n)))),back=local.map(p=>vadd(bin.center,quatVec(bin.q,p.map((n,i)=>i===2?n-.11:n))));
  const color=bin.shape==='triangle'?[1,.58,.79]:[.54,.93,1],op=.82+.12*Math.sin(t*.003);
  const edge=(a,b)=>strandRibbon(vp,[a,b],.011,color,op,eye);
  for(let i=0;i<front.length;i++){const next=(i+1)%front.length;edge(front[i],front[next]);edge(back[i],back[next]);edge(front[i],back[i]);}
 }
}
function pollFrameGames(t,pose){if(!frameGames||!frameLab)return;
 const headY=pose.transform.matrix[13];
 // 'local-floor' yields real floor=0; otherwise a stable approximate floor.
 const floorY=floorReference?0:(frameGames.floorY||headY-1.45);
 if(!floorReference&&frameGames.floorY===0)frameGames.setFloor(floorY);
 const mascot=mascotPointer?.visible?mascotPointer.pos:null;
 const state=frameGames.update(frameLab.frames,t,{floorY,mascot,mascotRadius:.14});
 for(const event of state.events){
  if(event.event==='mascot-hit'){mascotHitUntil=t+1000;mascotEmotion('surprised',1000);
   launchMascotSparks(event.position,t);cue('impact');
  }else if(event.event==='vanish'){cue('release');setStatus('FRAME POP',1600);}
 }
}
function frameCenter(f){return vmul(f.corners.reduce((a,p)=>vadd(a,p),[0,0,0]),1/f.corners.length);}
function drawSpatialFrames(vp,t,pose){if(!frameLab)return;
 const h=pose.transform.matrix,eye=[h[12],h[13],h[14]];
 const draw=(corners,color,opacity,width)=>{
  for(let i=0;i<corners.length;i++)strandRibbon(vp,[corners[i],corners[(i+1)%corners.length]],width,color,opacity,eye);
  line(vp,corners,[...color,.76*opacity],true,10);
 };
 // Detached frames are always fixed in local-floor reference space, even
 // while other experiments are enabled or the headset walks elsewhere.
 for(const f of frameLab.frames){
  const fly=frameGames?.throws?.find(q=>q.id===f.id);
  const tint=f.gameMode==='chain'?[.42,.85,1]:f.gameMode==='throw'?[1,.64,.35]:[.37,.99,.74];
  draw(f.corners,tint,(fly?.alpha??.86),.009);
 }
 for(const j of frameGames?.links||[]){const parent=frameLab.frames.find(f=>f.id===j.parentId);
  if(parent)strandRibbon(vp,[vadd(frameCenter(parent),j.pivotOffset),j.center],.008,[.8,1,.7],.90,eye);
 }

 if(frameLab.enabled&&frameLabState?.live){
  const f=frameLabState.live,c=f.corners,p=frameLabState.progress;
  draw(c,[.64,1,.51],.75+.18*Math.sin(t*.007),.014);
  if(p>0){const a=c[0],b=c[1],s=vadd(a,vmul(vsub(b,a),p));strandRibbon(vp,[a,s],.022,[1,.91,.35],.96,eye);}
 }
}
function setStatus(value,ms=6000){statusText=String(value);statusBorn=performance.now();statusUntil=statusBorn+ms;
 if(gl&&poseReady){const tex=statusTexture(statusText);if(statusCard?.front)gl.deleteTexture(statusCard.front);
  statusCard={id:'spatial-status',kind:'status',size:[.50,.053],pos:statusCard?.pos||[0,0,0],q:latestPose?quatY(cameraYaw(latestPose)):[0,0,0,1],scale:1,visible:true,alpha:0,front:tex,back:tex};}
 window.FreeLab?.traceEvent?.('XR STATUS · '+statusText,/ERROR|FAILED|UNAVAILABLE|HTTP 4|HTTP 5/.test(statusText)?'error':'status');
 if(!session)window.FreeLab?.notify?.(statusText);}
// The text is static: only its alpha changes. Opening is quicker than the closing fade.
function typeStatus(t){if(!statusCard)return;
 const fadeIn=300,fadeOut=900,remaining=statusUntil-t;
 statusCard.alpha=clamp(Math.min((t-statusBorn)/fadeIn,remaining/fadeOut),0,1)*.92;
 statusCard.visible=remaining>0;
}
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
function rootPos(c){return cloud&&!['config','toolbar','status','captureeye','voiceroundel','extractroundel','voiceok','voicecancel','diagnostics','description','labmenu','darkroom','darkroomexit','cinema-floor'].includes(c.kind)?vadd(c.pos,cloud.offset||[0,0,0]):c.pos;}
function baseFor(c){if(c.kind==='pointer-mascot'||['config','toolbar','status','captureeye','voiceroundel','extractroundel','voiceok','voicecancel','diagnostics','description','labmenu','darkroom','darkroomexit','cinema-floor'].includes(c.kind))return translate();return root;}
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
 if(captureEye){const target=point(poseForwardAnchor(pose,1.02,-.305),[0,0,0]);
  const a=1-Math.exp(-Math.min(.08,(t-lastFrame||16)/1000)*3.1);
  captureEye.pos=blend(captureEye.pos,target,a);captureEye.q=quatY(yaw);syncRoundels(pose);
  if(cameraHint){cameraHint.pos=vadd(captureEye.pos,point(rotateY(yaw),[0,.148,0],0));cameraHint.q=quatY(yaw);}}
 if(statusCard&&captureEye){
  // Follow the same eased pose as the capture eye; never a second drifting velocity.
  statusCard.pos=vadd(captureEye.pos,point(rotateY(yaw),[0,.080,0],0));
  statusCard.q=captureEye.q;statusCard.visible=t<statusUntil&&voicePhase==='idle';
 }
 // Diagnostics uses its own world-space pose, intentionally NOT bound to the toolbar or head.
 lastFrame=t;
}
function cardModel(c){
 if(c.kind==='contextbar'&&c.parentCard){const parent=c.parentCard,sc=parent.scale*(parent.animScale===undefined?1:parent.animScale);
  // A single vertical popover sits to the right and slightly BEHIND the image plane.
  const parentWorld=point(baseFor(parent),rootPos(parent));
  const v=latestPose?.transform?.matrix;const viewer=v?[v[12],v[13],v[14]]:null;
  const metres=viewer?length(vsub(viewer,parentWorld)):1.3;
  const uiScale=clamp(metres/1.3,.58,1.22);
  const x=parent.size[0]*sc*.5+c.size[0]*uiScale*.52+.026;
  return matmul(baseFor(parent),matmul(translate(...rootPos(parent)),matmul(quatMatrix(parent.q||quatY(parent.rot||0)),matmul(translate(x,0,-.022),scale(c.size[0]*uiScale,c.size[1]*uiScale,1)))));}
 const p=rootPos(c),sc=c.scale*(c.animScale===undefined?1:c.animScale);
 return matmul(baseFor(c),matmul(translate(...p),matmul(quatMatrix(c.q||quatY(c.rot||0)),scale(c.size[0]*sc,c.size[1]*sc,1))));}
function cardBack(c){if(!latestPose||c.kind==='contextbar')return false;
 const h=latestPose.transform.matrix,eye=[h[12],h[13],h[14]],model=cardModel(c);
 const face=norm([model[8],model[9],model[10]]),center=[model[12],model[13],model[14]];
 return face.reduce((n,v,i)=>n+v*(eye[i]-center[i]),0)<0;
}
function drawCard(c,vp){if(!c.visible||!c.front||c.animScale===0)return;const tex=cardBack(c)?c.back:c.front;
 gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,quad);const loc=gl.getAttribLocation(program,'aPos'),uv=gl.getAttribLocation(program,'aUV');gl.enableVertexAttribArray(loc);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12);
 gl.uniformMatrix4fv(gl.getUniformLocation(program,'uMVP'),false,matmul(vp,cardModel(c)));gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(gl.getUniformLocation(program,'uTex'),0);gl.uniform1i(gl.getUniformLocation(program,'uFlip'),cardBack(c)?1:0);gl.uniform1f(gl.getUniformLocation(program,'uOpacity'),c.alpha===undefined?1:clamp(c.alpha,0,1));gl.drawArrays(gl.TRIANGLES,0,6);}
function line(vp,vertices,color,points=false,size=6){if(!vertices.length)return;gl.useProgram(lineProgram);gl.bindBuffer(gl.ARRAY_BUFFER,rayBuffer);const loc=gl.getAttribLocation(lineProgram,'aPos');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram,'uVP'),false,vp);gl.uniform4fv(gl.getUniformLocation(lineProgram,'uColor'),color);gl.uniform1i(gl.getUniformLocation(lineProgram,'uPoint'),points?1:0);gl.uniform1f(gl.getUniformLocation(lineProgram,'uSize'),size);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices.flat()),gl.DYNAMIC_DRAW);gl.drawArrays(points?gl.POINTS:gl.LINES,0,vertices.length);}
function decoration(vp){if(!cloud||cloud.collapsed||cloud.hidden)return;const focus=cards.find(c=>c.id==='item'+branchFocusId);const core=focus?point(root,rootPos(focus)):point(root,vadd([0,0,0],cloud.offset||[0,0,0]));const lines=[];
 for(const c of cards.filter(x=>x.kind==='object'&&x.visible&&x.animScale!==0)){const target=point(root,rootPos(c)),ctrl=vadd(vmul(vadd(core,target),.5),[0,.18,.05]),curve=[];for(let i=0;i<=12;i++){const t=i/12,u=1-t;curve.push(vadd(vadd(vmul(core,u*u),vmul(ctrl,2*t*u)),vmul(target,t*t)));}for(let i=1;i<curve.length;i++)lines.push(curve[i-1],curve[i]);}
 if(lines.length)line(vp,lines,[.45,.91,.61,.22]);
 if(busy){const ring=[],t=performance.now()*.003;for(let i=0;i<50;i++){const a=i*TAU/50+t;ring.push(point(root,vadd(cloud.offset||[0,0,0],[Math.cos(a)*.45,.07+Math.sin(a)*.35,.04])));}line(vp,ring,[.64,1,.69,.85],true,5);}
 }
function drawImageInference(vp,t){
 if(!busy||!inferenceCard||!inferenceCard.visible)return;
 const age=(t-inferenceStarted)/1000,phase=t*.004,mode=uiSettings.processing||'spin',mat=cardModel(inferenceCard);
 const edge=u=>{const p=u%1,side=Math.floor(p*4),k=p*4-side;
  if(side===0)return [-.52+k*1.04,-.52,.045];
  if(side===1)return [.52,-.52+k*1.04,.045];
  if(side===2)return [.52-k*1.04,.52,.045];return [-.52,.52-k*1.04,.045];};
 if(mode==='glow'){
  const pulse=.45+.55*Math.sin(phase*1.6)**2;
  for(let layer=0;layer<3;layer++){
   const spread=layer*.020,pts=[];
   const poly=[[-.5-spread,-.5-spread,.04],[.5+spread,-.5-spread,.04],[.5+spread,.5+spread,.04],[-.5-spread,.5+spread,.04]];
   for(let i=0;i<4;i++){pts.push(point(mat,poly[i]),point(mat,poly[(i+1)%4]));}
   line(vp,pts,[.6+layer*.1,.82+layer*.06,.58,Math.max(.12,.88-layer*.22)*pulse]);
  }
 }else if(mode==='gradient'){
  for(let band=0;band<4;band++){const verts=[];for(let i=0;i<16;i++){
   const u=(i+band*16)/64+(phase*.017)%1;verts.push(point(mat,edge(u)),point(mat,edge(u+1/64)));}
   line(vp,verts,[[.5,.95,.78,.64],[.78,.86,1,.67],[1,.54,.75,.75],[.99,.91,.59,.62]][band]);}
 }else if(mode.startsWith('particles')){
  const level=Number(mode.slice(-1)),pts=[],rays=[];
  for(let i=0;i<Math.min(96,32+level*20);i++){
   const seed=i*2.3999632297,tick=phase*(.4+level*.12),angle=seed+tick;
   const rr=level===1?.27+.3*((i%13)/13):level===2?.42+.14*Math.sin(tick*2+i):.17+.42*Math.sin(tick*.65+i*.38)**2;
   const x=Math.cos(angle)*rr,y=Math.sin(angle)*rr,z=.035+Math.sin(tick+i)*.065;
   pts.push(point(mat,[x,y,z]));if(level===3&&i%4===0)rays.push(point(mat,[x*.69,y*.69,z-.02]),point(mat,[x,y,z]));
  }
  line(vp,pts,level===3?[1,.72,.48,.87]:level===2?[.55,.92,1,.76]:[.8,1,.67,.75],true,3+level);
  if(rays.length)line(vp,rays,[1,.75,.48,.38]);
 }else{
  const points=[],rays=[];for(let i=0;i<64;i++){
   const a=i*TAU/64+phase,r=.64+.07*Math.sin(age*3+i*.4),w=Math.sin(a)*r,h=Math.cos(a)*r;
   const p=point(mat,[w,h,.045+.025*Math.sin(phase+i)]);points.push(p);
   if(i%5===0)rays.push(point(mat,[w*.78,h*.78,.04]),p);
  }line(vp,points,[.85,1,.71,.86],true,5+Math.sin(phase*3)*2);line(vp,rays,[.58,1,.76,.22]);
 }
}
function highlightCards(vp,t){for(const c of cards){if(!c.visible||!(c.highlightUntil>t))continue;
 const m=cardModel(c),vertices=[[-.54,-.54,0],[.54,-.54,0],[.54,.54,0],[-.54,.54,0]].map(p=>point(m,p));line(vp,vertices,[.65,1,.75,.8],true,5);}}
function launchMascotSparks(pos,t){
 for(let i=0;i<24;i++){const theta=Math.random()*TAU,u=Math.random()*2-1,r=Math.sqrt(1-u*u),speed=.35+Math.random()*.95;
  particles.push({world:true,warm:true,p:[...pos],v:[Math.cos(theta)*r*speed,u*speed,Math.sin(theta)*r*speed],born:t,ttl:520+Math.random()*450});
 }
}
function sparkles(vp,t){const cool=[],warm=[],trailBright=[],trailDim=[];particles=particles.filter(p=>t-p.born<p.ttl);
 for(const p of particles){const u=clamp((t-p.born)/1000,0,2),loc=vadd(p.p,vmul(p.v,u));
  (p.trail?(t-p.born>p.ttl*.56?trailDim:trailBright):p.warm?warm:cool).push(p.world?loc:point(root,loc));}
 if(cool.length)line(vp,cool,[.75,1,.78,.66],true,4);
 if(warm.length)line(vp,warm,[1,.54,.13,.95],true,7);
 if(trailBright.length)line(vp,trailBright,[.79,.99,.91,.65],true,4);
 if(trailDim.length)line(vp,trailDim,[.63,.86,1,.18],true,2);
}
function place(pose){root=viewerAnchor(pose,-.04,1.45);rootYaw=yawFromMatrix(pose.transform.matrix);poseReady=true;
 if(!toolbar){menuYaw=cameraYaw(pose);const h=pose.transform.matrix,world=point(h,[0,0,0]),off=point(rotateY(cameraYaw(pose)),followOffset,0);toolbar={id:'toolbar',kind:'toolbar',size:[.67,.135],pos:vadd(world,off),q:quatY(cameraYaw(pose)),scale:1,visible:true,front:toolbarTexture('main'),back:null,resources:[]};toolbar.back=toolbar.front;toolbar.resources=[toolbar.front];}
 if(!captureEye){eyeResource=eyeTexture();captureEye={id:'captureeye',kind:'captureeye',size:[.099,.099],pos:point(poseForwardAnchor(pose,1.02,-.305),[0,0,0]),q:quatY(cameraYaw(pose)),scale:1,visible:true,front:eyeResource.tex,back:eyeResource.tex,resources:[eyeResource.tex]};paintEye(performance.now());}
 if(!voiceButton)voiceButton=makeRoundel('voice-roundel','voiceroundel',.089);
 if(!extractButton)extractButton=makeRoundel('extract-roundel','extractroundel',.089);
 if(!cameraHint){const tex=cameraHintTexture('off');cameraHint={id:'camera-hint',kind:'status',size:[.47,.071],pos:[0,0,0],q:[0,0,0,1],scale:1,visible:true,front:tex,back:tex,resources:[tex]};cameraHintState='off';}
 syncRoundels(pose);

 // No persistent folder/bin/mix drop targets or third-level navigation.
 setStatus('CAMERA OFF · press the closed eye to enable, then press again to capture',11500);}
function toggleFollow(){if(!toolbar)return;
 followMode=!followMode;
 if(followMode&&latestPose){const h=latestPose.transform.matrix,yaw=cameraYaw(latestPose);const delta=vsub(toolbar.pos,[h[12],h[13],h[14]]);followOffset=point(rotateY(-yaw),delta,0);}
 if(!followMode)menuYaw=Math.atan2(quatMatrix(toolbar.q)[8],quatMatrix(toolbar.q)[10]);
 refreshToolbar();cue('pin');setStatus(followMode?'FOLLOW · smooth tracking':'PINNED · fixed room position and orientation',5500);}

function ray(frame,src){try{const sp=src.targetRaySpace?frame.getPose(src.targetRaySpace,refSpace):null;if(sp){const m=sp.transform.matrix;return {o:[m[12],m[13],m[14]],d:norm([-m[8],-m[9],-m[10]])};}
 if(src.hand){const a=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace),b=frame.getJointPose(src.hand.get('wrist'),refSpace);if(a&&b){const o=[a.transform.position.x,a.transform.position.y,a.transform.position.z];const w=[b.transform.position.x,b.transform.position.y,b.transform.position.z];return {o,d:norm(vsub(o,w))};}}
 }catch{}return null;}
function hitTest(r,c){if(!r||!c.visible||!c.front||c.animScale===0)return null;const m=cardModel(c),inv=inverse(m);if(!inv)return null;const o=point(inv,r.o),d=point(inv,r.d,0);if(Math.abs(d[2])<1e-6)return null;const k=-o[2]/d[2];if(k<=0||k>6)return null;const x=o[0]+d[0]*k,y=o[1]+d[1]*k;if(Math.abs(x)>.5||Math.abs(y)>.5)return null;const hitWorld=point(m,[x,y,0]);const dist=length(vsub(hitWorld,r.o));return {card:c,x,y,dist};}
function pick(r){if(darkroom){const hits=[darkClose,darkPrevious,darkNext].filter(Boolean).map(c=>hitTest(r,c)).filter(Boolean).sort((a,b)=>a.dist-b.dist);return hits[0]||null;}const opts=[...cards,toolbar,...(voicePhase==='listening'||voicePhase==='processing'?[]:[captureEye]),...(voicePhase==='listening'||voicePhase==='processing'?[]:[extractButton]),...(uiSettings.voice===false?[]:[voiceButton]),voiceOk,voiceCancel,promptPanel,editbar,...(debugShowing?[debugPanel]:[]),descriptionPanel,...(configShowing?[configPanel]:[])].filter(Boolean),all=opts.map(c=>hitTest(r,c)).filter(Boolean).sort((a,b)=>a.dist-b.dist);return all[0]||null;}
function imageButtonAt(card,x,y){
 // Hit regions are in the SAME 600-pixel canvas coordinates as cardTexture.
 // Image aspect ratios change canvas height; fixed normalized-Y thresholds do not work.
 if(!card||!['source','object'].includes(card.kind))return null;
 const px=(x+.5)*600,py=(.5-y)*(card.canvasHeight||420);
 if(py>(card.canvasHeight||420)-105&&px>490&&px<585)return 'darkroom';
 if(py<21||py>93)return null; // generous 9px tolerance for Quest hand-point rays
 if(card.kind==='source'&&px>=27&&px<=225)return 'extract';
 if(px>=442&&px<=512)return 'imagemenu';
 if(px>=510&&px<=582)return 'imageclose';
 return null;
}
function buttonFromHit(h){if(!h)return null;
 if(h.card.kind==='description'){
  if(h.x>.33&&h.y>.27)return 'descriptionclose';
  if(h.y<-.26&&h.x<-.19)return h.card.retryable?'descriptionretry':'descriptionask';
  if(h.y<-.26&&h.x<.09)return uiSettings.voice!==false?'descriptionvoice':null;
  return null;
 }
 if(h.card.kind==='diagnostics'&&h.y>.38){if(h.x>.36)return 'debugclose';if(h.x>.23)return 'debuglarger';if(h.x>.11)return 'debugsmaller';return null;}
 if(h.card.kind==='darkroomexit')return 'darkroomexit';if(h.card.kind==='cinemaprev')return 'cinemaprev';if(h.card.kind==='cinemanext')return 'cinemanext';
 if(h.card.kind==='captureeye')return voicePhase==='listening'||voicePhase==='processing'?null:'capture';
 if(h.card.kind==='voiceroundel')return uiSettings.voice!==false?'voice':null;
 if(h.card.kind==='extractroundel')return 'extract';
 if(h.card.kind==='voiceok')return 'confirmvoice';
 if(h.card.kind==='voicecancel')return 'cancelvoice';
 if(h.card.kind==='config')return configHit(h);
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
 attach:!id&&['source','object'].includes(h.card.kind)?attachGrab(frame,src,h.card,h):null};
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
 else if(h.card.kind==='diagnostics'){setStatus('LOG positioned in space',2900);}
 else if(h.card.kind==='config'){/* the panel remains at the released world position */}
 else if(h.card.kind==='gallery'){await showCloud(h.card.data.id);}
 else if(h.card.kind==='gallerynav'){await openGallery(galleryPage+h.card.data.direction);}
 else if(h.card.kind==='ancestor'){await showCloud(cloud.id,h.card.data.id??null,0);}
 else if(h.card.kind==='branchpage'){await flipBranchPage(h.card.data.direction);}
 else if(h.card.kind==='branchback'){await upBranch();}
 else if(h.card.kind==='bincloud'){try{await window.FreeLab.updateXRCloud(h.card.data.id,{hidden:false});await openBin();setStatus('Capture restored · open it from LIB');}catch(e){setStatus('Restore failed: '+e.message);}}
 else if(h.card.kind==='binitem'){try{await window.FreeLab.updateXRObject(h.card.data.id,{shelf:'collection'});await openBin();setStatus('Object restored from Bin');}catch(e){setStatus(e.message);}}
}
function spatialData(c){return {x:+c.pos[0].toFixed(3),y:+c.pos[1].toFixed(3),z:+c.pos[2].toFixed(3),scale:+c.scale.toFixed(3),rotation:+c.rot.toFixed(3),qx:+(c.q||[0,0,0,1])[0].toFixed(5),qy:+(c.q||[0,0,0,1])[1].toFixed(5),qz:+(c.q||[0,0,0,1])[2].toFixed(5),qw:+(c.q||[0,0,0,1])[3].toFixed(5)};}
function updateEditbar(){
 if(editbar?.front&&gl)gl.deleteTexture(editbar.front);
 editbar=null;
 if(imageMenuOpen&&selected&&['object','source'].includes(selected.kind)&&gl){const tex=toolbarTexture('context');
  const rows=meshConfirm?2:imageTools().length;
  editbar={id:'context-actions',kind:'contextbar',parentCard:selected,size:[.2925,rows*.068],pos:[0,0,0],scale:1,q:[0,0,0,1],visible:true,front:tex,back:tex,resources:[tex]};}
 refreshToolbar();}
function closeImageMenu(){imageMenuOpen=false;meshConfirm=null;updateEditbar();}
function toggleImageMenu(card){if(selected===card&&imageMenuOpen){closeImageMenu();return;}
 selected=card;imageMenuOpen=true;meshConfirm=null;updateEditbar();cue('pin');}

function advanceGrab(frame){
 if(!held||held.id)return;const r=ray(frame,held.src);if(!r)return;
 const card=held.card;
 if(['source','object'].includes(card.kind)&&held.attach){
  // Keep the original ray contact point fixed while moving; the image itself
  // remains upright and perpendicular to the user's view, like Quest windows.
  const attached=held.attach;
  const contact=vadd(r.o,vmul(r.d,attached.startDistance));
  const center=vadd(contact,attached.worldOffset);
  const invRoot=inverse(root);if(!invRoot)return;
  const localCenter=point(invRoot,center);
  if(card.kind==='source'&&cloud)cloud.offset=vsub(localCenter,card.pos);
  else card.pos=vsub(localCenter,cloud?.offset||[0,0,0]);
  if(latestPose)card.q=facingQuat(center,[latestPose.transform.matrix[12],latestPose.transform.matrix[13],latestPose.transform.matrix[14]]);
  if(length(vsub(center,held.worldStart||center))>.006)held.moved=true;
  if(card.kind==='object'&&held.second){const a=posePosition(frame,held.src),b=posePosition(frame,held.second.src);
   if(a&&b&&held.second.firstDist>.04){card.scale=clamp(held.second.startScale*length(vsub(a,b))/held.second.firstDist,.45,3);held.moved=true;}}
  return;
 }
 if(card.kind==='toolbar'||card.kind==='diagnostics'||card.kind==='config'){
  const next=vadd(r.o,vmul(r.d,held.rayDist));if(!held.anchor){held.anchor=next;return;}
  const delta=vsub(next,held.anchor);
  if(length(delta)>.008||held.moved){held.moved=true;card.pos=vadd(card.pos,delta);
   if(card.kind==='toolbar'&&followMode&&latestPose){const h=latestPose.transform.matrix,yaw=cameraYaw(latestPose);
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
 if(src.handedness==='left'||src.handedness==='right'){hands[src.handedness]=j;if(j.wrist)handGesturePositions[src.handedness]=j.wrist;}
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
 if(gesture==='Open palm'||gesture==='Fist'||gesture==='Forward'){
  mascotReaction=gesture==='Open palm'?'approach':'escape';mascotReactionUntil=t+3000;
  mascotReactionTarget=handGesturePositions[side]||null;
 }
 window.FreeLab?.traceEvent?.('XR gesture '+side+': '+gesture,'info');
 const funny={'Thumbs up':'Tiny scientist approves!','Thumbs down':'Oof. Tough review.','OK':'All okay, captain.','Heart':'Even a lab needs love.',
  'Forward':'Forward, explorer!','Point':'I see your point.','Fist':'Imaginary fist bump!','Open palm':'High five!'};
 mascotSay(gesture);
 // Audio speaks from the mascot's reaction, not from a giant flashing eye-level banner.
 if(window.FreeLab?.pref?.('spoken'))window.FreeLab.speakUpdate?.(window.FreeLab?.pref?.('troll')?(funny[gesture]||gesture):gesture);
}
function mascotSpeechTexture(message){
 const [c,ctx]=canvas2d(760,220);ctx.clearRect(0,0,c.width,c.height);
 // Legible speech bubble with a quiet tail toward the mascot.
 rrect(ctx,12,10,736,164,40,'rgba(26,44,35,.96)');
 ctx.beginPath();ctx.moveTo(350,164);ctx.lineTo(380,205);ctx.lineTo(410,164);ctx.fillStyle='rgba(26,44,35,.96)';ctx.fill();
 const words=String(message||'').slice(0,125).split(/\s+/);const rows=[];let row='';
 ctx.font='650 48px system-ui';for(const word of words){const next=row?row+' '+word:word;
  if(ctx.measureText(next).width>666&&row){rows.push(row);row=word;}else row=next;}
 if(row)rows.push(row);ctx.fillStyle='#e6ffea';ctx.textAlign='center';ctx.textBaseline='middle';
 for(let i=0;i<Math.min(3,rows.length);i++)ctx.fillText(rows[i],380,52+i*48);
 return texture(c);
}
function mascotSay(message,ms=3600){
 if(mascotSpeech?.front&&gl)gl.deleteTexture(mascotSpeech.front);
 mascotSpeech=null;mascotSpeechBorn=performance.now();mascotSpeechUntil=mascotSpeechBorn+ms;
 if(mascotMode()==='none'||!gl)return;
 const tex=mascotSpeechTexture(message);
 mascotSpeech={id:'mascot-speech',kind:'pointer-mascot',size:[.45,.13],pos:[0,0,0],q:[0,0,0,1],scale:1,alpha:0,visible:true,front:tex,back:tex};
}
function tickMascotSpeech(t){
 if(!mascotSpeech)return;
 if(t>mascotSpeechUntil||!mascotPointer?.visible||mascotMode()==='none'){
  if(mascotSpeech.front)gl.deleteTexture(mascotSpeech.front);mascotSpeech=null;return;
 }
 const yaw=cameraYaw(latestPose);
 const fadeIn=250,fadeOut=520;
 const opening=clamp((t-mascotSpeechBorn)/fadeIn,0,1),closing=clamp((mascotSpeechUntil-t)/fadeOut,0,1);
 const eased=opening*opening*(3-2*opening);
 mascotSpeech.alpha=Math.min(eased,closing);
 mascotSpeech.scale=.87+.13*eased;
 mascotSpeech.pos=vadd(mascotPointer.pos,point(rotateY(yaw),[0,.225,.035],0));
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
 try {renderView(t,frame);}catch(e){console.error('FREELAB XR render error:',e);window.FreeLab?.traceEvent?.('XR renderer: '+(e?.message||String(e)),'error');
 // Do not destroy the entire immersive session for one bad visual. Release any held interaction.
 held=null;frameTouch=null;frameErase=null;try{session?.requestAnimationFrame(updateView);}catch{}}

}
function updateMascot(frame,t){const mode=mascotMode();if(mode==='none'){if(mascotPointer)mascotPointer.visible=false;return;}
 if(!session)return;const dt=Math.min(.04,Math.max(0,(t-(lastMascotTick||t))/1000));lastMascotTick=t;
 let rayOne=null;for(const src of session.inputSources){rayOne=ray(frame,src);if(rayOne)break;}
 const beams=[];for(const src of session.inputSources){const r=ray(frame,src);if(r)beams.push(r);}
 if(beams.length>=2&&mascotPointer?.pos&&t-mascotRayPokeAt>2300){
  const touches=beams.filter(r=>{const u=vmul(r.d,Math.max(0,Math.min(3,vsub(mascotPointer.pos,r.o).reduce((v,x,i)=>v+x*r.d[i],0))));return length(vsub(mascotPointer.pos,vadd(r.o,u)))<.16;});
  if(touches.length>=2){mascotReaction='escape';mascotReactionUntil=t+3200;mascotReactionTarget=beams[0].o;mascotRayPokeAt=t;mascotEmotion('surprised',2600);mascotSay('Hey! That tickles!',2300);window.FreeLabSound?.play('squeak');}
 }
 if(!mascotPointer){const tex=mode==='2d'?mascotTexture():null;
  mascotPointer={id:'pointer-mascot',kind:'pointer-mascot',size:[.125,.16],pos:[0,0,0],q:[0,0,0,1],scale:1,visible:true,front:tex,back:tex};}
 const h=rayOne?pick(rayOne):null;
 const previous=[...mascotPointer.pos];
 if(mascotReaction&&t<mascotReactionUntil&&mascotReactionTarget){
  const target=mascotReaction==='approach'?vadd(mascotReactionTarget,[0,.13,0]):vadd(mascotPointer.pos,vmul(norm(vsub(mascotPointer.pos,mascotReactionTarget)),.65));
  mascotPointer.pos=blend(mascotPointer.pos,target,1-Math.exp(-dt*(mascotReaction==='approach'?1.25:2.8)));
 }else if(rayOne){const hit=vadd(rayOne.o,vmul(rayOne.d,Math.max(.20,(h?.dist||1.20)-.03)));
  // Spiralling flight with lag and a gentle side-offset from the controller's hit.
  const offset=point(rotateY(cameraYaw(latestPose)),[.10,.075,0],0);
  const orbit=[Math.sin(t*.00042)*.068,Math.cos(t*.00057)*.048,Math.sin(t*.00036)*.059];
  const dest=vadd(hit,vadd(offset,orbit));
  mascotPointer.pos=blend(mascotPointer.pos,dest,1-Math.exp(-dt*1.05));
 }else{
  // Elastic idle bounce in a small virtual volume; not a claim of real-wall collision.
  const m=mascotPointer;const home=latestPose?point(poseForwardAnchor(latestPose,1.15,-.18),[0,0,0]):[0,1.1,-1.2];
  for(let i=0;i<3;i++){m.pos[i]+=mascotVelocity[i]*dt;const bound=i===1?.22:.50;
   if(m.pos[i]>home[i]+bound){m.pos[i]=home[i]+bound;mascotVelocity[i]=-Math.abs(mascotVelocity[i]);}
   if(m.pos[i]<home[i]-bound){m.pos[i]=home[i]-bound;mascotVelocity[i]=Math.abs(mascotVelocity[i]);}}
 }
 // The creature banks into travel and pitches toward the direction of flight.
 // When nearly stationary it returns to looking toward the viewer.
 const travel=dt>0?vsub(mascotPointer.pos,previous):[0,0,0];
 const velocity=vmul(travel,1/Math.max(dt,.001));
 const flight=length(velocity),yaw=cameraYaw(latestPose);
 // A few short-lived particles follow REAL displacement, never emit while hovering still.
 // During escape the local cross-plane rotates, tracing a corkscrew wake.
 if(flight>.09&&t-mascotTrailAt>48&&particles.length<170){
  mascotTrailAt=t;const direction=norm(velocity),axis=norm(Math.abs(direction[1])>.86?[1,0,0]:[0,1,0]);
  const cross=norm([direction[1]*axis[2]-direction[2]*axis[1],direction[2]*axis[0]-direction[0]*axis[2],direction[0]*axis[1]-direction[1]*axis[0]]);
  const other=norm([direction[1]*cross[2]-direction[2]*cross[1],direction[2]*cross[0]-direction[0]*cross[2],direction[0]*cross[1]-direction[1]*cross[0]]);
  const escape=mascotReaction==='escape'&&t<mascotReactionUntil;
  for(let j=0;j<(escape?3:2);j++){
   const phi=t*.022+j*TAU/3,rad=escape?.038:.012;
   const spiral=vadd(vmul(cross,Math.cos(phi)*rad),vmul(other,Math.sin(phi)*rad));
   const pos=vadd(vsub(mascotPointer.pos,vmul(direction,.09)),spiral);
   particles.push({world:true,trail:true,p:pos,v:vadd(vmul(direction,-.045),vmul(spiral,escape?1.5:.5)),born:t,ttl:470+Math.random()*440});
  }
 }

 // The character's longitudinal head-to-feet axis is local +Y. Aim the HEAD
 // along the travel vector, like a small animal swimming through the air.
 // When almost still, settle back upright and face the wearer.
 const targetQ=flight>.030?quatFromTo([0,1,0],norm(velocity)):quatY(yaw);
 mascotPointer.flightQ=quatSlerp(mascotPointer.flightQ||quatY(yaw),targetQ,1-Math.exp(-dt*2.3));
 mascotPointer.q=quatY(yaw);mascotPointer.visible=true;
 if(t-lastMascotQuip>47000&&uiSettings.voice!==false&&window.FreeLab?.pref?.('spoken')&&!busy&&voicePhase==='idle'){
  lastMascotQuip=t;const phrases=['I am orbiting your imagination.','New things to discover!','Even pixels need a little company.'];
  const msg=phrases[Math.floor(t/47000)%phrases.length];mascotSay(msg,3400);window.FreeLab?.speakUpdate?.(msg);window.FreeLabSound?.play('squeak');
 }

 if(t>mascotMoodUntil){mascotMood=(Math.floor(t/34000)%5===4)?'sleepy':'curious';}
}

function renderView(t,frame){const pose=frame.getViewerPose(refSpace);if(!pose){session.requestAnimationFrame(updateView);return;}latestPose=pose;if(!poseReady)place(pose);if(darkroom){renderCinema(frame,pose);session.requestAnimationFrame(updateView);return;}syncTrackedUI(pose,t);
 if(window.FreeLabRooms){const m=pose.transform.matrix;
 const liveCards=cards.filter(c=>['source','object'].includes(c.kind)&&c.data?.id>0&&c.visible!==false).slice(0,72).map(c=>({kind:c.kind==='source'?'capture':'object',id:c.data.id,p:point(root,rootPos(c)).map(x=>Math.round(x*1000)/1000)}));
 window.FreeLabRooms.publish([m[12],m[13],m[14]],liveCards);
 }
 poll3d(t);pollLabSelector(frame,t,pose);pollStringLab(frame,t);pollFingerLab(frame,t);pollFrameLab(frame,t);pollPlacedFrameTouch(frame,t);pollFrameGames(t,pose);advanceGrab(frame);for(const src of session.inputSources)pinchPoll(frame,src);pollGestures(frame,t);tween(t);faceCloudCards(pose,t);updateMascot(frame,t);tickMascotSpeech(t);tickVoiceIndicator(t,pose);typeStatus(t);updateMicVisual(t);updateDebugCard(t);if(captureEye&&t-lastEyeUpdate>67){if(eyeState!=='idle'&&t>eyeUntil)eyeState='idle';paintEye(t);lastEyeUpdate=t;}if(cameraHint&&t-lastHintCheck>180){lastHintCheck=t;const label=cameraHintMode();if(label!==cameraHintState){cameraHintState=label;cameraHintUntil=t+(label==='off'||label==='ready'?10000:7000);gl.deleteTexture(cameraHint.front);cameraHint.front=cameraHintTexture(label);cameraHint.back=cameraHint.front;cameraHint.resources=[cameraHint.front];}cameraHint.visible=t<cameraHintUntil&&voicePhase!=='listening'&&voicePhase!=='processing';}if(t-lastUi>150){updateHover(frame);lastUi=t;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 for(const view of pose.views){const vp0=session.renderState.baseLayer.getViewport(view);gl.viewport(vp0.x,vp0.y,vp0.width,vp0.height);const vp=matmul(view.projectionMatrix,view.transform.inverse.matrix);
 decoration(vp);for(const c of cards)drawCard(c,vp);if(toolbar)drawCard(toolbar,vp);if(statusCard?.visible)drawCard(statusCard,vp);if(editbar)drawCard(editbar,vp);if(captureEye&&voicePhase!=='listening'&&voicePhase!=='processing')drawCard(captureEye,vp);if(cameraHint)drawCard(cameraHint,vp);if(voiceButton&&uiSettings.voice!==false)drawCard(voiceButton,vp);if(extractButton?.visible)drawCard(extractButton,vp);if(voiceOk)drawCard(voiceOk,vp);if(voiceCancel)drawCard(voiceCancel,vp);if(promptPanel)drawCard(promptPanel,vp);if(debugShowing&&debugPanel)drawCard(debugPanel,vp);if(configShowing&&configPanel)drawCard(configPanel,vp);/* description is composited after mascot for legibility */for(const m of meshPreviews)drawMeshPreview(m,vp,t);if(voiceBadge)drawCard(voiceBadge,vp);sparkles(vp,t);drawImageInference(vp,t);highlightCards(vp,t);drawHands(frame,vp);drawStringLab(vp,t,pose);drawFingerLab(vp,t,pose);drawSpatialFrames(vp,t,pose);drawShapeTargets(vp,t,pose);drawFrameCubes(vp);if(labMenu?.visible)drawCard(labMenu,vp);depthCapability(frame,view);
 for(const src of session.inputSources){const r=ray(frame,src);if(!r)continue;const h=pick(r),end=vadd(r.o,vmul(r.d,h?.dist||1.2));const colour=src.hand?[.72,1,.75,.7]:[.77,.88,1,.72];line(vp,[r.o,end],colour);line(vp,[end],colour,true,h?16:9);}
 if(mascotPointer?.visible){if(mascotMode()==='2d'){
   if(!mascotPointer.front){mascotTex=mascotTexture();mascotPointer.front=mascotTex;mascotPointer.back=mascotTex;}
   drawCard(mascotPointer,vp);
   if(t<mascotHitUntil){
    if(!mascotImpactSprite){const [c,ctx]=canvas2d(192,192),g=ctx.createRadialGradient(96,96,4,96,96,95);
     g.addColorStop(0,'rgba(255,178,42,.34)');g.addColorStop(.63,'rgba(255,90,0,.29)');g.addColorStop(1,'rgba(255,85,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,192,192);mascotImpactSprite=texture(c);}
    const facing=norm(vsub([latestPose.transform.matrix[12],latestPose.transform.matrix[13],latestPose.transform.matrix[14]],mascotPointer.pos));
    const halo={...mascotPointer,id:'mascot-impact',size:[.21,.25],pos:vadd(mascotPointer.pos,vmul(facing,.012)),alpha:clamp((mascotHitUntil-t)/1000,0,1),front:mascotImpactSprite,back:mascotImpactSprite};
    drawCard(halo,vp);
   }
  }else drawMascot3D(vp,t);}
 if(mascotSpeech)drawCard(mascotSpeech,vp);
 if(descriptionPanel){gl.disable(gl.DEPTH_TEST);drawCard(descriptionPanel,vp);gl.enable(gl.DEPTH_TEST);}

 }session.requestAnimationFrame(updateView);}
function ringPosition(i,n){
 // Upper fan, never a full ring behind the photograph. Positive Z faces the user.
 const perRow=Math.min(5,Math.max(1,n)),row=Math.floor(i/perRow),col=i%perRow;
 const count=Math.min(perRow,n-row*perRow),x=(col-(count-1)/2)*.43;
 const src=cards.find(c=>c.kind==='source');const sourceHalf=(src?.size?.[1]||.63)*.5;
 return [x,sourceHalf+.24+row*.45+.09*Math.abs(x),.18+row*.055];
}
function facingQuat(pos,viewer){
 const dx=viewer[0]-pos[0],dz=viewer[2]-pos[2];
 return quatMul(quatY(-rootYaw),lookingQuat(pos,viewer));
}
function faceCloudCards(pose,t){
 const h=pose.transform.matrix,viewer=[h[12],h[13],h[14]];
 const dt=Math.min(.08,Math.max(0,(t-lastFrame||16)/1000)),alpha=1-Math.exp(-dt*4.5);
 for(const card of cards){if(!['object','source'].includes(card.kind)||card===held?.card||!card.visible)continue;
  const center=point(root,rootPos(card));const desired=quatMul(quatY(-rootYaw),lookingQuat(center,viewer));
  card.q=quatSlerp(card.q||[0,0,0,1],desired,alpha);
 }
}
function sourceCard(data){return addCard('source','source',{label:data.legacy?'LEGACY ARCHIVE':'CAPTURE  '+String(data.id).padStart(2,'0'),subtitle:data.legacy?'OLDER SAVED OBJECTS · NOT A ROOM FRAME':'SOURCE FRAME  ·  PRIVATE',image:data.image||data.image_url,description:'Captured real pixels, not the WebXR passthrough compositor'},[0,.07,0],[.88,.63]);}
function activeBranchView(){return window.FreeLabCloudTree.view(cloud?.objects||[],branchFocusId,branchPage);}
function branchNavigation(view){
 for(let i=cards.length-1;i>=0;i--)if(['branchpage','branchback'].includes(cards[i].kind)){
  const card=cards.splice(i,1)[0];for(const t of card.resources||[])gl?.deleteTexture(t);
 }
 // Never manufacture a black "PARENT" image. Ancestor thumbnails are the navigation.
 if(view.page>0){const c=addCard('branchprev','branchpage',
  {label:'← PREVIOUS',subtitle:'PAGE '+view.page},[-.20,-.49,.19],[.19,.14]);c.data.direction=-1;c.animScale=1;}
 if(view.page<view.pages-1){const c=addCard('branchnext','branchpage',
  {label:'NEXT →',subtitle:'PAGE '+(view.page+2)},[.20,-.49,.19],[.19,.14]);c.data.direction=1;c.animScale=1;}
}
function addAncestors(tree,next){
 // Real archived image thumbnails recede from the current active generation.
 const chain=[{id:null,label:'CAPTURE '+next.id,image:next.image||next.image_url},...tree.chain.slice(0,-1).map(o=>({...o,image:o.has_image?'/api/objects/'+o.id+'/image':null}))];
 if(!chain.length)return;
 for(let i=Math.max(0,chain.length-5);i<chain.length;i++){
  const a=chain[i],back=chain.length-i;
  const card=addCard('ancestor-'+String(a.id??'source'), 'ancestor',{
    ...a,label:a.label||'CAPTURE',subtitle:'GENERATION '+(i===0?'0':i)+' · SELECT TO EXPLORE'},
    [-.76+(i-Math.max(0,chain.length-5))*.095,.18-(i-Math.max(0,chain.length-5))*.13,-.22-back*.135],[.20,.23]);
  card.scale=clamp(.83-back*.07,.50,.90);const dest=[...card.pos];card.pos=[-.12,.02,-.015];card.animScale=.8;animate(card,dest,Math.max(0,4-back)*42,640);
 }
}
async function showCloud(id,focusId=null,page=0){if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}closePrompt();const next=clouds.find(c=>c.id===id);if(!next){setStatus('Capture not found');return;}clearCards();mode='capture';cloud={...next,offset:['x','y','z'].map(k=>Number(next.spatial?.[k])||0)};
 const tree=window.FreeLabCloudTree.view(next.objects,focusId,page);
 branchFocusId=tree.focusId;branchPage=tree.page;
 if(next.hidden&&id>0){next.hidden=false;window.FreeLab.updateXRCloud(id,{hidden:false}).catch(()=>{});}
 const src=sourceCard(next);if(['qx','qy','qz','qw'].every(k=>typeof next.spatial?.[k]==='number'))src.q=quatNorm([next.spatial.qx,next.spatial.qy,next.spatial.qz,next.spatial.qw]);
 if(tree.focus){src.pos=[-.92,-.36,-.48];src.scale=.35;src.visible=false;}
 src.animScale=.08;animate(src,src.pos,0,560);
 if(tree.focus){addAncestors(tree,next);const focus=tree.focus;
   const focusCard=addCard('item'+focus.id,'object',{...focus,image:focus.has_image?'/api/objects/'+focus.id+'/image':null,
     subtitle:'GEN '+tree.chain.length+' · '+tree.totalChildren+' CHILDREN'},[-.13,.02,-.01],[.37,.40]);
   focusCard.scale=1.8;focusCard.animScale=.08;animate(focusCard,focusCard.pos,30,540);
 }
 tree.children.forEach((o,i)=>{const target=spatialLoc(o,i,tree.children.length),card=addCard('item'+o.id,'object',{
   ...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:o.operation==='image_edit'?'AI VARIATION · PRIVATE':o.provider==='sam-3.1-box'?'REFINED REGION · PRIVATE':'EXTRACTED · PRIVATE'},[0,.07,.09],[.3,.35]);card.pos=[0,.07,.09];card.animScale=.06;card.original=target;card.scale=clamp(o.spatial?.scale||1,.45,3);card.rot=o.spatial?.rotation||0;card.q=['qx','qy','qz','qw'].every(k=>typeof o.spatial?.[k]==='number')?quatNorm([o.spatial.qx,o.spatial.qy,o.spatial.qz,o.spatial.qw]):quatY(card.rot);animate(card,target,i*55,1050);});
 branchNavigation(tree);
 if(next.collapsed&&id>0){next.collapsed=false;window.FreeLab.updateXRCloud(id,{collapsed:false}).catch(()=>{});}
 selected=null;updateEditbar();setStatus(`TREE · ${next.objects.length} images · depth ${tree.chain.length} · ${tree.totalChildren} direct children · page ${tree.page+1}/${tree.pages}`,8500);
 // Reuse the saved JPEG for additional explicit Muse/SAM operations.
 if(id>0)await window.FreeLab.useXRFrame?.(next.image||next.image_url).catch(e=>setStatus(e.message));
}
async function openBranch(id){if(!cloud?.id)return;
 const node=cloud.objects.find(o=>o.id===id&&o.shelf!=='bin');if(!node)return setStatus('Branch not found');
 await showCloud(cloud.id,node.id,0);
 setStatus('BRANCH · '+node.label+' · select EXTRACT or REFINE to grow this tree',8200);
}
async function upBranch(){if(!cloud?.id||branchFocusId===null)return;
 const node=cloud.objects.find(o=>o.id===branchFocusId);
 await showCloud(cloud.id,node?.parent_object_id??null,0);
}
async function flipBranchPage(direction){if(!cloud?.id)return;
 const view=activeBranchView();const page=clamp(view.page+direction,0,view.pages-1);
 if(page!==view.page)await showCloud(cloud.id,branchFocusId,page);
}

function spatialLoc(o,i,n){const pos=ringPosition(i,n);if(o.spatial&&typeof o.spatial.x==='number')return [o.spatial.x,o.spatial.y,o.spatial.z];return pos;}
async function openGallery(page=galleryPage){if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}mode='gallery';selected=null;updateEditbar();clearCards();cloud=null;branchFocusId=null;branchPage=0;
 try{clouds=await window.FreeLab.listXRClouds();refreshToolbar();}catch(e){setStatus(e.message);return;}
 const available=clouds.filter(x=>!x.hidden);galleryPage=clamp(page,0,Math.max(0,Math.ceil(available.length/8)-1));const previews=available.slice(galleryPage*8,galleryPage*8+8);for(let i=0;i<previews.length;i++){const c=previews[i],col=i%4,row=Math.floor(i/4);addCard('gallery'+c.id,'gallery',{id:c.id,image:c.image_url,label:'CAPTURE '+c.id,subtitle:c.objects.length+' OBJECT(S)'},[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);}
 for(const direction of [-1,1]){if(direction<0&&galleryPage===0||direction>0&&(galleryPage+1)*8>=available.length)continue;
  addCard('gallerynav'+direction,'gallerynav',{direction,label:direction>0?'NEXT  →':'←  PREVIOUS',subtitle:'PAGE '+(galleryPage+1)+' OF '+Math.ceil(available.length/8)},[direction*.53,-.64,0],[.28,.18]);}
 setStatus(available.length?`LIBRARY · ${available.length} saved captures · page ${galleryPage+1}/${Math.ceil(available.length/8)}`:'No saved captures yet · press capture');}
async function binSource(){if(!selected||selected.kind!=='source'||!cloud?.id)return setStatus('Choose a source capture first');
 const id=cloud.id;try{await window.FreeLab.updateXRCloud(id,{hidden:true});cue('paper');
  setStatus('Capture stored in hidden Bin · reopen from BIN to restore',10000);
  const entry=clouds.find(c=>c.id===id);if(entry)entry.hidden=true;
  const destination=[0,.07,.01];cards.forEach((c,i)=>animate(c,destination,i*30,650,true));
  setTimeout(()=>{if(cloud?.id===id){clearCards();cloud=null;branchFocusId=null;branchPage=0;selected=null;updateEditbar();}},950);
 }catch(e){setStatus('Could not bin capture: '+e.message);}}
async function openBin(){mode='bin';selected=null;updateEditbar();clearCards();cloud=null;branchFocusId=null;branchPage=0;
 try{clouds=await window.FreeLab.listXRClouds();refreshToolbar();}catch(e){setStatus(e.message);return;}
 const hidden=clouds.filter(x=>x.hidden).slice(0,5);const binned=clouds.flatMap(x=>x.objects).filter(x=>x.shelf==='bin').slice(0,MAX_CLOUD-hidden.length);
 const sources=[...hidden.map(c=>({kind:'bincloud',data:{id:c.id,image:c.image_url,label:'HIDDEN CAPTURE '+c.id,subtitle:'SELECT TO RESTORE'}})),
  ...binned.map(o=>({kind:'binitem',data:{...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:'BIN  ·  SELECT TO RESTORE'}}))];
 sources.forEach((entry,i)=>{const col=i%4,row=Math.floor(i/4);addCard(entry.kind+entry.data.id,entry.kind,entry.data,[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);});
 setStatus(sources.length?`${sources.length} item(s) in Bin · select to restore`:'Bin is empty');}
async function makeCapture(){
 if(busy)return;
 busy=true;
 try{
  const state=window.FreeLab.getState();
  const track=state.stream?.getVideoTracks()?.[0];
  const cameraLive=liveCameraState();
  if(!cameraLive){
   setEyeState('activating',8000);
   setStatus('REQUESTING CAMERA · allow camera access in Quest Browser if prompted',9000);
   try{
    await window.FreeLab.enableXRCamera();
    setEyeState('ready',1200);cue('ready');
    setStatus('CAMERA ENABLED · pink eye means ready · press the eye again to CAPTURE',14000);
   }catch(e){
    setEyeState('error',1500);cue('error');
    window.FreeLab?.traceEvent?.('CAMERA PERMISSION FAILED · '+String(e.message||e),'error');
    setStatus('CAMERA FAILED: '+(e.message||e.name)+' · check LOG',16000);
   }
   return;
  }
  setEyeState('snapping',10000);
  setStatus('SAVING PHOTO · waiting for server confirmation',12000);
  try{
   // Exactly one source card is created and animated, after a confirmed save.
   // A rejected save leaves the previously visible scene unchanged.
   const item=await window.FreeLab.saveXRFrame();
   if(!Number.isInteger(item?.id)||item.id<=0)throw Error('Save response missing a valid capture ID');
   const data={...item,objects:[],hidden:false,collapsed:false,offset:[0,0,0]};
   // Decode before the one bloom so the image is stable from its first frame.
   // Keep the previous scene visible during asynchronous image decoding.
   let decoded=null;
   try{decoded=new Image();decoded.src=item.image;await decoded.decode();}catch{decoded=null;}
   // Commit only after server confirmation, with one uninterrupted bloom.
   if(latestPose){root=viewerAnchor(latestPose,-.03,1.42);rootYaw=cameraYaw(latestPose);}
   clearCards();cloud={...data,offset:[0,0,0]};clouds.unshift(data);refreshToolbar();branchFocusId=null;branchPage=0;mode='capture';
   const card=sourceCard({...data,decodedImage:decoded});
   card.animScale=.01;animate(card,card.pos,0,980);
   selected=null;updateEditbar();setEyeState('ready',1500);cue('ready');
   window.FreeLab?.traceEvent?.('CAPTURE #'+item.id+' SAVED · EXTRACT ENABLED','api');
   setStatus('CAPTURE '+item.id+' SAVED · EXTRACT NOW ACTIVE · source top-left or right roundel',12000);mascotSay('Nice capture!',2300);window.FreeLab?.speakUpdate?.('Photo saved. Ready to extract.');
  }catch(e){
   // Do not modify the current image or collection on failure.
   const reason=String(e.message||e);
   window.FreeLab?.traceEvent?.('CAPTURE SAVE FAILED · '+reason,'error');
   setEyeState('error',2500);cue('error');
   setStatus('SAVE FAILED: '+reason+' · check XR LOG',20000);
  }
 }catch(e){
  setEyeState('error',1500);cue('error');
  const reason=String(e.message||e);
  window.FreeLab?.traceEvent?.('CAPTURE FAILED · '+reason,'error');
  setStatus('CAPTURE FAILED: '+reason+' · check XR LOG',16000);
 }finally{busy=false;}
}

function bloomChildren(items,parent=null){if(!cloud||!items?.length)return;
 const original=parent||cards.find(c=>c.kind==='source');const origin=original?[...original.pos]:[0,0,0];
 const view=activeBranchView();
 const parentId=parent?.data?.id??null;
 if(parentId!==view.focusId)return; // Saved in the correct branch, open it to view children.
 const existing=cards.filter(c=>c.kind==='object'&&c.data?.id!==view.focusId).length;
 const permitted=new Set(view.children.map(o=>o.id));
 items.filter(o=>permitted.has(o.id)).forEach((o,i)=>{
  if(cards.some(c=>c.id==='item'+o.id))return;
  const target=parent?vadd(origin,[(i%3-1)*.38,.45+Math.floor(i/3)*.43,.18+.02*i]):spatialLoc(o,existing+i,Math.max(1,view.children.length));
  const card=addCard('item'+o.id,'object',{...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,
    subtitle:o.operation==='image_edit'?'AI VARIATION · PRIVATE':o.provider==='sam-3.1-box'?'SEGMENTED REGION · PRIVATE':'EXTRACTED OBJECT · PRIVATE'},origin,[.3,.35]);
  card.animScale=.04;card.original=target;animate(card,target,i*110,900);launchParticles(origin);
 });
}
async function runExtract(){if(!extractionAvailable())return setStatus('Capture a real photo first · if saving failed, check XR LOG',12000);if(busy)return setStatus('AI is working · wait for the current request');
 busy=true;inferenceCard=cards.find(c=>c.kind==='source');inferenceStarted=performance.now();
 setStatus('Extracting with Muse + SAM…',14000);
 try{const result=await window.FreeLab.recognizeXR(cloud.id,null,uiSettings.masked!==false);
  const found=result.items||[];if(!found.length)window.FreeLab?.traceEvent?.('Extract response contained no recognized object items','warn');cloud.objects=[...cloud.objects,...found];
  const persisted=clouds.find(x=>x.id===cloud.id);if(persisted)persisted.objects=cloud.objects;
  bloomChildren(found);if(found.length&&activeBranchView().pages>1)branchNavigation(activeBranchView());cue('bloom');mascotMood=found.length?'happy':'confused';mascotMoodUntil=performance.now()+3200;
  let quote=found.length?`Found ${found.length} objects`:'No objects found';
  if(found.length&&window.FreeLab?.pref?.('troll')){const jokes=['Your room has been officially inspected by a very small expert.','That is a surprisingly respectable collection of stuff.','Found objects! None of them offered me a snack.'];quote+=' . '+jokes[Math.floor(Math.random()*jokes.length)];}
  window.FreeLab?.speakUpdate?.(quote);setStatus(found.length?(result.crops?`${result.cutouts} cutouts · ${result.crops} crops`:`${result.cutouts} transparent cutouts saved`):'No clear objects found · check LOG',8500);
 }catch(e){setStatus('Extract failed · '+e.message,12000);}finally{busy=false;inferenceCard=null;}}
async function extractParts(){
 if(!cloud||cloud.legacy||busy||selected?.kind!=='object'||!selected.data?.id)
   return setStatus('Select an extracted image to analyze it again',11000);
 const parent=selected,id=parent.data.id;closeImageMenu();busy=true;inferenceCard=parent;inferenceStarted=performance.now();
 setStatus('Extracting parts with Muse + SAM…',16000);
 try{const result=await window.FreeLab.recognizeXR(cloud.id,id,uiSettings.masked!==false);
  const items=result.items||[];cloud.objects.push(...items);
  const existing=clouds.find(c=>c.id===cloud.id);if(existing)existing.objects=cloud.objects;
  await showCloud(cloud.id,id,window.FreeLabCloudTree.pageOfChild(cloud.objects,id,items[0]?.id));cue('bloom');
  window.FreeLab?.speakUpdate?.(`Found ${items.length} parts`);
  setStatus(items.length?(result.crops?`${result.cutouts} cutouts · ${result.crops} crops`:`${result.cutouts} cutouts saved`):'No additional identifiable parts',10000);
 }catch(e){setStatus('Extract parts failed · '+e.message,14000);window.FreeLab?.traceEvent?.('NESTED EXTRACTION FAILED · '+e.message,'error');}
 finally{busy=false;inferenceCard=null;}
}
async function runSam(){if(!cloud||busy||cloud.legacy)return setStatus('Capture and Extract a real photo first');
 const item=selected?.data;if(!item||selected.kind!=='object')return setStatus('Select an extracted object before refining its region');
 
 const noun=String(item.label||'').trim().toLowerCase().replace(/[^a-z0-9 -]/g,'').slice(0,58);
 if(noun.length<2)return setStatus('Select a concrete object');
 busy=true;setStatus('REFINING REGION · one billed segmentation',15000);
 try{const result=await window.FreeLab.segmentXR(cloud.id,noun,item.id,uiSettings.masked!==false);
   const items=result.items||[];cloud.objects.push(...items);
   const persisted=clouds.find(x=>x.id===cloud.id);if(persisted)persisted.objects=cloud.objects;
   bloomChildren(items,selected);setStatus(`${items.length} transparent cutouts saved`,9500);
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
 dismissVoice();cue('ready');if(descriptionQuestionMode&&descriptionContext){descriptionQuestionMode=false;return askDescription(transcript);}
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
 if(voicePhase==='listening')return finishVoiceRecording();
 if(busy||voicePhase==='processing')return;
 dismissVoice();
 try{if(!window.FreeLab?.micReady?.())await window.FreeLab.armMicrophone();
  voiceRecord=window.FreeLab.startWavPrompt();voiceRecordStarted=performance.now();
  setVoicePhase('listening','',Infinity);updateMicVisual(performance.now());cue('ready');
  setStatus('RECORDING · microphone is RED · press it again when finished (up to 90s)',11000);
 }catch(e){setVoicePhase('idle','',0);setStatus('Microphone unavailable · see LOG',9000);window.FreeLab?.traceEvent?.('MICROPHONE · '+e.message,'error');}
}
async function finishVoiceRecording(){
 if(!voiceRecord)return;const record=voiceRecord;voiceRecord=null;
 const target=currentPromptTarget();setVoicePhase('processing','·  ·  ·',45000);busy=true;
 setStatus('TRANSCRIBING SPEECH · your spatial scene remains open',12000);
 try{const wav=await record.stop();const recognized=String(await window.FreeLab.transcribeXR(wav)||'').trim();
  if(!recognized)throw Error('No recognizable speech');
  voicePending={text:recognized,context:target};setVoicePhase('heard',recognized,Infinity);mascotEmotion('happy');
  voiceOk=makeRoundel('voice-accept','voiceok',.080);refreshRoundel(voiceOk,'ok');
  voiceCancel=makeRoundel('voice-reject','voicecancel',.080);refreshRoundel(voiceCancel,'cancel');
  if(latestPose)syncRoundels(latestPose);setStatus('TRANSCRIPT READY · choose OK or × · no keyboard required',8500);
 }catch(e){setVoicePhase('idle','',0);const noSpeech=/no recognizable speech|no microphone samples/i.test(e.message||'');setStatus(noSpeech?'No speech':'Speech unavailable · see LOG',9000);if(!noSpeech)window.FreeLab?.traceEvent?.('VOICE · '+e.message,'error');}
 finally{busy=false;}
}
async function applyPrompt(){if(!promptContext)return openPrompt();if(busy)return;
 if(!promptText.trim())return setStatus('Speak or Type your instruction before Apply');
 const context=promptContext;busy=true;inferenceCard=context.card;inferenceStarted=performance.now();setStatus('GENERATING · original image stays in the room',24000);
 try{const o=await window.FreeLab.promptXR(context.captureId,context.objectId,promptText);
  if(cloud&&cloud.id===context.captureId){cloud.objects.push(o);
   const parentId=context.objectId??null;
   if(branchFocusId!==parentId||!activeBranchView().children.some(x=>x.id===o.id))
    await showCloud(cloud.id,parentId,window.FreeLabCloudTree.pageOfChild(cloud.objects,parentId,o.id));
   else bloomChildren([o],context.card);cue('bloom');}else{const destination=clouds.find(c=>c.id===context.captureId);if(destination)destination.objects.push(o);setStatus('Created image saved · open its source capture in LIB',9000);}
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
 cloud.collapsed=true;const libWorld=toolbar?point(cardModel(toolbar),[-.5+.5/tools.length,0,0]):point(root,vadd([0,0,0],cloud.offset||[0,0,0]));
 const inv=inverse(root);const local=inv?point(inv,libWorld):[0,-.38,0];const dest=vsub(local,cloud.offset||[0,0,0]);
 cards.forEach((c,i)=>{animate(c,dest,i*32,1020,true);});launchParticles(dest);cue('bloom');window.FreeLab?.speakUpdate?.('Stored in your library');
 if(cloud.id>0)window.FreeLab.updateXRCloud(cloud.id,{collapsed:true}).catch(e=>setStatus(e.message));setStatus('Saved in LIBRARY · reopen any time without inference charges',7500);
 setTimeout(()=>{if(cloud?.collapsed){clearCards();cloud=null;branchFocusId=null;branchPage=0;selected=null;updateEditbar();}},1350);}
async function submit3d(){if(!meshConfirm||busy)return;const target=meshConfirm;
 meshJobOrigin=target.origin;closeImageMenu();busy=true;setStatus('3D SUBMITTING · selected provider · one confirmed billable job',11000);
 try{const job=await window.FreeLab.createXR3D(target.captureId,target.objectId);meshyJob=job.id;pending3dJobs.push({id:job.id,provider:job.provider,origin:target.origin});meshyPollAt=0;
  meshConfirm=null;setStatus('3D QUEUED · '+job.provider.toUpperCase()+' job '+job.id+' · keep collecting while it generates; progress in LOG',14000);
 }catch(e){setStatus('3D generation failed · '+e.message,16000);}finally{busy=false;}}
function close3d(){meshConfirm=null;updateEditbar();}
function open3d(){if(!selected||!['source','object'].includes(selected.kind)||!cloud?.id)return setStatus('Select an image to generate a 3D model');
 closePrompt();meshConfirm={captureId:cloud.id,objectId:selected.kind==='object'?selected.data.id:null,label:selected.data.label,origin:point(root,rootPos(selected))};
 imageMenuOpen=true;updateEditbar();
 window.FreeLab?.get3DPreference?.().then(p=>{jobProvider=p.provider;setStatus('3D PROVIDER · '+p.provider.toUpperCase()+(p.available[p.provider]?' READY':' API NOT CONFIGURED')+' · confirm paid job or cancel',13000);}).catch(e=>setStatus('3D PROVIDER ERROR: '+e.message,13000));}


function meshNormals(a,b,c){const u=vsub(b,a),v=vsub(c,a);return norm([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);}
async function spawnMeshPreview(jobId,origin){
 if(meshPreviews.some(m=>m.jobId===jobId)||meshPreviewLoading)return;meshPreviewLoading=true;
 try{const result=await window.FreeLab.modelXRPreview(jobId);const coords=result.positions||[];if(coords.length%9||coords.length>35000)throw Error('Unsupported preview geometry');
  const values=[];for(let i=0;i<coords.length;i+=9){const a=coords.slice(i,i+3),b=coords.slice(i+3,i+6),c=coords.slice(i+6,i+9);const n=meshNormals(a,b,c);for(const v of [a,b,c])values.push(...v,...n);}
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
  const parent=origin||[latestPose.transform.matrix[12],latestPose.transform.matrix[13],latestPose.transform.matrix[14]-1];
  const position=vadd(parent,point(rotateY(cameraYaw(latestPose)),[.47,.05,.13],0));
  meshPreviews.push({jobId,buffer,count:values.length/6,pos:position,created:performance.now(),q:quatY(cameraYaw(latestPose))});
  setStatus('3D MODEL READY · simplified mesh floating in XR · textured GLB in LIBRARY',16000);cue('bloom');
 }catch(e){setStatus('3D READY · XR PREVIEW UNAVAILABLE: '+e.message+' · full GLB in LIBRARY',22000);}
 finally{meshPreviewLoading=false;}
}
function drawMeshPreview(mesh,vp,t){
 if(!mascotProgram||!mesh.buffer||!mesh.count)return;gl.useProgram(mascotProgram);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
 const pos=gl.getAttribLocation(mascotProgram,'aPos'),normal=gl.getAttribLocation(mascotProgram,'aNormal');
 gl.enableVertexAttribArray(pos);gl.enableVertexAttribArray(normal);
 gl.vertexAttribPointer(pos,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);
 const k=Math.min(1,(t-mesh.created)/1050),ease=k*k*(3-2*k);
 const model=matmul(translate(...mesh.pos),matmul(quatMatrix(mesh.q),scale(.64*ease,.64*ease,.64*ease)));
 gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uMVP'),false,matmul(vp,model));
 gl.uniformMatrix4fv(gl.getUniformLocation(mascotProgram,'uModel'),false,model);
 gl.uniform4fv(gl.getUniformLocation(mascotProgram,'uColor'),[.48,.92,.69,1]);
 gl.drawArrays(gl.TRIANGLES,0,mesh.count);
}
async function poll3d(t){if(!pending3dJobs.length||t-meshyPollAt<14000)return;meshyPollAt=t;
 const jobs=pending3dJobs.slice(0,2);
 for(const item of jobs){try{
  const job=await window.FreeLab.checkXR3D(item.id);
  if(job.status==='SUCCEEDED'){
   pending3dJobs=pending3dJobs.filter(j=>j.id!==item.id);
   setStatus(job.provider.toUpperCase()+' 3D READY · '+(job.glb_url?'GLB saved in LIBRARY':'checking provider outputs'),15000);
   if(job.glb_url)spawnMeshPreview(job.id,item.origin);
   else setStatus('3D READY · provider has not returned a GLB URL · see LIBRARY',18000);
  }else if(['FAILED','CANCELED'].includes(job.status)){
   pending3dJobs=pending3dJobs.filter(j=>j.id!==item.id);
   setStatus(job.provider.toUpperCase()+' 3D '+job.status+' · '+(job.error||'check provider account'),16000);
  }else setStatus(job.provider.toUpperCase()+' 3D '+job.status+' · '+job.progress+'% · job '+job.id,12000);
 }catch(e){window.FreeLab?.traceEvent?.('3D JOB '+item.id+': '+e.message,'warn');}}
}
function closeSelectedCard(){if(!selected)return;const c=selected;closeImageMenu();if(c.kind==='source')return collapse();
 animate(c,c.pos,0,320,true);selected=null;setStatus('Card hidden in XR · still saved privately');}
async function restoreSelected(){const target=currentPromptTarget();if(!target)return setStatus('Select an image first');
 promptContext=target;promptText='Restore this image with more detail and a higher resolution. Preserve the original subject, composition and identity; do not invent new objects.';
 closeImageMenu();setStatus('RESTORE · sending one paid image edit · original remains in the room',14000);
 return applyPrompt();}
function closeDarkroom(silent=false){
 if(darkroom?.ownedTexture&&darkroom.front)gl.deleteTexture(darkroom.front);
 if(darkFloor?.front)gl.deleteTexture(darkFloor.front);
 if(darkClose?.front)gl.deleteTexture(darkClose.front);
 for(const button of [darkPrevious,darkNext])if(button?.front)gl.deleteTexture(button.front);
 darkroom=null;darkBackdrop=null;darkClose=null;darkFloor=null;darkPrevious=null;darkNext=null;
 if(!silent){cinemaCards=[];cue('release');setStatus('Back in your room',2800);}
}
function cinemaExitTexture(){const [c,ctx]=canvas2d(192,192);ctx.clearRect(0,0,192,192);
 rrect(ctx,8,8,176,176,88,'rgba(246,249,247,.98)');
 text(ctx,'×',96,130,108,'#18211d',560,'center');return texture(c);}
function cinemaFloorTexture(image){const [c,ctx]=canvas2d(600,480);
 const shade=ctx.createLinearGradient(0,0,0,480);shade.addColorStop(0,'rgba(21,34,31,.46)');shade.addColorStop(.6,'rgba(12,19,17,.14)');shade.addColorStop(1,'rgba(0,0,0,0)');
 if(image){ctx.save();ctx.globalAlpha=.19;ctx.filter='blur(11px)';ctx.translate(0,470);ctx.scale(1,-1);ctx.drawImage(image,115,80,370,260);ctx.restore();}
 ctx.fillStyle=shade;ctx.fillRect(0,0,600,480);return texture(c);
}
// Cinema is its own opaque XR pass; it does not open a second browser page or end WebXR.
function enterDarkroom(targetCard=null){
 if(!targetCard){cinemaCards=cards.filter(c=>['source','object'].includes(c.kind)&&c.data?.image&&c.visible!==false);cinemaIndex=Math.max(0,cinemaCards.indexOf(selected));}
 const target=targetCard||selected;if(!target||!['source','object'].includes(target.kind)||!latestPose)return;
 if(darkroom)closeDarkroom(true);
 const headM=latestPose.transform.matrix,head=[headM[12],headM[13],headM[14]],yaw=cameraYaw(latestPose);
 const pitch=Math.atan2(-headM[9],Math.hypot(headM[8],headM[10]));
 const facing=quatMul(quatY(yaw),quatX(pitch));
 const pos=vadd(head,quatVec(facing,[0,0,-2.35]));
 const ratio=target.data?.decodedImage?.height&&target.data?.decodedImage?.width?
   target.data.decodedImage.height/target.data.decodedImage.width:
   target.size[1]/target.size[0];
 const width=Math.min(2.75,1.68/Math.max(.15,ratio));
 const [blank,ctx]=canvas2d(1024,768);rrect(ctx,0,0,1024,768,0,'#111714');
 text(ctx,'OPENING IMAGE…',512,388,42,'#d7e1d9',580,'center');
 const tex=texture(blank);
 darkroom={id:'cinema-photo',kind:'darkroom',front:tex,back:tex,visible:true,pos,q:facing,size:[width,width*ratio],scale:1,ownedTexture:true,resources:[tex]};
 const close=cinemaExitTexture();
 darkClose={id:'cinema-exit',kind:'darkroomexit',front:close,back:close,visible:true,
   pos:vadd(pos,quatVec(facing,[width*.5+.20,width*ratio*.5+.14,.035])),q:facing,size:[.23,.23],scale:1,resources:[close]};
 const arrow=(symbol,kind,x)=>{const [c,ctx]=canvas2d(196,196);rrect(ctx,6,6,184,184,82,'rgba(37,54,46,.97)');text(ctx,symbol,98,140,99,'#c5f1d6',580,'center');const tex=texture(c);return {id:'cinema-'+kind,kind,front:tex,back:tex,visible:true,pos:vadd(pos,quatVec(facing,[x,-.13,.03])),q:facing,size:[.29,.29],scale:1,resources:[tex]};};
 darkPrevious=arrow('‹','cinemaprev',-width*.5-.22);darkNext=arrow('›','cinemanext',width*.5+.22);
 const floorSource=target.data?.image||null;
 const floorPos=vadd(head,point(rotateY(yaw),[0,0,-2.35],0));floorPos[1]=floorReference?.02:head[1]-1.35;
 const floorTexture=cinemaFloorTexture(null);
 darkFloor={id:'cinema-floor',kind:'cinema-floor',front:floorTexture,back:floorTexture,visible:true,
   pos:floorPos,q:quatMul(quatY(yaw),quatX(-Math.PI/2)),size:[3.6,2.8],scale:1,alpha:.75,resources:[floorTexture]};
 if(floorSource){
  const img=new Image();img.decoding='async';
  const reference=darkroom;
  img.onload=()=>{
   if(darkroom!==reference||!gl)return;
   const [c,ctx]=canvas2d(Math.min(1400,Math.max(1,img.naturalWidth)),Math.min(1400,Math.max(1,img.naturalHeight)));
   ctx.drawImage(img,0,0,c.width,c.height);
   const actualRatio=img.naturalHeight/Math.max(1,img.naturalWidth);
   const actualWidth=Math.min(2.75,1.68/Math.max(.15,actualRatio));
   reference.size=[actualWidth,actualWidth*actualRatio];
   if(darkClose)darkClose.pos=vadd(pos,quatVec(facing,[actualWidth*.5+.20,actualWidth*actualRatio*.5+.14,.035]));
   if(darkPrevious)darkPrevious.pos=vadd(pos,quatVec(facing,[-actualWidth*.5-.22,-.13,.035]));
   if(darkNext)darkNext.pos=vadd(pos,quatVec(facing,[actualWidth*.5+.22,-.13,.035]));
   gl.deleteTexture(reference.front);const t=texture(c);reference.front=t;reference.back=t;
   if(darkFloor){gl.deleteTexture(darkFloor.front);darkFloor.front=cinemaFloorTexture(img);darkFloor.back=darkFloor.front;}
  };
  img.onerror=()=>{if(darkroom===reference){const [c,ctx]=canvas2d(512,256);rrect(ctx,0,0,512,256,0,'#111714');text(ctx,'Image unavailable',256,142,33,'#d4dbd5',500,'center');gl.deleteTexture(reference.front);reference.front=texture(c);reference.back=reference.front;}};
  img.src=floorSource;
 }else{window.FreeLab?.traceEvent?.('CINEMA: source card lacks image URL','warn');}
 cue('enter');
}
function navigateCinema(direction){
 if(!cinemaCards.length)return;
 cinemaIndex=(cinemaIndex+direction+cinemaCards.length)%cinemaCards.length;
 selected=cinemaCards[cinemaIndex];enterDarkroom(selected);
}
function renderCinema(frame,pose){
 const layer=session.renderState.baseLayer;
 gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
 gl.clearColor(0,0,0,1);gl.colorMask(true,true,true,true);
 gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 for(const view of pose.views){
  const vp0=layer.getViewport(view);gl.viewport(vp0.x,vp0.y,vp0.width,vp0.height);
  const vp=matmul(view.projectionMatrix,view.transform.inverse.matrix);
  gl.disable(gl.DEPTH_TEST);
  if(darkFloor)drawCard(darkFloor,vp);
  if(darkroom)drawCard(darkroom,vp);
  if(darkClose)drawCard(darkClose,vp);if(darkPrevious)drawCard(darkPrevious,vp);if(darkNext)drawCard(darkNext,vp);
  for(const src of session.inputSources){const r=ray(frame,src);if(!r)continue;
   const hit=pick(r);const end=vadd(r.o,vmul(r.d,hit?.dist||2.1));
   line(vp,[r.o,end],[.70,.95,.76,.70]);line(vp,[end],[.84,1,.87,.95],true,hit?12:7);
  }
  gl.enable(gl.DEPTH_TEST);
 }
}
async function action(id){const t=performance.now();if(t-lastAction<200)return;lastAction=t;
 if(busy&&['capture','extract','segment','voice','refine','prompt','describe','3d','submit3d','apply'].includes(id))return;
 switch(id){case 'capture':return makeCapture();case 'extract':return runExtract();
 case 'describe':return describeSelected();case 'descriptionclose':hideDescription();return;case 'descriptionask':return descriptionAskKeyboard();case 'descriptionretry':return askDescription('');case 'descriptionvoice':if(descriptionContext){descriptionQuestionMode=true;return voicePrompt();}return;
 case 'config':return showConfig();case 'configclose':configShowing=false;if(configPanel)configPanel.visible=false;return;
 case 'themenext':return cycleSetting('theme',1);case 'themeprev':return cycleSetting('theme',-1);
 case 'themerandom':uiSettings.generated=window.FreeLabXRUI.generate();return uiUpdate('generated',uiSettings.generated);
 case 'processingnext':return cycleSetting('processing',1);case 'processingprev':return cycleSetting('processing',-1);
 case 'config-borders':case 'config-backgrounds':case 'config-mascot':case 'config-experimental':case 'config-masked':case 'config-voice':{
   const key=id.slice(7);return uiUpdate(key,uiSettings[key]===false);}
 case 'debugclose':debugShowing=false;return;case 'debuglarger':if(debugPanel)debugPanel.scale=clamp(debugPanel.scale+.2,.55,2.6);return;case 'debugsmaller':if(debugPanel)debugPanel.scale=clamp(debugPanel.scale-.2,.55,2.6);return;
 case '3d':return open3d();case 'submit3d':return submit3d();case 'cancel3d':return close3d();
 case 'voice':return uiSettings.voice!==false?voicePrompt():null;case 'confirmvoice':return confirmVoice();case 'cancelvoice':dismissVoice();descriptionQuestionMode=false;return setStatus('Voice cancelled · tap microphone to record again',7000);case 'closemenu':return closeImageMenu();
 case 'darkroom':return enterDarkroom();case 'darkroomexit':return closeDarkroom();case 'cinemaprev':return navigateCinema(-1);case 'cinemanext':return navigateCinema(1);
 case 'imagemenu':return toggleImageMenu(selected);case 'imageclose':return selected?.kind==='source'?collapse():closeSelectedCard();
 case 'debug':debugShowing=!debugShowing;if(debugShowing){serverPoll=0;loadServerDiagnostic();}return setStatus(debugShowing?'LOG OPEN · API errors and server request status':'LOG CLOSED',6500);
 case 'branch':return selected?.kind==='object'?openBranch(selected.data.id):null;case 'parent':return upBranch();
 case 'prompt':return openPrompt();case 'segment':return selected?.kind==='source'?runExtract():extractParts();case 'refine':return restoreSelected();case 'apply':return applyPrompt();
 case 'follow':return toggleFollow();case 'gallery':galleryPage=0;return openGallery(0);
 case 'exit':held=null;return darkroom?closeDarkroom():session?.end();}}

async function start(){if(session)return;uiSettings=window.FreeLabXRUI?.read?.()||uiSettings;if(!navigator.xr||!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('Use Meta Quest Browser with immersive-ar support');
 setup();stringLab=new window.FreeLabStringLab.Experiment();stringLabState=null;rightStickDown=false;fingerLab=new window.FreeLabFingerLab.Experiment();fingerLabState=null;leftStickDown=false;frameLab=new window.FreeLabFrameLab.Experiment();frameLabState=null;frameGames=new window.FreeLabFrameGames.Engine();triangleLab=new window.FreeLabShapeSort.TriangleDraw();labSelector=new window.FreeLabLabSelector.Selector();labMenu=null;labMenuIndex=-1;await gl.makeXRCompatible();session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking','plane-detection','anchors','dom-overlay','depth-sensing'],depthSensing:{usagePreference:['gpu-optimized','cpu-optimized'],dataFormatPreference:['luminance-alpha','float32']},domOverlay:{root:document.getElementById('xrPromptEditor')}});xrDomOverlay=Boolean(session.domOverlayState);session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:false})});
 try{refSpace=await session.requestReferenceSpace('local-floor');floorReference=true;}catch{refSpace=await session.requestReferenceSpace('local');floorReference=false;}poseReady=false;depthChecked=false;depthState='not requested';
 session.addEventListener('selectstart',e=>{lastNative.set(e.inputSource,performance.now());if(e.inputSource.handedness==='left'&&labSelector?.open)return;grabStart(e.frame,e.inputSource);});
 session.addEventListener('selectend',e=>{lastNative.set(e.inputSource,performance.now());if(e.inputSource.handedness==='left'&&labSelector?.open)return;grabEnd(e.inputSource,e.frame);});
 session.addEventListener('squeezestart',e=>{lastNative.set(e.inputSource,performance.now());if(e.inputSource.handedness==='left'&&labSelector?.open)return;grabStart(e.frame,e.inputSource);});
 session.addEventListener('squeezeend',e=>{lastNative.set(e.inputSource,performance.now());if(e.inputSource.handedness==='left'&&labSelector?.open)return;grabEnd(e.inputSource,e.frame);});
 session.addEventListener('end',()=>{window.FreeLabRooms?.end?.();if(labMenu?.front)gl.deleteTexture(labMenu.front);labMenu=null;labMenuIndex=-1;labSelector?.reset();labSelector=null;frameLab?.clear();frameLab=null;triangleLab=null;shapeTargets=[];frameGames?.clear();frameGames=null;mascotHitUntil=0;if(mascotImpactSprite){gl.deleteTexture(mascotImpactSprite);mascotImpactSprite=null;}if(frameGameCubeBuffer){gl.deleteBuffer(frameGameCubeBuffer);frameGameCubeBuffer=null;}frameTouch=null;frameErase=null;frameLabState=null;window.FreeLabSound?.fingersStopAll?.();fingerLab?.setEnabled(false);fingerLab=null;fingerLabState=null;leftStickDown=false;window.FreeLabSound?.stringStop?.();stringLab?.setEnabled(false);stringLab=null;stringLabState=null;rightStickDown=false;cue('release');session=null;poseReady=false;held=null;clearCards();if(darkroom?.ownedTexture&&darkroom.front)gl.deleteTexture(darkroom.front);if(darkFloor?.front)gl.deleteTexture(darkFloor.front);if(darkClose?.front)gl.deleteTexture(darkClose.front);darkroom=null;darkBackdrop=null;darkClose=null;darkFloor=null;descriptionQuestionMode=false;if(voiceBadge?.front)gl.deleteTexture(voiceBadge.front);voiceBadge=null;dismissVoice();gestureDebounce.clear();gestureSpeechTimes.clear();lastGestureAnnouncement=-100000;if(mascotSpeech?.front)gl.deleteTexture(mascotSpeech.front);mascotSpeech=null;cloud=null;for(const z of zones)gl.deleteTexture(z.front);zones=[];if(toolbar?.front)gl.deleteTexture(toolbar.front);if(editbar?.front)gl.deleteTexture(editbar.front);if(statusCard?.front)gl.deleteTexture(statusCard.front);if(cameraHint?.front)gl.deleteTexture(cameraHint.front);cameraHint=null;cameraHintState='';if(captureEye?.front)gl.deleteTexture(captureEye.front);if(voiceButton?.front)gl.deleteTexture(voiceButton.front);if(extractButton?.front)gl.deleteTexture(extractButton.front);voiceButton=null;extractButton=null;extractVisualActive=null;inferenceCard=null;captureEye=null;eyeResource=null;toolbar=null;statusCard=null;editbar=null;if(promptPanel?.front)gl.deleteTexture(promptPanel.front);promptPanel=null;document.getElementById('xrPromptEditor')?.classList.add('hidden');document.getElementById('xrPromptEditor')?.classList.remove('xr-native-open');if(debugPanel?.front)gl.deleteTexture(debugPanel.front);debugPanel=null;debugShowing=false;if(configPanel?.front)gl.deleteTexture(configPanel.front);configPanel=null;configShowing=false;if(descriptionPanel?.front)gl.deleteTexture(descriptionPanel.front);descriptionPanel=null;for(const m of meshPreviews)gl.deleteBuffer(m.buffer);meshPreviews=[];voiceRecord?.cancel?.();voiceRecord=null;if(mascotPointer?.front)gl.deleteTexture(mascotPointer.front);mascotPointer=null;mixBucket=[];xrKeyboard?.remove();xrKeyboard=null;window.FreeLab?.notify?.('Exited spatial collection');});
 const saved=await window.FreeLab.listXRClouds().catch(()=>[]);clouds=saved;refreshToolbar();
 // Session-scoped XR placements are temporary, but every private JPEG and job remains in SQLite.
 // Resume queued cloud jobs after headset/browser restarts, without submitting a new paid request.
 const oldJobs=await window.FreeLab.list3DJobs?.().catch(()=>[])||[];
 pending3dJobs=oldJobs.filter(j=>['PENDING','IN_PROGRESS','UNKNOWN'].includes(j.status)).slice(0,12).map(j=>({id:j.id,provider:j.provider,origin:null}));meshyPollAt=0;
setStatus('CAPTURE → EXTRACT → PROMPT · camera pixels required',8500);
 if(uiSettings.voice!==false&&window.FreeLab?.pref?.('spoken')){mascotSay('Welcome to FreeLab!',3600);window.FreeLab?.speakUpdate?.('Welcome to FreeLab! Your room is ready to explore.');}
 session.requestAnimationFrame(updateView);
}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
