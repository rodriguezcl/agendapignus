const test = require('node:test')
const assert = require('node:assert/strict')
const { present } = require('../api/_lib/tickets.cjs')
const user = { id: 'admin', roleCode: 'administrator' }
const base = { number:'1000006', origin:'technical', title:'Coordinar visita', customerSnapshot:{account:'PIG-7062',name:'ALICIA DEL CARMEN PEREYRA'}, description:'Coordinar con el cliente', createdByName:'Mariano' }
test('los informes técnicos existentes muestran cuenta, cliente y acción sin alterar el original', () => {
 const result=present(base,user)
 assert.equal(result.title,'PIG-7062 ALICIA DEL CARMEN PEREYRA — Coordinar visita')
 assert.equal(result.description,base.description)
 assert.equal(result.createdByName,'Mariano')
 assert.equal(base.title,'Coordinar visita')
 assert.equal(present({...base,title:'Cotizar adicional',customerSnapshot:{account:'CLI-001',name:'CLIENTE'}},user).title,'CLI-001 CLIENTE — Cotizar adicional')
})
test('evita duplicar cuentas y conserva títulos sin cliente o de otros orígenes', () => {
 assert.equal(present({...base,customerSnapshot:{account:'PIG-7062',name:'PIG-7062 ALICIA DEL CARMEN PEREYRA'}},user).title,present(base,user).title)
 const titled={...base,title:'PIG-7062 ALICIA DEL CARMEN PEREYRA - Coordinar visita'}
 assert.equal(present(titled,user).title,titled.title)
 assert.equal(present({...base,customerSnapshot:null},user).title,base.title)
 assert.equal(present({...base,origin:'phone'},user).title,base.title)
})
