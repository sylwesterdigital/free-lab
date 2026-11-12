/* FREELAB 0.9.4 — five independent hand-to-hand melodic strings.
   Thumb C4, index D4, middle E4, ring F4, little G4; A4 snap punctuation.
   Pure pose simulation, no server communication or paid inference. */
(()=>{'use strict';
const FINGERS=Object.freeze([
 {id:'thumb',joint:'thumb-tip',note:'C4',hz:261.63,breakAt:.77,start:[.10,.94,.72],end:[.98,.74,.13]},
 {id:'index',joint:'index-finger-tip',note:'D4',hz:293.66,breakAt:.86,start:[.19,.69,1.00],end:[.67,.23,.98]},
 {id:'middle',joint:'middle-finger-tip',note:'E4',hz:329.63,breakAt:.94,start:[.55,.44,1.00],end:[1.00,.20,.61]},
 {id:'ring',joint:'ring-finger-tip',note:'F4',hz:349.23,breakAt:.83,start:[.60,1.00,.29],end:[1.00,.36,.06]},
 {id:'little',joint:'pinky-finger-tip',note:'G4',hz:392.00,breakAt:.72,start:[1.00,.51,.72],end:[.85,.16,.22]}
]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const span=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const copy=p=>p?[...p]:null;
function isLeftThumbstickPressed(sources){for(const src of sources||[]){
 if(src.handedness==='left'&&!src.hand&&src.gamepad?.mapping==='xr-standard'&&src.gamepad.buttons?.[3]?.pressed)return true;
}return false;}
function gradient(f,t){return f.start.map((c,i)=>c+(f.end[i]-c)*clamp(t,0,1));}
class Experiment{
 constructor(random=Math.random){this.random=random;this.enabled=false;this.reset();}
 reset(){this.strands=FINGERS.map(f=>({id:f.id,mode:'idle',touchSince:null,rearm:true,limit:f.breakAt,broken:null,left:null,right:null,length:0}));}
 setEnabled(value){this.enabled=Boolean(value);this.reset();return this.enabled;}
 toggle(){return this.setEnabled(!this.enabled);}
 update({left={},right={},time=0}={}){
  if(!this.enabled)return {enabled:false,strands:[],events:[]};
  const events=[];
  for(let i=0;i<FINGERS.length;i++){
   const f=FINGERS[i],s=this.strands[i],a=left?.[f.id],b=right?.[f.id];
   const both=valid(a)&&valid(b),d=both?span(a,b):0;
   if(s.mode==='linked'){
    if(!both){s.mode='idle';s.touchSince=null;events.push({type:'lost',id:f.id,index:i});}
    else if(d>=s.limit){
     s.mode='snapped';s.rearm=false;s.touchSince=null;
     s.broken={start:time,left:copy(a),right:copy(b),length:d};
     events.push({type:'snap',id:f.id,index:i,frequency:440});
    }
   }else if(s.mode==='snapped'){
    if(both&&d>.11)s.rearm=true;
    if(time-s.broken.start>=1650){s.mode='idle';s.broken=null;s.touchSince=null;}
   }else{
    if(both&&d>.11)s.rearm=true;
    if(!both||d>.057||!s.rearm)s.touchSince=null;
    else if(s.touchSince===null)s.touchSince=time;
    else if(time-s.touchSince>=145){
     s.mode='linked';s.touchSince=null;
     // Different breaking distances for each finger plus a small per-attachment variation.
     const n=Number(this.random());const jitter=Number.isFinite(n)?clamp(n,0,1)*.12-.06:0;
     s.limit=f.breakAt+jitter;
     events.push({type:'attach',id:f.id,index:i,frequency:f.hz,limit:s.limit});
    }
   }
   s.left=both?copy(a):null;s.right=both?copy(b):null;s.length=d;
  }
  const strands=this.strands.map((s,i)=>({id:s.id,note:FINGERS[i].note,hz:FINGERS[i].hz,mode:s.mode,
   left:copy(s.left),right:copy(s.right),length:s.length,limit:s.limit,
   tension:clamp(s.length/s.limit,0,1),start:[...FINGERS[i].start],end:[...FINGERS[i].end],
   broken:s.broken?{...s.broken,left:copy(s.broken.left),right:copy(s.broken.right)}:null}));
  return {enabled:true,strands,events};
 }
}
window.FreeLabFingerLab={Experiment,FINGERS,isLeftThumbstickPressed,gradient};
})();
