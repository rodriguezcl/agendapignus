const test=require('node:test'),assert=require('node:assert/strict')
const clock=require('../api/_lib/ticket-business-clock.cjs')
const sla=require('../api/_lib/ticket-sla.cjs')
const iso=value=>new Date(value).toISOString()
test('SLA laboral: ingreso, almuerzo, noche, sábado, domingo y feriado',()=>{
 const add=(start,n,end)=>assert.equal(clock.addBusinessMinutes(start,n),iso(end))
 add('2026-10-26T07:00:00-03:00',60,'2026-10-26T09:00:00-03:00')
 add('2026-10-26T12:30:00-03:00',90,'2026-10-26T14:00:00-03:00')
 add('2026-10-26T16:30:00-03:00',60,'2026-10-27T08:30:00-03:00')
 add('2026-10-30T19:30:00-03:00',60,'2026-10-31T08:30:00-03:00')
 add('2026-10-31T11:30:00-03:00',60,'2026-11-02T08:30:00-03:00')
 add('2026-11-01T10:00:00-03:00',15,'2026-11-02T08:15:00-03:00')
 add('2026-12-24T16:30:00-03:00',60,'2026-12-26T08:30:00-03:00')
 add('2026-12-31T16:30:00-03:00',60,'2027-01-02T08:30:00-03:00')
 add('2026-10-26T16:59:30-03:00',1,'2026-10-27T08:00:30-03:00')
 assert.equal(clock.businessMinutesBetween('2026-10-26T17:00:00-03:00','2026-10-27T08:00:00-03:00'),0)
 assert.equal(clock.businessMinutesBetween('2026-10-27T09:00:00-03:00','2026-10-26T16:00:00-03:00'),-120)
})
test('SLA laboral utiliza jornada global y excepciones; no extiende el sábado ni adopta guardias por equipo',()=>{
 const calendar=clock.calendarForWeekly({_workday:{weekdays:{1:{start:'09:00',end:'16:00'},6:{start:'08:00',end:'17:00'}},exceptions:{'2026-10-27':{start:'10:00',end:'15:00'},'2026-10-28|team-a':{start:'01:00',end:'23:00'}}},_holidayOverrides:{'2026-10-29':{status:'closed'},'2026-12-25':{status:'open'}}})
 assert.equal(clock.addBusinessMinutes('2026-10-26T15:30:00-03:00',60,calendar),iso('2026-10-27T10:30:00-03:00'))
 assert.equal(clock.windowForDate('2026-10-28',calendar)[0],Date.parse('2026-10-28T08:00:00-03:00'))
 assert.equal(clock.windowForDate('2026-10-31',calendar)[1],Date.parse('2026-10-31T12:00:00-03:00'))
 assert.equal(clock.windowForDate('2026-10-29',calendar),null)
 assert.equal(clock.windowForDate('2026-12-25',calendar),null)
})
test('SLA migra abiertos conservando inicio y objetivos; conserva cerrados y sus ciclos históricos',()=>{
 const config={sla:sla.defaultSlaConfig()},start='2026-10-23T22:00:00.000Z'
 const old={version:1,clock:'elapsed',policy:{clock:'elapsed',priorities:config.sla.priorities},priority:'Alta',cycle:1,startedAt:start,firstResponseAt:'',lastHumanUpdateAt:'',completedAt:'',history:[],firstResponseDueAt:'2026-10-23T23:00:00.000Z',resolutionDueAt:'2026-10-24T22:00:00.000Z',updateDueAt:'2026-10-24T02:00:00.000Z'}
 const item={id:'x',status:'Nuevo',priority:'Alta',sla:structuredClone(old)}
 sla.initSla(item,config,'2026-10-26T12:00:00.000Z')
 assert.equal(item.sla.clock,'business');assert.equal(item.sla.startedAt,start)
 assert.equal(item.sla.clockMigration.resolutionDueAt,old.resolutionDueAt)
 assert.equal(item.sla.resolutionDueAt,iso('2026-10-28T09:00:00-03:00'))
 const saved=structuredClone(item.sla);sla.initSla(item,config,'2026-10-27T12:00:00.000Z');assert.deepEqual(item.sla,saved)
 assert.deepEqual(sla.dueReminders(item,'2026-10-31T15:00:00.000Z'),[])
 const closed={...item,status:'Resuelto',sla:structuredClone({...old,completedAt:'2026-10-24T23:00:00.000Z'})}
 sla.initSla(closed,config);assert.equal(closed.sla.clock,'elapsed')
 const previous=structuredClone(closed);closed.status='En gestión'
 sla.transitionSla(closed,previous,'reopen',config,'2026-10-26T12:00:00.000Z')
 assert.equal(closed.sla.clock,'business');assert.equal(closed.sla.history[0].clock,'elapsed')
 assert.equal(closed.sla.history[0].resolutionDueAt,old.resolutionDueAt)
 const closing={id:'closing',status:'Nuevo',priority:'Alta',sla:structuredClone(old)}
 const beforeClosing=structuredClone(closing);closing.status='Resuelto'
 sla.transitionSla(closing,beforeClosing,'resolve',config,'2026-10-26T12:00:00.000Z',{humanUpdate:true,actorId:'support'})
 assert.equal(closing.sla.clock,'business')
 assert.equal(sla.slaView(closing).resolution.status,'met')
})
