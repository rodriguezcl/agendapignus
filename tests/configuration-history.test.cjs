const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('conserva una copia inmutable del antes, después, período y administrador', async () => {
  const { appendConfigurationHistory } = await import('../src/configuration-history.mjs')
  const before = [{ label: 'Equipo 1', technicians: ['Rodrigo', 'Pascual'] }]
  const after = [{ label: 'Equipo 1', technicians: ['Rodrigo', 'Mariano'] }]
  const history = appendConfigurationHistory([], {
    type: 'teams',
    period: '2026-09',
    before,
    after,
    user: { id: 'admin-1', name: 'Leonardo Rodríguez', email: 'admin@pignus.test' },
    at: '2026-09-01T12:00:00.000Z',
    id: 'change-1'
  })

  before[0].technicians[1] = 'Modificado después'
  assert.equal(history.length, 1)
  assert.equal(history[0].period, '2026-09')
  assert.equal(history[0].user.name, 'Leonardo Rodríguez')
  assert.deepEqual(history[0].before[0].technicians, ['Rodrigo', 'Pascual'])
  assert.deepEqual(history[0].after[0].technicians, ['Rodrigo', 'Mariano'])
})

test('no agrega movimientos cuando la configuración no cambió', async () => {
  const { appendConfigurationHistory } = await import('../src/configuration-history.mjs')
  const current = [{ id: 'existing' }]
  const snapshot = [{ position: 1, technician: 'Rodrigo' }]
  assert.equal(appendConfigurationHistory(current, { type: 'guards', period: '2026', before: snapshot, after: snapshot }), current)
})

test('las capturas conservan nombres aunque luego cambie la dotación o la flota', async () => {
  const { guardConfigurationSnapshot, teamConfigurationSnapshot, vehicleConfigurationSnapshot } = await import('../src/configuration-history.mjs')
  assert.deepEqual(teamConfigurationSnapshot([{ label: 'Equipo 1', memberIds: ['t1'], members: ['Rodrigo González'] }])[0].technicians, ['Rodrigo González'])
  assert.equal(vehicleConfigurationSnapshot([{ vehicleId: 'v1', technicianId: 't1' }], [{ id: 'v1', brand: 'Ford', model: 'Ka', plate: 'AA123BB' }], [{ id: 't1', name: 'Rodrigo González' }])[0].vehicle, 'Ford Ka · AA123BB')
  assert.equal(guardConfigurationSnapshot([{ technicianId: 't1', name: 'Rodrigo González' }])[0].technician, 'Rodrigo González')
})

test('los tres configuradores muestran su historial específico y registran cada guardado', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'weekly-enhancements.css'), 'utf8')
  assert.match(source, /type: 'teams'[\s\S]*?teamConfigurationSnapshot/)
  assert.match(source, /type: 'vehicles'[\s\S]*?vehicleConfigurationSnapshot/)
  assert.match(source, /type: 'guards'[\s\S]*?guardConfigurationSnapshot/)
  assert.match(source, /ConfigurationHistoryPanel history=\{monthlyTeams\[monthlySetup\.month\]\?\.configurationHistory\} type="teams"/)
  assert.match(source, /ConfigurationHistoryPanel history=\{monthlyTeams\[monthlyVehicleSetup\.month\]\?\.configurationHistory\} type="vehicles"/)
  assert.match(source, /ConfigurationHistoryPanel history=\{weekly\._annualGuards\?\.\[annualGuardSetup\.year\]\?\.configurationHistory\} type="guards"/)
  assert.match(styles, /\.configuration-history-list \{[\s\S]*?overflow-y: auto/)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.configuration-history-list article > div[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/)
})
