const test = require('node:test')
const assert = require('node:assert/strict')
const { vehicleControlsPaused, pausedVehicleControl } = require('../api/_lib/vehicle-controls-pause.cjs')
const paused = { _vehicleControls: { paused: true } }
test('la pausa solo oculta controles abiertos y conserva informes y cierres históricos',()=>{
 assert.equal(vehicleControlsPaused(paused),true)
 assert.equal(vehicleControlsPaused({_vehicleControls:{paused:'true'}}),false)
 const record={vehicleControl:true,status:'Pendiente'}
 assert.equal(pausedVehicleControl(record,paused),true)
 assert.equal(pausedVehicleControl({...record,startedAt:'2026-11-27T18:45:00Z'},paused),true)
 assert.equal(pausedVehicleControl({...record,vehicleControl:false},paused),false)
 assert.equal(pausedVehicleControl({...record,vehicleControl:false,serviceId:'vehicle-weekly-control'},paused),true)
 assert.equal(pausedVehicleControl(record,{}),false)
 for(const status of ['Completado','Cancelado','Reprogramado','Avance registrado'])assert.equal(pausedVehicleControl({...record,status},paused),false)
 for(const field of ['completedAt','technicalStatus','technicalReportedAt'])assert.equal(pausedVehicleControl({...record,[field]:'Conservar'},paused),false)
})
test('la pausa evita generar y reprogramar controles sin borrar registros',async()=>{
 const {buildVehicleControlRecords,rescheduleVehicleControlRecords}=await import('../src/domain/vehicles/vehicle-controls.mjs')
 const records=[{id:'vehicle-control-2026-11-27-ka',vehicleControl:true,status:'Pendiente',date:'2026-11-30',time:'08:30'}]
 assert.deepEqual(buildVehicleControlRecords({month:'2026-11',weekly:paused}),[])
 assert.strictEqual(rescheduleVehicleControlRecords(records,{weekly:paused}),records)
 assert.equal(records[0].date,'2026-11-30')
})
test('la rotación mensual puede guardarse durante la pausa sin regenerar ni reasignar controles',async()=>{
 const {synchronizeMonthlyVehicles}=await import('../src/domain/vehicles/monthly-vehicle-sync.mjs')
 const team={teamId:'team',label:'Equipo 1',memberIds:['tech'],members:['Técnico Prueba'],tasks:[]}
 const record={id:'vehicle-control-2026-11-27-ka',vehicleControl:true,vehicleId:'ka',status:'Pendiente',date:'2026-11-27',time:'15:45',technicianIds:['old'],technicians:['Responsable previo'],monthlyVehicleAssignment:'2026-11'}
 const state={history:[record],agenda:{weekly:{...paused,'2026-11-27':{teams:[team]}}}}
 const args={month:'2026-11',fromDate:'2026-11-25',teams:[team],vehicles:[{id:'ka',brand:'Ford',model:'Ka'}],technicians:[{id:'tech',name:'Técnico Prueba'}]}
 const next=synchronizeMonthlyVehicles(state,args)
 assert.deepEqual(next.history,state.history)
 assert.deepEqual(next.agenda.weekly['2026-11-27'],state.agenda.weekly['2026-11-27'])
 assert.equal(next.agenda.weekly._monthlyTeams['2026-11'].vehicleAssignments[0].technicianId,'tech')
 const fresh=synchronizeMonthlyVehicles({...state,history:[]},args)
 assert.deepEqual(fresh.history,[])
})


test('los controles pausados no aparecen en la agenda técnica ni bloquean el siguiente día',async()=>{
 const {technicianAgendaCutoff,technicianAgendaServices,overdueVehicleControls,blockingOverdueVehicleControl}=await import('../src/domain/technicians/technician-history.mjs')
 const records=[{id:'control',serviceId:'vehicle-weekly-control',vehicleControl:true,date:'2026-11-24',time:'15:45',status:'Pendiente'}, {id:'today',date:'2026-11-25',time:'08:30',status:'Pendiente'}, {id:'done',vehicleControl:true,date:'2026-11-20',status:'Completado'}]
 assert.equal(technicianAgendaCutoff(records,null,'2026-11-25',paused),'2026-11-25')
 assert.deepEqual(technicianAgendaServices(records,'2026-11-25',paused).map(r=>r.id),['today'])
 assert.deepEqual(overdueVehicleControls(records,'2026-11-25',paused),[])
 assert.equal(blockingOverdueVehicleControl(records,1,'2026-11-25',paused),null)
 assert.equal(technicianAgendaServices(records,'2026-11-25',{}).some(r=>r.id==='control'),true)
})
