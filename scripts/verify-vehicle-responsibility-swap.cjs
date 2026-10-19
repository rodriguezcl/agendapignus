// Real WeeklyPlanner, synthetic state, intercepted network. No production writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const geometry = require('./lib/modal-geometry.cjs')
const {applyStateOperations}=require('../api/_lib/state-operations.cjs')
const {validateChangedAgendaSchedules}=require('../api/_lib/scheduling-validation.cjs')
const {synchronizeVehicleControlAssignments}=require('../api/_lib/vehicle-control-assignment.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/vehicle-swap')
fs.mkdirSync(out, { recursive: true })
const tests = fs.readFileSync(path.join(root, 'tests/vehicle-responsibility-swap.test.cjs'), 'utf8')
const fixtureCode = tests.slice(tests.indexOf('function fixture()'), tests.indexOf('const command ='))
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import {createRoot} from 'react-dom/client';
import {vehicleControlService} from './domain/vehicles/vehicle-controls.mjs';
${cssImports}
const day='2026-10-23'; ${fixtureCode}
const seed=fixture(); seed.agenda.weekly._monthlyTeams['2026-10'].teams.push({teamId:'c',label:'Equipo 3',memberIds:[],members:[],tasks:[]});
seed.history.forEach(record=>{record.client=vehicleLabel(seed.vehicles.find(vehicle=>vehicle.id===record.vehicleId));record.service='Control semanal de vehículo';record.serviceId='vehicle-weekly-control'});
seed.services=[vehicleControlService()];
seed.agenda.weekly[day].teams.forEach(team=>{team.tasks=seed.history.filter(record=>record.teamId===team.teamId).map(record=>({...record,taskId:record.id,historyId:record.id}))});
seed.agenda.teams=structuredClone(seed.agenda.weekly[day].teams);
const technicians=['leonardo','mariano','pascual','santos'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),roleCode:'technician',role:'Técnico',status:'Activo'}));
seed.employees=technicians;
const user={id:'admin',name:'Administración',roleCode:'administrator',role:'Administrador'};
function Review(){
 const [state,setState]=useState(seed),[notice,setNotice]=useState('');
 window.__state=state; globalThis.__pignusHistory=state.history; globalThis.__pignusVehicles=state.vehicles; globalThis.__pignusCurrentUser=user;
 const commit=async payload=>{const next=await window.__persistSwap(state,payload);window.__writes=(window.__writes||0)+1;setState(next)};
 const save=async build=>commit({next:build(state)});
 return <div className="app-shell" data-theme={new URLSearchParams(location.search).get('theme')}><main><section className="content">{notice&&<p role="status">{notice}</p>}<WeeklyPlanner weekly={state.agenda.weekly} setWeekly={value=>setState(old=>({...old,agenda:{...old.agenda,weekly:typeof value==='function'?value(old.agenda.weekly):value}}))} history={state.history} setHistory={()=>{}} customers={[]} setCustomers={()=>{}} services={state.services} activeTechs={technicians} vehicles={state.vehicles} authUser={user} permissions={{weekly:true,weeklyVehicles:true}} setNotice={setNotice} persistWeeklyConfiguration={save} persistWeeklyService={command=>commit({operations:weeklyServiceMoveOperations(state,command)})} openDaily={()=>{}} /></section></main></div>
}
const theme=new URLSearchParams(location.search).get('theme');document.body.dataset.theme=theme;document.documentElement.dataset.theme=theme;
createRoot(document.getElementById('root')).render(<Review/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css' }, logLevel: 'silent' })
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '')
;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true }), results = []
  try {
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, timezoneId: 'America/Argentina/Buenos_Aires', reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
      await page.exposeFunction('__persistSwap',(previous,payload)=>{const next=synchronizeVehicleControlAssignments(payload.operations?applyStateOperations(previous,payload.operations):payload.next,previous);validateChangedAgendaSchedules(next,previous);return next});
      await page.clock.install({ time: new Date('2026-10-19T12:00:00-03:00') })
      await page.route('**/*', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/review') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script>' })
        if (pathname === '/qa.js') return route.fulfill({ contentType: 'text/javascript', body: js })
        if (pathname === '/qa.css') return route.fulfill({ contentType: 'text/css', body: css })
        return route.fulfill({ json: { holidays: [], days: [], records: [] } })
      })
      await page.goto(`https://vehicle-swap.test/review?theme=${theme}`)
      await page.getByRole('button', { name: 'Vehículos del mes', exact: true }).click()
      const monthly = page.getByRole('dialog', { name: /Vehículos de/ })
      await monthly.getByText('Intercambiar responsables esta semana', { exact: true }).click()
      await monthly.getByLabel('Primer vehículo', { exact: false }).selectOption('ka')
      await monthly.getByLabel('Segundo vehículo', { exact: false }).selectOption('kangoo')
      assert.match(await monthly.locator('.vehicle-swap-preview').innerText(), /Leonardo → Pascual/)
      await geometry(page, `swap-${width}-${theme}`)
      await page.screenshot({ path: path.join(out, `swap-${width}-${theme}.png`) })
      await monthly.getByRole('button', { name: 'Confirmar intercambio', exact: true }).click()
      await monthly.waitFor({ state: 'detached' })
      assert.deepEqual(await page.evaluate(() => window.__state.history.map(record => record.technicianIds)), [['pascual'], ['leonardo'], ['santos']])
      assert.equal(await page.evaluate(() => window.__writes), 1)
      await page.getByRole('button', { name: 'Vehículos del mes', exact: true }).click()
      const defaults = await monthly.locator('.monthly-vehicle-assignment > label select').evaluateAll(items => items.map(item => item.value))
      assert.deepEqual(defaults, ['leonardo', 'pascual', 'santos'])
      await monthly.getByRole('button', { name: 'Cancelar', exact: true }).click()
      const card = page.locator('.week-task-summary').filter({ hasText: 'Ford Ka' }).first()
      await card.click()
      await page.getByRole('button', { name: /Reasignar equipo o fecha/ }).click()
      const move = page.getByRole('dialog', { name: 'Cambiar equipo, horario o fecha', exact: true })
      await move.getByLabel('Equipo de destino', { exact: false }).selectOption('0')
      await move.getByLabel('Responsable del control', { exact: false }).selectOption('leonardo')
      await geometry(page, `move-${width}-${theme}`)
      await page.screenshot({ path: path.join(out, `move-${width}-${theme}.png`) })
      await move.getByRole('button', { name: 'Intercambiar controles', exact: true }).click()
      await move.waitFor({ state: 'detached' })
      assert.deepEqual(await page.evaluate(() => window.__state.history.map(record => record.technicianIds)), [['leonardo'], ['pascual'], ['santos']])
      assert.equal(await page.evaluate(() => window.__writes), 2)
      assert.deepEqual(errors, [])
      results.push({ width, theme, passed: true }); await context.close()
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
