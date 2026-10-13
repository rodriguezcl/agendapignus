/* Visual smoke fixture: real module components, isolated synthetic records and
   fully intercepted networking. No production state or business data is used. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp/visual-qa/theme-review')
fs.mkdirSync(output, { recursive: true })
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')

const fixture = `
import { createRoot } from 'react-dom/client';
${cssImports}
const themeReviewUser = {id:'admin-review',name:'Administración Pignus',email:'administracion@example.test',role:'Administrador',roleCode:'administrator'};
const themeReviewRoles = [
  {id:'r-admin',code:'administrator',name:'Administrador',description:'Acceso completo a la plataforma'},
  {id:'r-user',code:'user',name:'Usuario',description:'Gestiona agenda, cuentas y técnicos'},
  {id:'r-tech',code:'technician',name:'Técnico',description:'Consulta su agenda asignada'},
  {id:'r-operator',code:'operator',name:'Operador',description:'Consulta de solo lectura'}
];
const themeReviewEmployees = [
  {id:'tech-1',firstName:'Mariano',lastName:'Ejemplo',name:'Mariano Ejemplo',email:'mariano@example.test',phone:'+54 351 555 0100',roleId:'r-tech',role:'Técnico',technicalEnabled:true,status:'Activo'},
  {id:'tech-2',firstName:'Rodrigo',lastName:'Ejemplo',name:'Rodrigo Ejemplo',email:'rodrigo@example.test',phone:'+54 351 555 0101',roleId:'r-tech',role:'Técnico',technicalEnabled:true,status:'Activo'},
  {id:'tech-3',firstName:'Pascual',lastName:'Ejemplo',name:'Pascual Ejemplo',email:'pascual@example.test',phone:'+54 351 555 0102',roleId:'r-user',role:'Usuario',technicalEnabled:true,status:'Activo'}
];
const themeReviewServices = [
  {id:'s-camera',name:'Servicio de cámaras',code:'camera-service',description:'Mantenimiento y diagnóstico de cámaras',status:'Activo',estimatedMinutes:90},
  {id:'s-alarm',name:'Instalación de alarma',code:'alarm-installation',description:'Instalación residencial con monitoreo',status:'Activo',estimatedMinutes:150},
  {id:'s-check',name:'Control semanal de vehículo',code:'vehicle-control',description:'Foto del interior y kilometraje actualizado',status:'Activo',estimatedMinutes:15}
];
const themeReviewCustomers = [
  {id:'c-1',customerId:'c-1',account:'PIG-7001',name:'CLIENTE DE DEMOSTRACIÓN',kind:'subscriber',street:'Av. Colón 1200',address:'Av. Colón 1200',phone:'+54 351 555 0200',email:'cliente@example.test',locality:'CÓRDOBA',neighborhood:'CENTRO',status:'Activo',monthlyFee:70000},
  {id:'c-2',customerId:'c-2',account:'CLI-0002',name:'EDIFICIO DE DEMOSTRACIÓN',kind:'client',street:'Dean Funes 350',address:'Dean Funes 350',phone:'+54 351 555 0201',locality:'CÓRDOBA',neighborhood:'ALBERDI',status:'Activo',cctvService:true}
];
const themeReviewVehicles = [
  {id:'v-1',brand:'Renault',model:'Kangoo',year:2022,mileage:77450,plate:'AB123CD',insuranceFileName:'seguro-ejemplo.pdf',insuranceExpiresOn:'2026-12-30'},
  {id:'v-2',brand:'Peugeot',model:'Partner',year:2024,mileage:28750,plate:'AC456EF',insuranceFileName:'seguro-ejemplo.pdf',insuranceExpiresOn:'2026-12-30'}
];
const themeReviewHistory = [
  {id:'h-done',date:'2026-10-13',time:'08:30',scheduledTime:'08:30',teamId:'team-1',teamName:'Equipo 1',customerId:'c-1',client:'PIG-7001 CLIENTE DE DEMOSTRACIÓN',address:'Av. Colón 1200',phone:'+54 351 555 0200',serviceId:'s-camera',service:'Servicio de cámaras',estimatedMinutes:90,detail:'Revisar la imagen de las cámaras y configurar el acceso remoto.',status:'Completado',technicalStatus:'Completado',technicalObservation:'Se verificó el funcionamiento del sistema.',technicalReportedAt:'2026-10-13T12:30:00Z',technicianIds:['tech-1','tech-2'],technicians:['Mariano Ejemplo','Rodrigo Ejemplo'],servicePreparation:{ready:true,byName:'Administración Pignus'}},
  {id:'h-pending',date:'2026-10-14',time:'08:30',scheduledTime:'08:30',teamId:'team-1',teamName:'Equipo 1',customerId:'c-1',client:'PIG-7001 CLIENTE DE DEMOSTRACIÓN',address:'Av. Colón 1200',phone:'+54 351 555 0200',serviceId:'s-alarm',service:'Instalación de alarma',installationZone:'residencial',monthlyFee:70000,frozenMonths:'No',estimatedMinutes:150,detail:'Instalar central, dos sensores y verificar conexión con monitoreo.',status:'Pendiente',technicianIds:['tech-1','tech-2'],technicians:['Mariano Ejemplo','Rodrigo Ejemplo']},
  {id:'h-afternoon',date:'2026-10-14',time:'14:00',scheduledTime:'14:00',teamId:'team-1',teamName:'Equipo 1',customerId:'c-2',client:'CLI-0002 EDIFICIO DE DEMOSTRACIÓN',address:'Dean Funes 350',phone:'+54 351 555 0201',serviceId:'s-camera',service:'Servicio de cámaras',estimatedMinutes:90,detail:'Mantenimiento preventivo del grabador.',status:'Pendiente',technicianIds:['tech-1','tech-2'],technicians:['Mariano Ejemplo','Rodrigo Ejemplo']},
  ...['2026-09-25','2026-10-02','2026-10-09'].map((date,index)=>({id:'h-vehicle-'+index,date,time:'15:45',scheduledTime:'15:45',teamId:'team-2',teamName:'Equipo 2',client:'Renault Kangoo · AB123CD',serviceId:'s-check',service:'Control semanal de vehículo',vehicleControl:true,vehicleId:'v-1',vehicleMileage:77000+index*200,estimatedMinutes:15,status:'Completado',technicianIds:['tech-3'],technicians:['Pascual Ejemplo']}))
];
const themeReviewTeams = [{id:'team-1',teamId:'team-1',label:'Equipo 1',name:'Equipo 1',memberIds:['tech-1','tech-2'],members:['Mariano Ejemplo','Rodrigo Ejemplo'],tasks:[]},{id:'team-2',teamId:'team-2',label:'Equipo 2',name:'Equipo 2',memberIds:['tech-3'],members:['Pascual Ejemplo'],tasks:[]}];
const themeReviewWeekly = {_monthlyTeams:{'2026-10':{teams:themeReviewTeams,confirmed:true,vehicleAssignments:[{vehicleId:'v-1',technicianId:'tech-1'},{vehicleId:'v-2',technicianId:'tech-2'}]}},_frozenMonthOptions:[4,6]};
for(const day of ['2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17']) themeReviewWeekly[day] = {teams:themeReviewTeams.map(team=>({...team,tasks:themeReviewHistory.filter(record=>record.date===day && record.teamId===team.id).map(record=>({...record,id:'task-'+record.id,historyId:record.id}))}))};
const themeReviewNavigation = [['dashboard','dashboard','Menú principal'],['weekly','calendar','Agenda semanal'],['history','history','Historial'],['accounts','accounts','Abonados y clientes'],['employees','users','Empleados'],['services','tools','Tipo de servicio'],['vehicles','car','Vehículos'],['settings','settings','Configuración'],['audit','audit','Auditoría'],['help','help','Centro de ayuda']];
function ThemeReviewFixture() {
 const [view,setView]=useState(window.__themeReviewView||'dashboard');
 const [theme,setTheme]=useState(window.__themeReviewTheme||'light');
 const [menuOpen,setMenuOpen]=useState(false);
 const [confirmation,setConfirmation]=useState(null);
 const [notice,setNotice]=useState('');
 const [history,setHistory]=useState(themeReviewHistory);
 const [customers,setCustomers]=useState(themeReviewCustomers);
 const [employees,setEmployees]=useState(themeReviewEmployees);
 const [services,setServices]=useState(themeReviewServices);
 const [vehicles,setVehicles]=useState(themeReviewVehicles);
 const [roles,setRoles]=useState(themeReviewRoles);
 const [weekly,setWeekly]=useState(themeReviewWeekly);
 const noSave=()=>Promise.reject(new Error('La revisión visual no guarda cambios.'));
 const ask=(title,detail,action,danger)=>setConfirmation({title,detail,action:()=>{},danger});
 globalThis.__pignusCurrentUser=themeReviewUser; globalThis.__pignusHistory=history; globalThis.__pignusVehicles=vehicles;
 if(view==='technician') {const technician={...themeReviewEmployees[0],roleCode:'technician'};globalThis.__pignusCurrentUser=technician;return <TechnicianPortal user={technician} history={history} setHistory={setHistory} vehicles={vehicles} setVehicles={setVehicles} logout={()=>{}} sessionInvalidated={()=>{}}/>;}
 if(view==='login') return <Login onLogin={noSave}/>;
 if(view==='help') return <HelpShell user={themeReviewUser} onNavigate={setView} logout={()=>{}} theme={theme} setTheme={setTheme} isAdministrator navigation={themeReviewNavigation}/>;
 const shared={history,setHistory,customers,setCustomers,employees,setEmployees,services,setServices,vehicles,setVehicles,roles,setRoles,weekly,setWeekly,setNotice,ask,authUser:themeReviewUser};
 const views={
  dashboard:<Dashboard {...shared}/>,
  weekly:<WeeklyPlanner {...shared} activeTechs={employees} permissions={{weekly:true}} persistWeeklyService={noSave} persistWeeklyConfiguration={noSave} openDaily={()=>{}}/>,
  history:<History {...shared} canManage persistHistoryRecord={noSave} persistHistoryRecordRemoval={noSave}/>,
  accounts:<Accounts {...shared} teams={themeReviewTeams} isAdministrator stateRevision={1} persistSubscriptionCorrection={noSave}/>,
  employees:<Employees {...shared} teams={themeReviewTeams} persistEmployee={noSave} employeeBaseline={id=>employees.find(e=>e.id===id)} canEnableTechnical/>,
  services:<ServiceTypes {...shared} stateRevision={1}/>,
  vehicles:<Vehicles {...shared} isAdministrator stateRevision={1}/>,
  settings:<><FrozenMonthsSettings options={[4,6]} onSave={noSave}/><Settings {...shared} canConfigureWorkday persistWeeklyConfiguration={noSave}/></>,
  audit:<AuditPage user={themeReviewUser} onBack={()=>setView('dashboard')} onOpenMenu={()=>setMenuOpen(true)} logout={()=>{}}/>
 };
 return <div className="app-shell" data-theme={theme}><aside className={'sidebar '+(menuOpen?'open':'')}><div className="brand"/><p className="nav-label">MÓDULOS</p><nav>{themeReviewNavigation.map(([id,icon,label])=><button key={id} className={view===id?'active':''} onClick={()=>{setView(id);setMenuOpen(false)}}><Icon name={icon}/>{label}</button>)}</nav><div className="sidebar-bottom">v1.1 · Agenda técnica</div></aside>{menuOpen&&<button className="backdrop" aria-label="Cerrar menú" onClick={()=>setMenuOpen(false)}/>}<main><header className="topbar"><button className="mobile-menu" aria-label="Abrir menú" onClick={()=>setMenuOpen(true)}><Icon name="menu"/></button><div className="page-heading"><b>{themeReviewNavigation.find(([id])=>id===view)?.[2]}</b></div><div className="profile"><button className="theme-toggle" aria-label="Cambiar tema" onClick={()=>setTheme(theme==='light'?'dark':'light')}><Icon name={theme==='light'?'moon':'sun'}/></button><div className="profile-menu"><button className="profile-trigger"><span className="profile-avatar">AP</span><span>Administración Pignus</span></button></div><RefreshButton/><button className="logout-button" onClick={()=>ask('Cerrar sesión','¿Querés cerrar tu sesión?')}><Icon name="logout"/><span>Cerrar sesión</span></button></div></header><section className="content">{notice&&<div className="notice">{notice}</div>}{views[view]}</section></main>{confirmation&&<Confirm {...confirmation} close={()=>setConfirmation(null)}/>}</div>
}
createRoot(document.getElementById('root')).render(<ThemeReviewFixture/>);
`

// Preserve main.jsx's first import before the App component's CSS dependencies;
// reversing this order would let legacy table grids override history-layout.css.
const built = buildSync({ stdin: { contents: "import './style.css';\n" + source + '\n' + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css' }, logLevel: 'silent' })
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text
const auditRecord = { id: 'audit-review', at: '2026-10-13T12:00:00Z', action: 'Modificó servicio', entity: 'Servicio', entityId: 'h-pending', user: { name: 'Administración Pignus', email: 'administracion@example.test' }, before: { time: '08:30', status: 'Pendiente' }, after: { time: '09:00', status: 'Pendiente' } }
const failures = []
const results = []
const views = (process.env.THEME_VIEWS || 'dashboard,weekly,history,accounts,employees,services,vehicles,settings,audit,help,login,technician').split(',')
const themes = (process.env.THEME_MODES || 'light,dark').split(',')
const widths = (process.env.THEME_WIDTHS || '1440,768,390').split(',').map(Number)

async function inspect(page, label, theme) {
 const metrics = await page.evaluate(() => {
  const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const surfaces = [...document.querySelectorAll('.topbar,.data-card,.audit-table,.audit-row,.audit-table-head,.stats-grid article,.week-task-summary,.modal,.weekly-task-form,.customer-form,.employee-form,.vehicle-form,.role-editor,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),select,textarea')].filter(visible).map(el=>({selector:el.className||el.tagName,color:getComputedStyle(el).backgroundColor}));
  const controls = [...document.querySelectorAll('.topbar .theme-toggle,.weekly-service-search input,.weekly-actions button,.week-selector input')].filter(visible).map(el=>({selector:el.className||el.tagName,height:el.getBoundingClientRect().height}));
  return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,surfaces,controls};
 });
 assert(metrics.scrollWidth <= metrics.width + 2, `${label}: viewport overflows ${metrics.scrollWidth}/${metrics.width}`)
 for (const control of metrics.controls) assert(control.height >= 40 && control.height <= 60, `${label}: unusual control height ${control.selector} ${control.height}`)
 if(theme==='dark') for (const surface of metrics.surfaces) {
  const channels=surface.color.match(/[\d.]+/g)?.map(Number)||[];
  if(channels.length===4&&channels[3]===0)continue;
  const rgb=channels.slice(0,3);
  assert(Math.max(...rgb)<95&&Math.max(...rgb)-Math.min(...rgb)<12,`${label}: non-neutral surface ${surface.selector}: ${surface.color}`);
 }
 await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});
 results.push({label,controls:metrics.controls.length,surfaces:metrics.surfaces.length});
}

async function openAndCapture(page, label, theme, trigger, ready, closeAfter = true) {
 await trigger.click();
 await page.locator(ready).first().waitFor({timeout:5000});
 await inspect(page,label,theme);
 if(!closeAfter)return;
 const close=page.locator('.modal .close-modal,.modal .modal-close,.modal [aria-label="Cerrar edición"]').first();
 if(await close.count())await close.click();
 else {const cancel=page.locator('.modal').getByRole('button',{name:/^(Cancelar|Cerrar)$/}).first();if(await cancel.count())await cancel.click();}
}

;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  for(const theme of themes)for(const width of widths)for(const view of views){
   // Login and the technician portal have no theme toggle or data-theme root; their fixed
   // appearance is validated once per width, not presented as a night view.
   if(['login','technician'].includes(view)&&theme==='dark')continue;
   const label=theme+'-'+view+'-'+width;
   const page=await browser.newPage({viewport:{width,height:960},timezoneId:'America/Argentina/Buenos_Aires'});
   page.setDefaultTimeout(10000);
   const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.clock.install({time:new Date('2026-10-13T12:00:00-03:00')});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/logo-pignus.png')return route.fulfill({body:fs.readFileSync(path.join(root,'public/logo-pignus.png')),contentType:'image/png'});
    if(url.pathname==='/review')return route.fulfill({body:'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',contentType:'text/html'});
    if(url.pathname.startsWith('/api/')) {
     if(route.request().method()!=='GET'){errors.push('Unexpected mutating request '+route.request().method()+' '+url.pathname);return route.fulfill({status:403,json:{error:'Visual review is read-only'}})}
     let payload={};
     if(url.pathname==='/api/weather')payload={location:'Córdoba capital',days:['2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17'].map((date,i)=>({date,min:12+i,max:20+i,kind:i%2?'partly':'rain',label:i%2?'Parcialmente nublado':'Lluvias'}))};
     else if(url.pathname==='/api/holidays')payload={holidays:[]};
     else if(url.pathname==='/api/audit')payload={records:[auditRecord]};
     else if(url.pathname.startsWith('/api/audit/'))payload={record:auditRecord};
     else if(url.pathname.includes('attachment'))payload={attachments:[]};
     else if(url.pathname.includes('password'))payload={requests:[]};
     else if(url.pathname.includes('advance'))payload={requests:[]};
     return route.fulfill({json:payload});
    }
    if(url.hostname==='fonts.googleapis.com')return route.fulfill({body:'',contentType:'text/css'});
    return route.abort();
   });
   try {
    await page.goto('http://theme-review.test/review');
    await page.evaluate(({view,theme})=>{window.__themeReviewView=view;window.__themeReviewTheme=theme},{view,theme});
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:js});
    await page.locator(view==='login'?'.login-card':view==='technician'?'.technician-content':'.app-shell .content').waitFor({timeout:10000});
    if(view==='audit')await page.locator('.audit-row').waitFor();
    if(view==='weekly')await page.locator('.weekly-day-preview-trigger').first().waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await inspect(page,label,theme);
    if(width===390&&view==='dashboard'){
     await page.locator('.mobile-menu').first().click();
     await page.locator('.sidebar.open').waitFor();
     await inspect(page,label+'-navigation',theme);
     await page.getByRole('button',{name:'Cerrar menú',exact:true}).click({position:{x:width-8,y:30}});
    }
    if(view==='weekly'){
     await openAndCapture(page,label+'-preview',theme,page.locator('.weekly-day-preview-trigger').first(),'.modal');
     await openAndCapture(page,label+'-monthly',theme,page.getByRole('button',{name:'Equipos del mes',exact:true}),'.monthly-teams-modal');
     await openAndCapture(page,label+'-service',theme,page.locator('.week-day').nth(1).getByRole('button',{name:'Agregar servicio',exact:true}).first(),'.weekly-task-form',false);
     if(await page.locator('.service-types-trigger').count()){
      await page.locator('.service-types-trigger').first().click();
      await page.locator('.service-types-options').waitFor();
      await inspect(page,label+'-service-options',theme);
     }
    }
    if(view==='employees')await openAndCapture(page,label+'-editor',theme,page.getByRole('button',{name:'Nuevo empleado',exact:true}),'.employee-form');
    if(view==='vehicles'){
     await openAndCapture(page,label+'-editor',theme,page.locator('.vehicle-row .row-actions button').first(),'.vehicle-form');
     await openAndCapture(page,label+'-photos',theme,page.getByRole('button',{name:'Historial de fotos',exact:true}).first(),'.vehicle-photo-history');
    }
    if(view==='accounts')await openAndCapture(page,label+'-editor',theme,page.locator('.account-row .row-actions button[title="Abrí el formulario para modificar los datos de este abonado o cliente."]').first(),'.customer-form');
    if(view==='history')await openAndCapture(page,label+'-detail',theme,page.getByRole('button',{name:'Gestionar',exact:true}).first(),'.modal');
    if(view==='services')await openAndCapture(page,label+'-editor',theme,page.locator('.service-row .row-actions button').first(),'.service-form');
    if(view==='audit')await openAndCapture(page,label+'-detail',theme,page.getByRole('button',{name:'Ver detalle',exact:true}).first(),'.audit-modal');
    if(view==='settings'){
     await page.getByRole('button',{name:'Nuevo rol',exact:true}).click();
     await page.locator('.role-editor').waitFor();
     await inspect(page,label+'-role-editor',theme);
    }
    if(view==='technician')for(const section of ['history','vehicles','help']){
     if(width===390)await page.getByRole('button',{name:'Abrir menú',exact:true}).click();
     await page.locator('.technician-sidebar [data-view="'+section+'"]').click();
     await page.locator('.technician-content').waitFor();
     await inspect(page,label+'-'+section,theme);
    }
    assert.equal(errors.length,0,`${label}: ${errors.join('; ')}`);
    console.log('PASS '+label);
   }catch(error){failures.push({label,error:error.message,pageErrors:errors});await page.screenshot({path:path.join(output,label+'-failure.png'),fullPage:true}).catch(()=>{});console.error('FAIL '+label+': '+error.message)}
   finally{await page.close()}
  }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,failures},null,2));
 console.log(`${results.length} rendered checks, ${failures.length} failed view cases. Screenshots: ${output}`);
 if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
