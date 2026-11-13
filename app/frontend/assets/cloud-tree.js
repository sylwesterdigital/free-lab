/* FREE LAB recursive image tree. Pure functions; no inference, no persistence limits. */
(function(root){'use strict';
 const PAGE_SIZE=7; // Render seven image textures at a time, not a storage or depth limit.
 function view(objects,focusId=null,page=0,pageSize=PAGE_SIZE){
   const byId=new Map((objects||[]).filter(o=>Number.isInteger(o?.id)).map(o=>[o.id,o]));
   if(!Number.isInteger(focusId)||!byId.has(focusId))focusId=null;
   const children=(objects||[]).filter(o=>o&&o.shelf!=='bin'&&
       (o.parent_object_id??null)===focusId).sort((a,b)=>a.id-b.id);
   const pages=Math.max(1,Math.ceil(children.length/pageSize));
   const activePage=Math.min(pages-1,Math.max(0,Number.isFinite(page)?Math.trunc(page):0));
   const chain=[];let id=focusId;const seen=new Set();
   // Iteration instead of recursion: depth does not depend on the JS call stack.
   while(id!=null&&byId.has(id)&&!seen.has(id)){
     seen.add(id);const node=byId.get(id);chain.push(node);
     id=Number.isInteger(node.parent_object_id)?node.parent_object_id:null;
   }
   chain.reverse();
   return {focusId,focus:focusId===null?null:byId.get(focusId),
     chain,children:children.slice(activePage*pageSize,(activePage+1)*pageSize),
     totalChildren:children.length,page:activePage,pages,pageSize};
 }
 function pageOfChild(objects,parentId,childId,pageSize=PAGE_SIZE){
   const all=view(objects,parentId,0,pageSize);
   const nodes=(objects||[]).filter(o=>o&&o.shelf!=='bin'&&
     (o.parent_object_id??null)===(all.focusId??null)).sort((a,b)=>a.id-b.id);
   const index=nodes.findIndex(o=>o.id===childId);
   return index<0?0:Math.floor(index/pageSize);
 }
 root.FreeLabCloudTree={view,pageOfChild,PAGE_SIZE};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.FreeLabCloudTree;
})(typeof window!=='undefined'?window:globalThis);
