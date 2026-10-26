const workday = require('./workday.cjs')
const { localHolidayFallback } = require('./holidays.cjs')
const ZONE = 'America/Argentina/Buenos_Aires'
const MINUTE = 60000, DAY = 86400000
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' })
function localParts(at) { return Object.fromEntries(parts.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])) }
function localDate(at) { const p=localParts(at);return `${p.year}-${p.month}-${p.day}` }
function instant(date, time) {
  const wall=Date.parse(`${date}T${time}:00Z`)
  let value=wall
  for(let i=0;i<3;i++) { const p=localParts(value); const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); value+=wall-represented }
  return value
}
const nextDate = date => new Date(Date.parse(`${date}T12:00:00Z`)+DAY).toISOString().slice(0,10)
const holidayYears = new Map()
function holiday(date) {
  const year=Number(date.slice(0,4))
  if(!holidayYears.has(year)) holidayYears.set(year,new Set(localHolidayFallback(year).map(h=>h.date)))
  return holidayYears.get(year).has(date)
}
function calendarForWeekly(weekly={}) {
  const config=weekly._workday||{}
  const weekdays=Object.fromEntries([1,2,3,4,5,6].map(day=>{
    const row={...workday.defaults(day),...config.weekdays?.[day]}
    return [day,{start:row.start,end:day===6?(row.end<'12:00'?row.end:'12:00'):row.end}]
  }))
  const exceptions=Object.fromEntries(Object.entries(config.exceptions||{}).filter(([date])=>/^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date,row])=>[date,{start:row.start,end:row.end}]))
  const closedDates=Object.entries(weekly._holidayOverrides||{}).filter(([,value])=>value.status==='closed').map(([date])=>date).sort()
  return {timeZone:ZONE,weekdays,exceptions,closedDates,includeLunch:true,excludeHolidays:true}
}
function windowForDate(date, calendar=calendarForWeekly()) {
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()
  if(!weekday || holiday(date) || calendar.closedDates?.includes(date)) return null
  const row=calendar.exceptions?.[date]||calendar.weekdays?.[weekday]
  if(!row) return null
  const end=weekday===6&&row.end>'12:00'?'12:00':row.end
  if(row.start>=end) return null
  return [instant(date,row.start),instant(date,end)]
}
function addBusinessMinutes(start, minutes, calendar=calendarForWeekly()) {
  let cursor=new Date(start).getTime(), remaining=minutes*MINUTE, date=localDate(cursor)
  if(!Number.isFinite(cursor)||!Number.isFinite(remaining)||remaining<0) throw Error('Fecha o plazo laboral inválido.')
  if(!remaining)return new Date(cursor).toISOString()
  for(let days=0;days<36600;days++,date=nextDate(date)) {
    const window=windowForDate(date,calendar)
    if(!window)continue
    const from=Math.max(cursor,window[0]), available=Math.max(0,window[1]-from)
    if(remaining<=available)return new Date(from+remaining).toISOString()
    remaining-=available
  }
  throw Error('La jornada configurada no permite calcular el plazo laboral.')
}
function businessMinutesBetween(start, end, calendar=calendarForWeekly()) {
  const a=new Date(start).getTime(),b=new Date(end).getTime()
  if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('Fecha laboral inválida.')
  if(b<a)return -businessMinutesBetween(end,start,calendar)
  let total=0,date=localDate(a),last=localDate(b)
  for(let days=0;date<=last&&days<36600;days++,date=nextDate(date)) {
    const window=windowForDate(date,calendar)
    if(window)total+=Math.max(0,Math.min(b,window[1])-Math.max(a,window[0]))
  }
  return total/MINUTE
}
async function readCalendar(q, pg) {
  let weekly={}
  if(pg) {
    const [tables]=await q("SELECT to_regclass('normalized_shadow.storage_control') AS control, to_regclass('normalized_shadow.configuration_evidence') AS config, to_regclass('public.pignus_agendas') AS agenda")
    const normalized=tables.control&&tables.config&&(!process.env.PIGNUS_STORAGE_MODE||process.env.PIGNUS_STORAGE_MODE==='persistent')&&(await q('SELECT active_model FROM normalized_shadow.storage_control WHERE id=1'))[0]?.active_model==='normalized'
    if(normalized) {
      weekly=Object.fromEntries((await q("SELECT config_key,original_payload FROM normalized_shadow.configuration_evidence WHERE config_key IN ('_workday','_holidayOverrides')")).map(r=>[r.config_key,typeof r.original_payload==='string'?JSON.parse(r.original_payload):r.original_payload]))
    } else if(tables.agenda) {
      const [row]=await q("SELECT data->'weekly'->'_workday' AS workday, data->'weekly'->'_holidayOverrides' AS holidays FROM pignus_agendas WHERE id='current'")
      weekly={_workday:row?.workday,_holidayOverrides:row?.holidays}
    }
  } else if((await q("SELECT name FROM sqlite_master WHERE type='table' AND name='agendas'")).length) {
    const [row]=await q("SELECT data FROM agendas WHERE id='current'")
    weekly=row?JSON.parse(row.data).weekly||{}:{}
  }
  return calendarForWeekly(weekly)
}
module.exports={calendarForWeekly,readCalendar,addBusinessMinutes,businessMinutesBetween,windowForDate,localDate}
