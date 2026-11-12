/* FREELAB v0.9.5 — stable continuous XR string ribbons.
 * A shared, mitered pair of vertices at each path sample removes the gaps,
 * overlapping per-segment quads and depth conflicts in the old glow/core stack.
 * Pure geometry: no WebGL dependency and no model inference. */
(()=>{'use strict';
 const subtract=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
 const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
 const mult=(a,n)=>[a[0]*n,a[1]*n,a[2]*n];
 const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const magnitude=a=>Math.hypot(a[0],a[1],a[2]);
 const unit=a=>{const n=magnitude(a);return n>1e-8?mult(a,1/n):null;};
 const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 function sideFor(a,b,eye){
  const tangent=unit(subtract(b,a))||[0,1,0];
  const mid=mult(add(a,b),.5),view=unit(subtract(eye,mid))||[0,0,1];
  // If the string points straight at the viewer, select a stable fallback axis.
  return unit(cross(tangent,view))||unit(cross(tangent,[0,1,0]))||unit(cross(tangent,[1,0,0]))||[1,0,0];
 }
 function buildRibbon(path,eye,width){
  if(!Array.isArray(path)||path.length<2||!finite(eye)||!Number.isFinite(width)||width<=0)return new Float32Array(0);
  if(path.some(p=>!finite(p)))return new Float32Array(0);
  const sides=[];
  for(let i=0;i<path.length-1;i++){
   let side=sideFor(path[i],path[i+1],eye);
   if(i>0&&dot(side,sides[i-1])<0)side=mult(side,-1);
   sides.push(side);
  }
  const out=new Float32Array(path.length*2*4);
  let k=0;
  for(let i=0;i<path.length;i++){
   const prev=sides[Math.max(0,i-1)],next=sides[Math.min(sides.length-1,i)];
   const joined=unit(add(prev,next))||next;
   // Limit miter extension at sharp turns to prevent huge visible triangles.
   const miter=Math.min(1.45,1/Math.max(.69,Math.abs(dot(joined,next))));
   const edge=mult(joined,width*.5*miter);
   // Draw the ribbon a few millimeters toward the viewer to keep it separate
   // from tracked-joint point sprites at exactly the same finger depth.
   const toEye=unit(subtract(eye,path[i]))||[0,0,1];
   const center=add(path[i],mult(toEye,.002));
   for(const sign of [1,-1]){
    const p=add(center,mult(edge,sign));
    out[k++]=p[0];out[k++]=p[1];out[k++]=p[2];out[k++]=sign;
   }
  }
  return out;
 }
 window.FreeLabStrandGeometry={buildRibbon};
})();
