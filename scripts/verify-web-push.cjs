// Isolated browser fixture: fake push provider and intercepted API; no real subscriptions or sends.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/visual-qa/web-push');fs.mkdirSync(out,{recursive:true})
const cssImports=[...fs.readFileSync(path.join(root,'src/main.jsx'),'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m=>`import '${m[1]}';`).join('\n')
const built=buildSync({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import NotificationCenter from './components/NotificationCenter.jsx';import{installPushNavigation}from'./infrastructure/browser/push-navigation.mjs';${cssImports}
installPushNavigation();createRoot(document.getElementById('root')).render(<div className='app-shell' data-theme='light'><main><header className='topbar'><h1>Notificaciones</h1><div className='profile'><NotificationCenter userKey='qa-user' notifications={[{id:'collection:qa',title:'Cobranza de prueba',detail:'Sólo datos sintéticos'}]} onSelect={notice=>window.selected=notice.id}/></div></header></main></div>);`,loader:'jsx',resolveDir:path.join(root,'src')},bundle:true,write:false,outdir:'out',format:'iife',external:['/logo-pignus.png','/pignus-owl-white.svg'],define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'css'},logLevel:'silent'})
const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text,css=built.outputFiles.find(file=>file.path.endsWith('.css')).text
;(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const scenario of ['desktop','mobile','ios-home-required','denied']){
 const width=scenario==='desktop'?1440:390,context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[];let subscribed=false,tested=0
 page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(({scenario})=>{
   let subscription=null
   const value={endpoint:'https://fcm.googleapis.com/fcm/send/qa',keys:{p256dh:'qa',auth:'qa'}}
   const manager={getSubscription:async()=>subscription,subscribe:async()=>{if(Notification.permission!=='granted')throw new Error('Permission not granted');subscription={endpoint:value.endpoint,toJSON:()=>value,unsubscribe:async()=>{subscription=null;return true}};return subscription}}
   const worker={pushManager:manager},listeners={}
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>worker,ready:Promise.resolve(worker),addEventListener:(type,fn)=>listeners[type]=fn}})
   window.PushManager=function(){}
   window.Notification={permission:scenario==='denied'?'denied':'default',requestPermission:async()=>{Notification.permission=scenario==='denied'?'denied':'granted';return Notification.permission}}
   if(scenario==='ios-home-required')Object.defineProperty(navigator,'userAgent',{value:'iPhone Safari'})
 },{scenario})
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/push/subscription'){
   const body=route.request().postDataJSON()||{}
   if(route.request().method()==='GET')return route.fulfill({json:{available:true,publicKey:Buffer.alloc(65,1).toString('base64url')}})
   if(body.action==='subscribe')subscribed=true
   if(route.request().method()==='DELETE')subscribed=false
   if(body.action==='test'){assert(subscribed);tested++}
   return route.fulfill({json:{enabled:subscribed,sent:body.action==='test'}})
 }return route.fulfill(url.pathname==='/qa.js'?{contentType:'text/javascript',body:js}:url.pathname==='/qa.css'?{contentType:'text/css',body:css}:{contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script>'})})
 await page.goto('https://web-push.test/');await page.locator('.notification-toggle').click();await page.locator('.notification-device-settings summary').click()
 if(scenario==='ios-home-required') {assert(await page.getByText(/agregá esta web a la pantalla de inicio/).isVisible());assert.equal(await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).count(),0)}
 else {await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).click()
   if(scenario==='denied'){await page.getByRole('status').filter({hasText:'bloqueadas'}).waitFor();assert(!subscribed)}
   else {await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor();assert(subscribed);await page.getByRole('button',{name:'Enviar prueba',exact:true}).click();await page.getByText('Prueba enviada.',{exact:false}).waitFor();assert.equal(tested,1)
     await page.screenshot({path:path.join(out,scenario+'.png')})
     await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).click();await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).waitFor();assert(!subscribed)
     await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pignus-push-open',{detail:{userId:'another',noticeId:'collection:qa'}})));await page.getByText(/pertenece a otra cuenta/).waitFor();assert.equal(await page.evaluate(()=>window.selected),undefined)
     await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pignus-push-open',{detail:{userId:'qa-user',noticeId:'collection:qa'}})));await page.waitForFunction(()=>window.selected==='collection:qa')
   }
 }
 const geometry=await page.locator('.notification-panel').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth,overflow:el.scrollWidth-el.clientWidth}));assert(geometry.left>=0&&geometry.right<=geometry.width&&geometry.overflow<=1)
 assert.deepEqual(errors,[]);console.log('PASS Web Push',scenario);await context.close()
}}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1})
