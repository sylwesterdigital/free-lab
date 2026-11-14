/* FREELAB 0.10.19: one accessible, non-blocking dialog for desktop/mobile. */
(()=>{'use strict';
 let pending=false;
 function show({title='FREELAB',message='',input=false,initial='',password=false,ok='OK',cancel='Cancel',danger=false}={}){
  if(pending)return Promise.resolve(input?null:false);pending=true;
  const overlay=document.createElement('div');overlay.className='fl-dialog-overlay';
  overlay.innerHTML='<section class="fl-dialog" role="alertdialog" aria-modal="true" aria-labelledby="flDialogTitle" aria-describedby="flDialogMessage"><div class="fl-dialog-top"><span class="fl-dialog-eyebrow">FREELAB / CONFIRMATION</span><button class="fl-dialog-x" type="button" aria-label="Close dialog">×</button></div><h2 id="flDialogTitle"></h2><p id="flDialogMessage"></p><div class="fl-dialog-entry"></div><div class="fl-dialog-actions"><button class="fl-dialog-cancel" type="button"></button><button class="fl-dialog-ok" type="button"></button></div></section>';
  const previous=document.activeElement,titleEl=overlay.querySelector('#flDialogTitle'),msgEl=overlay.querySelector('#flDialogMessage');
  titleEl.textContent=title;msgEl.textContent=message;
  const editor=input?document.createElement('textarea'):null;
  if(editor){editor.className='fl-dialog-input';editor.rows=3;editor.maxLength=3000;editor.value=initial;editor.setAttribute('aria-label','Response');if(password){editor.style.webkitTextSecurity='disc';}overlay.querySelector('.fl-dialog-entry').append(editor);}
  const accept=overlay.querySelector('.fl-dialog-ok'),reject=overlay.querySelector('.fl-dialog-cancel'),x=overlay.querySelector('.fl-dialog-x');
  accept.textContent=ok;reject.textContent=cancel;if(danger)accept.classList.add('danger');
  document.body.append(overlay);document.body.classList.add('fl-dialog-open');
  return new Promise(resolve=>{
   const finish=accepted=>{document.removeEventListener('keydown',keys,true);overlay.remove();document.body.classList.remove('fl-dialog-open');pending=false;previous?.focus?.();resolve(input?(accepted?editor.value:null):accepted);};
   const keys=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}else if(e.key==='Tab'){const items=[x,...(editor?[editor]:[]),reject,accept];const focused=items.indexOf(document.activeElement);if(e.shiftKey&&focused<=0){e.preventDefault();accept.focus();}else if(!e.shiftKey&&focused===items.length-1){e.preventDefault();x.focus();}}else if(e.key==='Enter'&&!e.shiftKey&&!input){e.preventDefault();finish(true);}};
   document.addEventListener('keydown',keys,true);accept.onclick=()=>finish(true);reject.onclick=x.onclick=()=>finish(false);
   (editor||reject).focus();
  });
 }
 window.FreeLabDialog={confirm:(message,opts={})=>show({title:'Confirm action',message,ok:'Continue',...opts}),
   input:(message,initial='',opts={})=>show({title:'Enter information',message,input:true,initial,...opts}),
   message:(message,opts={})=>show({title:'Notice',message,ok:'OK',...opts}),
   copy:(value)=>show({title:'Share link',message:'Select and copy this private URL.',input:true,initial:value,ok:'Close'})};
})();
