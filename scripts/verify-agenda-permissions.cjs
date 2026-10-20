/* Synthetic component integration. All requests are intercepted locally; no
   production data, credentials, or external services are used. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/agenda-permissions')
fs.mkdirSync(output, { recursive: true })
const theme = fs.readFileSync(path.join(__dirname, 'verify-admin-theme.cjs'), 'utf8')
const data = theme.slice(theme.indexOf('const themeReviewUser ='), theme.indexOf('const themeReviewNavigation ='))
const cssFor = file => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PermissionsProvider} from './presentation/contexts/permissions-context.jsx';
import {WeeklyPlanner} from './features/agenda/presentation/WeeklyPlanner.jsx';
import {AgendaWorkspaceForm} from './features/agenda/presentation/DailyAgenda.jsx';
import {TechnicianPortal} from './features/technicians/presentation/TechnicianPortal.jsx';
${cssFor('src/App.jsx')}
${cssFor('src/main.jsx')}
${data}
window.__commands = []; window.__copied = [];
window.__technicalRecords = [{...themeReviewHistory.find(record => record.id === 'h-pending'),date:'2026-10-13',time:'00:00',startedAt:'2026-10-13T00:00:00Z'}];
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)}, configurable:true});
function Fixture() {
  const [scenario,setScenario] = useState({version:0,mode:'weekly',ids:['weekly.view','records.read'],userId:'tech-1'});
  const [weekly,setWeekly] = useState(structuredClone(themeReviewWeekly));
  const [history,setHistory] = useState(structuredClone(themeReviewHistory));
  const [date,setDate] = useState('2026-10-14');
  const [teams,setTeams] = useState(structuredClone(themeReviewWeekly['2026-10-14'].teams));
  const [revision,setRevision] = useState(1), [notice,setNotice] = useState('');
  window.__configure = (mode,ids,userId='tech-1') => {
    window.__commands=[]; window.__copied=[];
    setWeekly(structuredClone(themeReviewWeekly)); setHistory(structuredClone(mode==='technical'?window.__technicalRecords:themeReviewHistory));
    setTeams(structuredClone(themeReviewWeekly['2026-10-14'].teams));setDate('2026-10-14');
    setNotice('');setScenario(previous=>({version:previous.version+1,mode,ids,userId}));
  };
  const user={id:scenario.userId,name:'Prueba de permisos',roleCode:'operator',permissions:{__catalogV2:true,...Object.fromEntries(scenario.ids.map(id=>[id,true]))}};
  const persist = async command => {
    window.__commands.push(structuredClone(command));
    if (command.record) {
      setHistory(previous=>previous.map(record=>record.id===command.record.id?command.record:record));
      setWeekly(previous=>({...previous,[command.day]:{...previous[command.day],teams:previous[command.day].teams.map(team=>team.teamId!==command.team.teamId?team:{...team,tasks:team.tasks.map(task=>task.historyId===command.record.id?command.task:task)})}}));
    } else if (command.operation==='service-preparation') setHistory(previous=>previous.map(record=>record.id===command.base.id?{...record,servicePreparation:{ready:command.ready,byName:'Prueba'}}:record));
    else if(command.operation==='team-members') setWeekly(previous=>({...previous,[command.day]:{...previous[command.day],teams:previous[command.day].teams.map(team=>team.teamId!==command.teamId?team:{...team,memberIds:command.memberIds,members:command.members})}}));
    setRevision(previous=>previous+1);return {revision:revision+1};
  };
  const shared={weekly,setWeekly,history,setHistory,date,setDate,teams,setTeams,customers:themeReviewCustomers,setCustomers:()=>{},services:themeReviewServices,activeTechs:themeReviewEmployees,vehicles:themeReviewVehicles,setNotice,authUser:user,
    persistWeeklyService:persist,persistAgendaRecords:async records=>{window.__commands.push({records});return history},
    persistWeeklyConfiguration:async transform=>{const before={agenda:{weekly},history};const next=transform(before);window.__commands.push({configuration:true,before:structuredClone(before),after:structuredClone(next)});setWeekly(next.agenda.weekly);setHistory(next.history)},
    updateTask:(ti,i,patch)=>setTeams(previous=>previous.map((team,index)=>index!==ti?team:{...team,tasks:team.tasks.map((task,index)=>index!==i?task:{...task,...patch})})),
    databaseReady:true,confirmedRevision:revision,openDaily:()=>{}};
  return <PermissionsProvider user={user}><div className="app-shell" data-theme="light"><main><section className="content"><output data-notice>{notice}</output>{
    scenario.mode==='technical'?<TechnicianPortal key={scenario.version} user={user} history={history} setHistory={setHistory} logout={()=>{}}/>:
    scenario.mode==='daily'?<AgendaWorkspaceForm key={scenario.version} {...shared}/>:
    <WeeklyPlanner key={scenario.version} {...shared}/>
  }</section></main></div></PermissionsProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`
const bundle = buildSync({ stdin: { contents: source, loader: 'jsx', resolveDir: path.join(root, 'src') }, jsx: 'automatic', bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const results = []
  try {
    for (const width of (process.env.PERMISSION_WIDTHS || '1440,390').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = [], writes = []
      page.on('pageerror', error => errors.push(error.message))
      page.setDefaultTimeout(10000)
      await page.clock.setFixedTime(new Date('2026-10-13T12:00:00-03:00'))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== 'agenda-permissions.test') return route.abort()
        if (request.method() !== 'GET') { writes.push(request.url()); return route.abort() }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
        if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: js })
        if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css })
        if (url.pathname === '/api/technician/state') return route.fulfill({ json: { history: await page.evaluate(() => window.__technicalRecords), vehicles: [], revision: 1 } })
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { holidays: [], days: [], attachments: [] } })
        return route.abort()
      })
      await page.goto('http://agenda-permissions.test/')
      const base = ['weekly.view', 'records.read']
      const configure = async (mode, rights, userId) => {
        await page.evaluate(({ mode, rights, userId }) => window.__configure(mode, rights, userId), { mode, rights, userId })
        if (mode === 'weekly') await page.locator('[data-day="2026-10-14"] .week-team').first().waitFor()
        else if (mode === 'daily') await page.locator('.team-card').first().waitFor()
        else await page.locator('.technician-service').first().waitFor()
      }
      await configure('weekly', base)
      assert.equal(await page.locator('.service-preparation-button').count(), 0)
      assert.equal(await page.locator('.weekly-add-tech-button').count(), 0)
      assert.equal(await page.locator('.weekly-add-team').count(), 0)
      await configure('weekly', [...base, 'planning.ready'])
      const ready = page.locator('[data-day="2026-10-14"] .service-preparation-button').first()
      await ready.click()
      await page.waitForFunction(() => window.__commands.length === 1)
      assert.equal(await page.evaluate(() => window.__commands[0].operation), 'service-preparation')
      await configure('weekly', [...base, 'planning.notes'])
      await page.locator('[data-day="2026-10-14"] .week-task-summary').first().click()
      const editor = page.locator('.weekly-task-modal')
      await editor.waitFor()
      assert.equal(await editor.locator('input[type="time"]').isDisabled(), true)
      assert.equal(await editor.locator('.service-types-trigger').isDisabled(), true)
      assert.equal(await editor.getByText('Forma de pago', { exact: true }).count(), 0)
      await editor.locator('.internal-note-field textarea').fill('Nota permitida sin editar datos generales')
      await editor.getByRole('button', { name: 'Guardar servicio', exact: true }).click()
      await page.waitForFunction(() => window.__commands.length === 1)
      assert.equal(await page.evaluate(() => window.__commands[0].record.internalNote), 'Nota permitida sin editar datos generales')
      assert.equal(await page.evaluate(() => window.__commands[0].record.id), 'h-pending')
      await configure('weekly', [...base, 'weekly.monthlyHours.read'])
      await page.getByRole('button', { name: 'Horarios del mes', exact: true }).click()
      const hours = page.getByRole('dialog', { name: 'Horarios del mes · 2026-10', exact: true })
      await hours.waitFor()
      assert.equal(await hours.locator('input').count(), 0)
      assert.equal(await hours.getByRole('button', { name: 'Guardar horarios', exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => window.__commands.length), 0)
      await configure('weekly', [...base, 'weekly.monthlyHours.read', 'weekly.monthlyHours.manage'])
      await page.getByRole('button', { name: 'Horarios del mes', exact: true }).click()
      await hours.waitFor()
      await hours.getByLabel('Aplicar desde', { exact: true }).fill('2026-10-14')
      await hours.getByLabel('Primera franja', { exact: true }).fill('09:00')
      await hours.getByLabel('Segunda franja', { exact: true }).fill('11:00')
      await hours.getByRole('button', { name: 'Agregar o actualizar período', exact: true }).click()
      assert.equal(await page.evaluate(() => window.__commands.length), 0, 'Editing hours only changes the local draft')
      await hours.getByRole('button', { name: 'Guardar horarios', exact: true }).click()
      await page.waitForFunction(() => window.__commands.length === 1)
      const configCommand = await page.evaluate(() => window.__commands[0])
      assert.equal(configCommand.configuration, true)
      const oldMonth = configCommand.before.agenda.weekly._monthlyTeams['2026-10']
      const nextMonth = configCommand.after.agenda.weekly._monthlyTeams['2026-10']
      assert.deepEqual(nextMonth.teams, oldMonth.teams)
      assert.deepEqual(nextMonth.vehicleAssignments, oldMonth.vehicleAssignments)
      assert.deepEqual(nextMonth.defaultTimePeriods, [{ from: '2026-10-14', times: ['09:00', '11:00'] }])
      assert.deepEqual(configCommand.after.history, configCommand.before.history)
      const { defaultTimePeriods, defaultTimes, ...otherMonthlyFields } = nextMonth
      assert.deepEqual(otherMonthlyFields, oldMonth)
      await configure('daily', ['agenda.view', 'records.read', 'planning.copy'])
      await page.getByRole('button', { name: 'Copiar agenda', exact: true }).click()
      await page.waitForFunction(() => window.__copied.length === 1)
      assert.equal(await page.evaluate(() => window.__commands.length), 0)
      assert.equal(await page.getByRole('button', { name: 'Guardar agenda', exact: true }).count(), 0)
      await configure('technical', ['technical.view', 'records.read', 'technical.complete'])
      assert.equal(await page.locator('.technician-start-service').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Solicitar reprogramación', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Informar cancelación', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Marcar completado', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      assert.deepEqual(errors, [], 'No browser exceptions')
      assert.deepEqual(writes, [], 'No network writes')
      await page.screenshot({ path: path.join(output, `technical-complete-${width}.png`), fullPage: true })
      results.push({ width, readonly: true, independentReady: true, notesWithoutEdit: true, monthlyHoursReadOnly: true, monthlyHoursManagePreservesTeamsAndVehicles: true, copyWithoutSave: true, completeWithoutStart: true, browserErrors: 0, networkWrites: 0 })
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
