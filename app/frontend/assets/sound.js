/* FREELAB 0.6 — original procedural audio, no assets or external calls. */
(()=>{'use strict';let ctx=null,lastHover=0,enabled=true,arrivalQueued=false;
function unlock(){if(!enabled)return false;try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')ctx.resume().then(()=>{if(arrivalQueued){arrivalQueued=false;play('arrival');}}).catch(()=>{});return true;}catch{return false;}}
function note(hz,when,seconds=0.16,volume=.06,type='sine',slide=1){if(!ctx||ctx.state!=='running')return;
 const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();o.type=type;o.frequency.setValueAtTime(hz,when);if(slide!==1)o.frequency.exponentialRampToValueAtTime(Math.max(45,hz*slide),when+seconds);f.type='lowpass';f.frequency.value=2500;o.connect(f);f.connect(g);g.connect(ctx.destination);
 g.gain.setValueAtTime(.00001,when);g.gain.exponentialRampToValueAtTime(volume,when+.018);g.gain.exponentialRampToValueAtTime(.00001,when+seconds);o.start(when);o.stop(when+seconds+.01);}
const sequences={arrival:[[392,0,.18,.045],[494,.11,.24,.045],[587,.22,.22,.046],[784,.36,.36,.036]],enter:[[293,0,.15,.04],[440,.11,.15,.047],[587,.23,.24,.06],[880,.37,.42,.04]],capture:[[440,0,.09,.045],[220,.10,.16,.045],[660,.23,.19,.05]],ready:[[523,0,.12,.047],[659,.10,.15,.04],[784,.23,.24,.048]],bloom:[[587,0,.12,.025],[740,.08,.15,.033],[880,.17,.20,.045]],grab:[[350,0,.09,.03]],release:[[525,0,.11,.035]],error:[[220,0,.19,.04]],hover:[[680,0,.065,.012]],pin:[[440,0,.12,.032],[554,.10,.17,.027]]};
function play(name){if(!enabled)return;if(!ctx){if(name==='arrival')arrivalQueued=true;return;}if(name!=='arrival')arrivalQueued=false;if(ctx.state!=='running'){if(name==='arrival'){arrivalQueued=true;return;}ctx.resume().then(()=>play(name)).catch(()=>{});return;}const now=ctx.currentTime+.012;for(const [freq,offset,duration,vol] of sequences[name]||[])note(freq,now+offset,duration,vol,'sine',name==='capture'?.82:1);}
function hover(){const now=performance.now();if(now-lastHover<140)return;lastHover=now;play('hover');}
document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock,{passive:true});
window.FreeLabSound={unlock,play,hover,setEnabled:v=>{enabled=Boolean(v);},getEnabled:()=>enabled};
})();
