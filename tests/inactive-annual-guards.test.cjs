const test = require('node:test')
const assert = require('node:assert/strict')
const { removeInactiveAssignments } = require('../api/_lib/inactive-employee-assignments.cjs')
const { guardForDate } = require('../api/_lib/annual-guard-rotation.cjs')
const rotation = ['a','b','c'].map(id => ({ technicianId: id, name: id.toUpperCase() }))
const fixture = () => ({ employees: rotation.map(g => ({ id: g.technicianId, name: g.name, status: g.technicianId === 'b' ? 'Inactivo' : 'Activo' })), history: [], agenda: { weekly: { _annualGuards: { 2026: { startDate: '2026-01-03', rotation } } } } })
test('redistribuye desde el próximo sábado sin alterar ninguna guardia histórica', () => {
 const state = fixture(), before = structuredClone(state)
 const next = removeInactiveAssignments(state,'2026-11-25'), config = next.agenda.weekly._annualGuards[2026]
 for(let d = new Date('2026-01-03T12:00:00Z'); d < new Date('2026-11-25T12:00:00Z'); d.setUTCDate(d.getUTCDate()+7)) {
  const date=d.toISOString().slice(0,10)
  assert.deepEqual(guardForDate(date,config),guardForDate(date,state.agenda.weekly._annualGuards[2026]))
 }
 const future = ['2026-11-28','2026-12-05','2026-12-12','2026-12-19','2026-12-26'].map(d=>guardForDate(d,config).technicianId)
 assert.ok(!future.includes('b'))
 assert.notEqual(future[0],future[1])
 assert.equal(future[0],future[2])
 assert.deepEqual(removeInactiveAssignments(next,'2026-11-26'),next)
 assert.deepEqual(state,before)
})
test('actualiza guardias materializadas y adelantos; conserva servicios cerrados', () => {
 const state=fixture(), date='2026-11-28', guard=guardForDate(date,state.agenda.weekly._annualGuards[2026])
 const team={ teamId:'guard', label:'Equipo 1', memberIds:[guard.technicianId], members:[guard.name], tasks:[{ taskId:'task',historyId:'r',status:'Pendiente' }] }
 state.agenda.weekly[date]={teams:[team]}
 state.agenda.weekly['2026-11-27']={teams:[{...team,teamId:'friday',label:'Guardia · '+guard.name,tasks:[{taskId:'f',historyId:'f',status:'Pendiente'}]}]}
 state.history=[{id:'r',date,teamId:'guard',status:'Pendiente',technicianIds:[guard.technicianId],technicians:[guard.name],detail:'Conservar'}, {id:'f',date:'2026-11-27',teamId:'friday',status:'Pendiente'}, {id:'closed',date:'2026-11-21',status:'Completado',technicianIds:['b'],technicalObservation:'Informe original'}]
 const next=removeInactiveAssignments(state,'2026-11-25'), expected=guardForDate(date,next.agenda.weekly._annualGuards[2026])
 assert.deepEqual(next.history[0].technicianIds,[expected.technicianId])
 assert.deepEqual(next.history[1].technicianIds,[expected.technicianId])
 assert.equal(next.history[0].detail,'Conservar')
 assert.deepEqual(next.history[2],state.history[2])
})
test('una segunda baja conserva la primera redistribución pasada y no restaura turnos al reactivar', () => {
 let state=removeInactiveAssignments(fixture(),'2026-11-25')
 const previous=guardForDate('2026-11-28',state.agenda.weekly._annualGuards[2026])
 state.employees=state.employees.map(e=>e.id==='c'?{...e,status:'Inactivo'}:e)
 state=removeInactiveAssignments(state,'2026-11-30')
 assert.deepEqual(guardForDate('2026-11-28',state.agenda.weekly._annualGuards[2026]),previous)
 assert.equal(guardForDate('2026-12-05',state.agenda.weekly._annualGuards[2026]).technicianId,'a')
 const config=structuredClone(state.agenda.weekly._annualGuards)
 state.employees=state.employees.map(e=>({...e,status:'Activo'}))
 assert.deepEqual(removeInactiveAssignments(state,'2026-12-01').agenda.weekly._annualGuards,config)
})
test('sin técnicos activos deja turnos vacíos y no altera años pasados', () => {
 const state=fixture();state.employees.forEach(e=>e.status='Inactivo')
 state.agenda.weekly._annualGuards[2025]={rotation,startDate:'2025-01-04'}
 const next=removeInactiveAssignments(state,'2026-11-25')
 assert.equal(guardForDate('2026-11-28',next.agenda.weekly._annualGuards[2026]),null)
 assert.deepEqual(next.agenda.weekly._annualGuards[2025],state.agenda.weekly._annualGuards[2025])
})

test('la redistribución conserva la atribución de informes y correcciones en ambas proyecciones', () => {
 for (const source of ['history', 'task', 'daily']) {
  for (const evidence of [{ technicalObservation: 'Observación original' }, { workCompletion: { corrections: [{ reason: 'Corrección original' }] } }]) {
   const state = fixture(), date = '2026-12-12'
   const originalGuard = guardForDate(date, state.agenda.weekly._annualGuards[2026])
   assert.equal(originalGuard.technicianId, 'b')
   const record = { id: 'report', sourceTaskId: 'report-task', date, teamId: 'guard', status: 'Pendiente', technicianIds: ['b'], technicians: ['B'], ...(source === 'history' ? evidence : {}) }
   const task = { taskId: 'report-task', historyId: 'report', status: 'Pendiente', technicianIds: ['b'], technicians: ['B'], ...(source === 'task' ? evidence : {}) }
   state.history = [record]
   state.agenda.weekly[date] = { teams: [{ teamId: 'guard', memberIds: ['b'], members: ['B'], tasks: [task] }] }
   if (source === 'daily') {
    state.agenda.date = date
    state.agenda.teams = structuredClone(state.agenda.weekly[date].teams)
    Object.assign(state.agenda.teams[0].tasks[0], evidence)
    delete state.agenda.teams[0].tasks[0].historyId
   }
   const next = removeInactiveAssignments(state, '2026-11-25')
   const nextTask = next.agenda.weekly[date].teams[0].tasks[0]
   assert.deepEqual(nextTask, task, 'La tarjeta con evidencia propia o del historial conserva la atribución')
   assert.deepEqual(next.history[0], record, 'La evidencia de la tarjeta también protege la atribución del historial')
   if (source === 'daily') assert.deepEqual(next.agenda.teams[0].tasks, state.agenda.teams[0].tasks)
   assert.equal(guardForDate(date, next.agenda.weekly._annualGuards[2026]).technicianId === 'b', false)
   assert.deepEqual(next.agenda.weekly[date].teams[0].memberIds, [], 'El inactivo deja de integrar el equipo operativo')
  }
 }
})
