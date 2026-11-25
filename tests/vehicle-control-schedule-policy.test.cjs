const test = require('node:test')
const assert = require('node:assert/strict')
const { assertVehicleControlSchedule, validateVehicleControlSchedules } = require('../api/_lib/vehicle-control-schedule-policy.cjs')
const friday = '2026-11-27'
const base = { id: 'vehicle-control-' + friday + '-ford', sourceTaskId: 'control', vehicleControl: true, vehicleControlScheduledFriday: friday, date: friday, time: '15:45', estimatedMinutes: 15, teamId: 'team', status: 'Pendiente' }
const closed = dates => ({ _holidayOverrides: Object.fromEntries(dates.map(day => [day,{status:'closed'}])) })
test('rechaza lunes, cambio de semana y horario libre incluso con cierre viernes', () => {
 for(const patch of [{date:'2026-11-30',time:'08:30'}, {date:'2026-11-26',time:'16:45'}, {time:'15:30'}, {estimatedMinutes:30}, {date:'2026-12-04',vehicleControlScheduledFriday:'2026-12-04'}]) assert.throws(()=>assertVehicleControlSchedule({...base,...patch},base,{}))
 assert.throws(()=>assertVehicleControlSchedule({...base,date:'2026-11-30'},base,closed([friday])))
})
test('admite jueves o miércoles a 16:45 solo si los días anteriores están cerrados', () => {
 assert.doesNotThrow(()=>assertVehicleControlSchedule({...base,date:'2026-11-26',time:'16:45'},base,closed([friday])))
 assert.doesNotThrow(()=>assertVehicleControlSchedule({...base,date:'2026-11-25',time:'16:45'},base,closed([friday,'2026-11-26'])))
 assert.throws(()=>assertVehicleControlSchedule({...base,date:'2026-11-26'},base,closed([friday])))
 assert.throws(()=>assertVehicleControlSchedule({...base,date:'2026-11-24',time:'16:45'},base,closed([friday,'2026-11-26','2026-11-25'])))
})
test('preserva informes legados y permite corregir un control movido erróneamente', () => {
 const wrong={...base,date:'2026-11-30',time:'08:30'}
 assert.doesNotThrow(()=>assertVehicleControlSchedule({...wrong,detail:'Nota'},wrong,{}))
 assert.doesNotThrow(()=>assertVehicleControlSchedule({...wrong,status:'Completado',technicalStatus:'Completado'},wrong,{}))
 assert.doesNotThrow(()=>assertVehicleControlSchedule(base,wrong,{}))
})
test('controla también scheduledDate de Historial y cambios que intentan quitar vehicleControl', () => {
 assert.throws(()=>assertVehicleControlSchedule({...base,status:'Reprogramado',scheduledDate:'2026-11-30'},base,{}))
 assert.throws(()=>assertVehicleControlSchedule({...base,vehicleControl:false,date:'2026-11-30'},base,{}))
})
test('valida historial y proyecciones semanal y diaria aunque solo cambie una de ellas', () => {
 const task={...base,taskId:'control',historyId:base.id}
 const before={history:[base],agenda:{date:friday,teams:[{teamId:'team',tasks:[task]}],weekly:{[friday]:{teams:[{teamId:'team',tasks:[task]}]}}}}
 assert.doesNotThrow(()=>validateVehicleControlSchedules(before,before))
 const historyChange=structuredClone(before);historyChange.history[0].date='2026-11-30'
 assert.throws(()=>validateVehicleControlSchedules(historyChange,before))
 const weeklyChange=structuredClone(before);weeklyChange.agenda.weekly[friday].teams[0].tasks[0].time='08:30'
 assert.throws(()=>validateVehicleControlSchedules(weeklyChange,before))
 const dailyChange=structuredClone(before);dailyChange.agenda.teams[0].tasks[0].time='08:30'
 assert.throws(()=>validateVehicleControlSchedules(dailyChange,before))
})
test('altas nuevas respetan la misma ventana y el cierre configurado', () => {
 assert.doesNotThrow(()=>assertVehicleControlSchedule(base,null,{}))
 assert.throws(()=>assertVehicleControlSchedule({...base,time:'08:30'},null,{}))
 const weekly={...closed([friday]),_workday:{exceptions:{'2026-11-26':{end:'16:00'}}}}
 assert.doesNotThrow(()=>assertVehicleControlSchedule({...base,date:'2026-11-26',time:'15:45'},base,weekly))
})


test('los endpoints individuales y masivos de Historial rechazan reprogramar un control al lunes', () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
 const { createRequire } = require('node:module')
 for (const entry of ['api/index.js', 'server.cjs']) {
  const filename = path.resolve(__dirname, '..', entry)
  const source = fs.readFileSync(filename, 'utf8')
  const start = source.indexOf('function managedHistoryRecord(')
  const end = source.indexOf('\n}', start) + 2
  assert.ok(start >= 0 && end > start, entry)
  const state = { agenda: { weekly: closed([friday]) } }
  const context = {
   endpointPolicy: { restoreServiceProposal: (_current, proposed) => proposed },
   require: createRequire(filename),
   readState: () => state,
   isGranular: () => { throw Object.assign(new Error('Continúa con las políticas posteriores'), { code: 'NEXT_POLICY_REACHED' }) }
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context, { filename })
  // Both legacy and granular state call the same managed-record boundary.
  for (const accessState of entry === 'server.cjs' ? [undefined, state] : [state]) {
   assert.throws(() => context.managedHistoryRecord(base, { ...base, date: '2026-11-30', time: '08:30' }, {}, '2026-11-25T12:00:00Z', accessState), { code: 'VEHICLE_CONTROL_SCHEDULE_INVALID' }, entry)
   assert.throws(() => context.managedHistoryRecord(base, { ...base, status: 'Reprogramado', scheduledDate: '2026-11-30' }, {}, '2026-11-25T12:00:00Z', accessState), { code: 'VEHICLE_CONTROL_SCHEDULE_INVALID' }, entry)
   assert.throws(() => context.managedHistoryRecord(base, { ...base, date: '2026-11-26', time: '16:45' }, {}, '2026-11-25T12:00:00Z', accessState), { code: 'NEXT_POLICY_REACHED' }, entry)
  }
 }
})

test('una aprobación de adelanto antigua tampoco puede cambiar el horario del control', () => {
 const { resolveServiceAdvance } = require('../api/_lib/service-advance.cjs')
 assert.throws(()=>resolveServiceAdvance({...base,advanceRequest:{status:'pending',requestedTime:'08:30'}},{id:'admin'},'approved'), /horario fijos/)
})
