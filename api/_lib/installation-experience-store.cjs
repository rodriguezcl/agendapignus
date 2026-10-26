const { sqlParameters } = require('./ticket-mail-store.cjs')
const { completionInvitations } = require('./installation-experience.cjs')
const TABLE = 'pignus_installation_experience_mail'
const SCHEMA = `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, customer_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, started_at TEXT, sent_at TEXT, sender TEXT, last_error TEXT, history TEXT NOT NULL)`
function createExperienceStore({sql,db}) {
  const query = (text,params=[]) => sql ? sql.unsafe(sqlParameters(text),params) : Promise.resolve(/^(SELECT|UPDATE[\s\S]+RETURNING)/i.test(text) ? db.prepare(text).all(...params) : (db.prepare(text).run(...params),[]))
  const parse = row => row ? {...row,payload:JSON.parse(row.payload),history:JSON.parse(row.history),last_error:row.last_error ? JSON.parse(row.last_error):null} : null
  async function ensure() {
    await query(SCHEMA)
    await query(`CREATE INDEX IF NOT EXISTS installation_experience_pending ON ${TABLE} (status,next_attempt_at)`)
    if(sql) {
      await query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`)
      await query(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC`)
      await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE ${TABLE} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE ${TABLE} FROM authenticated; END IF; END $$`)
    }
  }
  return {ensure,query,
    async enqueue(previous,next,now=new Date().toISOString()) {
      const items=completionInvitations(previous,next); if(!items.length)return
      await ensure()
      for(const item of items) await query(`INSERT INTO ${TABLE} (id,service_id,customer_id,status,payload,created_at,updated_at,next_attempt_at,history) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,[item.id,item.serviceId,item.customerId,item.recipient?'queued':'needs_email',JSON.stringify(item),now,now,now,JSON.stringify([{at:now,action:'created'}])])
    },
    async list() {return (await query(`SELECT * FROM ${TABLE} ORDER BY created_at DESC`)).map(parse)},
    async get(id) {return parse((await query(`SELECT * FROM ${TABLE} WHERE id=?`,[id]))[0])},
    async claim(now=new Date().toISOString()) {return parse((await query(`UPDATE ${TABLE} SET status='sending',attempts=attempts+1,started_at=?,updated_at=? WHERE id=(SELECT id FROM ${TABLE} WHERE status IN ('queued','retry') AND next_attempt_at<=? ORDER BY created_at,id LIMIT 1) AND status IN ('queued','retry') RETURNING *`,[now,now,now]))[0])},
    async finish(row,status,error,now=new Date().toISOString(),sender='') {
      const next=new Date(Date.parse(now)+Math.min(900000,30000*2**Math.min(5,row.attempts))).toISOString()
      await query(`UPDATE ${TABLE} SET status=?,updated_at=?,next_attempt_at=?,sent_at=?,sender=?,last_error=?,history=? WHERE id=? AND status='sending' AND attempts=?`,[status,now,next,status==='sent'?now:null,sender,error?JSON.stringify(error):null,JSON.stringify([...row.history,{at:now,action:status,attempt:row.attempts}]),row.id,row.attempts])
    },
    async recover(now=new Date().toISOString()) {
      const cutoff=new Date(Date.parse(now)-10*60000).toISOString()
      for(const row of (await query(`SELECT * FROM ${TABLE} WHERE status='sending' AND started_at<?`,[cutoff])).map(parse)) {
        await query(`UPDATE ${TABLE} SET status='uncertain',updated_at=?,last_error=?,history=? WHERE id=? AND status='sending' AND attempts=?`,[now,JSON.stringify({message:'El envío quedó sin confirmación. Revisá el buzón antes de volver a contactar al cliente.'}),JSON.stringify([...row.history,{at:now,action:'uncertain',attempt:row.attempts}]),row.id,row.attempts])
      }
    },
    async recipient(row,email,user,now=new Date().toISOString()) {
      const payload={...row.payload,recipient:email}
      const changed=await query(`UPDATE ${TABLE} SET status='queued',payload=?,updated_at=?,next_attempt_at=?,attempts=0,last_error=NULL,history=? WHERE id=? AND status IN ('needs_email','failed') AND updated_at=? RETURNING id`,[JSON.stringify(payload),now,now,JSON.stringify([...row.history,{at:now,action:'recipient',byId:user.id,byName:user.name||user.email,previous:row.payload.recipient,recipient:email}]),row.id,row.updated_at])
      if(!changed.length)throw Object.assign(new Error('El envío cambió. Actualizá la ficha antes de continuar.'),{statusCode:409})
      return this.get(row.id)
    },
    async confirmSent(row,user,now=new Date().toISOString()) {
      const changed=await query(`UPDATE ${TABLE} SET status='verified',updated_at=?,last_error=NULL,history=? WHERE id=? AND status='uncertain' AND updated_at=? RETURNING id`,[now,JSON.stringify([...row.history,{at:now,action:'verified',byId:user.id,byName:user.name||user.email}]),row.id,row.updated_at])
      if(!changed.length)throw Object.assign(new Error('El envío cambió. Actualizá la ficha.'),{statusCode:409})
      return this.get(row.id)
    }
  }
}
module.exports={createExperienceStore,SCHEMA,TABLE}
