/* FREE LAB v0.10.11 -- local hand-shape sorting game. No network, no inference. */
(()=>{'use strict';
const d=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const middle=pts=>pts[0].map((v,i)=>pts.reduce((sum,p)=>sum+p[i],0)/pts.length);
const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const fingerNames=['index','middle','ring','pinky','thumb'];
// Pick the actual contacting fingertip, not the first tracked finger (all five are tracked).
// Either hand may carry the thumb/index pair. Freeze the chosen finger once attached.
function triangle(left,right,base='auto',chosen=null){
 const options=[];
 for(const side of base==='auto'?['left','right']:[base]){
  const hand=side==='left'?left:right,opposite=side==='left'?right:left;
  if(!valid(hand?.thumb)||!valid(hand?.index))continue;
  for(const name of chosen?[chosen]:fingerNames){if(!valid(opposite?.[name]))continue;
   const points=[hand.thumb,hand.index,opposite[name]];
   const e=points.map((p,i)=>d(p,points[(i+1)%3])),semiperimeter=e.reduce((a,b)=>a+b,0)/2;
   const area=Math.sqrt(Math.max(0,semiperimeter*(semiperimeter-e[0])*(semiperimeter-e[1])*(semiperimeter-e[2])));
   const score=e[0]+e[2];
   options.push({corners:points.map(p=>[...p]),center:middle(points),area,other:name,base:side,score});
  }
 }
 options.sort((a,b)=>a.score-b.score);
 return options[0]||null;
}
class TriangleDraw{
 constructor(){this.reset();this.nextId=100000;}
 reset(){this.phase='ready';this.armed=false;this.live=null;this.contactSince=0;this.formedSince=0;this.active=null;}
 update({left={},right={},time=0}={}){
  const t=this.active?triangle(left,right,this.active.base,this.active.other):triangle(left,right),close=!!(t&&d(t.corners[0],t.corners[1])<.067&&d(t.corners[0],t.corners[2])<.075);
  let event=null,placed=null;
  if(this.phase==='ready'){
   if(!close)this.armed=true;
   if(close&&this.armed){if(!this.contactSince)this.contactSince=time;
    if(time-this.contactSince>140){this.phase='stretch';this.live=t;this.active={base:t.base,other:t.other};this.formedSince=0;event='attach';}}
   else this.contactSince=0;
  }else if(this.phase==='stretch'){
   if(!t){if(this.live?.area>.003){placed={id:this.nextId++,corners:this.live.corners.map(p=>[...p]),shape:'triangle',createdAt:time};event='place';}
    this.phase='cooldown';this.live=null;this.active=null;
   }else{this.live=t;
    if(t.area>.003&&t.corners.every((p,i)=>d(p,t.corners[(i+1)%3])>.095)){
     if(!this.formedSince)this.formedSince=time;
     if(time-this.formedSince>300){placed={id:this.nextId++,corners:t.corners.map(p=>[...p]),shape:'triangle',createdAt:time};event='place';this.phase='cooldown';this.live=null;this.active=null;}}
    else this.formedSince=0;
   }
  }else if(!close){this.phase='ready';this.armed=true;this.active=null;this.contactSince=0;}
  return {event,placed,live:this.live};
 }
}
function accept(shape,target){return shape===target;}
function targetHit(frame,centers,radius=.25){const center=middle(frame.corners),shape=frame.shape||'rectangle';
 const closest=centers.map(c=>({...c,distance:d(center,c.center)})).sort((a,b)=>a.distance-b.distance)[0];
 return closest&&closest.distance<radius?{...closest,accept:accept(shape,closest.shape)}:null;
}
window.FreeLabShapeSort={TriangleDraw,triangle,targetHit,accept};
})();
