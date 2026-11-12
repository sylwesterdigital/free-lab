/* FREELAB 0.9 — local geometric WebXR hand gesture recognizer.
   Uses actual joint positions only; no camera inference, storage or network calls.
   Deliberately conservative; hands must remain in pose for a debounce interval. */
(function(root){'use strict';
const dist=(a,b)=>a&&b?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;
const J=['index','middle','ring','pinky'];
function fingerOpen(joints,name){const w=joints.wrist,tip=joints[name+'-finger-tip'];
 const pip=joints[name+'-finger-phalanx-proximal'],kn=joints[name+'-finger-metacarpal'];
 if(!w||!tip||!pip||!kn)return false;
 return dist(tip,w)>dist(pip,w)*1.35&&dist(tip,kn)>dist(pip,kn)*1.55;}
function classify(j){if(!j?.wrist)return null;
 const thumb=j['thumb-tip'],base=j['thumb-metacarpal'],idx=j['index-finger-tip'];
 if(!thumb||!base||!idx)return null;
 const extended=J.map(n=>fingerOpen(j,n));const [i,m,r,p]=extended;
 const fingersExtended=extended.filter(Boolean).length;
 if(dist(thumb,idx)<.032&&m&&r&&p)return 'OK';
 if(fingersExtended===0){const rise=thumb[1]-base[1];
  if(rise>.035&&dist(thumb,base)>.05)return 'Thumbs up';
  if(rise<-.035&&dist(thumb,base)>.05)return 'Thumbs down';
  return 'Fist';}
 if(i&&!m&&!r&&!p){const kn=j['index-finger-metacarpal'];return kn&&idx[2]<kn[2]-.05?'Forward':'Point';}
 if(fingersExtended===4)return 'Open palm';
 return null;}
function heart(left,right){if(!left||!right)return false;
 const l1=left['index-finger-tip'],r1=right['index-finger-tip'];
 const l2=left['thumb-tip'],r2=right['thumb-tip'];
 const wl=left.wrist,wr=right.wrist;
 return Boolean(l1&&r1&&l2&&r2&&wl&&wr&&dist(l1,r1)<.075&&dist(l2,r2)<.075&&dist(wl,wr)>.09&&dist(wl,wr)<.55);
}
const api={classify,heart,fingerOpen};
if(root)root.FreeLabGestures=api;
if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:null);
