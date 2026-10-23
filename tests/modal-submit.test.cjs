const test=require('node:test'),assert=require('node:assert/strict')
test('Enter confirma una sola acción habilitada y respeta edición, repetición y bloqueo',async()=>{
 const{submitModalFromEnter}=await import('../src/infrastructure/browser/modal-submit.mjs')
 let clicks=0,prevented=0
 const dialog={matches:()=>false,getAttribute:()=>null,querySelectorAll:()=>[button]}
 const button={disabled:false,getClientRects:()=>[{}],closest:()=>dialog,click:()=>clicks++}
 const event=extra=>({key:'Enter',target:{closest:()=>null},preventDefault:()=>prevented++,stopPropagation:()=>{},...extra})
 assert.equal(submitModalFromEnter(event(),dialog),true);assert.equal(clicks,1)
 button.disabled=true;assert.equal(submitModalFromEnter(event(),dialog),true);assert.equal(clicks,1)
 button.disabled=false
 for(const flags of [{repeat:true},{isComposing:true},{defaultPrevented:true},{shiftKey:true},{key:'Escape'}])assert.equal(submitModalFromEnter(event(flags),dialog),false)
 assert.equal(submitModalFromEnter(event({target:{closest:selector=>selector.includes('textarea')?{}:null}}),dialog),false)
 dialog.querySelectorAll=()=>[button,button];assert.equal(submitModalFromEnter(event(),dialog),false)
 assert.equal(clicks,1);assert.equal(prevented,2)
})
