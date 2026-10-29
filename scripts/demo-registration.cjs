// Local preview of the actual public component. No database or outbound API.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp', 'registration-demo')
fs.mkdirSync(out, { recursive: true })
const styles = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
  .map(m => `import './src/${m[1].replace(/^\.\//, '')}';`).join('\n')
const contents = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import PublicRegistration from './src/features/registration/PublicRegistration.jsx';
import contracts from './shared/registration/contracts.json';
import { validate } from './shared/registration/validate.mjs';
${styles}
const kinds = { docta: 'Docta', 'nobu-town': 'Nobu Town', residencial: 'Residencial' };
const token = location.hash.slice(1), kind = token.replace(/^demo-/, '');
const selected = kinds[kind] ? kind : 'docta';
const example = new URLSearchParams(location.search).has('ejemplo');
const values = { name:'Cliente de ejemplo', document:selected==='residencial'?'20301234563':'30123456', email:'cliente@example.com', phone:'3511234567', block:'15', lot:'12', side:'Lado Córdoba', address:'Calle de Ejemplo 123', neighborhood:'Centro', city:'Córdoba', kit:'OTRO', extraDetection:'Sensor adicional de ejemplo', monthlyFee:'65000', propertyType:'Residencial', subscriberPassword:'ejemplo-abonado', operatorPassword:'ejemplo-operador', contact1:'Ana Ejemplo · familiar', contactPhone1:'3517654321', contact2:'Juan Ejemplo · familiar', contactPhone2:'3517777777', paymentMethod:'Débito CBU', cbu:'0720000700000000000017', bankHolder:'Titular de ejemplo', bankDocumentType:'DNI', bankDocument:'30123456', bank:'BANCO SANTANDER ARGENTINA S.A.' };
window.fetch = async (url, options = {}) => {
  // Intercept in memory: even the simulated submission never leaves this page.
  if (String(url) !== '/api/registration/public') throw new Error('La demo no utiliza conexiones externas.');
  const input = JSON.parse(options.body || '{}');
  if (input.action === 'read') return new Response(JSON.stringify({kind:selected,version:0,termsVersion:contracts.version,terms:contracts.texts[selected],appointment:{date:'2026-11-10',time:'10:30'},prefill:example?values:{}}), {status:200});
  if (input.action === 'submit') {
    const result = validate(selected,input.values);
    return new Response(JSON.stringify(Object.keys(result.errors).length?{error:'Revisá los campos indicados.',fields:result.errors}:{submitted:true}),{status:Object.keys(result.errors).length?400:200});
  }
  return new Response('{}',{status:400});
};
const link = (k, filled = example) => '/alta'+(filled?'?ejemplo=1':'')+'#demo-'+k;
createRoot(document.getElementById('root')).render(<>
  <aside className="demo-tools" aria-label="Controles de demostración">
    <div><strong>DEMO</strong><span>Sin envíos ni guardado de respuestas</span></div>
    <nav aria-label="Tipo de formulario">{Object.entries(kinds).map(([k,label])=><a key={k} href={link(k)} aria-current={k===selected?'page':undefined} onClick={e=>{e.preventDefault();location.assign(link(k));location.reload();}}>{label}</a>)}</nav>
    <a className="demo-example" href={link(selected,!example)}>{example?'Reiniciar vacío':'Usar datos de ejemplo'}</a>
  </aside>
  <PublicRegistration />
</>);
`
buildSync({ stdin: { contents, resolveDir:root, loader:'jsx' }, outfile:path.join(out,'demo.js'), bundle:true, platform:'browser', format:'iife', external:['/logo-pignus.png','/pignus-owl-white.svg'], logLevel:'silent' })
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo · Formularios Pignus</title><link rel="stylesheet" href="/demo.css"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/demo.js"></script></body></html>`
const css = `.demo-tools{padding:14px 20px;background:#fff8e2;border-bottom:1px solid #dec480;color:#493900;font:14px/1.4 system-ui;display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}.demo-tools>div{display:flex;align-items:center;gap:10px}.demo-tools strong{font-size:12px;background:#6c5000;color:white;border-radius:4px;padding:4px 7px}.demo-tools nav{display:flex;gap:8px}.demo-tools a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border:1px solid #c8b67c;border-radius:6px;text-decoration:none;color:#493900;background:white}.demo-tools a[aria-current=page]{background:#6c5000;color:white;border-color:#6c5000}.demo-tools a:focus-visible{outline:3px solid #226db4;outline-offset:2px}.demo-tools .demo-example{font-weight:600}@media(max-width:600px){.demo-tools{padding:12px;gap:10px}.demo-tools>div{font-size:12px}.demo-tools nav{width:100%}.demo-tools nav a{flex:1;padding:8px}.demo-tools .demo-example{width:100%}}`
const server = http.createServer((req,res) => {
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'self'; form-action 'none'; frame-ancestors 'none'")
  const pathname = new URL(req.url,'http://localhost').pathname
  if(req.method!=='GET'){res.writeHead(405);return res.end('Demo: no se reciben respuestas.')}
  if(['/demo.js','/demo.css'].includes(pathname)){res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'application/javascript');return fs.createReadStream(path.join(out,pathname.slice(1))).pipe(res)}
  if(pathname==='/preview.css'){res.setHeader('Content-Type','text/css');return res.end(css)}
  if(pathname==='/'||pathname==='/alta'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html)}
  res.writeHead(404);res.end()
})
if(process.argv.includes('--build-only'))console.log('Demo actualizada.')
else server.listen(Number(process.env.PIGNUS_DEMO_PORT)||4189,'127.0.0.1',()=>console.log('Demo: http://127.0.0.1:'+server.address().port+'/alta#demo-docta'))
