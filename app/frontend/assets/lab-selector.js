/* FREE LAB v0.10.8: X opens persistent experimental selector, L stick steps,
 * left trigger confirms; X while open cancels. Only the left controller may act.
 * Inputs are edge-triggered to prevent held buttons from repeating actions.
 */
(()=>{'use strict';
const MODES=Object.freeze(['frames','chain','cubes','throw','five','thumbs','off']);
function controller(sources){for(const s of sources||[]){
 if(s.handedness==='left'&&!s.hand&&s.gamepad?.mapping==='xr-standard'&&s.gamepad.buttons?.[4])return s;
}return null;}
function input(sources){const src=controller(sources),pad=src?.gamepad;
 return {source:src,xPressed:!!pad?.buttons?.[4]?.pressed,triggerPressed:!!pad?.buttons?.[0]?.pressed,
  x:Number(pad?.axes?.[2])||0};}
class Selector{
 constructor(){this.open=false;this.index=0;this.lastIndex=0;this.neutral=true;this.mode='off';this.prevX=false;this.prevTrigger=false;}
 update(sources){const v=input(sources);let event=null;
  const openEdge=v.xPressed&&!this.prevX,confirmEdge=v.triggerPressed&&!this.prevTrigger;
  if(!this.open&&openEdge){this.open=true;this.index=this.mode==='off'?0:Math.max(0,MODES.indexOf(this.mode));this.neutral=Math.abs(v.x)<.30;event='open';}
  else if(this.open&&openEdge){this.open=false;event='cancel';}
  else if(this.open&&confirmEdge){this.open=false;this.mode=MODES[this.index];this.lastIndex=this.index;event='select';}
  else if(this.open){
   if(Math.abs(v.x)<.30)this.neutral=true;
   else if(this.neutral&&Math.abs(v.x)>.58){this.index=(this.index+(v.x>0?1:-1)+MODES.length)%MODES.length;this.neutral=false;event='step';}
  }
  this.prevX=v.xPressed;this.prevTrigger=v.triggerPressed;
  return {open:this.open,index:this.index,mode:this.mode,event,source:v.source};
 }
 reset(){this.open=false;this.index=0;this.mode='off';this.neutral=true;this.prevX=false;this.prevTrigger=false;}
}
window.FreeLabLabSelector={Selector,MODES,input};
})();
