const test = require('node:test')
const assert = require('node:assert/strict')
const domain = require('../api/_lib/followups.cjs')
const { assertCompletedServices } = require('../api/_lib/completed-service-policy.cjs')
const { visibleStateForUser } = require('../api/_lib/core.cjs')
const actor = (id, keys, scope) => ({ id, name: id, roleCode: 'custom', permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])), ...(scope ? { [`scope.services.read.${scope}`]: true, [`scope.services.write.${scope}`]: true } : {}) } })
const tech = actor('tech', ['technical.view','followups.view','followups.create'], 'assigned')
const manager = actor('manager', ['followups.view','followups.assign','followups.resolve','notifications.followups'])
function fixture() {
 const record = { id:'service', customerId:'customer', client:'PIG-1 Cliente', date:'2026-10-21', service:'Instalación', technicianIds:['tech'], status:'Completado', technicalObservation:'Trabajo realizado' }
 const state = { history:[record], customers:[], employees:[{id:'manager',name:'Gestor',roleId:'manager',status:'Activo'}], roles:[{id:'manager',code:'custom',name:'Gestor',permissions:manager.permissions}], agenda:{teams:[],weekly:{}}, services:[],vehicles:[],reviews:[],preferences:{} }
 record.followup = domain.createFollowup(record, {type:'Cotizar adicional',description:'Cotizar cámaras'}, tech, state, '2026-10-21T12:00:00Z')
 return state
}
const command = (action, version, extra={}) => ({recordId:'service', action, version, commandId:`command-${action}-${version}`, ...extra})
test('creación valida permiso, asignación, tipo y contenido; no duplica casos', () => {
 const state=fixture(), record=state.history[0]
 assert.equal(record.followup.status,'Pendiente')
 assert.equal(domain.createFollowup(record, {type:'Otro'}, tech,state,'now'),record.followup)
 const empty={...record,followup:undefined}
 assert.throws(()=>domain.createFollowup(empty,{type:'Otro',description:'x'},tech,state,'now'),/Seleccioná/)
 assert.throws(()=>domain.createFollowup(empty,{type:'Cotizar adicional',description:' '},tech,state,'now'),/Seleccioná/)
 assert.throws(()=>domain.createFollowup(empty,{},manager,state,'now'),/permiso/)
 assert.throws(()=>domain.createFollowup({...empty,technicianIds:['other']},{},tech,state,'now'),/permiso/)
 assert.throws(()=>domain.createFollowup({...empty,vehicleControl:true},{},tech,state,'now'),/abonados/)
})
test('asignación, avances y resolución conservan autoría y servicio completado', () => {
 let state=fixture()
 assert.throws(()=>domain.manageFollowup(state,command('resolve',1,{note:'Hecho'}),manager),/Asigná/)
 let result=domain.manageFollowup(state,command('assign',1),manager);state=result.state
 assert.equal(result.after.followup.assigneeName,'Gestor')
 assert.equal(result.after.status,'Completado')
 assertCompletedServices(state,fixture(),{followupRecordId:'service'})
 assert.throws(()=>assertCompletedServices(state,fixture()),/Tickets/)
 assert.equal(domain.manageFollowup(state,command('assign',1),manager).unchanged,true)
 assert.throws(()=>domain.manageFollowup(state,command('note',1,{note:'Avance'}),manager),/otra sesión/)
 assert.throws(()=>domain.manageFollowup(state,command('resolve',2),manager),/resultado/)
 state=domain.manageFollowup(state,command('note',2,{note:'Enviamos presupuesto'}),manager).state
 state=domain.manageFollowup(state,command('resolve',3,{note:'Cliente aceptó, visita coordinada'}),manager).state
 assert.equal(state.history[0].followup.status,'Resuelto')
 assert.equal(state.history[0].followup.events.length,4)
 assert.throws(()=>domain.manageFollowup(state,command('note',4,{note:'Alterar'}),manager),/resuelto/)
 assert.throws(()=>assertCompletedServices({...state,history:[]},state),/Tickets/)
})
test('lectura y mutación respetan permisos y alcance; no modifica el caso abrirlo', () => {
 const state=fixture(), before=structuredClone(state)
 assert.equal(domain.listFollowups(state,tech).length,1)
 assert.equal(domain.listFollowups(state,{...tech,id:'other'}).length,0)
 assert.throws(()=>domain.listFollowups(state,actor('nobody',[])),/permiso/)
 assert.throws(()=>domain.manageFollowup(state,command('assign',1),tech),/permiso/)
 assert.throws(()=>domain.manageFollowup(state,command('assign',1),{...manager,permissions:{...manager.permissions,'scope.services.write.assigned':true}}),/acceso/)
 assert.deepEqual(state,before)
 const projected=visibleStateForUser(state,manager)
 assert.equal(projected.history[0].followup.description,'Cotizar cámaras')
})
test('avisos permanecen durante la gestión, respetan preferencias y desaparecen al resolver', async () => {
 const {selectDashboardNotifications}=await import('../src/domain/dashboard/dashboard-notifications.mjs')
 let state=fixture()
 const select=user=>selectDashboardNotifications({history:state.history,customers:[],today:'2026-10-21',now:Date.now(),user}).filter(n=>n.target.type==='followup')
 assert.equal(select(manager).length,1)
 assert.equal(select({...manager,permissions:{...manager.permissions,'notifications.followups':false}}).length,0)
 state=domain.manageFollowup(state,command('assign',1),manager).state
 assert.equal(select(manager).length,1)
 state=domain.manageFollowup(state,command('resolve',2,{note:'Listo'}),manager).state
 assert.equal(select(manager).length,0)
})
