// Synthetic sessions and push provider; no production subscriptions or notifications.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {buildSync}=require('esbuild'),{chromium}=require('playwright')
const root=path.resolve(__dirname,'..')
const built=buildSync({stdin:{resolveDir:root,loader:'jsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import Center from './src/components/NotificationCenter.jsx';
function Fixture(){const[user,setUser]=useState('qa-a'),[items,setItems]=useState([{id:'initial',title:'Aviso inicial'}]);window.setSession=setUser;window.setNotices=setItems;return <><button onClick={e=>e.stopPropagation()}>Interacción normal</button>{user&&<Center key={user} userKey={user} notifications={items}/>}</>};createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`},bundle:true,write:false,outdir:'out',format:'iife',logLevel:'silent'})
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
;(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];let currentUser='qa-a',owner=null,enrollments=0,offline=false
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  window.tones=0;const native=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){window.tones++;return native.call(this)}
  const data={endpoint:'https://fcm.googleapis.com/fcm/send/qa',keys:{p256dh:'qa',auth:'qa'}}
  const subscription={endpoint:data.endpoint,toJSON:()=>data,unsubscribe:async()=>{localStorage.removeItem('qa-subscription');return true}}
  const worker={pushManager:{getSubscription:async()=>localStorage.getItem('qa-subscription')?subscription:null,subscribe:async()=>{if(Notification.permission!=='granted')throw Error('Permission required');localStorage.setItem('qa-subscription','yes');return subscription}}}
  window.PushManager=function(){}
  window.Notification={get permission(){return localStorage.getItem('qa-permission')||'default'},requestPermission:async()=>{localStorage.setItem('qa-prompts',String(Number(localStorage.getItem('qa-prompts')||0)+1));localStorage.setItem('qa-permission','granted');return 'granted'}}
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>worker,ready:Promise.resolve(worker)}})
 })
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/api/push/subscription'){
   if(offline)return route.fulfill({status:503,json:{error:'Sin conexión'}})
   if(route.request().method()==='GET')return route.fulfill({json:{available:true,publicKey:Buffer.alloc(65,1).toString('base64url')}})
   assert(currentUser,'No push write without a session');const body=route.request().postDataJSON()||{}
   if(body.action==='subscribe'){owner=currentUser;enrollments++}
   if(route.request().method()==='DELETE'&&owner===currentUser)owner=null
   return route.fulfill({json:{enabled:owner===currentUser}})
  }
  return route.fulfill(u.pathname==='/qa.js'?{contentType:'text/javascript',body:js}:{contentType:'text/html',body:'<!doctype html><div id="root"></div><script src="/qa.js"></script>'})
 })
 const open=async()=>{await page.getByRole('button',{name:/^Notificaciones:/}).click();await page.locator('.notification-device-settings summary').click()}
 const session=async user=>{currentUser=user;await page.evaluate(user=>setSession(user),user)}
 const logout=async()=>{await session(null);owner=null;await page.getByRole('button',{name:/^Notificaciones:/}).waitFor({state:'detached'})}
 const settle=async()=>{await page.waitForFunction(()=>!document.querySelector('.notification-device-actions button:disabled'))}
 await page.goto('https://preferences.test/');await open()
 await page.getByRole('button',{name:'Activar sonido',exact:true}).click();await page.waitForFunction(()=>tones===2)
 await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).click();await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor()
 assert.equal(owner,'qa-a');assert.equal(enrollments,1)
 await logout();await session('qa-a');await page.waitForFunction(()=>document.querySelector('.notification-toggle'))
 await page.waitForTimeout(400);assert.equal(owner,'qa-a');assert.equal(enrollments,2,'restore without opening bell')
 await page.getByRole('button',{name:'Interacción normal',exact:true}).click()
 await page.evaluate(()=>setNotices([{id:'new',title:'Novedad'}]));await page.waitForFunction(()=>tones===4)
 await open();assert.equal(await page.getByRole('button',{name:'Silenciar',exact:true}).count(),1);await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>localStorage.getItem('qa-prompts')),'1','no permission prompt on restored session')
 await page.reload();await page.waitForTimeout(400);await open();assert.equal(await page.getByRole('button',{name:'Silenciar',exact:true}).count(),1);await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor();assert.equal(await page.evaluate(()=>tones),0,'no initial chime')
 await page.getByRole('button',{name:'Silenciar',exact:true}).click();await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).click();await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).waitFor();const before=enrollments
 await logout();await session('qa-a');await open();await settle();assert.equal(enrollments,before);assert.equal(owner,null);assert.equal(await page.getByRole('button',{name:'Activar sonido',exact:true}).count(),1)
 await page.getByRole('button',{name:'Activar en este dispositivo',exact:true}).click();await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor();await logout();await session('qa-b');await open();await settle();assert.equal(owner,null,'another account never inherits consent');assert.equal(await page.getByRole('button',{name:'Activar sonido',exact:true}).count(),1)
 await logout();offline=true;await session('qa-a');await open();await page.getByText(/No se pudo conectar el dispositivo/).waitFor();assert.equal(owner,null)
 offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.getByRole('button',{name:'Desactivar en este dispositivo',exact:true}).waitFor();assert.equal(owner,'qa-a');assert.equal(await page.evaluate(()=>localStorage.getItem('qa-prompts')),'1')
 assert.deepEqual(errors,[]);console.log('PASS: ingreso, salida, recarga, silencio, opt-out, aislamiento por cuenta y recuperación de conexión; sin repetir permisos.');await context.close()
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1})
