// Real components, synthetic subscribers and intercepted network. No business writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { buildSync } = require('esbuild'), { chromium } = require('playwright')
const geometry = require('./lib/modal-geometry.cjs')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tmp/visual-qa/customer-coordinates')
fs.mkdirSync(out, { recursive: true })
const cssImports = [...fs.readFileSync(path.join(root, 'src/main.jsx'), 'utf8').matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(match => `import '${match[1]}';`).join('\n')
const fixture = `
import {createRoot} from 'react-dom/client';
${cssImports}
const sample={customerId:'coord-1',kind:'subscriber',account:'PIG-8000',name:'ABONADO DE PRUEBA',type:'Residencial',street:'San Martín 100',locality:'Córdoba',province:'Córdoba',phone:'123456',address:'San Martín 100, Córdoba',fields:{'Ubicación de la cuenta':'-31.4,-64.2'}};
function Review(){
 const [customers,setCustomers]=useState(()=>JSON.parse(localStorage.getItem('qa-customers')||'null')||[sample]);
 const [notice,setNotice]=useState('');const [map,setMap]=useState(false);
 useEffect(()=>{window.reviewCustomers=customers;localStorage.setItem('qa-customers',JSON.stringify(customers))},[customers]);
 const theme=new URLSearchParams(location.search).get('theme');
 return <div className="app-shell" data-theme={theme}><main><header className="topbar"><div id="module-description-slot"/><button onClick={()=>setMap(!map)}>Alternar mapa</button></header><section className="content"><p role="status">{notice}</p>{map?<SubscriberMap customers={customers}/>:<Accounts customers={customers} setCustomers={setCustomers} setNotice={setNotice} ask={(title,message,action)=>action()} history={[]} services={[]} teams={[]} weekly={{}} permissions={{accountsEdit:true}}/>}</section></main></div>
}
const theme=new URLSearchParams(location.search).get('theme');document.body.dataset.theme=theme;document.documentElement.dataset.theme=theme;
createRoot(document.getElementById('root')).render(<Review/>);`
const bundle = buildSync({ stdin: { contents: "import './style.css';\n" + fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8') + fixture, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, outdir: 'out', format: 'iife', external: ['/logo-pignus.png', '/pignus-owl-white.svg'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'false' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent' })
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import[^;]+;/g, '')
;(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try { for(const [width,theme] of [[1440,'light'],[1440,'dark'],[390,'light'],[390,'dark']]) {
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/review')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script>'});
   if(url.pathname==='/qa.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(url.pathname==='/qa.css')return route.fulfill({contentType:'text/css',body:css});
   if(url.hostname==='tile.openstreetmap.org')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e7e0"/></svg>'});
   return route.fulfill({json:{}});
  });
  await page.goto('https://coordinates-review.test/review?theme='+theme);
  const edit=()=>page.getByTitle('Abrí el formulario para modificar los datos de este abonado o cliente.').click();
  await edit();
  assert.equal(await page.getByLabel('Latitud',{exact:true}).inputValue(),'-31.4');
  await page.getByLabel('Latitud',{exact:true}).fill('99');
  await page.getByRole('button',{name:'Guardar abonado',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(await page.evaluate(()=>window.reviewCustomers[0].locationOverride),undefined);
  await page.getByLabel('Latitud',{exact:true}).fill('-31,4567');
  await page.getByLabel('Longitud',{exact:true}).fill('-64.2345');
  await geometry(page,'coordinates-'+width+'-'+theme);
  await page.locator('.customer-coordinates').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'edit-'+width+'-'+theme+'.png')});
  await page.getByRole('button',{name:'Guardar abonado',exact:true}).click();
  await page.waitForFunction(()=>window.reviewCustomers[0].locationOverride);
  assert.deepEqual(await page.evaluate(()=>window.reviewCustomers[0].locationOverride),[-31.4567,-64.2345]);
  await page.reload();await edit();
  assert.equal(await page.getByLabel('Latitud',{exact:true}).inputValue(),'-31.4567');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByTitle('Abrí la ficha completa de este abonado o cliente.').click();
  assert.match(await page.locator('.customer-detail-modal iframe').getAttribute('src'),/-31.4567%2C-64.2345/);
  await page.locator('.customer-detail-modal .close-modal').click();
  await page.getByRole('button',{name:'Alternar mapa',exact:true}).click();
  await page.getByRole('button',{name:'Puntos por abonado',exact:true}).click();
  await page.locator('.subscriber-map-pin').waitFor();
  await page.locator('.subscriber-map-results li button').first().click();
  assert.equal(await page.locator('.subscriber-map-pin.is-selected').count(),1);
  assert.match(await page.locator('.subscriber-map-selection').innerText().catch(()=>page.locator('.subscriber-map-sidebar').innerText()),/corregidas manualmente/);
  await page.getByRole('button',{name:'Alternar mapa',exact:true}).click();await edit();
  await page.getByRole('button',{name:'Restablecer ubicación importada',exact:true}).click();
  assert.equal(await page.getByLabel('Latitud',{exact:true}).inputValue(),'-31.4');
  await page.getByRole('button',{name:'Guardar abonado',exact:true}).click();
  await page.waitForFunction(()=>!window.reviewCustomers[0].locationOverride);
  assert.deepEqual(errors,[]);console.log('OK '+width+' '+theme+' edición, validación, reapertura, ficha, mapa y restauración');
  await context.close();
 }}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
