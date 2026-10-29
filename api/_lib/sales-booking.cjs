const crypto = require('node:crypto')
const policy = require('./permission-catalog.cjs')
const { workdayForDate, workingEnd } = require('./workday.cjs')
const { customerForRecord } = require('./granular-read-policy.cjs')
const { agendaTaskForScheduleOccupancy } = require('./scheduling-validation.cjs')
const native = require('./native-registration.cjs')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
const time = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const today = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now)
const validPoint = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 85 && Math.abs(value[1]) <= 180 && value.some(Boolean)
function estimate(a, b, env = process.env) {
  if (!validPoint(a) || !validPoint(b)) return null
  const radians = n => n * Math.PI / 180
  const h = Math.sin(radians(b[0] - a[0]) / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(radians(b[1] - a[1]) / 2) ** 2
  const km = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
  const speed = Math.max(5, Math.min(100, Number(env.PIGNUS_SALES_ESTIMATE_KMH) || 25))
  const buffer = Math.max(0, Math.min(120, Number(env.PIGNUS_SALES_BUFFER_MINUTES ?? 15) || 0))
  return { km: Math.round(km * 10) / 10, minutes: Math.ceil((km / speed * 60 + buffer) / 5) * 5, speed, buffer }
}
async function teamsFor(state, day) {
  const weekly = state.agenda?.weekly || {}, stored = weekly[day] || {}
  const { salesDayTeams } = require('./sales-day-teams.cjs')
  let defaults = (weekly._monthlyTeams?.[day.slice(0, 7)]?.teams || []).map(team => ({ ...team, tasks: [] }))
  if (new Date(`${day}T12:00:00Z`).getUTCDay() === 6) {
    const { annualGuardForDate } = await import('../../src/domain/agenda/annual-guards.mjs')
    const guard = annualGuardForDate(day, weekly)
    defaults = guard?.technicianId ? [{ teamId: `sales-guard-${day}`, label: 'Equipo 1', memberIds: [guard.technicianId], members: [guard.name], tasks: [] }] : []
    if (stored.teams?.length) defaults = []
  }
  let teams = salesDayTeams(defaults, stored)
  // History and the daily projection can contain appointments not materialized
  // in the weekly view. Include them for conflict detection, without exposing them.
  const extra = [...(state.history || []).filter(r => r.date === day), ...(state.agenda?.date === day ? (state.agenda.teams || []).flatMap(t => (t.tasks || []).map(r => ({ ...r, teamId: t.teamId, technicianIds: r.technicianIds || t.memberIds }))) : [])]
  const ids = task => [task.id, task.historyId, task.sourceTaskId, task.taskId].filter(Boolean).map(String)
  teams = teams.map(t => ({ ...t, tasks: [...(t.tasks || [])] }))
  for (const record of extra) {
    if (teams.some(t => t.tasks.some(task => ids(task).some(id => ids(record).includes(id))))) continue
    let team = teams.find(t => String(t.teamId) === String(record.teamId))
    if (!team) { team = { teamId: record.teamId || `history-${record.id}`, memberIds: record.technicianIds || [], members: record.technicians || [], tasks: [], occupancyOnly: true }; teams.push(team) }
    team.tasks.push(record)
  }
  return teams
}
function pointFor(record, state) {
  if (validPoint(record.visitLocation?.coordinates) && record.visitLocation.address === record.address) return record.visitLocation.coordinates
  const customer = customerForRecord(record, state)
  if (validPoint(customer?.locationOverride)) return customer.locationOverride
  const match = String(customer?.fields?.['Ubicación de la cuenta'] || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  const point = match?.slice(1).map(Number)
  return validPoint(point) ? point : null
}
async function availability(state, input, { now = new Date(), holidays, env = process.env } = {}) {
  const day = String(input.date || ''), duration = Number(input.estimatedMinutes)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day || day < today(now) || day > new Date(now.getTime() + 180 * 86400000).toISOString().slice(0, 10)) fail('Elegí una fecha desde hoy y dentro de los próximos 180 días.')
  if (!Number.isInteger(duration) || duration < 60 || duration > 720 || duration % 15) fail('Elegí una duración entre 60 y 720 minutos, en pasos de 15.')
  if (!validPoint(input.coordinates) || input.locationConfirmed !== true) fail('Ubicá la dirección en el mapa y confirmá el punto.')
  const weekly = state.agenda?.weekly || {}, weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  const { findAdvancedSaturdayGuard } = await import('../../src/domain/agenda/weekend-guard.mjs')
  const friday = new Date(`${day}T12:00:00Z`); friday.setUTCDate(friday.getUTCDate() - 1)
  if (!weekday || weekday === 6 && findAdvancedSaturdayGuard({ fridayPlan: weekly[friday.toISOString().slice(0,10)], saturdayPlan: weekly[day] })) return { slots: [], reason: 'La jornada no está disponible para nuevas reservas.' }
  const calendar = holidays ?? await require('./holidays.cjs').fetchNationalHolidays(Number(day.slice(0, 4)))
  if (calendar.some(h => h.date === day) && weekly._holidayOverrides?.[day]?.status !== 'working') return { slots: [], reason: 'Coordinación debe habilitar la jornada del feriado.' }
  const { taskOccupiedInterval } = await import('../../src/domain/agenda/service-scheduling.mjs')
  const teams = await teamsFor(state, day), slots = []
  const currentTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const activeIds = new Set((state.employees || []).filter(e => e.status === 'Activo').map(e => String(e.id)))
  for (const team of teams.filter(t => !t.occupancyOnly && t.teamId && t.memberIds?.length && t.members?.length && t.memberIds.every(id => activeIds.has(String(id))))) {
    const hours = workdayForDate(day, weekly, team.teamId)
    if (!hours) continue
    const max = Math.min(time(hours.end), weekday === 5 ? 16 * 60 : 24 * 60)
    const occupied = teams.flatMap(other => (other.tasks || []).filter(task => {
      const members = task.technicianIds?.length ? task.technicianIds : other.memberIds || []
      return String(other.teamId) === String(team.teamId) || members.some(id => team.memberIds.map(String).includes(String(id)))
    }).filter(task => task.service || task.serviceId).map(task => {
      const full = (state.history || []).find(r => String(r.id) === String(task.historyId || task.id) || r.sourceTaskId && r.sourceTaskId === task.taskId) || task
      const catalogService = (state.services || []).find(s => String(s.id) === String(full.serviceId))
      const active = agendaTaskForScheduleOccupancy({ ...task, ...full, estimatedMinutes: full.estimatedMinutes ?? task.estimatedMinutes ?? catalogService?.estimatedMinutes }, day, state.history || [], today(now))
      return active ? { record: full, members: full.technicianIds?.length ? full.technicianIds.map(String) : (other.memberIds || []).map(String), interval: taskOccupiedInterval(active, hours) } : null
    }).filter(x => x?.interval)).sort((a, b) => a.interval.start - b.interval.start)
    for (let start = Math.ceil(time(hours.bookable) / 15) * 15; start < max; start += 15) {
      if (day === today(now) && start <= time(currentTime)) continue
      const end = workingEnd(start, duration, hours)
      if (end > max || start >= time(hours.breakStart) && start < time(hours.breakEnd)) continue
      if (occupied.some(x => start < x.interval.end && end > x.interval.start)) continue
      // Each member may arrive from a different team. Check every technician's
      // adjacent visit instead of using only the team's latest endpoint.
      const before = [], after = []
      for (const member of team.memberIds.map(String)) {
        const own = occupied.filter(x => x.members.includes(member))
        const beforeEnd = Math.max(-1, ...own.filter(x => x.interval.end <= start).map(x => x.interval.end))
        const afterStart = Math.min(Infinity, ...own.filter(x => x.interval.start >= end).map(x => x.interval.start))
        before.push(...own.filter(x => x.interval.end === beforeEnd))
        after.push(...own.filter(x => x.interval.start === afterStart))
      }
      const previous = before.map(x => estimate(pointFor(x.record, state), input.coordinates, env)), following = after.map(x => estimate(input.coordinates, pointFor(x.record, state), env))
      const travelTime = (from, to) => to - from - Math.max(0, Math.min(to, time(hours.breakEnd)) - Math.max(from, time(hours.breakStart)))
      if (previous.some((x, i) => x && x.minutes > travelTime(before[i].interval.end, start)) || following.some((x, i) => x && x.minutes > travelTime(end, after[i].interval.start))) continue
      slots.push({ teamId: String(team.teamId), teamLabel: team.label || 'Equipo', members: team.members, time: clock(start), end: clock(end), beforeMinutes: previous.length && previous.every(Boolean) ? Math.max(...previous.map(x => x.minutes)) : null, afterMinutes: following.length && following.every(Boolean) ? Math.max(...following.map(x => x.minutes)) : null, reviewLocation: [...previous, ...following].some(x => !x), noPrevious: !before.length, noFollowing: !after.length })
    }
  }
  return { slots: slots.sort((a, b) => a.time.localeCompare(b.time) || a.teamLabel.localeCompare(b.teamLabel)), reason: slots.length ? '' : 'No hay horarios compatibles. Probá otra fecha o consultá con Coordinación.' }
}
async function handle({ connection, kind, user, method, input = {}, formState }) {
  if (!policy.can(user, 'sales.view') || method === 'POST' && !policy.can(user, 'sales.reserve')) fail('No tenés permiso para gestionar reservas de ventas.', 403)
  if (!['GET', 'POST'].includes(method)) fail('Método no permitido.', 405)
  const base = native.createStore({ [kind]: connection }); await base.ensure()
  return require('./tickets-http.cjs').storeFor(connection, kind).transaction(async q => {
    const state = await formState.load(q.connection), store = native.createStore({ [kind]: q.connection })
    const owns = r => r.salesBooking && (policy.roleCode(user) === 'administrator' || String(r.salesBooking.byId) === String(user.id))
    async function projection(r) {
      const form = (await store.list()).find(f => f.id === native.keyFor(r) || f.service_id === String(r.id))
      return { id: r.id, client: r.client, address: r.address, date: r.date, time: r.time, team: r.team, status: r.status, awaitingConfirmation: r.awaitingConfirmation, form: r.form, reviewLocation: r.salesBooking.reviewLocation, link: form && r.status !== 'Cancelado' && form.status !== 'submitted' ? `/alta#${native.unseal(form.token_secret, `${form.id}:link`)}` : '' }
    }
    if (method === 'GET') return { items: await Promise.all((state.history || []).filter(owns).sort((a, b) => b.salesBooking.createdAt.localeCompare(a.salesBooking.createdAt)).map(projection)) }
    if (input.action === 'slots') return availability(state, input)
    if (input.action !== 'reserve') fail('Acción inválida.')
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '')) fail('Identificador de reserva inválido.')
    const id = `sale-${crypto.createHash('sha256').update(`${user.id}:${input.requestId}`).digest('hex')}`
    const existing = (state.history || []).find(r => r.id === id)
    if (existing) return { reservation: await projection(existing) }
    const text = (key, max) => { const value = String(input[key] || '').trim(); if (!value || value.length > max) fail(`Completá ${key === 'client' ? 'el nombre' : key === 'phone' ? 'el teléfono' : 'la dirección'} correctamente.`); return value }
    const client = text('client', 160), phone = text('phone', 60), address = text('address', 300)
    if (!['docta', 'nobu-town', 'residencial'].includes(input.installationZone)) fail('Elegí el formulario de la instalación.')
    const service = (state.services || []).find(s => s.status === 'Activo' && native.isInstallation({ service: s.name }))
    if (!service) fail('No hay un tipo de servicio Instalación de alarma activo.')
    const { slots } = await availability(state, input)
    const selected = slots.find(s => s.teamId === input.teamId && s.time === input.time)
    if (!selected) fail('El horario ya no está disponible. Volvé a consultar las opciones.', 409)
    const teams = await teamsFor(state, input.date), team = teams.find(t => String(t.teamId) === selected.teamId), at = new Date().toISOString()
    const record = { id, sourceTaskId: `${id}-task`, date: input.date, time: selected.time, scheduledTime: selected.time, teamId: team.teamId, team: team.label, technicianIds: team.memberIds, technicians: team.members, serviceId: service.id, service: service.name, estimatedMinutes: Number(input.estimatedMinutes), estimatedMinutesCustomized: true, client, clientNameAtService: client, customerId: '', clientAccount: '', address, phone, detail: String(input.detail || '').trim().slice(0, 2000) || 'Instalación coordinada por Ventas.', installationZone: input.installationZone, subscriberReservation: true, awaitingConfirmation: true, status: 'Pendiente', form: 'Pendiente', formEmail: '', visitLocation: { coordinates: input.coordinates, address, confirmedAt: at, byId: String(user.id) }, createdAt: at, createdBy: { id: user.id, name: user.name, role: user.role, at }, salesBooking: { byId: String(user.id), byName: user.name, createdAt: at, reviewLocation: selected.reviewLocation, estimate: selected } }
    const next = structuredClone(state); next.history ||= []; next.history.push(record); next.agenda ||= {}; next.agenda.weekly ||= {}
    const task = { ...record, taskId: record.sourceTaskId, historyId: id }
    const add = list => { const rows = structuredClone(list || []); let target = rows.find(t => String(t.teamId) === String(team.teamId)); if (!target) { target = { teamId: team.teamId, label: team.label, members: team.members, memberIds: team.memberIds, tasks: [] }; rows.push(target) } target.tasks ||= []; target.tasks.push(task); target.tasks.sort((a, b) => String(a.time).localeCompare(String(b.time))); return rows }
    const plan = next.agenda.weekly[input.date] || {}
    next.agenda.weekly[input.date] = { ...plan, teams: add(plan.teams) }
    if (next.agenda.date === input.date) next.agenda.teams = add(next.agenda.teams)
    await store.create(record, input.installationZone, user, next)
    await formState.save(q.connection, state, next, { action: 'Reservó instalación de venta a confirmar', id })
    return { reservation: await projection(record) }
  })
}
module.exports = { estimate, availability, teamsFor, handle, validPoint, pointFor }
