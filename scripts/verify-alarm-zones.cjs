// Isolated browser verification. Synthetic records only; all requests intercepted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const out=path.resolve('tmp/visual-qa/alarm-zones');fs.mkdirSync(out,{recursive:true})
const appStyles=[...fs.readFileSync('src/App.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';`).join('\n')
const styles=[...fs.readFileSync('src/main.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';${m[1]==='./style.css'?'\n'+appStyles:''}`).join('\n')
buildSync({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
import React from 'react';import{createRoot}from'react-dom/client';
import TechnicianReportModal from './src/components/TechnicianReportModal.jsx';
import AlarmZonesSection from './src/components/AlarmZonesSection.jsx';
import {PermissionsProvider}from './src/presentation/contexts/permissions-context.jsx';
${styles}
const params=new URLSearchParams(location.search),mode=params.get('mode');document.body.classList.toggle('dark',params.get('theme')==='dark');
const record={id:'qa',client:'PIG-7001 CLIENTE DE PRUEBA',service:mode==='regular'?'Service de cámaras':'Instalación de alarma',customerId:'c'};
window.__pignusRefreshRemoteState=async()=>{};
createRoot(document.getElementById('root')).render(<PermissionsProvider user={{id:'admin',roleCode:'administrator'}}>{mode==='account'?<div className="modal-layer"><section className="modal customer-detail-modal"><h2>PIG-7001 · Cliente de prueba</h2><AlarmZonesSection customerId="c"/></section></div>:<TechnicianReportModal record={record} type={mode==='advance'?'Avance registrado':'Completado'} serviceLabel={record.service} onPendingAttachmentsChange={()=>{}} onPreparingChange={()=>{}} onClose={()=>{}} onSubmit={async value=>{window.__submitted=value}}/>}</PermissionsProvider>);
`},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',external:['/pignus-owl-white.svg','/logo-pignus.png'],loader:{'.png':'dataurl','.svg':'dataurl','.woff2':'dataurl'},logLevel:'silent'})
const sample={recordId:'qa',client:'PIG-7001 CLIENTE DE PRUEBA',date:'2026-10-26',report:{version:1,complete:true,reportedAt:'2026-10-26T16:00:00Z',reportedByName:'Técnico de prueba',zones:[{number:1,name:'Puerta principal',attribute:'Demorada',sensor:'Magnético cableado',sensorOther:''}]}}
;(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
for(const [width,theme,mode] of [[390,'light','single'],[390,'light','form'],[360,'dark','form'],[1280,'light','form'],[390,'light','advance'],[390,'light','regular'],[390,'light','account']]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/fixture.js'||u.pathname==='/fixture.css')return route.fulfill({path:path.join(out,u.pathname.slice(1)),contentType:u.pathname.endsWith('css')?'text/css':'application/javascript'});
  if(u.pathname==='/api/customers/alarm-zones')return route.fulfill({json:route.request().method()==='POST'?{report:{...sample,report:{...sample.report,softguard:{completedAt:'2026-10-26T17:00:00Z',completedByName:'Administración'}}}}:{reports:[sample]}});
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],attachments:[]}});
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
  return route.fulfill({body:''});
 });
 await page.goto('https://alarm-zones.test/?'+new URLSearchParams({theme,mode}));await page.locator('.modal').first().waitFor();
 if(mode==='account'){
   await page.getByText('Puerta principal',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Confirmar zonas cargadas'}).isDisabled());await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirmar zonas cargadas'}).click();await page.getByText(/Carga en SoftGuard confirmada por/).waitFor();
 }else{
  await page.locator('.technician-status-modal textarea').first().fill('Se probó el sistema y quedó funcionando.');
  if(mode==='regular'){assert.equal(await page.locator('.alarm-zone-card').count(),0);}
  else{
   assert.equal(await page.locator('.alarm-zone-card').count(),3);assert.equal(await page.locator('#zone-1-name').inputValue(),'');
   if(mode!=='advance')assert(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled());
   else assert(!(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled()));
   await page.locator('.alarm-zones-editor').evaluate(el=>el.scrollIntoView({block:'start'}));
   await page.screenshot({path:path.join(out,`initial-${width}-${theme}-${mode}.png`),fullPage:true});
   assert.equal(await page.locator('.alarm-zone-card').first().getByRole('button',{name:'Quitar'}).count(),0);
   if(mode==='single'){
     await page.locator('#zone-1-name').fill('Puerta principal');
     await page.getByRole('combobox',{name:'Atributo de zona 1',exact:true}).selectOption('Demorada');
     await page.getByRole('combobox',{name:'Sensor de zona 1',exact:true}).selectOption('Magnético cableado');
     assert(!(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled()));
     assert.equal(await page.locator('#zone-2-name').getAttribute('required'),null);
     await page.locator('#zone-2-name').fill('Patio');
     assert(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled());
     await page.locator('#zone-2-name').fill('');
   }else{
   await page.locator('.alarm-zone-card').nth(1).getByRole('button',{name:'Quitar'}).click();
   assert.deepEqual(await page.locator('.alarm-zone-card legend').allTextContents(),['Zona 01','Zona 03']);
   await page.getByRole('button',{name:'Agregar zona',exact:true}).click();assert.equal(await page.locator('.alarm-zone-card').count(),3);
   for(const number of [1,3,4]){await page.locator('#zone-'+number+'-name').fill(number===1?'Puerta principal':'Ambiente '+number);await page.getByRole('combobox',{name:'Atributo de zona '+number,exact:true}).selectOption('Demorada');await page.getByRole('combobox',{name:'Sensor de zona '+number,exact:true}).selectOption('Magnético cableado')}
   await page.getByRole('combobox',{name:'Sensor de zona 4',exact:true}).selectOption('Otro');if(mode==='form')assert(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled());await page.getByRole('textbox',{name:'Otro sensor de zona 4'}).fill('Detector de inundación');
   assert(await page.locator('.alarm-zone-help').first().textContent());
   assert(await page.locator('.alarm-zones-editor').evaluate(el=>el.getBoundingClientRect().top < document.querySelector('.technician-status-modal textarea').getBoundingClientRect().top));
   }
  }
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('button',{name:'Sí, confirmar estado',exact:true}).click();await page.waitForFunction(()=>window.__submitted);
  const sent=await page.evaluate(()=>window.__submitted);if(mode==='single')assert.deepEqual(sent.alarmZones.filter(z=>z.name).map(z=>z.number),[1]);else if(mode!=='regular')assert.deepEqual(sent.alarmZones.map(z=>z.number),[1,3,4]);else assert.equal(sent.alarmZones,undefined);
 }
 const overflow=await page.locator('.modal').first().evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert(overflow.scroll<=overflow.width+2,JSON.stringify({width,theme,mode,overflow}));assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,`result-${width}-${theme}-${mode}.png`),fullPage:true});await context.close();console.log('PASS',width,theme,mode)
}
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
