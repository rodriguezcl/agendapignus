const test = require('node:test')
const assert = require('node:assert/strict')
const { baseProducts } = require('../shared/product-catalog.cjs')
const { productName } = require('../shared/product-name.cjs')
const { prepareServiceMaterials } = require('../api/_lib/service-materials.cjs')
const { assertCompletedServiceChange } = require('../api/_lib/completed-service-policy.cjs')
const { visibleTechnicianStateForUser } = require('../api/_lib/core.cjs')

const product = baseProducts.find(item => item.brand === 'Garnet' && item.kind === 'sensor')
const line = { productId: product.id, model: product.model, brand: product.brand, name: productName(product), quantity: 2 }
const day = '2099-01-05'
function example() {
  const record = { id: 'h1', sourceTaskId: 't1', date: day, customerId: 'c', technicianIds: ['t'], status: 'Pendiente' }
  const team = { teamId: 'team', tasks: [{ ...record, historyId: 'h1', taskId: 't1' }] }
  return { agenda: { date: day, teams: [team], weekly: { [day]: { teams: [structuredClone(team)] } } }, history: [record] }
}
const copies = state => [state.history[0], state.agenda.teams[0].tasks[0], state.agenda.weekly[day].teams[0].tasks[0]]

test('el servicio conserva la entrega del catálogo en historial, agenda semanal y diaria', () => {
  const initial = example()
  initial.agenda.teams[0].tasks = [{ sourceTaskId: 't1' }]
  initial.agenda.weekly[day].teams[0].tasks = [{ sourceHistoryId: 'h1' }]
  initial.agenda.weekly[day].teams[0].tasks[0].materials = [{ productId: product.id, quantity: 2 }]
  const plan = prepareServiceMaterials(initial, {})
  assert.ok(plan.needsCatalog)
  const saved = plan.apply()
  for (const row of copies(saved)) assert.deepEqual(row.materials, [line])
  assert.equal(initial.history[0].materials, undefined)
  assert.strictEqual(prepareServiceMaterials(saved, saved).apply(), saved)

  const olderClient = example()
  for (const row of copies(prepareServiceMaterials(olderClient, saved).apply())) assert.deepEqual(row.materials, [line])
  const edit = structuredClone(saved)
  edit.history[0].materials[0].quantity = 3
  const changed = prepareServiceMaterials(edit, saved)
  assert.equal(changed.needsCatalog, false)
  for (const row of copies(changed.apply([{ ...product, active: false, model: 'Renombrado' }]))) assert.deepEqual(row.materials, [{ ...line, quantity: 3 }])

  const cleared = structuredClone(saved)
  cleared.history[0].materials = []
  for (const row of copies(prepareServiceMaterials(cleared, saved).apply())) assert.deepEqual(row.materials, [])
})

test('rechaza cantidades inválidas, repetidos, desconocidos, bajas, datos desactualizados y asignaciones contradictorias', () => {
  for (const items of [null, {}, [null], [line, line], ...[0, 1.2, '3', -1].map(quantity => [{ ...line, quantity }])]) {
    const state = example()
    state.history[0].materials = items
    assert.throws(() => prepareServiceMaterials(state, {}).apply(), { code: 'SERVICE_MATERIAL_INVALID' })
  }
  const state = example()
  state.history[0].materials = [line]
  assert.throws(() => prepareServiceMaterials(state, {}).apply([{ ...product, active: false }]), { code: 'SERVICE_MATERIAL_INVALID' })
  assert.throws(() => prepareServiceMaterials(state, {}).apply([{ ...product, model: 'Referencia actualizada' }]), { code: 'SERVICE_MATERIAL_PRODUCT_CHANGED' })
  state.agenda.teams[0].tasks[0].materials = [{ ...line, quantity: 1 }]
  assert.throws(() => prepareServiceMaterials(state, {}), { code: 'SERVICE_MATERIAL_CONFLICT' })
  state.history[0].materials = [{ productId: 'custom:inexistente', quantity: 1 }]
  delete state.agenda.teams[0].tasks[0].materials
  assert.throws(() => prepareServiceMaterials(state, {}).apply(), { code: 'SERVICE_MATERIAL_INVALID' })
})

test('una reasignación y el guardado de un borrador previo conservan los productos retirados del catálogo', () => {
  const previous = example()
  for (const row of copies(previous)) row.materials = [line]
  const next = structuredClone(previous)
  const moved = '2099-01-06'
  next.history[0].date = moved
  next.agenda.teams[0].tasks = []
  next.agenda.weekly[moved] = next.agenda.weekly[day]
  delete next.agenda.weekly[day]
  delete next.agenda.weekly[moved].teams[0].tasks[0].materials
  const result = prepareServiceMaterials(next, previous).apply()
  assert.deepEqual(result.agenda.weekly[moved].teams[0].tasks[0].materials, [line])
  previous.history = []
  for (const task of [previous.agenda.teams[0].tasks[0], previous.agenda.weekly[day].teams[0].tasks[0]]) delete task.historyId
  const saved = prepareServiceMaterials(example(), previous)
  assert.equal(saved.needsCatalog, false)
  assert.deepEqual(saved.apply().history[0].materials, [line])
})

test('también se entregan los productos dados de alta por Administración', () => {
  const item = { ...product, id: 'custom:local', model: 'NUEVO', brand: 'Marca local', description: 'Inalámbrico' }
  const state = example()
  state.history[0].materials = [{ productId: item.id, quantity: 1 }]
  const saved = prepareServiceMaterials(state, {}).apply([item])
  assert.deepEqual(saved.history[0].materials, [{ productId: item.id, quantity: 1, model: item.model, brand: item.brand, name: productName(item) }])
})

test('los técnicos ven su entrega y los servicios completados la conservan', () => {
  const state = { ...example(), roles: [], employees: [], vehicles: [], services: [], customers: [{ customerId:'c', account:'PIG-1' }] }
  const own = { ...state.history[0], materials: [line] }
  const related = { ...own, id: 'h2', technicianIds: ['otro'] }
  state.history = [own, related]
  const visible = visibleTechnicianStateForUser(state, { id: 't', roleCode: 'technician' })
  assert.deepEqual(visible.history.find(row => row.id === 'h1').materials, [line])
  assert.ok(visible.history.some(row => row.id === 'h2'))
  assert.equal(visible.history.find(row => row.id === 'h2').materials, undefined)
  const completed = { ...own, status: 'Completado' }
  assert.throws(() => assertCompletedServiceChange(completed, { ...completed, materials: [] }), { code: 'COMPLETED_SERVICE_LOCKED' })
})

test('la gestión de Historial conserva la entrega y la agenda reconstruida muestra los materiales', () => {
  const { restoreServiceProposal } = require('../api/_lib/endpoint-policy.cjs')
  const { rebuildWeeklyFromHistory } = require('../scripts/rebuild-weekly-from-history.cjs')
  const admin = { id: 'a', roleCode: 'administrator' }
  const initial = example()
  const record = { ...initial.history[0], materials: [line], teamId: 'team', team: 'Equipo 1', service: 'Instalación', time: '10:30' }
  assert.deepEqual(restoreServiceProposal(record, { status: 'Pendiente' }, admin).materials, record.materials)
  assert.throws(() => restoreServiceProposal(record, { materials: [] }, admin), { code: 'SERVICE_MATERIAL_HISTORY' })
  const db = new (require('node:sqlite').DatabaseSync)(':memory:')
  try {
    db.exec('CREATE TABLE agendas(id TEXT PRIMARY KEY, data TEXT); CREATE TABLE work_history(data TEXT); CREATE TABLE employees(data TEXT); CREATE TABLE preferences(key TEXT PRIMARY KEY, value TEXT)')
    db.prepare('INSERT INTO agendas VALUES (?,?)').run('current', '{}')
    db.prepare('INSERT INTO work_history VALUES (?)').run(JSON.stringify(record))
    assert.equal(rebuildWeeklyFromHistory(db, day).tasks, 1)
    const { weekly } = JSON.parse(db.prepare('SELECT data FROM agendas').get().data)
    assert.deepEqual(weekly[day].teams[0].tasks[0].materials, [line])
  } finally { db.close() }
})
