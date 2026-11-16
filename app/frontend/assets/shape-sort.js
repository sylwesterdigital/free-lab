/* FREE LAB v0.10.11 -- local hand-shape sorting game. No network, no inference. */
(()=>{'use strict';
const d=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const middle=pts=>pts[0].map((v,i)=>pts.reduce((sum,p)=>sum+p[i],0)/pts.length);
const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const fingerNames=['index','middle','ring','pinky','thumb'];
// Pick the actual contacting fingertip, not the first tracked finger (all five are tracked).
// Either hand may carry the thumb/index pair. Freeze the chosen finger once attached.
function triangle(left,right,base='auto',chosen=null){
 const options=[];
 for(const side of base==='auto'?['left','right']:[base]){
  const hand=side==='left'?left:right,opposite=side==='left'?right:left;
  if(!valid(hand?.thumb)||!valid(hand?.index))continue;
  for(const name of chosen?[chosen]:fingerNames){if(!valid(opposite?.[name]))continue;
   const points=[hand.thumb,hand.index,opposite[name]];
   const e=points.map((p,i)=>d(p,points[(i+1)%3])),semiperimeter=e.reduce((a,b)=>a+b,0)/2;
   const area=Math.sqrt(Math.max(0,semiperimeter*(semiperimeter-e[0])*(semiperimeter-e[1])*(semiperimeter-e[2])));
   const score=e[0]+e[2];
   options.push({corners:points.map(p=>[...p]),center:middle(points),area,other:name,base:side,score});
  }
 }
 options.sort((a,b)=>a.score-b.score);
 return options[0]||null;
}
class TriangleDraw{
 constructor(){this.reset();this.nextId=100000;}
 reset(){this.phase='ready';this.armed=false;this.live=null;this.contactSince=0;this.formedSince=0;this.active=null;}
 update({left={},right={},time=0}={}){
  const t=this.active?triangle(left,right,this.active.base,this.active.other):triangle(left,right),close=!!(t&&d(t.corners[0],t.corners[1])<.067&&d(t.corners[0],t.corners[2])<.075);
  let event=null,placed=null;
  if(this.phase==='ready'){
   if(!close)this.armed=true;
   if(close&&this.armed){if(!this.contactSince)this.contactSince=time;
    if(time-this.contactSince>140){this.phase='stretch';this.live=t;this.active={base:t.base,other:t.other};this.formedSince=0;event='attach';}}
   else this.contactSince=0;
  }else if(this.phase==='stretch'){
   if(!t){if(this.live?.area>.003){placed={id:this.nextId++,corners:this.live.corners.map(p=>[...p]),shape:'triangle',createdAt:time};event='place';}
    this.phase='cooldown';this.live=null;this.active=null;
   }else{this.live=t;
    if(t.area>.003&&t.corners.every((p,i)=>d(p,t.corners[(i+1)%3])>.095)){
     if(!this.formedSince)this.formedSince=time;
     if(time-this.formedSince>300){placed={id:this.nextId++,corners:t.corners.map(p=>[...p]),shape:'triangle',createdAt:time};event='place';this.phase='cooldown';this.live=null;this.active=null;}}
    else this.formedSince=0;
   }
  }else if(!close){this.phase='ready';this.armed=true;this.active=null;this.contactSince=0;}
  return {event,placed,live:this.live};
 }
}
function accept(shape,target){return shape===target;}
function targetHit(frame,centers,radius=.25){const center=middle(frame.corners),shape=frame.shape||'rectangle';
 const closest=centers.map(c=>({...c,distance:d(center,c.center)})).sort((a,b)=>a.distance-b.distance)[0];
 return closest&&closest.distance<radius?{...closest,accept:accept(shape,closest.shape)}:null;
}
window.FreeLabShapeSort={TriangleDraw,triangle,targetHit,accept};
})();

/* Cognitive Agency — offline, deterministic, shared desktop/WebXR game rules.
 * No medical scoring, paid APIs, third-party services, or remote telemetry.
 */
(()=>{'use strict';
const GAMES={shapes:{name:'Shape Garden',skills:'Spatial sorting · attention',description:'Place the shape in its matching glowing home.'},math:{name:'Number Flow',skills:'Number sense · focus',description:'Choose the correct answer to the equation.'},hands:{name:'Hand Harmony',skills:'Left/right awareness · coordination',description:'Use the hand shown on the floating target.'}};
const MODES={free:'Free Play',timed:'2-minute Timed',daily:'Daily Challenge'};
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
function hash(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function generator(seed){let x=seed>>>0;return()=>{x+=0x6d2b79f5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const SHAPES=[{id:'triangle',sides:3,label:'Triangle',glyph:'△'},{id:'square',sides:4,label:'Square',glyph:'□'},{id:'pentagon',sides:5,label:'Pentagon',glyph:'⬠'},{id:'hexagon',sides:6,label:'Hexagon',glyph:'⬡'},{id:'cube',sides:6,label:'Cube',glyph:'◈'},{id:'pyramid',sides:5,label:'Pyramid',glyph:'◇'},{id:'prism',sides:5,label:'Prism',glyph:'⬡'}];
const today=()=>new Date().toLocaleDateString('en-CA');
class Session{
 constructor({game='shapes',mode='free',level=0,user='guest',date=today(),now=()=>Date.now(),storage=null}={}){
  if(!GAMES[game]||!MODES[mode])throw Error('Unknown Cognitive Agency game or mode');
  this.game=game;this.mode=mode;this.level=clamp(Number(level)||0,0,3);this.user=String(user).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,55)||'guest';this.date=date;
  this.now=now;this.storage=storage;this.startedAt=now();this.score=0;this.errors=0;this.round=0;this.completed=false;this.lastFeedback='';
  const seed=mode==='daily'?hash(`${date}:${this.user}:${game}:${this.level}`):Math.floor(Math.random()*0xffffffff);
  this.random=generator(seed);this.newRound();
 }
 pick(list){return list[Math.floor(this.random()*list.length)];}
 different(correct,pool,count){const values=[correct],choices=pool.filter(q=>q!==correct);while(values.length<count&&choices.length){const n=Math.floor(this.random()*choices.length);values.push(choices.splice(n,1)[0]);}for(let j=values.length-1;j>0;j--){const n=Math.floor(this.random()*(j+1));[values[n],values[j]]=[values[j],values[n]];}return values;}
 newRound(){if(this.completed)return;
  if(this.game==='shapes'){
   const pool=this.level===0?SHAPES.slice(0,2):this.level===1?SHAPES.slice(0,4):this.level===2?SHAPES.slice(4):SHAPES;
   const target=this.pick(pool),options=this.different(target.id,pool.map(q=>q.id),this.level===0?2:3).map(id=>SHAPES.find(q=>q.id===id));
   const count=this.mode==='free'?2+Math.floor(this.random()*Math.min(4,this.level+2)):1;
   const figures=Array.from({length:count},(_,i)=>({...this.pick(options),angle:Math.floor(this.random()*12)*30}));figures[0]={...target,angle:Math.floor(this.random()*12)*30};
   this.question={type:'shapes',target:figures[0],figures,options};
  }else if(this.game==='math'){
   const l=this.level;let a,b,op='+',result;
   if(l===0){a=1+Math.floor(this.random()*9);b=1+Math.floor(this.random()*9);result=a+b;}
   else if(l===1){a=5+Math.floor(this.random()*16);b=1+Math.floor(this.random()*10);op=this.random()<.45?'-':'+';if(op==='-'&&b>a)[a,b]=[b,a];result=op==='+'?a+b:a-b;}
   else if(l===2){a=2+Math.floor(this.random()*9);b=2+Math.floor(this.random()*8);op=this.random()<.5?'×':'-';result=op==='×'?a*b:a-b;}
   else{a=2+Math.floor(this.random()*11);b=2+Math.floor(this.random()*11);op=this.random()<.5?'×':'+';result=op==='×'?a*b:a+b;}
   const options=this.different(result,[result+1,result+2,result-1,result-2,result+3,result-3,result+5].filter(n=>n>=0),3);
   this.question={type:'math',equation:`${a} ${op} ${b} = ?`,answer:result,options};
  }else{
   const hand=this.random()<.5?'L':'R',shapes=['●','◆','▲','⬡'];this.question={type:'hands',hand,glyph:this.pick(shapes)};
  }
  this.round++;
 }
 generate(){if(this.mode!=='free'||this.completed)return false;this.newRound();this.lastFeedback='New shapes ready · go at your own pace';return true;}
 remaining(){return this.mode==='timed'?Math.max(0,120-Math.floor((this.now()-this.startedAt)/1000)):null;}
 tick(){if(this.mode==='timed'&&this.remaining()===0)this.finish();return this.completed;}
 answer(value,hand=null){if(this.tick())return {accepted:false,finished:true};
  let correct=false;
  if(this.game==='shapes')correct=String(value)===this.question.target.id;
  if(this.game==='math')correct=Number(value)===this.question.answer;
  if(this.game==='hands')correct=(hand==='left'||hand==='right')&&hand[0].toUpperCase()===this.question.hand;
  this.lastFeedback=correct?'Well done · take your time':'Try again · there is no rush';
  if(correct){this.score++;if(this.mode==='daily'&&this.score>=8)this.finish();
   else if(this.game==='shapes'&&this.question.figures.length>1){this.question.figures.shift();this.question.target=this.question.figures[0];this.round++;}
   else this.newRound();}
  else this.errors++;
  this.save();return {accepted:true,correct,finished:this.completed,feedback:this.lastFeedback};
 }
 finish(){if(this.completed)return;this.completed=true;this.save();}
 snapshot(){return {game:this.game,mode:this.mode,level:this.level,score:this.score,errors:this.errors,round:this.round,remaining:this.remaining(),completed:this.completed,question:this.question,feedback:this.lastFeedback};}
 save(){if(!this.storage)return;try{const key=`freelab-agency-v1-${this.user}`,history=JSON.parse(this.storage.getItem(key)||'[]');const entry={game:this.game,mode:this.mode,level:this.level,date:this.date,started:this.startedAt,seconds:Math.min(7200,Math.max(0,Math.floor((this.now()-this.startedAt)/1000))),correct:this.score,errors:this.errors,completed:this.completed};
    const index=history.findIndex(x=>x.started===entry.started&&x.game===entry.game);if(index>=0)history[index]=entry;else history.push(entry);this.storage.setItem(key,JSON.stringify(history.slice(-80)));}catch{} }
}
window.FreeLabAgency={Session,GAMES,MODES,SHAPES,today,hash};
})();

/* The Agency desktop lobby and accessible mouse/keyboard counterpart to XR. */
(()=>{'use strict';if(typeof document==='undefined')return;
let game='shapes',mode='free',level=0,screen='lobby',session=null,selectedShape=null,updateTimer=null;
const $=id=>document.getElementById(id);
const engine=()=>window.FreeLabAgency;
function userId(){return window.FreeLab?.getState?.()?.user?.id||'guest';}
function format(s){return s===null?'No timer':`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function showEntrance(){if(!window.FreeLab?.getState?.()?.user)return;$('main')?.classList.remove('agency-active');$('experienceGate')?.classList.remove('hidden');$('agencyStudio')?.classList.add('hidden');}
function open(){if(!$('agencyStudio'))return;$('experienceGate').classList.add('hidden');$('main')?.classList.add('agency-active');$('agencyStudio').classList.remove('hidden');screen='lobby';session=null;render();}
function render(){const content=$('agencyContent');if(!content)return;
 const E=engine();
 if(screen==='lobby'){
  let practice='';try{const history=JSON.parse(localStorage.getItem(`freelab-agency-v1-${userId()}`)||'[]');const sessions=history.length,correct=history.reduce((n,x)=>n+(x.correct||0),0);if(sessions)practice=`<p class="agency-personal-progress">Your private practice · ${sessions} sessions · ${correct} correct answers</p>`;}catch{}
  content.innerHTML=`<div class="agency-intro"><span>CHOOSE YOUR ACTIVITY</span><h3>Small steps. Gentle discoveries.</h3></div><div class="agency-game-grid">${Object.entries(E.GAMES).map(([id,g])=>`<button class="agency-game-card" type="button" data-game="${id}"><span class="agency-game-art agency-art-${id}">${id==='shapes'?'△ □ ⬡':id==='math'?'3 + 3 = ?':'L  ·  R'}</span><strong>${g.name}</strong><span>${g.description}</span><small>${g.skills}</small><b>PLAY ↗</b></button>`).join('')}</div>${practice}<p class="agency-secondary-note">More gentle activities—Colour Match, Pattern Echo, Memory Pairs, Sequence Builder, Calm Tracing, Sound Garden and Tidy the World—are planned for future releases.</p>`;
 }else if(screen==='setup'){
  content.innerHTML=`<div class="agency-setup"><button class="agency-back" data-action="back">← All activities</button><span class="eyebrow">${E.GAMES[game].skills}</span><h3>${E.GAMES[game].name}</h3><p>${E.GAMES[game].description}</p><h4>Choose your pace</h4><div class="agency-options">${Object.entries(E.MODES).map(([id,label])=>`<button type="button" data-mode="${id}" aria-pressed="${mode===id}">${label}</button>`).join('')}</div><h4>Difficulty</h4><div class="agency-options">${[0,1,2,3].map(n=>`<button type="button" data-level="${n}" aria-pressed="${level===n}">Level ${n}${n===0?' · Gentle':''}</button>`).join('')}</div><p class="agency-pacing">Free Play has no countdown. Timed gives you two minutes. Daily Challenge is eight repeatable questions, refreshed each day.</p><button type="button" class="primary-btn" data-action="start">Start gently ↗</button></div>`;
 }else if(screen==='play'&&session){const s=session.snapshot(),q=s.question;
  let detail='';if(game==='shapes')detail=`<div class="agency-prompt">Find a home for <strong>${q.target.label}</strong> · ${q.figures.length} to sort</div><button type="button" class="agency-shape-held" data-action="selectshape" aria-pressed="${!!selectedShape}"><span style="transform:rotate(${q.target.angle}deg)">${q.target.glyph}</span>${selectedShape?'Shape selected · choose a box':'Pick up this shape'}</button><div class="agency-answers">${q.options.map(o=>`<button type="button" class="agency-bin" data-answer="${o.id}"><span>${o.glyph}</span>${o.label} box</button>`).join('')}</div>${mode==='free'?'<button type="button" class="agency-back" data-action="generate">↻ Generate new random shapes</button>':''}`;
  if(game==='math')detail=`<div class="agency-equation">${q.equation}</div><div class="agency-answers">${q.options.map(o=>`<button type="button" data-answer="${o}" class="agency-number">${o}</button>`).join('')}</div>`;
  if(game==='hands')detail=`<div class="agency-prompt">Use your ${q.hand==='L'?'LEFT':'RIGHT'} hand</div><button type="button" class="agency-hand-target" data-hand="${q.hand==='L'?'left':'right'}"><span>${q.glyph}</span><strong>${q.hand}</strong><small>Touch with the indicated hand in XR</small></button><div class="agency-answers"><button type="button" data-hand="left">LEFT · L</button><button type="button" data-hand="right">RIGHT · R</button></div><p class="agency-pacing">Desktop: press the L or R key. XR: touch with the matching hand, or use its controller.</p>`;
  content.innerHTML=`<div class="agency-play"><div class="agency-play-top"><button class="agency-back" data-action="quit">← Activities</button><div><strong>${E.GAMES[game].name}</strong><span>Level ${level} · ${E.MODES[mode]}</span></div><span id="agencyTimer">${format(s.remaining)}</span></div><div class="agency-score">${s.score} correct · ${s.errors} retries ${mode==='daily'?`· ${Math.min(s.score,8)}/8 daily`:''}</div>${detail}<p id="agencyFeedback" class="agency-feedback" role="status">${s.feedback||'Take your time. You can try again.'}</p><button class="agency-back" data-action="finish">Finish and view progress</button></div>`;
 }else if(screen==='summary'&&session){const s=session.snapshot();content.innerHTML=`<div class="agency-summary"><span class="eyebrow">A MOMENT TO REFLECT</span><h3>Nice work showing up.</h3><p>Every attempt counts. Your progress is just for you.</p><div class="agency-summary-stats"><div><strong>${s.score}</strong><span>Correct answers</span></div><div><strong>${s.errors}</strong><span>Try-agains</span></div><div><strong>${format(Math.min(7200,Math.floor((session.now()-session.startedAt)/1000)))}</strong><span>Time spent</span></div></div><button class="primary-btn" data-action="again">Play another round</button><button class="secondary-btn" data-action="back">All activities</button></div>`;}
 }
 function submit(value,hand){if(!session||screen!=='play')return;const result=session.answer(value,hand);if(result.correct)selectedShape=null;if(result.finished){screen='summary';render();}else render();}
 function start(){let store=null;try{store=window.localStorage;}catch{}session=new (engine().Session)({game,mode,level,user:userId(),storage:store});screen='play';selectedShape=null;render();}
 function end(){if(session)session.finish();screen='summary';render();}
 function act(e){const button=e.target.closest('button');if(!button||!$('agencyContent')?.contains(button))return;
  if(button.dataset.game){game=button.dataset.game;screen='setup';render();return;}
  if(button.dataset.mode){mode=button.dataset.mode;render();return;}
  if(button.dataset.level){level=Number(button.dataset.level);render();return;}
  if(button.dataset.action==='back'||button.dataset.action==='quit'){if(session&&screen==='play')session.finish();screen='lobby';session=null;render();return;}
  if(button.dataset.action==='start'||button.dataset.action==='again'){start();return;}
  if(button.dataset.action==='generate'&&session?.generate()){selectedShape=null;render();return;}
  if(button.dataset.action==='finish'){end();return;}
  if(button.dataset.action==='selectshape'){selectedShape=session?.question?.target?.id;render();return;}
  if(button.dataset.answer!==undefined&&session){if(game!=='shapes'||selectedShape)submit(button.dataset.answer);else{$('agencyFeedback').textContent='Pick up the shape first.';}return;}
  if(button.dataset.hand)submit(button.dataset.hand,button.dataset.hand);
 }
 document.addEventListener('DOMContentLoaded',()=>{
  $('agencyContent')?.addEventListener('click',act);
  $('chooseMyStuff')?.addEventListener('click',()=>{$('experienceGate').classList.add('hidden');$('main')?.classList.remove('agency-active');$('agencyStudio').classList.add('hidden');});
  $('chooseAgency')?.addEventListener('click',open);
  $('agencyHome')?.addEventListener('click',showEntrance);
  $('agencyXR')?.addEventListener('click',()=>{if(!navigator.xr){window.FreeLab?.notify?.('XR requires a supported headset. Desktop games work here.');return;}window.FreeLabXR?.start({experience:'agency'}).catch(e=>window.FreeLab?.notify?.('Agency XR: '+e.message));});
  document.addEventListener('keydown',e=>{if(screen!=='play'||game!=='hands'||e.altKey||e.metaKey||e.ctrlKey||/INPUT|TEXTAREA/.test(document.activeElement?.tagName||''))return;const k=e.key.toLowerCase();if(k==='l'||k==='r')submit(k,k==='l'?'left':'right');});
  updateTimer=setInterval(()=>{if(screen!=='play'||!session)return;const finished=session.tick();if(finished){screen='summary';render();return;}if($('agencyTimer'))$('agencyTimer').textContent=format(session.remaining());},300);
 });
 window.FreeLabAgencyUI={open,showEntrance};
})();
