const test = require('node:test')
const assert = require('node:assert/strict')
const { vehicleControlSchedule, vehicleControlFriday } = require('../api/_lib/vehicle-control-schedule.cjs')
const friday='2026-11-27'
const overrides = dates => ({ _holidayOverrides: Object.fromEntries(dates.map(day => [day,{status:'closed'}])) })
test('reserva 15 minutos antes del cierre ordinario, sin extender por guardia', () => {
 assert.deepEqual(vehicleControlSchedule(friday),{date:friday,time:'15:45',estimatedMinutes:15})
 assert.deepEqual(vehicleControlSchedule(friday,overrides([friday])),{date:'2026-11-26',time:'16:45',estimatedMinutes:15})
 assert.deepEqual(vehicleControlSchedule(friday,overrides([friday,'2026-11-26'])),{date:'2026-11-25',time:'16:45',estimatedMinutes:15})
 assert.equal(vehicleControlSchedule(friday,{_workday:{exceptions:{[friday]:{end:'20:00'}}}}).time,'15:45')
})
test('respeta cierres anticipados configurados y feriados trasladados', () => {
 const weekly=overrides([friday])
 weekly._holidayOverrides[friday].transferredFrom='2026-11-23'
 weekly._workday={exceptions:{'2026-11-26|team':{end:'16:00'}}}
 assert.equal(vehicleControlSchedule(friday,weekly,'team').time,'15:45')
 weekly._holidayOverrides[friday]={status:'working',transferredTo:'2026-11-30'}
 assert.equal(vehicleControlSchedule(friday,weekly,'team').date,friday)
})
test('nunca programa lunes, martes ni la semana siguiente', () => {
 assert.throws(()=>vehicleControlSchedule('2026-11-30'),/viernes válido/)
 assert.throws(()=>vehicleControlSchedule(friday,overrides([friday,'2026-11-26','2026-11-25'])),/viernes, jueves y miércoles/)
 assert.equal(vehicleControlFriday({id:'vehicle-control-2026-11-27-ka',date:'2026-11-30'}),friday)
 assert.equal(vehicleControlFriday({historyId:'vehicle-control-2026-11-27-ka'}),friday)
})
test('genera y reubica con hora de jueves/miércoles conservando identidad e informes',async()=>{
 const {buildVehicleControlRecords,rescheduleVehicleControlRecords}=await import('../src/domain/vehicles/vehicle-controls.mjs')
 const args={month:'2026-11',fromDate:'2026-11-23',assignments:[{vehicleId:'ka',technicianId:'t'}],vehicles:[{id:'ka',brand:'Ford',model:'Ka'}],technicians:[{id:'t',name:'Técnico Prueba'}],teams:[{teamId:'team',memberIds:['t']}]}
 const records=buildVehicleControlRecords({...args,weekly:overrides([friday])})
 assert.equal(records.length,1)
 assert.equal(records[0].date,'2026-11-26')
 assert.equal(records[0].time,'16:45')
 assert.equal(records[0].id,'vehicle-control-2026-11-27-ka')
 const completed={...records[0],id:'done',status:'Completado',technicalObservation:'Conservar'}
 const started={...records[0],id:'started',startedAt:'2026-11-26T19:45:00Z'}
 const moved=rescheduleVehicleControlRecords([records[0],completed,started],{weekly:overrides([friday,'2026-11-26'])})
 assert.equal(moved[0].date,'2026-11-25')
 assert.equal(moved[0].time,'16:45')
 assert.equal(moved[0].id,records[0].id)
 assert.equal(moved[1],completed)
 assert.equal(moved[2],started)
 const back=rescheduleVehicleControlRecords([moved[0]],{})
 assert.equal(back[0].date,friday)
 assert.equal(back[0].time,'15:45')
})


test('una decisión de feriado no corrige controles históricos ni sus horas', async () => {
 const { rescheduleVehicleControlRecords } = await import('../src/domain/vehicles/vehicle-controls.mjs')
 const past={id:'vehicle-control-2026-11-20-ka',date:'2026-11-20',time:'15:30',vehicleControl:true,status:'Pendiente'}
 const future={id:'vehicle-control-2026-11-27-ka',date:'2026-11-27',time:'15:45',vehicleControl:true,status:'Pendiente'}
 const next=rescheduleVehicleControlRecords([past,future],{fromDate:'2026-11-25',weekly:overrides(['2026-11-27'])})
 assert.strictEqual(next[0],past)
 assert.equal(next[0].time,'15:30')
 assert.equal(next[1].date,'2026-11-26')
 assert.equal(next[1].time,'16:45')
})
