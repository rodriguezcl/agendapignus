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
function Fixture() {
 const [record,setRecord]=useState({id:'r',status:'Pendiente',service:'Instalación'});
 return <div className="week-task week-task-summary" role="button" onClick={()=>window.opened=true} onKeyDown={()=>window.opened=true}><div className="week-task-title"><span className="week-task-heading"><ServicePreparationButton record={record} onNotice={()=>{}} persist={async command=>{window.saved=(window.saved||0)+1;setRecord({...record,servicePreparation:{ready:command.ready,byName:'Preparador'}})}} /><span>Servicio 1</span></span></div></div>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
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
   const button=page.locator('.service-preparation-button')
   await button.click()
   assert.equal(await button.getAttribute('aria-pressed'),'true')
   assert.equal(await page.evaluate(()=>Boolean(window.opened)),false)
   await button.focus();await page.keyboard.press('Space')
   assert.equal(await button.getAttribute('aria-pressed'),'false')
   assert.equal(await page.evaluate(()=>Boolean(window.opened)),false)
   console.log('Preparation check toggles without opening card at '+width+'px')
  }
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})

