const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const team = (memberId, memberName, tasks) => ({ memberIds: memberId ? [memberId] : [], members: memberName ? [memberName] : [], tasks })
const service = (time, client = 'PIG-7002 CLIENTE') => ({ time, customerId: 'customer-1', serviceId: 'service-1', client, service: 'Service de alarma' })
const available = time => ({ time, client: '', service: '' })

test('la guardia del sábado se considera adelantada por el mismo técnico el viernes desde las 16', async () => {
  const { findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability, advancedSaturdayGuardMessage } = await import('../src/weekend-guard.mjs')
  const fridayPlan = { teams: [team('tech-1', 'Santos Díaz', [service('16:00')])] }
  const saturdayPlan = { teams: [team('tech-1', 'Santos Díaz', [available('08:30')])] }
  const advance = findAdvancedSaturdayGuard({ fridayPlan, saturdayPlan })

  assert.equal(advance.displayName, 'Santos')
  assert.equal(advance.hasSaturdayConflict, false)
  assert.deepEqual(suppressAdvancedSaturdayAvailability(saturdayPlan, advance).teams, [])
  assert.match(advancedSaturdayGuardMessage(advance), /Santos.*viernes.*16:00.*sábado/i)
})

test('infiere el técnico de guardia desde el viernes cuando el sábado todavía está sin asignar', async () => {
  const { findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability } = await import('../src/weekend-guard.mjs')
  const fridayPlan = { teams: [team('tech-1', 'Santos Díaz', [service('17:30')])] }
  const saturdayPlan = { teams: [team('', '', [available('08:30')])] }
  const advance = findAdvancedSaturdayGuard({ fridayPlan, saturdayPlan })

  assert.equal(advance.technicianId, 'tech-1')
  assert.equal(advance.displayName, 'Santos')
  assert.deepEqual(suppressAdvancedSaturdayAvailability(saturdayPlan, advance).teams, [])
})

test('no bloquea el sábado antes de las 16', async () => {
  const { findAdvancedSaturdayGuard } = await import('../src/weekend-guard.mjs')
  const saturdayPlan = { teams: [team('tech-1', 'Santos Díaz', [available('08:30')])] }
  assert.equal(findAdvancedSaturdayGuard({ fridayPlan: { teams: [team('tech-1', 'Santos Díaz', [service('15:59')])] }, saturdayPlan }), null)
})

test('mantiene la guardia del viernes aunque intenten asignar otro técnico el sábado', async () => {
  const { findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability } = await import('../src/weekend-guard.mjs')
  const fridayPlan = { teams: [team('tech-leo', 'Leonardo Rivadelo', [service('16:30')])] }
  const saturdayPlan = {
    teams: [
      team('tech-rodrigo', 'Rodrigo González', [available('08:30')]),
      team('tech-santos', 'Santos Díaz', [available('10:00')])
    ]
  }
  const advance = findAdvancedSaturdayGuard({ fridayPlan, saturdayPlan })

  assert.equal(advance.technicianId, 'tech-leo')
  assert.equal(advance.displayName, 'Leonardo')
  assert.deepEqual(suppressAdvancedSaturdayAvailability(saturdayPlan, advance).teams, [])
})

test('admite coincidencia por nombre normalizado cuando faltan identificadores', async () => {
  const { findAdvancedSaturdayGuard } = await import('../src/weekend-guard.mjs')
  const advance = findAdvancedSaturdayGuard({
    fridayPlan: { teams: [team('', 'Santos Díaz', [service('20:00')])] },
    saturdayPlan: { teams: [team('', 'Santos Díaz', [available('08:30')])] }
  })
  assert.equal(advance.fridayTime, '20:00')
})

test('conserva y denuncia un servicio real ya cargado el sábado', async () => {
  const { findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability, advancedSaturdayGuardMessage } = await import('../src/weekend-guard.mjs')
  const saturdayService = service('09:00', 'PIG-8000 CLIENTE SABADO')
  const saturdayPlan = { teams: [team('tech-1', 'Santos Díaz', [available('08:30'), saturdayService])] }
  const advance = findAdvancedSaturdayGuard({ fridayPlan: { teams: [team('tech-1', 'Santos Díaz', [service('18:30')])] }, saturdayPlan })
  const visible = suppressAdvancedSaturdayAvailability(saturdayPlan, advance)

  assert.equal(advance.hasSaturdayConflict, true)
  assert.deepEqual(visible.teams[0].tasks, [saturdayService])
  assert.match(advancedSaturdayGuardMessage(advance), /conflicto/i)
})

test('conserva servicios reales de cualquier equipo pero elimina todos los equipos vacíos', async () => {
  const { findAdvancedSaturdayGuard, suppressAdvancedSaturdayAvailability } = await import('../src/weekend-guard.mjs')
  const saturdayService = service('09:30', 'PIG-9000 CONFLICTO')
  const saturdayPlan = {
    teams: [
      team('tech-2', 'Rodrigo González', [available('08:30')]),
      team('tech-3', 'Santos Díaz', [available('10:00'), saturdayService])
    ]
  }
  const advance = findAdvancedSaturdayGuard({ fridayPlan: { teams: [team('tech-1', 'Leonardo Rivadelo', [service('18:30')])] }, saturdayPlan })
  const visible = suppressAdvancedSaturdayAvailability(saturdayPlan, advance)

  assert.equal(visible.teams.length, 1)
  assert.deepEqual(visible.teams[0].tasks, [saturdayService])
})

test('Agenda semanal y Agenda del día bloquean vías alternativas de carga', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  assert.match(source, /const advancedGuard = useMemo\(\(\) => advancedGuardForSaturdayDate\(date, weekly, teams\)/)
  assert.match(source, /if \(advancedGuard\) \{\s*setNotice\(advancedSaturdayGuardMessage\(advancedGuard\)\)\s*return/)
  assert.match(source, /Agenda del sábado bloqueada/)
  assert.match(source, /const toggleWeeklyTech[\s\S]*?const advance = advancedGuardForDay\(day\)/)
  assert.match(source, /const saveTaskEditor[\s\S]*?const advance = advancedGuardForDay\(day\)/)
})
