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
function stop(){if(!active)return;const s=active;active=null;try{s.hls?.destroy();}catch{}try{s.video.pause();s.video.removeAttribute('src');s.video.load();}catch{}s.video.remove();}
async function play(activity,available,{onEnd=()=>{},onError=()=>{}}={}){
 stop();const video=document.createElement('video');video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.playsInline=true;video.preload='auto';video.crossOrigin='anonymous';video.loop=false;video.controls=false;
 // A video playing in the browser's DOM is decoded by Quest's normal media pipeline.
 Object.assign(video.style,{position:'fixed',width:'1px',height:'1px',opacity:'0',pointerEvents:'none',left:'-100px',top:'-100px'});document.body.append(video);
 const state={video,hls:null,activity,ready:false,lastTime:-1,onEnd,onError};active=state;
 video.onended=()=>{if(active===state)onEnd();};
 video.onerror=()=>{if(active===state)onError('Video could not be decoded');};
 try{
  if(available.hls&&video.canPlayType('application/vnd.apple.mpegurl'))video.src=available.hls;
  else if(available.hls){try{const Hls=await hlsEngine();if(active!==state)return null;
    state.hls=new Hls({enableWorker:true,maxBufferLength:20,maxMaxBufferLength:36});state.hls.loadSource(available.hls);state.hls.attachMedia(video);
    state.hls.on(Hls.Events.ERROR,(_event,error)=>{if(error.fatal&&active===state){if(available.mp4){state.hls?.destroy();state.hls=null;video.src=available.mp4;video.play().catch(()=>{});}else onError('HLS playback unavailable');}});
   }catch(e){if(!available.mp4)throw e;video.src=available.mp4;}
  }else if(available.mp4)video.src=available.mp4;
  else throw Error('No explainer media uploaded');
  // play() is initiated from the user's activity selection; a pause/permission
  // error shows an explicit PLAY action, not a permanently blank surface.
  try{await video.play();if(active===state)state.ready=true;}catch(e){
   if(e.name==='NotAllowedError'&&active===state){state.waitingForTap=true;return state;}
   throw e;}
 }catch(e){if(active===state)onError(e.message||'Video unavailable');}
 return state;
}
window.FreeLabAgencyMedia=Object.freeze({folders:FOLDERS,folder,urls,sources,visited,remember,play,stop,get current(){return active;}});
})();
