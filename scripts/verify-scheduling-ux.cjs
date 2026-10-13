const fs=require('node:fs'), path=require('node:path'), {buildSync}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/ux-audit/scheduling-fixed')
const assert=require('node:assert/strict')
fs.mkdirSync(out,{recursive:true})
const shared=fs.readFileSync(path.join(root,'scripts/verify-admin-theme.cjs'),'utf8')
const fixtures=shared.slice(shared.indexOf('const themeReviewUser ='),shared.indexOf('const themeReviewNavigation ='))
const cssImports=[...fs.readFileSync(path.join(root,'src/main.jsx'),'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import '${m[1]}';`).join('\n')
const seed=`
import {createRoot} from 'react-dom/client'; ${cssImports}
import {installRequiredFeedback} from './presentation/components/forms/required-feedback.mjs';
installRequiredFeedback();
${fixtures}
for(const record of themeReviewHistory){if(record.serviceId==='s-alarm'){record.freezeMonthlyFee=false;record.frozenMonths=0}}
if(window.__auditVolume){
 themeReviewEmployees.push(...[4,5].map(n=>({...themeReviewEmployees[0],id:'tech-'+n,firstName:'Técnico '+n,name:'Técnico '+n+' De Demostración',email:'tech'+n+'@example.test'})));
 themeReviewVehicles.push({...themeReviewVehicles[0],id:'v-3',plate:'AD789GH'});
 themeReviewTeams.push({id:'team-3',teamId:'team-3',label:'Equipo 3',name:'Equipo 3',memberIds:['tech-4','tech-5'],members:['Técnico 4 De Demostración','Técnico 5 De Demostración'],tasks:[]});
 themeReviewWeekly._monthlyTeams['2026-10'].vehicleAssignments.push({vehicleId:'v-3',technicianId:'tech-4'});
 for(let n=0;n<130;n++)themeReviewHistory.push({...themeReviewHistory[2],id:'volume-'+n,date:'2026-09-'+String(n%28+1).padStart(2,'0'),client:'PIG-'+(8000+n)+' CLIENTE HISTÓRICO DE PRUEBA CON NOMBRE EXTENSO '+n,status:n%3===0?'Cancelado':'Completado',time:['08:30','10:00','14:00'][n%3]});
 for(const day of ['2026-10-15','2026-10-16'])for(const [ti,team]of themeReviewTeams.entries())for(const[si,time]of ['08:30','10:00','11:30','14:00','15:30'].entries())themeReviewHistory.push({...themeReviewHistory[2],id:'busy-'+day+'-'+ti+'-'+si,date:day,time,scheduledTime:time,teamId:team.teamId,teamName:team.label,technicianIds:team.memberIds,technicians:team.members,estimatedMinutes:60,client:'CLI-'+ti+si+' CONSORCIO DE PROPIETARIOS DEL EDIFICIO TERRAZAS DEL PARQUE - TORRE NORTE - '+si,detail:'Visita coordinada con encargado: revisar cada cámara y conexión. '+('Observación extensa de ejemplo. '.repeat(12))});
}
themeReviewHistory.push(
 {...themeReviewHistory[2],id:'h-tech-cancelled',date:'2026-10-12',client:'CANCELADO POR TÉCNICO',status:'Requiere revisión',technicalStatus:'Cancelado',technicalObservation:'El cliente no se encontraba.',technicalReportedAt:'2026-10-12T15:00:00Z'},
 {...themeReviewHistory[2],id:'h-admin-cancelled',date:'2026-10-12',client:'CANCELADO POR ADMINISTRACIÓN',status:'Cancelado'},
 {...themeReviewHistory[2],id:'h-reschedule',date:'2026-10-12',client:'REPROGRAMACIÓN SOLICITADA',status:'Requiere revisión',technicalStatus:'Reprogramación solicitada'},
 {...themeReviewHistory[2],id:'h-reserve',date:'2026-10-15',time:'08:30',scheduledTime:'08:30',teamId:'team-2',teamName:'Equipo 2',customerId:null,client:'RESERVA PIG DE PRUEBA',subscriberReservation:true,serviceId:'s-alarm',service:'Instalación de alarma',installationZone:'residencial',monthlyFee:70000,frozenMonths:'No',technicianIds:['tech-3'],technicians:['Pascual Ejemplo']}
);
for(const day of ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17'])themeReviewWeekly[day]={teams:themeReviewTeams.map(team=>({...team,tasks:themeReviewHistory.filter(record=>record.date===day&&record.teamId===team.id).map(record=>({...record,taskId:'task-'+record.id,historyId:record.id}))}))};
window.__themeSeed={revision:1,roles:themeReviewRoles,employees:themeReviewEmployees,services:themeReviewServices,customers:themeReviewCustomers,vehicles:themeReviewVehicles,history:themeReviewHistory,agenda:{date:'2026-10-13',teams:themeReviewTeams,weekly:themeReviewWeekly}};
window.__themeUser=themeReviewUser;
localStorage.setItem('pignus-theme-account:admin-review',window.__auditTheme||'light');
createRoot(document.getElementById('root')).render(<App/>);`
const built=buildSync({stdin:{contents:"import './style.css';\n"+fs.readFileSync(path.join(root,'src/App.jsx'),'utf8')+'\n'+seed,loader:'jsx',resolveDir:path.join(root,'src')},bundle:true,write:false,outdir:'out',format:'iife',external:['/logo-pignus.png'],define:{'process.env.NODE_ENV':'"production"','import.meta.env.PROD':'false'},loader:{'.css':'css'},logLevel:'silent'})
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/a.css"></head><body><div id="root"></div><script src="/a.js"></script></body></html>'
const results=[]
;(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 for(const width of (process.env.AUDIT_WIDTHS||'1440,390').split(',').map(Number))for(const theme of (process.env.AUDIT_THEMES||'light,dark').split(',')){
  const context=await browser.newContext({viewport:{width,height:960},timezoneId:'America/Argentina/Buenos_Aires',reducedMotion:'reduce'}),page=await context.newPage()
  page.setDefaultTimeout(7000)
  const errors=[],writes=[],events=[];page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install({time:new Date('2026-10-13T12:00:00-03:00')})
  await page.addInitScript(({theme,volume})=>{window.__auditTheme=theme;window.__auditVolume=volume},{theme,volume:true})
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.hostname!=='scheduling-audit.test')return route.abort()
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html})
   if(url.pathname==='/a.css')return route.fulfill({contentType:'text/css',body:css})
   if(url.pathname==='/a.js')return route.fulfill({contentType:'application/javascript',body:js})
   if(url.pathname==='/logo-pignus.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'public/logo-pignus.png'))})
   if(url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/auth/activity')return route.fulfill({json:{ok:true}})
    if(req.method()!=='GET'){writes.push({method:req.method(),path:url.pathname,body:req.postData()});return route.fulfill({status:503,json:{error:'Conexión interrumpida: error simulado de auditoría'}})}
    const state=await page.evaluate(()=>({user:window.__themeUser,state:window.__themeSeed})).catch(()=>null)
    if(!state)return route.abort().catch(()=>{})
    if(url.pathname==='/api/auth/session')return route.fulfill({json:state})
    if(url.pathname==='/api/state')return route.fulfill({json:state.state})
    if(url.pathname.includes('revision'))return route.fulfill({json:{revision:1}})
    if(url.pathname.includes('weather'))return route.fulfill({json:{days:[]}})
    if(url.pathname.startsWith('/api/attachments/'))return route.fulfill({json:{attachments:[],canWrite:true,cameraOnly:false}})
    return route.fulfill({json:{requests:[],holidays:[],attachments:[]}})
   }return route.abort()
  })
  const snap=async(name)=>{await page.screenshot({path:path.join(out,`${name}-${theme}-${width}.png`),fullPage:false});events.push({screenshot:name,metrics:await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,active:document.activeElement?.outerHTML?.slice(0,300),modals:[...document.querySelectorAll('.modal')].map(x=>({class:x.className,w:x.getBoundingClientRect().width,left:x.getBoundingClientRect().left,scroll:x.scrollWidth}))}))})}
  const nav=async name=>{if(width<=640)await page.locator('.sidebar-toggle').click();await page.locator('.sidebar nav').getByRole('button',{name,exact:true}).click()}
  const close=async()=>{for(let i=0;i<6&&await page.locator('.modal-layer,.modal-backdrop').count();i++){const modal=page.locator('.modal').last();if(await modal.getByRole('button',{name:'Cancelar carga',exact:true}).count()){await modal.getByRole('button',{name:'Cancelar carga',exact:true}).click();continue}const dismiss=modal.locator('.modal-close,.close-modal').first();if(await dismiss.count())await dismiss.click();else await modal.getByRole('button',{name:/Cancelar|Cerrar|Volver|Seguir editando/}).first().click()}}
  let currentView='Agenda semanal'
  const fresh=async()=>{await page.reload();await page.locator('.stats-grid').first().waitFor();await nav(currentView);await page.locator(currentView==='Agenda semanal'?'.week-task-summary':'.history-row').first().waitFor()}
  const step=async(name,action)=>{try{await fresh();await action();events.push({step:name,result:'completed'})}catch(error){events.push({step:name,error:error.message});await snap(name+'-error').catch(()=>{});await close().catch(()=>{})}fs.writeFileSync(path.join(out,`progress-${theme}-${width}.json`),JSON.stringify({events,errors,writes},null,2))}
  await page.goto('https://scheduling-audit.test/');await page.locator('.stats-grid').first().waitFor()
  await nav('Agenda semanal');await page.locator('.week-task-summary').first().waitFor();await snap('weekly')
  const openNew=()=>page.locator('[data-day="2026-10-14"] .weekly-time-gap').first().getByRole('button',{name:'Agregar servicio'}).click()
  await step('cancel-five-new-services',async()=>{
    const before=await page.locator('.available-slot').count(),start=writes.length
    for(let index=0;index<5;index++){
      await openNew();await page.locator('.weekly-task-modal').getByRole('button',{name:'Cancelar',exact:true}).click()
      await page.locator('.weekly-task-modal').waitFor({state:'detached'})
    }
    await page.waitForTimeout(1500)
    assert.equal(await page.locator('.available-slot').count(),before)
    assert.equal(writes.length,start,'Opening and cancelling an empty service must not request persistence')
    await snap('cancel-five-new-services')
  })
  await step('new-service-save-and-discard',async()=>{
    const start=writes.length
    await openNew()
    await page.locator('.weekly-task-modal .service-types-trigger').click()
    await page.locator('.service-types-options').getByLabel('Servicio de cámaras',{exact:true}).check()
    const input=page.locator('.weekly-task-modal input[role="combobox"]')
    await input.fill('CLI-0002')
    await page.locator('.weekly-task-modal .customer-autocomplete-results').getByRole('option').first().click()
    await page.locator('.weekly-task-modal textarea').first().fill('NUEVA VISITA DE REGRESIÓN')
    await page.locator('.weekly-task-modal').getByRole('button',{name:'Guardar servicio',exact:true}).click()
    await page.locator('.weekly-task-modal .field-error').filter({hasText:'No se guardó el servicio.'}).waitFor()
    const operations=writes.slice(start).flatMap(write=>JSON.parse(write.body).operations||[])
    assert.ok(operations.some(operation=>operation.path[0]==='history'&&operation.after?.detail==='NUEVA VISITA DE REGRESIÓN'&&operation.after?.customerId==='c-2'),'Explicit save must contain the complete new service')
    assert.ok(!operations.some(operation=>operation.after?.manualSlot===true),'No empty placeholder operation is submitted')
    await page.locator('.weekly-task-modal').getByRole('button',{name:'Cancelar',exact:true}).click()
    await page.locator('.unsaved-service-modal').waitFor()
    await page.locator('.unsaved-service-modal').getByRole('button',{name:'Cancelar carga',exact:true}).click()
    assert.equal(await page.locator('.available-slot').count(),0)
    await snap('new-service-error-discarded')
  })
  await step('weekly-dropdown-escape-and-tab-actions',async()=>{
    await openNew()
    await page.locator('.weekly-task-modal .service-types-trigger').click()
    const serviceChoice=page.locator('.service-types-options').getByLabel('Instalación de alarma',{exact:true})
    await serviceChoice.focus();await page.keyboard.press('Escape')
    assert.equal(await page.locator('.weekly-task-modal').count(),1,'Escape closes the dropdown, retaining the editor')
    assert.equal(await page.locator('.service-types-options').count(),0)
    await page.locator('.weekly-task-modal .service-types-trigger').click()
    await serviceChoice.check()
    const input=page.locator('.weekly-task-modal input[role="combobox"]')
    await input.fill('RESERVA SIN COINCIDENCIAS')
    await input.press('Tab')
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('customer-reservation-button')),true)
    await page.keyboard.press('Enter')
    await page.locator('.weekly-customer-data-note').filter({hasText:'provisorios'}).waitFor()
    await page.locator('.weekly-task-modal').getByRole('button',{name:'Cancelar',exact:true}).click()
    await page.locator('.unsaved-service-modal').getByRole('button',{name:'Cancelar carga',exact:true}).click()
    await openNew()
    await page.locator('.weekly-task-modal .service-types-trigger').click()
    await page.locator('.service-types-options').getByLabel('Servicio de cámaras',{exact:true}).check()
    await input.fill('CLIENTE NUEVO SIN COINCIDENCIAS')
    await input.press('Tab')
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('customer-add-button')),true)
    await page.keyboard.press('Enter')
    await page.locator('.weekly-customer-data-note').filter({hasText:'CLI'}).waitFor()
    await snap('weekly-tab-cli')
    await page.locator('.weekly-task-modal').getByRole('button',{name:'Cancelar',exact:true}).click()
    await page.locator('.unsaved-service-modal').getByRole('button',{name:'Cancelar carga',exact:true}).click()
  })
  currentView='Historial'
  await step('cancelled-filter-consistency',async()=>{
    await page.getByPlaceholder('Buscar cliente, servicio o técnico...').fill('CANCELADO')
    assert.equal(await page.locator('.history-row').count(),2)
    await page.locator('.history-date-filters select').first().selectOption('Cancelado')
    assert.equal(await page.locator('.history-row').count(),2)
    await snap('cancelled-filter-consistency')
  })
  await step('history-draft-protection',async()=>{
    const openDetail=()=>page.locator('.history-row').filter({hasText:'EDIFICIO DE DEMOSTRACIÓN'}).getByRole('button',{name:'Gestionar'}).first().click()
    // The volume fixture opens on its first page; search brings this record into view.
    await page.getByPlaceholder('Buscar cliente, servicio o técnico...').fill('EDIFICIO DE DEMOSTRACIÓN')
    await openDetail();await page.locator('.history-detail').getByRole('button',{name:'Editar datos',exact:true}).click()
    const detail=page.locator('.history-detail textarea').first(),original=await detail.inputValue()
    await detail.fill('BORRADOR HISTORIAL CONSERVADO');await page.keyboard.press('Escape')
    await page.getByRole('alertdialog',{name:'Servicio sin guardar'}).waitFor()
    assert.equal(await detail.inputValue(),'BORRADOR HISTORIAL CONSERVADO')
    await snap('history-draft-protection')
    await page.locator('.catalog-discard-modal .confirm-actions').getByRole('button',{name:'Seguir editando',exact:true}).click()
    assert.equal(await detail.inputValue(),'BORRADOR HISTORIAL CONSERVADO')
    await page.locator('.history-detail').getByRole('button',{name:'Cancelar edición',exact:true}).click()
    await page.locator('.catalog-discard-modal').getByRole('button',{name:'Descartar cambios',exact:true}).click()
    await page.locator('.history-detail').getByRole('button',{name:'Editar datos',exact:true}).click()
    assert.equal(await detail.inputValue(),original,'Discard editing must also reset the form state')
    await detail.fill('NUEVO BORRADOR');await page.keyboard.press('Escape')
    await page.locator('.catalog-discard-modal').getByRole('button',{name:'Descartar cambios',exact:true}).click()
    await page.locator('.history-detail').waitFor({state:'detached'})
    await openDetail();await page.locator('.history-detail').getByRole('button',{name:'Editar datos',exact:true}).click()
    assert.equal(await detail.inputValue(),original)
    await page.keyboard.press('Escape');await page.locator('.history-detail').waitFor({state:'detached'})
  })
  await step('history-pagination-selection',async()=>{
    await page.getByPlaceholder('Buscar cliente, servicio o técnico...').fill('CLIENTE HISTÓRICO')
    await page.waitForFunction(()=>document.querySelectorAll('.history-row').length===50)
    await page.locator('.history-row').first().getByRole('checkbox').check()
    await page.locator('.history-pagination').getByRole('button',{name:'Siguiente',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.history-pagination')?.textContent.includes('Página 2 de 3')&&document.activeElement?.classList.contains('history-bulk'))
    const top=await page.locator('.history-bulk').evaluate(node=>node.getBoundingClientRect().top)
    assert.ok(top>=0&&top<160,`New history page should start in view, got y=${top}`)
    assert.match(await page.locator('.history-header-actions').innerText(),/1 seleccionado\(s\) entre páginas/)
    await page.getByRole('checkbox',{name:'Seleccionar esta página',exact:true}).check()
    assert.match(await page.locator('.history-header-actions').innerText(),/51 seleccionado\(s\)/)
    await page.locator('.history-pagination').getByRole('button',{name:'Anterior',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.history-pagination')?.textContent.includes('Página 1 de 3'))
    assert.equal(await page.locator('.history-row input:checked').count(),1)
    const all=page.getByRole('checkbox',{name:'Seleccionar esta página',exact:true})
    assert.equal(await all.evaluate(node=>node.indeterminate),true)
    await all.check();assert.match(await page.locator('.history-header-actions').innerText(),/100 seleccionado\(s\)/)
    await all.uncheck();assert.match(await page.locator('.history-header-actions').innerText(),/50 seleccionado\(s\)/)
    await page.locator('.history-pagination select').selectOption('100')
    await page.waitForFunction(()=>document.querySelectorAll('.history-row').length===100)
    assert.equal(await page.locator('.history-row input:checked').count(),50)
    await snap('history-pagination-selection')
    await page.getByRole('button',{name:'Quitar selección',exact:true}).click()
    assert.equal(await page.locator('.history-row input:checked').count(),0)
  })
  const failures=events.filter(event=>event.error)
  results.push({width,theme,events,errors,writes});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
  console.log(width,theme,failures.length?'FAIL':'PASS',failures.map(item=>({step:item.step,error:item.error})))
  assert.equal(failures.length,0)
  assert.deepEqual(errors,[])
  await context.close()
 }
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
