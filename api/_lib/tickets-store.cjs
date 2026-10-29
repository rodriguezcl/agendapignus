const registration = require('./ticket-registration-form.cjs')
const { initializeBusinessDefaults } = require('./ticket-business-defaults.cjs')
const crypto = require('node:crypto')
const d = require('./tickets.cjs')
const policy = require('./permission-catalog.cjs')
const read = require('./granular-read-policy.cjs')
const { validateAttachments } = require('./tickets-attachments.cjs')
const { MAIL_SCHEMA, sqlParameters } = require('./ticket-mail-store.cjs')
const sla = require('./ticket-sla.cjs')
const communications = require('./ticket-communications.cjs')
const { RESOLUTION_METHODS, resolutionMethod } = require('./ticket-resolution.cjs')
const { requesterIds, mergeRequesterIds, sourceTicketIds, backfillMergedRequesters } = require('./ticket-requesters.cjs')
const serviceSuggestions = require('./ticket-service-suggestion.cjs')
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS pignus_ticket_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pignus_tickets (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT, status TEXT NOT NULL, area_id TEXT, assignee_id TEXT, created_by_id TEXT, requester_id TEXT, legacy_id TEXT UNIQUE, updated_at TEXT NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pignus_tickets_customer ON pignus_tickets (customer_id,status)',
  'CREATE INDEX IF NOT EXISTS pignus_tickets_status ON pignus_tickets (status,updated_at)',
  'CREATE TABLE IF NOT EXISTS pignus_ticket_entries (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), at TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS pignus_ticket_entries_ticket ON pignus_ticket_entries (ticket_id,at)',
  'CREATE TABLE IF NOT EXISTS pignus_ticket_commands (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL, ticket_id TEXT, result TEXT)',
  'CREATE TABLE IF NOT EXISTS pignus_ticket_aliases (number TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id))',
  'CREATE TABLE IF NOT EXISTS pignus_ticket_service_requests (legacy_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id))',
  'CREATE TABLE IF NOT EXISTS pignus_ticket_mail_ids (message_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pignus_tickets(id), sender TEXT NOT NULL)',
  ...MAIL_SCHEMA,
  ...communications.NOTIFICATION_SCHEMA
]
const parse = row => row ? JSON.parse(row.data) : null
const commandFingerprint = input => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
const safeNum = value => Math.max(1, Math.min(100, Math.floor(Number(value) || 1)))
const mailNamespace = message => String(message.mailboxKey || message.mailbox_key || `mode:${message.mode || 'test'}`)
const mailIdentifier = (namespace, messageId) => `${namespace}\u001f${messageId}`
function sameMailContext(ticket, namespace, mode) {
  if (!ticket || ticket.mailMode && ticket.mailMode !== mode) return false
  if (ticket.mailboxKey) return ticket.mailboxKey === namespace
  // Las conversaciones manuales pueden recibir correo real, nunca tráfico de prueba.
  return !ticket.mailMode && mode === 'live'
}
function createTicketStore({ sql, db }) {
  const pg = Boolean(sql)
  let readiness, businessDefaultsReady, serviceDefaultsReady, queue = Promise.resolve()
  const executor = connection => Object.assign(async (query, args = []) => {
    if (pg) return connection.unsafe(sqlParameters(query), args)
    const stmt = connection.prepare(query)
    if (/^\s*SELECT|\bRETURNING\b/i.test(query)) return stmt.all(...args)
    stmt.run(...args); return []
  }, { connection })
  const execute = executor(sql || db)
  const serialized = fn => {
    if (pg) return fn()
    const next = queue.then(fn, fn); queue = next.catch(() => {}); return next
  }
  async function ensure() {
    if (!readiness) readiness = serialized(async () => {
      for (const statement of SCHEMA) await execute(statement)
      if (pg) for (const table of SCHEMA.filter(statement => statement.startsWith('CREATE TABLE')).map(statement => statement.split(' ')[5])) {
        await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
        await sql.unsafe(`REVOKE ALL ON TABLE ${table} FROM PUBLIC`)
        await sql.unsafe(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${table} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${table} FROM authenticated; END IF; END $$`)
      }
      await execute('INSERT INTO pignus_ticket_settings (id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING', ['config', JSON.stringify({ version: 1, nextNumber: 1000001, config: d.defaultConfig() })])
      // Conserva a los solicitantes originales de fusiones anteriores sin usar
      // la lista de participantes, que también contiene comentarios de terceros.
      const requesterMigration = 'ticket-requesters-v1'
      if (!(await execute('SELECT id FROM pignus_ticket_settings WHERE id=?', [requesterMigration])).length) {
        const migrate = async q => {
          if ((await q('SELECT id FROM pignus_ticket_settings WHERE id=?', [requesterMigration])).length) return
          await backfillMergedRequesters(q, { pg })
          await q('INSERT INTO pignus_ticket_settings (id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING', [requesterMigration, '{"complete":true}'])
        }
        if (pg) await sql.begin(async tx => {
          await tx`set local lock_timeout = '5s'`
          const q = executor(tx)
          await q('SELECT pg_advisory_xact_lock(hashtext(?))', [requesterMigration])
          await migrate(q)
        })
        else {
          db.exec('BEGIN IMMEDIATE')
          try { await migrate(execute); db.exec('COMMIT') }
          catch (error) { db.exec('ROLLBACK'); throw error }
        }
      }
    }).catch(error => { readiness = null; throw error })
    return readiness
  }
  async function transaction(fn) {
    await ensure()
    if (pg) return sql.begin(async tx => { await tx`set local lock_timeout = '5s'`; return fn(executor(tx)) })
    return serialized(async () => { db.exec('BEGIN IMMEDIATE'); try { const result = await fn(execute); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error } })
  }
  async function settings(q = execute, locked = false) {
    const value=parse((await q(`SELECT data FROM pignus_ticket_settings WHERE id=?${pg && locked ? ' FOR UPDATE' : ''}`, ['config']))[0])
    if(value) value.config.sla={...sla.validateSlaConfig(value.config.sla||sla.defaultSlaConfig()),calendar:await require('./ticket-business-clock.cjs').readCalendar(q,pg)}
    return value
  }
  async function ensureServiceDefaults(state) {
    // Se necesita el catálogo completo, no una proyección sin tipos de servicio.
    if (!Array.isArray(state.services)) return
    if (!serviceDefaultsReady) serviceDefaultsReady = (async () => {
      const migration = 'ticket-service-defaults-v1'
      if ((await execute('SELECT id FROM pignus_ticket_settings WHERE id=?', [migration])).length) return
      await transaction(async q => {
        const configuration = await settings(q, true)
        if ((await q('SELECT id FROM pignus_ticket_settings WHERE id=?', [migration])).length) return
        const next = serviceSuggestions.initializeServiceDefaults(configuration.config, state, d.defaultConfig())
        if (JSON.stringify(next) !== JSON.stringify(configuration.config)) {
          configuration.config = next
          configuration.version++
          await q('UPDATE pignus_ticket_settings SET data=? WHERE id=?', [JSON.stringify(configuration), 'config'])
        }
        await q('INSERT INTO pignus_ticket_settings (id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING', [migration, '{"complete":true}'])
      })
    })().catch(error => { serviceDefaultsReady = null; throw error })
    return serviceDefaultsReady
  }
  async function ensureBusinessDefaults() {
    if (!businessDefaultsReady) businessDefaultsReady = (async () => {
      const migration = 'ticket-business-defaults-v1'
      if ((await execute('SELECT id FROM pignus_ticket_settings WHERE id=?', [migration])).length) return
      await transaction(async q => {
        const configuration = await settings(q, true)
        if ((await q('SELECT id FROM pignus_ticket_settings WHERE id=?', [migration])).length) return
        const next = initializeBusinessDefaults(configuration.config, d.defaultConfig())
        if (JSON.stringify(next) !== JSON.stringify(configuration.config)) {
          configuration.config = next
          configuration.version++
          await q('UPDATE pignus_ticket_settings SET data=? WHERE id=?', [JSON.stringify(configuration), 'config'])
        }
        await q('INSERT INTO pignus_ticket_settings (id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING', [migration, '{"complete":true}'])
      })
    })().catch(error => { businessDefaultsReady = null; throw error })
    return businessDefaultsReady
  }
  async function ticket(q, id, locked = false) { return parse((await q(`SELECT data FROM pignus_tickets WHERE id=? OR number=?${pg && locked ? ' FOR UPDATE' : ''}`, [String(id || ''), String(id || '').replace(/^Ticket#/i, '')]))[0]) }
  async function principal(q, item, locked = false) {
    const seen = new Set()
    while (item?.status === 'Fusionado') {
      if (!item.mergedIntoId || seen.has(item.id)) d.fail('La referencia del ticket fusionado no es válida.',409)
      seen.add(item.id)
      item = await ticket(q,item.mergedIntoId,locked)
    }
    return item
  }
  async function entries(q, id) { return (await q('SELECT data FROM pignus_ticket_entries WHERE ticket_id=? ORDER BY at,id', [id])).map(parse) }
  async function save(q, item) {
    await q('INSERT INTO pignus_tickets (id,number,customer_id,status,area_id,assignee_id,created_by_id,requester_id,legacy_id,updated_at,search_text,data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,status=excluded.status,area_id=excluded.area_id,assignee_id=excluded.assignee_id,updated_at=excluded.updated_at,search_text=excluded.search_text,data=excluded.data', [item.id,item.number,item.customerId || '',item.status,item.areaId || '',item.assigneeId || '',item.createdById || '',item.requesterId || '',item.legacyId || null,item.updatedAt,d.normalized(`${item.number} ${item.title} ${item.description} ${item.customerSnapshot?.account||''} ${item.customerSnapshot?.name||''} ${item.requesterName}`),JSON.stringify(item)])
  }
  async function addEntry(q, item) { await q('INSERT INTO pignus_ticket_entries (id,ticket_id,at,data) VALUES (?,?,?,?)', [item.id,item.ticketId,item.at,JSON.stringify(item)]) }
  async function rememberEscalationRecipients(q,state) {
    if (!Array.isArray(state.employees) || !Array.isArray(state.roles)) return
    const recipientIds=state.employees.filter(employee=>!['inactivo','baja'].includes(d.normalized(employee.status))).filter(employee=>{
      const person=d.subject(employee,state)
      return d.can(person,'view')&&d.can(person,'scope.all')&&policy.can(person,'notifications.tickets')&&(d.can(person,'configure')||d.can(person,'assign'))
    }).map(employee=>String(employee.id)).sort()
    await q('INSERT INTO pignus_ticket_settings (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',['escalation-recipients',JSON.stringify({recipientIds})])
  }
  async function communicate(q, item, type, eventKey, now, context = {}, actor, inbound) {
    if(!item.registrationForm) item.registrationForm=registration.detectRegistrationForm(item.title,item.description)
    const reminder = ['sla-overdue','response-overdue','no-update'].includes(type)
    let mailRuntime
    // A broken mail configuration must not discard an agenda change or a report.
    if (!reminder) try { mailRuntime = await require('./ticket-mail-channel.cjs').createMailChannelStore({ query:q }).runtime() } catch { /* platform notice remains durable */ }
    if (type === 'received' && item.customerEmailNotifications && !item.mailboxKey && mailRuntime?.mailboxKey) {
      item.mailboxKey = mailRuntime.mailboxKey
      item.mailMode = mailRuntime.mode
      await save(q, item)
    }
    const area = (await settings(q)).config.areas.find(area => area.id === item.areaId)
    const fallback=reminder?parse((await q('SELECT data FROM pignus_ticket_settings WHERE id=?',['escalation-recipients']))[0])?.recipientIds:[]
    const recipients = reminder ? (item.assigneeId ? [item.assigneeId] : area?.memberIds?.length ? area.memberIds : fallback?.length ? fallback : [item.createdById]) : requesterIds(item)
    const key=reminder?`${eventKey}:${recipients.map(String).sort().join(',')}`:eventKey
    return communications.communicateTicket({ q, ticket:item, type, eventKey:key, now, actorId:actor?.id, recipients, context, mailRuntime, entries:reminder?[]:await entries(q,item.id), inbound })
  }
  async function syncServices(previous, next, { user, now = new Date().toISOString(), reportRecordId, connection } = {}) {
    const operation = q => require('./ticket-service-lifecycle.cjs').synchronizeTicketServices({ q, pg, previous, next, user, now, reportRecordId, store:{ settings,ticket,principal,save,communicate } })
    // Caller has already initialized the schema before starting its state write.
    if (connection) return operation(executor(connection))
    return transaction(operation)
  }
  async function processSla(now = new Date().toISOString()) {
    return transaction(async q => {
      const config = (await settings(q)).config
      const lastCheck=pg?"COALESCE(data::jsonb #>> '{sla,lastCheckedAt}','')":"COALESCE(json_extract(data,'$.sla.lastCheckedAt'),'')"
      const rows = await q("SELECT data FROM pignus_tickets WHERE status IN ('Nuevo','En gestión','En espera') ORDER BY "+lastCheck+",id LIMIT 100"+(pg?' FOR UPDATE SKIP LOCKED':''))
      let adopted = 0, reminders = 0
      for (const row of rows) {
        const item = parse(row)
        if (!item.sla) adopted++
        sla.initSla(item,config,now)
        if(item.sla.clockMigration&&!item.sla.clockMigration.notificationsRetiredAt) {
          // Older notices have eventLabel but no machine-readable type.
          const label=pg?"data::jsonb->>'eventLabel'":"json_extract(data,'$.eventLabel')"
          await q("UPDATE pignus_ticket_notifications SET read_at=? WHERE ticket_id=? AND read_at IS NULL AND "+label+" IN ('Plazo de resolución vencido','Primera respuesta pendiente','Actualización del caso pendiente')",[now,item.id])
          item.sla.clockMigration.notificationsRetiredAt=now
        }
        item.sla.lastCheckedAt=now
        await save(q,item)
        for (const due of sla.dueReminders(item,now)) {
          const type = due.type === 'resolution' ? 'sla-overdue' : due.type === 'first-response' ? 'response-overdue' : 'no-update'
          const result = await communicate(q,item,type,`sla:${due.key}`,now,{ dueAt:due.dueAt })
          if (result.created) reminders++
        }
      }
      return { adopted, reminders }
    })
  }
  async function nextNumber(q, configuration) {
    const number = configuration.nextNumber++
    if (!Number.isSafeInteger(number)) d.fail('Se agotó el rango de numeración.',409)
    await q('UPDATE pignus_ticket_settings SET data=? WHERE id=?', [JSON.stringify(configuration),'config'])
    return String(number).padStart(5,'0')
  }
  async function detailed(q, item, user, state = {}, config) {
    const aliases = (await q('SELECT number FROM pignus_ticket_aliases WHERE ticket_id=? ORDER BY number',[item.id])).map(row=>row.number)
    return { ...d.present(item,user,await entries(q,item.id),aliases,true,config || (await settings(q)).config), registrationForm: policy.can(user,'planning.commercial') && policy.can(user,'records.contact') ? item.registrationForm || registration.detectRegistrationForm(item.title,item.description) : undefined, suggestedServiceId: registration.detectRegistrationForm(item.title,item.description) ? registration.installationSuggestion(state) : serviceSuggestions.suggestedServiceId(item, config || (await settings(q)).config, state) }
  }
  async function customerLock(q, customerId) { if (pg && customerId) await q('SELECT pg_advisory_xact_lock(hashtext(?))',[`ticket-customer:${customerId}`]) }
  async function duplicates(q, customerId, user, state, config, locked=false) {
    const items = (await q(`SELECT data FROM pignus_tickets WHERE customer_id=? AND status IN ('Nuevo','En gestión','En espera') ORDER BY id${pg&&locked?' FOR UPDATE':''}`,[String(customerId)])).map(parse)
    return { candidates:items.map(t=>d.duplicatePreview(t)),duplicateToken:d.duplicatesToken(customerId,items) }
  }
  async function query(user,state,params={}) {
    await ensure()
    await ensureBusinessDefaults()
    await ensureServiceDefaults(state)
    return serialized(async()=>{
      await rememberEscalationRecipients(execute,state)
      const configuration = await settings(), config = { ...configuration.config, sla: configuration.config.sla || sla.defaultSlaConfig() }, mode=params.mode || 'list'
      if (mode==='metadata') {
        if (!d.can(user,'view')&&!d.can(user,'configure')) d.fail('No tenés acceso a Tickets.',403)
        let mail={enabled:false,outboundEnabled:false,signatureEnabled:false,mode:'test'}
        try { const m=await require('./ticket-mail-channel.cjs').createMailChannelStore({sql,db}).runtime(); mail={enabled:m.enabled,outboundEnabled:m.enabled&&m.mode==='live',signatureEnabled:m.signature?.enabled===true,mode:m.mode}; if(d.can(user,'configure')) mail={...mail,...await (pg?require('./ticket-mail-store.cjs').postgresTicketMailStore(sql):require('./ticket-mail-store.cjs').sqliteTicketMailStore(db)).status(m.mailboxKey)} } catch { mail.error='Falta completar la configuración del correo.' }
        return { config:{...config,mail},configVersion:configuration.version,numberingLocked:(await execute('SELECT id FROM pignus_tickets LIMIT 1')).length>0,assignees:d.assignees(state,null,config),services:serviceSuggestions.serviceOptions(state),employees:d.can(user,'configure')?(state.employees||[]).map(e=>({id:String(e.id),name:e.name||`${e.firstName||''} ${e.lastName||''}`})):[],permissions:policy.resolvePermissions(user) }
      }
      if(!d.can(user,'view')) d.fail('No tenés permiso para consultar tickets.',403)
      if(mode==='customers') {
        if(!d.can(user,'create')&&!d.can(user,'fromService')&&!d.can(user,'classify')) d.fail('No tenés permiso para buscar cuentas para tickets.',403)
        const needle=d.normalized(params.search)
        return {items:needle.length<2?[]:(state.customers||[]).filter(c=>c.softguardPresence?.status!=='inactive'&&d.intakeCustomerReadable(c,user,state)&&d.normalized(`${c.account} ${c.name} ${policy.can(user,'records.contact')?c.phone||'':''}`).includes(needle)).slice(0,20).map(c=>d.snapshot(c,user))}
      }
      if(mode==='formServices'){
        if(!d.can(user,'linkService')||!policy.can(user,'planning.commercial')||!policy.can(user,'records.contact'))d.fail('No tenés permiso para aplicar formularios.',403)
        const needle=d.normalized(params.search), seen=new Set()
        const items=(state.history||[]).filter(r=>registration.installation(r,state)&&registration.relatedServices(state,r).every(visit=>read.serviceWritable(visit,user,state))&&(!params.customerId||String(read.customerForRecord(r,state)?.customerId||r.customerId)===String(params.customerId)))
          .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time)))
          .filter(r=>{const key=r.serviceJourney?.id||r.id;if(seen.has(key))return false;seen.add(key);return true})
          .map(r=>({id:String(r.id),label:[r.client||r.clientAccount,r.date,r.time,r.service].filter(Boolean).join(' · '),customerId:String(read.customerForRecord(r,state)?.customerId||r.customerId||''),reservation:Boolean(r.subscriberReservation),date:r.date,time:r.time,form:r.form||'',formEmail:r.formEmail||'',existingFormEmails:[...new Set(registration.relatedServices(state,r).map(visit=>visit.formEmail).filter(Boolean))],snapshot:registration.serviceSnapshot(state,r)}))
          .filter(r=>(!params.serviceId||registration.relatedServices(state,state.history.find(record=>String(record.id)===r.id)).some(visit=>String(visit.id)===String(params.serviceId)))&&(!needle||d.normalized(r.label).includes(needle)))
        return {items:items.slice(0,50),total:items.length}
      }
      if(mode==='services'){if(!d.can(user,'linkService'))d.fail('No tenés permiso para vincular servicios.',403);return {items:(state.history||[]).filter(r=>read.serviceReadable(r,user,state)&&(!params.customerId||String(read.customerForRecord(r,state)?.customerId||r.customerId)===String(params.customerId))).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,100).map(r=>({id:String(r.id),date:r.date,label:`${r.date||''} · ${r.client||r.clientAccount||''} · ${r.service||r.serviceType||r.detail||'Servicio'}`}))}}
      if(mode==='duplicates') { const customer=d.duplicateCustomer(params,user,state,{allowNoCustomer:true});const customerId=String(customer?.customerId||customer?.id||''); return customerId?{...await duplicates(execute,customerId,user,state,config),customerId}:{customerId:'',candidates:[],duplicateToken:''} }
      if(mode==='duplicateDetail') { const item=await ticket(execute,params.id);d.assertDuplicate(item,params,user,state);return {ticket:d.duplicatePreview(item,await entries(execute,item.id))} }
      if(mode==='detail') { let item=await ticket(execute,params.id);if(!item){const alias=(await execute('SELECT ticket_id FROM pignus_ticket_aliases WHERE number=?',[String(params.id||'').replace(/^Ticket#/i,'')]))[0];if(alias)item=await ticket(execute,alias.ticket_id)}item=await principal(execute,item);d.assertVisible(item,user,state,config);return {ticket:await detailed(execute,item,user,state,config)} }
      const field=key=>pg?`(data::jsonb ->> '${key}')`:`json_extract(data,'$.${key}')`
      let where=[],args=[]
      if(d.personalScope(user)) {
        const uid=String(user.id),parts=['created_by_id=?','requester_id=?'];args.push(uid,uid)
        parts.push(pg?"(data::jsonb -> 'mergedRequesterIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.mergedRequesterIds') WHERE value=?)");args.push(pg?JSON.stringify([uid]):uid)
        parts.push(pg?"(data::jsonb -> 'coRequesterIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.coRequesterIds') WHERE value=?)");args.push(pg?JSON.stringify([uid]):uid)
        if(d.can(user,'scope.assigned')){parts.push('assignee_id=?');args.push(uid)}
        const assigned=d.assignedTicketIds(user,state)
        if(assigned.length){
          const placeholders=assigned.map(()=>'?').join(',')
          parts.push('id IN ('+placeholders+')');args.push(...assigned)
          parts.push(pg?"EXISTS (SELECT 1 FROM jsonb_array_elements_text(data::jsonb -> 'mergedTicketIds') linked(value) WHERE linked.value IN ("+placeholders+"))":"EXISTS (SELECT 1 FROM json_each(data,'$.mergedTicketIds') WHERE value IN ("+placeholders+"))");args.push(...assigned)
        }
        where.push('('+parts.join(' OR ')+')')
      } else if(!d.can(user,'scope.all')) {
        const uid=String(user.id),parts=['created_by_id=?','requester_id=?'];args.push(uid,uid);if(d.can(user,'scope.assigned')){parts.push('assignee_id=?');args.push(uid)}
        parts.push(pg?"(data::jsonb -> 'participantIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.participantIds') WHERE value=?)");args.push(pg?JSON.stringify([uid]):uid)
        const areas=d.can(user,'scope.area')?config.areas.filter(a=>a.memberIds.includes(uid)).map(a=>a.id):[]
        if(areas.length){parts.push('area_id IN ('+areas.map(()=>'?').join(',')+')');args.push(...areas)}
        const legacy=policy.can(user,'followups.view')?(state.history||[]).filter(r=>r.followup&&read.serviceInReadScope(r,user,state)).map(r=>String(r.followup.id||'followup:'+r.id)):[]
        if(legacy.length){parts.push('legacy_id IN ('+legacy.map(()=>'?').join(',')+')');args.push(...legacy)}
        const assigned=d.can(user,'fromService')?(state.history||[]).filter(r=>r.technicianIds?.some(value=>String(value)===uid)&&read.serviceReadable(r,user,state)).map(r=>String(r.id)):[]
        if(assigned.length){parts.push(pg?"EXISTS (SELECT 1 FROM jsonb_array_elements_text(data::jsonb -> 'serviceIds') linked(value) WHERE linked.value IN ("+assigned.map(()=>'?').join(',')+"))":"EXISTS (SELECT 1 FROM json_each(data,'$.serviceIds') WHERE value IN ("+assigned.map(()=>'?').join(',')+"))");args.push(...assigned)}
        where.push('('+parts.join(' OR ')+')')
      }
      if(params.customerId){where.push('customer_id=?');args.push(String(params.customerId))}
      if(params.assigneeId){where.push('assignee_id=?');args.push(params.assigneeId==='unassigned'?'':params.assigneeId==='me'?String(user.id):String(params.assigneeId))}
      if(params.serviceId){where.push(pg?"(data::jsonb -> 'serviceIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.serviceIds') WHERE value=?)");args.push(pg?JSON.stringify([String(params.serviceId)]):String(params.serviceId))}
      for(const key of ['origin','priority','categoryId','areaId'])if(params[key]){where.push(field(key)+'=?');args.push(params[key]==='technician'?'technical':params[key])}
      if(params.scope==='mine'){
        const merged=pg?"(data::jsonb -> 'mergedRequesterIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.mergedRequesterIds') WHERE value=?)"
        const shared=pg?"(data::jsonb -> 'coRequesterIds') @> ?::jsonb":"EXISTS (SELECT 1 FROM json_each(data,'$.coRequesterIds') WHERE value=?)"
        where.push('(created_by_id=? OR requester_id=? OR '+merged+' OR '+shared+')');args.push(String(user.id),String(user.id),pg?JSON.stringify([String(user.id)]):String(user.id),pg?JSON.stringify([String(user.id)]):String(user.id))
      }
      if(params.scope==='assigned'){where.push('assignee_id=?');args.push(String(user.id))}
      if(params.scope==='unassigned')where.push("assignee_id=''")
      const needle=d.normalized(params.search).replace(/^ticket#/,'')
      if(needle){where.push(pg?'strpos(search_text,?)>0':'instr(search_text,?)>0');args.push(needle)}
      const clause=()=>where.length?' WHERE '+where.join(' AND '):''
      const counts=Object.fromEntries(d.STATUSES.map(status=>[status,0]))
      for(const row of await execute('SELECT status,COUNT(*) AS count FROM pignus_tickets'+clause()+' GROUP BY status',args))counts[row.status]=Number(row.count)
      if(mode==='notifications'){
        if(!policy.can(user,'notifications.tickets'))return {notifications:[]}
        const notices=[]
        for(const notice of await communications.readNotifications(execute,user.id)) { const item=await principal(execute,await ticket(execute,notice.target.ticketId)); if(item&&!registration.applied(item)&&d.visible(item,user,state,config))notices.push({...notice,title:communications.notificationTitle(item,notice.eventLabel||notice.title.replace(/^Ticket#\d+\s*·\s*/,''),state,policy.can(user,'records.contact')),target:{...notice.target,ticketId:item.id}}) }
        where.push("status IN ('Nuevo','En gestión','En espera')")
        const items=(await execute('SELECT data FROM pignus_tickets'+clause()+' ORDER BY CASE '+field('priority')+" WHEN 'Crítica' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Media' THEN 2 ELSE 3 END,updated_at DESC LIMIT 50",args)).map(parse)
        const noticed=new Set(notices.map(n=>n.target.ticketId))
        return {notifications:[...notices,...items.filter(t=>!noticed.has(t.id)).map(t=>({id:'ticket:'+t.id,title:communications.notificationTitle(t,(t.priority==='Crítica'?'Crítico · ':'')+t.status,state,policy.can(user,'records.contact')),detail:registration.registrationFormTitle(t,policy.can(user,'records.contact'))+' · '+(t.assigneeName||'Sin asignar'),tone:t.priority==='Crítica'?'danger':'warning',target:{type:'ticket',ticketId:t.id}}))]}
      }
      if(params.status){if(params.status==='open')where.push("status IN ('Nuevo','En gestión','En espera')");else{where.push('status=?');args.push(params.status)}}
      const total=Number((await execute('SELECT COUNT(*) AS count FROM pignus_tickets'+clause(),args))[0].count)
      const page=Math.max(1,Math.floor(Number(params.page)||1)),pageSize=Math.min(50,safeNum(params.pageSize||20))
      const items=(await execute('SELECT data FROM pignus_tickets'+clause()+' ORDER BY CASE '+field('priority')+" WHEN 'Crítica' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Media' THEN 2 ELSE 3 END,updated_at DESC,id LIMIT ? OFFSET ?",[...args,pageSize,(page-1)*pageSize])).map(parse)
      return {items:items.map(t=>d.present(t,user,[],[],false,config)),total,page,pageSize,counts}
    })
  }
  async function run(user,state,input, formState) {
    if(input.action==='markNotificationsRead') {
      if(!d.can(user,'view'))d.fail('No tenés acceso a Tickets.',403)
      return transaction(async q=>{const config=(await settings(q)).config,item=await principal(q,await ticket(q,input.id));d.assertVisible(item,user,state,config);const result=await communications.acknowledgeNotifications(q,user.id,{ticketId:item.id});for(const row of await q('SELECT id FROM pignus_tickets WHERE status=?',['Fusionado'])){const source=await ticket(q,row.id);if(source.mergedIntoId===item.id)await communications.acknowledgeNotifications(q,user.id,{ticketId:source.id})}return result})
    }
    const commandId=d.text(input.commandId,100,'Identificador de operación',true)
    if(!/^[\w-]{8,100}$/.test(commandId))d.fail('Identificador de operación inválido.')
    const action=input.action,permission=d.ACTION_PERMISSIONS[action]
    if(action==='configure'?!d.can(user,'configure'):['create','contribute'].includes(action)?(!d.can(user,'view')||!d.can(user,'create')&&!d.can(user,'fromService')):!permission||!d.can(user,permission))d.fail('No tenés permiso para realizar esta acción.',403)
    await ensure()
    await ensureBusinessDefaults()
    await ensureServiceDefaults(state)
    return transaction(async q=>{
      if(action==='formReceipt' && formState) state=await formState.load(q.connection)
      // Reintentos de un mismo comando se serializan sin bloquear casos independientes.
      await rememberEscalationRecipients(q,state)
      if(pg)await q('SELECT pg_advisory_xact_lock(hashtext(?))',[`ticket-command:${commandId}`])
      const configuration=await settings(q,['create','configure'].includes(action)),config=configuration.config
      const cached=(await q('SELECT * FROM pignus_ticket_commands WHERE id=?',[commandId]))[0],fingerprint=commandFingerprint(input)
      if(cached){if(cached.actor_id!==String(user.id)||cached.fingerprint!==fingerprint)d.fail('El identificador ya pertenece a otra operación.',409); if(cached.ticket_id){const old=await principal(q,await ticket(q,cached.ticket_id));d.assertVisible(old,user,state,config);return {ticket:await detailed(q,old,user,state,config)}}return JSON.parse(cached.result||'{}')}
      const now=new Date().toISOString()
      if(action==='configure') {
        if(Number(input.version??input.configVersion)!==configuration.version)d.fail('La configuración cambió. Actualizá antes de guardar.',409)
        const next=d.validateConfig(input.config,state,config)
        if(next.startingNumber!==config.startingNumber){if((await q('SELECT id FROM pignus_tickets LIMIT 1')).length)d.fail('La numeración ya está en uso y no se puede reiniciar.',409);configuration.nextNumber=next.startingNumber}
        configuration.config=next;configuration.version++
        await q('UPDATE pignus_ticket_settings SET data=? WHERE id=?',[JSON.stringify(configuration),'config'])
        const result={config:next,configVersion:configuration.version};await q('INSERT INTO pignus_ticket_commands (id,actor_id,fingerprint,result) VALUES (?,?,?,?)',[commandId,String(user.id),fingerprint,JSON.stringify(result)]);return result
      }
      let item
      if(action==='create') {
        item=d.newTicket(input,user,state,config,'pending',now)
        if(item.customerId){d.duplicateCustomer({...input,customerId:item.customerId},user,state);await customerLock(q,item.customerId);const found=await duplicates(q,item.customerId,user,state,config,true);if(found.candidates.length&&!(input.allowDuplicate===true&&input.duplicateToken===found.duplicateToken))d.fail('Esta cuenta tiene tickets abiertos. Revisá si es el mismo caso antes de continuar.',409,{code:'ticket_duplicates',...found})}
        const attachments=validateAttachments(input.attachments)
        item.number=await nextNumber(q,configuration);item.ruleVersion=configuration.version
        await save(q,item);await addEntry(q,{...d.entry(item,user,item.description,now,{attachments,visibility:'public'}),ticketId:item.id})
        await communicate(q,item,'received','created',now,{},null)
      } else {
        if(action==='contribute'){const customer=d.duplicateCustomer(input,user,state);await customerLock(q,String(customer.customerId||customer.id))}
        if(action==='linkCustomer')await customerLock(q,input.customerId)
        if(pg&&action==='merge')await q('SELECT id FROM pignus_tickets WHERE id IN (?,?) ORDER BY id FOR UPDATE',[String(input.id),String(input.targetId)])
        item=await ticket(q,input.id,true);if(action==='contribute')d.assertDuplicate(item,input,user,state);else d.assertVisible(item,user,state,config)
        const beforeTicket=d.clone(item)
        if(Number(input.version)!==item.version)d.fail('El ticket cambió en otra sesión. Actualizá antes de guardar.',409)
        if(item.status==='Fusionado')d.fail('Este ticket fue fusionado. Abrí el ticket principal.',409)
        if(item.status==='Resuelto'&&!['reopen','merge'].includes(action))d.fail('Reabrí el ticket antes de modificarlo.',409)
        if(action==='resume'&&item.status!=='En espera')d.fail('El ticket no está en espera.',409)
        const note=d.text(input.note??input.body,10000,'Observación',!['assign','resume','linkService','formReceipt'].includes(action))
        let eventLabel='',visibility='public',attachments=[]
        if(action==='comment'||action==='reply'||action==='contribute') {
          if(action==='contribute'&&input.visibility==='internal')d.fail('El aporte a un caso existente debe ser público.',403)
          if(item.status==='Resuelto')d.fail('Reabrí el ticket antes de agregar información.',409)
          if(input.visibility==='internal'){if(!d.can(user,'internal'))d.fail('No tenés permiso para notas internas.',403);visibility='internal'}
          attachments=validateAttachments(input.attachments)
          if(input.serviceId){
            const record=(state.history||[]).find(r=>String(r.id)===String(input.serviceId))
            if(!d.can(user,'fromService')||!record||!read.serviceReadable(record,user,state))d.fail('No tenés acceso para vincular esta solicitud técnica.',403)
            if(!item.customerId||item.customerId!==String(read.customerForRecord(record,state)?.customerId||record.customerId||''))d.fail('La cuenta del servicio no coincide.')
            item.serviceIds=[...new Set([...item.serviceIds,String(record.id)])]
          }
          const context=input.context?{categoryId:d.text(input.context.categoryId,80,'Categoría'),subcategoryId:d.text(input.context.subcategoryId,80,'Subcategoría'),eventId:d.text(input.context.eventId,120,'Evento'),zone:d.text(input.context.zone,200,'Zona'),occurredAt:d.timestamp(input.context.occurredAt)}:undefined
          if(action==='contribute')item.coRequesterIds=[...new Set([...(item.coRequesterIds||[]),String(user.id)])]
          if(action==='reply') {
            if(registration.detectRegistrationForm(item.title,item.description)&&!item.registrationForm?.confirmedAt)d.fail('Confirmá el correo de la respuesta del formulario antes de responder.',409)
            await q(`SELECT data FROM pignus_ticket_settings WHERE id=?${pg?' FOR UPDATE':''}`,['mail-channel'])
            const channel=await require('./ticket-mail-channel.cjs').createMailChannelStore({query:q}).runtime()
            const mail=require('./ticket-mail.cjs'),prepared=mail.prepareTicketReply({...item,entries:await entries(q,item.id)},{...input,attachments:input.attachments},user,channel)
            const entry={...d.entry(item,user,prepared.entry.text,now,{channel:'email',visibility:'public',attachments,deliveryStatus:'queued',messageId:prepared.entry.messageId}),id:prepared.entry.id,ticketId:item.id,slaCycle:item.sla?.cycle||1}
            await addEntry(q,entry);const operation=mail.outboxOperation({...prepared.outbox,entryId:entry.id});await q(operation.sql,operation.params)
          } else await addEntry(q,{...d.entry(item,user,note,now,{channel:input.serviceId?'technical':d.ORIGINS.includes(input.origin)?input.origin:'internal',visibility,attachments,context,sourceServiceId:input.serviceId?String(input.serviceId):undefined}),ticketId:item.id})
        } else if(action==='assign') {
          const area=config.areas.find(a=>a.id===(input.areaId??item.areaId)&&a.active)
          if(input.areaId&&!area)d.fail('Seleccioná un área activa.')
          item.areaId=area?.id||''
          const assignee=input.assigneeId?d.assignees(state,item,config).find(a=>a.id===String(input.assigneeId)):null
          if(input.assigneeId&&!assignee)d.fail('El responsable no tiene acceso o no está activo.')
          item.assigneeId=assignee?.id||'';item.assigneeName=assignee?.name||'';if(assignee&&item.status==='Nuevo')item.status='En gestión';eventLabel=`Asignación: ${item.assigneeName||'Sin asignar'}`
        } else if(action==='classify') {
          const rule=d.classification(config,input.categoryId,input.subcategoryId)
          if(rule.effective.customerPolicy==='required'&&!item.customerId)d.fail('Esta categoría requiere una cuenta vinculada.')
          if(rule.effective.customerPolicy==='none'&&item.customerId)d.fail('Esta categoría no admite cuentas vinculadas.')
          if(!d.PRIORITIES.includes(input.priority))d.fail('Seleccioná una prioridad válida.')
          item.categoryId=rule.category.id;item.subcategoryId=rule.subcategory?.id||'';item.priority=input.priority;item.ruleVersion=configuration.version;eventLabel='Cambió clasificación y prioridad'
        } else if(action==='wait') {item.status='En espera';item.waitReason=note;item.nextReviewAt=d.timestamp(input.nextReviewAt);eventLabel='Dejó el caso en espera'}
        else if(action==='resume') {item.status='En gestión';item.nextReviewAt='';eventLabel='Retomó la gestión'}
        else if(action==='resolve') {
          const method=resolutionMethod(input.resolutionMethod)
          const actorId=String(user.id),actorName=user.name||[user.firstName,user.lastName].filter(Boolean).join(' ')||'Usuario'
          // Resolver un caso visible permite asumirlo al cerrarlo; no concede
          // permiso para reasignar otros casos ni sustituye al responsable actual.
          if(!item.assigneeId){
            item.assigneeId=actorId;item.assigneeName=actorName
            await addEntry(q,{...d.entry(item,user,`Asumió la responsabilidad al resolver y cerrar el ticket: ${actorName}.`,now,{kind:'event',action:'automatic-assignment',visibility:'internal'}),ticketId:item.id})
          }
          item.status='Resuelto';item.resolvedAt=now;item.resolvedById=actorId;item.resolvedByName=actorName;item.resolution=note;item.resolutionMethod=method;item.nextReviewAt='';eventLabel='Resolvió el ticket'
        }
        else if(action==='reopen') {if(item.status!=='Resuelto')d.fail('El ticket ya está abierto.',409);item.status='En gestión';item.resolvedAt='';delete item.resolvedByServiceId;delete item.resolvedById;delete item.resolvedByName;delete item.resolutionMethod;eventLabel='Reabrió el ticket'}
        else if(action==='linkCustomer') {const customer=d.customerFor(input,user,state);if(!customer)d.fail('Seleccioná una cuenta.');if(item.customerId&&item.customerId!==String(customer.customerId||customer.id))d.fail('El ticket ya tiene una cuenta vinculada.');const rule=d.classification(config,item.categoryId,item.subcategoryId);if(rule.effective.customerPolicy==='none')d.fail('Reclasificá el ticket para permitir una cuenta.');item.customerId=String(customer.customerId||customer.id);item.customerSnapshot=d.snapshot(customer);item.scope='customer';eventLabel='Vinculó un abonado o cliente'}
        else if(action==='formReceipt') {
          if(!policy.can(user,'planning.commercial')||!policy.can(user,'records.contact')) d.fail('No tenés permiso para gestionar formularios y datos de contacto.',403)
          const detected=registration.detectRegistrationForm(item.title,item.description)
          if(!detected || detected.multiple) d.fail('Revisá el aviso: se requiere un único formulario por ticket.')
          if(item.registrationForm?.serviceId && !registration.relatedServices(state,(state.history||[]).find(r=>String(r.id)===String(input.serviceId))||{}).some(r=>String(r.id)===String(item.registrationForm.serviceId)) || item.registrationForm?.confirmedAt && !input.serviceId) d.fail('Este formulario ya fue vinculado. Revisá la instalación registrada.',409)
          const address=require('./ticket-mail.cjs').emailAddress(input.formEmail)
          if(!address || detected.candidates.length && !detected.candidates.includes(address)) d.fail('Seleccioná el correo de Ver respuesta del aviso.')
          const record=input.serviceId?(state.history||[]).find(r=>String(r.id)===String(input.serviceId)):null
          if(input.serviceId && (!record || !registration.installation(record,state) || !registration.relatedServices(state,record).every(visit=>read.serviceWritable(visit,user,state)))) d.fail('No tenés acceso comercial a una instalación pendiente.',403)
          const serviceCustomer=record&&read.customerForRecord(record,state)
          const customer=d.customerFor({customerId:record?(serviceCustomer?.customerId||record.customerId||''):(input.customerId||item.customerId)},user,state)
          if(!customer && !record?.subscriberReservation) d.fail('Seleccioná una instalación o reserva de la agenda.')
          const customerId=String(customer?.customerId||customer?.id||'')
          if(input.customerId && String(input.customerId)!==customerId || item.customerId && item.customerId!==customerId)d.fail('La cuenta del formulario no coincide con la del servicio.',409)
          if(!item.customerId&&customer&&!d.can(user,'classify'))d.fail('No tenés permiso para vincular la cuenta.',403)
          if(input.deferUntilScheduled===true&&!policy.can(user,'planning.create'))d.fail('No tenés permiso para coordinar una instalación.',403)
          if(record && registration.relatedServices(state,record).some(visit=>visit.formEmail && require('./ticket-mail.cjs').emailAddress(visit.formEmail)!==address) && input.replaceForm!==true) d.fail('La instalación tiene otro correo de formulario. Confirmá su reemplazo.',409)
          if(record && input.serviceSnapshot!==registration.serviceSnapshot(state,record)) d.fail('El servicio cambió. Volvé a seleccionarlo antes de confirmar.',409)
          if(record && !formState) d.fail('No está disponible la actualización de agenda.',503)
          item.customerId=customerId;item.customerSnapshot=customer?d.snapshot(customer):null;item.scope=customer?'customer':'unlinked'
          item.registrationForm={...item.registrationForm,...detected,email:address,confirmedAt:now,confirmedById:String(user.id),confirmedByName:user.name||'Usuario',serviceId:record?String(record.id):'',pendingCoordination:!record}
          item.requesterEmail=address;item.requesterName=customer?.name||record?.clientNameAtService||record?.client||'';item.externalParticipants=[address];item.autoReplySuppressed=false;item.mailReviewRequired=false
          item.status=record?'Resuelto':'En espera';item.waitReason=record?'':'Pendiente de coordinar instalación'
          if(record){
            const patch=registration.formServicePatch(state,record,address)
            await formState.save(q.connection,state,patch.next,record,patch.after);state=patch.next
            const related=registration.relatedServices(state,record)
            item.serviceIds=[...new Set([...item.serviceIds,...related.map(visit=>String(visit.id))])]
            item.serviceSchedule=related.map(visit=>({id:String(visit.id),date:visit.date,time:visit.time,status:visit.status,service:visit.service}))
            item.resolvedAt=now;item.resolvedById=String(user.id);item.resolvedByName=user.name||'Usuario';item.resolution='Formulario vinculado a la instalación. Correo y estado actualizados en la agenda.';item.nextReviewAt=''
            await q('UPDATE pignus_ticket_notifications SET read_at=? WHERE ticket_id=? AND read_at IS NULL',[now,item.id])
          }
          // The receipt is queued by the saved PIG link, not by processing this ticket.
          eventLabel=record?'Vinculó el formulario a la instalación y resolvió el aviso':'Confirmó el formulario pendiente de coordinación'
        }
        else if(action==='linkService') {const record=(state.history||[]).find(r=>String(r.id)===String(input.serviceId));if(!d.can(user,'linkService')||!record||!read.serviceReadable(record,user,state))d.fail('No tenés acceso al servicio.',403);if(item.customerId&&item.customerId!==String(read.customerForRecord(record,state)?.customerId||record.customerId||''))d.fail('La cuenta del servicio no coincide.');await require('./ticket-service-lifecycle.cjs').adoptLegacyServiceLinks(q,item,{ticket});const related=record.serviceJourney?(state.history||[]).filter(r=>r.serviceJourney?.id===record.serviceJourney.id):[record];item.serviceIds=[...new Set([...item.serviceIds,...related.map(r=>String(r.id))])];item.resolutionServiceIds=[...new Set([...(item.resolutionServiceIds||[]),...related.map(r=>String(r.id))])];item.serviceSchedule=related.map(r=>({id:String(r.id),date:r.date,time:r.time,status:r.status,service:r.service}));eventLabel='Vinculó un servicio';if(!['Completado','Cancelado','Avance registrado'].includes(record.status)){item.status='En gestión';await communicate(q,item,'scheduled',commandId,now,{service:record},user)}}
        else if(action==='merge') {
          const target=await ticket(q,input.targetId,true);d.assertVisible(target,user,state,config)
          if(target.id===item.id||!d.OPEN_STATUSES.includes(target.status))d.fail('Elegí otro ticket abierto como principal.')
          if(Number(input.targetVersion)!==target.version)d.fail('El ticket principal cambió. Revisá la fusión.',409)
          if((item.mailMode==='test')!==(target.mailMode==='test'))d.fail('Los tickets de correo de prueba no se pueden fusionar con casos reales.',409)
          if(item.mailboxKey&&target.mailboxKey&&item.mailboxKey!==target.mailboxKey)d.fail('Los tickets pertenecen a buzones distintos y no se pueden fusionar.',409)
          if((item.customerId||'')!==(target.customerId||''))d.fail('Los tickets deben corresponder a la misma cuenta o ser ambos internos.')
          await require('./ticket-service-lifecycle.cjs').adoptLegacyServiceLinks(q,item,{ticket})
          await require('./ticket-service-lifecycle.cjs').adoptLegacyServiceLinks(q,target,{ticket})
          await q('UPDATE pignus_ticket_entries SET ticket_id=? WHERE ticket_id=?',[target.id,item.id])
          await q('INSERT INTO pignus_ticket_aliases (number,ticket_id) VALUES (?,?) ON CONFLICT(number) DO UPDATE SET ticket_id=excluded.ticket_id',[item.number,target.id])
          await q('UPDATE pignus_ticket_service_requests SET ticket_id=? WHERE ticket_id=?',[target.id,item.id]);await q('UPDATE pignus_ticket_mail_outbox SET ticket_id=? WHERE ticket_id=?',[target.id,item.id]);await q('UPDATE pignus_ticket_aliases SET ticket_id=? WHERE ticket_id=?',[target.id,item.id]);await q('UPDATE pignus_ticket_mail_ids SET ticket_id=? WHERE ticket_id=?',[target.id,item.id])
          target.mergedRequesterIds=mergeRequesterIds(target,item)
          target.mergedTicketIds=[...new Set([...sourceTicketIds(target),...sourceTicketIds(item)])]
          target.participantIds=[...new Set([...target.participantIds,...item.participantIds])];target.externalParticipants=[...new Set([...(target.externalParticipants||[]),...(item.externalParticipants||[]),item.requesterEmail].filter(Boolean))];target.serviceIds=[...new Set([...target.serviceIds,...item.serviceIds])];target.version++;target.updatedAt=now
          target.resolutionServiceIds=[...new Set([...(target.resolutionServiceIds||[]),...(item.resolutionServiceIds||[])])]
          await addEntry(q,{...d.entry(target,user,`Fusionó Ticket#${item.number}. ${note}`,now,{kind:'event'}),ticketId:target.id});await save(q,target)
          item.status='Fusionado';item.mergedIntoId=target.id;item.mergedIntoNumber=target.number;eventLabel=`Fusionado en Ticket#${target.number}`
        }
        if(eventLabel)await addEntry(q,{...d.entry(item,user,[eventLabel,action==='resolve'&&item.resolutionMethod?`Medio: ${RESOLUTION_METHODS[item.resolutionMethod]}`:'',note].filter(Boolean).join(' · '),now,{kind:'event',action:eventLabel,...(action==='resolve'&&item.resolutionMethod?{resolutionMethod:item.resolutionMethod}:{})}),ticketId:item.id})
        sla.transitionSla(item,beforeTicket,action==='formReceipt'&&item.status==='Resuelto'?'resolve':action,config,now,{humanUpdate:action==='formReceipt'&&item.status==='Resuelto'||(action==='resolve'&&['phone','chat'].includes(item.resolutionMethod))||(item.origin!=='email'&&['comment','reply','wait','resolve','linkService'].includes(action)&&visibility!=='internal'),actorId:user.id})
        item.participantIds=[...new Set([...item.participantIds,String(user.id)])];item.version++;item.updatedAt=now;await save(q,item)
        const noticeType={resolve:'resolved',reopen:'reopened',wait:'waiting'}[action]
        if(noticeType)await communicate(q,item,noticeType,commandId,now,{},user)
      }
      await q('INSERT INTO pignus_ticket_commands (id,actor_id,fingerprint,ticket_id) VALUES (?,?,?,?)',[commandId,String(user.id),fingerprint,item.id])
      return {ticket:await detailed(q,item.status==='Fusionado'?await ticket(q,item.mergedIntoId):item,user,state,config)}
    })
  }
  async function syncLegacy(state, { connection } = {}) {
    const records=(state.history||[]).filter(r=>r.followup)
    if(!records.length)return
    if (!connection) await ensure()
    const reader = connection ? executor(connection) : execute
    const migrated=new Set([...(await reader('SELECT legacy_id FROM pignus_tickets WHERE legacy_id IS NOT NULL')),...(await reader('SELECT legacy_id FROM pignus_ticket_service_requests'))].map(row=>row.legacy_id))
    if(records.every(r=>migrated.has(String(r.followup.id||`followup:${r.id}`))))return
    const synchronize = async q=>{
      const configuration=await settings(q,true)
      for(const record of records){const old=record.followup,legacyId=String(old.id||`followup:${record.id}`);if((await q('SELECT id FROM pignus_tickets WHERE legacy_id=?',[legacyId])).length||(await q('SELECT legacy_id FROM pignus_ticket_service_requests WHERE legacy_id=?',[legacyId])).length)continue
        const customer=read.customerForRecord(record,state),customerId=String(customer?.customerId||record.customerId||'')
        const employee=(state.employees||[]).find(e=>String(e.id)===String(old.createdById)),author=employee&&d.subject(employee,state)
        // El informe puede estar completado: su permiso de escritura y autor
        // fueron comprobados al guardarlo, aunque ya no figure como pendiente.
        const canContribute=author&&d.can(author,'view')&&d.can(author,'fromService')&&(record.technicianIds||[]).some(value=>String(value)===String(author.id))&&read.serviceWritable(record,author,state)&&(!customerId||customer&&read.customerReadable(customer,author,state))
        if(old.duplicateReview&&customerId){
          if(!canContribute)d.fail('No tenés permiso para aportar al caso desde este servicio.',403)
          await customerLock(q,customerId)
        }
        if(old.relatedTicketId){
          const selected=await ticket(q,old.relatedTicketId,true)
          if(old.duplicateReview&&selected?.status==='Fusionado')d.fail('El caso fue fusionado. Revisá el ticket principal antes de agregar información.',409)
          if(old.duplicateReview&&selected&&Number(old.relatedTicketVersion)!==selected.version)d.fail('El caso cambió mientras completabas el informe. Revisá la información actualizada.',409)
          const target=await principal(q,selected,true)
          if(target&&author&&(canContribute||!old.duplicateReview&&d.visible(target,author,state,configuration.config))&&d.OPEN_STATUSES.includes(target.status)&&target.customerId===customerId){
            const at=old.createdAt||new Date().toISOString();await addEntry(q,{...d.entry(target,author,old.type+': '+old.description,at,{channel:'technical',visibility:'public',sourceServiceId:String(record.id)}),ticketId:target.id});target.version++;target.updatedAt=[target.updatedAt,at].sort().at(-1);target.serviceIds=[...new Set([...target.serviceIds,String(record.id)])];target.participantIds=[...new Set([...target.participantIds,String(author.id)])];target.coRequesterIds=[...new Set([...(target.coRequesterIds||[]),String(author.id)])];await save(q,target);await q('INSERT INTO pignus_ticket_service_requests (legacy_id,ticket_id) VALUES (?,?)',[legacyId,target.id]);continue
          }
          if(old.duplicateReview)d.fail('El caso elegido cambió o ya no está abierto. Revisá las coincidencias antes de guardar.',409)
        }
        if(old.duplicateReview&&customerId){
          const found=await duplicates(q,customerId,author,state,configuration.config,true)
          if(found.candidates.length&&!(old.relation==='different'&&old.duplicateToken===found.duplicateToken))d.fail('Ya existen casos abiertos de esta cuenta. Revisá si es el mismo motivo antes de guardar el informe.',409,{code:'ticket_duplicates',...found})
        }
        const now=old.createdAt||new Date().toISOString(),type=old.type==='Cotizar adicional'?['commercial','quote']:old.type==='Coordinar visita'?['work','visit']:['general','review']
        const category=configuration.config.categories.find(c=>c.id===type[0]),subcategory=category?.subcategories.find(c=>c.id===type[1]),rule={...category,...Object.fromEntries(Object.entries(subcategory||{}).filter(([,v])=>v!==undefined&&v!==null))}
        const item={id:crypto.randomUUID(),number:await nextNumber(q,configuration),version:1,ruleVersion:configuration.version,legacyId,title:old.type,description:old.description,scope:customerId?'customer':'internal',customerId,customerSnapshot:{customerId,account:record.clientAccount||'',name:record.client||''},origin:'technical',categoryId:type[0],subcategoryId:type[1],eventType:'',zone:'',createdAt:now,updatedAt:old.events?.at(-1)?.at||now,createdById:String(old.createdById||''),createdByName:old.createdByName,requesterId:String(old.createdById||''),requesterName:old.createdByName,areaId:rule.areaId||'technical',assigneeId:String(old.assigneeId||''),assigneeName:old.assigneeName||'',status:old.status==='Pendiente'?'Nuevo':old.status,priority:rule.priority||(old.type==='Cotizar adicional'?'Baja':'Media'),serviceIds:[String(record.id)],participantIds:[String(old.createdById||'')],resolution:old.resolution||'',resolvedAt:old.resolvedAt||''}
        sla.initSla(item,configuration.config,new Date().toISOString())
        if(old.relation==='different'&&record.sourceTicketId)item.parentTicketId=record.sourceTicketId
        await save(q,item)
        await communicate(q,item,'received','created',new Date().toISOString())
        await q('INSERT INTO pignus_ticket_service_requests (legacy_id,ticket_id) VALUES (?,?)',[legacyId,item.id])
        for(const [index,event]of(old.events||[]).entries())await addEntry(q,{...d.entry(item,{id:event.byId,name:event.byName},event.note||event.action,event.at||now,{kind:index?'event':'message',action:event.action,visibility:'public'}),ticketId:item.id})
      }
    }
    return connection ? synchronize(reader) : transaction(synchronize)
  }
  async function attachment(user,state,{id,attachmentId}) {await ensure();const config=(await settings()).config,item=await principal(execute,await ticket(execute,id));d.assertVisible(item,user,state,config);for(const entry of await entries(execute,item.id)){if(entry.visibility==='internal'&&!d.can(user,'internal'))continue;const file=(entry.attachments||[]).find(f=>f.id===attachmentId);if(file)return {...file,data:Buffer.from(file.data,'base64')}}d.fail('El adjunto no existe.',404)}
  async function ingestMail(mail) {
    return transaction(async q=>{
      const configuration=await settings(q,true)
      const namespace=mailNamespace(mail),mode=mail.mode||'test'
      let messageKey=mailIdentifier(namespace,mail.messageId)
      let known=(await q('SELECT ticket_id,sender FROM pignus_ticket_mail_ids WHERE message_id=?',[messageKey]))[0]
      const identifierCollision=Boolean(known&&known.sender!==mail.sender.email)
      if(identifierCollision){messageKey=mailIdentifier(namespace,`${mail.messageId}\u001f${mail.sender.email}`);known=(await q('SELECT ticket_id,sender FROM pignus_ticket_mail_ids WHERE message_id=?',[messageKey]))[0]}
      if(known){const current=await principal(q,await ticket(q,known.ticket_id));return {ticketId:current?.id||known.ticket_id,duplicate:true}}
      let item
      if(!registration.detectRegistrationForm(mail.subject,mail.text)) for(const ref of [...(mail.references||[]),mail.inReplyTo].filter(Boolean).reverse()){const rows=await q('SELECT ticket_id FROM pignus_ticket_mail_ids WHERE message_id IN (?,?)',[mailIdentifier(namespace,`${ref}\u001f${mail.sender.email}`),mailIdentifier(namespace,ref)]);for(const row of rows){const candidate=await principal(q,await ticket(q,row.ticket_id,true),true);if(sameMailContext(candidate,namespace,mode)&&require('./ticket-mail.cjs').ticketParticipantEmails(candidate).includes(mail.sender.email)){item=candidate;break}}if(item)break}
      if(!item&&!registration.detectRegistrationForm(mail.subject,mail.text))for(const number of mail.headerTicketNumbers||[]){const alias=(await q('SELECT ticket_id FROM pignus_ticket_aliases WHERE number=?',[number]))[0];const candidate=await principal(q,await ticket(q,alias?.ticket_id||number,true),true);if(sameMailContext(candidate,namespace,mode)&&require('./ticket-mail.cjs').ticketParticipantEmails(candidate).includes(mail.sender.email)){item=candidate;break}}
      const now=new Date().toISOString(),isNew=!item,previousTicket=item?d.clone(item):null
      const mailCategory=configuration.config.categories.find(c=>c.id==='general'&&c.active)||configuration.config.categories.find(c=>c.active&&c.customerPolicy!=='required')
      if(!item&&!mailCategory)d.fail('Configurá una categoría activa sin cuenta obligatoria para recibir correos.',409)
      const mailRule=mailCategory&&d.classification(configuration.config,mailCategory.id,mailCategory.subcategories.find(c=>c.id==='review'&&c.active)?.id||'')
      if(!item)item={id:crypto.randomUUID(),number:await nextNumber(q,configuration),version:1,title:mail.subject.slice(0,160),description:mail.text.slice(0,10000),scope:'unlinked',mailReviewRequired:identifierCollision||mail.mailReviewRequired||false,mailMode:mode,mailboxKey:namespace,customerId:'',customerSnapshot:null,origin:'email',categoryId:mailRule.category.id,subcategoryId:mailRule.subcategory?.id||'',eventType:'',zone:'',createdAt:now,updatedAt:now,requesterId:'',requesterName:mail.sender.name||mail.sender.email,requesterEmail:mail.sender.email,createdById:'email',createdByName:mail.sender.name||mail.sender.email,externalParticipants:[mail.sender.email],participantIds:[],areaId:configuration.config.areas.find(area=>area.active!==false&&area.id===mail.areaId)?.id||mailRule.effective.areaId||'',assigneeId:'',assigneeName:'',status:'Nuevo',priority:mailRule.effective.priority,ruleVersion:configuration.version,serviceIds:[]}
      else {item.mailboxKey=namespace;item.mailMode=mode;item.version++;item.updatedAt=now;if(item.status==='Resuelto'||item.status==='En espera'){item.status='En gestión';item.resolvedAt='';delete item.resolvedByServiceId;delete item.resolvedById;delete item.resolvedByName;delete item.resolutionMethod;item.nextReviewAt='';await addEntry(q,{...d.entry(item,{id:'email',name:'Correo'},'El cliente agregó información y el caso vuelve a gestión.',now,{kind:'event',action:'reopen'}),ticketId:item.id})}}
      if(isNew && registration.detectRegistrationForm(mail.subject,mail.text)){item.registrationForm=registration.detectRegistrationForm(mail.subject,mail.text);item.autoReplySuppressed=true}
      sla.transitionSla(item,previousTicket,'inbound',configuration.config,now)
      const attachments=validateAttachments((mail.attachments||[]).map(f=>({fileName:f.fileName||f.name,mimeType:f.mimeType||f.mime,data:Buffer.isBuffer(f.data)?f.data.toString('base64'):f.data})))
      await save(q,item);await addEntry(q,{...d.entry(item,{id:'email',name:mail.sender.name||mail.sender.email},mail.text,now,{channel:'email',visibility:'public',messageId:mail.messageId,from:mail.sender.email,receivedAt:mail.receivedAt,reviewRequired:identifierCollision||mail.mailReviewRequired||false,truncated:mail.textTruncated||mail.truncated||false,attachments}),ticketId:item.id});await q('INSERT INTO pignus_ticket_mail_ids (message_id,ticket_id,sender) VALUES (?,?,?)',[messageKey,item.id,mail.sender.email])
      if(isNew)await communicate(q,item,'received','created',now,{},null,mail)
      else if(previousTicket.status==='Resuelto')await communicate(q,item,'reopened',messageKey,now,{},null,mail)
      return {ticketId:item.id,created:isNew}
    })
  }
  async function applyDelivery(result) {
    return transaction(async q=>{
      // Lock the ticket before its conversation, matching normal ticket writes.
      const item=await ticket(q,result.ticket_id,true)
      const row=(await q('SELECT data FROM pignus_ticket_entries WHERE id=?',[result.entry_id]))[0]
      if(!row)return
      const entry=parse(row),wasSent=entry.deliveryStatus==='sent'
      if(wasSent&&result.status!=='sent')return
      entry.deliveryStatus=result.status
      await q('UPDATE pignus_ticket_entries SET data=? WHERE id=?',[JSON.stringify(entry),entry.id])
      if(result.status!=='sent')return
      await q('INSERT INTO pignus_ticket_mail_ids (message_id,ticket_id,sender) VALUES (?,?,?) ON CONFLICT(message_id) DO NOTHING',[mailIdentifier(mailNamespace(result),result.message_id),result.ticket_id,'outbound'])
      const sameCycle=Number(entry.slaCycle)===Number(item?.sla?.cycle)
      const sameTicket=String(entry.sourceTicketId||entry.ticketId)===String(item?.id)
      if(!item||wasSent||!sameCycle||!sameTicket||entry.automatic&&!entry.humanInitiated)return
      const deliveredAt=result.finished_at||new Date().toISOString(),before=d.clone(item),config=(await settings(q)).config
      sla.transitionSla(item,before,'reply',config,deliveredAt,{humanUpdate:true,actorId:entry.triggeredById||entry.byId})
      if(JSON.stringify(item.sla)!==JSON.stringify(before.sla)){item.version++;await save(q,item)}
    })
  }
  async function registrationInbox(q, state, user) {
    if (!policy.can(user,'tickets.view') || !policy.can(user,'planning.commercial') || !policy.can(user,'records.contact')) return []
    if (!q) { await ensure(); q=execute }
    const config=(await settings(q)).config
    return (await q('SELECT data FROM pignus_tickets ORDER BY updated_at DESC')).map(parse)
      .filter(item=>item.status!=='Fusionado' && d.visible(item,user,state,config))
      .map(item=>({id:item.id,number:item.number,status:item.status,updatedAt:item.updatedAt,form:item.registrationForm||registration.detectRegistrationForm(item.title,item.description)}))
      .filter(item=>item.form)
  }
  return {ensure,query,run,syncLegacy,syncServices,processSla,attachment,ingestMail,applyDelivery,transaction,registrationInbox}
}
module.exports={createTicketStore,SCHEMA}
