const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToString, renderToStaticMarkup } = require('react-dom/server')
const { frontendSource } = require('./helpers/frontend-source.cjs')
const loadApp = require('./helpers/load-app.cjs')

test('daily and weekly components render through their actual prop forwarding chain', () => {
  const source = frontendSource()
  const compiled = { exports: loadApp(['Agenda', 'WeeklyPlanner', 'ServiceConfirmationButton', 'ServiceJourneys', 'ServiceJourneysContext', 'JourneyHistory', 'TechnicianPortal']) }
  const noop = () => {}
  const props = { date: '2026-01-05', teams: [], weekly: {}, customers: [], services: [], activeTechs: [], history: [], vehicles: [], permissions: {}, databaseReady: true, authUser: null,
    setDate: noop, setTeams: noop, setWeekly: noop, setHistory: noop, setCustomers: noop, setNotice: noop, updateTask: noop, openDaily: noop, persistAgendaRecords: async () => {}, persistWeeklyService: async () => {} }
  assert.doesNotThrow(() => renderToString(React.createElement(compiled.exports.Agenda, props)))
  const weekly = renderToString(React.createElement(compiled.exports.WeeklyPlanner, props))
  assert.match(weekly, /Agenda semanal/)
  assert.doesNotMatch(weekly, /weekly-save-day/)
  const confirmation = awaitingConfirmation => renderToString(React.createElement(compiled.exports.ServiceConfirmationButton, {
    task: { client: 'Cliente', awaitingConfirmation }, day: '2099-01-05', onDraftChange: noop
  }))
  assert.match(confirmation(false), /<span>Servicio a confirmar<\/span>/)
  assert.doesNotMatch(confirmation(false), /Marcar A CONFIRMAR/)
  assert.match(confirmation(true), /Confirmar servicio/)
  assert.equal(renderToString(React.createElement(compiled.exports.ServiceConfirmationButton, {
    task: { client: 'Vehículo', vehicleControl: true }, day: '2099-01-05', onDraftChange: noop
  })), '')
  const { ServiceJourneys, ServiceJourneysContext, JourneyHistory, TechnicianPortal } = compiled.exports
  const record = { id:'journey-first',date:'2099-01-05',time:'09:00',service:'Instalación de alarma',status:'Pendiente',client:'Cliente',team:'Equipo 1',technicians:['Técnico'],estimatedMinutes:120 }
  const provider = (enabled, content, history = [record]) => React.createElement(ServiceJourneysContext.Provider, {value:{enabled,today:'2026-09-21',history}}, content)
  assert.match(renderToString(provider(true,React.createElement(ServiceJourneys,{record}))),/Planificar varias jornadas/)
  assert.match(renderToString(provider(true,React.createElement(ServiceJourneys,{record,action:true}))), /icon-btn daily-journey-button/)
  assert.match(renderToString(provider(true,React.createElement(ServiceJourneys,{record,action:true}))), />Jornadas<\/button>/)
  const dailyActions = source.slice(source.indexOf('<div className="daily-task-actions">'))
  assert.match(dailyActions, /<ServiceJourneys[^>]+ action \/><ServiceConfirmationButton/)
  assert.doesNotMatch(source.slice(source.indexOf('<div className="daily-field-duration">'), source.indexOf('<div className="daily-task-actions">')), /<ServiceJourneys/)
  const compactJourney = renderToString(provider(true,React.createElement(ServiceJourneys,{record,compact:true})))
  assert.match(compactJourney,/aria-label="Planificar varias jornadas"/)
  assert.match(compactJourney,/journey-plan-compact/)
  assert.match(compactJourney,/<svg/)
  assert.doesNotMatch(compactJourney,/>Planificar varias jornadas</)
  assert.match(source, /<ServiceJourneys record=\{record\} toolbar disabled=\{Boolean\(dirty \|\| taskEditorSaving\)\} \/>/)
  assert.equal(renderToString(provider(false,React.createElement(ServiceJourneys,{record}))), '')
  const first={...record,technicianIds:['tech'],serviceJourney:{id:record.id,index:1,total:2}}
  const last={...first,id:'journey-last',date:'2099-01-06',serviceJourney:{id:record.id,index:2,total:2},technicalObservation:'Informe de prueba'}
  assert.equal(renderToString(provider(true,React.createElement(ServiceJourneys,{record:first,compact:true}))), '')
  assert.equal(renderToString(provider(true,React.createElement(ServiceJourneys,{record:first,action:true}))), '')
  const detail=renderToStaticMarkup(provider(false,React.createElement(JourneyHistory,{record:first}),[first,last]))
  assert.match(detail,/Jornada 1 de 2/)
  assert.match(detail,/Jornada 2 de 2/)
  assert.match(detail,/Informe de prueba/)
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'})
  const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1)
  const technical=renderToString(React.createElement(TechnicianPortal,{user:{id:'tech',name:'Técnico'},history:[{...first,date:today,time:'00:00',startedAt:'2020-01-01T12:00:00Z'},{...last,date:tomorrow.toISOString().slice(0,10)}],setHistory:noop,logout:noop}))
  assert.match(technical,/Registrar avance/)
  assert.doesNotMatch(technical,/Completar servicio/)
  const finalVisit=renderToString(React.createElement(TechnicianPortal,{user:{id:'tech',name:'Técnico'},history:[{...first,date:today,status:'Avance registrado'},{...last,date:tomorrow.toISOString().slice(0,10)}],setHistory:noop,logout:noop}))
  assert.match(finalVisit,/Completar servicio/)
  assert.doesNotMatch(finalVisit,/Registrar avance/)
  assert.doesNotMatch(technical,/>Marcar completado</)
})

test('la agenda distingue servicios sin persistir y confirma su alta en historial', () => {
  const source = frontendSource()

  assert.match(source, /record \? \(record\.status \|\| record\.technicalStatus \|\| 'Pendiente'\) : 'Sin guardar'/)
  assert.match(source, /Guardá la agenda para habilitarlo al técnico\./)
  assert.match(source, /El servidor no confirmó todos los servicios en el historial\./)
})

test('copiar la agenda sólo exporta y no registra ni limpia planificación', async () => {
  const source = frontendSource()
  const start = source.indexOf('  const copyAgenda = async () => {')
  const handler = source.slice(start, source.indexOf('  const previewValue', start))
  const copied = [], notices = []
  const vm = require('node:vm')
  let allowed = true
  const copy = vm.runInNewContext(handler + '\ncopyAgenda', {
    requirePermission: key => allowed && key === 'planning.copy',
    copyTextToClipboard: async text => { copied.push(text); return true }, message: 'agenda segura',
    setNotice: notice => notices.push(notice),
    registerHistory: () => { throw new Error('La exportación no debe guardar') },
    clearAgenda: () => { throw new Error('La exportación no debe limpiar') }
  })
  await copy()
  assert.deepEqual(copied, ['agenda segura'])
  assert.match(notices[0], /copiada/)
  allowed = false
  await copy()
  assert.equal(copied.length, 1)
})

test('la agenda diaria conserva la dotación semanal vigente al recuperar servicios históricos', () => {
  const source = frontendSource()
  const loader = source.slice(source.indexOf('const loadAgendaForDate'), source.indexOf('const activeServices', source.indexOf('const loadAgendaForDate')))

  assert.match(loader, /const plannedTeamKeys = new Set\(byTeam\.keys\(\)\)/)
  assert.match(loader, /if \(!plannedTeamKeys\.has\(teamKey\)\) \{[\s\S]*?record\.technicianIds[\s\S]*?record\.technicians/)
  assert.doesNotMatch(loader, /current\.memberIds = record\.technicianIds\?\.length \? record\.technicianIds : current\.memberIds\s+current\.members = record\.technicians\?\.length \? record\.technicians : current\.members\s+\/\/ Se aceptan/)
})
