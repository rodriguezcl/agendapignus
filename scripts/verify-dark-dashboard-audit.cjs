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
import './dark-neutral.css';
import './dark-neutral-legacy.css';
window.fetch = async () => ({ok:true,json:async()=>({records:[{id:'test',at:'2026-10-13T12:00:00Z',action:'Inició sesión',entity:'Sesión',user:{name:'Usuario de prueba',email:'test@example.com'}}]})});
createRoot(document.getElementById('root')).render(<div className="app-shell" data-theme="dark"><div className="content"><Dashboard history={[]} services={[]} /><AuditPage user={{name:'Prueba'}} /></div></div>);
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
   await page.locator('.audit-row').waitFor()
   for(const selector of ['.audit-table','.audit-row','.audit-table-head','.stats-grid article']) {
    for (const el of await page.locator(selector).all()) {
     const color=await el.evaluate(el=>getComputedStyle(el).backgroundColor)
     const rgb=color.match(/[0-9.]+/g).map(Number).slice(0,3)
     assert(Math.max(...rgb)<80 && Math.max(...rgb)-Math.min(...rgb)<5, selector+': '+color)
    }
   }
   await page.screenshot({path:require('node:os').tmpdir()+'/pignus-dark-audit-'+width+'.png',fullPage:true})
   console.log('Audit rows and dashboard surfaces neutral at '+width+'px')
  }
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})

