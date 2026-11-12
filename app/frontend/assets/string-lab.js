/* FREE LAB 0.9.3 — experimental thumb-to-thumb elastic string.
   Pure tracked-pose state machine: no camera, network, inference, or database access. */
(()=>{'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const copy=a=>a?[...a]:null;
class Experiment {
 constructor(){this.enabled=false;this.mode='idle';this.touchSince=null;this.rearm=true;this.broken=null;this.left=null;this.right=null;this.span=0;}
 toggle(){return this.setEnabled(!this.enabled);}
 setEnabled(enabled){this.enabled=Boolean(enabled);this.mode='idle';this.touchSince=null;this.rearm=true;this.broken=null;this.left=null;this.right=null;this.span=0;return this.enabled;}
 update({left=null,right=null,time=0}){
  if(!this.enabled)return {mode:'off',event:null};
  const both=Array.isArray(left)&&Array.isArray(right)&&left.length===3&&right.length===3&&[...left,...right].every(Number.isFinite);
  const span=both?distance(left,right):0;
  let event=null;
  if(this.mode==='linked'){
   if(!both){this.mode='idle';this.touchSince=null;event='lost';}
   else if(span>=1.0){
    this.mode='snapped';this.rearm=false;this.touchSince=null;
    this.broken={start:time,left:copy(left),right:copy(right),length:span};
    event='snap';
   }
  }else if(this.mode==='snapped'){
   if(both&&span>.105)this.rearm=true;
   if(time-this.broken.start>1700){this.mode='idle';this.broken=null;this.touchSince=null;}
  }else if(this.mode==='idle'){
   if(both&&span>.105)this.rearm=true;
   if(!both||span>.052||!this.rearm){this.touchSince=null;}
   else if(this.touchSince===null)this.touchSince=time;
   else if(time-this.touchSince>=160){this.mode='linked';event='attach';this.touchSince=null;}
  }
  this.left=copy(left);this.right=copy(right);this.span=span;
  return {mode:this.mode,event,enabled:true,left:copy(left),right:copy(right),span,
   tension:clamp(span/1.0,0,1),broken:this.broken?{...this.broken}:null};
 }
}
function isRightThumbstickPressed(sources){
 for(const src of sources||[]){
  if(src.handedness!=='right'||src.hand||!src.gamepad)continue;
  // xr-standard's thumbstick push is buttons[3], not the joystick axes.
  if(src.gamepad.mapping==='xr-standard'&&src.gamepad.buttons?.[3]?.pressed)return true;
 }
 return false;
}
window.FreeLabStringLab={Experiment,isRightThumbstickPressed,distance};
})();
