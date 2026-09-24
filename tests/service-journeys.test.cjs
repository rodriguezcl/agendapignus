const test = require('node:test')
const assert = require('node:assert/strict')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')
const { validateServiceJourneys, assertJourneyReport } = require('../api/_lib/service-journeys.cjs')

function fixture() {
  const record = { id:'work-one', sourceTaskId:'one', date:'2099-01-05', time:'09:00', status:'Pendiente', customerId:'customer', serviceId:'alarm', service:'Instalación de alarma', teamId:'team', team:'Equipo 1', technicianIds:['tech'], technicians:['Técnico'], estimatedMinutes:60 }
  const team = { teamId:'team', label:'Equipo 1', memberIds:['tech'], members:['Técnico'], tasks:[{...record,taskId:'one',historyId:record.id}] }
  return { record, team, state:{ history:[record], customers:[], agenda:{ date:record.date, teams:[structuredClone(team)], weekly:{[record.date]:{teams:[structuredClone(team)]}} } } }
}
async function planned() {
  const { planServiceJourneyOperations } = await import('../src/features/state/application/service-journeys.mjs')
  const { record, team, state } = fixture()
  const options = { base:record,today:'2099-01-01',visits:[{date:record.date,time:record.time,teamId:'team',estimatedMinutes:120},{date:'2099-01-06',time:'14:00',teamId:'team',estimatedMinutes:90}],teamsForDate:()=>[{...team,tasks:[]}],createId:()=> 'two' }
  const operations = planServiceJourneyOperations(state, options)
  return {state,options,operations,next:applyStateOperations(state,operations),planServiceJourneyOperations}
}
test('all journeys are one atomic command with daily, weekly and history projections',async()=>{
  const {state,next}=await planned()
  assert.equal(state.history.length,1)
  assert.equal(next.history.length,2)
  assert.deepEqual(next.history.map(r=>r.serviceJourney),[{id:'work-one',index:1,total:2},{id:'work-one',index:2,total:2}])
  assert.equal(next.agenda.teams[0].tasks[0].serviceJourney.total,2)
  assert.equal(next.agenda.weekly['2099-01-06'].teams[0].tasks[0].historyId,'work-two')
  assert.doesNotThrow(()=>validateServiceJourneys(next,state))
})
test('stale base or invalid destination never generates partial reservations',async()=>{
  const {state,options,planServiceJourneyOperations:plan}=await planned()
  assert.throws(()=>plan({...state,history:[{...state.history[0],detail:'changed'}]},options),/cambió/)
  assert.throws(()=>plan(state,{...options,teamsForDate:()=>[]}),/equipo/)
  assert.throws(()=>plan(state,{...options,visits:[options.visits[0],{...options.visits[1],time:'23:00'}]}),/duración/)
  assert.equal(state.history.length,1)
})
test('only intermediate visits accept advance; final completion requires earlier visits resolved',async()=>{
  const {next}=await planned(); const [first,last]=next.history
  assert.throws(()=>assertJourneyReport(first,'Completado',next.history),/intermedia/)
  assert.throws(()=>assertJourneyReport(last,'Avance registrado',next.history),/intermedia/)
  assert.throws(()=>assertJourneyReport(last,'Completado',next.history),/anteriores/)
  first.status='Avance registrado';first.technicalStatus='Avance registrado'
  assert.doesNotThrow(()=>assertJourneyReport(last,'Completado',next.history))
  const {technicianRecordResolved}=await import('../src/domain/technicians/technician-history.mjs')
  assert.equal(technicianRecordResolved(first),true)
  const {countYearToDateCompletedRecords,dashboardPendingGroups}=await import('../src/domain/dashboard/dashboard-metrics.mjs')
  assert.equal(countYearToDateCompletedRecords(next.history,{throughDate:'2099-12-31'}),0)
  assert.equal(dashboardPendingGroups(next.history,'2099-01-05').today.length,0)
  last.status='Completado'
  assert.equal(countYearToDateCompletedRecords(next.history,{throughDate:'2099-12-31'}),1)
})
test('missing visits, identity edits and wrong customer are rejected on server',async()=>{
  const {next,state}=await planned()
  assert.throws(()=>validateServiceJourneys({...next,history:next.history.slice(0,1)},state),/jornadas.*juntas/)
  const changed=structuredClone(next);changed.history[1].customerId='other'
  assert.throws(()=>validateServiceJourneys(changed,next),/mismo cliente/)
  changed.history[1].serviceJourney.index=1
  assert.throws(()=>validateServiceJourneys(changed,next),/identidad/)
})

for (const status of ['Pendiente', 'Cancelado', 'Completado']) {
  test(`retirar la última jornada ${status} libera ambas agendas y conserva el historial vinculado`, async () => {
    const { weeklyTaskRemovalOperations } = await import('../src/features/state/application/weekly-task-removal.mjs')
    const { authorizeIncomingState } = require('../api/_lib/core.cjs')
    const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
    const { next: state } = await planned()
    const [first, last] = state.history
    first.status = 'Avance registrado'
    first.technicalStatus = 'Avance registrado'
    first.technicalObservation = 'Trabajo realizado en la primera jornada'
    last.status = status
    if (status !== 'Pendiente') {
      last.technicalStatus = status
      last.technicalObservation = 'Informe que debe conservarse'
    }
    state.roles = []; state.employees = []; state.reviews = []
    state.agenda.date = last.date
    state.agenda.teams = structuredClone(state.agenda.weekly[last.date].teams)
    const command = { day: last.date, teamId: last.teamId, taskId: last.sourceTaskId, historyId: last.id, taskIndex: 0 }
    const operations = weeklyTaskRemovalOperations(state, command)
    const next = applyStateOperations(state, operations)
    assert.equal(next.agenda.teams[0].tasks.length, 0)
    assert.equal(next.agenda.weekly[last.date].teams[0].tasks.length, 0)
    assert.equal(next.history.length, 2)
    assert.deepEqual(next.history[0], first)
    assert.deepEqual(next.history[1].serviceJourney, last.serviceJourney)
    assert.equal(next.history[1].status, status === 'Pendiente' ? 'Cancelado' : status)
    if (status !== 'Pendiente') assert.deepEqual(next.history[1], last)
    assert.doesNotThrow(() => validateServiceJourneys(next, state))
    assert.deepEqual(applyStateOperations(next, operations), next)
    assert.deepEqual(weeklyTaskRemovalOperations(next, command), [])
    assert.equal(technicianAgendaServices(next.history, last.date).length, 0)
    // Agenda-only users can release a reservation without general history rights.
    const authorized = authorizeIncomingState(next, state, { roleCode: 'user', permissions: { agenda: true, weekly: true } })
    assert.deepEqual(authorized.history, next.history)
    assert.doesNotThrow(() => validateServiceJourneys(authorized, state))
    if (status === 'Pendiente') {
      const concurrent = structuredClone(state)
      concurrent.history[1].startedAt = '2099-01-06T17:00:00.000Z'
      assert.throws(() => applyStateOperations(concurrent, operations), { code: 'RECORD_WRITE_CONFLICT' })
      assert.throws(() => weeklyTaskRemovalOperations(concurrent, command), /ya fue iniciada/)
    }
  })
}

test('advance releases the technician and the planned slot without completing the service', async () => {
  const { next } = await planned()
  const first = { ...next.history[0], status:'Avance registrado', technicalStatus:'Avance registrado', technicalReportedAt:'2099-01-05T12:31:00.000Z' }
  const { technicianAgendaServices } = await import('../src/domain/technicians/technician-history.mjs')
  const { taskOccupiedInterval } = await import('../src/domain/agenda/service-scheduling.mjs')
  const { completedReleaseMinute, agendaTaskIsResolvedForPlanning } = require('../api/_lib/scheduling-validation.cjs')
  assert.deepEqual(technicianAgendaServices([first, next.history[1]], first.date).map(item=>item.id), ['work-two'])
  assert.equal(taskOccupiedInterval(first).endTime, '09:45')
  assert.equal(completedReleaseMinute(first), 585)
  assert.equal(agendaTaskIsResolvedForPlanning(first, first.date, [first], first.date), true)
  assert.equal(first.completedAt, undefined)
  const adminAdvance = { ...first, technicalStatus:'', technicalReportedAt:'', journeyClosedAt:'2099-01-05T12:31:00.000Z' }
  assert.equal(technicianAgendaServices([adminAdvance], first.date).length, 0)
  assert.equal(taskOccupiedInterval(adminAdvance).endTime, '09:45')
})

test('a changed crew or original service rejects the entire command; retries are idempotent', async () => {
  const { state, operations, next } = await planned()
  const changed = structuredClone(state)
  changed.agenda.weekly['2099-01-05'].teams[0].memberIds=['other']
  assert.throws(()=>applyStateOperations(changed, operations), {code:'RECORD_WRITE_CONFLICT'})
  assert.equal(changed.history.length, 1)
  assert.deepEqual(applyStateOperations(next, operations), next)
})

test('a conflict on any destination is rejected by the shared server schedule validator', async () => {
  const { next, state } = await planned()
  const { validateChangedAgendaSchedules } = require('../api/_lib/scheduling-validation.cjs')
  next.agenda.weekly['2099-01-06'].teams[0].tasks.push({ taskId:'occupied',serviceId:'alarm',service:'Instalación de alarma',time:'14:30',estimatedMinutes:60,customerId:'another' })
  assert.throws(()=>validateChangedAgendaSchedules(next,state), /superpon|incompatib|conflicto/i)
})

test('linked days retain their identities when rescheduled and cannot reverse the planned order', async () => {
  const { next } = await planned()
  const { historyRescheduleOperations } = await import('../src/features/state/application/history-reschedule.mjs')
  const base=next.history[1], team=next.agenda.weekly[base.date].teams[0]
  const result=applyStateOperations(next,historyRescheduleOperations(next,{base,team,day:'2099-01-07',time:'10:00',today:'2099-01-01'}))
  assert.deepEqual(result.history[1].serviceJourney,base.serviceJourney)
  assert.doesNotThrow(()=>validateServiceJourneys(result,next))
  result.history[1].date='2099-01-05'
  assert.throws(()=>validateServiceJourneys(result,next),/posterior/)
})

test('technician visibility preserves journey labels but excludes private planning data', async () => {
  const { next } = await planned()
  const { visibleStateForUser, technicianSafeRecord } = require('../api/_lib/core.cjs')
  const first={...next.history[0],internalNote:'private',internalChecklist:[{text:'private',completed:false}],awaitingConfirmation:true}
  const safe=technicianSafeRecord(first)
  assert.deepEqual(safe.serviceJourney,first.serviceJourney)
  assert.equal(safe.internalNote,undefined)
  assert.equal(safe.internalChecklist,undefined)
  const visible=visibleStateForUser({...next,history:[first,next.history[1]],vehicles:[]},{id:'tech',roleCode:'technician'})
  assert.deepEqual(visible.history.map(item=>item.id),['work-two'])
  const { startTechnicianServiceRecord }=require('../api/_lib/technician-service-start.cjs')
  assert.throws(()=>startTechnicianServiceRecord({...first,awaitingConfirmation:false,status:'Avance registrado'},{id:'tech'}),/informado/)
})

test('normalized storage round-trips all journeys and the new advance status', async () => {
  const { next } = await planned()
  const fs=require('node:fs'),path=require('node:path')
  const { PGlite }=await import('@electric-sql/pglite'),pg=await PGlite.create()
  const { buildShadowCandidate,insertShadowCandidate }=require('../api/_lib/normalization-rehearsal.cjs')
  const { readNormalizedState,synchronizeNormalizedState }=require('../api/_lib/normalized-state-repository.cjs')
  const state={...next,revision:1,roles:[{id:'role',name:'Técnico',code:'technician'}],employees:[{id:'tech',roleId:'role',name:'Técnico'}],customers:[{customerId:'customer',account:'CLI-1',name:'Cliente'}],services:[{id:'alarm',code:'alarm-installation',name:'Instalación de alarma',estimatedMinutes:60}],vehicles:[],reviews:[],preferences:{theme:'light'}}
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname,'../supabase/proposals/normalized-shadow-v1.sql'),'utf8'))
    await insertShadowCandidate(pg,buildShadowCandidate(state))
    assert.deepEqual(await readNormalizedState(pg),state)
    const updated=structuredClone(state);updated.revision=2
    updated.history[0].status='Avance registrado';updated.history[0].technicalStatus='Avance registrado';updated.history[0].technicalObservation='Cableado terminado'
    const { synchronizeAgendaHistoryRecord }=require('../api/_lib/history-record-operation.cjs')
    updated.agenda=synchronizeAgendaHistoryRecord(updated.agenda,state.history[0],updated.history[0])
    await synchronizeNormalizedState(pg,state,updated)
    assert.deepEqual(await readNormalizedState(pg),JSON.parse(JSON.stringify(updated)))
  } finally { await pg.close() }
})
