const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), Module = require('node:module')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const { parseDocument } = require('htmlparser2')
let components
const day = '2099-10-09', noop = () => {}
const control = { taskId:'control', historyId:'control-history', vehicleControl:true, vehicleControlScheduledFriday:day, time:'08:30', service:'Control semanal de vehículo', client:'Vehículo', estimatedMinutes:15, status:'Pendiente' }
const work = { taskId:'work', historyId:'work-history', time:'10:00', service:'Servicio técnico', serviceId:'service', client:'Cliente', estimatedMinutes:60, status:'Pendiente' }
const team = { teamId:'team', label:'Equipo 1', memberIds:['tech'], members:['Técnico Uno'], tasks:[control, work] }
const user = { id:'admin', name:'Administración', roleCode:'administrator' }
test.before(async () => {
 const root = path.resolve(__dirname,'..')
 const built = await require('esbuild').build({ stdin:{ contents:`export { PermissionsProvider } from './src/presentation/contexts/permissions-context.jsx'; export { WeeklyPlanner } from './src/features/agenda/presentation/WeeklyPlanner.jsx'; export { AgendaWorkspaceForm } from './src/features/agenda/presentation/DailyAgenda.jsx'; export { default as HistoryRescheduleModal } from './src/components/HistoryRescheduleModal.jsx';`, loader:'jsx', resolveDir:root }, bundle:true, write:false, format:'cjs', platform:'node', external:['react','react-dom'], loader:{'.css':'empty'}, logLevel:'silent', plugins:[{name:'calendar-fixture', setup(build) { build.onLoad({filter:/useNationalHolidays\.js$/}, () => ({contents:'export const useNationalHolidays = () => ({ records:[], loading:false, error:"" })',loader:'js'})) }}] })
 const compiled = new Module(path.join(root,'test-control-pause-ui.cjs'),module); compiled.paths=module.paths; compiled._compile(built.outputFiles[0].text,compiled.id); components=compiled.exports
})
function walk(node, predicate) { if(predicate(node)) return node; for(const child of node.children || []) { const found=walk(child,predicate); if(found) return found } }
function render(name, paused, sourceTeam=team, records=[]) {
 const weekly={ [day]:{ teams:[sourceTeam] }, _monthlyTeams:{'2099-10':{teams:[{teamId:'team',memberIds:['tech'],members:['Técnico Uno']}]}}, _vehicleControls:{paused} }
 const props={ initialAnchor:day, date:day, weekly, teams:[sourceTeam], services:[{id:'service',name:'Servicio técnico',status:'Activo',estimatedMinutes:60}], customers:[], activeTechs:[{id:'tech',name:'Técnico Uno'}], history:records, vehicles:[], authUser:user, setWeekly:noop, setTeams:noop, setDate:noop, setCustomers:noop, setHistory:noop, setNotice:noop, updateTask:noop }
 const before=JSON.stringify(props)
 const html=renderToStaticMarkup(React.createElement(components.PermissionsProvider,{user},React.createElement(components[name],props)))
 assert.equal(JSON.stringify(props),before,'rendering must not change the stored tasks')
 return {html,document:parseDocument(html)}
}
for (const name of ['WeeklyPlanner','AgendaWorkspaceForm']) test(name+' hides paused controls, frees their interval and preserves following task identity', () => {
 const attribute=name==='WeeklyPlanner'?'data-weekly-search-key':'data-daily-task-id'
 const controlKey=name==='WeeklyPlanner'?day+'/0/0':'control'
 const workKey=name==='WeeklyPlanner'?day+'/0/1':'work'
 for(const paused of [false,true,false]) {
  const {html,document}=render(name,paused)
  const controlNode=walk(document,node=>node.attribs?.[attribute]===controlKey)
  const workNode=walk(document,node=>node.attribs?.[attribute]===workKey)
  assert.ok(controlNode,'control keeps its source position even when hidden')
  assert.ok(workNode,'ordinary service retains its stable position')
  assert.equal(controlNode.attribs.style==='display:none',paused)
  assert.notEqual(workNode.attribs.style,'display:none')
  assert.ok(html.includes('Disponibilidad horaria desde las '+(paused?'08:30':'08:45')+' hs hasta las 10:00 hs'),'released control interval becomes bookable')
 }
})
for (const name of ['WeeklyPlanner','AgendaWorkspaceForm']) test(name+' preserves controls with a technical report while paused',()=>{
 const reported={...control,status:'Completado',technicalStatus:'Completado',technicalReportedAt:'2099-10-09T12:00:00Z',completedAt:'2099-10-09T12:00:00Z'}
 const {document}=render(name,true,{...team,tasks:[reported,work]})
 const attribute=name==='WeeklyPlanner'?'data-weekly-search-key':'data-daily-task-id', key=name==='WeeklyPlanner'?day+'/0/0':'control'
 assert.notEqual(walk(document,node=>node.attribs?.[attribute]===key)?.attribs.style,'display:none')
})
test('reordering ordinary services retains the hidden control and the resulting task positions',async()=>{
 const {reorderServices}=await import('../src/domain/agenda/reorder-services.mjs')
 const second={...work,taskId:'second',historyId:'second-history',client:'Segundo cliente',time:'14:00'}
 const sourceTeam={...team,tasks:[control,work,second]}
 const state={agenda:{date:day,teams:[sourceTeam],weekly:{[day]:{teams:[sourceTeam]},_vehicleControls:{paused:true}}},history:sourceTeam.tasks.map(task=>({...task,id:task.historyId,date:day}))}
 const before=structuredClone(state)
 const reordered=reorderServices(state,{day,teamId:'team',baseline:sourceTeam.tasks,changes:[{taskId:'work',time:'14:00'},{taskId:'second',time:'10:00'}],validate:()=>{}})
 assert.deepEqual(state,before)
 const result=reordered.agenda.weekly[day].teams[0]
 assert.deepEqual(result.tasks.map(task=>task.taskId),['control','second','work'])
 const {document}=render('WeeklyPlanner',true,result,reordered.history)
 assert.equal(walk(document,node=>node.attribs?.['data-weekly-search-key']===day+'/0/0').attribs.style,'display:none')
 assert.equal(walk(document,node=>node.attribs?.['data-weekly-search-key']===day+'/0/1').attribs['data-weekly-search'],'Segundo cliente')
 assert.equal(walk(document,node=>node.attribs?.['data-weekly-search-key']===day+'/0/2').attribs['data-weekly-search'],'Cliente')
})
test('Historial explains pause and cannot select a reschedule time',()=>{
 const html=renderToStaticMarkup(React.createElement(components.HistoryRescheduleModal,{record:{...control,id:'control-history',date:day,teamId:'team'},estimatedMinutes:15,minimumDate:'2099-01-01',scheduling:{weekly:{_vehicleControls:{paused:true}},assignedTeamsForDate:()=>[team],teamsForDate:()=>[team]}}))
 assert.match(html,/Los controles vehiculares están pausados/)
 const document=parseDocument(html)
 assert.equal(walk(document,node=>node.attribs?.class==='reschedule-slots'),undefined)
 assert.ok(walk(document,node=>node.name==='input'&&node.attribs.type==='date').attribs.disabled!==undefined)
})
