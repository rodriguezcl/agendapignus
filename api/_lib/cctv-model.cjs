const { randomUUID } = require('node:crypto')
const { validateDrawing, validateEquipmentItems } = require('../../shared/cctv-schema.cjs')

const fail = (message, statusCode = 400, code = 'CCTV_INPUT_INVALID') => { throw Object.assign(new Error(message), { statusCode, code }) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = (value, label, max, required = false) => {
  if (value != null && typeof value !== 'string') fail(`${label} debe ser texto.`)
  const result = String(value || '').trim()
  if (result.length > max) fail(`${label} admite hasta ${max} caracteres.`)
  if (required && !result) fail(`Completá ${label.toLowerCase()}.`)
  return result
}
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
const authorFor = user => ({ id: String(user.id || ''), name: String(user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Usuario') })
const emptyDossier = customerId => ({ customerId: String(customerId), version: 0, updatedAt: null, news: [], maintenance: { observation: '', nextDate: '' }, plans: [], improvements: [], equipment: [], activity: [] })

function validateCommand(input) {
  if (!object(input)) fail('La solicitud no es válida.')
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 4_300_000) fail('El archivo y el plano juntos son demasiado grandes. Reducí el archivo o la cantidad de elementos del plano.', 413, 'CCTV_REQUEST_TOO_LARGE')
  const customerId = text(input.customerId, 'Cuenta', 200, true)
  const commandId = text(input.commandId, 'Identificador de operación', 200, true)
  if (!/^[\w.-]+$/.test(commandId)) fail('El identificador de operación no es válido.')
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('Indicá la versión actual de la ficha.')
  if (!['addNews', 'saveMaintenance', 'addPlan', 'addImprovement', 'toggleImprovement', 'saveEquipment'].includes(input.action)) fail('La acción solicitada no está disponible.')
  if (!object(input.payload)) fail('Los datos de la acción no son válidos.')
  if (Object.hasOwn(input.payload, 'files') || Object.hasOwn(input.payload, 'attachments')) fail('Cada aporte admite un único archivo.')
  if (input.payload.file != null && !['addNews', 'addPlan'].includes(input.action)) fail('Esta acción no admite archivos.')
  return { customerId, commandId, expectedVersion: input.expectedVersion, action: input.action, payload: input.payload }
}

function applyCctvCommand(current, command, user, file = null, at = new Date().toISOString()) {
  const dossier = structuredClone(current), payload = command.payload, author = authorFor(user)
  let summary, details
  const entry = fields => ({ id: randomUUID(), at, author: { ...author }, ...fields })
  switch (command.action) {
    case 'addNews': {
      const news = entry({ title: text(payload.title, 'Título', 160, true), body: text(payload.body, 'Novedad', 20000, true), ...(file ? { file } : {}) })
      dossier.news.push(news); summary = `Novedad: ${news.title}`; details = { newsId: news.id }
      break
    }
    case 'saveMaintenance': {
      const nextDate = text(payload.nextDate, 'Próxima fecha', 10)
      if (nextDate && !validDate(nextDate)) fail('La próxima fecha de mantenimiento no es válida.')
      const maintenance = { observation: text(payload.observation, 'Observación', 20000), nextDate, at, author: { ...author } }
      details = { before: structuredClone(dossier.maintenance), after: structuredClone(maintenance) }
      dossier.maintenance = maintenance; summary = 'Actualizó el mantenimiento preventivo'
      break
    }
    case 'addPlan': {
      let drawing = null
      if (payload.drawing != null) {
        try { drawing = validateDrawing(payload.drawing, dossier.equipment ?? []) }
        catch (error) { fail(error.message) }
      }
      if (!file && !drawing?.elements?.length) fail('Adjuntá un plano o agregá elementos al esquema.')
      const plan = entry({ title: text(payload.title, 'Título', 160, true), notes: text(payload.notes, 'Observaciones del plano', 10000), version: dossier.plans.length + 1, ...(file ? { file } : {}), ...(drawing ? { drawing } : {}) })
      dossier.plans.push(plan); summary = `Plano versión ${plan.version}: ${plan.title}`; details = { planId: plan.id, version: plan.version }
      break
    }
    case 'addImprovement': {
      const priority = payload.priority == null ? 'Normal' : payload.priority
      if (!['Normal', 'Alta', 'Baja'].includes(priority)) fail('Seleccioná una prioridad válida.')
      const improvement = entry({ title: text(payload.title, 'Título', 160, true), description: text(payload.description, 'Descripción', 10000), priority, completed: false, completedAt: null, completedBy: null })
      dossier.improvements.push(improvement); summary = `Mejora pendiente: ${improvement.title}`; details = { improvementId: improvement.id }
      break
    }
    case 'toggleImprovement': {
      const improvement = dossier.improvements.find(item => item.id === payload.id)
      if (!improvement) fail('No se encontró la mejora en esta cuenta.', 404, 'CCTV_IMPROVEMENT_NOT_FOUND')
      if (typeof payload.completed !== 'boolean') fail('Indicá si la mejora está completada.')
      details = { improvementId: improvement.id, before: improvement.completed, after: payload.completed }
      improvement.completed = payload.completed; improvement.completedAt = payload.completed ? at : null; improvement.completedBy = payload.completed ? { ...author } : null
      summary = `${payload.completed ? 'Completó' : 'Reabrió'} la mejora: ${improvement.title}`
      break
    }
    case 'saveEquipment': {
      let items
      if (!Array.isArray(payload.items)) fail('Indicá la lista completa de equipos para guardarla.')
      try { items = validateEquipmentItems(payload.items) } catch (error) { fail(error.message) }
      details = { before: structuredClone(dossier.equipment), after: structuredClone(items) }
      dossier.equipment = items; summary = 'Actualizó el equipamiento instalado'
      break
    }
  }
  dossier.version += 1; dossier.updatedAt = at
  dossier.activity.push(entry({ action: command.action, summary, details }))
  return dossier
}

module.exports = { emptyDossier, authorFor, validateCommand, applyCctvCommand, fail }
