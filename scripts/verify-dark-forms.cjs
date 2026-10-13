const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const fixture = `
import { createRoot } from 'react-dom/client';
import './style.css';
import './mobile-layout.css';
import './dark-neutral.css';
import './dark-neutral-legacy.css';
import './presentation/components/forms/select-containment.css';
const services = [{id:'a',name:'Instalación de cámaras',status:'Activo'},{id:'b',name:'Instalación de tótem con una descripción extremadamente larga sin espacios '+ 'X'.repeat(100),status:'Activo'}];
createRoot(document.getElementById('root')).render(<div className="app-shell" data-theme="dark"><div className="modal"><div id="fixture" style={{width:'100%',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:12}}><div id="custom"><ServiceTypesField services={services} task={{serviceId:'a',serviceTypes:services}} onChange={()=>{}} /></div><label id="native">Formulario<select><option>{'Opción larga '.repeat(30)}</option></select></label></div></div></div>);
`
const built = buildSync({stdin:{contents:source+'\n'+fixture,loader:'jsx',resolveDir:path.join(root,'src')},bundle:true,write:false,outdir:'out',format:'iife',external:['/logo-pignus.png'],define:{'process.env.NODE_ENV':'"production"','import.meta.env.PROD':'false'},loader:{'.css':'css'},logLevel:'silent'})
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'})
 try {
  const page=await browser.newPage()
  const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text
  const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
  for(const width of [360,768,1440]) {
   await page.setViewportSize({width,height:900})
   await page.setContent('<html><head><style>'+css+'</style></head><body><div id="root"></div></body></html>')
   await page.addScriptTag({content:js})
   await page.locator('.service-types-trigger').waitFor()
   for(const [child,parent] of [['.service-types-trigger','#custom'],['select','#native']]) {
    const a=await page.locator(child).boundingBox(),b=await page.locator(parent).boundingBox()
    assert(a.x>=b.x-1 && a.x+a.width<=b.x+b.width+1,`${child} overflows at ${width}`)
   }
   await page.locator('.service-types-trigger').click()
   const menu=page.locator('.service-types-options')
   await menu.waitFor()
   for (const selector of ['.service-types-field', '.service-types-trigger', '.service-types-options', 'select']) {
    const color = await page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor)
    const channels = color.match(/[0-9.]+/g).map(Number)
    assert(Math.max(...channels.slice(0,3))-Math.min(...channels.slice(0,3)) < 5, selector + ' retains a tinted background: ' + color)
   }
   assert(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`options overflow at ${width}`)
   await page.keyboard.press('Escape')
   assert.equal(await menu.count(),0)
   console.log('Selectors contained, options readable and Escape closes at '+width+'px')
  }
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})

