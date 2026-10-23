const test=require('node:test'),assert=require('node:assert/strict')
const {validatePresenceReport,reconcilePresence,assertActiveService,assertPresenceUnchanged}=require('../api/_lib/softguard-presence.cjs')
const original=[{customerId:'1',account:'PIG-5999',name:'Prueba'},{customerId:'2',account:'CLI-1',name:'Cliente'},{customerId:'3',account:'PIG-6000'}]
const report={version:1,accounts:['PIG-6000']}
test('dos reportes confirman la baja sin eliminar identidad, una reaparición reactiva',()=>{
 const first=reconcilePresence(original,report,null,'first')
 assert.equal(first[0].softguardPresence.status,'pending')
 const second=reconcilePresence(first,report,report,'second')
 assert.equal(second[0].softguardPresence.status,'inactive')
 assert.equal(second.length,3);assert.equal(second[0].customerId,'1');assert.deepEqual(second[1],original[1])
 assert.deepEqual(reconcilePresence(second,{...report,accounts:['PIG-5999','PIG-6000']},report,'third'),original)
 assert.equal(reconcilePresence(first,report,null,'after failure')[0].softguardPresence.status,'pending')
 assert.equal(original[0].softguardPresence,undefined)
 assert.throws(()=>assertActiveService(null,{customerId:'1'},second),/baja/)
 assert.doesNotThrow(()=>assertActiveService({customerId:'1'},{customerId:'1',status:'Completado'},second))
 assert.throws(()=>assertPresenceUnchanged(second,original),/sincronización/)
})
test('no acepta totales discrepantes, listas vacías, duplicados, otros dealers ni caídas masivas',()=>{
 assert.equal(validatePresenceReport({count:1}),null)
 assert.deepEqual(validatePresenceReport({count:1,report}),report)
 for(const accounts of [[],['CLI-1'],['PIG-1','PIG-1'],['PIG-1','PIG-2']]) assert.throws(()=>validatePresenceReport({count:1,report:{version:1,accounts}}))
 assert.throws(()=>validatePresenceReport({count:1,report},{accounts:Array.from({length:20},(_,i)=>'PIG-'+i)}),/excesiva/)
})

test('importaciones y deshacer no alteran la presencia confirmada por el conector',()=>{
 const {preserveCustomerTrackingFlags,restoreCustomerImportBackup}=require('../api/_lib/customer-import.cjs')
 const current=[{...original[0],softguardPresence:{status:'inactive'}}]
 assert.equal(preserveCustomerTrackingFlags(current,[original[0]])[0].softguardPresence.status,'inactive')
 assert.equal(restoreCustomerImportBackup(current,{version:2,before:[original[0]],createdAccounts:[]})[0].softguardPresence.status,'inactive')
})
