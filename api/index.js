const crypto = require('node:crypto')
const { writeProfessionalPdf } = require('../scripts/professional-pdf.cjs')
const { appendAudit, database, readExportState, readRevision, readState, replaceCollections } = require('./_lib/database.cjs')
const { fetchNationalHolidays, validHolidayYear } = require('./_lib/holidays.cjs')
const { vehicleControlIsOpen, vehicleControlWindowLabel } = require('./_lib/vehicle-control-window.cjs')
const {
  assertServiceCanBeCompleted, auditChanges, auditSafe, authorizeIncomingState, compareReportRecords, hashPassword,
  legacyRoleCode, normalizedServiceName, normalizeRetirementCustomers, normalizeStateForSave, professionalExcelHtml,
  reportDate, secureEmployees, statePersistenceChanged, userCan, userForEmployee, validateState, verifyPassword,
  visibleStateForUser
} = require('./_lib/core.cjs')

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5
const AUDIT_LOG_LIMIT = 100
const PASSWORD_RESET_REQUESTS_KEY = 'password_reset_requests'
const PASSWORD_RESET_REQUESTS_LIMIT = 50

function productionSecretsAreValid() {
  return ['PIGNUS_SESSION_SECRET', 'PIGNUS_RATE_LIMIT_SECRET'].every(name => String(process.env[name] || '').length >= 32)
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

function send(res, status, data) {
  securityHeaders(res)
  return res.status(status).json(data)
}

async function handleVehicleControlPhoto(req, res, sql, user, recordId) {
  await sql`create table if not exists pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null default now())`
  await sql`alter table pignus_vehicle_control_photos enable row level security`
  await sql`revoke all on table pignus_vehicle_control_photos from anon, authenticated`
  const rows = await sql`
    select photo.mime_type, photo.photo_data, history.data as record
    from pignus_vehicle_control_photos photo
    join pignus_work_history history on history.id = photo.record_id
    where photo.record_id = ${String(recordId)}
  `
  const row = rows[0]
  if (!row) return send(res, 404, { error: 'La foto no existe.' })
  const allowed = user.roleCode === 'administrator' || userCan(user, 'history') || row.record?.technicianIds?.some(id => String(id) === String(user.id))
  if (!allowed) return send(res, 403, { error: 'No tenés permiso para ver esta foto.' })
  securityHeaders(res)
  res.setHeader('Content-Type', row.mime_type)
  res.setHeader('Content-Length', row.photo_data.length)
  return res.status(200).send(row.photo_data)
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key))
}

function tokenHash(token) {
  return crypto.createHmac('sha256', process.env.PIGNUS_SESSION_SECRET || 'development-only').update(String(token)).digest('hex')
}

function requestFingerprint(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const address = forwarded || req.socket?.remoteAddress || 'unknown'
  return crypto.createHmac('sha256', process.env.PIGNUS_RATE_LIMIT_SECRET || process.env.PIGNUS_SESSION_SECRET || 'development-only').update(address).digest('hex')
}

function routePath(req) {
  const rewritten = req.query?.path
  if (Array.isArray(rewritten)) return `/${rewritten.join('/')}`
  if (rewritten != null && String(rewritten)) return `/${String(rewritten).replace(/^\/+/, '')}`
  return new URL(req.url, 'https://pignus.local').pathname.replace(/^\/api(?:\/index)?\/?/, '/')
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch { throw new Error('Datos inválidos.') }
  }
  return {}
}

function auditEntry(user, action, entity, entityId, before, after) {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role }, action, entity, entityId, before: auditSafe(before), after: auditSafe(after) }
}

async function sessionContext(req, sql = database()) {
  const token = cookies(req.headers.cookie).pignus_session
  if (!token) return null
  const hash = tokenHash(token)
  const sessions = await sql`
    select
      active_session.employee_id,
      active_session.expires_at,
      (select data from pignus_employees where id = active_session.employee_id) as employee,
      coalesce((select jsonb_agg(data) filter (where data is not null) from pignus_roles), '[]'::jsonb) as roles
    from pignus_sessions as active_session
    where active_session.token_hash = ${hash}
      and active_session.token_hash = (
        select newest.token_hash
        from pignus_sessions as newest
        where newest.employee_id = active_session.employee_id
        order by newest.created_at desc, newest.token_hash desc
        limit 1
      )
  `
  const session = sessions[0]
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) await sql`delete from pignus_sessions where token_hash = ${hash}`
    return null
  }
  const employee = session.employee
  if (!employee || employee.status !== 'Activo') {
    await sql`delete from pignus_sessions where token_hash = ${hash}`
    return null
  }
  const user = userForEmployee(employee, session.roles)
  if (!user) {
    await sql`delete from pignus_sessions where token_hash = ${hash}`
    return null
  }
  return { token, hash, user, expiresAt: new Date(session.expires_at) }
}

async function requireSession(req, res, sql = database()) {
  const session = await sessionContext(req, sql)
  if (!session) send(res, 401, { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' })
  return session
}

async function ensureVehicleInsuranceSchema(sql) {
  await sql`create table if not exists pignus_vehicle_insurance_documents (vehicle_id text primary key, file_name text not null, pdf_data bytea not null, uploaded_at timestamptz not null default now())`
  await sql`alter table pignus_vehicle_insurance_documents enable row level security`
  await sql`revoke all on table pignus_vehicle_insurance_documents from anon, authenticated`
}

async function handleVehicleInsurance(req, res, sql, user, vehicleId) {
  await ensureVehicleInsuranceSchema(sql)
  if (req.method === 'GET') {
    const state = await readState(sql)
    if (!(state.vehicles || []).some(vehicle => String(vehicle.id) === String(vehicleId))) return send(res, 404, { error: 'El vehículo no existe.' })
    if (user.roleCode !== 'technician' && !userCan(user, 'vehicles')) return send(res, 403, { error: 'No tenés permiso para descargar este seguro.' })
    const rows = await sql`select file_name, pdf_data from pignus_vehicle_insurance_documents where vehicle_id = ${String(vehicleId)}`
    if (!rows[0]) return send(res, 404, { error: 'El seguro no está cargado.' })
    securityHeaders(res)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${String(rows[0].file_name || 'seguro.pdf').replace(/["\r\n]/g, '')}"`)
    return res.status(200).send(rows[0].pdf_data)
  }
  if (user.roleCode !== 'administrator') return send(res, 403, { error: 'Solamente un administrador puede cargar seguros.' })
  const { fileName, pdf } = requestBody(req)
  const match = String(pdf || '').match(/^data:application\/pdf;base64,([a-z0-9+/=]+)$/i)
  const data = match ? Buffer.from(match[1], 'base64') : null
  if (!data?.length || data.length > 3_000_000 || data.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'Seleccioná un PDF válido de hasta 3 MB.' })
  const safeName = String(fileName || 'seguro.pdf').trim().slice(0, 180)
  const uploadedAt = new Date().toISOString()
  await sql`insert into pignus_vehicle_insurance_documents (vehicle_id, file_name, pdf_data, uploaded_at) values (${String(vehicleId)}, ${safeName}, ${data}, ${uploadedAt}) on conflict (vehicle_id) do update set file_name = excluded.file_name, pdf_data = excluded.pdf_data, uploaded_at = excluded.uploaded_at`
  await appendAudit(sql, [auditEntry(user, 'Cargó seguro', 'Vehículo', String(vehicleId), null, { fileName: safeName, uploadedAt })])
  return send(res, 200, { fileName: safeName, uploadedAt, documentUrl: `/api/vehicle-insurance/${encodeURIComponent(String(vehicleId))}` })
}

async function handleLogin(req, res, sql) {
  const fingerprint = requestFingerprint(req)
  const attempts = await sql`select attempts, blocked_until from pignus_login_attempts where fingerprint = ${fingerprint}`
  if (attempts[0]?.attempts >= LOGIN_MAX_ATTEMPTS && new Date(attempts[0].blocked_until).getTime() > Date.now()) return send(res, 429, { error: 'Demasiados intentos. Esperá 15 minutos antes de volver a intentar.' })
  const { email, password } = requestBody(req)
  const employees = await sql`select data from pignus_employees where email = ${String(email || '').trim().toLowerCase()}`
  const employee = employees[0]?.data
  if (!employee) {
    await sql`insert into pignus_login_attempts (fingerprint, attempts, blocked_until, updated_at) values (${fingerprint}, 1, ${new Date(Date.now() + LOGIN_WINDOW)}, now()) on conflict (fingerprint) do update set attempts = case when pignus_login_attempts.blocked_until > now() then pignus_login_attempts.attempts + 1 else 1 end, blocked_until = ${new Date(Date.now() + LOGIN_WINDOW)}, updated_at = now()`
    return send(res, 404, { error: 'El correo ingresado no está dado de alta en el sistema. Ponete en contacto con un Administrador.' })
  }
  const legacy = Buffer.from(String(employee?.password || ''))
  const supplied = Buffer.from(String(password || ''))
  const legacyValid = legacy.length === supplied.length && legacy.length > 0 && crypto.timingSafeEqual(legacy, supplied)
  const valid = employee?.status === 'Activo' && (employee.passwordHash ? verifyPassword(password, employee.passwordHash) : legacyValid)
  if (!valid) {
    await sql`insert into pignus_login_attempts (fingerprint, attempts, blocked_until, updated_at) values (${fingerprint}, 1, ${new Date(Date.now() + LOGIN_WINDOW)}, now()) on conflict (fingerprint) do update set attempts = case when pignus_login_attempts.blocked_until > now() then pignus_login_attempts.attempts + 1 else 1 end, blocked_until = ${new Date(Date.now() + LOGIN_WINDOW)}, updated_at = now()`
    return send(res, 401, { error: 'Usuario o contraseña incorrectos.' })
  }
  if (!employee.passwordHash) {
    employee.passwordHash = hashPassword(employee.password)
    delete employee.password
    await sql`update pignus_employees set data = ${sql.json(employee)} where id = ${String(employee.id)}`
  }
  const roles = (await sql`select data from pignus_roles`).map(row => row.data)
  const user = userForEmployee(employee, roles)
  if (!user) return send(res, 401, { error: 'El usuario no tiene un rol válido.' })
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE)
  await sql.begin(async transaction => {
    await transaction`delete from pignus_login_attempts where fingerprint = ${fingerprint}`
    await transaction`delete from pignus_sessions where expires_at <= now()`
    await transaction`select id from pignus_employees where id = ${String(user.id)} for update`
    // Una identidad sólo puede conservar una sesión activa. El último ingreso
    // invalida los tokens anteriores del mismo empleado en cualquier dispositivo.
    const revoked = await transaction`delete from pignus_sessions where employee_id = ${String(user.id)} returning token_hash`
    await transaction`insert into pignus_sessions (token_hash, employee_id, expires_at) values (${tokenHash(token)}, ${String(user.id)}, ${expiresAt})`
    await appendAudit(transaction, [auditEntry(user, 'Inició sesión', 'Sesión', String(user.id), null, { sessionExpiresAt: expiresAt.toISOString(), replacedSessions: revoked.length })])
  })
  res.setHeader('Set-Cookie', `pignus_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}`)
  return send(res, 200, { user })
}

function parsePasswordResetRequests(value) {
  try {
    const requests = JSON.parse(value || '[]')
    return Array.isArray(requests) ? requests.filter(item => item?.id && item?.email && item?.requestedAt) : []
  } catch {
    return []
  }
}

async function handlePasswordResetRequest(req, res, sql) {
  const email = String(requestBody(req).email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Ingresá un correo electrónico válido.' })
  const employees = await sql`select id, data from pignus_employees where email = ${email}`
  const employee = employees[0]?.data
  if (!employee) return send(res, 404, { error: 'El correo ingresado no está dado de alta en el sistema. Ponete en contacto con un Administrador.' })
  await sql.begin(async transaction => {
    await transaction`insert into pignus_preferences (key, value) values (${PASSWORD_RESET_REQUESTS_KEY}, '[]') on conflict (key) do nothing`
    const rows = await transaction`select value from pignus_preferences where key = ${PASSWORD_RESET_REQUESTS_KEY} for update`
    const requests = parsePasswordResetRequests(rows[0]?.value)
    const existing = requests.find(item => item.email === email)
    const request = { id: existing?.id || crypto.randomUUID(), employeeId: String(employee.id), email, requestedAt: new Date().toISOString() }
    const next = [request, ...requests.filter(item => item.email !== email)].slice(0, PASSWORD_RESET_REQUESTS_LIMIT)
    await transaction`update pignus_preferences set value = ${JSON.stringify(next)}, updated_at = now() where key = ${PASSWORD_RESET_REQUESTS_KEY}`
  })
  return send(res, 200, { ok: true, message: 'La solicitud fue enviada al Administrador.' })
}

async function readPasswordResetRequests(sql) {
  const rows = await sql`select value from pignus_preferences where key = ${PASSWORD_RESET_REQUESTS_KEY}`
  return parsePasswordResetRequests(rows[0]?.value).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
}

async function resolvePasswordResetRequest(req, res, sql, user) {
  const id = String(requestBody(req).id || '')
  if (!id) return send(res, 400, { error: 'La solicitud no es válida.' })
  let resolved = null
  await sql.begin(async transaction => {
    await transaction`insert into pignus_preferences (key, value) values (${PASSWORD_RESET_REQUESTS_KEY}, '[]') on conflict (key) do nothing`
    const rows = await transaction`select value from pignus_preferences where key = ${PASSWORD_RESET_REQUESTS_KEY} for update`
    const requests = parsePasswordResetRequests(rows[0]?.value)
    resolved = requests.find(item => item.id === id) || null
    await transaction`update pignus_preferences set value = ${JSON.stringify(requests.filter(item => item.id !== id))}, updated_at = now() where key = ${PASSWORD_RESET_REQUESTS_KEY}`
    if (resolved) await appendAudit(transaction, [auditEntry(user, 'Resolvió', 'Solicitud de contraseña', id, resolved, null)])
  })
  return resolved ? send(res, 200, { ok: true }) : send(res, 404, { error: 'La solicitud ya no está pendiente.' })
}

async function handleLogout(req, res, sql) {
  res.setHeader('Set-Cookie', 'pignus_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
  const token = cookies(req.headers.cookie).pignus_session
  if (!token) return send(res, 200, { ok: true })

  // El cierre no necesita reconstruir toda la sesión mediante varias consultas.
  // Primero revoca el token y obtiene en el mismo viaje los datos mínimos para
  // conservar la trazabilidad de auditoría.
  const rows = await sql`
    with deleted as (
      delete from pignus_sessions
      where token_hash = ${tokenHash(token)}
      returning employee_id, expires_at
    )
    select
      deleted.employee_id,
      deleted.expires_at,
      (select data from pignus_employees where id = deleted.employee_id) as employee,
      coalesce((select jsonb_agg(data) filter (where data is not null) from pignus_roles), '[]'::jsonb) as roles
    from deleted
  `
  const session = rows[0]
  const user = session?.employee ? userForEmployee(session.employee, session.roles || []) : null
  if (user) await appendAudit(sql, [auditEntry(user, 'Cerró sesión', 'Sesión', String(user.id), { sessionExpiresAt: new Date(session.expires_at).toISOString() }, null)])
  return send(res, 200, { ok: true })
}

async function handleSaveState(req, res, sql, user) {
  const incoming = requestBody(req)
  try {
    const revision = await sql.begin(async transaction => {
      await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
      const revisionRows = await transaction`select value from pignus_preferences where key = 'state_revision' for update`
      const currentRevision = Number(revisionRows[0]?.value || 0)
      const current = await readState(transaction)
      let next = authorizeIncomingState(incoming, current, user)
      next = normalizeStateForSave(next, current)
      next.employees = secureEmployees(next.employees, current.employees)
      validateState(next, current)
      // Un estado idéntico no es una nueva versión. Esto permite que dos
      // sesiones se hidraten simultáneamente sin generarse conflictos entre sí.
      if (!statePersistenceChanged(current, next)) return currentRevision
      if (!Number.isInteger(Number(incoming.revision)) || Number(incoming.revision) !== currentRevision) {
        const error = new Error('Los datos cambiaron en otra sesión. Recargá la página antes de volver a guardar.')
        error.statusCode = 409
        throw error
      }
      const entries = [
        ...auditChanges(current.roles, next.roles, 'id', 'Rol', user),
        ...auditChanges(current.employees, next.employees, 'id', 'Empleado', user),
        ...auditChanges(current.services, next.services, 'id', 'Tipo de servicio', user),
        ...auditChanges(current.vehicles, next.vehicles, 'id', 'Vehículo', user),
        ...auditChanges(current.history, next.history, 'id', 'Servicio / historial', user),
        ...auditChanges(current.customers, next.customers, 'customerId', 'Abonado / Cliente', user),
        ...auditChanges(current.reviews, next.reviews, 'id', 'Reseña', user)
      ]
      if (JSON.stringify(current.agenda) !== JSON.stringify(next.agenda)) entries.push(auditEntry(user, 'Modificó', 'Agenda técnica', 'agenda-actual', current.agenda, next.agenda))
      await replaceCollections(transaction, next)
      await appendAudit(transaction, entries)
      const nextRevision = currentRevision + 1
      await transaction`update pignus_preferences set value = ${String(nextRevision)}, updated_at = now() where key = 'state_revision'`
      return nextRevision
    })
    return send(res, 200, { ok: true, revision })
  } catch (error) {
    console.error('No se pudo guardar el estado:', error.message)
    return send(res, error.statusCode || 400, { error: error.message || 'No se pudieron guardar los datos.' })
  }
}

function alarmCategory(record) {
  if (record.installationZone) return record.installationZone
  const address = `${record.address || ''} ${record.client || ''}`.toLowerCase()
  if (address.includes('docta')) return 'docta'
  if (address.includes('nobu')) return 'nobu-town'
  return 'residencial'
}

async function handleExport(req, res, sql, user) {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7))
  const category = String(req.query.category || 'residencial')
  const format = String(req.query.format || 'excel')
  const isRetirement = category === 'retirements'
  const state = await readExportState(sql)
  const alarmService = state.services.find(service => service.code === 'alarm-installation')
  const records = state.history.filter(record => {
    if (!record.date?.startsWith(month) || (user.roleCode === 'technician' && !record.technicianIds?.some(id => String(id) === String(user.id)))) return false
    if (isRetirement) return record.status === 'Completado' && normalizedServiceName(record.service).includes('retiro de equipo')
    const installationCategory = alarmCategory(record)
    return !record.subscriberReservation && installationCategory !== 'no-monitoreada' && (String(record.serviceId) === String(alarmService?.id) || (!record.serviceId && normalizedServiceName(record.service) === 'instalacion de alarma')) && (category === 'all' || installationCategory === category)
  }).sort(compareReportRecords)
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const generatedAt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const label = { docta: 'Docta Urbanización', 'nobu-town': 'Nobu Town', residencial: 'Residenciales', all: 'Todas las instalaciones de alarma' }[category] || 'Instalaciones de alarma'
  const headers = isRetirement ? ['Fecha', 'Cliente', 'Servicio', 'Dirección', 'Contacto', 'Técnicos asignados'] : ['Fecha', 'Cliente', 'Dirección', 'Contacto', 'Técnicos asignados']
  const rows = records.map(record => isRetirement ? [record.date, record.client, record.service, record.address, record.phone, record.technicians?.join(' / ')] : [record.date, record.client, record.address, record.phone, record.technicians?.join(' / ')])
  const title = isRetirement ? 'Bajas de servicio' : `Altas de servicio · ${label}`
  const description = isRetirement ? 'Retiros de equipos de alarma completados durante el período seleccionado.' : 'Instalaciones de alarma registradas durante el período seleccionado.'
  const fileBase = isRetirement ? `bajas-servicio-${month}` : `instalaciones-alarma-${category}-${month}`
  securityHeaders(res)
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`)
    return writeProfessionalPdf(res, { title, description, monthLabel, generatedAt, headers, rows: rows.map(row => [reportDate(row[0]), ...row.slice(1)]), widths: isRetirement ? [58, 170, 95, 190, 100, 156] : [60, 175, 235, 110, 189], fileName: `${fileBase}.pdf` })
  }
  const html = professionalExcelHtml({ title, description, month, headers, rows, widths: isRetirement ? ['9%', '22%', '13%', '24%', '13%', '19%'] : ['9%', '23%', '31%', '14%', '23%'] })
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xls"`)
  return res.status(200).send(`\ufeff${html}`)
}

async function handleTechnicianStatus(req, res, sql, user) {
  if (user.roleCode !== 'technician') return send(res, 403, { error: 'Esta acción es exclusiva del rol técnico.' })
  const { recordId, type, observation, vehicleMileage, vehiclePhoto } = requestBody(req)
  const allowed = ['Completado', 'Cancelado', 'Reprogramación solicitada']
  if (!allowed.includes(type)) return send(res, 400, { error: 'No se puede actualizar este servicio.' })
  try {
    const updated = await sql.begin(async transaction => {
      // Todos los escritores toman primero la revisión global. Mantener el mismo
      // orden evita esperas circulares con el guardado general de la agenda.
      await transaction`set local lock_timeout = '5s'`
      await transaction`set local statement_timeout = '15s'`
      await transaction`insert into pignus_preferences (key, value) values ('state_revision', '0') on conflict (key) do nothing`
      await transaction`select value from pignus_preferences where key = 'state_revision' for update`
      const rows = await transaction`select data from pignus_work_history where id = ${String(recordId)} for update`
      const record = rows[0]?.data
      if (!record) { const error = new Error('El servicio no existe.'); error.statusCode = 404; throw error }
      if (!record.technicianIds?.some(id => String(id) === String(user.id))) { const error = new Error('El servicio no está asignado al técnico autenticado.'); error.statusCode = 403; throw error }
      if (record.vehicleControl && type !== 'Completado') { const error = new Error('El control vehicular debe completarse con foto y kilometraje; no admite cancelación ni reprogramación.'); error.statusCode = 400; throw error }
      if (record.vehicleControl && !vehicleControlIsOpen(record)) { const error = new Error(`El control vehicular se habilita el ${vehicleControlWindowLabel(record)}.`); error.statusCode = 409; throw error }
      // Si el primer envío se guardó pero el teléfono perdió la respuesta, el
      // reintento devuelve el mismo resultado sin duplicar auditoría ni cambios.
      if (record.technicalStatus) {
        if (record.technicalStatus === type && String(record.technicalReportedById) === String(user.id)) return record
        const error = new Error('Este servicio ya fue informado desde otra sesión.'); error.statusCode = 409; throw error
      }
      const completingVehicleControl = Boolean(record.vehicleControl && type === 'Completado')
      let vehicleChange = null
      if (completingVehicleControl) {
        const mileage = Number(vehicleMileage)
        if (!Number.isInteger(mileage) || mileage < 1 || mileage > 99999999) throw new Error('Ingresá un kilometraje válido.')
        const photoMatch = String(vehiclePhoto || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i)
        const photoBuffer = photoMatch ? Buffer.from(photoMatch[2], 'base64') : null
        if (!photoBuffer?.length || photoBuffer.length > 1_000_000) throw new Error('Cargá una foto válida del interior del vehículo.')
        const vehicleRows = await transaction`select value from pignus_preferences where key = 'vehicles' for update`
        let vehicles
        try { vehicles = JSON.parse(vehicleRows[0]?.value || '[]') } catch { vehicles = [] }
        const vehicleIndex = vehicles.findIndex(vehicle => String(vehicle.id) === String(record.vehicleId))
        if (vehicleIndex < 0) { const error = new Error('El vehículo asignado ya no existe.'); error.statusCode = 409; throw error }
        const previousVehicle = vehicles[vehicleIndex]
        const currentMileage = Number(previousVehicle.mileage || 0)
        if (mileage <= currentMileage) { const error = new Error(`El kilometraje debe ser superior a ${currentMileage.toLocaleString('es-AR')} km.`); error.statusCode = 409; throw error }
        const nextVehicle = { ...previousVehicle, mileage, mileageUpdatedAt: new Date().toISOString(), mileageUpdatedById: user.id, mileageUpdatedByName: user.name || user.email || 'Técnico' }
        vehicles[vehicleIndex] = nextVehicle
        await transaction`update pignus_preferences set value = ${JSON.stringify(vehicles)}, updated_at = now() where key = 'vehicles'`
        await transaction`create table if not exists pignus_vehicle_control_photos (record_id text primary key, vehicle_id text not null, mime_type text not null, photo_data bytea not null, created_at timestamptz not null default now())`
        await transaction`alter table pignus_vehicle_control_photos enable row level security`
        await transaction`revoke all on table pignus_vehicle_control_photos from anon, authenticated`
        await transaction`insert into pignus_vehicle_control_photos (record_id, vehicle_id, mime_type, photo_data, created_at) values (${String(record.id)}, ${String(record.vehicleId)}, ${photoMatch[1].toLowerCase()}, ${photoBuffer}, now()) on conflict (record_id) do update set vehicle_id = excluded.vehicle_id, mime_type = excluded.mime_type, photo_data = excluded.photo_data, created_at = excluded.created_at`
        vehicleChange = { before: previousVehicle, after: nextVehicle, mileage }
      } else if (!String(observation || '').trim()) throw new Error('La observación es obligatoria para informar el servicio.')
      if (type === 'Completado') assertServiceCanBeCompleted(record)
      const now = new Date().toISOString()
      const next = { ...record, technicalStatus: type, technicalObservation: String(observation || '').trim() || (completingVehicleControl ? 'Control semanal del vehículo informado.' : ''), technicalReportedAt: now, technicalReportedById: user.id, technicalReportedByName: user.name || user.email || 'Técnico', completedAt: type === 'Completado' ? now : record.completedAt, status: type === 'Completado' ? 'Completado' : 'Requiere revisión', technicianRequest: type === 'Completado' ? '' : type, ...(vehicleChange ? { vehicleMileage: vehicleChange.mileage, vehiclePhotoUrl: `/api/vehicle-control/photo/${encodeURIComponent(String(record.id))}`, vehicleControlReportedAt: now } : {}) }
      await transaction`update pignus_work_history set status = ${next.status}, data = ${transaction.json(next)} where id = ${String(record.id)}`
      const entries = [auditEntry(user, 'Informó estado técnico', 'Servicio / historial', String(record.id), record, next)]
      if (vehicleChange) entries.push(auditEntry(user, 'Actualizó kilometraje por control semanal', 'Vehículo', String(record.vehicleId), vehicleChange.before, vehicleChange.after))
      if (next.status === 'Completado' && normalizedServiceName(next.service).includes('retiro de equipo')) {
        const state = await readState(transaction)
        state.history = state.history.map(item => String(item.id) === String(next.id) ? next : item)
        const normalized = normalizeRetirementCustomers(state)
        if (normalized.conversions.length) {
          await replaceCollections(transaction, normalized.state)
          normalized.conversions.forEach(({ before, after }) => entries.push(auditEntry(user, 'Convirtió abonado en cliente por baja', 'Abonado / Cliente', String(after.customerId), before, after)))
        }
      }
      await appendAudit(transaction, entries)
      await transaction`update pignus_preferences set value = (value::integer + 1)::text, updated_at = now() where key = 'state_revision'`
      return next
    })
    return send(res, 200, { record: updated })
  } catch (error) {
    const databaseBusy = error.code === '55P03' || error.code === '57014'
    return send(res, databaseBusy ? 503 : (error.statusCode || 400), { error: databaseBusy ? 'La base de datos está ocupada. El sistema volverá a intentarlo automáticamente.' : (error.message || 'No se pudo informar el estado.') })
  }
}

async function handleClearAgenda(req, res, sql, user) {
  if (!userCan(user, 'agenda')) return send(res, 403, { error: 'No tenés permiso para limpiar la agenda del día.' })
  const revision = await sql.begin(async transaction => {
    await transaction`select value from pignus_preferences where key = 'state_revision' for update`
    const rows = await transaction`select data from pignus_agendas where id = 'current' for update`
    const previous = rows[0]?.data || {}
    const date = new Date().toISOString().slice(0, 10)
    const teamId = `team-${crypto.createHash('sha256').update(`${date.slice(0, 7)}:0`).digest('hex').slice(0, 20)}`
    const next = { ...previous, date, teams: [{ teamId, memberIds: [], members: [], tasks: [] }] }
    await transaction`insert into pignus_agendas (id, data, updated_at) values ('current', ${transaction.json(next)}, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`
    await appendAudit(transaction, [auditEntry(user, 'Limpió', 'Agenda del día', 'agenda-diaria', previous, next)])
    const result = await transaction`update pignus_preferences set value = (value::integer + 1)::text, updated_at = now() where key = 'state_revision' returning value`
    return Number(result[0].value)
  })
  return send(res, 200, { ok: true, revision })
}

module.exports = async function handler(req, res) {
  try {
    if (process.env.VERCEL && !productionSecretsAreValid()) return send(res, 500, { error: 'La API no tiene configurados secretos de seguridad válidos.' })
    const sql = database()
    const route = routePath(req)
    if (req.method === 'POST' && route === '/auth/login') return await handleLogin(req, res, sql)
    if (req.method === 'POST' && route === '/auth/password-reset-requests') return await handlePasswordResetRequest(req, res, sql)
    if (req.method === 'POST' && route === '/auth/logout') return await handleLogout(req, res, sql)
    if (req.method === 'GET' && route === '/auth/session') {
      const session = await sessionContext(req, sql)
      const hadSessionCookie = Boolean(cookies(req.headers.cookie).pignus_session)
      return session
        ? send(res, 200, { user: session.user })
        : send(res, 401, hadSessionCookie
          ? { code: 'SESSION_ENDED', error: 'Esta sesión ya no está activa. La cuenta pudo haberse abierto en otro dispositivo o la sesión pudo haber vencido.' }
          : { code: 'SESSION_REQUIRED', error: 'Sin sesión activa.' })
    }
    const session = await requireSession(req, res, sql)
    if (!session) return
    if (route === '/auth/password-reset-requests') {
      if (session.user.roleCode !== 'administrator') return send(res, 403, { error: 'Las solicitudes de contraseña son exclusivas del rol Administrador.' })
      if (req.method === 'GET') return send(res, 200, { requests: await readPasswordResetRequests(sql) })
      if (req.method === 'DELETE') return await resolvePasswordResetRequest(req, res, sql, session.user)
    }
    if (req.method === 'GET' && route === '/state/revision') return send(res, 200, { revision: await readRevision(sql) })
    if (req.method === 'GET' && route === '/state') return send(res, 200, visibleStateForUser(await readState(sql), session.user))
    if (req.method === 'GET' && route === '/holidays') {
      const year = validHolidayYear(req.query.year)
      if (!year) return send(res, 400, { error: 'El año solicitado no es válido.' })
      try {
        return send(res, 200, { year, holidays: await fetchNationalHolidays(year) })
      } catch (error) {
        console.error('No se pudieron consultar los feriados:', error.message)
        return send(res, 503, { error: error.message })
      }
    }
    if (req.method === 'PUT' && route === '/state') {
      if (session.user.roleCode === 'technician') return send(res, 403, { error: 'El rol técnico no puede modificar la agenda.' })
      return await handleSaveState(req, res, sql, session.user)
    }
    if (req.method === 'GET' && route === '/history/export') {
      if (session.user.roleCode !== 'technician' && !userCan(session.user, 'history')) return send(res, 403, { error: 'No tenés permiso para exportar el historial.' })
      return await handleExport(req, res, sql, session.user)
    }
    if (req.method === 'GET' && route === '/audit') {
      if (session.user.roleCode !== 'administrator') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
      const limit = Math.min(Math.max(Number(req.query.limit) || AUDIT_LOG_LIMIT, 1), AUDIT_LOG_LIMIT)
      const rows = await sql`select data from pignus_audit_log order by occurred_at desc limit ${limit}`
      return send(res, 200, { records: rows.map(row => { const { before, after, ...summary } = row.data; return summary }) })
    }
    if (req.method === 'GET' && route.startsWith('/audit/')) {
      if (session.user.roleCode !== 'administrator') return send(res, 403, { error: 'La auditoría es exclusiva del rol Administrador.' })
      const id = decodeURIComponent(route.slice('/audit/'.length))
      const rows = await sql`select data from pignus_audit_log where id = ${id}`
      return rows[0] ? send(res, 200, { record: rows[0].data }) : send(res, 404, { error: 'El registro de auditoría no existe.' })
    }
    if (req.method === 'POST' && route === '/technician/status') return await handleTechnicianStatus(req, res, sql, session.user)
    if (req.method === 'GET' && route.startsWith('/vehicle-control/photo/')) return await handleVehicleControlPhoto(req, res, sql, session.user, decodeURIComponent(route.slice('/vehicle-control/photo/'.length)))
    if (['GET', 'POST'].includes(req.method) && route.startsWith('/vehicle-insurance/')) return await handleVehicleInsurance(req, res, sql, session.user, decodeURIComponent(route.slice('/vehicle-insurance/'.length)))
    if (req.method === 'POST' && route === '/agenda/daily/clear') return await handleClearAgenda(req, res, sql, session.user)
    return send(res, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    console.error('Error de API:', error)
    return send(res, 500, { error: 'No se pudo completar la operación.' })
  }
}
