/* FREELAB 0.2.0: direct WebXR WebGL HUD with hand pinch, controller input and movable header.
   Quest controller select == trigger; hand targetRay select == pinch; squeeze == snapshot.
   Camera pixels only come from an explicitly opened getUserMedia stream, never XR compositor.
*/
(()=>{'use strict';
let session=null,gl=null,program=null,refSpace=null,canvas=null,panelTexture=null,webCanvas=null,uiCtx=null,uiState='Ready',panelMode='home';
let offsetX=0,offsetY=0,drag=null,hover=null,lastDraw=0,inputStatus='Input not detected',lastAction=0;
const pinches=new WeakMap(),gameButtons=new WeakMap();
const WIDTH=1.08,HEIGHT=.84,DIST=1.34;
const VS=`attribute vec3 position;attribute vec2 uv;uniform mat4 transform;uniform vec2 offset;varying vec2 tex;void main(){tex=uv;gl_Position=transform*vec4(position.xy+offset,position.z,1.0);}`;
const FS=`precision mediump float;varying vec2 tex;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,tex);}`;
const buttons=[{name:'SCAN FRAME',x:48,y:336,w:340,h:85,action:'capture'},{name:'COLLECTION',x:406,y:336,w:315,h:85,action:'library'},{name:'EXIT XR',x:48,y:446,w:673,h:76,action:'exit'}];
function mul(a,b){const o=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let n=0;for(let k=0;k<4;k++)n+=a[k*4+row]*b[col*4+k];o[col*4+row]=n;}return o;}
function point(m,x,y,z,w=1){return [m[0]*x+m[4]*y+m[8]*z+m[12]*w,m[1]*x+m[5]*y+m[9]*z+m[13]*w,m[2]*x+m[6]*y+m[10]*z+m[14]*w]}
function compile(type,code){const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function initGL(){canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;gl=canvas.getContext('webgl',{xrCompatible:true,alpha:true,antialias:true});if(!gl)throw Error('WebGL unavailable');program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,VS));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('WebGL shader linking failed');gl.useProgram(program);
 const coords=new Float32Array([-WIDTH/2,-HEIGHT/2,-DIST,0,1, WIDTH/2,-HEIGHT/2,-DIST,1,1, -WIDTH/2,HEIGHT/2,-DIST,0,0, -WIDTH/2,HEIGHT/2,-DIST,0,0, WIDTH/2,-HEIGHT/2,-DIST,1,1, WIDTH/2,HEIGHT/2,-DIST,1,0]);
 const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,coords,gl.STATIC_DRAW);const stride=5*4;const p=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,3,gl.FLOAT,false,stride,0);const uv=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,stride,12);
 panelTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,panelTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 webCanvas=document.createElement('canvas');webCanvas.width=768;webCanvas.height=600;uiCtx=webCanvas.getContext('2d');}
function round(x,y,w,h,r,fill,stroke){uiCtx.beginPath();uiCtx.roundRect(x,y,w,h,r);uiCtx.fillStyle=fill;uiCtx.fill();if(stroke){uiCtx.strokeStyle=stroke;uiCtx.lineWidth=1.5;uiCtx.stroke();}}
function text(t,x,y,size=22,color='#F2F4F8',weight='500'){uiCtx.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;uiCtx.fillStyle=color;uiCtx.fillText(String(t),x,y);}
function ellipsize(t,n=43){return t.length>n?t.slice(0,n-1)+'…':t}
function draw(){uiCtx.clearRect(0,0,768,600);round(2,2,764,595,49,'rgba(28,37,32,.97)','rgba(199,249,205,.32)');round(36,35,47,47,16,'#baffc5');text('◎',48,67,30,'#102218','700');text('FREELAB',102,66,25,'#f1f8f2','700');text('⋮⋮  GRAB HEADER TO MOVE',442,67,13,'#b5c9b9','600');round(36,105,696,2,1,'#414851');text('SPATIAL COLLECTOR / QUEST 3',48,154,16,'#adccba','700');text(panelMode==='library'?'Your collection':'Your world,',48,217,51,'#ffffff','600');text(panelMode==='library'?'':'collected.',48,272,51,'#aeb8c2','600');
 if(panelMode==='library'){const items=window.FreeLab?.getState().objects||[];items.slice(0,2).forEach((o,i)=>text('◌   '+ellipsize(o.label,33),48,289+i*33,19,'#cdd5df'));}
 else {text('Point + pinch or trigger. Grab top bar to move.',48,304,18,'#b2c7b8');}
 for(const b of buttons){round(b.x,b.y,b.w,b.h,21,b.action==='capture'?'#dcf4e0':hover===b.action?'#617d69':'#354138',b.action==='capture'?'#ffffff':'#607868');text(b.name,b.x+29,b.y+b.h/2+9,25,b.action==='capture'?'#141821':'#eef2f8','700');}
 text(inputStatus.slice(0,75),49,553,15,'#bce2c5');text(ellipsize(uiState,84),49,579,13,'#b6c4d1');
 gl.bindTexture(gl.TEXTURE_2D,panelTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,webCanvas);}
function onFrame(t,frame){if(!session)return;session.requestAnimationFrame(onFrame);const pose=frame.getViewerPose(refSpace);if(!pose)return;pollInputs(frame,t);gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
 // Head-relative panel: eyes share a stable floating UI in front of the viewer.
 for(const view of pose.views){const viewport=session.renderState.baseLayer.getViewport(view);gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);const mat=mul(view.projectionMatrix,mul(view.transform.inverse.matrix,pose.transform.matrix));gl.uniformMatrix4fv(gl.getUniformLocation(program,'transform'),false,mat);gl.uniform2f(gl.getUniformLocation(program,'offset'),offsetX,offsetY);gl.drawArrays(gl.TRIANGLES,0,6);}}
function intersect(frame,source){
 const viewer=frame.getViewerPose(refSpace);if(!viewer)return null;
 let ray;try{ray=frame.getPose(source.targetRaySpace,refSpace)}catch{return null;}if(!ray)return null;
 const inv=viewer.transform.inverse.matrix,rm=ray.transform.matrix;
 const o=point(inv,rm[12],rm[13],rm[14]),wd=point(rm,0,0,-1,0),d=point(inv,...wd,0);
 if(Math.abs(d[2])<.005)return null;const u=(-DIST-o[2])/d[2];if(u<0||u>8)return null;
 const rawX=o[0]+u*d[0],rawY=o[1]+u*d[1];
 const px=((rawX-offsetX)/WIDTH+.5)*768,py=(.5-(rawY-offsetY)/HEIGHT)*600;
 return {px,py,rawX,rawY,button:buttons.find(b=>px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h)||null,
   header:px>40&&px<730&&py>18&&py<115};
}
function onSelectStart(ev){const target=intersect(ev.frame,ev.inputSource);if(target?.header){drag={source:ev.inputSource,x:target.rawX-offsetX,y:target.rawY-offsetY};}}
function onSelectEnd(ev){if(drag?.source===ev.inputSource)drag=null;}
function updateDrag(frame){if(!drag)return;const target=intersect(frame,drag.source);if(!target)return;
 offsetX=Math.max(-1.25,Math.min(1.25,target.rawX-drag.x));offsetY=Math.max(-.7,Math.min(.7,target.rawY-drag.y));}
function describeInputs(){if(!session)return;let hands=0,controllers=0;
 for(const source of session.inputSources){if(source.hand)hands++;else if(source.gamepad)controllers++;}
 inputStatus=`${hands} hand(s) · ${controllers} controller(s)  |  pinch/trigger → select · squeeze → capture`;
 draw();}
function triggerAction(target){if(!target?.button)return;const now=performance.now();if(now-lastAction<360)return;lastAction=now;
 switch(target.button.action){case 'capture':capture();break;case 'library':panelMode=panelMode==='library'?'home':'library';uiState='Private collection';draw();break;case 'exit':session?.end();break;}}
function pollInputs(frame,t){
 for(const source of session.inputSources){
   if(source.hand&&typeof frame.getJointPose==='function'){
     const thumb=source.hand.get('thumb-tip'),index=source.hand.get('index-finger-tip');
     if(thumb&&index){const a=frame.getJointPose(thumb,refSpace),b=frame.getJointPose(index,refSpace);
       if(a&&b){const d=Math.hypot(a.transform.position.x-b.transform.position.x,a.transform.position.y-b.transform.position.y,a.transform.position.z-b.transform.position.z);
         const pressed=pinches.get(source)||false;
         if(!pressed&&d<.022){pinches.set(source,true);const target=intersect(frame,source);if(target?.header)drag={source,x:target.rawX-offsetX,y:target.rawY-offsetY};else triggerAction(target);}
         else if(pressed&&d>.045){pinches.set(source,false);if(drag?.source===source)drag=null;}
       }
     }
   }
   if(source.gamepad){const buttons=source.gamepad.buttons;const last=gameButtons.get(source)||[false,false];
     const a=Boolean(buttons[4]?.pressed),b=Boolean(buttons[5]?.pressed);
     if(a&&!last[0]){panelMode=panelMode==='library'?'home':'library';draw();}
     if(b&&!last[1])session.end().catch(()=>{});
     gameButtons.set(source,[a,b]);
   }
 }
 updateDrag(frame);
 if(t-lastDraw>150){const candidate=[...session.inputSources].map(source=>intersect(frame,source)?.button?.action).find(Boolean)||null;
  if(candidate!==hover){hover=candidate;draw();}lastDraw=t;}
}
async function capture(){try{const state=window.FreeLab.getState();if(!state.stream){uiState='Camera unavailable: exit SR and upload snapshot';draw();window.FreeLab.notify(uiState);return;}
 window.FreeLab.snapshot();if(!state.config?.inference_enabled){uiState='Snapshot ready — exit SR to name and save';draw();window.FreeLab.notify(uiState);return;}
 uiState='Recognizing one frame with Meta Muse…';draw();await window.FreeLab.submitCapture(true);uiState='Analysis finished. Check your collection.';draw();}
 catch(e){uiState=e.message;draw();window.FreeLab.notify(e.message);}}
function onSelect(ev){const target=intersect(ev.frame,ev.inputSource);
 if(target?.header)return;triggerAction(target);}
async function start(){if(session)return;if(!navigator.xr)throw Error('WebXR not available. Open this HTTPS site in Quest Browser.');if(!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('Immersive AR unsupported on this browser.');initGL();await gl.makeXRCompatible();
 try{session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking','plane-detection','anchors']});}catch(e){throw Error('Could not start immersive AR: '+e.message)}
 session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:true})});refSpace=await session.requestReferenceSpace('local');session.addEventListener('selectstart',onSelectStart);session.addEventListener('selectend',onSelectEnd);session.addEventListener('select',onSelect);session.addEventListener('squeeze',capture);session.addEventListener('inputsourceschange',describeInputs);session.addEventListener('end',()=>{session=null;uiState='XR ended';window.FreeLab.notify('Exited spatial reality')});
 describeInputs();uiState=window.FreeLab.getState().stream?'Camera ready — press CAPTURE':'No camera stream — exit SR to upload or enable camera';draw();session.requestAnimationFrame(onFrame);}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
