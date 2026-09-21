const test = require('node:test')
const assert = require('node:assert/strict')
const { synchronizeJourneyIdentity } = require('../api/_lib/journey-identity.cjs')
const fixture = () => {
  const history = [1,2].map(index => ({ id: String(index), serviceJourney: {id:'1',index,total:2}, customerId:'old',client:'Old',serviceId:'alarm',service:'Alarma',status:'Pendiente',date:`2099-01-0${index+4}`,estimatedMinutes:index*60,detail:`nota ${index}` }))
  return {history,agenda:{teams:[{tasks:structuredClone(history)}],weekly:{day:{teams:[{tasks:structuredClone(history)}]}}}}
}
test('identity propagates to all visits and projections without changing visit fields', () => {
  const before=fixture(), next=structuredClone(before)
  Object.assign(next.history[1],{customerId:'new',client:'New',serviceId:'install',service:'Instalación'})
  synchronizeJourneyIdentity(next,before)
  for(const record of [...next.history,...next.agenda.teams[0].tasks,...next.agenda.weekly.day.teams[0].tasks]) { assert.equal(record.customerId,'new'); assert.equal(record.serviceId,'install') }
  assert.equal(next.history[0].estimatedMinutes,60); assert.equal(next.history[1].detail,'nota 2')
})
test('a started or reported sibling protects identity even when another visit is edited', () => {
  for(const patch of [{startedAt:'now'},{technicalStatus:'Reprogramación solicitada'},{status:'Avance registrado'}]) {
    const before=fixture(); Object.assign(before.history[0],patch)
    const next=structuredClone(before); next.history[1].customerId='new'
    assert.throws(()=>synchronizeJourneyIdentity(next,before),/protegidos/)
  }
})
test('PIG linking remains possible after work and retains reports and original provisional data', () => {
  const before=fixture(); before.history.forEach(record=>{record.subscriberReservation=true;record.customerId='';record.clientAccount=''})
  before.history[0].technicalObservation='trabajo realizado';before.history[0].startedAt='now'
  const next=structuredClone(before)
  Object.assign(next.history[1],{customerId:'pig',clientAccount:'PIG-1234',subscriberReservation:false,reservationLinkedAt:'now',reservationOriginal:{name:'reserva'}})
  synchronizeJourneyIdentity(next,before)
  assert.equal(next.history[0].customerId,'pig');assert.equal(next.history[0].technicalObservation,'trabajo realizado');assert.equal(next.history[0].reservationOriginal.name,'reserva')
})
test('contradictory group changes fail before applying projections', () => {
  const before=fixture(), next=structuredClone(before)
  next.history[0].customerId='a';next.history[1].customerId='b'
  assert.throws(()=>synchronizeJourneyIdentity(next,before),/contradictorios/)
  assert.equal(next.agenda.teams[0].tasks[0].customerId,'old')
})
