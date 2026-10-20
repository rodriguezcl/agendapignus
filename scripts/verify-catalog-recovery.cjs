/* Real App regression flows with synthetic records; every request is intercepted. */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const repo = path.resolve(__dirname, '..')
const base = fs.readFileSync(path.join(__dirname, 'verify-admin-chrome.cjs'), 'utf8')
const setup = base.slice(0, base.indexOf(';(async () => {'))
  .replace("'tmp/visual-qa/admin-chrome'", "'tmp/visual-qa/catalog-recovery'")
  .replace("import { createRoot } from 'react-dom/client';", "import { createRoot } from 'react-dom/client'; import {installRequiredFeedback} from './presentation/components/forms/required-feedback.mjs'; installRequiredFeedback();")
  .replace('window.__themeSeed =', "themeReviewHistory.filter(record => record.vehicleControl).forEach(record => {record.vehiclePhotoUrl='/api/test-control-photo'}); window.__themeSeed =")
const runner = String.raw`
const passed=[];
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGxNJkAAAAASUVORK5CYII=','base64');
async function discardCheck(page, selector, field, value) {
 const editor=page.locator(selector);await editor.waitFor();
 const input=editor.getByLabel(field,{exact:false});const before=await input.inputValue();
 await input.fill(value);await page.keyboard.press('Escape');
 await page.locator('.catalog-discard-modal').waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.catalog-discard-modal').count(),0);
 assert.equal(await input.inputValue(),value,'Escape on discard prompt must keep the draft');
 const backdrop=page.locator('.catalog-editor-layer,.customer-editor-layer').first();
 await backdrop.click({position:{x:2,y:2}});
 assert.equal(await page.locator('.catalog-discard-modal').count(),1,'Backdrop must open exactly one guard');
 await page.locator('.catalog-discard-modal').getByRole('button',{name:'Seguir editando',exact:true}).last().click();
 assert.equal(await input.inputValue(),value);
 await input.fill(before);await page.keyboard.press('Escape');
 assert.equal(await editor.count(),0,'Reverted form closes without a discard confirmation');
 assert.equal(await page.locator('.catalog-discard-modal').count(),0);
}
async function discardViaCancel(page, selector, field) {
 const editor=page.locator(selector);await editor.getByLabel(field,{exact:false}).fill('BORRADOR');
 await editor.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.locator('.catalog-discard-modal').getByRole('button',{name:'Descartar cambios',exact:true}).click();
 assert.equal(await editor.count(),0);
}
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  for(const width of (process.env.CATALOG_WIDTHS||'1440,390').split(',').map(Number)) for(const theme of (process.env.CATALOG_THEMES||'light,dark').split(',')) {
   const context=await browser.newContext({viewport:{width,height:960},timezoneId:'America/Argentina/Buenos_Aires',reducedMotion:'reduce',acceptDownloads:true});
   const page=await context.newPage();page.setDefaultTimeout(10000);
   const errors=[],writes=[];let photoRequests=0,insuranceRequests=0,documentRequests=0,pauseVehicleSave=false,releaseVehicleSave;page.on('pageerror',error=>errors.push(error.message));
   await page.clock.install({time:new Date('2026-10-13T12:00:00-03:00')});
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname!=='admin-chrome.test')return route.abort();
    if(url.pathname==='/review'){documentRequests++;return route.fulfill({contentType:'text/html',body:html});}
    if(url.pathname==='/review.css')return route.fulfill({contentType:'text/css',body:css});
    if(url.pathname==='/review.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(url.pathname==='/logo-pignus.png')return route.fulfill({contentType:'image/png',body:pixel});
    if(url.pathname==='/api/test-control-photo') {photoRequests++;return photoRequests===1?route.fulfill({status:404,body:'missing'}):route.fulfill({contentType:'image/png',body:pixel});}
    if(url.pathname.startsWith('/api/vehicle-insurance/')) {insuranceRequests++;return insuranceRequests===1?route.fulfill({status:404,json:{error:'El seguro no está cargado.'}}):route.fulfill({contentType:'application/pdf',body:'%PDF-1.7\nsynthetic download'});}
    if(url.pathname.startsWith('/api/attachments/service/'))return url.pathname.endsWith('/photo-other')?route.fulfill({contentType:'image/png',body:pixel}):route.fulfill({json:{attachments:[{id:'photo-other',mime:'image/png',name:'Foto adicional'}]}});
    if(url.pathname.startsWith('/api/')) {
     if(url.pathname==='/api/auth/activity')return route.fulfill({json:{ok:true}});
     const seed=await page.evaluate(()=>({user:window.__themeUser,state:window.__themeSeed}));
     if(request.method()!=='GET') {
      writes.push({method:request.method(),path:url.pathname});
      if(url.pathname==='/api/state') {
       const data=request.postDataJSON();
       await page.evaluate(({operations=[]})=>{for(const operation of operations){if(operation.path.length!==2||typeof operation.path[1]!=='object')continue;const [name,identity]=operation.path;const list=window.__themeSeed[name]||[];const index=list.findIndex(item=>String(item[identity.key])===String(identity.id));if(operation.exists){if(index<0)list.push(operation.after);else list[index]=operation.after;}else if(index>=0)list.splice(index,1);window.__themeSeed[name]=list;}window.__themeSeed.revision++;},data);
       return route.fulfill({json:{state:await page.evaluate(()=>window.__themeSeed),revision:seed.state.revision+1}});
      }
      if(url.pathname.startsWith('/api/vehicles')) {
       if(pauseVehicleSave)await new Promise(resolve=>{releaseVehicleSave=resolve});
       const data=request.postDataJSON();await page.evaluate(({vehicle})=>{const list=window.__themeSeed.vehicles;const index=list.findIndex(item=>item.id===vehicle.id);if(index>=0)list[index]=vehicle;else list.push(vehicle);window.__themeSeed.revision++;},data);
       return route.fulfill({json:{vehicles:await page.evaluate(()=>window.__themeSeed.vehicles)}});
      }
      return route.fulfill({status:403,json:{error:'Unexpected fixture write'}});
     }
     if(url.pathname==='/api/auth/session')return route.fulfill({json:seed});
     if(url.pathname==='/api/state')return route.fulfill({json:seed.state});
     if(url.pathname.includes('revision'))return route.fulfill({json:{revision:seed.state.revision}});
     if(url.pathname.includes('weather'))return route.fulfill({json:{days:[]}});
     return route.fulfill({json:{requests:[],holidays:[],attachments:[]}});
    }
    return route.abort();
   });
   await page.goto('http://admin-chrome.test/review');await ready(page);if(theme==='dark')await page.locator('.theme-toggle').click();
   const prefix=theme+'-'+width;
   await navigate(page,'Abonados y clientes',width);
   await page.getByRole('button',{name:'Nuevo cliente',exact:true}).click();await discardCheck(page,'.customer-form','Nombre','CLIENTE SIN GUARDAR');
   await page.getByRole('button',{name:'Nuevo cliente',exact:true}).click();await discardViaCancel(page,'.customer-form','Nombre');
   await page.getByRole('button',{name:'Nuevo cliente',exact:true}).click();
   await page.locator('.customer-form').getByLabel('Nombre',{exact:false}).fill('CLIENTE GUARDADO');await page.locator('.customer-form').getByLabel('Calle / dirección',{exact:false}).fill('Calle prueba 123');await page.locator('.customer-form').getByLabel('Teléfono / contacto',{exact:false}).fill('3515550000');
   await page.locator('.customer-form').getByRole('button',{name:'Guardar cliente',exact:true}).click();await page.locator('.confirm-modal').last().getByRole('button',{name:'Confirmar cambios',exact:true}).click();
   assert.equal(await page.locator('.customer-form').count(),0,'Successful customer save must not prompt discard');
   assert.equal(await page.locator('.catalog-discard-modal').count(),0);
   await navigate(page,'Colaboradores',width);
   await page.getByRole('button',{name:'Nuevo colaborador',exact:true}).click();await discardCheck(page,'.employee-form','Nombre','Empleado sin guardar');
   await page.getByRole('button',{name:'Nuevo colaborador',exact:true}).click();await discardViaCancel(page,'.employee-form','Nombre');
   await page.locator('.employee-row .row-actions button').first().click();
   await page.locator('.employee-form').getByLabel('Teléfono',{exact:false}).fill('3515559999');await page.locator('.employee-form').getByRole('button',{name:'Guardar cambios',exact:true}).click();
   await page.locator('.confirm-modal').last().getByRole('button',{name:'Confirmar cambios',exact:true}).click();await page.locator('.employee-form').waitFor({state:'detached'});assert.equal(await page.locator('.catalog-discard-modal').count(),0);
   await navigate(page,'Flota',width);
   await page.locator('.vehicle-row .row-actions button').first().click();await discardCheck(page,'.vehicle-form','Modelo','Modelo sin guardar');
   await page.locator('.vehicle-row .row-actions button').first().click();await discardViaCancel(page,'.vehicle-form','Modelo');
   await page.locator('.vehicle-row .row-actions button').first().click();await page.locator('.vehicle-form').getByLabel('Modelo',{exact:false}).fill('Modelo guardado');await page.locator('.vehicle-form').getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.locator('.vehicle-form').waitFor({state:'detached'});assert.equal(await page.locator('.catalog-discard-modal').count(),0);
   await page.getByRole('button',{name:'Nuevo vehículo',exact:true}).click();await page.locator('.vehicle-form').getByLabel('Marca',{exact:false}).fill('Borrador de alta');
   assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),true,'Dirty inline form must protect reload');
   if(width<=640)await page.locator('.sidebar-toggle').click();
   await page.locator('.sidebar nav').getByRole('button',{name:'Colaboradores',exact:true}).click();await page.locator('.catalog-discard-modal').waitFor();
   assert.equal(await page.locator('.sidebar nav [aria-current="page"]').getAttribute('aria-label'),'Flota','Navigation must wait for discard choice');
   assert.equal(await page.locator('.catalog-discard-modal').evaluate(el=>Boolean(el.closest('[inert]'))),false,'Navigation guard must not be behind an inert mobile drawer');
   if(width<=640)assert.equal(await page.locator('.sidebar').evaluate(el=>el.classList.contains('open')),false,'Drawer closes before asking about the draft');
   await page.screenshot({path:path.join(output,prefix+'-navigation-draft.png'),fullPage:true});
   await page.locator('.catalog-discard-modal').getByRole('button',{name:'Seguir editando',exact:true}).last().click();assert.equal(await page.locator('.vehicle-form').getByLabel('Marca',{exact:false}).inputValue(),'Borrador de alta');
   if(width<=640)await page.locator('.sidebar-toggle').click();
   await page.locator('.sidebar nav').getByRole('button',{name:'Colaboradores',exact:true}).click();await page.locator('.catalog-discard-modal').getByRole('button',{name:'Descartar cambios',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.sidebar nav [aria-current="page"]')?.getAttribute('aria-label')==='Colaboradores');assert.equal(await page.locator('.vehicle-form').count(),0);
   await navigate(page,'Flota',width);await page.getByRole('button',{name:'Nuevo vehículo',exact:true}).click();await navigate(page,'Colaboradores',width);assert.equal(await page.locator('.catalog-discard-modal').count(),0,'Unchanged inline form may navigate without a prompt');await navigate(page,'Flota',width);
   if(width===390&&theme==='dark') {
    await page.getByRole('button',{name:'Nuevo vehículo',exact:true}).click();
    const vehicleForm=page.locator('.vehicle-form');
    for(const [label,value]of[['Marca','Marca de prueba'],['Modelo','Modelo de prueba'],['Año','2024'],['Kilometraje','1000'],['Matrícula','SYN123']])await vehicleForm.getByLabel(label,{exact:false}).fill(value);
    pauseVehicleSave=true;await vehicleForm.getByRole('button',{name:'Guardar vehículo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.vehicle-form')?.getAttribute('aria-busy')==='true');
    const dialogPromise=page.waitForEvent('dialog');const refreshClick=page.locator('.topbar .refresh-button').click();
    const refreshDialog=await dialogPromise;assert.equal(refreshDialog.type(),'alert');assert.match(refreshDialog.message(),/guardado en curso/);await refreshDialog.dismiss();await refreshClick;
    assert.equal(documentRequests,1,'Refresh must not reload while vehicle save is pending');assert.equal(await page.locator('.catalog-discard-modal').count(),0,'Busy refresh must not offer discard');assert.equal(await vehicleForm.count(),1);
    await page.screenshot({path:path.join(output,prefix+'-refresh-busy.png'),fullPage:true});
    assert.equal(typeof releaseVehicleSave,'function','Save request must still be awaiting fixture response');pauseVehicleSave=false;releaseVehicleSave();
    await vehicleForm.waitFor({state:'detached'});assert.equal(await page.locator('.catalog-discard-modal').count(),0);
   }
   await page.locator('.vehicle-insurance-download').first().click();await page.getByRole('alert').filter({hasText:'El seguro no está cargado.'}).waitFor();assert.equal(page.url(),'http://admin-chrome.test/review');
   await page.screenshot({path:path.join(output,prefix+'-download-error.png'),fullPage:true});
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'Reintentar descarga',exact:true}).click();await download;assert.equal(await page.locator('.vehicle-download-error').count(),0);
   await page.locator('.vehicle-row').filter({hasText:'AB123CD'}).getByRole('button',{name:'Historial de fotos',exact:true}).click();
   await page.locator('.vehicle-photo-history summary').first().click();await page.locator('.vehicle-control-photo-error').waitFor();assert.equal(await page.locator('.vehicle-control-thumbnails img[alt="Foto adicional"]').count(),1);
   await page.screenshot({path:path.join(output,prefix+'-photo-error.png'),fullPage:true});
   await page.getByRole('button',{name:'Reintentar foto',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.vehicle-control-thumbnails img')].some(img=>img.alt==='Foto del control'&&img.complete&&img.naturalWidth>0));
   await page.locator('.vehicle-control-thumbnails > button').filter({has:page.locator('img[alt="Foto del control"]')}).click();assert.equal(await page.locator('.vehicle-control-thumbnails > button.expanded').count(),1);await page.keyboard.press('Escape');
   await navigate(page,'Configuración',width);await page.getByRole('button',{name:'Nuevo rol',exact:true}).click();
   const name=page.locator('.role-editor').getByLabel('Nombre del rol',{exact:false});await page.waitForFunction(()=>document.activeElement===document.querySelector('.role-editor input'));
   const box=await name.boundingBox();assert(box.y>=0&&box.y+box.height<=960,'Role name must be in viewport when editor opens');
   await page.locator('.role-editor').getByRole('button',{name:'Guardar rol',exact:true}).click();assert.equal(await page.locator('.confirm-modal').count(),0);assert.equal(await name.evaluate(el=>el.validity.valueMissing),true);
   await name.fill('   ');await page.locator('.role-editor').getByRole('button',{name:'Guardar rol',exact:true}).click();await page.getByRole('alert').filter({hasText:'Ingresá un nombre para el rol.'}).waitFor();assert.equal(await page.locator('.confirm-modal').count(),0);
   await name.fill('  Rol de prueba  ');await page.locator('.role-editor').getByRole('button',{name:'Guardar rol',exact:true}).click();assert.match(await page.locator('.confirm-modal').innerText(),/rol Rol de prueba\?/);await page.keyboard.press('Escape');
   await page.screenshot({path:path.join(output,prefix+'-role-editor.png'),fullPage:true});
   assert.deepEqual(errors,[]);passed.push({width,theme,writes,photoRequests,insuranceRequests});await context.close();
  }
  const resultFile=process.env.CATALOG_WIDTHS||process.env.CATALOG_THEMES?'busy-results.json':'results.json';
  fs.writeFileSync(path.join(output,resultFile),JSON.stringify(passed,null,2));console.log(JSON.stringify({passed:passed.length,checks:'Draft retention/discard/revert/successful saves/navigation/reload; refresh blocked during pending vehicle save (dark 390); role validation/focus; individual photo retry; PDF error and successful retry; no uncaught JS errors',output,resultFile}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
`
const virtual = path.join(__dirname, 'catalog-recovery.virtual.cjs')
const compiled = new Module(virtual, module)
compiled.filename = virtual
compiled.paths = module.paths
compiled._compile(setup + runner, virtual)
