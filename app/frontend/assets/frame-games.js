/* FREE LAB v0.10.8: three offline spatial games. No network or AI inference.
 * A bounded, fixed-step rigid-box solver keeps Quest frame-time predictable;
 * use Rapier/WASM for complex collision shapes when the engine is vendored.
 */
(()=>{'use strict';
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a),unit=a=>mul(a,1/(len(a)||1));
const mid=(a,b)=>mul(add(a,b),.5),clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const center=f=>mul(f.corners.reduce((a,p)=>add(a,p),[0,0,0]),.25);
const copied=c=>c.map(p=>p.slice());
function segmentContact(a,b,c,d){
 // Shortest distance between 3D line segments, robust for near-parallel edges.
 const u=sub(b,a),v=sub(d,c),w=sub(a,c),A=dot(u,u),B=dot(u,v),C=dot(v,v),D=dot(u,w),E=dot(v,w);
 const denom=A*C-B*B;let s=denom>1e-9?clamp((B*E-C*D)/denom,0,1):0;
 let t=clamp((B*s+E)/(C||1),0,1);s=clamp((B*t-D)/(A||1),0,1);
 return {dist:len(sub(add(a,mul(u,s)),add(c,mul(v,t)))),point:mid(add(a,mul(u,s)),add(c,mul(v,t)))};
}
function nearestEdge(a,b){let found=null;
 for(let i=0;i<4;i++)for(let j=0;j<4;j++){
  const c=segmentContact(a.corners[i],a.corners[(i+1)%4],b.corners[j],b.corners[(j+1)%4]);
  if(!found||c.dist<found.dist)found=c;
 }return found;
}
// Test the filled plane of a wire frame, not merely its thin outline.
// Both triangles are considered, so a fast frame can hit a small flying mascot.
function pointSegmentDistance(p,a,b){const edge=sub(b,a),t=clamp(dot(sub(p,a),edge)/(dot(edge,edge)||1),0,1);
 return len(sub(p,add(a,mul(edge,t))));}
function pointTriangleDistance(p,a,b,c){const ab=sub(b,a),ac=sub(c,a),normal=cross(ab,ac),n2=dot(normal,normal);
 if(n2>1e-12){const planeDist=dot(sub(p,a),normal)/Math.sqrt(n2);
  const projection=sub(p,mul(normal,dot(sub(p,a),normal)/n2));
  const ap=sub(projection,a),d00=dot(ab,ab),d01=dot(ab,ac),d11=dot(ac,ac),d20=dot(ap,ab),d21=dot(ap,ac),den=d00*d11-d01*d01;
  if(Math.abs(den)>1e-12){const v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den;
   if(v>=-1e-6&&w>=-1e-6&&v+w<=1+1e-6)return Math.abs(planeDist);}
 }
 return Math.min(pointSegmentDistance(p,a,b),pointSegmentDistance(p,b,c),pointSegmentDistance(p,c,a));
}
function frameSphereHit(corners,p,radius=.14){if(!Array.isArray(corners)||corners.length!==4||!finite(p))return false;
 return pointTriangleDistance(p,corners[0],corners[1],corners[2])<=radius ||
  pointTriangleDistance(p,corners[0],corners[2],corners[3])<=radius;
}
function sweptFrameSphereHit(before,after,p,radius=.14){if(!before||!after||!finite(p))return false;
 // Six steps prevent most tunnelling at the throw speed cap of 4.5 metres/s.
 for(let step=0;step<=6;step++){const t=step/6;
  const corners=before.map((v,i)=>add(v,mul(sub(after[i],v),t)));
  if(frameSphereHit(corners,p,radius))return true;
 }return false;
}
function rotateVector(a,b,v){ // shortest-arc rotation to swing whole frame around its hinge
 const u=unit(a),w=unit(b),dp=clamp(dot(u,w),-1,1);
 if(dp>.99999)return v;
 if(dp<-.99999){let axis=unit(cross(u,[1,0,0]));if(len(axis)<.01)axis=unit(cross(u,[0,0,1]));return add(mul(axis,2*dot(axis,v)),mul(v,-1));}
 const axis=unit(cross(u,w)),s=Math.sqrt(1-dp*dp);
 return add(add(mul(v,dp),mul(cross(axis,v),s)),mul(axis,dot(axis,v)*(1-dp)));
}
function boxFromFrame(f,floorY=0){
 const w=clamp(f.width||len(sub(f.corners[1],f.corners[0])),.10,.85);
 const h=clamp(f.height||len(sub(f.corners[0],f.corners[3])),.09,.8);
 const d=clamp(Math.min(w,h)*.85,.10,.65); // a shallow cuboid by default
 const c=center(f),bottom=c[1]-h*.5;
 return {id:f.id,center:[...c],velocity:[0,0,0],half:[w/2,h/2,d/2],rotation:[0,0,0],angVel:[0,0,0],mass:Math.max(.2,w*h*d*22),
  floorY,createdAt:f.createdAt||0,settled:false};
}
function resolvePair(a,b){ // limited axis-aligned broadphase for this small lab
 const dx=b.center[0]-a.center[0],dy=b.center[1]-a.center[1],dz=b.center[2]-a.center[2];
 const px=a.half[0]+b.half[0]-Math.abs(dx),py=a.half[1]+b.half[1]-Math.abs(dy),pz=a.half[2]+b.half[2]-Math.abs(dz);
 if(px<=0||py<=0||pz<=0)return false;
 const axis=(py<=px&&py<=pz)?1:(px<=pz?0:2),delta=[dx,dy,dz][axis],depth=[px,py,pz][axis];
 const sign=delta>=0?1:-1,wa=1/a.mass,wb=1/b.mass,total=wa+wb;
 a.center[axis]-=sign*(depth+.0001)*wa/total;
 b.center[axis]+=sign*(depth+.0001)*wb/total;
 const closing=(b.velocity[axis]-a.velocity[axis])*sign;
 if(closing<0){const impulse=-(1+.20)*closing/total;
  a.velocity[axis]-=impulse*wa*sign;b.velocity[axis]+=impulse*wb*sign;
 }
 // Friction for stable short stacks.
 if(axis===1){for(const k of [0,2]){a.velocity[k]*=.94;b.velocity[k]*=.94;}}
 return true;
}
class Engine{
 constructor(){this.clear();}
 clear(){this.boxes=[];this.links=[];this.throws=[];this.mode='off';this.lastTime=null;this.floorY=0;this.events=[];}
 setMode(m){this.mode=m;this.lastTime=null;}
 setFloor(y){if(Number.isFinite(y))this.floorY=y;}
 onFrame(frame,mode=this.mode,time=0){
  if(!frame||!Array.isArray(frame.corners)||frame.corners.length!==4)return null;
  frame.gameMode=mode;
  if(mode==='cubes'){
   // Spawn at drawn position and let it fall. The original wire frame is consumed.
   if(this.boxes.length>=22)this.boxes.shift();const box=boxFromFrame(frame,this.floorY);this.boxes.push(box);
   return {event:'cube',id:box.id,removeFrame:true};
  }
  if(mode==='chain'||mode==='throw')return {event:mode,id:frame.id};
  return null;
 }
 linkOnOverlap(frames,heldId){if(this.mode!=='chain')return null;
  const held=frames.find(f=>f.id===heldId&&f.gameMode==='chain');if(!held)return null;
  const descendants=new Set([heldId]);
  for(let iter=0;iter<16;iter++)for(const l of this.links)if(descendants.has(l.childId))descendants.add(l.parentId);
  for(const other of frames){
   if(other.id===heldId||other.gameMode!=='chain'||descendants.has(other.id))continue;
   if(this.links.some(l=>l.childId===other.id))continue;
   const hit=nearestEdge(held,other);if(hit.dist>.080)continue;
   const c=center(other),pivot=hit.point,r=clamp(len(sub(c,pivot)),.09,1.2);
   this.links.push({parentId:heldId,childId:other.id,pivotOffset:sub(pivot,center(held)),
    anchor:copied(other.corners),startDir:sub(c,pivot),radius:r,center:c.slice(),previous:c.slice(),lastPivot:pivot.slice()});
   return {event:'link',parentId:heldId,childId:other.id};
  }return null;
 }
 launch(frames,id,velocity,time){if(this.mode!=='throw')return null;
  const f=frames.find(q=>q.id===id&&q.gameMode==='throw');if(!f)return null;
  const speed=len(velocity);if(!Number.isFinite(speed)||speed<.28)return null;
  const v=mul(velocity,clamp(speed,.45,4.5)/(speed||1));
  this.throws.push({id,velocity:v,start:time,until:time+1600,alpha:1});
  return {event:'throw',id,speed:len(v)};
 }
 update(frames,time,opts={}){
  const events=[];const floor=Number.isFinite(opts.floorY)?opts.floorY:this.floorY;
  // Clamp dt to avoid huge leaps after Quest Browser suspends a tab.
  const dt=this.lastTime===null?0:clamp((time-this.lastTime)/1000,0,.045);this.lastTime=time;
  // A few small steps improve stack stability without introducing a WASM download.
  const N=dt>0?Math.max(1,Math.ceil(dt/(1/90))):0;
  for(let step=0;step<N;step++){
   const h=dt/N;
   for(const b of this.boxes){b.velocity[1]-=9.81*h;
    b.velocity=mul(b.velocity,Math.exp(-.28*h));b.center=add(b.center,mul(b.velocity,h));
    if(b.center[1]-b.half[1]<floor){b.center[1]=floor+b.half[1];if(b.velocity[1]<0)b.velocity[1]*=-.22;
     b.velocity[0]*=.91;b.velocity[2]*=.91;if(Math.abs(b.velocity[1])<.08)b.velocity[1]=0;
    }
   }
   for(let pass=0;pass<3;pass++)for(let i=0;i<this.boxes.length;i++)for(let j=i+1;j<this.boxes.length;j++)resolvePair(this.boxes[i],this.boxes[j]);
   for(const l of this.links){const parent=frames.find(f=>f.id===l.parentId),child=frames.find(f=>f.id===l.childId);
    if(!parent||!child)continue;
    const pivot=add(center(parent),l.pivotOffset);
    const old=l.center.slice(),vel=mul(sub(l.center,l.previous),.975);
    let next=add(add(l.center,vel),[0,-9.81*h*h,0]);
    const radial=sub(next,pivot);next=add(pivot,mul(unit(len(radial)>.00001?radial:[0,-1,0]),l.radius));
    l.previous=old;l.center=next;l.lastPivot=pivot;
    // Rigid frame rotation around the link point, plus translation.
    const newDir=sub(next,pivot),oldDir=l.startDir;
    const origCenter=mul(l.anchor.reduce((a,p)=>add(a,p),[0,0,0]),.25);
    child.corners=l.anchor.map(p=>add(next,rotateVector(oldDir,newDir,sub(p,origCenter))));
   }
  }
  for(const fly of this.throws){const f=frames.find(q=>q.id===fly.id);if(!f)continue;
   const u=clamp((time-fly.start)/1600,0,1);
   const before=copied(f.corners),shift=mul(fly.velocity,dt);f.corners=f.corners.map(p=>add(p,shift));
   if(!fly.hitMascot&&finite(opts.mascot)&&sweptFrameSphereHit(before,f.corners,opts.mascot,opts.mascotRadius||.14)){
    fly.hitMascot=true;events.push({event:'mascot-hit',id:fly.id,position:opts.mascot.slice()});
   }
   fly.alpha=clamp((1-u)/.35,0,1);
   if(time>=fly.until){const index=frames.indexOf(f);if(index>=0)frames.splice(index,1);events.push({event:'vanish',id:fly.id});}
  }
  this.throws=this.throws.filter(f=>f.until>time);
  this.links=this.links.filter(l=>frames.some(f=>f.id===l.parentId)&&frames.some(f=>f.id===l.childId));
  return {events,boxes:this.boxes,links:this.links,throws:this.throws};
 }
 resetGames(){this.boxes=[];this.links=[];this.throws=[];this.lastTime=null;}
}
window.FreeLabFrameGames={Engine,segmentContact,nearestEdge,boxFromFrame,resolvePair,rotateVector,frameSphereHit,sweptFrameSphereHit};
})();
