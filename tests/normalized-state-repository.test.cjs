const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildShadowCandidate, insertShadowCandidate } = require('../api/_lib/normalization-rehearsal.cjs')
const { readNormalizedState, synchronizeNormalizedState } = require('../api/_lib/normalized-state-repository.cjs')

function fixture() {
  return { revision: 1, roles: [{ id: 'r', name: 'Rol', permissions: { agenda: true } }], employees: [{ id: 'e', roleId: 'r', name: 'Técnico', passwordHash: 'SECRET' }],
    customers: [{ customerId: 'c', account: 'CLI-1', name: 'Cliente', fields: { Campo: 'Valor' } }], services: [{ id: 's', code: 'service', name: 'Servicio', estimatedMinutes: 60 }], vehicles: [], reviews: [],
    history: [{ id: 'h', sourceTaskId: 't', date: '2026-09-09', time: '09:00', scheduledTime: '09:00', estimatedMinutes: 60, estimatedMinutesCustomized: false,
      status: 'Pendiente', customerId: 'c', serviceId: 's', teamId: 'team', technicianIds: ['e'], technicians: ['Técnico'], client: 'Cliente', service: 'Servicio', detail: 'Antes', address: '', phone: '', team: 'Equipo 1' }],
    agenda: { date: '2026-09-09', teams: [], weekly: { '': { legacy: true }, '2026-09-09': { teams: [] } } }, preferences: { theme: 'light' } }
}

const safeState = state => ({ ...state, employees: state.employees.map(({ password, passwordHash, ...employee }) => employee) })

async function applyAndVerify(pg, previous, mutate) {
  const next = structuredClone(previous)
  next.revision = previous.revision + 1
  mutate(next)
  await synchronizeNormalizedState(pg, previous, next)
  assert.deepEqual(await readNormalizedState(pg), safeState(next))
  return next
}

test('normalized repository projects the application state and synchronizes only a changed record', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture()
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    const projected = await readNormalizedState(pg)
    assert.deepEqual(projected, { ...previous, employees: previous.employees.map(({ passwordHash, ...employee }) => employee) })
    const next = structuredClone(previous)
    next.revision = 2
    next.history[0].detail = 'Después'
    const result = await synchronizeNormalizedState(pg, previous, next)
    assert.equal(result.idempotent, false)
    assert.equal((await readNormalizedState(pg)).history[0].detail, 'Después')
    assert.equal((await pg.query("select version from normalized_shadow.jobs where id = 'h'")).rows[0].version, 2)
    assert.equal((await synchronizeNormalizedState(pg, previous, next)).idempotent, true)
  } finally { await pg.close() }
})

test('crea y elimina las credenciales después de resolver la clave foránea del empleado', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture()
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    const withSupervisor = structuredClone(previous)
    withSupervisor.revision = 2
    withSupervisor.roles.push({ id: 'supervisor-role', code: 'supervisor', name: 'Supervisor', permissions: { history: true } })
    withSupervisor.employees.push({ id: 'supervisor-employee', roleId: 'supervisor-role', role: 'Supervisor', name: 'Yeiko Marcano', email: 'yeiko@example.com', status: 'Activo', passwordHash: 'SUPERVISOR_HASH' })

    await synchronizeNormalizedState(pg, previous, withSupervisor)

    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.employees where id = 'supervisor-employee'")).rows[0].count, 1)
    assert.equal((await pg.query("select password_hash from normalized_shadow.employee_credentials where employee_id = 'supervisor-employee'")).rows[0].password_hash, 'SUPERVISOR_HASH')

    const withoutSupervisor = structuredClone(withSupervisor)
    withoutSupervisor.revision = 3
    withoutSupervisor.employees = withoutSupervisor.employees.filter(employee => employee.id !== 'supervisor-employee')
    withoutSupervisor.roles = withoutSupervisor.roles.filter(role => role.id !== 'supervisor-role')
    await synchronizeNormalizedState(pg, withSupervisor, withoutSupervisor)

    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.employee_credentials where employee_id = 'supervisor-employee'")).rows[0].count, 0)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.employees where id = 'supervisor-employee'")).rows[0].count, 0)
  } finally { await pg.close() }
})

test('normalized writes fail closed when the imported fingerprint is not the expected base', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture(), next = structuredClone(previous)
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    await pg.query("update normalized_shadow.import_batch set source_fingerprint = 'different'")
    next.revision = 2
    await assert.rejects(synchronizeNormalizedState(pg, previous, next), { code: 'NORMALIZED_WRITE_CONFLICT' })
    assert.equal((await readNormalizedState(pg)).history[0].detail, 'Antes')
  } finally { await pg.close() }
})

test('reordena equipos planificados y mensuales sin colisionar posiciones transitorias', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture()
    previous.agenda.weekly['2026-09-14'] = { teams: [
      { teamId: 'team-a', memberIds: ['e'], tasks: [] },
      { teamId: 'team-b', memberIds: [], tasks: [] }
    ] }
    previous.agenda.weekly._monthlyTeams = { '2026-09': { teams: [
      { teamId: 'team-a', memberIds: ['e'] },
      { teamId: 'team-b', memberIds: [] }
    ] } }
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    const next = structuredClone(previous)
    next.revision = 2
    next.agenda.weekly['2026-09-14'].teams.reverse()
    next.agenda.weekly._monthlyTeams['2026-09'].teams.reverse()

    await synchronizeNormalizedState(pg, previous, next)

    assert.deepEqual((await pg.query("select team_key from normalized_shadow.planned_teams where scope = 'weekly' and work_date = '2026-09-14' order by position")).rows.map(row => row.team_key), ['team-b', 'team-a'])
    assert.deepEqual((await pg.query("select team_key from normalized_shadow.monthly_teams where period = '2026-09' order by position")).rows.map(row => row.team_key), ['team-b', 'team-a'])
  } finally { await pg.close() }
})

test('transfiere la identidad de tarea cuando cambia el id histórico sin colisión transitoria', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture()
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    const next = structuredClone(previous)
    next.revision = 2
    next.history[0].id = 'h-corregido'
    next.history[0].client = 'CLI-1 Cliente corregido'

    await synchronizeNormalizedState(pg, previous, next)

    const jobs = (await pg.query('select id, source_task_id from normalized_shadow.jobs order by id')).rows
    assert.deepEqual(jobs, [{ id: 'h-corregido', source_task_id: 't' }])
    assert.deepEqual((await readNormalizedState(pg)).history, next.history)
  } finally { await pg.close() }
})

test('normalized writes create and remove one job without changing its siblings', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture(), withSecondJob = structuredClone(previous)
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    withSecondJob.revision = 2
    withSecondJob.history.push({ ...structuredClone(previous.history[0]), id: 'h2', sourceTaskId: 't2', time: '11:00', scheduledTime: '11:00', detail: 'Segundo' })
    await synchronizeNormalizedState(pg, previous, withSecondJob)
    assert.deepEqual((await readNormalizedState(pg)).history.map(item => item.id), ['h', 'h2'])
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.service_assignments where job_id = 'h2'")).rows[0].count, 1)

    const removedAgain = structuredClone(withSecondJob)
    removedAgain.revision = 3
    removedAgain.history = removedAgain.history.filter(item => item.id !== 'h2')
    await synchronizeNormalizedState(pg, withSecondJob, removedAgain)
    assert.deepEqual((await readNormalizedState(pg)).history.map(item => item.id), ['h'])
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.jobs where id = 'h2'")).rows[0].count, 0)
  } finally { await pg.close() }
})

test('normalized synchronization rolls back every prior statement when a constraint fails', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const previous = fixture(), invalid = structuredClone(previous)
    await insertShadowCandidate(pg, buildShadowCandidate(previous))
    invalid.revision = 2
    invalid.roles[0].name = 'Nombre que debe revertirse'
    invalid.employees[0].email = 'duplicado@example.com'
    invalid.employees.push({ id: 'e2', roleId: 'r', name: 'Otro técnico', email: 'duplicado@example.com' })
    await assert.rejects(synchronizeNormalizedState(pg, previous, invalid))
    assert.equal((await pg.query("select name from normalized_shadow.roles where id = 'r'")).rows[0].name, 'Rol')
    assert.equal((await pg.query('select count(*)::int as count from normalized_shadow.employees')).rows[0].count, 1)
    assert.equal((await readNormalizedState(pg)).revision, 1)
  } finally { await pg.close() }
})

test('a stale concurrent normalized write cannot overwrite the first committed change', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    const base = fixture(), first = structuredClone(base), stale = structuredClone(base)
    await insertShadowCandidate(pg, buildShadowCandidate(base))
    first.revision = 2
    first.history[0].detail = 'Primera sesión'
    stale.revision = 2
    stale.history[0].detail = 'Segunda sesión desactualizada'
    await synchronizeNormalizedState(pg, base, first)
    await assert.rejects(synchronizeNormalizedState(pg, base, stale), { code: 'NORMALIZED_WRITE_CONFLICT' })
    const persisted = await readNormalizedState(pg)
    assert.equal(persisted.revision, 2)
    assert.equal(persisted.history[0].detail, 'Primera sesión')
  } finally { await pg.close() }
})

test('the isolated repository preserves the complete operational mutation sequence', async () => {
  const { PGlite } = await import('@electric-sql/pglite'), pg = await PGlite.create()
  try {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8'))
    let current = fixture()
    await insertShadowCandidate(pg, buildShadowCandidate(current))

    current = await applyAndVerify(pg, current, state => state.history.push({ ...structuredClone(state.history[0]), id: 'h2', sourceTaskId: 't2', time: '11:00', scheduledTime: '11:00', detail: 'Alta' }))
    current = await applyAndVerify(pg, current, state => { state.history[0].detail = 'Edición puntual' })
    current = await applyAndVerify(pg, current, state => Object.assign(state.history[0], { date: '2026-09-10', scheduledTime: '13:00', time: '13:00', teamId: 'team-2', team: 'Equipo 2' }))
    current = await applyAndVerify(pg, current, state => Object.assign(state.history[0], { status: 'Completado', completedAt: '2026-09-10T14:00:00.000Z' }))
    current = await applyAndVerify(pg, current, state => { state.history = state.history.filter(record => record.id !== 'h2') })
    current = await applyAndVerify(pg, current, state => state.customers.push({ customerId: 'c2', account: 'CLI-2', name: 'Importado', fields: { Localidad: 'Córdoba' } }))
    current = await applyAndVerify(pg, current, state => { state.agenda.weekly._monthlyTeams = { '2026-10': { defaultTimes: ['08:30', '13:00'], teams: [{ teamId: 'monthly-1', memberIds: ['e'], label: 'Equipo 1' }] } } })
    current = await applyAndVerify(pg, current, state => {
      state.services.push({ id: 's2', code: 'temporary', name: 'Servicio temporal', estimatedMinutes: 30 })
      state.vehicles.push({ id: 'v', plate: 'AA000AA', brand: 'Renault', model: 'Kangoo', mileage: 1000 })
    })
    current = await applyAndVerify(pg, current, state => state.history.push({ id: 'vc', sourceTaskId: 't-vc', date: '2026-09-11', time: '16:00', estimatedMinutes: 15,
      status: 'Pendiente', serviceId: 's', teamId: 'vehicle-team', technicianIds: ['e'], vehicleControl: true, vehicleId: 'v', vehicleControlScheduledFriday: '2026-09-11', detail: 'Control' }))
    current = await applyAndVerify(pg, current, state => {
      state.vehicles[0].mileage = 1100
      Object.assign(state.history.find(record => record.id === 'vc'), { status: 'Completado', completedAt: '2026-09-11T16:15:00.000Z', vehicleMileage: 1100, technicalStatus: 'Completado' })
    })
    current = await applyAndVerify(pg, current, state => {
      state.history = state.history.filter(record => record.id !== 'vc')
      state.vehicles = []
      state.services = state.services.filter(service => service.id !== 's2')
      state.customers = state.customers.filter(customer => customer.customerId !== 'c2')
    })
    current = await applyAndVerify(pg, current, state => {
      state.reviews.push({ id: 'review-1', score: 5, comment: 'Conforme' })
      state.agenda.weekly['2026-09-14'] = { teams: [{ teamId: 'plan-team', memberIds: ['e'], label: 'Equipo 1', tasks: [{ id: 'slot-1', time: '08:30', status: 'Disponible' }] }] }
    })

    assert.equal((await pg.query("select version from normalized_shadow.jobs where id = 'h'")).rows[0].version, 4)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.customers where id = 'c2'")).rows[0].count, 0)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.jobs where id = 'vc'")).rows[0].count, 0)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.monthly_teams where period = '2026-10'")).rows[0].count, 1)
    assert.equal((await pg.query("select count(*)::int as count from normalized_shadow.planned_slots where id is not null")).rows[0].count, 1)
    assert.equal(current.revision, 13)
  } finally { await pg.close() }
})
