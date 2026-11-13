/* FREELAB XR appearance and feature switches. All configuration is private to this browser. */
(function(root){'use strict';
 const KEY='freelab-xr-ui-v1';
 const defaults=Object.freeze({theme:'current',borders:true,backgrounds:true,mascot:true,experimental:true,masked:true,voice:true,processing:'spin',generated:null});
 const choices=['current','dark','night','liquid'];
 const processing=['spin','glow','gradient','particles1','particles2','particles3'];
 const fonts=['system-ui','Arial','Verdana','Trebuchet MS','Georgia'];
 const base={
  current:{panel:'#343d38',panel2:'#26332d',text:'#f0f9f1',muted:'#b8cfc0',accent:'#ff91b5',edge:'#92b8a2',bottom:'#14251c',font:'system-ui'},
  dark:{panel:'#25292e',panel2:'#1c2328',text:'#f7f8f9',muted:'#c0c7d0',accent:'#ff8cae',edge:'#73808f',bottom:'#11151b',font:'Arial'},
  night:{panel:'#171728',panel2:'#121120',text:'#f7f3ff',muted:'#c6bddc',accent:'#ff8cc5',edge:'#77749b',bottom:'#080813',font:'Verdana'},
  liquid:{panel:'#153f48',panel2:'#113139',text:'#e7feff',muted:'#b3e6e6',accent:'#ffadcb',edge:'#82d3d3',bottom:'#09272d',font:'Trebuchet MS'}
 };
 function contrast(a,b){const lum=hex=>{let nums=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return nums[0]*.2126+nums[1]*.7152+nums[2]*.0722;};let x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
 function hex(h,s,l){s/=100;l/=100;const f=n=>{const k=(n+h/30)%12,a=s*Math.min(l,1-l);return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};return '#'+f(0)+f(8)+f(4);}
 function valid(raw){const o={...defaults};if(raw&&typeof raw==='object'){
  if(choices.includes(raw.theme))o.theme=raw.theme;
  if(processing.includes(raw.processing))o.processing=raw.processing;
  for(const k of ['borders','backgrounds','mascot','experimental','masked','voice'])if(typeof raw[k]==='boolean')o[k]=raw[k];
  if(raw.generated&&typeof raw.generated==='object'&&/^#[0-9a-f]{6}$/i.test(raw.generated.panel||'')&&/^#[0-9a-f]{6}$/i.test(raw.generated.panel2||'')&&/^#[0-9a-f]{6}$/i.test(raw.generated.accent||'')){
   const p=raw.generated;
   o.generated={panel:p.panel,panel2:p.panel2,text:contrast(p.panel,'#f7fbff')>=7?'#f7fbff':'#101820',muted:contrast(p.panel,'#c7dce0')>=4.5?'#c7dce0':'#1b2830',accent:p.accent,edge:p.edge||'#93c6b5',bottom:p.bottom||'#06191b',font:fonts.includes(p.font)?p.font:'system-ui'};
  }
 }return o;}
 function read(){try{return valid(JSON.parse(root.localStorage.getItem(KEY)||'{}'));}catch{return valid(null);}}
 function save(o){const next=valid(o);try{root.localStorage.setItem(KEY,JSON.stringify(next));}catch{}return next;}
 function palette(o){return o?.generated||base[o?.theme]||base.current;}
 function generate(random=Math.random){const hue=Math.floor(random()*360),hue2=(hue+24+Math.floor(random()*31))%360;
  const panel=hex(hue,25+Math.floor(random()*20),12+Math.floor(random()*8));
  const panel2=hex(hue2,22+Math.floor(random()*30),9+Math.floor(random()*9));
  const light='#f7fbff',dark='#111b23',text=contrast(panel,light)>=7?light:dark;
  const muted=contrast(panel,'#cde2e3')>=4.5?'#cde2e3':(contrast(panel,'#15212a')>=4.5?'#15212a':text);
  const accent=hex((hue+145)%360,69,78);
  return {panel,panel2,text,muted,accent,edge:hex(hue,36,54),bottom:hex(hue2,42,7),font:fonts[Math.floor(random()*fonts.length)]};
 }
 root.FreeLabXRUI={defaults,choices,processing,fonts,base,read,save,palette,generate,valid,contrast};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.FreeLabXRUI;
})(typeof window!=='undefined'?window:globalThis);
