const { isDeepStrictEqual } = require('node:util')

const hasMaterials = row => row?.materials !== undefined
const id = value => value == null ? '' : String(value)
const invalid = message => Object.assign(new Error(message), { statusCode: 400, code: 'SERVICE_MATERIAL_INVALID' })

// Link the history record to its weekly and daily cards, including drafts
// which have a task ID before their history row is created.
function groupedServices(state, historyByTask) {
  const groups = new Map()
  function add(key, row) {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  for (const record of state?.history || []) {
    add('history:' + record.id, record)
  }
  const addTeams = (day, teams) => {
    for (const team of teams || []) for (const task of team.tasks || []) {
      const taskId = id(task.taskId || task.sourceTaskId)
      const historyId = id(task.historyId || task.sourceHistoryId) || historyByTask.get(taskId) || historyByTask.get(id(task.sourceTaskId))
      const key = historyId ? 'history:' + historyId : taskId ? JSON.stringify([day, team.teamId, taskId]) : task
      add(key, task)
    }
  }
  addTeams(state?.agenda?.date, state?.agenda?.teams)
  for (const [day, plan] of Object.entries(state?.agenda?.weekly || {})) {
    if (!day.startsWith('_')) addTeams(day, plan?.teams)
  }
  return groups
}

function selection(lines) {
  if (!Array.isArray(lines)) throw invalid('La entrega al equipo debe ser una lista de productos.')
  const ids = new Set()
  return lines.map(line => {
    if (typeof line?.productId !== 'string' || !line.productId || ids.has(line.productId)) {
      throw invalid('Seleccioná un producto del catálogo por línea. Ajustá la cantidad para entregar varias unidades.')
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw invalid('La cantidad a entregar debe ser un número entero mayor que cero.')
    ids.add(line.productId)
    return { productId: line.productId, quantity: line.quantity }
  })
}

function updateCopies(state, patches) {
  if (!patches.size) return state
  const patch = row => patches.has(row) ? { ...row, materials: patches.get(row) } : row
  const withTeams = plan => !plan?.teams ? plan : { ...plan, teams: plan.teams.map(team => team.tasks ? { ...team, tasks: team.tasks.map(patch) } : team) }
  const next = { ...state, history: (state.history || []).map(patch) }
  if (state.agenda) {
    next.agenda = withTeams(state.agenda)
    if (state.agenda.weekly) next.agenda = { ...next.agenda, weekly: Object.fromEntries(Object.entries(state.agenda.weekly)
      .map(([day, plan]) => [day, day.startsWith('_') ? plan : withTeams(plan)])) }
  }
  return next
}

function prepareServiceMaterials(state, previous) {
  const historyByTask = new Map()
  for (const records of [previous?.history, state.history]) {
    for (const record of records || []) {
      for (const key of [record.sourceTaskId, record.taskId]) if (key) historyByTask.set(id(key), id(record.id))
    }
  }
  const prior = groupedServices(previous, historyByTask), pending = []
  let needsCatalog = false
  for (const [key, copies] of groupedServices(state, historyByTask)) {
    const old = prior.get(key)?.find(hasMaterials)?.materials
    if (old === undefined && !copies.some(hasMaterials)) continue
    const baseline = old || []
    // The normal save and replay have identical snapshots in all projections.
    if (copies.every(row => isDeepStrictEqual(row.materials, old))) continue
    const initial = selection(baseline)
    const existing = new Map(baseline.map(line => [line.productId, line]))
    let requested
    for (const row of copies.filter(hasMaterials)) {
      const lines = selection(row.materials)
      if (isDeepStrictEqual(lines, initial)) continue
      if (requested && !isDeepStrictEqual(lines, requested)) {
        throw Object.assign(new Error('Los productos entregados no coinciden entre Agenda e Historial. Volvé a abrir el servicio.'), { statusCode: 409, code: 'SERVICE_MATERIAL_CONFLICT' })
      }
      requested = lines
    }
    const lines = requested || initial
    if (lines.some(line => !existing.has(line.productId))) needsCatalog = true
    pending.push({ copies, existing, lines })
  }
  return {
    needsCatalog,
    apply(overrides = []) {
      const products = needsCatalog ? new Map(require('../../shared/product-catalog.cjs').mergeCatalog(overrides).map(product => [product.id, product])) : null
      const patches = new Map()
      for (const { copies, existing, lines } of pending) {
        const materials = lines.map(({ productId, quantity }) => {
          if (existing.has(productId)) return { ...existing.get(productId), quantity }
          const product = products.get(productId)
          if (!product?.active) throw invalid('Un producto de la entrega ya no está disponible. Revisá la selección en el catálogo.')
          const name = require('../../shared/product-name.cjs').productName(product)
          const snapshot = { productId, model: product.model, brand: product.brand, name, quantity }
          for (const row of copies) {
            const supplied = row.materials?.find(line => line.productId === productId)
            if (supplied && ['model', 'brand', 'name'].some(key => supplied[key] !== undefined && supplied[key] !== snapshot[key])) {
              throw Object.assign(new Error('El producto cambió en el catálogo. Actualizá el catálogo y volvé a seleccionarlo.'), { statusCode: 409, code: 'SERVICE_MATERIAL_PRODUCT_CHANGED' })
            }
          }
          return snapshot
        })
        for (const row of copies) {
          if (!isDeepStrictEqual(row.materials, materials)) patches.set(row, materials)
        }
      }
      return updateCopies(state, patches)
    }
  }
}

module.exports = { prepareServiceMaterials }
