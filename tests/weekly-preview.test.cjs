const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { dayAgendaPreview, WeeklyPlanner } = require('./helpers/load-app.cjs')(['dayAgendaPreview', 'WeeklyPlanner'])
test('weekly preview shares chronological services without internal data or unconfirmed visits', () => {
 const tasks = [{service:'Service de cámaras',client:'Tarde',time:'15:00',detail:'Detalle público',internalNote:'SECRETO',formEmail:'privado@example.com',monthlyFee:'90000'}, {service:'Service de alarma',client:'Mañana',time:'09:00'}, {service:'Instalación',client:'POR CONFIRMAR',time:'08:30',awaitingConfirmation:true}]
 const teams = [{label:'Equipo 3',members:['Ana'],tasks}]
 const before=JSON.stringify(teams)
 const text=dayAgendaPreview('2026-10-20',teams,[])
 assert(text.indexOf('Mañana')<text.indexOf('Tarde'))
 assert.match(text,/Equipo 3/)
 assert.doesNotMatch(text,/SECRETO|privado@example.com|90000|POR CONFIRMAR/)
 assert.equal(JSON.stringify(teams),before)
 assert.match(dayAgendaPreview('2026-10-20',[{...teams[0],tasks:[tasks[2]]}],[],[],true),/A CONFIRMAR/)
})
test('weekly headers offer preview instead of navigating to daily agenda', () => {
 const noop=()=>{}
 const html=renderToStaticMarkup(React.createElement(WeeklyPlanner,{weekly:{},history:[],customers:[],services:[],activeTechs:[],vehicles:[],permissions:{},setWeekly:noop,setHistory:noop,setCustomers:noop,setNotice:noop,openDaily:()=>{throw Error('must not navigate')}}))
 assert.match(html,/Vista previa/)
 assert.doesNotMatch(html,/>Abrir día<|>Ver día</)
})
