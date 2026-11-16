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
