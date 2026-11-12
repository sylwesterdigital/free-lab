/* FREELAB 0.5.0 — Capture → Extract → Prompt.
   Minimal WebGL WebXR renderer: real camera input only, no fake passthrough pixels.
   World-positioned photos, yaw-upright follow toolbar, image derivatives, spatial grab.
   Flat grey floating controls, double-sided, draggable spatial cards.
*/
(()=>{'use strict';
let gl,canvas,program,lineProgram,quad,rayBuffer,refSpace,session,root,poseReady=false;
let toolbar=null,editbar=null,statusCard=null,cloud=null,clouds=[],cards=[],zones=[],selected=null,held=null;
let pointerHover=null,lastFrame=0,lastUi=0,lastAction=0,latestPose=null,nextPaidAt=0,busy=false,mode='capture',statusText='Capture your space',statusUntil=0;
let followMode=true,followBase=null,rootYaw=0,promptPanel=null,promptContext=null,promptText='',xrDomOverlay=false;
let particles=[],handPinch=new WeakMap(),lastNative=new WeakMap(),clickState=new WeakMap();
const PW=600,PH=420,MAX_CLOUD=10,TAU=2*Math.PI;
const tools=[['gallery','▣'],['capture','+'],['extract','✳'],['prompt','✎'],['follow','◎'],['bin','⌫'],['collapse','◌'],['exit','×']];
const editTools=[['prompt','✎'],['extract','✳'],['refine','⌗'],['folder','▤'],['bin','⌫']];
const promptTools=[['voice','◎'],['apply','↗'],['keyboard','⌨'],['cancel','×']];
const V=`attribute vec3 aPos;attribute vec2 aUV;uniform mat4 uMVP;varying vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPos,1.);}`;
const F=`precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform bool uFlip;void main(){vec2 uv=vec2(uFlip?1.-vUV.x:vUV.x,vUV.y);gl_FragColor=texture2D(uTex,uv);}`;
const LV=`attribute vec3 aPos;uniform mat4 uVP;uniform float uSize;void main(){gl_Position=uVP*vec4(aPos,1.);gl_PointSize=uSize;}`;
const LF=`precision mediump float;uniform vec4 uColor;uniform bool uPoint;void main(){if(uPoint&&length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=uColor;}`;
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
function quatMatrix(q){const [x,y,z,w]=quatNorm(q),xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
 return new Float32Array([1-2*(yy+zz),2*(xy+wz),2*(xz-wy),0,2*(xy-wz),1-2*(xx+zz),2*(yz+wx),0,2*(xz+wy),2*(yz-wx),1-2*(xx+yy),0,0,0,0,1]);}
function poseQuat(frame,src){try{let pose=null;
 if(src.gripSpace)pose=frame.getPose(src.gripSpace,refSpace);
 if(!pose&&src.hand)pose=frame.getJointPose(src.hand.get('wrist'),refSpace);
 if(!pose&&src.targetRaySpace)pose=frame.getPose(src.targetRaySpace,refSpace);
 const q=pose?.transform?.orientation;return q?[q.x,q.y,q.z,q.w]:null;
 }catch{return null;}}
function posePosition(frame,src){try{
 let pose=src.gripSpace?frame.getPose(src.gripSpace,refSpace):null;
 if(!pose&&src.hand)pose=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace);
 if(!pose&&src.targetRaySpace)pose=frame.getPose(src.targetRaySpace,refSpace);
 const p=pose?.transform?.position;return p?[p.x,p.y,p.z]:null;
 }catch{return null;}}
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
function setup(){canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;gl=canvas.getContext('webgl',{alpha:true,antialias:false,xrCompatible:true});if(!gl)throw Error('WebGL is unavailable');program=shader(V,F);lineProgram=shader(LV,LF);
 const a=[-.5,-.5,0,0,1,.5,-.5,0,1,1,-.5,.5,0,0,0,-.5,.5,0,0,0,.5,-.5,0,1,1,.5,.5,0,1,0];
 quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);rayBuffer=gl.createBuffer();
 gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
}
function canvas2d(w=PW,h=PH){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function rrect(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function text(ctx,msg,x,y,size=24,color='#fff',weight=600,align='left'){ctx.font=`${weight} ${size}px system-ui, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(msg),x,y);ctx.textAlign='left';}
function wrapping(ctx,str,x,y,width,lh=30,lines=4){ctx.font='22px system-ui';const words=String(str||'').split(/\s+/);let out='',n=0;for(const word of words){const test=out?out+' '+word:word;if(ctx.measureText(test).width>width&&out){text(ctx,out,x,y+n*lh,21,'#d4ded9',450);out=word;n++;if(n>=lines)return;}else out=test;}if(out)text(ctx,out,x,y+n*lh,21,'#d4ded9',450);}
function texture(c){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);return t;}
function cardTexture(imageSrc,labelText,sub='PRIVATE CAPTURE',back=false){const [c,ctx]=canvas2d();ctx.clearRect(0,0,PW,PH);rrect(ctx,0,0,PW,PH,31,'#303634');
 if(back){rrect(ctx,18,18,PW-36,PH-36,21,'#424a46');text(ctx,'FREELAB  /  OBJECT',40,62,18,'#a6b7ad',670);text(ctx,labelText.slice(0,24),40,123,38,'#fff',680);wrapping(ctx,sub,40,170,PW-90,32,6);text(ctx,'DOUBLE-TAP TO FLIP',40,PH-40,16,'#b8c7bc',560);return {tex:texture(c),canvas:c};}
 rrect(ctx,13,13,PW-26,PH-26,23,'#161c1a');rrect(ctx,17,17,PW-34,PH-100,21,'#26342c');
 text(ctx,'◎',PW/2,PH/2-30,96,'#9aaea1',250,'center');if(sub.includes('SOURCE FRAME')){rrect(ctx,PW-224,27,194,65,33,'#b9f5bf');text(ctx,'✳ EXTRACT',PW-128,70,24,'#163023',690,'center');}
 text(ctx,labelText.slice(0,23),30,PH-55,27,'#fff',670);text(ctx,sub.slice(0,43),30,PH-25,14,'#b6c3b9',550);
 const resource={tex:texture(c),canvas:c};if(imageSrc){const img=new Image();img.decoding='async';img.onload=()=>{if(!gl)return;ctx.save();ctx.beginPath();ctx.roundRect(17,17,PW-34,PH-100,21);ctx.clip();const rw=(PW-34),rh=(PH-100),sc=Math.max(rw/img.width,rh/img.height);ctx.drawImage(img,17+(rw-img.width*sc)/2,17+(rh-img.height*sc)/2,img.width*sc,img.height*sc);ctx.restore();if(resource.tex){gl.bindTexture(gl.TEXTURE_2D,resource.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);}};img.onerror=()=>{};img.src=imageSrc;}return resource;}
function toolbarTexture(kind){const names=kind==='edit'?editTools:kind==='prompt'?promptTools:tools;const w=names.length===4?380:names.length===5?520:760,[c,ctx]=canvas2d(w,108);rrect(ctx,0,0,w,108,54,'#373d3b');const step=w/names.length;
 names.forEach(([id,glyph],idx)=>{const x=step*(idx+.5);const active=pointerHover===id;rrect(ctx,x-37,5,74,96,36,active?'#626e67':'#373d3b');text(ctx,glyph,x,62,43,active?'#c6ffd0':'#fff',450,'center');text(ctx,({gallery:'LIB',capture:'CAPTURE',extract:'EXTRACT',refine:'REFINE',prompt:'PROMPT',follow:followMode?'PIN':'FOLLOW',folder:'FOLDER',bin:'BIN',collapse:'HIDE',exit:'EXIT',voice:'SPEAK',apply:'APPLY',keyboard:'TYPE',cancel:'CLOSE'})[id]||id,x,94,13,'#d0d8d2',510,'center');});return texture(c);}

function zoneTexture(icon,labelName){const [c,ctx]=canvas2d(200,200);rrect(ctx,0,0,200,200,96,'#414a45');text(ctx,icon,100,121,95,'#eefcf0',450,'center');text(ctx,labelName,100,172,20,'#c3d5c8',580,'center');return texture(c);}
function statusTexture(value){const [c,ctx]=canvas2d(740,94);rrect(ctx,0,0,c.width,c.height,40,'#3b4340');text(ctx,value.slice(0,57),c.width/2,58,27,'#f3f8f2',540,'center');return texture(c);}
function addCard(id,kind,data,loc,size){const front=cardTexture(data.image||null,data.label||'',data.subtitle||'',false);const back=cardTexture(null,data.label||'',`FOLDER: ${data.folder||'Unsorted'}. ${data.description||'Object from your personal space'}`,true);
 const c={id,kind,data,front:front.tex,back:back.tex,resources:[front.tex,back.tex],pos:[...loc],from:[...loc],to:[...loc],start:0,duration:0,scale:1,rot:0,q:[0,0,0,1],visible:true,size,original:[...loc]};cards.push(c);return c;}
function setStatus(value,ms=6000){statusText=String(value);statusUntil=performance.now()+ms;window.FreeLab?.notify?.(statusText);if(statusCard){gl.deleteTexture(statusCard.front);statusCard.front=statusTexture(statusText);} }
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
function clearCards(){if(!gl)return;for(const c of cards)for(const t of c.resources||[])gl.deleteTexture(t);cards=[];selected=null;}
function rootPos(c){return cloud&&c.kind!=='toolbar'&&c.kind!=='status'?vadd(c.pos,cloud.offset||[0,0,0]):c.pos;}
function baseFor(c){return followMode&&['toolbar','status'].includes(c.kind)?followBase||root:root;}
function cardModel(c){const p=rootPos(c);const sc=c.scale*(c.animScale===undefined?1:c.animScale);
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
function sparkles(vp,t){const ps=[];particles=particles.filter(p=>t-p.born<p.ttl);for(const p of particles){const u=clamp((t-p.born)/1000,0,2);ps.push(point(root,vadd(p.p,vmul(p.v,u))));}if(ps.length)line(vp,ps,[.75,1,.78,.66],true,4);}
function place(pose){root=viewerAnchor(pose,-.04,1.35);rootYaw=yawFromMatrix(pose.transform.matrix);
 followBase=viewerAnchor(pose,-.21,.85);poseReady=true;
 if(!toolbar){toolbar={id:'toolbar',kind:'toolbar',size:[.86,.123],pos:followMode?[0,0,0]:[0,-.53,.14],q:[0,0,0,1],scale:1,visible:true,front:toolbarTexture('main'),back:null,resources:[]};toolbar.back=toolbar.front;toolbar.resources=[toolbar.front];}
 if(!statusCard){statusCard={id:'status',kind:'status',size:[.67,.08],pos:followMode?[0,-.13,0]:[0,-.69,.14],q:[0,0,0,1],scale:1,visible:true,front:statusTexture(statusText),back:null,resources:[]};statusCard.back=statusCard.front;statusCard.resources=[statusCard.front];}
 if(!zones.length){for(const [id,glyph,pos] of [['folder-zone','▤',[-.7,-.8,.14]],['bin-zone','⌫',[.7,-.8,.14]]]){const t=zoneTexture(glyph,id==='bin-zone'?'BIN':'FOLDER');zones.push({id,kind:'zone',pos,size:[.19,.19],rot:0,scale:1,visible:true,front:t,back:t,resources:[t]});}}
 setStatus('Pinch / trigger · Capture · Extract · Prompt',3500);}
function toggleFollow(){followMode=!followMode;if(toolbar)toolbar.pos=followMode?[0,0,0]:[0,-.52,.13];if(statusCard)statusCard.pos=followMode?[0,-.13,0]:[0,-.68,.13];
 if(toolbar){gl.deleteTexture(toolbar.front);toolbar.front=toolbarTexture('main');toolbar.back=toolbar.front;}
 setStatus(followMode?'FOLLOW · drag toolbar to reposition':'PINNED · drag toolbar to move in room',4800);}
function ray(frame,src){try{const sp=src.targetRaySpace?frame.getPose(src.targetRaySpace,refSpace):null;if(sp){const m=sp.transform.matrix;return {o:[m[12],m[13],m[14]],d:norm([-m[8],-m[9],-m[10]])};}
 if(src.hand){const a=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace),b=frame.getJointPose(src.hand.get('wrist'),refSpace);if(a&&b){const o=[a.transform.position.x,a.transform.position.y,a.transform.position.z];const w=[b.transform.position.x,b.transform.position.y,b.transform.position.z];return {o,d:norm(vsub(o,w))};}}
 }catch{}return null;}
function hitTest(r,c){if(!r||!c.visible||!c.front||c.animScale===0)return null;const m=cardModel(c),inv=inverse(m);if(!inv)return null;const o=point(inv,r.o),d=point(inv,r.d,0);if(Math.abs(d[2])<1e-6)return null;const k=-o[2]/d[2];if(k<=0||k>6)return null;const x=o[0]+d[0]*k,y=o[1]+d[1]*k;if(Math.abs(x)>.5||Math.abs(y)>.5)return null;const hitWorld=point(m,[x,y,0]);const dist=length(vsub(hitWorld,r.o));return {card:c,x,y,dist};}
function pick(r){const opts=[...cards,toolbar,promptPanel?null:editbar,promptPanel,statusCard].filter(Boolean),all=opts.map(c=>hitTest(r,c)).filter(Boolean).sort((a,b)=>a.dist-b.dist);return all[0]||null;}
function buttonFromHit(h){if(!h)return null;if(['toolbar','editbar','promptbar'].includes(h.card.kind)){const list=h.card.kind==='editbar'?editTools:h.card.kind==='promptbar'?promptTools:tools;const idx=clamp(Math.floor((h.x+.5)*list.length),0,list.length-1);return list[idx][0];}return null;}
function grabStart(frame,src,manual=false){const r=ray(frame,src),h=pick(r);if(!h)return;
 if(held){if(!held.second&&held.card===h.card&&held.card.kind==='object'&&held.src!==src){
  const a=posePosition(frame,held.src),b=posePosition(frame,src);
  if(a&&b)held.second={src,firstDist:length(vsub(a,b)),startScale:held.card.scale};}
  return;
 }
 const id=buttonFromHit(h);held={src,hit:h,rayDist:h.dist,start:performance.now(),last:r?.o,card:h.card,
 moved:false,manual,id,wasSelected:selected===h.card,initial:[...h.card.pos],lastHit:r?.o,
 startQuat:poseQuat(frame,src),initialQuat:[...(h.card.q||[0,0,0,1])]};
 if(['object','source'].includes(h.card.kind)){selected=h.card;updateEditbar();}}
async function grabEnd(src,frame){if(held?.second?.src===src){held.second=null;return;}if(!held||held.src!==src)return;const h=held;held=null;
 if(h.moved){if(h.card.kind==='source'&&cloud?.id){
     try{const [x,y,z]=(cloud.offset||[0,0,0]);await window.FreeLab.updateXRCloud(cloud.id,{spatial:{x,y,z}});}catch(e){setStatus('Source position not saved: '+e.message);}
   }
   if(h.card.kind==='object'&&h.card.data?.id){
   const near=zones.find(z=>length(vsub(rootPos(h.card),rootPos(z)))<.34);
   if(near){selected=h.card;await changeObject(near.id==='bin-zone'?'bin':'folder');updateEditbar();return;}
   try{await window.FreeLab.updateXRObject(h.card.data.id,{spatial:spatialData(h.card)})}catch(e){setStatus('Position not saved: '+e.message);}
 }return;}
 if(h.id){action(h.id);return;}
 if(h.card.kind==='object'){const c=h.card;selected=c;setStatus(c.data.label+' · move, rotate, scale or PROMPT');updateEditbar();}
 else if(h.card.kind==='source'){selected=h.card;updateEditbar();
   if(h.hit.x>.15&&h.hit.y>.23)return runExtract();
   setStatus('Source frame selected · EXTRACT or PROMPT',7000);}
 else if(h.card.kind==='gallery'){await showCloud(h.card.data.id);}
 else if(h.card.kind==='binitem'){try{await window.FreeLab.updateXRObject(h.card.data.id,{shelf:'collection'});await openBin();setStatus('Object restored from Bin');}catch(e){setStatus(e.message);}}
}
function spatialData(c){return {x:+c.pos[0].toFixed(3),y:+c.pos[1].toFixed(3),z:+c.pos[2].toFixed(3),scale:+c.scale.toFixed(3),rotation:+c.rot.toFixed(3),qx:+(c.q||[0,0,0,1])[0].toFixed(5),qy:+(c.q||[0,0,0,1])[1].toFixed(5),qz:+(c.q||[0,0,0,1])[2].toFixed(5),qw:+(c.q||[0,0,0,1])[3].toFixed(5)};}
function updateEditbar(){if(editbar?.front)gl.deleteTexture(editbar.front);if(!selected){editbar=null;return;}editbar={id:'edit',kind:'editbar',size:[.48,.09],pos:vadd(selected.pos,[0,-.42,.1]),q:[0,0,0,1],scale:1,visible:true,front:toolbarTexture('edit'),resources:[]};editbar.back=editbar.front;editbar.resources=[editbar.front];}
function advanceGrab(frame){if(!held)return;const r=ray(frame,held.src);if(!r)return;
 const next=vadd(r.o,vmul(r.d,held.rayDist));if(!held.anchor){held.anchor=next;return;}
 const delta=vsub(next,held.anchor);const draggable=['source','object','toolbar'].includes(held.card.kind);
 if(draggable&&(length(delta)>.012||held.moved)){
  const allow=held.moved||performance.now()-held.start>155;
  if(allow){held.moved=true;const base=held.card.kind==='toolbar'?baseFor(held.card):root;
   const ir=inverse(base);if(!ir)return;const rootDelta=point(ir,delta,0);
   if(held.card.kind==='source'&&cloud){cloud.offset=vadd(cloud.offset||[0,0,0],rootDelta);}
   else held.card.pos=vadd(held.card.pos,rootDelta);
   if(held.card.kind==='toolbar')held.card.pos=[clamp(held.card.pos[0],-1.5,1.5),clamp(held.card.pos[1],-.85,.85),clamp(held.card.pos[2],-.35,.6)];
   if(held.card.kind==='object'&&selected===held.card)updateEditbar();
  }
 }
 if(held.card.kind==='object'){
  const quat=poseQuat(frame,held.src);
  if(quat&&held.startQuat){const worldDelta=quatMul(quat,quatInv(held.startQuat));
   const localDelta=quatMul(quatY(-rootYaw),quatMul(worldDelta,quatY(rootYaw)));
   const newQ=quatNorm(quatMul(localDelta,held.initialQuat));
   if(Math.abs(newQ[0]-(held.card.q||[0,0,0,1])[0])>.004||Math.abs(newQ[1]-(held.card.q||[0,0,0,1])[1])>.004)held.moved=true;
   held.card.q=newQ;
  }
  if(held.second){const a=posePosition(frame,held.src),b=posePosition(frame,held.second.src);
   if(a&&b&&held.second.firstDist>.04){held.card.scale=clamp(held.second.startScale*length(vsub(a,b))/held.second.firstDist,.45,3);held.moved=true;}}
 }
 held.anchor=next;
}
function pinchPoll(frame,src){if(!src.hand||typeof frame.getJointPose!=='function')return;try{const a=frame.getJointPose(src.hand.get('thumb-tip'),refSpace),b=frame.getJointPose(src.hand.get('index-finger-tip'),refSpace);if(!a||!b)return;const p=a.transform.position,q=b.transform.position,dist=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),prev=handPinch.get(src)||false;
 if(!prev&&dist<.022&&(performance.now()-(lastNative.get(src)||0)>350)){handPinch.set(src,true);grabStart(frame,src,true);}
 else if(prev&&dist>.047){handPinch.set(src,false);if(held?.src===src)grabEnd(src,frame);}
 }catch{}}
function updateHover(frame){let found=null;for(const src of session.inputSources){const h=pick(ray(frame,src));if(h){found=buttonFromHit(h)||h.card.id;break;}}if(pointerHover===found)return;pointerHover=found;
 if(toolbar){gl.deleteTexture(toolbar.front);toolbar.front=toolbarTexture('main');toolbar.back=toolbar.front;}
 if(editbar){gl.deleteTexture(editbar.front);editbar.front=toolbarTexture('edit');editbar.back=editbar.front;}}
function updateView(t,frame){if(!session)return;
 try {renderView(t,frame);}catch(e){console.error('FREELAB XR rendering stopped:',e);window.FreeLab?.notify?.('XR renderer error: '+(e?.message||String(e)));session?.end().catch(()=>{});}
}
function renderView(t,frame){const pose=frame.getViewerPose(refSpace);if(!pose){session.requestAnimationFrame(updateView);return;}latestPose=pose;if(!poseReady)place(pose);followBase=viewerAnchor(pose,-.21,.85);
 advanceGrab(frame);for(const src of session.inputSources)pinchPoll(frame,src);tween(t);if(t-lastUi>150){updateHover(frame);lastUi=t;}
 gl.bindFramebuffer(gl.FRAMEBUFFER,session.renderState.baseLayer.framebuffer);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 for(const view of pose.views){const vp0=session.renderState.baseLayer.getViewport(view);gl.viewport(vp0.x,vp0.y,vp0.width,vp0.height);const vp=matmul(view.projectionMatrix,view.transform.inverse.matrix);
 decoration(vp);for(const c of cards)drawCard(c,vp);if(editbar&&!promptPanel)drawCard(editbar,vp);if(toolbar)drawCard(toolbar,vp);if(promptPanel)drawCard(promptPanel,vp);if(statusCard)drawCard(statusCard,vp);if(held?.card?.kind==='object')for(const z of zones)drawCard(z,vp);sparkles(vp,t);
 for(const src of session.inputSources){const r=ray(frame,src);if(!r)continue;const h=pick(r),end=vadd(r.o,vmul(r.d,h?.dist||1.2));const colour=src.hand?[.72,1,.75,.7]:[.77,.88,1,.72];line(vp,[r.o,end],colour);line(vp,[end],colour,true,h?16:9);}
 }session.requestAnimationFrame(updateView);}
function ringPosition(i,n){const a=(i/(Math.max(5,n)))*TAU-.32;const rings=n>6&&i>=6?1.15:1;const radiusX=.76*rings,radiusY=.48*rings;return [Math.cos(a)*radiusX,Math.sin(a)*radiusY+.03,-.10+Math.sin(i*2.4)*.18];}
function sourceCard(data){return addCard('source','source',{label:data.legacy?'LEGACY ARCHIVE':'CAPTURE  '+String(data.id).padStart(2,'0'),subtitle:data.legacy?'OLDER SAVED OBJECTS · NOT A ROOM FRAME':'SOURCE FRAME  ·  PRIVATE',image:data.image||data.image_url,description:'Captured real pixels, not the WebXR passthrough compositor'},[0,.07,0],[.78,.58]);}
async function showCloud(id){closePrompt();const next=clouds.find(c=>c.id===id);if(!next){setStatus('Capture not found');return;}clearCards();mode='capture';cloud={...next,offset:['x','y','z'].map(k=>Number(next.spatial?.[k])||0)};
 if(next.hidden&&id>0){next.hidden=false;window.FreeLab.updateXRCloud(id,{hidden:false}).catch(()=>{});}
 const src=sourceCard(next);src.animScale=.08;animate(src,src.pos,0,660);
 const visible=next.objects.filter(o=>o.shelf!=='bin').slice(0,MAX_CLOUD);
 visible.forEach((o,i)=>{const target=spatialLoc(o,i,visible.length),card=addCard('item'+o.id,'object',{
   ...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:o.operation==='image_edit'?'AI VARIATION · PRIVATE':o.provider==='sam-3.1-box'?'REFINED REGION · PRIVATE':'EXTRACTED · PRIVATE'},[0,.05,-.08],[.3,.35]);card.pos=[0,.05,-.08];card.animScale=.06;card.original=target;card.scale=clamp(o.spatial?.scale||1,.45,3);card.rot=o.spatial?.rotation||0;card.q=['qx','qy','qz','qw'].every(k=>typeof o.spatial?.[k]==='number')?quatNorm([o.spatial.qx,o.spatial.qy,o.spatial.qz,o.spatial.qw]):quatY(card.rot);animate(card,target,i*55,1050);});
 if(next.collapsed&&id>0){next.collapsed=false;window.FreeLab.updateXRCloud(id,{collapsed:false}).catch(()=>{});}
 selected=null;updateEditbar();setStatus(`${next.objects.length} saved object(s)  •  pinch/trigger to move`,5000);
 // Reuse the saved JPEG for additional explicit Muse/SAM operations.
 if(id>0)await window.FreeLab.useXRFrame?.(next.image||next.image_url).catch(e=>setStatus(e.message));
}
function spatialLoc(o,i,n){const pos=ringPosition(i,n);if(o.spatial&&typeof o.spatial.x==='number')return [o.spatial.x,o.spatial.y,o.spatial.z];return pos;}
async function openGallery(){mode='gallery';selected=null;updateEditbar();clearCards();cloud=null;
 try{clouds=await window.FreeLab.listXRClouds();}catch(e){setStatus(e.message);return;}
 const previews=clouds.filter(x=>!x.hidden).slice(0,MAX_CLOUD);for(let i=0;i<previews.length;i++){const c=previews[i],col=i%4,row=Math.floor(i/4);addCard('gallery'+c.id,'gallery',{id:c.id,image:c.image_url,label:'CAPTURE '+c.id,subtitle:c.objects.length+' OBJECT(S)'},[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);}
 setStatus(previews.length?`${previews.length} saved capture(s) · select one to open`:'No saved captures yet · press +');}
async function openBin(){mode='bin';selected=null;updateEditbar();clearCards();cloud=null;
 try{clouds=await window.FreeLab.listXRClouds();}catch(e){setStatus(e.message);return;}
 const binned=clouds.flatMap(x=>x.objects).filter(x=>x.shelf==='bin').slice(0,MAX_CLOUD);
 binned.forEach((o,i)=>{const col=i%4,row=Math.floor(i/4);addCard('bin'+o.id,'binitem',{...o,image:o.has_image?'/api/objects/'+o.id+'/image':null,subtitle:'BIN  ·  SELECT TO RESTORE'},[(col-1.5)*.38,.21-row*.43,-.05],[.31,.35]);});
 setStatus(binned.length?`${binned.length} item(s) in Bin · select to restore`:'Bin is empty');}
async function makeCapture(){if(busy)return;busy=true;setStatus('CAPTURING · checking actual camera pixels',10000);
 try{const item=await window.FreeLab.saveXRFrame(image=>{
     clearCards();cloud=null;mode='capture';const pending=addCard('pending','source',{
       image,label:'CAPTURING…',subtitle:'SAVING PRIVATE IMAGE · NO MODEL CALL'},[0,.07,0],[.78,.58]);pending.animScale=.06;animate(pending,pending.pos,0,700);
   });const data={...item,objects:[],hidden:false,collapsed:false,offset:[0,0,0]};clouds.unshift(data);await showCloud(data.id);setStatus('CAPTURE '+data.id+' READY · ✳ EXTRACT on the photo (paid)',7000);}
 catch(e){setStatus('CAPTURE FAILED · '+e.message,12000)}finally{busy=false;}}
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
async function runExtract(){if(!cloud||busy||cloud.legacy)return setStatus('Capture a real photo first, then Extract');
 if(performance.now()<nextPaidAt)return setStatus('Wait before another AI request');busy=true;
 setStatus('EXTRACTING · source stays in place · 1 paid analysis',14000);
 try{const result=await window.FreeLab.recognizeXR(cloud.id);nextPaidAt=performance.now()+20000;
  const found=result.items||[];cloud.objects=[...cloud.objects,...found];
  const persisted=clouds.find(x=>x.id===cloud.id);if(persisted)persisted.objects=cloud.objects;
  bloomChildren(found);setStatus(found.length?`${found.length} objects bloomed from your photo`:'No clear objects found',8500);
 }catch(e){setStatus('Extract failed · '+e.message,12000);}finally{busy=false;}}
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
 return {card,captureId:cloud.id,objectId:card.kind==='object'?card.data.id:null,label:card.data?.label||'Capture'};}
function openPrompt(){const target=currentPromptTarget();if(!target)return setStatus('Capture or select a photo first');
 promptContext=target;promptText='';if(promptPanel?.front)gl.deleteTexture(promptPanel.front);
 promptPanel={id:'promptbar',kind:'promptbar',pos:vadd(target.card.pos,[0,-.43,.18]),size:[.48,.11],q:[0,0,0,1],scale:1,visible:true,front:toolbarTexture('prompt')};promptPanel.back=promptPanel.front;
 setStatus('PROMPT · Speak, Type, then Apply · source is preserved',9000);}
function closePrompt(){if(promptPanel?.front)gl.deleteTexture(promptPanel.front);promptPanel=null;promptContext=null;promptText='';}
async function voicePrompt(){if(!promptContext)return openPrompt();if(busy)return;busy=true;
 setStatus('MIC · listening for 6 seconds…',10000);
 try{const wav=await window.FreeLab.recordWavPrompt();setStatus('Transcribing your voice (paid)…',10000);
  promptText=await window.FreeLab.transcribeXR(wav);setStatus('HEARD: '+promptText.slice(0,48)+' · APPLY to generate',16000);
 }catch(e){setStatus('Microphone unavailable · use TYPE: '+e.message,14000);}finally{busy=false;}}
async function applyPrompt(){if(!promptContext)return openPrompt();if(busy)return;
 if(!promptText.trim())return setStatus('Speak or Type your instruction before Apply');
 const context=promptContext;busy=true;setStatus('GENERATING · original image stays in the room',24000);
 try{const o=await window.FreeLab.promptXR(context.captureId,context.objectId,promptText);
  if(cloud&&cloud.id===context.captureId){cloud.objects.push(o);bloomChildren([o],context.card);}
  setStatus('New AI image saved as a child · one image charged',10000);closePrompt();
 }catch(e){setStatus('Image edit failed · '+e.message,13000);}finally{busy=false;}}
async function keyboardPrompt(){if(!promptContext)return openPrompt();const ctx=promptContext;
 const onApply=async obj=>{if(session&&cloud?.id===ctx.captureId){cloud.objects.push(obj);bloomChildren([obj],ctx.card);}}
 // Quest Browser may not support DOM overlay/keyboard in immersive AR: leave XR gracefully.
 if(session&&!xrDomOverlay)await session.end();
 window.FreeLab.openPromptEditor(ctx,promptText,onApply);
}
async function changeObject(op){if(!selected?.data?.id)return setStatus('Select an object card first');const c=selected,id=c.data.id;
 try{
 if(op==='folder'){const options=['Unsorted','Keep','Room','Objects'];const next=options[(options.indexOf(c.data.folder)+1)%options.length];await window.FreeLab.updateXRObject(id,{folder:next});c.data.folder=next;const fresh=cardTexture(null,c.data.label,`FOLDER: ${next}. ${c.data.description||''}`,true);gl.deleteTexture(c.back);c.back=fresh.tex;c.resources[1]=fresh.tex;setStatus('Moved to folder · '+next);}
 if(op==='bin'){await window.FreeLab.updateXRObject(id,{shelf:'bin'});c.data.shelf='bin';animate(c,[0,-.1,-.2],0,680,true);launchParticles(c.pos);selected=null;updateEditbar();setStatus('Object moved to virtual Bin · use Gallery to restore');}
 if(op==='restore'){await window.FreeLab.updateXRObject(id,{shelf:'collection'});c.data.shelf='collection';setStatus('Object restored to collection');}
 
 }catch(e){setStatus('Save failed · '+e.message);}}
async function collapse(){if(!cloud)return openGallery();if(cloud.collapsed){await showCloud(cloud.id);return;}
 cloud.collapsed=true;const dest=vadd([0,.07,.01],cloud.offset||[0,0,0]);cards.forEach((c,i)=>{animate(c,dest,i*35,950,true);});launchParticles(dest);
 if(cloud.id>0)window.FreeLab.updateXRCloud(cloud.id,{collapsed:true}).catch(e=>setStatus(e.message));setStatus('Cloud collapsing · tap ▣ for saved captures',4500);
 setTimeout(()=>{if(cloud?.collapsed){clearCards();cloud=null;selected=null;updateEditbar();}},1350);}
async function action(id){const t=performance.now();if(t-lastAction<200)return;lastAction=t;
 switch(id){case 'capture':return makeCapture();case 'extract':return runExtract();case 'sam':return runSam();
 case 'prompt':return openPrompt();case 'refine':return runSam();case 'voice':return voicePrompt();case 'apply':return applyPrompt();case 'keyboard':return keyboardPrompt();case 'cancel':return closePrompt();
 case 'follow':return toggleFollow();case 'gallery':return openGallery();case 'collapse':return collapse();
 case 'exit':return session?.end();case 'bin':return selected?.kind==='object'?changeObject('bin'):openBin();case 'folder':return changeObject('folder');}}
async function start(){if(session)return;if(!navigator.xr||!await navigator.xr.isSessionSupported('immersive-ar'))throw Error('Use Meta Quest Browser with immersive-ar support');
 setup();await gl.makeXRCompatible();session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local'],optionalFeatures:['local-floor','hand-tracking','plane-detection','anchors','dom-overlay'],domOverlay:{root:document.getElementById('xrPromptEditor')}});xrDomOverlay=Boolean(session.domOverlayState);session.updateRenderState({baseLayer:new XRWebGLLayer(session,gl,{alpha:true,antialias:false})});
 try{refSpace=await session.requestReferenceSpace('local-floor');}catch{refSpace=await session.requestReferenceSpace('local');}poseReady=false;
 session.addEventListener('selectstart',e=>{lastNative.set(e.inputSource,performance.now());grabStart(e.frame,e.inputSource);});
 session.addEventListener('selectend',e=>{lastNative.set(e.inputSource,performance.now());grabEnd(e.inputSource,e.frame);});
 session.addEventListener('squeeze',e=>{if(!held&&latestPose){root=viewerAnchor(latestPose,-.04,1.35);rootYaw=yawFromMatrix(latestPose.transform.matrix);setStatus('Spatial collection recentered');}});
 session.addEventListener('end',()=>{session=null;poseReady=false;held=null;clearCards();cloud=null;for(const z of zones)gl.deleteTexture(z.front);zones=[];if(toolbar?.front)gl.deleteTexture(toolbar.front);if(statusCard?.front)gl.deleteTexture(statusCard.front);toolbar=null;statusCard=null;editbar=null;if(promptPanel?.front)gl.deleteTexture(promptPanel.front);promptPanel=null;window.FreeLab?.notify?.('Exited spatial collection');});
 const saved=await window.FreeLab.listXRClouds().catch(()=>[]);clouds=saved;setStatus('CAPTURE → EXTRACT → PROMPT · camera pixels required',8500);session.requestAnimationFrame(updateView);
}
window.FreeLabXR={start,isRunning:()=>!!session};
})();
