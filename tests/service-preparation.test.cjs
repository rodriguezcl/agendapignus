const test = require('node:test')
const assert = require('node:assert/strict')
const { applyServicePreparation } = require('../api/_lib/service-preparation.cjs')
const { authorizeIncomingState, technicianSafeRecord } = require('../api/_lib/core.cjs')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const record = { id:'r',sourceTaskId:'t',service:'Instalación',date:'2099-10-20',status:'Pendiente',detail:'Kit A' }
const user = { id:'u',name:'Preparador',roleCode:'user',permissions:{weekly:true} }
const state = () => ({roles:[],employees:[],services:[],vehicles:[],customers:[],history:[{...record}],agenda:{teams:[],weekly:{[record.date]:{teams:[{teamId:'team',tasks:[{...record,taskId:'t',historyId:'r'}]}]}}}})
test('atomic ready flag is stamped by server and synchronized without completing service', async()=>{
 const { servicePreparationOperations } = await import('../src/features/state/application/service-preparation.mjs')
 const before=state()
 const ops=servicePreparationOperations(before,{base:record,ready:true})
 const incoming=applyStateOperations(before,ops)
 incoming.history[0].servicePreparation.byName='Impostor'
 const next=authorizeIncomingState(incoming,before,user)
 assert.equal(next.history[0].status,'Pendiente')
 assert.equal(next.history[0].servicePreparation.ready,true)
 assert.equal(next.history[0].servicePreparation.byName,'Preparador')
 assert(next.history[0].servicePreparation.at)
 assert.deepEqual(next.agenda.weekly[record.date].teams[0].tasks[0].servicePreparation,next.history[0].servicePreparation)
 assert.equal(technicianSafeRecord(next.history[0]).servicePreparation,undefined)
 const unmarked=applyStateOperations(next,servicePreparationOperations(next,{base:next.history[0],ready:false}))
 assert.equal(authorizeIncomingState(unmarked,next,user).history[0].servicePreparation.ready,false)
 assert.throws(()=>servicePreparationOperations(next,{base:record,ready:false}),/cambió/)
})
test('service edits and missing preparation fields preserve readiness and attribution',()=>{
 const before=state();before.history[0].servicePreparation={ready:true,byName:'Preparador',byId:'u',at:'2026-10-13T12:00:00Z'}
 const edit=structuredClone(before);edit.history[0].detail='Kit B'
 assert.deepEqual(applyServicePreparation(edit,before,user,true).history[0].servicePreparation,before.history[0].servicePreparation)
 const unrelated=structuredClone(before);unrelated.history[0].phone='123';delete unrelated.history[0].servicePreparation
 assert.deepEqual(applyServicePreparation(unrelated,before,user,true).history[0].servicePreparation,before.history[0].servicePreparation)
})

test('linking a PIG preserves the ready check in history and agenda',()=>{
 const before=state()
 before.history[0].servicePreparation={ready:true,byName:'Preparador',byId:'u',at:'2026-10-13T12:00:00Z'}
 const incoming=structuredClone(before)
 Object.assign(incoming.history[0],{customerId:'pig-6803',customer:'MARÍA PAULA LOBO',address:'Dirección del abonado'})
 delete incoming.history[0].servicePreparation
 const next=authorizeIncomingState(incoming,before,user)
 assert.deepEqual(next.history[0].servicePreparation,before.history[0].servicePreparation)
 assert.deepEqual(next.agenda.weekly[record.date].teams[0].tasks[0].servicePreparation,before.history[0].servicePreparation)
 assert.equal(next.history[0].customerId,'pig-6803')
})
test('readonly users, vehicle controls and cancelled services cannot be marked ready',()=>{
 const before=state(),incoming=state();incoming.history[0].servicePreparation={ready:true}
 assert.equal(applyServicePreparation(incoming,before,user,false).history[0].servicePreparation,undefined)
 for(const patch of [{vehicleControl:true},{status:'Cancelado'},{status:'Reprogramado'}]) {
  incoming.history[0]={...record,...patch,servicePreparation:{ready:true}}
  assert.equal(applyServicePreparation(incoming,before,user,true).history[0].servicePreparation,undefined)
 }
})
test('button is icon only with tooltip and pressed state',()=>{
 const React=require('react');const {renderToStaticMarkup}=require('react-dom/server')
 const {ServicePreparationButton}=require('./helpers/load-app.cjs')(['ServicePreparationButton'])
 const html=renderToStaticMarkup(React.createElement(ServicePreparationButton,{record:{...record,servicePreparation:{ready:true,byName:'Preparador'}}}))
 assert.match(html,/title="Servicio listo · Preparó Preparador"/)
 assert.match(html,/aria-pressed="true"/)
 assert.doesNotMatch(html,/>Servicio listo/)
 assert.equal(renderToStaticMarkup(React.createElement(ServicePreparationButton,{record:{...record,vehicleControl:true}})),'')
})

test('past and completed services allow readiness without changing service status',()=>{
 for (const patch of [{date:'2020-01-01'}, {status:'Completado',technicalStatus:'Completado',startedAt:'2020-01-01T12:00:00Z'}]) {
  const before=state();before.history[0]={...record,...patch}
  const incoming=structuredClone(before);incoming.history[0].servicePreparation={ready:true}
  const result=applyServicePreparation(incoming,before,user,true).history[0]
  assert.equal(result.servicePreparation.ready,true)
  assert.equal(result.status,before.history[0].status)
  assert.equal(result.servicePreparation.byId,String(user.id))
 }
})
