// Real dialog components with synthetic data and intercepted HTTP only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const inspect = require('./lib/modal-geometry.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/modal-catalog')
fs.mkdirSync(out, { recursive: true })
const shared = fs.readFileSync(path.join(root, 'scripts/verify-admin-theme.cjs'), 'utf8')
const seeds = shared.slice(shared.indexOf('const themeReviewUser ='), shared.indexOf('const themeReviewNavigation ='))
const imports = [...fs.readFileSync('src/main.jsx', 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => `import '${m[1]}';`).join('\n')
const fixture = `import {createRoot} from 'react-dom/client';
${imports}
${seeds}
const params = new URLSearchParams(location.search), variant = params.get('case'), theme = params.get('theme');
const noop = () => {}, noSave = async () => { throw new Error('Revisión visual: no guarda datos.'); };
const completed = {...themeReviewHistory[0], team:'Equipo 1', monthlyFee:70000,freezeMonthlyFee:true,frozenMonths:6,amount:15000,paymentMethod:'Transferencia'};
const pending = {...themeReviewHistory[1],team:'Equipo 1',amount:15000,paymentMethod:'Efectivo'};
const records = Array.from({length:12},(_,index)=>({...completed,id:'detail-'+index,client:completed.client+' · '+index}));
globalThis.__pignusCurrentUser=themeReviewUser;
globalThis.__pignusHistory=themeReviewHistory;
document.body.dataset.theme=theme;
function ModalCatalog() {
 const [files,setFiles]=useState([]);
 const cases={
  category:<ServiceCategoryCorrection record={completed} services={themeReviewServices} close={noop} onSave={noSave}/>,
  reorder:<ReorderServicesModal tasks={[pending,themeReviewHistory[2]].map(r=>({...r,taskId:r.id}))} sourceId={pending.id} day={pending.date} onClose={noop} onSave={noSave}/>,
  journeys:<ServiceJourneysContext.Provider value={{enabled:true,today:'2026-10-13',history:themeReviewHistory,teamsForDate:()=>themeReviewTeams,save:noSave}}><ServiceJourneys record={pending}/></ServiceJourneysContext.Provider>,
  collection:<Collections history={[pending]} canManage onSave={noSave} setNotice={noop}/>,
  report:<TechnicianReportModal record={pending} type="Completado" serviceLabel={pending.service} pendingAttachments={files} onPendingAttachmentsChange={setFiles} onPreparingChange={noop} onClose={noop} onSubmit={noSave}/>,
  vehicleReport:<TechnicianReportModal record={{...themeReviewHistory[3],vehicleMileageAtScheduling:77000}} type="Completado" serviceLabel="Control semanal de vehículo" onPendingAttachmentsChange={setFiles} onPreparingChange={noop} onClose={noop} onSubmit={noSave}/>,
  serviceDetail:<HistoryDetail record={completed} customers={themeReviewCustomers} close={noop}/>,
  customer:<CustomerDetail customer={themeReviewCustomers[0]} history={themeReviewHistory} services={themeReviewServices} onCorrectSubscription={noSave} close={noop}/>,
  customerHistory:<CustomerServiceHistory customer={themeReviewCustomers[0]} history={records} close={noop}/>,
  installations:<AlarmDetailsModal records={records} month="2026-10" close={noop} download={noop}/>,
  retirements:<RetirementDetailsModal records={records} month="2026-10" close={noop} download={noop}/>,
  location:<LocationInstallationsModal records={records} category="all" label="Todas las instalaciones" month="2026-10" zoneOf={()=>'residencial'} close={noop}/>,
  preview:<Preview title="Agenda del equipo" text={'*Equipo 1*\\n'+records.map(r=>r.client+' · 08:30 · '+r.detail).join('\\n')} onCopy={noop} close={noop}/>,
  notification:<NotificationActionDialog notification={{title:'Solicitud pendiente',target:{type:'general'},detail:'Revisá los datos del servicio para continuar con la gestión.'}} history={[]} customers={[]} close={noop}/>,
  confirm:<Confirm title="Eliminar servicio" detail="Se solicitará eliminar este servicio y conservar la trazabilidad de la operación." destructive action={noSave} close={noop}/>
 };
 return <div className="app-shell" data-theme={theme}>{cases[variant]}</div>;
}
createRoot(document.getElementById('root')).render(<ModalCatalog/>);`
const built = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync('src/App.jsx','utf8') + '\n' + fixture, loader:'jsx',resolveDir:path.join(root,'src') },bundle:true,write:false,outdir:'out',format:'iife',external:['/logo-pignus.png','/pignus-owl-white.svg'],define:{'process.env.NODE_ENV':'"production"','import.meta.env.PROD':'false'},loader:{'.css':'css'},logLevel:'silent' })
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text.replace(/@import[^;]+;/g,''),js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
const cases=(process.env.MODAL_CASES||'category,reorder,journeys,collection,report,vehicleReport,serviceDetail,customer,customerHistory,installations,retirements,location,preview,notification,confirm').split(',')
const widths=(process.env.MODAL_WIDTHS||'320,390,768,1440').split(',').map(Number)
;(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),results=[],failures=[];
 try {for(const width of widths)for(const theme of ['light','dark'])for(const variant of cases){
  const label=variant+'-'+theme+'-'+width;
  const page=await browser.newPage({viewport:{width,height:width===768?600:844},timezoneId:'America/Argentina/Buenos_Aires'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
  await page.clock.install({time:new Date('2026-10-14T12:00:00-03:00')});
  await page.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/review')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{attachments:[],canWrite:true,records:[],requests:[]}});
   return route.fulfill({status:204});
  });
  try {
   await page.goto('https://modal-catalog.test/review?case='+variant+'&theme='+theme);await page.addStyleTag({content:css});await page.addScriptTag({content:js});
   if(variant==='journeys')await page.getByRole('button',{name:'Planificar varias jornadas',exact:true}).click();
   if(variant==='collection')await page.getByRole('button',{name:/^Gestionar cobranza de/}).click();
   await page.locator('.modal').first().waitFor();
   if(variant==='category')await page.locator('.service-types-trigger').click();
   if(variant==='report')await page.locator('.attachments summary').click();
   const dialogs=await inspect(page,label);
   await page.screenshot({path:path.join(out,label+'.png')});
   const modal=page.locator('.modal').last();
   if(await modal.evaluate(el=>el.scrollHeight>el.clientHeight+2)){
    await modal.evaluate(el=>{el.scrollTop=el.scrollHeight});
    await page.screenshot({path:path.join(out,label+'-bottom.png')});
    const last=modal.locator('.modal-actions button,.history-actions button,.confirm-actions button').last();
    if(await last.count()) {const b=await last.boundingBox();assert(b.y>=0&&b.y+b.height<=page.viewportSize().height,'Footer accessible by scrolling');}
   }
   assert.deepEqual(errors,[]);results.push({label,dialogs});console.log('PASS '+label);
  }catch(e){failures.push({label,error:e.message,errors});console.error('FAIL '+label+': '+e.message);await page.screenshot({path:path.join(out,label+'-failure.png')}).catch(()=>{});}
  await page.close();
 }}finally{await browser.close()}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,failures},null,2));console.log(results.length+' passed, '+failures.length+' failed');if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
