const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const d = require('../api/_lib/tickets.cjs')
const { initializeBusinessDefaults } = require('../api/_lib/ticket-business-defaults.cjs')
const { createTicketStore } = require('../api/_lib/tickets-store.cjs')
const { DatabaseSync } = require('node:sqlite')
const { pgliteAdapter } = require('./helpers/pglite-adapter.cjs')

test('ampliación preserva configuración, desactivaciones y SLA sin duplicar categorías', () => {
 const old=d.defaultConfig();old.categories=old.categories.filter(x=>x.id!=='administrative')
 const commercial=old.categories.find(x=>x.id==='commercial');commercial.priority='Alta';commercial.areaId='technical';commercial.subcategories=[{id:'quote',name:'Presupuesto especial',active:false}]
 const before=JSON.stringify(old),next=initializeBusinessDefaults(old,d.defaultConfig())
 assert.equal(JSON.stringify(old),before)
 assert.equal(next.categories.find(x=>x.id==='commercial').priority,'Alta')
 assert.equal(next.categories.find(x=>x.id==='commercial').subcategories[0].active,false)
 assert.deepEqual(next.sla,old.sla)
 assert.deepEqual(initializeBusinessDefaults(next,d.defaultConfig()),next)
})
for(const engine of ['sqlite','postgres']) test(engine+': solicitudes comerciales y administrativas se crean y cierran sin visita',async()=>{
 let db,pg,store,q
 if(engine==='sqlite'){db=new DatabaseSync(':memory:');store=createTicketStore({db});q=async(sql,args=[])=>db.prepare(sql).all(...args)}
 else{const {PGlite}=await import('@electric-sql/pglite');pg=await PGlite.create();store=createTicketStore({sql:pgliteAdapter(pg)});q=async(sql,args=[])=> (await pg.query(sql,args)).rows}
 try{
 await store.ensure()
 const old=d.defaultConfig();old.categories=old.categories.filter(x=>x.id!=='administrative');old.categories.find(x=>x.id==='commercial').subcategories=[{id:'quote',name:'Cotizar adicional',priority:'Baja',active:true}]
 await q('UPDATE pignus_ticket_settings SET data='+ (pg?'$1':'?') +" WHERE id='config'",[JSON.stringify({version:1,nextNumber:1000001,config:old})])
 const user={id:'admin',name:'Soporte',roleCode:'administrator'},state={employees:[],customers:[{customerId:'c1',account:'PIG-6029',name:'MARTIN FRENCH'}],history:[]}
 const metadata=await store.query(user,state,{mode:'metadata'})
 assert.ok(metadata.config.categories.some(x=>x.id==='administrative'))
 assert.equal(metadata.config.categories.find(x=>x.id==='commercial').subcategories.find(x=>x.id==='quote').name,'Cotizar adicional')
 assert.equal((await store.query(user,state,{mode:'metadata'})).configVersion,metadata.configVersion)
 for(const [categoryId,subcategoryId,ending,priority] of [['commercial','quote','SOLICITUD DE COTIZACIÓN','Baja'],['administrative','billing','CONSULTA DE FACTURACIÓN','Media']]){
 let item=(await store.run(user,state,{commandId:crypto.randomUUID(),action:'create',scope:'customer',origin:'phone',customerId:'c1',categoryId,subcategoryId,automaticTitle:true,description:'Solicito una gestión para esta cuenta.',eventType:'',zone:'dato oculto'})).ticket
 assert.equal(item.title,'PIG-6029 MARTIN FRENCH - '+ending);assert.equal(item.priority,priority);assert.equal(item.areaId,'administration');assert.equal(item.zone,'');assert.deepEqual(item.serviceIds,[])
 item=(await store.run(user,state,{commandId:crypto.randomUUID(),action:'resolve',id:item.id,version:item.version,note:'Gestión finalizada y comunicada al cliente.',resolutionMethod:'phone'})).ticket
 assert.equal(item.status,'Resuelto');assert.equal(item.assigneeId,'admin');assert.deepEqual(item.serviceIds,[])
 }
 }finally{if(db)db.close();if(pg)await pg.close()}
})
