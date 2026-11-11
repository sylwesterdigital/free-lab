/* WebXR immersive AR with self-contained WebGL floating panel. No Three.js/CDN required.
   Quest controller select == trigger; hand targetRay select == pinch; squeeze == snapshot.
   Camera pixels only come from an explicitly opened getUserMedia stream, never XR compositor.
*/
(()=>{'use strict';
let session=null,gl=null,program=null,refSpace=null,canvas=null,panelTexture=null,webCanvas=null,uiCtx=null,uiState='Ready',panelMode='home';
const WIDTH=1.08,HEIGHT=.84,DIST=1.34;
const VS=`attribute vec3 position;attribute vec2 uv;uniform mat4 transform;varying vec2 tex;void main(){tex=uv;gl_Position=transform*vec4(position,1.0);}`;
const FS=`precision mediump float;varying vec2 tex;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,tex);}`;
const buttons=[{name:'CAPTURE',x:48,y:336,w:340,h:85,action:'capture'},{name:'LIBRARY',x:406,y:336,w:315,h:85,action:'library'},{name:'EXIT SR',x:48,y:446,w:673,h:76,action:'exit'}];
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
function draw(){uiCtx.clearRect(0,0,768,600);round(2,2,764,595,49,'rgba(37,41,47,.97)','rgba(255,255,255,.2)');round(36,35,47,47,16,'#e8edf5');text('◈',48,67,34,'#16191d','700');text('FREE LAB  /  SPATIAL COLLECTOR',100,67,20,'#d9dfe7','700');round(36,105,696,2,1,'#414851');text('YOUR SPACE · QUEST 3',48,154,16,'#aab4bf','700');text(panelMode==='library'?'Your collection':'Your world,',48,217,51,'#ffffff','600');text(panelMode==='library'?'':'collected.',48,272,51,'#aeb8c2','600');
 if(panelMode==='library'){const items=window.FreeLab?.getState().objects||[];items.slice(0,2).forEach((o,i)=>text('◌   '+ellipsize(o.label,33),48,289+i*33,19,'#cdd5df'));}
 else {text('Point + pinch or controller trigger to navigate.',48,304,18,'#b2bbc6');}
 for(const b of buttons){round(b.x,b.y,b.w,b.h,21,b.action==='capture'?'#e5eaf1':'#343a43',b.action==='capture'?'#ffffff':'#56606c');text(b.name,b.x+29,b.y+b.h/2+9,25,b.action==='capture'?'#141821':'#eef2f8','700');}
 text('Squeeze = capture  •  Quest palm pinch = system menu',49,553,15,'#a5afb9');text(ellipsize(uiState,84),49,579,13,'#b6c4d1');
 gl.bindTexture(gl.TEXTURE_2D,panelTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,webCanvas);}
function onFrame(t,frame){if(!session)return;session.requestAnimationFrame(onFrame);const pose=frame.getViewerPose(refSpace);if(!pose)return;gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
 // Head-relative panel: eyes share a stable floating UI in front of the viewer.
 for(const view of pose.views){const viewport=session.renderState.baseLayer.getViewport(view);gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);const mat=mul(view.projectionMatrix,mul(view.transform.inverse.matrix,pose.transform.matrix));gl.uniformMatrix4fv(gl.getUniformLocation(program,'transform'),false,mat);gl.drawArrays(gl.TRIANGLES,0,6);}}
function hit(frame,source){const viewer=frame.getViewerPose(refSpace);if(!viewer)return null;const ray=frame.getPose(source.targetRaySpace,refSpace);if(!ray)return null;const inv=viewer.transform.inverse.matrix;const rm=ray.transform.matrix;const o=point(inv,rm[12],rm[13],rm[14]);const worldDir=point(rm,0,0,-1,0);const d=point(inv,...worldDir,0);if(Math.abs(d[2])<.005)return null;const u=(-DIST-o[2])/d[2];if(u<0||u>8)return null;const x=o[0]+u*d[0],y=o[1]+u*d[1];const px=(x/WIDTH+.5)*768,py=(.5-y/HEIGHT)*600;return buttons.find(b=>px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h)||null;}
async function capture(){try{const state=window.FreeLab.getState();if(!state.stream){uiState='Camera unavailable: exit SR and upload snapshot';draw();window.FreeLab.notify(uiState);return;}
 window.FreeLab.snapshot();if(!state.config?.inference_enabled){uiState='Snapshot ready — exit SR to name and save';draw();window.FreeLab.notify(uiState);return;}
 uiState='Recognizing one frame with Meta Muse…';draw();await window.FreeLab.submitCapture(true);uiState='Analysis finished. Check your collection.';draw();}
 catch(e){uiState=e.message;draw();window.FreeLab.notify(e.message);}}
function onSelect(ev){const button=hit(ev.frame,ev.inputSource);if(!button)return;switch(button.action){case 'capture':capture();break;case 'library':panelMode=panelMode==='library'?'home':'library';uiState='Private collection';draw();break;case 'exit':session?.end();break;}}
async function start(){if(session)return;if(!navigator.xr)throw Error('WebXR not available. Open this HTTPS site in Quest Browser.');if(!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('Immersive AR unsupported on this browser.');initGL();await gl.makeXRCompatible();
 try{session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking']});}catch(e){throw Error('Could not start immersive AR: '+e.message)}
 session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:true})});refSpace=await session.requestReferenceSpace('local');session.addEventListener('select',onSelect);session.addEventListener('squeeze',capture);session.addEventListener('end',()=>{session=null;uiState='XR ended';window.FreeLab.notify('Exited spatial reality')});
 uiState=window.FreeLab.getState().stream?'Camera ready — press CAPTURE':'No camera stream — exit SR to upload or enable camera';draw();session.requestAnimationFrame(onFrame);}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
