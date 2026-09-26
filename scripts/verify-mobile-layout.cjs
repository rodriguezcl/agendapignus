// Local visual regression fixture. Uses synthetic data and never connects to production.
// Run with Playwright available in NODE_PATH; screenshots go to ignored tmp/.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const fixture = `
import { createRoot } from 'react-dom/client';
import './components/ui/modal-chrome.css';
import './mobile-layout.css';
const noop = () => {};
const record = { id:'demo', date:'2026-09-25', time:'13:00', client:'PIG-0001 CLIENTE DE PRUEBA CON NOMBRE LARGO', address:'Dirección de prueba 123, Córdoba', service:'Service de alarma', status:'Requiere revisión', technicalStatus:'Reprogramación solicitada', technicians:['Técnico de prueba'], estimatedMinutes:90 };
const demoTeam = {teamId:'demo-team',label:'Equipo 1',memberIds:['demo-tech'],members:['Técnico de prueba']};
const configuredMonths = Object.fromEntries(Array.from({length:12},(_,i)=>['2026-'+String(i+1).padStart(2,'0'),{teams:[demoTeam],defaultTimes:['09:00','14:00']} ]));
const props = {weekly:{_monthlyTeams:configuredMonths}, history:[record], customers:[], services:[], activeTechs:[{id:'demo-tech',name:'Técnico de prueba'}], vehicles:[], employees:[], roles:[], permissions:{}, authUser:{roleCode:'administrator',name:'Administrador de prueba'},setWeekly:noop,setHistory:noop,setCustomers:noop,setNotice:noop,openDaily:noop,persistWeeklyService:async()=>{},persistWeeklyConfiguration:async()=>{}};
const view = new URLSearchParams(location.search).get('view');
const content = view === 'history' ? <HistoryBulkView {...props} /> : view === 'modal' ? <Confirm title="Confirmar cambio" detail="Esta es una vista de prueba." action={noop} close={noop} /> : view === 'employees' || view === 'employee-modal' ? <Employees {...props} employees={[]} setEmployees={noop} setRoles={noop} ask={noop} /> : view === 'accounts' ? <Accounts {...props} teams={[]} isAdministrator={false} ask={noop} /> : view === 'vehicles' ? <Vehicles {...props} setVehicles={noop} ask={noop} /> : <WeeklyPlanner {...props} />;
createRoot(document.getElementById('root')).render(<div className="app-shell" data-theme={new URLSearchParams(location.search).get('theme') || 'light'}><main><section className="content">{content}</section></main></div>);
`
const built = buildSync({ stdin:{contents:`import './style.css';\n${source}\n${fixture}`,loader:'jsx',resolveDir:path.join(root,'src')},bundle:true,write:false,outdir:'out',format:'iife',external:['/logo-pignus.png'],define:{'process.env.NODE_ENV':'"production"','import.meta.env.PROD':'false'},loader:{'.css':'css'},logLevel:'silent' })
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const server = http.createServer((req,res) => {
  if (req.url.startsWith('/api/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({holidays:[],records:[]}));return}
  if (req.url === '/fixture.js') {res.setHeader('Content-Type','text/javascript');res.end(js);return}
  res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
})
async function main() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const browser = await chromium.launch({headless:true,channel:'msedge'})
  const output = path.join(root,'tmp','mobile-layout')
  fs.mkdirSync(output,{recursive:true})
  try {
    const page = await browser.newPage()
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    for (const width of [320,390,640,1280]) for (const view of ['weekly','history','employees','employee-modal','accounts','vehicles','modal']) {
      await page.setViewportSize({width,height:844})
      await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}`)
      await page.locator(view==='modal'?'.confirm-modal':'.module-intro').waitFor()
      if(view==='weekly' && await page.locator('.monthly-teams-modal .modal-close').count()) await page.locator('.monthly-teams-modal .modal-close').click()
      if(view==='history') await page.locator('.history-date-filters').waitFor()
      if(view==='employee-modal') {await page.getByRole('button',{name:'Nuevo empleado'}).click();await page.locator('.employee-form').waitFor()}
      const metrics=await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,search:document.querySelector('.weekly-service-search')?.getBoundingClientRect().height,actions:document.querySelector('.weekly-actions')?.getBoundingClientRect().height,card:document.querySelector('.history-row')?.getBoundingClientRect().height}))
      if(width<=640) assert.ok(metrics.scroll<=width+1,`${view}/${width}: horizontal overflow ${metrics.scroll}`)
      if(width<=640&&view==='weekly') {assert.ok(metrics.search<150,JSON.stringify(metrics));assert.ok(metrics.actions<330,JSON.stringify(metrics))}
      if(width<=640&&view==='history') assert.ok(metrics.card<340,JSON.stringify(metrics))
      await page.screenshot({path:path.join(output,`${view}-${width}.png`),fullPage:true})
      if(view==='history'&&width<=640) {
        assert.equal(await page.locator('.history-header-actions .primary').isVisible(),false)
        await page.locator('.history-row input[type=checkbox]').check()
        assert.equal(await page.locator('.history-header-actions .primary').isVisible(),true)
      }
      console.log(JSON.stringify({view,...metrics}))
    }
    assert.deepEqual(errors,[])
  } finally {await browser.close();server.close()}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1})
