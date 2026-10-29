const crypto=require('node:crypto')
const contracts=require('../../shared/registration/contracts.json')
const policy=require('./permission-catalog.cjs')
const access=require('./granular-read-policy.cjs')
const {relatedServices,formServicePatch}=require('./ticket-registration-form.cjs')
const {sqlParameters}=require('./ticket-mail-store.cjs')
const TABLE='pignus_registration_forms', RESPONSES='pignus_registration_responses'
const inboxStatusOrder={submitted:0,reviewed:1,open:2,correction:3,cancelled:4}
const secrets=['subscriberPassword','operatorPassword','cardNumber','cardHolder','cardExpiry','cardDni','cbu','bankHolder','bankDocumentType','bankDocument','bank']
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode})}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex')
function encryptionKey(env=process.env) {
  const secret=env.PIGNUS_REGISTRATION_ENCRYPTION_KEY||env.PIGNUS_SESSION_SECRET||''
  if(Buffer.byteLength(secret)<32)fail('Falta configurar la clave de cifrado de formularios en el servidor.',503)
  return Buffer.from(crypto.hkdfSync('sha256',secret,'pignus-registration-v1','answers-and-links',32))
}
function seal(value,context,env) {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(env),iv)
  cipher.setAAD(Buffer.from(context))
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
  return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})
}
function unseal(value,context,env) {
  try {const obj=JSON.parse(value),decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(env),Buffer.from(obj.iv,'base64'));decipher.setAAD(Buffer.from(context));decipher.setAuthTag(Buffer.from(obj.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(obj.data,'base64')),decipher.final()]).toString('utf8'))}
  catch {fail('No se pudo descifrar el formulario. Revisá la configuración del servidor.',503)}
}
const isInstallation=record=>[record?.service,record?.serviceType,...(record?.serviceTypes||[]).map(x=>x.name)].some(v=>/instalacion de alarmas?/.test(String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()))
const keyFor=record=>record.serviceJourney?.id?`journey:${record.serviceJourney.id}`:`service:${record.id}`
function recordsFor(form,state) {const anchor=(state.history||[]).find(r=>String(r.id)===form.service_id),journey=anchor?.serviceJourney?.id;return (state.history||[]).filter(r=>keyFor(r)===form.id || String(r.id)===form.service_id || journey&&r.serviceJourney?.id===journey)}
function currentRecord(form,state) {return recordsFor(form,state).filter(r=>r.status!=='Cancelado').sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time)))[0]}
function visible(form,state,user) {const record=currentRecord(form,state)||recordsFor(form,state)[0],customer=record&&access.customerForRecord(record,state);return Boolean(policy.can(user,'registration.read')&&record&&access.serviceInReadScope(record,user,state)&&(!customer||access.customerReadable(customer,user,state)))}
const ready=new WeakMap()
function createStore({sql,db,env=process.env}) {
  const connection=sql||db
  const query=(text,args=[])=>sql?sql.unsafe(sqlParameters(text),args):Promise.resolve(/^\s*SELECT|\bRETURNING\b/i.test(text)?db.prepare(text).all(...args):(db.prepare(text).run(...args),[]))
  async function ensure() {
    if(!ready.has(connection))ready.set(connection,(async()=>{
      await query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, kind TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_secret TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, reviewed_version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, events TEXT NOT NULL)`)
      await query(`CREATE TABLE IF NOT EXISTS ${RESPONSES} (form_id TEXT NOT NULL, version INTEGER NOT NULL, submitted_at TEXT NOT NULL, encrypted TEXT NOT NULL, terms_version TEXT NOT NULL, terms_hash TEXT NOT NULL, terms_text TEXT NOT NULL, PRIMARY KEY(form_id,version))`)
      await query('CREATE TABLE IF NOT EXISTS pignus_registration_limits (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, attempts INTEGER NOT NULL)')
      if(sql)for(const name of [TABLE,RESPONSES,'pignus_registration_limits']) {
        await query(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`)
        await query(`REVOKE ALL ON TABLE ${name} FROM PUBLIC`)
        await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${name} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${name} FROM authenticated; END IF; END $$`)
      }
    })().catch(error=>{ready.delete(connection);throw error}))
    return ready.get(connection)
  }
  const get=async id=>(await query(`SELECT * FROM ${TABLE} WHERE id=?`,[id]))[0]
  const response=async(row,version=row.version)=>{const result=(await query(`SELECT * FROM ${RESPONSES} WHERE form_id=? AND version=?`,[row.id,version]))[0];return result?{...result,values:unseal(result.encrypted,`${row.id}:${version}`,env)}:null}
  const list=()=>query(`SELECT * FROM ${TABLE} ORDER BY updated_at DESC`)
  async function create(record,kind,actor={},state) {
    const id=keyFor(record),existing=await get(id)||(state&&(await list()).find(row=>recordsFor(row,state).some(r=>String(r.id)===String(record.id))));if(existing)return existing
    if(!isInstallation(record)||!contracts.texts[kind])fail('Elegí una instalación de alarma y su formulario.')
    const token=crypto.randomBytes(32).toString('base64url'),now=new Date().toISOString()
    await query(`INSERT INTO ${TABLE} (id,service_id,kind,token_hash,token_secret,status,updated_at,events) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,[id,String(record.id),kind,hash(token),seal(token,`${id}:link`,env),'open',now,JSON.stringify([{at:now,action:'created',by:actor.name||actor.id||'Agenda'}])])
    return get(id)
  }
  async function rateLimit(ip) {
    const bucket=String(Math.floor(Date.now()/600000)),id=hash(String(ip||'unknown'))
    const [row]=await query('INSERT INTO pignus_registration_limits (id,bucket,attempts) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN pignus_registration_limits.bucket=excluded.bucket THEN pignus_registration_limits.attempts+1 ELSE 1 END,bucket=excluded.bucket RETURNING attempts',[id,bucket])
    if(row.attempts>80)fail('Demasiados intentos. Esperá unos minutos y volvé a intentar.',429)
    await query('DELETE FROM pignus_registration_limits WHERE bucket<?',[String(Number(bucket)-6)])
  }
  return {query,ensure,get,list,response,create,rateLimit,env}
}
async function autoCreate(previous,next,connection,kind) {
  // No historical backfill or new links on unrelated edits. Old services can
  // explicitly generate a link; migrated Google responses remain untouched.
  if(Buffer.byteLength(process.env.PIGNUS_REGISTRATION_ENCRYPTION_KEY||process.env.PIGNUS_SESSION_SECRET||'')<32)return
  const known=new Set((previous.history||[]).map(r=>String(r.id)))
  const added=(next.history||[]).filter(r=>!known.has(String(r.id))&&isInstallation(r)&&contracts.texts[r.installationZone]&&r.status!=='Cancelado')
  if(!added.length)return
  const store=createStore({[kind]:connection});await store.ensure()
  for(const record of added)await store.create(record,record.installationZone,{},next)
}
async function notices(connection,kind,state,user,transactionQuery) {
  if(!policy.can(user,'notifications.registration'))return []
  const store=createStore({[kind]:connection});await store.ensure()
  const rows=await store.list()
  const legacy=policy.can(user,'forms.view') ? require('./registration-inbox.cjs').legacyItems(state,user,await require('./tickets-http.cjs').storeFor(connection,kind).registrationInbox(transactionQuery,state,user),rows) : []
  return [...require('./registration-inbox.cjs').legacyNotices(legacy), ...rows.filter(row=>row.status==='submitted'&&(row.version>row.reviewed_version||currentRecord(row,state)?.subscriberReservation)&&currentRecord(row,state)&&visible(row,state,user)).map(row=>{
    const record=currentRecord(row,state)
    const pendingPig=row.reviewed_version>=row.version
    return {id:`registration:${row.id}:${row.version}`,title:pendingPig?'Formulario gestionado · vincular PIG':row.version>1?'Formulario corregido · revisar SoftGuard':'Formulario de alta recibido',detail:`${record.client||'Instalación'} · ${pendingPig?'Vinculá la cuenta creada en SoftGuard con la instalación.':'Revisá los datos para cargar en SoftGuard.'}`,tone:'info',source:'registration',recordIds:recordsFor(row,state).map(r=>String(r.id)),target:{type:'registration',id:row.id,recordId:String(record.id)}}
  })]
}
async function handle({connection,kind,user,method,input={},query={},publicRequest=false,ip='',formState}) {
  if(!['GET','POST'].includes(method)||publicRequest&&method!=='POST')fail('Método no permitido.',405)
  if(JSON.stringify(input).length>40000)fail('Formulario demasiado extenso.',413)
  const base=createStore({[kind]:connection});await base.ensure()
  if(publicRequest)await base.rateLimit(ip)
  else if(!policy.can(user,'registration.read'))fail('No tenés permiso para consultar formularios de alta.',403)
  const tickets=require('./tickets-http.cjs').storeFor(connection,kind)
  return tickets.transaction(async q=>{
    const state=await formState.load(q.connection)
    const store=createStore({[kind]:q.connection})
    if(publicRequest) {
      if(!/^[A-Za-z0-9_-]{43}$/.test(input.token||''))fail('Este enlace no está disponible. Solicitá uno nuevo a Pignus.',404)
      const [row]=await store.query(`SELECT * FROM ${TABLE} WHERE token_hash=?`,[hash(input.token)])
      if(!row)fail('Este enlace fue reemplazado o no está disponible. Solicitá el enlace vigente.',404)
      const record=currentRecord(row,state)
      if(!record||!isInstallation(record))fail('La instalación fue cancelada o ya no admite este formulario. Contactá a Pignus.',410)
      if(row.status==='submitted')return {submitted:true}
      if(input.action==='read') {
        const old=await store.response(row),prefill={...(old?.values||(record.salesBooking?{name:record.clientNameAtService||record.client,phone:record.phone,...(row.kind==='residencial'?{address:record.address}:{})}:{}))}
        for(const key of [...secrets,'termsAccepted','declarationAccepted'])delete prefill[key]
        return {kind:row.kind,version:row.version,termsVersion:contracts.version,terms:contracts.texts[row.kind],appointment:{date:record.date,time:record.time,awaitingConfirmation:record.awaitingConfirmation===true},reason:row.reason,prefill}
      }
      if(input.action!=='submit')fail('Acción inválida.')
      if(input.version!==row.version||input.termsVersion!==contracts.version)fail('El formulario cambió. Volvé a abrir el enlace antes de enviarlo.',409)
      const {validate}=await import('../../shared/registration/validate.mjs')
      const {values,errors}=validate(row.kind,input.values)
      if(Object.keys(errors).length)throw Object.assign(new Error('Revisá los campos indicados.'),{statusCode:400,fields:errors})
      const version=row.version+1,now=new Date().toISOString()
      await store.query(`INSERT INTO ${RESPONSES} (form_id,version,submitted_at,encrypted,terms_version,terms_hash,terms_text) VALUES (?,?,?,?,?,?,?)`,[row.id,version,now,seal(values,`${row.id}:${version}`),contracts.version,hash(contracts.texts[row.kind]),contracts.texts[row.kind]])
      await store.query(`UPDATE ${TABLE} SET version=?,status='submitted',updated_at=?,events=? WHERE id=?`,[version,now,JSON.stringify([...JSON.parse(row.events),{at:now,action:'submitted',version}]),row.id])
      const {next}=formServicePatch(state,record,values.email)
      await formState.save(q.connection,state,next,{action:'Formulario recibido',id:row.id,version})
      await require('./installation-experience-store.cjs').createExperienceStore({[kind]:q.connection}).enqueue(state,next)
      return {submitted:true}
    }
    if(method==='GET'&&query.notices==='1')return {items:await notices(q.connection,kind,state,user,q)}
    if(method==='GET'&&!query.id&&!query.serviceId&&!query.customerId&&!query.legacyId&&query.list!=='1')fail('Seleccioná un servicio o una cuenta.')
    let rows=(await store.list()).filter(row=>visible(row,state,user))
    if(method==='GET'&&(query.list==='1'||query.legacyId)) {
      if(!policy.can(user,'forms.view'))fail('No tenés permiso para consultar la bandeja de formularios.',403)
      // The inbox never decrypts answers or exposes public link tokens.
      const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      const search=normalize(String(query.search||'').trim().slice(0,160))
      const legacy=require('./registration-inbox.cjs').legacyItems(state,user,await tickets.registrationInbox(q,state,user),await store.list())
      if(query.legacyId) {
        const item=legacy.find(item=>item.id===query.legacyId)
        if(!item)fail('El formulario no está disponible dentro de tu alcance. Actualizá la bandeja.',404)
        return {item}
      }
      const items=[...legacy,...rows.map(row=>{
        const active=currentRecord(row,state),record=active||recordsFor(row,state)[0]
        const customer=access.customerForRecord(record,state)
        return {id:row.id,source:'native',kind:row.kind,client:record.client||record.clientNameAtService||'Instalación',account:customer?.account||record.account||'',serviceId:String(record.id),date:record.date,time:record.time,updatedAt:row.updated_at,version:row.version,pendingPig:Boolean(record.subscriberReservation),status:!active?'cancelled':row.status==='submitted'&&row.reviewed_version>=row.version&&!record.subscriberReservation?'reviewed':row.status}
      })].filter(item=>(!query.kind||item.kind===query.kind)&&(!search||normalize([item.client,item.account,item.date,item.email,...(item.tickets||[]).map(t=>t.number)].join(' ')).includes(search))).sort((a,b)=>(inboxStatusOrder[a.status]??5)-(inboxStatusOrder[b.status]??5)||String(b.updatedAt).localeCompare(String(a.updatedAt))||a.id.localeCompare(b.id))
      const counts=Object.fromEntries(['open','submitted','correction','reviewed','cancelled'].map(status=>[status,items.filter(item=>item.status===status).length]))
      const filtered=items.filter(item=>!query.status||item.status===query.status)
      const total=filtered.length,pageSize=20,pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(pages,Math.max(1,Math.floor(Number(query.page)||1)))
      return {items:filtered.slice((page-1)*pageSize,page*pageSize),counts,total,page,pages,pageSize}
    }
    if(query.customerId)rows=rows.filter(row=>recordsFor(row,state).some(r=>String(access.customerForRecord(r,state)?.customerId)===String(query.customerId)))
    if(query.serviceId)rows=rows.filter(row=>recordsFor(row,state).some(r=>String(r.id)===String(query.serviceId)))
    if(query.id)rows=rows.filter(row=>row.id===query.id)
    if(method==='POST') {
      if(!policy.can(user,'registration.manage')&&input.action!=='reveal')fail('No tenés permiso para gestionar formularios.',403)
      if(input.action==='create') {
        const record=(state.history||[]).find(r=>String(r.id)===String(input.serviceId))
        if(!record||!access.serviceWritable(record,user,state)||!visible({id:keyFor(record),service_id:String(record.id)},state,user)||record.status==='Cancelado')fail('No se encontró la instalación autorizada.',404)
        const row=await store.create(record,contracts.texts[record.installationZone]?record.installationZone:input.kind,user,state)
        rows=[row]
      } else {
        const row=await store.get(input.id)
        if(!row||!visible(row,state,user))fail('No se encontró el formulario autorizado.',404)
        const record=currentRecord(row,state)
        if(!record||input.action!=='reveal'&&!access.serviceWritable(record,user,state))fail('No se puede gestionar esta instalación.',403)
        if(row.updated_at!==input.updatedAt)fail('Otra persona actualizó el formulario. Actualizá antes de continuar.',409)
        const now=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString(),events=JSON.parse(row.events),by=user.name||user.email||String(user.id)
        if(input.action==='reveal') {
          if(!policy.can(user,'registration.sensitive')||!policy.can(user,'records.financial'))fail('No tenés permiso para revelar datos protegidos.',403)
          const revision=Number(input.version||row.version)
          if(!Number.isInteger(revision)||revision<1||revision>row.version)fail('Revisión inválida.')
          const answer=await store.response(row,revision)
          await store.query(`UPDATE ${TABLE} SET events=? WHERE id=?`,[JSON.stringify([...events,{at:now,action:'revealed',by,version:revision}]),row.id])
          return {values:answer?.values||{}}
        }
        if(input.action==='correct') {
          const reason=String(input.reason||'').trim()
          if(row.status!=='submitted'||!reason||reason.length>600)fail('Indicá qué debe corregir el cliente (hasta 600 caracteres).')
          const token=crypto.randomBytes(32).toString('base64url')
          await store.query(`UPDATE ${TABLE} SET status='correction',reason=?,token_hash=?,token_secret=?,updated_at=?,events=? WHERE id=?`,[reason,hash(token),seal(token,`${row.id}:link`),now,JSON.stringify([...events,{at:now,action:'correction',by,version:row.version}]),row.id])
          const {next}=formServicePatch(state,record,record.formEmail||'','Pendiente')
          await formState.save(q.connection,state,next,{action:'Solicitó corrección de formulario',id:row.id,version:row.version})
        } else if(input.action==='review') {
          if(row.status!=='submitted'||input.verified!==true)fail('Confirmá que los datos se cargaron o actualizaron en SoftGuard.')
          await store.query(`UPDATE ${TABLE} SET reviewed_version=version,updated_at=?,events=? WHERE id=?`,[now,JSON.stringify([...events,{at:now,action:'reviewed',by,version:row.version}]),row.id])
        } else fail('Acción inválida.')
        rows=[await store.get(row.id)]
      }
    }
    return {items:await Promise.all(rows.map(async row=>{
      const record=currentRecord(row,state)||recordsFor(row,state)[0],revisions=[]
      let previous={}
      for(let version=1;version<=row.version;version++) {
        const answer=await store.response(row,version),values={...answer.values}
        const changed=version===1?[]:Object.keys(values).filter(key=>values[key]!==previous[key])
        previous=answer.values
        for(const key of secrets)if(values[key])values[key]=['cardNumber','cbu'].includes(key)?`•••• ${values[key].slice(-4)}`:'••••'
        if(!policy.can(user,'records.financial'))for(const key of ['monthlyFee','paymentMethod',...secrets.slice(2)])delete values[key]
        revisions.push({version,at:answer.submitted_at,termsVersion:answer.terms_version,values,changed})
      }
      return {id:row.id,kind:row.kind,version:row.version,reviewedVersion:row.reviewed_version,status:currentRecord(row,state)?row.status:'cancelled',updatedAt:row.updated_at,client:record?.client,serviceId:record?.id,reason:row.reason,revisions,events:JSON.parse(row.events),link:row.status!=='submitted'&&currentRecord(row,state)&&policy.can(user,'registration.manage')?`/alta#${unseal(row.token_secret,`${row.id}:link`)}`:''}
    }))}
  })
}
module.exports={createStore,handle,autoCreate,notices,isInstallation,keyFor,visible,seal,unseal}
