/* FREELAB v0.10.23 — pure XR frame/photo geometry. No GPU or camera access here.
 * A crop projected through an XR eye is an approximation when the video camera
 * is not hardware-calibrated to the viewer; never call it passthrough pixels. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FreeLabFramePhoto=api;})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mag=v=>Math.hypot(...v);
const mul=(a,b)=>{const out=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let i=0;i<4;i++)out[c*4+r]+=a[i*4+r]*b[c*4+i];return out;};
const validCorners=c=>Array.isArray(c)&&c.length===4&&c.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
function frameAspect(c){if(!validCorners(c))return 1.5;const w=(mag(sub(c[1],c[0]))+mag(sub(c[2],c[3])))/2,h=(mag(sub(c[3],c[0]))+mag(sub(c[2],c[1])))/2;return clamp(w/Math.max(.01,h),.35,4.5);}
function projectedCrop(corners,views){
 if(!validCorners(corners)||!Array.isArray(views)||!views.length)return null;
 const projected=[];
 for(const view of views.slice(0,2)){
  const p=view?.projectionMatrix,m=view?.transform?.inverse?.matrix;
  if(!p||!m||p.length!==16||m.length!==16)continue;
  const mat=mul(p,m),vertices=[];
  for(const v of corners){const w=mat[3]*v[0]+mat[7]*v[1]+mat[11]*v[2]+mat[15];if(w<=.05)break;
   const nx=(mat[0]*v[0]+mat[4]*v[1]+mat[8]*v[2]+mat[12])/w;
   const ny=(mat[1]*v[0]+mat[5]*v[1]+mat[9]*v[2]+mat[13])/w;
   if(!Number.isFinite(nx)||!Number.isFinite(ny))break;
   vertices.push([(.5+.5*nx),(.5-.5*ny)]);
  }
  if(vertices.length===4)projected.push(vertices);
 }
 if(!projected.length)return null;
 const mean=corners.map((_,i)=>[projected.reduce((n,v)=>n+v[i][0],0)/projected.length,projected.reduce((n,v)=>n+v[i][1],0)/projected.length]);
 const xs=mean.map(x=>x[0]),ys=mean.map(x=>x[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 if(maxX<0||minX>1||maxY<0||minY>1)return null;
 // Trim the edges slightly rather than expanding to unrelated room content.
 const width=clamp((maxX-minX)*.91,.045,.9),height=clamp((maxY-minY)*.91,.045,.9);
 return {x:clamp((minX+maxX-width)/2,0,1-width),y:clamp((minY+maxY-height)/2,0,1-height),width,height,aspect:frameAspect(corners),calibration:'approximate-xr-projection'};
}
function cropRect(crop,imageWidth,imageHeight){
 if(!crop||!Number.isFinite(imageWidth)||!Number.isFinite(imageHeight)||imageWidth<1||imageHeight<1)return null;
 const cx=clamp(crop.x+crop.width/2,0,1),cy=clamp(crop.y+crop.height/2,0,1);
 // For a rectilinear panel choose an INSCRIBED crop, preserving the framed subject.
 let pw=clamp(crop.width,.045,.96)*imageWidth,ph=clamp(crop.height,.045,.96)*imageHeight;
 const aspect=clamp(crop.aspect||pw/ph,.35,4.5);if(pw/ph>aspect)pw=ph*aspect;else ph=pw/aspect;
 pw=clamp(pw,24,imageWidth);ph=clamp(ph,24,imageHeight);
 return {sx:clamp(cx*imageWidth-pw/2,0,imageWidth-pw),sy:clamp(cy*imageHeight-ph/2,0,imageHeight-ph),sw:pw,sh:ph,aspect};
}
// Distance from a tracked fingertip to the FILLED 3D quadrilateral, not just its thin edges.
function panelContact(p,corners,tolerance=.13){
 if(!validCorners(corners)||!Array.isArray(p)||p.length!==3)return null;
 const a=corners[0],u=sub(corners[1],a),v=sub(corners[3],a),q=sub(p,a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),den=uu*vv-uv*uv;
 if(den<1e-9)return null;
 const uq=dot(q,u),vq=dot(q,v),s=(uq*vv-vq*uv)/den,t=(vq*uu-uq*uv)/den;
 const closest=a.map((x,i)=>x+s*u[i]+t*v[i]);const d=mag(sub(p,closest));
 if(s<-.045||s>1.045||t<-.045||t>1.045||d>tolerance)return null;
 return {distance:d,u:s,v:t};
}
return {frameAspect,projectedCrop,cropRect,panelContact};
});
