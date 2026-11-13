/* FREELAB v0.9.6 — hand-drawn, world-locked spatial frames.
 * Pure fingertip geometry and state machine: no paid inference, camera or server.
 * Pair left/right index tips and left/right thumb tips, then stretch a frame.
 */
(()=>{'use strict';
const JOINTS=Object.freeze(['thumb-tip','index-finger-tip']);
const CONTACT_METRES=.067, RELEASE_METRES=.120, DEBOUNCE_MS=160;
const copy=p=>Array.isArray(p)?p.slice():null;
const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,n)=>a.map(v=>v*n);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const norm=a=>Math.hypot(...a);
const unit=a=>norm(a)>1e-6?mul(a,1/norm(a)):null;
const distance=(a,b)=>norm(sub(a,b));
const mean=(a,b)=>mul(add(a,b),.5);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rectangle(left,right){
 if(!valid(left?.thumb)||!valid(left?.index)||!valid(right?.thumb)||!valid(right?.index))return null;
 const c=mean(mean(left.thumb,left.index),mean(right.thumb,right.index));
 const sideways=sub(mean(right.thumb,right.index),mean(left.thumb,left.index));
 const width=norm(sideways),horizontal=unit(sideways);
 if(!horizontal)return null;
 const tall=sub(mean(left.index,right.index),mean(left.thumb,right.thumb));
 const orth=sub(tall,mul(horizontal,dot(tall,horizontal)));
 const height=norm(orth),vertical=unit(orth);
 if(!vertical)return null;
 const halfW=mul(horizontal,width*.5),halfH=mul(vertical,height*.5);
 const corners=[add(sub(c,halfW),halfH),add(add(c,halfW),halfH),sub(add(c,halfW),halfH),sub(sub(c,halfW),halfH)];
 return {corners,width,height,center:c,area:width*height};
}
function contact(left,right){
 return !!(valid(left?.thumb)&&valid(left?.index)&&valid(right?.thumb)&&valid(right?.index)
 &&distance(left.thumb,right.thumb)<CONTACT_METRES
 &&distance(left.index,right.index)<CONTACT_METRES);
}
function separated(left,right){
 if(!valid(left?.thumb)||!valid(left?.index)||!valid(right?.thumb)||!valid(right?.index))return false;
 return distance(left.thumb,right.thumb)>RELEASE_METRES&&distance(left.index,right.index)>RELEASE_METRES;
}
// Keep the fingertip contact point fixed while applying full hand orientation.
// Wrist joint quaternions are WebXR local-floor orientations [x,y,z,w].
function transformGrab(corners,startIndex,currentIndex,startQuaternion,currentQuaternion){
 const normalized=q=>{const d=Math.hypot(...q)||1;return q.map(n=>n/d);};
 const rotate=(q,v)=>{const [x,y,z,w]=q;
  const tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);
  return [v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];};
 let q=[0,0,0,1];
 if(Array.isArray(startQuaternion)&&Array.isArray(currentQuaternion)){
  const a=normalized(startQuaternion),b=normalized(currentQuaternion);
  const [x,y,z,w]=b,[X,Y,Z,W]=[-a[0],-a[1],-a[2],a[3]];
  q=normalized([w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]);
 }
 return corners.map(p=>add(currentIndex,rotate(q,sub(p,startIndex))));
}
class Experiment{
 constructor(){this.enabled=false;this.holdSeconds=3;this.frames=[];this.nextId=1;this.reset();}
 reset(){this.mode='idle';this.touchSince=null;this.stretchSince=null;this.armed=false;this.current=null;this.progress=0;}
 setEnabled(value){this.enabled=Boolean(value);this.reset();return this.enabled;}
 setHoldSeconds(seconds){const n=Number(seconds);this.holdSeconds=[1.5,3,5].includes(n)?n:3;return this.holdSeconds;}
 clear(){this.frames=[];this.nextId=1;this.reset();}
 update({left=null,right=null,time=0}={}){
  const frame=rectangle(left,right);let event=null;
  if(!this.enabled)return {enabled:false,mode:'off',event:null,frames:this.frames,live:null,progress:0};
  if(this.mode==='idle'){
   if(separated(left,right))this.armed=true;
   if(!contact(left,right)||!this.armed)this.touchSince=null;
   else if(this.touchSince===null)this.touchSince=time;
   else if(time-this.touchSince>=DEBOUNCE_MS){this.mode='forming';this.current=frame;this.touchSince=null;this.stretchSince=null;event='attach';}
  }else if(this.mode==='forming'){
   if(!frame){this.reset();event='lost';}
   else{
    this.current=frame;
    const stretched=frame.width>=.13&&frame.height>=.045&&frame.area>=.007;
    if(!stretched){this.stretchSince=null;this.progress=0;}
    else{
     if(this.stretchSince===null){this.stretchSince=time;event='countdown';}
     this.progress=clamp((time-this.stretchSince)/(this.holdSeconds*1000),0,1);
     if(this.progress>=1){
      this.frames.push({id:this.nextId++,corners:frame.corners.map(copy),width:frame.width,height:frame.height,createdAt:time});
      if(this.frames.length>32)this.frames.shift();
      this.mode='cooldown';this.current=null;this.armed=false;this.stretchSince=null;this.progress=0;event='place';
     }
    }
   }
  }else if(this.mode==='cooldown'){
   if(separated(left,right)){this.mode='idle';this.armed=true;this.touchSince=null;}
  }
  return {enabled:true,mode:this.mode,event,frames:this.frames,live:this.current,progress:this.progress,holdSeconds:this.holdSeconds};
 }
}
window.FreeLabFrameLab={Experiment,JOINTS,rectangle,contact,separated,transformGrab};
})();
