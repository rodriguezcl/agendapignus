const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateReport, retryDownload, fail } = require('../lib.cjs')
const report = (accounts = ['PIG-6000','PIG-6001']) => Buffer.from('<html><table><tr><th>Dealer/Cuenta</th><th>Nombre</th></tr>' + accounts.map(a=>`<tr><td>${a}</td><td>Cliente de prueba</td></tr>`).join('') + '</table></html>')
test('valida el total completo y dealer; no depende de las 50 filas visibles', () => {
  const accounts=Array.from({length:1064},(_,i)=>`PIG-${6000+i}`)
  assert.equal(validateReport(report(accounts),{expectedCount:1064}).count,1064)
})
test('rechaza descarga parcial, archivo de login, dealer incorrecto y duplicados', () => {
  for (const [buffer,count,code] of [[report().subarray(0,80),2,'INCOMPLETE'],[Buffer.from('<html>Login</html>'),2,'FORMAT'],[report(['CLI-1']),1,'DEALER'],[report(['PIG-1','PIG-1']),2,'DUPLICATE'],[report(),1064,'COUNT_MISMATCH']]) assert.throws(()=>validateReport(buffer,{expectedCount:count}),{code})
})
test('bloquea caída anormal respecto de última importación',()=>assert.throws(()=>validateReport(report(),{expectedCount:2,previousCount:100}),{code:'SUSPICIOUS_DROP'}))
test('la firma no depende del orden ni encabezado volátil',()=>{
  assert.equal(validateReport(report(),{expectedCount:2}).hash,validateReport(report(['PIG-6001','PIG-6000']),{expectedCount:2}).hash)
})
test('reintenta solo fallos recuperables y termina al tercer intento',async()=>{
  let count=0;const delays=[]
  const value=await retryDownload(async()=>{if(++count<3)throw fail('DOWNLOAD_TIMEOUT','timeout',true);return 'ok'},{sleep:async ms=>delays.push(ms)})
  assert.equal(value,'ok');assert.equal(count,3);assert.deepEqual(delays,[10000,20000])
  count=0;await assert.rejects(retryDownload(async()=>{count++;throw fail('DOWNLOAD_FAILED','download',true)},{sleep:async()=>{}}),{code:'DOWNLOAD_FAILED'});assert.equal(count,3)
})
test('no reintenta sesión vencida ni validación que requiere intervención',async()=>{
  let count=0;await assert.rejects(retryDownload(async()=>{count++;throw fail('LOGIN_REQUIRED','login')},{sleep:async()=>assert.fail('no sleep')}),{code:'LOGIN_REQUIRED'});assert.equal(count,1)
})
