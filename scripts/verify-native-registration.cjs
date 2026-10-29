// Isolated browser fixtures: synthetic data, intercepted API, no real submissions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const contracts=require('../shared/registration/contracts.json')
const out=path.resolve('tmp/visual-qa/native-registration');fs.mkdirSync(out,{recursive:true})
const mainStyles=[...fs.readFileSync('src/main.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g),...fs.readFileSync('src/App.jsx','utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import './src/${m[1].replace(/^\.\//,'')}';`).join('\n')
buildSync({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import Public from './src/features/registration/PublicRegistration.jsx';import Staff from './src/features/registration/RegistrationForms.jsx';import{PermissionsProvider}from'./src/presentation/contexts/permissions-context.jsx';${mainStyles}
const staff=location.search.includes('staff'),theme=location.search.includes('dark')?'dark':'light';document.body.classList.toggle('dark',theme==='dark');createRoot(document.getElementById('root')).render(staff?<PermissionsProvider user={{id:'a',roleCode:'administrator'}}><div className="app-shell" data-theme={theme}><div className="modal-layer"><section className="modal customer-detail-modal"><h2>Instalación de alarma</h2><Staff id="service:s" /></section></div></div></PermissionsProvider>:<Public/>);`},outfile:path.join(out,'fixture.js'),bundle:true,platform:'browser',format:'iife',external:['/pignus-owl-white.svg','/logo-pignus.png'],logLevel:'silent'})
;(async()=>{
 const {stepsFor}=await import('../shared/registration/schema.mjs'),{validate}=await import('../shared/registration/validate.mjs')
 const browser=await chromium.launch({headless:true,channel:'msedge'})
 const base={name:'Cliente de prueba',document:'20301234567',email:'cliente@example.com',phone:'3511234567',block:'15',lot:'12',side:'Lado Córdoba',propertyType:'Residencial',subscriberPassword:'palabra-prueba',operatorPassword:'otra-palabra',contact1:'Contacto prueba',contactPhone1:'3517654321',contact2:'Segundo contacto',contactPhone2:'3517777777',guardAccepted:true,termsAccepted:true,declarationAccepted:true,address:'Calle Ejemplo 123',neighborhood:'Centro',city:'Córdoba',kit:'OTRO',paymentMethod:'Visa crédito',cardNumber:'4111111111111111',cardExpiry:'12/30',cardHolder:'Cliente prueba',cardDni:'30123456'}
 let sum='2030123456'.split('').reduce((s,d,i)=>s+Number(d)*[5,4,3,2,7,6,5,4,3,2][i],0),check=11-sum%11;base.document='2030123456'+(check===11?0:check===10?9:check)
 try{
  for(const [kind,width,theme,method='Visa crédito'] of [['docta',390,'light'],['nobu-town',360,'light'],['residencial',390,'light'],['residencial',1280,'light'],['residencial',360,'light','Débito CBU']]) {
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let submitted=false
   page.on('pageerror',e=>errors.push(e.message))
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.pathname.startsWith('/fixture.'))return route.fulfill({path:path.join(out,url.pathname.slice(1)),contentType:url.pathname.endsWith('css')?'text/css':'application/javascript'})
    if(url.pathname==='/api/registration/public'){
      const data=route.request().postDataJSON()
      if(data.action==='submit'){const result=validate(kind,data.values);assert.deepEqual(result.errors,{});assert.equal(data.token,'test-token');assert.equal(data.values.name,'Nombre autocompletado');assert.equal(data.values.email,'autocompletado@example.com');submitted=true;return route.fulfill({json:{submitted:true}})}
      return route.fulfill({json:{kind,version:0,termsVersion:contracts.version,terms:contracts.texts[kind],appointment:{date:'2026-11-10',time:'10:30'},prefill:{}}})
    }
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'})
   })
   await page.goto(`https://registration.test/alta#test-token`)
   await page.getByRole('heading',{name:'Condiciones del servicio'}).waitFor()
   const values={...base,document:kind==='residencial'?base.document:'30123456',paymentMethod:method,cbu:'0720000720000000000010',bankHolder:'Titular de prueba',bankDocumentType:'DNI',bankDocument:'30123456',bank:'BANCO SANTANDER ARGENTINA S.A.'}
   if(method==='Débito CBU'){const check=(v,w)=>String((10-v.split('').reduce((s,d,i)=>s+Number(d)*w[i],0)%10)%10),a='0720000',b='0000000000001';values.cbu=a+check(a,[7,1,3,9,7,1,3])+b+check(b,[3,9,7,1,3,9,7,1,3,9,7,1,3])}
   const steps=stepsFor(kind,values)
   for(let i=0;i<steps.length;i++) {
     for(const field of steps[i].fields){if(!field.required&&!values[field.id])continue;const control=page.locator('#registration-'+field.id);if(field.type==='checkbox')await control.check();else if(field.options)await control.selectOption(values[field.id]);else await control.fill(values[field.id]||'')}
     if(i===1){
       if(kind==='residencial'){
         await page.locator('#registration-city').selectOption('La Calera')
         assert.equal(await page.locator('#registration-neighborhood').inputValue(),'')
         await page.locator('#registration-neighborhood').selectOption('Mi barrio no figura / zona rural')
         await page.locator('#registration-neighborhoodOther').fill('Referencia de barrio para revisar')
         await page.locator('#registration-city').selectOption('Córdoba')
         assert.equal(await page.locator('#registration-neighborhood').inputValue(),'')
         assert.equal(await page.locator('#registration-neighborhoodOther').count(),0)
         await page.locator('#registration-neighborhood').selectOption('Centro')
       }
       assert.equal(await page.locator('#registration-name').getAttribute('autocomplete'),'section-subscriber name')
       assert.equal(await page.locator('#registration-phone').getAttribute('name'),'phone')
       // Native browser autofill can change input values without React events.
       await page.locator('#registration-name').evaluate(el=>{el.value='Nombre autocompletado'})
       await page.getByRole('button',{name:'Anterior',exact:true}).click()
       await page.getByRole('button',{name:'Continuar',exact:true}).click()
       assert.equal(await page.locator('#registration-name').inputValue(),'Nombre autocompletado')
       await page.locator('#registration-email').evaluate(el=>{el.value='autocompletado@example.com'})
     }
     if(steps[i].id==='payment'&&method==='Débito CBU'){
       await page.locator('#registration-cbu').fill('')
       await page.locator('#registration-cbu').fill(values.cbu)
       assert.equal(await page.locator('#registration-bank').inputValue(),'BANCO SANTANDER ARGENTINA S.A.')
       await page.locator('#registration-bank').selectOption('BANCO DE LA NACION ARGENTINA')
       await page.getByRole('button',{name:'Continuar',exact:true}).click()
       await page.getByText('El banco seleccionado no corresponde al código del CBU. Revisá ambos datos.',{exact:true}).waitFor()
       await page.locator('#registration-bank').selectOption(values.bank)
     }
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow){await page.screenshot({path:path.join(out,'overflow.png'),fullPage:true});console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width})).slice(0,12)))}assert.equal(overflow,false,`${kind}/${width}/${i} overflow`)
     if([1,3,steps.length-1].includes(i))await page.screenshot({path:path.join(out,`${kind}-${width}-step${i+1}.png`),fullPage:true})
     await page.getByRole('button',{name:i===steps.length-1?'Enviar formulario':'Continuar',exact:true}).click()
   }
   await page.getByRole('heading',{name:'Recibimos tu formulario'}).waitFor();assert.equal(submitted,true);assert.deepEqual(errors,[]);await page.close()
  }
  for(const [width,theme] of [[390,'light'],[1280,'dark']]) {
    const page=await browser.newPage({viewport:{width,height:900}})
    const values={...base,cardNumber:'•••• 1111',cardDni:'••••',cardExpiry:'••••',cardHolder:'••••',subscriberPassword:'••••',operatorPassword:'••••'}
    const item={id:'service:s',kind:'residencial',version:1,reviewedVersion:0,status:'submitted',updatedAt:'v1',client:'Cliente de prueba',reason:'',link:'',events:[{at:'2026-10-28T15:00:00Z',action:'submitted',version:1}],revisions:[{version:1,at:'2026-10-28T15:00:00Z',termsVersion:contracts.version,values,changed:[]}]}
    await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/fixture.'))return route.fulfill({path:path.join(out,url.pathname.slice(1)),contentType:url.pathname.endsWith('css')?'text/css':'application/javascript'});if(url.pathname==='/api/registration/forms')return route.fulfill({json:{items:[item]}});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'})})
    await page.goto(`https://registration.test/?staff&${theme}`);await page.getByText('Respuesta 1',{exact:false}).waitFor();await page.screenshot({path:path.join(out,`staff-${width}-${theme}.png`),fullPage:true})
    assert.equal(await page.locator('.modal').evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
    assert(await page.getByRole('button',{name:'Confirmar carga en SoftGuard'}).isDisabled())
    await page.close()
  }
  console.log('OK: tres formularios completos, 360/390/1280 px, validación de envío y modales claro/oscuro; sin desbordes.')
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
