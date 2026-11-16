/* FREELAB Agency explainer media. Video files live outside application releases.
   Exactly one short video is decoded at a time; no video pixels leave the browser. */
(()=>{'use strict';
const FOLDERS=Object.freeze({shapes:'shape_garden',math:'number_flow',hands:'hand_harmony',frames:'spatial_frames',sort:'shape_sort',chain:'chain_lab',cubes:'cube_lab',throw:'throw_lab',five:'five_note',thumbs:'thumb_string'});
const PLAYLIST='video_hls/index.m3u8';
let active=null,library=null;
function folder(activity){return FOLDERS[activity]||null;}
function urls(activity){const slug=folder(activity);if(!slug)throw Error('Unknown Agency activity');const base='/videos/'+slug+'/';return {hls:base+PLAYLIST,mp4:base+'video.mp4'};}
async function exists(url){try{
 // nginx serves the SPA for unknown paths. A 200 alone cannot establish that
 // an HLS playlist exists: check its actual #EXTM3U signature.
 if(url.endsWith('.m3u8')){const r=await fetch(url,{cache:'no-store'});if(!r.ok)return false;
  return (await r.text()).trimStart().startsWith('#EXTM3U');}
 const r=await fetch(url,{method:'HEAD',cache:'no-store'}),mime=r.headers.get('content-type')||'';
 return r.ok&&!/text\/html/i.test(mime)&&(/video\//i.test(mime)||/octet-stream/i.test(mime));
 }catch{return false;}}
async function sources(activity){const u=urls(activity),[hls,mp4]=await Promise.all([exists(u.hls),exists(u.mp4)]);return {hls:hls?u.hls:null,mp4:mp4?u.mp4:null};}
function visited(activity,user){try{return localStorage.getItem('freelab-explainer-v1:'+String(user||'guest')+':'+folder(activity))==='1';}catch{return false;}}
function remember(activity,user){try{localStorage.setItem('freelab-explainer-v1:'+String(user||'guest')+':'+folder(activity),'1');}catch{}}
function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.async=true;el.onload=()=>resolve();el.onerror=()=>{el.remove();reject(Error('HLS decoder unavailable'));};document.head.appendChild(el);});}
async function hlsEngine(){if(window.Hls?.isSupported?.())return window.Hls;
 if(!library)library=(async()=>{try{await script('/videos/hls.min.js');}catch{await script('https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js');}
  if(!window.Hls?.isSupported?.())throw Error('HLS decoder not supported on this browser');return window.Hls;})();
 try{return await library;}catch(e){library=null;throw e;}}
function stop(){if(!active)return;const s=active;active=null;if(s.frameCallbackHandle!==null){try{s.video.cancelVideoFrameCallback?.(s.frameCallbackHandle);}catch{}}try{s.hls?.destroy();}catch{}try{s.video.pause();s.video.removeAttribute('src');s.video.load();}catch{}s.video.remove();}
async function play(activity,available,{onEnd=()=>{},onError=()=>{}}={}){
 stop();const video=document.createElement('video');video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.playsInline=true;video.preload='auto';video.crossOrigin='anonymous';video.loop=false;video.controls=false;
 // Only one decoder exists at a time. Quest renders these decoded frames into
 // WebGL; the underlying media element must not capture controller input.
 Object.assign(video.style,{position:'fixed',width:'2px',height:'2px',opacity:'0.001',pointerEvents:'none',left:'0',top:'0'});document.body.append(video);
 const state={video,hls:null,activity,ready:false,waitingForTap:false,onEnd,onError,usedMp4:false,frameCallbackEnabled:typeof video.requestVideoFrameCallback==='function',frameSerial:0,frameCallbackHandle:null};active=state;
 if(state.frameCallbackEnabled){
  const decoded=(_time,metadata)=>{
   if(active!==state)return;
   state.frameSerial=metadata?.presentedFrames||state.frameSerial+1;
   state.frameCallbackHandle=video.requestVideoFrameCallback(decoded);
  };
  state.frameCallbackHandle=video.requestVideoFrameCallback(decoded);
 }
 video.onended=()=>{if(active===state)onEnd();};
 const useMp4=()=>{if(!available.mp4||state.usedMp4)return false;
  state.usedMp4=true;state.hls?.destroy();state.hls=null;video.src=available.mp4;video.load();return true;};
 video.onerror=()=>{if(active!==state)return;
  if(useMp4()){video.play().catch(e=>{if(active===state){state.waitingForTap=true;onError('MP4 playback needs a tap: '+e.message);}});}
  else onError('Video could not be decoded');};
 try{
  if(available.hls&&video.canPlayType('application/vnd.apple.mpegurl'))video.src=available.hls;
  else if(available.hls){try{const Hls=await hlsEngine();if(active!==state)return null;
    // Wait for the manifest before requesting playback. Calling play() while
    // HLS.js has not attached a MediaSource can fail with NotSupportedError.
    await new Promise((resolve,reject)=>{
     const hls=new Hls({enableWorker:true,maxBufferLength:20,maxMaxBufferLength:36});state.hls=hls;
     hls.on(Hls.Events.MANIFEST_PARSED,()=>resolve());
     hls.on(Hls.Events.ERROR,(_event,error)=>{
      if(!error.fatal||active!==state)return;
      if(useMp4())resolve();else reject(Error('HLS playback unavailable: '+(error.details||error.type||'decoder error')));
     });
     hls.loadSource(available.hls);hls.attachMedia(video);
    });
   }catch(e){if(!useMp4())throw e;}
  }else if(available.mp4){state.usedMp4=true;video.src=available.mp4;}
  else throw Error('No explainer media uploaded');
  if(active!==state)return null;
  try{await video.play();if(active===state){state.ready=true;state.waitingForTap=false;}}catch(e){
   if(active===state&&e.name==='NotAllowedError'){state.waitingForTap=true;return state;}
   throw e;}
 }catch(e){if(active===state)onError(e.message||'Video unavailable');}
 return state;
}
window.FreeLabAgencyMedia=Object.freeze({folders:FOLDERS,folder,urls,sources,visited,remember,play,stop,get current(){return active;}});
})();
