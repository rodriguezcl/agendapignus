// All browser and SMTP data are synthetic. No customer messages are sent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const out=path.resolve('tmp/visual-qa/installation-experience');fs.mkdirSync(out,{recursive:true})
const appStyles=[...fs.readFileSync('src/App.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';`).join('\n')
const styles=[...fs.readFileSync('src/main.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';${m[1]==='./style.css'?'\n'+appStyles:''}`).join('\n')
buildSync({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import Mail from './src/components/InstallationExperienceMail.jsx';import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${styles}
document.body.classList.toggle('dark',location.search.includes('dark'));
createRoot(document.getElementById('root')).render(<PermissionsProvider user={{id:'a',roleCode:'administrator'}}><div className="modal-layer"><section className="modal customer-detail-modal"><h2>Ficha de la cuenta</h2><Mail customerId="c"/></section></div></PermissionsProvider>);`},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',external:['/pignus-owl-white.svg','/logo-pignus.png'],logLevel:'silent'})
const {message}=require('../api/_lib/installation-experience.cjs')
const mail=message({client:'Ana Martínez',recipient:'cliente@example.com',technicians:['Pascual Gonzalez','Mariano Díaz']})
fs.writeFileSync(path.join(out,'correo.html'),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+mail.html)
;(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 for(const [width,theme,status] of [[390,'light','needs_email'],[360,'dark','uncertain'],[1280,'light','sent']]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  let item={id:'m',recordId:'s',customerId:'c',status,recipient:status==='needs_email'?'':'cliente@example.com',account:'PIG-1',client:'Ana Martínez',technicians:['Pascual Gonzalez','Mariano Díaz'],createdAt:'2026-10-26T16:00:00Z',updatedAt:'v1',sentAt:status==='sent'?'2026-10-26T16:02:00Z':null,sender:'soporte@example.com',history:[{at:'2026-10-26T16:00:00Z',action:'created'}]}
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url())
    if(u.pathname==='/fixture.js'||u.pathname==='/fixture.css')return route.fulfill({path:path.join(out,u.pathname.slice(1)),contentType:u.pathname.endsWith('css')?'text/css':'application/javascript'})
    if(u.pathname==='/api/customers/experience-mail'){
      if(route.request().method()==='POST'){const data=route.request().postDataJSON();assert.equal(data.id,'m');item={...item,updatedAt:'v2',recipient:data.email,status:data.action==='confirm-sent'?'verified':'queued'};return route.fulfill({json:{item,active:true}})}
      return route.fulfill({json:{items:[item],active:true}})
    }
    return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'})
  })
  await page.goto('https://experience.test/?theme='+theme);await page.locator('.experience-mail-item').waitFor()
  await page.screenshot({path:path.join(out,`${width}-${theme}-${status}.png`),fullPage:true})
  if(status==='needs_email'){const button=page.getByRole('button',{name:'Guardar y programar envío'});assert(await button.isDisabled());await page.getByRole('textbox',{name:'Correo del cliente'}).fill('cliente@example.com');await button.click();await page.getByText('Pendiente de envío',{exact:true}).waitFor()}
  if(status==='uncertain'){const button=page.getByRole('button',{name:'Confirmar envío verificado'});assert(await button.isDisabled());await page.getByRole('checkbox').check();await button.click();await page.getByText('Envío confirmado manualmente',{exact:true}).waitFor()}
  const rect=await page.locator('.modal').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert(rect.scroll<=rect.width+2);assert.deepEqual(errors,[]);console.log('PASS',width,theme,status);await page.close()
 }
 for(const width of [390,900]){
   const page=await browser.newPage({viewport:{width,height:1000}})
   await page.route('**/*',route=>route.fulfill({path:path.resolve('public/logo-pignus.png'),contentType:'image/png'}))
   await page.setContent(fs.readFileSync(path.join(out,'correo.html'),'utf8'));await page.screenshot({path:path.join(out,`correo-${width}.png`),fullPage:true})
   assert.equal(await page.getByRole('link',{name:'Compartir mi experiencia en Google'}).getAttribute('href'),require('../api/_lib/installation-experience.cjs').REVIEW_URL)
   const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(sizes.scroll<=sizes.width+2,JSON.stringify(sizes));await page.close();console.log('PASS email',width)
 }
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
