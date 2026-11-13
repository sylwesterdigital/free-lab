/* FREELAB v0.9.6 — one universal left-thumbstick experiment selector.
 * Hold L3, tilt left/right, release to activate. No thumbstick click = no change.
 */
(()=>{'use strict';
const MODES=Object.freeze(['frames','chain','cubes','throw','five','thumbs','off']);
function controller(sources){for(const s of sources||[]){
 if(s.handedness==='left'&&!s.hand&&s.gamepad?.mapping==='xr-standard'&&s.gamepad.buttons?.[3])return s;
}return null;}
function input(sources){const src=controller(sources),pad=src?.gamepad;
 return {source:src,pressed:!!pad?.buttons?.[3]?.pressed,x:Number(pad?.axes?.[2])||0};}
class Selector{
 constructor(){this.open=false;this.index=0;this.lastIndex=0;this.neutral=true;this.mode='off';}
 update(sources){const v=input(sources);let event=null;
 if(!this.open&&v.pressed){this.open=true;this.index=this.mode==='off'?0:Math.max(0,MODES.indexOf(this.mode));this.neutral=Math.abs(v.x)<.35;event='open';}
 else if(this.open&&v.pressed){
  if(Math.abs(v.x)<.30)this.neutral=true;
  else if(this.neutral&&Math.abs(v.x)>.58){const old=this.index;
   this.index=(this.index+(v.x>0?1:-1)+MODES.length)%MODES.length;
   this.neutral=false;if(old!==this.index)event='step';
  }
 }else if(this.open&&!v.pressed){this.open=false;this.mode=MODES[this.index];this.lastIndex=this.index;event='select';}
 return {open:this.open,index:this.index,mode:this.mode,event,source:v.source};
 }
 reset(){this.open=false;this.index=0;this.mode='off';this.neutral=true;}
}
window.FreeLabLabSelector={Selector,MODES,input};
})();
