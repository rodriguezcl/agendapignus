// Isolated fixtures: no credentials, real customer data or outbound requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const out=path.resolve('tmp/visual-qa/forms-inbox');fs.mkdirSync(out,{recursive:true})
const styles=[...fs.readFileSync('src/main.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g),...fs.readFileSync('src/App.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';`).join('\n')
buildSync({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import Inbox from './src/features/registration/FormsInbox.jsx';import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${styles}
const dark=location.search.includes('dark');document.body.classList.toggle('dark',dark);createRoot(document.getElementById('root')).render(<PermissionsProvider user={{id:'a',roleCode:'administrator'}}><div className="app-shell" data-theme={dark?'dark':'light'} style={{display:'block',padding:'16px'}}><header><h1>Formularios</h1><div id="module-description-slot"/></header><Inbox onOpenService={id=>window.openedService=id}/></div></PermissionsProvider>);`},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',external:['/pignus-owl-white.svg','/logo-pignus.png'],logLevel:'silent'})
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'})
 try {for(const [width,theme] of [[390,'light'],[1280,'light'],[390,'dark']]) {
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  const rows=Array.from({length:23},(_,i)=>({id:'service:'+i,serviceId:String(i),client:i?'Cliente de prueba '+i:'María Ejemplo',account:'PIG-'+(9000+i),date:'2026-11-10',time:'10:00',kind:i%2?'residencial':'docta',status:i===0?'submitted':i===1?'correction':'open',version:i<2?1:0}))
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url())
   if(url.pathname.startsWith('/fixture.'))return route.fulfill({path:path.join(out,url.pathname.slice(1)),contentType:url.pathname.endsWith('css')?'text/css':'application/javascript'})
   if(url.pathname==='/api/registration/forms'){
    if(url.searchParams.get('list')){let all=rows.filter(r=>(!url.searchParams.get('kind')||r.kind===url.searchParams.get('kind'))&&(!url.searchParams.get('search')||r.client.toLowerCase().includes(url.searchParams.get('search').toLowerCase())));const counts=Object.fromEntries(['open','submitted','correction','reviewed','cancelled'].map(s=>[s,all.filter(r=>r.status===s).length]));const filtered=all.filter(r=>!url.searchParams.get('status')||r.status===url.searchParams.get('status')),n=Number(url.searchParams.get('page')||1);return route.fulfill({json:{items:filtered.slice((n-1)*20,n*20),total:filtered.length,counts,page:n,pages:Math.max(1,Math.ceil(filtered.length/20))}})}
    const item=rows.find(r=>r.id===url.searchParams.get('id'));return route.fulfill({json:{items:[{...item,reviewedVersion:0,updatedAt:'v1',events:[],revisions:[],link:'',reason:''}]}})
   }
   if(url.origin!=='https://inbox.test')return route.abort()
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'})
  })
  await page.goto('https://inbox.test/?'+theme);await page.getByText('23 formulario(s).',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.screenshot({path:path.join(out,`${width}-${theme}.png`),fullPage:true})
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.getByText('Página 2 de 2',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),3)
  await page.getByLabel('Buscar cliente o cuenta').fill('María');await page.getByText('1 formulario(s) con los filtros actuales.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Ver servicio',exact:true}).click();assert.equal(await page.evaluate(()=>window.openedService),'0')
  await page.getByRole('button',{name:'Ver formulario',exact:true}).click();await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
  await page.screenshot({path:path.join(out,`${width}-${theme}-detail.png`),fullPage:true})
  await page.getByRole('button',{name:'Cerrar edición',exact:true}).click()
  await page.getByRole('combobox',{name:/^Estado/}).selectOption('reviewed');await page.getByText('No hay formularios para esta búsqueda.',{exact:true}).waitFor()
  assert.deepEqual(errors,[]);await page.close()
 }console.log('OK: bandeja responsive claro/oscuro, paginación, filtros, detalle y apertura de servicio.')}
 finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
