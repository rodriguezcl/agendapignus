const test=require('node:test'),assert=require('node:assert/strict')
const {validateChangedAgendaSchedules}=require('../api/_lib/scheduling-validation.cjs')
test('transferring a holiday opens Friday, closes Monday and preserves bookings',async()=>{
 const {transferHoliday,holidayForDate,holidayIsBlocked}=await import('../src/domain/agenda/holidays.mjs')
 const from='2026-11-20',to='2026-11-23',holiday={date:from,name:'Soberanía Nacional'},user={id:'admin',name:'Admin'}
 const state={history:[{id:'r',date:to,time:'08:30',status:'Pendiente'}],agenda:{weekly:{[to]:{teams:[]}}}}
 const args={from,to,holiday,user,today:'2026-11-16'}
 const next=transferHoliday(state,args),w=next.agenda.weekly
 assert.equal(holidayIsBlocked(holidayForDate([holiday],from,w),w._holidayOverrides[from]),false)
 assert.equal(holidayIsBlocked(holidayForDate([holiday],to,w),w._holidayOverrides[to]),true)
 assert.equal(holidayForDate([],to,w).name,holiday.name)
 assert.deepEqual(next.history,state.history);assert.deepEqual(w[to],state.agenda.weekly[to]);assert.equal(state.agenda.weekly._holidayOverrides,undefined)
 assert.throws(()=>transferHoliday(next,args),/ya fue trasladado/)
 for(const date of [from,'2026-11-15','2026-02-30','invalid'])assert.throws(()=>transferHoliday(state,{...args,to:date}))
 assert.doesNotThrow(()=>validateChangedAgendaSchedules(next,state))
 assert.throws(()=>validateChangedAgendaSchedules({...next,history:[...next.history,{id:'new',date:to,time:'09:00'}]},next),/no operativo/)
 assert.throws(()=>validateChangedAgendaSchedules({...next,history:[{...next.history[0],time:'09:00'}]},next),/no operativo/)
})


test('trasladar viernes al lunes devuelve el control al viernes a las 15:45 y conserva el historial',async()=>{
 const {transferHoliday}=await import('../src/domain/agenda/holidays.mjs')
 const friday='2026-11-27',thursday='2026-11-26',monday='2026-11-30'
 const record={id:'vehicle-control-'+friday+'-ka',sourceTaskId:'control',date:thursday,time:'16:45',vehicleControlScheduledFriday:friday,vehicleControl:true,status:'Pendiente',teamId:'team',team:'Equipo 1',technicianIds:['tech'],technicians:['Técnico Prueba'],client:'Ford Ka'}
 const task={taskId:'control',historyId:record.id,time:record.time,client:record.client,vehicleControl:true}
 const team={teamId:'team',label:'Equipo 1',memberIds:['tech'],members:['Técnico Prueba'],tasks:[task]}
 const ordinary={id:'ordinary',date:monday,time:'08:30',status:'Pendiente'}
 const closed={...record,id:'closed',date:'2026-11-20',status:'Completado',technicalObservation:'Informe original'}
 const state={history:[record,ordinary,closed],agenda:{date:thursday,teams:[team],weekly:{_holidayOverrides:{[friday]:{status:'closed'}},_monthlyTeams:{'2026-11':{teams:[{...team,tasks:[]}]}},[thursday]:{teams:[team]}}}}
 const next=transferHoliday(state,{from:friday,to:monday,holiday:{date:friday,name:'Feriado'},user:{id:'admin'},today:'2026-11-25'})
 assert.equal(next.history[0].date,friday);assert.equal(next.history[0].time,'15:45');assert.equal(next.history[0].id,record.id)
 assert.deepEqual(next.history[1],ordinary);assert.deepEqual(next.history[2],closed)
 assert.ok(!next.agenda.teams.flatMap(t=>t.tasks).some(t=>t.historyId===record.id))
 assert.equal(next.agenda.weekly[friday].teams.flatMap(t=>t.tasks).find(t=>t.historyId===record.id).time,'15:45')
 assert.equal(state.history[0].date,thursday)
})

test('trasladar lunes al viernes adelanta el control al jueves a las 16:45',async()=>{
 const {transferHoliday}=await import('../src/domain/agenda/holidays.mjs')
 const friday='2026-11-27',monday='2026-11-23'
 const record={id:'vehicle-control-'+friday+'-ka',date:friday,time:'15:45',vehicleControl:true,vehicleControlScheduledFriday:friday,status:'Pendiente',teamId:'team',team:'Equipo 1',technicianIds:['tech'],technicians:['Técnico Prueba'],client:'Ford Ka'}
 const team={teamId:'team',label:'Equipo 1',memberIds:['tech'],members:['Técnico Prueba'],tasks:[{taskId:record.id,historyId:record.id,time:record.time,vehicleControl:true,client:record.client}]}
 const state={history:[record],agenda:{date:friday,teams:[team],weekly:{_monthlyTeams:{'2026-11':{teams:[{...team,tasks:[]}]}},[friday]:{teams:[team]}}}}
 const next=transferHoliday(state,{from:monday,to:friday,holiday:{date:monday,name:'Feriado'},user:{id:'admin'},today:monday})
 assert.equal(next.history[0].date,'2026-11-26');assert.equal(next.history[0].time,'16:45')
 assert.equal(next.history[0].vehicleControlScheduledFriday,friday)
 assert.ok(!next.agenda.teams.flatMap(t=>t.tasks).some(t=>t.historyId===record.id))
})
