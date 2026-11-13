/* FREELAB 0.7 — original procedural audio, no assets or external calls. */
(()=>{'use strict';let ctx=null,lastHover=0,enabled=true,arrivalQueued=false;let stringVoice=null;const fingerVoices=new Map();
function unlock(){if(!enabled)return false;try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')ctx.resume().then(()=>{if(arrivalQueued){arrivalQueued=false;play('arrival');}}).catch(()=>{});return true;}catch{return false;}}
function note(hz,when,seconds=0.16,volume=.06,type='sine',slide=1){if(!ctx||ctx.state!=='running')return;
 const o=ctx.createOscillator(),g=ctx.createGain(),f=ctx.createBiquadFilter();o.type=type;o.frequency.setValueAtTime(hz,when);if(slide!==1)o.frequency.exponentialRampToValueAtTime(Math.max(45,hz*slide),when+seconds);f.type='lowpass';f.frequency.value=2500;o.connect(f);f.connect(g);g.connect(ctx.destination);
 g.gain.setValueAtTime(.00001,when);g.gain.exponentialRampToValueAtTime(volume,when+.018);g.gain.exponentialRampToValueAtTime(.00001,when+seconds);o.start(when);o.stop(when+seconds+.01);}
const sequences={shutter:[[520,0,.045,.015],[280,.068,.07,.014]],paper:[],arrival:[[392,0,.18,.045],[494,.11,.24,.045],[587,.22,.22,.046],[784,.36,.36,.036]],enter:[[293,0,.15,.04],[440,.11,.15,.047],[587,.23,.24,.06],[880,.37,.42,.04]],capture:[[440,0,.09,.045],[220,.10,.16,.045],[660,.23,.19,.05]],ready:[[523,0,.12,.047],[659,.10,.15,.04],[784,.23,.24,.048]],bloom:[[587,0,.12,.025],[740,.08,.15,.033],[880,.17,.20,.045]],grab:[[350,0,.09,.03]],release:[[525,0,.11,.035]],error:[[220,0,.19,.04]],hover:[[680,0,.065,.012]],pin:[[440,0,.12,.032],[554,.10,.17,.027]]};
function noiseBurst(start=0,duration=.22,vol=.07,filter=1600){
 if(!ctx||ctx.state!=='running')return;
 const length=Math.floor(ctx.sampleRate*duration),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);
 let last=0;for(let i=0;i<length;i++){last=(Math.random()*2-1)*.3+last*.7;data[i]=last;}
 const source=ctx.createBufferSource(),lowpass=ctx.createBiquadFilter(),gain=ctx.createGain();source.buffer=buffer;
 lowpass.type='lowpass';lowpass.frequency.value=filter;source.connect(lowpass);lowpass.connect(gain);gain.connect(ctx.destination);
 gain.gain.setValueAtTime(.0001,ctx.currentTime+start);gain.gain.linearRampToValueAtTime(vol,ctx.currentTime+start+.015);
 gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+start+duration);source.start(ctx.currentTime+start);source.stop(ctx.currentTime+start+duration+.01);
}
function play(name){if(!enabled)return;if(!ctx){if(name==='arrival')arrivalQueued=true;return;}if(name!=='arrival')arrivalQueued=false;if(ctx.state!=='running'){if(name==='arrival'){arrivalQueued=true;return;}ctx.resume().then(()=>play(name)).catch(()=>{});return;}if(name==='type')note(890+Math.random()*270,ctx.currentTime+.006,.027,.006,'triangle');if(name==='squeak')note(650,ctx.currentTime+.006,.14,.017,'sine',1.28);if(name==='impact'){noiseBurst(0,.13,.095,2700);note(730,ctx.currentTime+.01,.18,.043,'triangle',.45);}if(name==='shutter'){noiseBurst(0,.075,.10,3500);noiseBurst(.080,.05,.055,1800);}if(name==='paper'){noiseBurst(0,.18,.065,1100);noiseBurst(.09,.18,.043,900);noiseBurst(.2,.12,.035,1400);}
 const now=ctx.currentTime+.012;for(const [freq,offset,duration,vol] of sequences[name]||[])note(freq,now+offset,duration,vol,'sine',name==='capture'?.82:1);}
// A synthesised bowed-string tone: shorter is lower, stretching increases pitch.
// Continuous oscillators are created only while the experimental lab is active.
function stringStart(){
 if(!enabled||!unlock()||!ctx||ctx.state!=='running'||stringVoice)return;
 const fundamental=ctx.createOscillator(),harmonic=ctx.createOscillator(),gain=ctx.createGain(),lowpass=ctx.createBiquadFilter();
 fundamental.type='triangle';harmonic.type='sine';lowpass.type='lowpass';lowpass.frequency.value=1500;
 fundamental.frequency.value=105;harmonic.frequency.value=210;
 const secondary=ctx.createGain();secondary.gain.value=.11;
 fundamental.connect(lowpass);harmonic.connect(secondary);secondary.connect(lowpass);lowpass.connect(gain);gain.connect(ctx.destination);
 gain.gain.value=.00001;fundamental.start();harmonic.start();stringVoice={fundamental,harmonic,gain,lowpass};
}
function stringUpdate(metres){
 if(!enabled)return;
 if(!stringVoice)stringStart();if(!stringVoice||ctx?.state!=='running')return;
 const m=Math.min(1,Math.max(0,metres)),hz=95+540*Math.pow(m,1.18),at=ctx.currentTime;
 stringVoice.fundamental.frequency.setTargetAtTime(hz,at,.035);
 stringVoice.harmonic.frequency.setTargetAtTime(hz*2.008,at,.035);
 stringVoice.lowpass.frequency.setTargetAtTime(850+1700*m,at,.05);
 stringVoice.gain.gain.setTargetAtTime(.018+.025*m,at,.06);
}
function stringStop(){if(!stringVoice)return;const v=stringVoice;stringVoice=null;
 try{const at=ctx.currentTime;v.gain.gain.cancelScheduledValues(at);v.gain.gain.setTargetAtTime(.00001,at,.035);v.fundamental.stop(at+.25);v.harmonic.stop(at+.25);}catch{}
}
function stringSnap(){stringStop();if(!ctx||ctx.state!=='running')return;
 noiseBurst(0,.105,.11,1900);note(670,ctx.currentTime+.012,.19,.065,'triangle',.28);
}
function stringAttach(){if(!enabled||!unlock())return;play('grab');stringStart();}
// Five polyphonic, intentionally quiet voices (C/D/E/F/G); A4 punctuates a snap.
// One oscillator pair per active fingertip link, no external assets or microphone.
function fingerAttach(id,hz){
 if(!enabled||!unlock()||!ctx||ctx.state!=='running'||fingerVoices.has(id))return;
 const a=ctx.createOscillator(),b=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
 const harmonic=ctx.createGain();a.type='sine';b.type='triangle';filter.type='lowpass';filter.frequency.value=1250;
 a.frequency.value=hz;b.frequency.value=hz*2;harmonic.gain.value=.12;
 a.connect(filter);b.connect(harmonic);harmonic.connect(filter);filter.connect(gain);gain.connect(ctx.destination);
 gain.gain.value=.00001;a.start();b.start();fingerVoices.set(id,{a,b,gain,filter});
 note(hz,ctx.currentTime+.01,.12,.018,'sine');
}
function fingerUpdate(id,hz,tension){
 if(!enabled||!ctx||ctx.state!=='running')return;
 const v=fingerVoices.get(id);if(!v)return;const t=Math.min(1,Math.max(0,tension)),at=ctx.currentTime;
 // Keep the C-major starting notes audible, bending gently upward with tension.
 const freq=hz*Math.pow(2,.55*t);
 v.a.frequency.setTargetAtTime(freq,at,.032);v.b.frequency.setTargetAtTime(freq*2.002,at,.032);
 v.filter.frequency.setTargetAtTime(900+1350*t,at,.05);
 v.gain.gain.setTargetAtTime(.006+.008*t,at,.05);
}
function fingerStop(id){const v=fingerVoices.get(id);if(!v)return;fingerVoices.delete(id);
 try{const at=ctx.currentTime;v.gain.gain.setTargetAtTime(.00001,at,.02);v.a.stop(at+.18);v.b.stop(at+.18);}catch{}
}
function fingersStopAll(){for(const id of [...fingerVoices.keys()])fingerStop(id);}
function fingerSnap(id){fingerStop(id);if(!enabled||!ctx||ctx.state!=='running')return;
 noiseBurst(0,.085,.035,2100);note(440,ctx.currentTime+.01,.21,.027,'sine',.84);
}
function hover(){const now=performance.now();if(now-lastHover<140)return;lastHover=now;play('hover');}
document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock,{passive:true});
window.FreeLabSound={unlock,play,hover,stringStart,stringUpdate,stringStop,stringSnap,stringAttach,fingerAttach,fingerUpdate,fingerStop,fingerSnap,fingersStopAll,setEnabled:v=>{enabled=Boolean(v);if(!enabled){stringStop();fingersStopAll();}},getEnabled:()=>enabled};
})();
