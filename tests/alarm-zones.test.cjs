const test = require('node:test'), assert = require('node:assert/strict')
const zones = require('../api/_lib/alarm-zones.cjs')
const access = require('../api/_lib/alarm-zones-policy.cjs')
const read = require('../api/_lib/granular-read-policy.cjs')
const locked = require('../api/_lib/completed-service-policy.cjs')
const now = '2026-10-26T16:00:00.000Z'
const admin = { id: 'admin', roleCode: 'administrator', name: 'Administradora' }
const tech = { id: 'tech', name: 'Técnico' }
const row = (number=1) => ({ number, name:'Puerta principal', attribute:'Demorada', sensor:'Magnético cableado', sensorOther:'' })
const record = { id:'service', service:'Instalación de alarma', customerId:'c', clientAccount:'PIG-1', client:'PIG-1 Cliente', date:'2026-10-26', status:'Completado', technicianIds:['tech'], technicalStatus:'Completado', ...zones.reportZones({service:'Instalación de alarma'},'Completado',[row()],tech,now) }
const state = { history:[record], customers:[{customerId:'c',account:'PIG-1',name:'Cliente'}], roles:[], employees:[], services:[], vehicles:[], agenda:{teams:[],weekly:{}}, preferences:{} }
const reader = (permissions={}) => ({id:'reader',roleCode:'custom',permissions:{__catalogV2:true,'accounts.view':true,'records.read':true,'service.documents.read':true,'notifications.softguard':true,...permissions}})

test('zonas: sólo instalación de alarma, incluso combinada, no reinstalaciones ni controles', () => {
  assert(zones.installation({service:'Instalación de cámaras + Instalación de alarma'}))
  assert(zones.installation({serviceTypes:[{id:'one',name:'Instalación de alarma'}]}))
  for (const service of ['Reinstalación de alarma','Service de alarma','Instalación de cámaras']) assert(!zones.installation({service}))
  assert(!zones.installation({service:'Instalación de alarma',vehicleControl:true}))
  assert.deepEqual(zones.initialZones({}).map(r=>r.number),[1,2,3])
  assert(zones.initialZones({}).every(r=>!r.name&&!r.sensor&&!r.attribute))
})
test('cierre requiere la zona 1 completa; valida límites, catálogos, número y Otro', () => {
  for(const input of [undefined,[],[zones.emptyZone(1)],[row(),row()],[{...row(),number:0}],[{...row(),attribute:'Inventado'}],[{...row(),sensor:'Otro'}],[{...row(),name:' '.repeat(121)}]]) assert.throws(()=>zones.validateZones(input))
  assert.equal(zones.validateZones([{...row(),sensor:'Otro',sensorOther:'Sensor de inundación'}])[0].sensorOther,'Sensor de inundación')
  assert.deepEqual(zones.validateZones([row(3),row(1)]).map(r=>r.number),[1,3])
  assert.throws(()=>zones.reportZones({service:'Instalación de alarma'},'Completado',undefined,tech,now),/zona/)
  for(const type of ['Cancelado','Reprogramación solicitada']) assert.deepEqual(zones.reportZones({service:'Instalación de alarma'},type,undefined,tech,now),{})
})
test('las zonas adicionales vacías se omiten; las empezadas deben estar completas', () => {
  const defaults = [row(), zones.emptyZone(2), zones.emptyZone(3)]
  assert.deepEqual(zones.validateZones(defaults), [row()])
  assert.equal(zones.reportZones(record, 'Completado', defaults, tech, now).alarmZones.zones.length, 1)
  assert.throws(() => zones.validateZones([row(2)]), /zona 1/)
  assert.throws(() => zones.validateZones([zones.emptyZone(1), row(2)]), /zona 1/)
  for (const key of ['name','attribute','sensor','sensorOther']) {
    const value = {name:'Patio',attribute:'Interior',sensor:'PIR cableado',sensorOther:'Detector'}[key]
    assert.throws(() => zones.validateZones([row(), {...zones.emptyZone(2),[key]:value}]), /zona 2/)
  }
  assert.deepEqual(zones.validateZones([row(),row(2),zones.emptyZone(3)]).map(z=>z.number), [1,2])
  assert.equal(zones.validateZones([row(), {...zones.emptyZone(2),name:'  '}]).length, 1)
  assert.equal(zones.validateZones(defaults, false).length, 3)
})
test('avances conservan zonas incompletas y la siguiente jornada las recupera sin compartir objetos', () => {
  const draft=zones.reportZones(record,'Avance registrado',[{...zones.emptyZone(3),name:'Patio'}],tech,now)
  assert.equal(draft.alarmZones.complete,false)
  const previous={...record,...draft,serviceJourney:{id:'j',index:1,total:2}}
  const next={...record,alarmZones:undefined,serviceJourney:{id:'j',index:2,total:2}}
  const initial=zones.initialZones(next,[previous]);assert.equal(initial[0].name,'Patio');initial[0].name='Otro';assert.equal(previous.alarmZones.zones[0].name,'Patio')
  assert(!zones.pendingReport(previous))
})
test('consulta por cuenta y confirmación respetan permisos y alcance; no expone otros datos del servicio', () => {
  assert.equal(access.reportsFor(state,{customerId:'c'},reader()).length,1)
  assert.equal(access.reportsFor(state,{recordId:'service'},reader()).length,1)
  assert.throws(()=>access.reportsFor(state,{customerId:'c'},reader({'service.documents.read':false})),/acceso/)
  assert.throws(()=>access.reportsFor(state,{customerId:'c'},reader({'scope.customers.read.cctv':true})),/acceso/)
  assert.equal(access.reportsFor(state,{customerId:'c'},reader({'scope.services.read.assigned':true})).length,0)
  assert.throws(()=>access.confirmLoaded(state,{recordId:'service',reportedAt:now},reader()),/permiso/)
  assert.throws(()=>access.confirmLoaded(state,{recordId:'service',reportedAt:'old'},admin),/cambió/)
  const result=access.confirmLoaded(state,{recordId:'service',reportedAt:now},admin,'2026-10-26T17:00:00Z')
  assert(!zones.pendingReport(result.after));assert(zones.pendingReport(record));assert.equal(result.after.alarmZones.softguard.completedById,'admin')
  assert.equal(access.confirmLoaded(result.state,{recordId:'service',reportedAt:now},admin).after,result.after)
  assert(!('technicalObservation' in access.present({...record,technicalObservation:'secret'})))
})
test('los avisos son persistentes hasta confirmar la carga, no nacen de avances ni de instalaciones antiguas sin zonas', async () => {
  const {selectDashboardNotifications}=await import('../src/domain/dashboard/dashboard-notifications.mjs')
  const notices=(records,user=admin)=>selectDashboardNotifications({history:records,customers:state.customers,user,today:'2026-10-26'}).filter(n=>n.target.type==='alarm-zones')
  assert.equal(notices([record]).length,1)
  assert.deepEqual(notices([record]),notices([record]))
  assert.equal(notices([{...record,alarmZones:undefined}]).length,0)
  assert.equal(notices([{...record,status:'Cancelado'}]).length,0)
  assert.equal(notices([{...record,alarmZones:{...record.alarmZones,complete:false}}]).length,0)
  assert.equal(notices([record],reader({'notifications.softguard':false})).length,0)
  assert.equal(notices([record],reader({'service.documents.read':false})).length,0)
  const confirmed=access.confirmLoaded(state,{recordId:'service',reportedAt:now},admin)
  assert.equal(notices(confirmed.state.history).length,0)
  const safe=read.granularVisibleState({...state,history:[{...record,amount:999,technicalObservation:'private'}]},reader())
  assert.equal(safe.history[0].alarmZones.zones[0].name,'Puerta principal')
  assert.equal(safe.history[0].technicalObservation,undefined)
  assert.equal(safe.history[0].amount,undefined)
  assert.equal(notices(safe.history,reader()).length,1)
  assert.equal(read.granularVisibleState(state,reader({'service.documents.read':false})).history.some(r=>r.alarmZones),false)
})
test('la edición genérica y el borrado no pueden sobrescribir reportes o su confirmación', () => {
  const changed={...record,alarmZones:{...record.alarmZones,zones:[row(7)]}}
  assert.throws(()=>locked.assertCompletedServiceChange(record,changed),/zonas/)
  assert.throws(()=>locked.assertCompletedServices({...state,history:[]},state),/zonas/)
  assert.throws(()=>locked.assertCompletedServices(state,{...state,history:[]}),/zonas/)
  locked.assertCompletedServices({...state,history:[changed]},state,{alarmZonesWriteId:record.id})
})
test('el transporte del técnico conserva zonas y rechaza errores de validación sin repetirlos', async () => {
  const {submitTechnicianStatus}=await import('../src/infrastructure/http/technician-status.mjs');let payload,calls=0
  const fetcher=async (url,options)=>{calls++;payload=JSON.parse(options.body);return {ok:true,json:async()=>({record})}}
  await submitTechnicianStatus({recordId:'service',type:'Completado',observation:'Probado',alarmZones:[row()],fetcher})
  assert.deepEqual(payload.alarmZones,[row()]);assert.equal(calls,1)
})
