const account = value => String(value || '').trim().toUpperCase()
function validatePresenceReport(body, previous) {
 const report=body.report
 if (!report) return null // Older connectors may import, but cannot confirm absences.
 const accounts=report.accounts
 if(report.version!==1 || !Array.isArray(accounts) || !accounts.length || accounts.length>100000 || accounts.length!==body.count || accounts.some(a=>typeof a!=='string'||!/^PIG-\d+$/.test(a)) || new Set(accounts).size!==accounts.length) throw Object.assign(new Error('Reporte de cuentas inválido.'),{statusCode:400})
 if(previous?.accounts?.length && accounts.length<previous.accounts.length*0.9) throw Object.assign(new Error('Disminución de cuentas excesiva; requiere revisión.'),{statusCode:409})
 return {version:1,accounts}
}
function reconcilePresence(customers, report, previous, now) {
 const present=new Set(report.accounts), prior=new Set(previous?.accounts||[])
 return customers.map(customer=>{
  const code=account(customer.account)
  if(!/^PIG-\d+$/.test(code) || customer.kind==='client') return customer
  if(present.has(code)) {
   if(!customer.softguardPresence) return customer
   const next={...customer};delete next.softguardPresence;return next
  }
  const confirmed=Boolean(previous && !prior.has(code) && customer.softguardPresence)
  const status=confirmed?'inactive':'pending'
  if(customer.softguardPresence?.status==='inactive')return customer
  return {...customer,softguardPresence:{status,firstMissingAt:customer.softguardPresence?.firstMissingAt||now,...(confirmed?{confirmedAt:now}:{})}}
 })
}
function assertActiveService(before, after, customers) {
 if(!after || before && String(before.customerId||'')===String(after.customerId||'') && before.clientAccount===after.clientAccount) return
 const customer=(customers||[]).find(c=>after.customerId ? String(c.customerId)===String(after.customerId) : account(c.account)===account(after.clientAccount || String(after.client||'').split(' ')[0]))
 if(customer?.softguardPresence?.status==='inactive') throw Object.assign(new Error('La cuenta está dada de baja en SoftGuard. No se pueden crear nuevos servicios para ella.'),{statusCode:409})
}
function assertPresenceUnchanged(current, next) {
 const byId=new Map((current||[]).map(c=>[String(c.customerId),c]))
 for(const c of next||[]) if(JSON.stringify(c.softguardPresence||null)!==JSON.stringify(byId.get(String(c.customerId))?.softguardPresence||null)) throw Object.assign(new Error('El estado de SoftGuard sólo puede cambiar mediante la sincronización.'),{statusCode:409})
}
module.exports={validatePresenceReport,reconcilePresence,assertActiveService,assertPresenceUnchanged}
