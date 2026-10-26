const { requesterIds } = require('./ticket-requesters.cjs')
const business = require('./ticket-business-clock.cjs')
const PRIORITIES = ['Crítica', 'Alta', 'Media', 'Baja']
const CLOSED = new Set(['Resuelto', 'Fusionado'])
const MINUTE = 60000
const clone = value => JSON.parse(JSON.stringify(value))
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
const iso = value => {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) fail('La fecha del SLA no es válida.')
  return new Date(time).toISOString()
}
const deadline = (start, minutes, policy) => policy.clock === 'business' ? business.addBusinessMinutes(start, minutes, policy.calendar) : new Date(new Date(start).getTime() + minutes * MINUTE).toISOString()

function defaultSlaConfig() {
  return { clock: 'business', calendar: business.calendarForWeekly(), priorities: {
    'Crítica': { firstResponseMinutes: 15, resolutionMinutes: 240, updateMinutes: 60 },
    Alta: { firstResponseMinutes: 60, resolutionMinutes: 1440, updateMinutes: 240 },
    Media: { firstResponseMinutes: 240, resolutionMinutes: 4320, updateMinutes: 1440 },
    Baja: { firstResponseMinutes: 480, resolutionMinutes: 7200, updateMinutes: 2880 }
  } }
}

function validateSlaConfig(input = defaultSlaConfig()) {
  if (!input || !['elapsed','business'].includes(input.clock) || !input.priorities || typeof input.priorities !== 'object') fail('La configuración del SLA debe usar horario laboral y definir las cuatro prioridades.')
  const priorities = {}
  for (const priority of PRIORITIES) {
    const policy = input.priorities[priority]
    if (!policy || typeof policy !== 'object') fail(`Falta definir el SLA de prioridad ${priority}.`)
    const validated = {}
    for (const key of ['firstResponseMinutes', 'resolutionMinutes', 'updateMinutes']) {
      const value = policy[key]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 525600) fail(`Los plazos del SLA de prioridad ${priority} deben ser minutos enteros, entre 1 y 525600.`)
      validated[key] = value
    }
    if (validated.firstResponseMinutes > validated.resolutionMinutes || validated.updateMinutes > validated.resolutionMinutes) fail(`La primera respuesta y el aviso sin novedades no pueden superar el plazo de resolución de prioridad ${priority}.`)
    priorities[priority] = validated
  }
  return { clock: 'business', calendar: clone(input.calendar || business.calendarForWeekly()), priorities }
}

function refreshDeadlines(sla) {
  sla.targets = clone(sla.policy.priorities[sla.priority] || sla.policy.priorities.Media)
  sla.firstResponseDueAt = deadline(sla.startedAt, sla.targets.firstResponseMinutes, sla.policy)
  sla.resolutionDueAt = deadline(sla.startedAt, sla.targets.resolutionMinutes, sla.policy)
  sla.updateDueAt = deadline(sla.lastHumanUpdateAt || sla.startedAt, sla.targets.updateMinutes, sla.policy)
  return sla
}

// Returns the durable snapshot and mutates only ticket.sla. Existing tickets are
// adopted now instead of being retroactively overdue from their creation date.
function initSla(ticket, config, now = new Date().toISOString()) {
  if (ticket.sla?.version === 1) {
    const saved=ticket.sla
    if(saved.clock!=='business'&&!CLOSED.has(ticket.status)) {
      saved.clockMigration={at:iso(now),from:saved.clock||'elapsed',firstResponseDueAt:saved.firstResponseDueAt,resolutionDueAt:saved.resolutionDueAt,updateDueAt:saved.updateDueAt}
      saved.policy={...saved.policy,clock:'business',calendar:clone(config?.sla?.calendar||business.calendarForWeekly())}
      saved.clock='business'
      refreshDeadlines(saved)
    }
    return saved
  }
  const startedAt = iso(now)
  const policy = validateSlaConfig(config?.sla || defaultSlaConfig())
  const closed = CLOSED.has(ticket.status)
  ticket.sla = refreshDeadlines({ version: 1, clock: 'business', policy, priority: PRIORITIES.includes(ticket.priority) ? ticket.priority : 'Media', cycle: 1, startedAt,
    adoptedAt: ticket.createdAt && iso(ticket.createdAt) !== startedAt ? startedAt : '',
    firstResponseAt: '', lastHumanUpdateAt: '', completedAt: closed ? startedAt : '', excluded: closed,
    history: [] })
  return ticket.sla
}

const HUMAN_ACTIONS = new Set(['comment', 'reply', 'assign', 'classify', 'wait', 'resume', 'resolve', 'linkService', 'scheduleService', 'rescheduleService', 'serviceScheduled', 'serviceRescheduled'])
function transitionSla(ticket, previous, action, config, now = new Date().toISOString(), options = {}) {
  const at = iso(now)
  if (!ticket.sla && previous?.sla) ticket.sla = clone(previous.sla)
  if(ticket.sla&&previous&&!CLOSED.has(previous.status)&&ticket.sla.clock!=='business') {
    const active={...ticket,status:previous.status}
    ticket.sla=initSla(active,config,at)
  }
  if (!ticket.sla && previous) {
    const adoption = { ...ticket, status: previous.status }
    ticket.sla = initSla(adoption, config, at)
  }
  const reopened = previous && CLOSED.has(previous.status) && !CLOSED.has(ticket.status)
  // Snapshot the closed cycle before migrating its clock for a reopening.
  const previousCycle = reopened && ticket.sla ? clone(ticket.sla) : null
  let sla = initSla(ticket, config, at)
  if (reopened) {
    const { history, policy, ...cycle } = previousCycle || sla
    sla = ticket.sla = { ...sla, cycle: sla.cycle + 1, startedAt: at, firstResponseAt: '', lastHumanUpdateAt: '', completedAt: '', excluded: false,
      history: [...history, { ...cycle, completedAt: cycle.completedAt || previous.resolvedAt || at }] }
  }
  sla.priority = PRIORITIES.includes(ticket.priority) ? ticket.priority : sla.priority
  const actorId = String(options.actorId || '')
  const ownComment = ['comment', 'reply'].includes(action) && (!actorId || requesterIds(ticket).includes(actorId))
  if (options.humanUpdate === true && HUMAN_ACTIONS.has(action) && !ownComment && at >= sla.startedAt) {
    if (!sla.firstResponseAt || at < sla.firstResponseAt) sla.firstResponseAt = at
    if (!sla.lastHumanUpdateAt || at > sla.lastHumanUpdateAt) sla.lastHumanUpdateAt = at
  }
  if (CLOSED.has(ticket.status)) sla.completedAt ||= at
  else sla.completedAt = ''
  return refreshDeadlines(sla)
}

function slaView(ticket, now = new Date().toISOString()) {
  const sla = ticket.sla
  if (!sla || sla.version !== 1) return { status: 'not-started', clock: 'business' }
  const at = new Date(iso(now)).getTime(), closed = CLOSED.has(ticket.status)
  const outcome = (dueAt, completedAt) => {
    const end = completedAt ? new Date(completedAt).getTime() : at
    const remaining = sla.clock==='business' ? business.businessMinutesBetween(end,dueAt,sla.policy.calendar) : (new Date(dueAt).getTime()-end)/MINUTE
    const remainingMinutes = Math.ceil(remaining), breached=remaining<0
    return { dueAt, completedAt: completedAt || '', remainingMinutes, breached, status: completedAt ? (breached ? 'late' : 'met') : (end>=new Date(dueAt).getTime() ? 'overdue' : 'pending') }
  }
  const firstResponse = outcome(sla.firstResponseDueAt, sla.firstResponseAt)
  if (closed && !sla.firstResponseAt && ticket.origin !== 'email') firstResponse.status = 'unanswered'
  const resolution = outcome(sla.resolutionDueAt, closed ? sla.completedAt : '')
  const update = outcome(sla.updateDueAt, closed ? sla.completedAt : '')
  return { status: sla.excluded ? 'excluded' : closed ? 'closed' : [firstResponse, resolution, update].some(item => item.status === 'overdue') ? 'overdue' : 'on-track',
    clock: sla.clock, calendar: sla.clock==='business'?clone(sla.policy.calendar):undefined, cycle: sla.cycle, startedAt: sla.startedAt, adoptedAt: sla.adoptedAt, priority: sla.priority,
    firstResponse, resolution, update, targets: clone(sla.targets), waitingDoesNotPause: true }
}

// Deduplicate these keys in durable storage. Reminders never move the deadline;
// only a genuine staff update starts the next inactivity interval.
function dueReminders(ticket, now = new Date().toISOString()) {
  if (CLOSED.has(ticket.status) || !ticket.sla || ticket.sla.excluded) return []
  const view = slaView(ticket, now)
  if(view.clock==='business') {
    const current=new Date(now).getTime(),window=business.windowForDate(business.localDate(current),ticket.sla.policy.calendar)
    if(!window||current<window[0]||current>=window[1])return []
  }
  return [['first-response', view.firstResponse], ['resolution', view.resolution], ['update', view.update]]
    .filter(([, target]) => target?.status === 'overdue')
    .map(([type, target]) => ({ key: `sla:${ticket.id}:${view.cycle}:${type}:${target.dueAt}`, type, dueAt: target.dueAt, cycle: view.cycle }))
}

module.exports = { defaultSlaConfig, validateSlaConfig, initSla, transitionSla, slaView, dueReminders }
