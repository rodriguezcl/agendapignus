const test = require('node:test')
const assert = require('node:assert/strict')
const { automaticSubject } = require('../api/_lib/ticket-subject.cjs')
const d = require('../api/_lib/tickets.cjs')
test('asunto automático uniforme con cuenta, evento y zona sin repetir PIG', () => {
  assert.equal(automaticSubject({ customer:{account:'PIG-6029',name:'PIG-6029 Martín French'},event:{name:'BUR - Intrusión'},zone:'1 puerta de ingreso',category:{name:'Alarmas'},subcategory:{name:'Activaciones reiteradas'} }), 'PIG-6029 MARTÍN FRENCH - BUR - INTRUSIÓN - ZONA 1 PUERTA DE INGRESO')
  assert.equal(automaticSubject({requesterName:'María',category:{name:'Soporte interno'},subcategory:{name:'Impresión'}}),'MARÍA - IMPRESIÓN')
  assert.equal(automaticSubject({category:{name:'Soporte interno'}}),'SOLICITUD INTERNA - SOPORTE INTERNO')
  const long=automaticSubject({customer:{account:'CLI-1234',name:'N'.repeat(300)},event:{name:'E'.repeat(100)},zone:'Z'.repeat(200)})
  assert.ok(long.length<=160 && long.includes(' - E') && long.includes(' - ZONA Z'))
})
test('servidor genera asunto con datos confiables y conserva compatibilidad de otros canales', () => {
  const config=d.defaultConfig(),user={id:'admin',roleCode:'administrator',name:'Admin'},state={customers:[{customerId:'c1',account:'PIG-1',name:'Cliente'}],history:[]}
  const input={customerId:'c1',origin:'phone',categoryId:'alarm',subcategoryId:'repeated',description:'Observación obligatoria',title:'Título manipulado',automaticTitle:true}
  const item=d.newTicket(input,user,state,config,'1','2026-10-23T15:00:00Z')
  assert.equal(item.title,'PIG-1 CLIENTE - ACTIVACIONES REITERADAS')
  assert.equal(d.newTicket({...input,automaticTitle:false},user,state,config,'2','2026-10-23T15:00:00Z').title,'Título manipulado')
  assert.throws(()=>d.newTicket({...input,description:' '},user,state,config,'3','2026-10-23T15:00:00Z'),/Observación/)
})
test('fecha local precargada conserva hora y minutos sin convertir a UTC', async () => {
  const {ticketLocalDateTime}=await import('../src/features/tickets/ticket-ui.mjs')
  assert.equal(ticketLocalDateTime(new Date(2026,9,23,9,7,59)),'2026-10-23T09:07')
})

test('zona opcional normalizada sin duplicar su prefijo', () => {
 assert.equal(automaticSubject({requesterName:'Ana',zone:' zona 1   ingreso '}),'ANA - ZONA 1 INGRESO')
 assert.equal(automaticSubject({requesterName:'Ana',zone:'  '}),'ANA')
})
test('opciones alfabéticas en español sin alterar el catálogo original', async () => {
 const {sortOptionsAlphabetically}=await import('../src/domain/shared/catalog-order.mjs')
 const input=[{name:'Zona 10'},{name:'cámaras'},{name:'Alarmas'},{name:'Zona 2'}]
 assert.deepEqual(sortOptionsAlphabetically(input).map(x=>x.name),['Alarmas','cámaras','Zona 2','Zona 10'])
 assert.equal(input[0].name,'Zona 10')
})
