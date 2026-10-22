const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')
const { dedupeAgendaTeams } = require('../scripts/rebuild-weekly-from-history.cjs')

const root = path.resolve(__dirname, '..')
const port = 32109
const origin = `http://127.0.0.1:${port}`
let temporaryDirectory
let serverProcess
let serverErrorOutput = ''

test('Corrección de categoría: conserva el completado y restituye el abonado con auditoría', async () => {
  const fixture = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const customer = { customerId: 'qa-category-customer', account: 'CLI-993781', kind: 'client', name: 'MUDANZA QA', convertedFromAccount: 'PIG-993781', convertedFromType: 'Abonado' }
  upsertJson(fixture, 'customers', 'account', customer)
  upsertJson(fixture, 'services', 'id', { id: 'qa-other-service', name: 'Otro service', status: 'Activo' })
  const record = { id: 'qa-category-correction', customerId: customer.customerId, client: 'CLI-993781 MUDANZA QA', clientAccount: customer.account, clientNameAtService: customer.name, date: '2026-10-14', time: '11:00', serviceId: 'qa-retirement', service: 'Retiro de equipo', status: 'Completado', technicalStatus: 'Completado', technicalObservation: 'Se retiraron cámaras para mudanza', technicalReportedAt: '2026-10-14T15:00:00Z', completedAt: '2026-10-14T15:00:00Z', amount: '1234', paymentMethod: 'Efectivo' }
  upsertJson(fixture, 'work_history', 'id', record)
  fixture.close()
  const admin = await login('qa-admin@pignus.test')
  const tech = await login('qa-tech@pignus.test')
  const base = (await state(admin)).history.find(item => item.id === record.id)
  const input = { recordId: record.id, base, serviceIds: ['qa-other-service'], reason: 'Mudanza: conserva el servicio' }
  for (const cookie of [tech, null]) assert.equal((await api('/api/history/category-correction', cookie, { method: 'POST', body: JSON.stringify(input) })).status, cookie ? 403 : 401)
  const response = await api('/api/history/category-correction', admin, { method: 'POST', body: JSON.stringify(input) })
  assert.equal(response.status, 200, await response.clone().text())
  const next = await state(admin), saved = next.history.find(item => item.id === record.id)
  assert.equal(saved.service, 'Otro service')
  assert.equal(saved.status, 'Completado')
  assert.equal(saved.technicalObservation, record.technicalObservation)
  assert.equal(saved.completedAt, record.completedAt)
  assert.equal(saved.amount, record.amount)
  assert.equal(saved.clientAccount, 'PIG-993781')
  assert.equal(next.customers.find(item => item.customerId === customer.customerId).kind, 'subscriber')
  assert.equal(saved.categoryCorrections[0].reason, input.reason)
  assert.equal((await api('/api/history/category-correction', admin, { method: 'POST', body: JSON.stringify(input) })).status, 409)
  const tampered = await api('/api/history/' + record.id, admin, { method: 'PATCH', body: JSON.stringify({ base: saved, record: { ...saved, categoryCorrections: [] } }) })
  assert.equal(tampered.status, 409)
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const entries = db.prepare('SELECT data FROM audit_log').all().map(row => JSON.parse(row.data))
  db.close()
  assert.ok(entries.some(entry => entry.action === 'Corrigió categoría' && entry.entityId === record.id))
  assert.ok(entries.some(entry => entry.action === 'Restituyó abonado al corregir retiro' && entry.entityId === customer.customerId))
})

test('Cobranzas: permisos, confirmación concurrente, auditoría y persistencia sin reabrir servicios', async () => {
  const { collectionBase } = await import('../src/domain/collections/collections.mjs')
  const fixture = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  for (const manage of [false, true]) {
    const id = manage ? 'qa-collections-manager' : 'qa-collections-reader'
    upsertJson(fixture, 'roles', 'id', { id, code: id, name: id, permissions: { collections: true, collectionsManage: manage } })
    upsertJson(fixture, 'employees', 'id', { id, name: id, roleId: id, role: id, email: `${id}@pignus.test`, status: 'Activo', passwordHash: passwordHash('Prueba1234') })
  }
  const record = { id: 'qa-collection', sourceTaskId: 'qa-collection-task', customerId: 'qa-customer-a', client: 'CLI-1 COBRANZA QA', date: '2026-10-14', time: '09:00', serviceId: 'qa-service', service: 'Service técnico', status: 'Completado', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], amount: '10000', paymentMethod: 'Efectivo' }
  upsertJson(fixture, 'work_history', 'id', record)
  fixture.close()
  const admin = await login('qa-admin@pignus.test')
  const manager = await login('qa-collections-manager@pignus.test')
  const reader = await login('qa-collections-reader@pignus.test')
  const tech = await login('qa-tech@pignus.test')
  const weekly = await login('qa-weekly@pignus.test')
  const initial = (await state(reader)).history.find(item => item.id === record.id)
  assert.ok(initial, 'El permiso Cobranzas permite consultar sin Historial ni Dashboard')
  const receipt = { id: crypto.randomUUID(), name: 'comprobante.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nComprobante QA\n%%EOF').toString('base64')}` }
  const input = { recordId: record.id, base: collectionBase(initial), action: 'confirm', amount: '9500.50', paymentMethod: 'Transferencia', note: 'Acreditación verificada', receipt }
  for (const cookie of [reader, tech, weekly, null]) {
    const denied = await api('/api/collections/manage', cookie, { method: 'POST', body: JSON.stringify(input) })
    assert.equal(denied.status, cookie ? 403 : 401)
  }
  const missingReceipt = await api('/api/collections/manage', manager, { method: 'POST', body: JSON.stringify({ ...input, receipt: undefined }) })
  assert.equal(missingReceipt.status, 400)
  assert.equal((await state(reader)).history.find(item => item.id === record.id).collection, undefined)
  const responses = await Promise.all([manager, admin].map(cookie => api('/api/collections/manage', cookie, { method: 'POST', body: JSON.stringify(input) })))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  const saved = (await state(reader)).history.find(item => item.id === record.id)
  assert.equal(saved.collection.status, 'confirmed')
  assert.equal(saved.status, 'Completado')
  assert.equal(saved.amount, '9500.5')
  assert.equal(saved.paymentMethod, 'Transferencia')
  assert.equal(saved.collection.events.length, 1)
  assert.equal(saved.collection.original.amount, '10000')
  assert.equal(saved.collection.receipt.id, receipt.id)
  assert.equal(saved.collection.receipt.data, undefined)
  const receiptPath = `/api/collections/${record.id}/receipts/${receipt.id}`
  const downloaded = await api(receiptPath, reader)
  assert.equal(downloaded.status, 200)
  assert.equal(await downloaded.text(), '%PDF-1.4\nComprobante QA\n%%EOF')
  assert.equal((await api(receiptPath, tech)).status, 403)
  assert.equal((await api(receiptPath, weekly)).status, 403)
  assert.equal((await api(receiptPath, null)).status, 401)
  assert.equal((await api(receiptPath, manager, { method: 'DELETE' })).status, 405)
  const rectified = await api('/api/collections/manage', manager, { method: 'POST', body: JSON.stringify({ ...input, receipt: undefined, base: collectionBase(saved), action: 'correct', amount: '9700' }) })
  assert.equal(rectified.status, 200, await rectified.clone().text())
  const final = (await state(admin)).history.find(item => item.id === record.id)
  assert.equal(final.collection.events.length, 2)
  assert.equal(final.collection.status, 'confirmed')
  assert.equal(final.amount, '9700')
  for (const operation of [
    { method: 'DELETE', body: JSON.stringify({ base: final }) },
    { method: 'PATCH', body: JSON.stringify({ base: final, record: { ...final, amount: '1' } }) },
    { method: 'PATCH', body: JSON.stringify({ base: final, record: { ...final, collection: null } }) }
  ]) assert.equal((await api('/api/history/' + record.id, admin, operation)).status, 409)
  const technical = (await state(tech)).history.find(item => item.id === record.id)
  assert.ok(technical)
  assert.equal(technical.collection, undefined)
  const auditDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const entries = auditDb.prepare('SELECT data FROM audit_log').all().map(row => JSON.parse(row.data))
  auditDb.close()
  assert.ok(entries.some(entry => entry.action === 'Confirmó pago' && entry.entityId === record.id))
  assert.ok(entries.some(entry => entry.action === 'Rectificó cobranza' && entry.entityId === record.id))
})

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

function upsertJson(db, table, key, record) {
  db.prepare(`INSERT OR REPLACE INTO ${table} (${key}, data) VALUES (?, ?)`).run(String(record[key]), JSON.stringify(record))
}

function seedGranularUser(db, id, keys, extraPermissions = {}) {
  const roleId = `${id}-role`
  upsertJson(db, 'roles', 'id', {
    id: roleId, code: id, name: `Operador ${id}`,
    permissions: { __catalogV2: true, ...Object.fromEntries(keys.map(key => [key, true])), ...extraPermissions }
  })
  upsertJson(db, 'employees', 'id', {
    id, firstName: 'QA', lastName: id, name: `QA ${id}`, roleId, role: `Operador ${id}`,
    email: `${id}@pignus.test`, status: 'Activo', passwordHash: passwordHash('Prueba1234')
  })
  return `${id}@pignus.test`
}

test('SoftGuard HTTP: permiso específico, alcance, CAS y protección de metadatos en estado genérico', async () => {
  const { softguardRetirementBase } = require('../api/_lib/softguard-retirement.cjs')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const customer = { customerId: 'qa-softguard', account: 'CLI-998700', kind: 'client', name: 'RETIRO QA', street: 'Calle QA 123', phone: '3515551000', convertedFromAccount: 'PIG-998700', subscriptionEndedAt: '2026-10-20T15:00:00.000Z' }
  upsertJson(db, 'customers', 'account', customer)
  const resolverEmail = seedGranularUser(db, 'qa-softguard-resolver', ['accounts.view', 'customers.softguard.resolve'])
  const scopedEmail = seedGranularUser(db, 'qa-softguard-scoped', ['accounts.view', 'customers.softguard.resolve'], { 'scope.customers.read.cctv': true })
  const viewerEmail = seedGranularUser(db, 'qa-softguard-viewer', ['accounts.view'])
  db.close()
  const admin = await login('qa-admin@pignus.test'), resolver = await login(resolverEmail)
  const scoped = await login(scopedEmail), viewer = await login(viewerEmail), tech = await login('qa-tech@pignus.test')
  const before = await state(admin), command = { customerId: customer.customerId, base: softguardRetirementBase(customer) }
  for (const cookie of [null, scoped, viewer, tech]) {
    const response = await api('/api/customers/softguard-retirement', cookie, { method: 'POST', body: JSON.stringify(command) })
    assert.equal(response.status, cookie ? 403 : 401, await response.clone().text())
  }
  assert.equal((await state(admin)).revision, before.revision)
  const forged = structuredClone(before)
  forged.customers.find(row => row.customerId === customer.customerId).softguardRetirementResolution = { convertedFromAccount: customer.convertedFromAccount, subscriptionEndedAt: customer.subscriptionEndedAt, completedAt: new Date().toISOString(), completedBy: 'forged' }
  assert.equal((await api('/api/state', admin, { method: 'PUT', body: JSON.stringify(forged) })).status, 403)
  const removed = { ...before, customers: before.customers.filter(row => row.customerId !== customer.customerId) }
  const deniedDelete = await api('/api/state', admin, { method: 'PUT', body: JSON.stringify(removed) })
  assert.equal(deniedDelete.status, 403)
  assert.match((await deniedDelete.json()).error, /Registrá primero la baja/)
  const success = await api('/api/customers/softguard-retirement', resolver, { method: 'POST', body: JSON.stringify(command) })
  assert.equal(success.status, 200, await success.clone().text())
  assert.deepEqual(Object.keys(await success.json()).sort(), ['ok', 'revision'])
  const saved = await state(admin), acknowledged = saved.customers.find(row => row.customerId === customer.customerId)
  assert.equal(saved.revision, before.revision + 1)
  assert.equal(acknowledged.softguardRetirementResolution.completedBy, 'qa-softguard-resolver')
  assert.deepEqual((await state(resolver)).history, [])
  assert.equal((await api('/api/customers/softguard-retirement', resolver, { method: 'POST', body: JSON.stringify(command) })).status, 409)
  const omitted = structuredClone(saved), editable = omitted.customers.find(row => row.customerId === customer.customerId)
  delete editable.softguardRetirementResolution
  delete editable.subscriptionEndedAt
  delete editable.convertedFromAccount
  editable.name = 'RETIRO QA EDITADO'
  const update = await api('/api/state', admin, { method: 'PUT', body: JSON.stringify(omitted) })
  assert.equal(update.status, 200, await update.clone().text())
  assert.deepEqual((await state(admin)).customers.find(row => row.customerId === customer.customerId).softguardRetirementResolution, acknowledged.softguardRetirementResolution)
  const persisted = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const entries = persisted.prepare('SELECT data FROM audit_log').all().map(row => JSON.parse(row.data))
  persisted.close()
  assert.equal(entries.filter(entry => entry.action === 'Registró baja realizada en SoftGuard' && entry.entityId === customer.customerId).length, 1)
})

test('SoftGuard HTTP: un fallo de auditoría revierte cliente y revisión dentro de la misma transacción', async () => {
  const { softguardRetirementBase } = require('../api/_lib/softguard-retirement.cjs')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const customer = { customerId: 'qa-softguard-rollback', account: 'CLI-998701', kind: 'client', name: 'RETIRO ROLLBACK', convertedFromAccount: 'PIG-998701', subscriptionEndedAt: '2026-10-20T16:00:00.000Z' }
  upsertJson(db, 'customers', 'account', customer)
  db.exec("CREATE TRIGGER reject_softguard_audit BEFORE INSERT ON audit_log WHEN json_extract(NEW.data, '$.action') = 'Registró baja realizada en SoftGuard' BEGIN SELECT RAISE(ABORT, 'forced softguard audit failure'); END")
  db.close()
  const admin = await login('qa-admin@pignus.test'), before = await state(admin)
  const request = () => api('/api/customers/softguard-retirement', admin, { method: 'POST', body: JSON.stringify({ customerId: customer.customerId, base: softguardRetirementBase(customer) }) })
  const rejected = await request()
  assert.equal(rejected.status, 400, await rejected.clone().text())
  const afterFailure = await state(admin)
  assert.equal(afterFailure.revision, before.revision)
  assert.deepEqual(afterFailure.customers.find(row => row.customerId === customer.customerId), customer)
  const repair = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  repair.exec('DROP TRIGGER reject_softguard_audit')
  repair.close()
  assert.equal((await request()).status, 200)
  assert.equal((await state(admin)).revision, before.revision + 1)
})

test('granular HTTP: operador con notas conserva datos ocultos en PUT y PATCH sin ampliar sus permisos', async () => {
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const email = seedGranularUser(db, 'qa-v2-notes', ['history.view', 'records.read', 'planning.notes'])
  const oldOperator = JSON.parse(db.prepare('SELECT data FROM roles WHERE id = ?').get('d9d7a587-a581-44f2-88d2-bc2deb579a1e').data)
  upsertJson(db, 'roles', 'id', { ...oldOperator, code: 'qa-legacy-operator' })
  const granularOperator = JSON.parse(db.prepare('SELECT data FROM roles WHERE id = ?').get('qa-v2-notes-role').data)
  upsertJson(db, 'roles', 'id', { ...granularOperator, code: 'operator' })
  const record = {
    id: 'qa-v2-note-record', date: '2099-01-15', time: '09:00', status: 'Pendiente',
    client: 'PIG-9001 CLIENTE INCLUIDO QA', customerId: 'qa-customer-a', clientAccount: 'PIG-9001',
    serviceId: 'qa-service', service: 'Service técnico', technicianIds: ['qa-tech'], technicians: ['QA Técnico'],
    address: 'Contacto reservado', phone: '3519999999', amount: '18500', paymentMethod: 'Efectivo',
    monthlyFee: '25000', internalNote: 'Original', technicalObservation: 'Informe reservado',
    servicePhotoUrl: '/api/service-photo/qa-v2-note-record'
  }
  upsertJson(db, 'work_history', 'id', record)
  db.close()
  const cookie = await login(email)
  const visible = await state(cookie)
  const before = visible.history.find(item => item.id === record.id)
  assert.ok(before)
  for (const field of ['address', 'phone', 'amount', 'paymentMethod', 'monthlyFee', 'technicalObservation', 'servicePhotoUrl']) assert.equal(before[field], undefined, field)
  before.internalNote = 'Nota editada mediante estado'
  const put = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(visible) })
  assert.equal(put.status, 200, await put.clone().text())
  const current = (await state(cookie)).history.find(item => item.id === record.id)
  const patch = await api(`/api/history/${record.id}`, cookie, { method: 'PATCH', body: JSON.stringify({ base: current, record: { ...current, internalNote: 'Nota editada directamente' } }) })
  assert.equal(patch.status, 200, await patch.clone().text())
  const savedView = (await state(cookie)).history.find(item => item.id === record.id)
  assert.equal(savedView.internalNote, 'Nota editada directamente')
  const hiddenField = await api(`/api/history/${record.id}`, cookie, { method: 'PATCH', body: JSON.stringify({ base: savedView, record: { ...savedView, amount: '1' } }) })
  assert.equal(hiddenField.status, 200, 'los campos ocultos se restauran de la versión persistida')
  const denied = await api(`/api/history/${record.id}`, cookie, { method: 'PATCH', body: JSON.stringify({ base: savedView, record: { ...savedView, detail: 'Cambio general no autorizado' } }) })
  assert.equal(denied.status, 403, await denied.clone().text())
  for (const [method, route] of [
    ['GET', '/api/history/export?month=2099-01'], ['DELETE', `/api/history/${record.id}`],
    ['GET', `/api/service-photo/${record.id}`], ['GET', `/api/attachments/service/${record.id}`],
    ['PATCH', '/api/history/bulk'], ['POST', '/api/services'], ['GET', '/api/audit']
  ]) {
    const response = await api(route, cookie, { method, ...(method !== 'GET' ? { body: '{}' } : {}) })
    assert.equal(response.status, 403, `${method} ${route}: ${await response.text()}`)
  }
  const persisted = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const saved = JSON.parse(persisted.prepare('SELECT data FROM work_history WHERE id = ?').get(record.id).data)
  persisted.close()
  assert.equal(saved.internalNote, 'Nota editada directamente')
  for (const field of ['address', 'phone', 'amount', 'paymentMethod', 'monthlyFee', 'technicalObservation', 'servicePhotoUrl']) assert.equal(saved[field], record[field], field)
})

test('granular HTTP: documentos verifican autor real, alcance de escritura y lectura independiente', async () => {
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const email = seedGranularUser(db, 'qa-v2-files', ['history.view', 'records.read', 'service.documents.read', 'service.documents.upload', 'service.documents.deleteOwn'], { 'scope.services.write.assigned': true })
  for (const own of [true, false]) upsertJson(db, 'work_history', 'id', {
    id: own ? 'qa-v2-file-own' : 'qa-v2-file-outside', date: '2099-01-15', time: '09:00',
    client: 'CLIENTE QA', serviceId: 'qa-service', service: 'Service técnico', status: 'Pendiente',
    technicianIds: [own ? 'qa-v2-files' : 'qa-tech']
  })
  db.close()
  const cookie = await login(email)
  const admin = await login('qa-admin@pignus.test')
  const route = '/api/attachments/service/qa-v2-file-own'
  const file = { name: 'Referencia.pdf', data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nExample').toString('base64') }
  const foreign = await api(route, admin, { method: 'POST', body: JSON.stringify({ ...file, id: 'attachment-v2-foreign' }) })
  assert.equal(foreign.status, 200, await foreign.clone().text())
  const uploaded = await api(route, cookie, { method: 'POST', body: JSON.stringify({ ...file, id: 'attachment-v2-own', uploadedBy: 'qa-admin' }) })
  assert.equal(uploaded.status, 200, await uploaded.clone().text())
  const listed = await (await api(route, cookie)).json()
  assert.equal(listed.attachments.find(item => item.id === 'attachment-v2-own').uploadedBy, 'qa-v2-files', 'el autor enviado por el cliente no se acepta')
  assert.equal(listed.attachments.find(item => item.id === 'attachment-v2-own').canDelete, true)
  assert.equal(listed.attachments.find(item => item.id === 'attachment-v2-foreign').canDelete, false)
  assert.equal((await api(`${route}/attachment-v2-foreign`, cookie, { method: 'DELETE' })).status, 403)
  assert.equal((await api(`${route}/attachment-v2-own`, cookie, { method: 'DELETE' })).status, 200)
  const outside = '/api/attachments/service/qa-v2-file-outside'
  assert.equal((await api(outside, cookie)).status, 200, 'la lectura puede ser más amplia que la escritura')
  assert.equal((await api(outside, cookie, { method: 'POST', body: JSON.stringify({ ...file, id: 'attachment-v2-outside' }) })).status, 403)
  const photoRoute = '/api/service-photo/qa-v2-file-own'
  const photo = 'data:image/jpeg;base64,' + Buffer.from('foto-sintetica-v2').toString('base64')
  assert.equal((await api(photoRoute, admin, { method: 'POST', body: JSON.stringify({ photo }) })).status, 200)
  const foreignMetadata = await (await api(`${photoRoute}?metadata=1`, cookie)).json()
  assert.equal(foreignMetadata.canDelete, false)
  assert.equal((await api(photoRoute, cookie, { method: 'DELETE' })).status, 403)
  assert.equal((await api(photoRoute, cookie, { method: 'POST', body: JSON.stringify({ photo }) })).status, 403, 'subir no permite reemplazar una foto ajena sin permiso de borrado')
  const preservedMetadata = await (await api(`${photoRoute}?metadata=1`, cookie)).json()
  assert.equal(preservedMetadata.uploadedBy, 'qa-admin', 'el intento rechazado conserva el autor original')
  assert.equal((await api(photoRoute, admin, { method: 'DELETE' })).status, 200)
  assert.equal((await api(photoRoute, cookie, { method: 'POST', body: JSON.stringify({ photo }) })).status, 200)
  const ownMetadata = await (await api(`${photoRoute}?metadata=1`, cookie)).json()
  assert.equal(ownMetadata.uploadedBy, 'qa-v2-files')
  assert.equal(ownMetadata.canDelete, true)
  assert.equal((await api(photoRoute, cookie, { method: 'POST', body: JSON.stringify({ photo }) })).status, 200, 'el permiso de borrar archivos propios permite reemplazar la foto propia')
  const unassign = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const own = JSON.parse(unassign.prepare('SELECT data FROM work_history WHERE id = ?').get('qa-v2-file-own').data)
  upsertJson(unassign, 'work_history', 'id', { ...own, technicianIds: ['qa-tech'] })
  unassign.close()
  const outsideMetadata = await (await api(`${photoRoute}?metadata=1`, cookie)).json()
  assert.equal(outsideMetadata.canDelete, false, 'el autor pierde la facultad de borrar fuera del alcance')
  assert.equal((await api(photoRoute, cookie, { method: 'DELETE' })).status, 403)
})

test('granular HTTP: consultar clientes no revela historial y su permiso respeta alcance CCTV', async () => {
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const reader = seedGranularUser(db, 'qa-v2-accounts', ['accounts.view', 'records.read'], { 'scope.customers.read.cctv': true })
  const historian = seedGranularUser(db, 'qa-v2-account-history', ['accounts.view', 'records.read', 'customer.history'], { 'scope.customers.read.cctv': true })
  db.close()
  const basic = await state(await login(reader))
  assert.deepEqual(basic.history, [])
  assert.deepEqual(basic.customers.map(customer => customer.customerId), ['qa-customer-a'])
  const history = await state(await login(historian))
  assert.ok(history.history.some(record => record.id === 'qa-history-included'))
  assert.equal(history.history.some(record => record.id === 'qa-history-excluded'), false)
})

test('granular HTTP: contraseña no autoriza editar identidad ni administrar cuentas protegidas', async () => {
  const { employeeOperations } = await import('../src/features/state/application/employee-operations.mjs')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const email = seedGranularUser(db, 'qa-v2-password', ['employees.view', 'employees.password'])
  db.close()
  const cookie = await login(email)
  const before = await state(cookie)
  const target = before.employees.find(employee => employee.id === 'qa-tech')
  assert.ok(target)
  const sendEmployee = (base, record) => api('/api/state', cookie, { method: 'PATCH', body: JSON.stringify({ revision: before.revision, operations: employeeOperations(base, record) }) })
  const rename = await sendEmployee(target, { ...target, name: 'Nombre inyectado' })
  assert.equal(rename.status, 403, await rename.clone().text())
  const administrator = before.employees.find(employee => employee.id === 'qa-admin')
  const protectedPassword = await sendEmployee(administrator, { ...administrator, password: 'Nueva12345' })
  assert.equal(protectedPassword.status, 403, await protectedPassword.clone().text())
  const allowed = await sendEmployee(target, { ...target, password: 'Nueva12345' })
  assert.equal(allowed.status, 200, await allowed.clone().text())
  const verification = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const saved = JSON.parse(verification.prepare('SELECT data FROM employees WHERE id = ?').get('qa-tech').data)
  verification.close()
  const [salt, hash] = saved.passwordHash.split(':')
  assert.equal(crypto.scryptSync('Nueva12345', salt, 64).toString('hex'), hash)
  assert.equal(saved.name, target.name)
  assert.equal(saved.roleId, target.roleId)
})

test('granular HTTP: ningún cambio de estado deja el sistema sin administrador activo', async () => {
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const administrator = JSON.parse(db.prepare('SELECT data FROM roles WHERE id = ?').get('1').data)
  upsertJson(db, 'roles', 'id', { ...administrator, permissions: { __catalogV2: true } })
  db.close()
  const cookie = await login('qa-admin@pignus.test')
  const before = await state(cookie)
  const secondaryInactive = { ...before, employees: before.employees.map(employee => employee.id === 'qa-admin-secondary' ? { ...employee, status: 'Inactivo' } : employee) }
  const allowed = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(secondaryInactive) })
  assert.equal(allowed.status, 200, await allowed.clone().text())
  const oneAdministrator = await state(cookie)
  const noAdministrator = { ...oneAdministrator, employees: oneAdministrator.employees.map(employee => employee.id === 'qa-admin' ? { ...employee, status: 'Inactivo' } : employee) }
  const denied = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(noAdministrator) })
  assert.equal(denied.status, 403, await denied.clone().text())
  assert.match((await denied.json()).error, /administrador activo/)
  assert.equal((await state(cookie)).employees.find(employee => employee.id === 'qa-admin').status, 'Activo')
})

function createFixtureDatabase(databasePath) {
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE roles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE employees (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE services (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE work_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE customers (account TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE agendas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `)
  const allPermissions = { dashboard: true, weekly: true, agenda: true, history: true, accounts: true, employees: true, services: true, settings: true, audit: true }
  ;[
    { id: 1, code: 'administrator', name: 'Administrador', description: 'Administración de prueba', permissions: allPermissions },
    { id: 2, code: 'coordinator', name: 'Coordinador', description: 'Coordinación de prueba', permissions: { dashboard: true, weekly: true, agenda: true, history: true, accounts: true } },
    { id: 3, code: 'technician', name: 'Técnico', description: 'Técnico de prueba', permissions: { dashboard: true, agenda: true } }
  ].forEach(role => upsertJson(db, 'roles', 'id', role))
  const services = [
    { id: 'qa-alarm', code: 'alarm-installation', category: 'installation', name: 'Instalación de alarma', description: 'Alta de prueba', status: 'Activo' },
    { id: 'qa-retirement', code: 'equipment-retirement', category: 'service', name: 'Retiro de equipo', description: 'Baja de prueba', status: 'Activo' },
    { id: 'qa-service', code: 'technical-service', category: 'service', name: 'Service técnico', description: 'Servicio de prueba', status: 'Activo' }
  ]
  services.forEach(service => upsertJson(db, 'services', 'id', service))
  const customers = [
    { customerId: 'qa-customer-a', kind: 'subscriber', account: 'PIG-9001', name: 'CLIENTE INCLUIDO QA', street: 'Calle QA 100', address: 'Calle QA 100', locality: 'Córdoba', province: 'Córdoba', phone: '3510000001', type: 'Residencial', cctvService: true, fields: {} },
    { customerId: 'qa-customer-b', kind: 'subscriber', account: 'PIG-9002', name: 'CLIENTE EXCLUIDO QA', street: 'Calle QA 200', address: 'Calle QA 200', locality: 'Córdoba', province: 'Córdoba', phone: '3510000002', type: 'Residencial', cctvService: false, fields: {} }
  ]
  customers.forEach(customer => upsertJson(db, 'customers', 'account', customer))
  const baseHistory = { date: '2096-03-10', time: '09:00', serviceId: 'qa-alarm', service: 'Instalación de alarma', installationZone: 'residencial', technicians: [], technicianIds: [], status: 'Completado', team: 'Equipo 1' }
  ;[
    { ...baseHistory, id: 'qa-history-included', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'CLIENTE INCLUIDO QA', address: 'Calle QA 100', phone: '3510000001' },
    { ...baseHistory, id: 'qa-history-excluded', date: '2096-03-11', team: 'Equipo 2', customerId: 'qa-customer-b', clientAccount: 'PIG-9002', client: 'CLIENTE EXCLUIDO QA', address: 'Calle QA 200', phone: '3510000002' }
  ].forEach(record => upsertJson(db, 'work_history', 'id', record))
  upsertJson(db, 'agendas', 'id', { id: 'current', date: '2096-03-12', teams: [{ teamId: 'qa-team', memberIds: [], members: [], tasks: [] }], weekly: { '2096-03-12': { teams: [] } } })
  db.prepare('INSERT INTO preferences (key, value) VALUES (?, ?), (?, ?), (?, ?)').run('state_revision', '0', 'theme', 'light', 'vehicles', JSON.stringify([{ id: 'qa-vehicle', brand: 'Ford', model: 'Ka', year: 2024, mileage: 1000, plate: 'QA123AA', insuranceExpiresOn: '2099-12-31' }]))
  db.close()
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${origin}/api/auth/session`)).status === 401) return }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('La API de pruebas no inició a tiempo.')
}

async function login(email) {
  const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Prueba1234' }) })
  assert.equal(response.status, 200, await response.clone().text())
  return response.headers.get('set-cookie').split(';')[0]
}

async function api(pathname, cookie, options = {}) {
  try {
    return await fetch(`${origin}${pathname}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } })
  } catch (error) {
    throw new Error(`La API de pruebas falló en ${pathname}.\n${serverErrorOutput}`, { cause: error })
  }
}

async function state(cookie) {
  const response = await api('/api/state', cookie)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

test.beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pignus-security-'))
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  createFixtureDatabase(databasePath)
  const db = new DatabaseSync(databasePath)
  const roles = [
    { id: 'qa-employees-role', code: 'qa-employees', name: 'QA Empleados', description: 'Prueba', permissions: { employees: true } },
    { id: 'qa-settings-role', code: 'qa-settings', name: 'QA Configuración', description: 'Prueba', permissions: { settings: true } },
    { id: 'qa-weekly-role', code: 'qa-weekly', name: 'QA Semanal', description: 'Prueba', permissions: { weekly: true } },
    { id: 'qa-supervisor-role', code: 'role-qa-supervisor', name: 'Supervisor', description: 'Prueba de seguimiento CCTV', permissions: { dashboard: true, accounts: true, history: true, historyManage: true } }
  ]
  roles.forEach(role => upsertJson(db, 'roles', 'id', role))
  upsertJson(db, 'roles', 'id', { id: 'd9d7a587-a581-44f2-88d2-bc2deb579a1e', code: 'operator', name: 'Operador', permissions: { weekly: true, agenda: true, history: true, employees: true, weeklyTeams: true } })
  const employees = [
    { id: 'qa-admin', firstName: 'QA', lastName: 'Admin', name: 'QA Admin', roleId: 1, role: 'Administrador', email: 'qa-admin@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-admin-secondary', firstName: 'QA', lastName: 'Admin Secundario', name: 'QA Admin Secundario', roleId: 1, role: 'Administrador', email: 'qa-admin-secondary@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-employees', firstName: 'QA', lastName: 'Empleados', name: 'QA Empleados', roleId: 'qa-employees-role', role: 'QA Empleados', email: 'qa-employees@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-settings', firstName: 'QA', lastName: 'Configuración', name: 'QA Configuración', roleId: 'qa-settings-role', role: 'QA Configuración', email: 'qa-settings@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-weekly', firstName: 'QA', lastName: 'Semanal', name: 'QA Semanal', roleId: 'qa-weekly-role', role: 'QA Semanal', email: 'qa-weekly@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-tech', firstName: 'QA', lastName: 'Técnico', name: 'QA Técnico', roleId: 3, role: 'Técnico', email: 'qa-tech@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') },
    { id: 'qa-supervisor', firstName: 'QA', lastName: 'Supervisor', name: 'QA Supervisor', roleId: 'qa-supervisor-role', role: 'Supervisor', email: 'qa-supervisor@pignus.test', phone: '', status: 'Activo', passwordHash: passwordHash('Prueba1234') }
  ]
  employees.forEach(employee => upsertJson(db, 'employees', 'id', employee))
  upsertJson(db, 'employees', 'id', { id: 'qa-operator', name: 'QA Operador', roleId: 'd9d7a587-a581-44f2-88d2-bc2deb579a1e', role: 'Operador', status: 'Activo', email: 'qa-operator@pignus.test', technicalEnabled: true, passwordHash: passwordHash('Prueba1234') })
  const history = db.prepare('SELECT id, data FROM work_history').all().map(row => ({ id: row.id, record: JSON.parse(row.data) }))
  const alarmService = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => service.code === 'alarm-installation')
  const groups = new Map()
  history.filter(({ record }) => String(record.serviceId) === String(alarmService.id)).forEach(item => { const month = item.record.date.slice(0, 7); groups.set(month, [...(groups.get(month) || []), item]) })
  const selected = [...groups.entries()].find(([, records]) => records.length >= 2)
  assert.ok(selected, 'Se necesitan dos alarmas del mismo mes para probar el filtro.')
  const [month, records] = selected
  const assigned = { ...records[0].record, technicianIds: [...new Set([...(records[0].record.technicianIds || []), 'qa-tech'])] }
  db.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify(assigned), records[0].id)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_month', month)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_included', assigned.client)
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run('qa_export_excluded', records[1].record.client)
  db.close()
  const publicDirectory = path.join(temporaryDirectory, 'public')
  fs.mkdirSync(publicDirectory)
  fs.writeFileSync(path.join(publicDirectory, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')
  serverProcess = spawn(process.execPath, ['server.cjs'], { cwd: root, env: { ...process.env, TICKETS_MAIL_ENABLED: 'false', TICKETS_MAIL_ENCRYPTION_KEY: 'clave-ficticia-de-correo-para-pruebas-http', TICKETS_MAIL_WORKER_SECRET: 'clave-ficticia-del-proceso-para-pruebas-http', PIGNUS_PORT: String(port), PIGNUS_HOST: '127.0.0.1', PIGNUS_DATA_DIR: temporaryDirectory, PIGNUS_PUBLIC_DIR: publicDirectory }, stdio: ['ignore', 'pipe', 'pipe'] })
  serverErrorOutput = ''
  serverProcess.stderr.on('data', chunk => { serverErrorOutput = (serverErrorOutput + chunk).slice(-8000) })
  await waitForServer()
  // La reconstrucción inicial agrupa técnicos por equipos mensuales. Restauramos
  // un segundo registro sin asignación para probar el filtro de exportación sin
  // depender de datos operativos ni del estado previo de una instalación real.
  const normalizedDb = new DatabaseSync(databasePath)
  const excludedRow = normalizedDb.prepare('SELECT data FROM work_history WHERE id = ?').get(records[1].id)
  const excludedRecord = JSON.parse(excludedRow.data)
  normalizedDb.prepare('UPDATE work_history SET data = ? WHERE id = ?').run(JSON.stringify({ ...excludedRecord, technicians: [], technicianIds: [] }), records[1].id)
  normalizedDb.close()
})

test.afterEach(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise(resolve => serverProcess.once('exit', resolve))
    serverProcess.kill()
    await exited
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 9) throw error; await new Promise(resolve => setTimeout(resolve, 100)) }
  }
})

test('adjuntos múltiples conservan archivos y restringen accesos por servicio', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const base = '/api/attachments/service/qa-history-included'
  assert.equal((await api(base)).status, 401)
  const upload = id => api(base, cookie, { method: 'POST', body: JSON.stringify({ id, name: 'Referencia.pdf', data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nExample').toString('base64') }) })
  assert.equal((await upload('attachment-00000001')).status, 200)
  assert.equal((await upload('attachment-00000002')).status, 200)
  assert.equal((await upload('attachment-00000001')).status, 200)
  const listed = await (await api(base, cookie)).json()
  assert.equal(listed.attachments.length, 2)
  assert.equal(listed.attachments[0].data, undefined)
  const download = await api(base + '/attachment-00000001', cookie)
  assert.equal(download.status, 200)
  assert.match(await download.text(), /^%PDF-/)
  assert.equal((await api(base + '/attachment-00000001', cookie, { headers: { 'If-None-Match': download.headers.get('etag') } })).status, 304)
  assert.equal((await api(base + '/attachment-00000001', cookie, { method: 'DELETE' })).status, 200)
  assert.equal((await (await api(base, cookie)).json()).attachments.length, 1)
  const technician = await login('qa-tech@pignus.test')
  assert.equal((await api(base, technician)).status, 200)
  assert.equal((await api('/api/attachments/service/qa-history-excluded', technician)).status, 403)
  assert.equal((await api(base + '/attachment-00000002', technician, { method: 'DELETE' })).status, 403)
  const policy = '/api/attachments/vehicle/qa-vehicle'
  assert.equal((await api(policy, technician)).status, 200)
  assert.equal((await api(policy, technician, { method: 'POST', body: JSON.stringify({}) })).status, 403)
})

test('cuenta mixta conserva gestión, informa solamente lo asignado y no aprueba adelantos', async () => {
  const cookie = await login('qa-weekly@pignus.test')
  assert.equal((await api('/api/technician/state', cookie)).status, 403)
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const employee = JSON.parse(db.prepare('SELECT data FROM employees WHERE id = ?').get('qa-weekly').data)
  upsertJson(db, 'employees', 'id', { ...employee, technicalEnabled: true })
  const record = { id: 'qa-mixed-service', date: '2020-01-01', time: '09:00', status: 'Pendiente', technicianIds: ['qa-weekly'], client: 'Mi servicio', service: 'Service de alarma' }
  upsertJson(db, 'work_history', 'id', record)
  upsertJson(db, 'work_history', 'id', { ...record, id: 'qa-mixed-other', technicianIds: ['qa-tech'], client: 'Ajeno' })
  // A pending request from a past day has expired and no longer blocks work.
  const pending = { ...record, id: 'qa-mixed-pending', advanceRequest: { status: 'pending' } }
  upsertJson(db, 'work_history', 'id', pending)
  db.close()
  assert.ok((await state(cookie)).agenda)
  const personal = await (await api('/api/technician/state', cookie)).json()
  assert.ok(personal.history.some(r => r.id === record.id))
  assert.ok(!personal.history.some(r => r.id === 'qa-mixed-other'))
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const conditionalPath = `/api/technician/state?revision=${personal.revision}&day=${day}`
  const unchanged = await (await api(conditionalPath, cookie)).json()
  assert.equal(unchanged.unchanged, true)
  assert.equal(unchanged.history, undefined)
  const outdated = await (await api(`/api/technician/state?revision=${personal.revision}&day=2000-01-01`, cookie)).json()
  assert.ok(Array.isArray(outdated.history))
  const post = (path, body) => api(path, cookie, { method: 'POST', body: JSON.stringify(body) })
  assert.equal((await post('/api/technician/start', { recordId: 'qa-mixed-other' })).status, 403)
  assert.equal((await post('/api/technician/start', { recordId: pending.id })).status, 200)
  assert.ok(Array.isArray((await (await api(conditionalPath, cookie)).json()).history))
  assert.equal((await post('/api/technician/status', { recordId: pending.id, type: 'Reprogramación solicitada', observation: 'Prueba' })).status, 200)
  assert.equal((await post('/api/technician/start', { recordId: record.id })).status, 200)
  assert.equal((await post('/api/technician/status', { recordId: record.id, type: 'Reprogramación solicitada', observation: 'Cliente ausente' })).status, 200)
  assert.equal((await post('/api/admin/advance-request/approve', { recordId: pending.id })).status, 403)
  const cleanup = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(cleanup, 'employees', 'id', employee)
  for (const id of [record.id, pending.id, 'qa-mixed-other']) cleanup.prepare('DELETE FROM work_history WHERE id = ?').run(id)
  cleanup.close()
})

test('protege rutas y agrega cabeceras de seguridad', async () => {
  const response = await api('/api/state')
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
})

test('Supervisor recibe sólo cuentas e historial CCTV y no puede escribir ni exportar', async () => {
  const cookie = await login('qa-supervisor@pignus.test')
  const visible = await state(cookie)

  assert.equal(visible.history.some(record => record.id === 'qa-history-included'), true)
  assert.equal(visible.history.some(record => record.id === 'qa-history-excluded'), false)
  assert.deepEqual(visible.roles, [])
  assert.deepEqual(visible.employees, [])
  assert.deepEqual(visible.services, [])
  assert.deepEqual(visible.vehicles, [])
  assert.ok(visible.customers.length > 0)
  assert.ok(visible.customers.every(customer => customer.cctvService === true))
  assert.equal(visible.agenda, null)

  let response = await api('/api/state', cookie, { method: 'PATCH', body: JSON.stringify({ revision: visible.revision, operations: [] }) })
  assert.equal(response.status, 403)
  response = await api('/api/history/export?month=2096-03&category=all', cookie)
  assert.equal(response.status, 403)
})

test('gestiona un servicio individual sin reenviar ni reducir el historial completo', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const editable = JSON.parse(db.prepare('SELECT data FROM work_history WHERE id = ?').get('qa-history-included').data)
  upsertJson(db, 'work_history', 'id', { ...editable, id: 'qa-history-editable', status: 'Pendiente' })
  db.close()
  const before = await state(administratorCookie)
  const base = before.history.find(record => record.id === 'qa-history-editable')
  const record = { ...base, detail: 'Actualización individual QA' }

  let response = await api(`/api/history/${encodeURIComponent(record.id)}`, administratorCookie, {
    method: 'PATCH',
    body: JSON.stringify({ base, record })
  })
  assert.equal(response.status, 200, await response.clone().text())
  const payload = await response.json()
  assert.equal(payload.state.history.length, before.history.length)
  assert.equal(payload.state.history.find(item => item.id === record.id).detail, 'Actualización individual QA')
  assert.equal(payload.state.history.find(item => item.id === 'qa-history-excluded').status, 'Completado')

  response = await api(`/api/history/${encodeURIComponent(record.id)}`, administratorCookie, {
    method: 'PATCH',
    body: JSON.stringify({ base, record: { ...record, detail: 'Escritura obsoleta' } })
  })
  assert.equal(response.status, 409)
  const completed = before.history.find(item => item.id === 'qa-history-excluded')
  response = await api(`/api/history/${completed.id}`, administratorCookie, {
    method: 'PATCH',
    body: JSON.stringify({ base: completed, record: { ...completed, detail: 'No debe cambiar' } })
  })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'COMPLETED_SERVICE_LOCKED')
  const after = await state(administratorCookie)
  assert.deepEqual(after.history.find(item => item.id === completed.id), completed)
})

test('elimina un control vehicular aunque su nombre visible haya quedado desalineado del técnico', async () => {
  const recordId = 'vehicle-control-2096-03-13-qa-vehicle'
  const record = {
    id: recordId, sourceTaskId: recordId, date: '2096-03-13', time: '15:30', scheduledTime: '15:30',
    serviceId: 'vehicle-weekly-control', service: 'Control semanal de vehículo', status: 'Pendiente',
    team: 'Equipo 1', teamId: 'qa-team', technicianIds: ['qa-tech'], technicians: ['Nombre visible incorrecto'],
    vehicleControl: true, vehicleId: 'qa-vehicle', vehicleControlScheduledFriday: '2096-03-13', monthlyVehicleAssignment: '2096-03'
  }
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  const database = new DatabaseSync(databasePath)
  database.prepare('INSERT INTO work_history (id, data) VALUES (?, ?)').run(recordId, JSON.stringify(record))
  const agenda = JSON.parse(database.prepare('SELECT data FROM agendas WHERE id = ?').get('current').data)
  agenda.weekly['2096-03-13'] = {
    teams: [{ teamId: 'qa-team', label: 'Equipo 1', memberIds: ['qa-admin'], members: ['QA Admin'], tasks: [{ ...record, taskId: recordId, historyId: recordId, technicians: ['QA Técnico'] }] }],
    removedTaskIds: []
  }
  database.prepare('UPDATE agendas SET data = ? WHERE id = ?').run(JSON.stringify(agenda), 'current')
  database.close()

  const administratorCookie = await login('qa-admin@pignus.test')
  const response = await api(`/api/history/${encodeURIComponent(recordId)}`, administratorCookie, {
    method: 'DELETE',
    body: JSON.stringify({ base: { ...record, technicians: ['Pascual Gonzalez'] } })
  })
  assert.equal(response.status, 200, await response.clone().text())
  const payload = await response.json()
  assert.equal(payload.deleted, true)
  assert.equal(payload.state.history.some(item => item.id === recordId), false)
  assert.deepEqual(payload.state.agenda.weekly['2096-03-13'].teams[0].tasks, [])
  assert.deepEqual(payload.state.agenda.weekly['2096-03-13'].removedTaskIds.sort(), [`history:${recordId}`, `task:${recordId}`].sort())
})

test('gestiona uno o varios servicios en una transacción atómica', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const before = await state(administratorCookie)
  const bases = before.history.slice(0, 2)
  assert.equal(bases.length, 2)

  let response = await api('/api/history/bulk', administratorCookie, {
    method: 'PATCH',
    body: JSON.stringify({
      updates: bases.map(base => ({ base, record: { ...base, status: 'Pendiente' } }))
    })
  })
  assert.equal(response.status, 200, await response.clone().text())
  let payload = await response.json()
  for (const base of bases) {
    assert.equal(payload.state.history.find(record => record.id === base.id).status, 'Pendiente')
  }

  const current = payload.state.history.filter(record => bases.some(base => base.id === record.id))
  response = await api('/api/history/bulk', administratorCookie, {
    method: 'PATCH',
    body: JSON.stringify({
      updates: [
        { base: current[0], record: { ...current[0], status: 'Cancelado' } },
        { base: { ...current[1], detail: 'Versión obsoleta' }, record: { ...current[1], status: 'Cancelado' } }
      ]
    })
  })
  assert.equal(response.status, 409)
  payload = await state(administratorCookie)
  assert.equal(payload.history.find(record => record.id === current[0].id).status, 'Pendiente')
  assert.equal(payload.history.find(record => record.id === current[1].id).status, 'Pendiente')
})

test('tipos de servicio usa operaciones pequeñas con concurrencia por registro', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const coordinatorCookie = await login('qa-weekly@pignus.test')
  const createdService = { id: 'qa-small-operation', code: 'qa-small-operation', category: 'service', name: 'Operación pequeña QA', description: '', estimatedMinutes: 30, status: 'Activo' }
  let response = await api('/api/services', coordinatorCookie, { method: 'POST', body: JSON.stringify({ service: createdService }) })
  assert.equal(response.status, 403)
  response = await api('/api/services', administratorCookie, { method: 'POST', body: JSON.stringify({ service: createdService }) })
  assert.equal(response.status, 200, await response.clone().text())
  let payload = await response.json()
  const created = payload.services.find(service => service.id === createdService.id)
  assert.equal(created.name, createdService.name)

  const edited = { ...created, name: 'Operación pequeña editada', estimatedMinutes: 45 }
  response = await api(`/api/services/${created.id}`, administratorCookie, { method: 'PUT', body: JSON.stringify({ base: created, service: edited }) })
  assert.equal(response.status, 200, await response.clone().text())
  payload = await response.json()
  assert.equal(payload.service.name, edited.name)
  assert.equal(payload.service.estimatedMinutes, 45)

  response = await api(`/api/services/${created.id}`, administratorCookie, { method: 'PUT', body: JSON.stringify({ base: created, service: { ...edited, name: 'Edición obsoleta' } }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'SERVICE_WRITE_CONFLICT')

  response = await api(`/api/services/${created.id}/status`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: payload.service }) })
  assert.equal(response.status, 200, await response.clone().text())
  payload = await response.json()
  assert.equal(payload.service.status, 'Inactivo')
  response = await api(`/api/services/${created.id}`, administratorCookie, { method: 'DELETE', body: JSON.stringify({ base: payload.service }) })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).outcome, 'deleted')
  assert.equal((await state(administratorCookie)).services.some(service => service.id === created.id), false)
})

test('vehículos usa operaciones pequeñas con matrícula y concurrencia por registro', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const weeklyCookie = await login('qa-weekly@pignus.test')
  const createdVehicle = { id: 'qa-small-vehicle', brand: 'Toyota', model: 'Hilux', year: 2026, mileage: 100, plate: 'QA999ZZ', insuranceExpiresOn: '' }
  let response = await api('/api/vehicles', weeklyCookie, { method: 'POST', body: JSON.stringify({ vehicle: createdVehicle }) })
  assert.equal(response.status, 403)
  response = await api('/api/vehicles', administratorCookie, { method: 'POST', body: JSON.stringify({ vehicle: createdVehicle }) })
  assert.equal(response.status, 200, await response.clone().text())
  let payload = await response.json()
  const created = payload.vehicle
  assert.equal(created.plate, createdVehicle.plate)

  response = await api(`/api/vehicles/${created.id}`, administratorCookie, { method: 'PUT', body: JSON.stringify({ base: created, vehicle: { ...created, mileage: 250 } }) })
  assert.equal(response.status, 200, await response.clone().text())
  payload = await response.json()
  assert.equal(payload.vehicle.mileage, 250)

  response = await api(`/api/vehicles/${created.id}`, administratorCookie, { method: 'PUT', body: JSON.stringify({ base: created, vehicle: { ...created, mileage: 300 } }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'VEHICLE_WRITE_CONFLICT')
  response = await api('/api/vehicles', administratorCookie, { method: 'POST', body: JSON.stringify({ vehicle: { ...createdVehicle, id: 'qa-duplicate-plate', plate: createdVehicle.plate.toLowerCase() } }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'VEHICLE_PLATE_CONFLICT')

  response = await api(`/api/vehicles/${created.id}`, administratorCookie, { method: 'DELETE', body: JSON.stringify({ base: payload.vehicle }) })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).outcome, 'deleted')
  assert.equal((await state(administratorCookie)).vehicles.some(vehicle => vehicle.id === created.id), false)
})

test('el seguro vehicular sólo se carga como administrador y se descarga con sesión técnica', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const technicianCookie = await login('qa-tech@pignus.test')
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}`
  let response = await api('/api/vehicle-insurance/qa-vehicle', technicianCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro.pdf', pdf }) })
  assert.equal(response.status, 403)
  const before = await state(administratorCookie)
  const vehicle = before.vehicles.find(item => item.id === 'qa-vehicle')
  response = await api('/api/vehicle-insurance/qa-vehicle', administratorCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro-qa.pdf', pdf, vehicle, insuranceExpiresOn: '2099-12-31', revision: before.revision }) })
  assert.equal(response.status, 200, await response.clone().text())
  const uploaded = await response.json()
  assert.equal(uploaded.vehicle.insuranceFileName, 'seguro-qa.pdf')
  assert.equal(uploaded.vehicle.insuranceExpiresOn, '2099-12-31')
  const persisted = await state(administratorCookie)
  assert.equal(persisted.vehicles.find(item => item.id === 'qa-vehicle').insuranceFileName, 'seguro-qa.pdf')
  const staleUpload = await api('/api/vehicle-insurance/qa-vehicle', administratorCookie, { method: 'POST', body: JSON.stringify({ fileName: 'seguro-no-debe-guardarse.pdf', pdf, vehicle, insuranceExpiresOn: '2099-12-31', revision: before.revision }) })
  assert.equal(staleUpload.status, 409)
  response = await api('/api/vehicle-insurance/qa-vehicle', technicianCookie)
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.match(response.headers.get('content-disposition'), /seguro-qa\.pdf/)
  response = await api('/api/vehicle-insurance/qa-vehicle', null)
  assert.equal(response.status, 401)
})

test('completar un control vehicular almacena la foto y permite volver a consultarla', async () => {
  const technicianCookie = await login('qa-tech@pignus.test')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const record = { id: 'qa-vehicle-control-photo', date: today, time: '00:00', client: 'Ford Ka · QA123AA', service: 'Control semanal de vehículo', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], vehicleControl: true, vehicleId: 'qa-vehicle', vehicleMileageAtScheduling: 1000 }
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  const setupDb = new DatabaseSync(databasePath)
  upsertJson(setupDb, 'work_history', 'id', record)
  setupDb.close()
  const photoBytes = Buffer.from('foto-interior-qa')
  const response = await api('/api/technician/status', technicianCookie, { method: 'POST', body: JSON.stringify({ recordId: record.id, type: 'Completado', observation: '', vehicleMileage: 1001, vehiclePhoto: `data:image/jpeg;base64,${photoBytes.toString('base64')}` }) })
  assert.equal(response.status, 200, await response.clone().text())
  const payload = await response.json()
  assert.equal(payload.record.vehiclePhotoUrl, `/api/vehicle-control/photo/${record.id}`)
  const photoResponse = await api(payload.record.vehiclePhotoUrl, technicianCookie)
  assert.equal(photoResponse.status, 200)
  assert.equal(photoResponse.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), photoBytes)
  const verificationDb = new DatabaseSync(databasePath)
  const storedPhoto = verificationDb.prepare('SELECT vehicle_id, mime_type, length(photo_data) AS bytes FROM vehicle_control_photos WHERE record_id = ?').get(record.id)
  assert.equal(storedPhoto.vehicle_id, 'qa-vehicle')
  assert.equal(storedPhoto.mime_type, 'image/jpeg')
  assert.equal(storedPhoto.bytes, photoBytes.length)
  const vehicles = JSON.parse(verificationDb.prepare("SELECT value FROM preferences WHERE key = 'vehicles'").get().value)
  assert.equal(vehicles.find(item => item.id === 'qa-vehicle').mileage, 1001)
  verificationDb.prepare('DELETE FROM vehicle_control_photos WHERE record_id = ?').run(record.id)
  verificationDb.prepare('DELETE FROM work_history WHERE id = ?').run(record.id)
  verificationDb.prepare("UPDATE preferences SET value = ? WHERE key = 'vehicles'").run(JSON.stringify(vehicles.map(item => item.id === 'qa-vehicle' ? { ...item, mileage: 1000 } : item)))
  verificationDb.close()
})

test('la foto de referencia del servicio sólo puede modificarla gestión y verla el técnico asignado', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const technicianCookie = await login('qa-tech@pignus.test')
  const record = { id: 'qa-service-reference-photo', sourceTaskId: 'qa-service-reference-task', date: '2099-01-10', time: '09:00', client: 'CLI-9000 CLIENTE QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], vehicleControl: false }
  const databasePath = path.join(temporaryDirectory, 'agenda-tecnica.db')
  const setupDb = new DatabaseSync(databasePath)
  upsertJson(setupDb, 'work_history', 'id', record)
  setupDb.close()
  const bytes = Buffer.from('foto-servicio-qa')
  const photo = `data:image/jpeg;base64,${bytes.toString('base64')}`

  let response = await api(`/api/service-photo/${record.id}`, technicianCookie, { method: 'POST', body: JSON.stringify({ photo }) })
  assert.equal(response.status, 403)
  response = await api(`/api/service-photo/${record.id}`, administratorCookie, { method: 'POST', body: JSON.stringify({ photo }) })
  assert.equal(response.status, 200, await response.clone().text())
  const uploaded = await response.json()
  assert.equal(uploaded.url, `/api/service-photo/${record.id}`)
  response = await api(uploaded.url, technicianCookie)
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  response = await api(uploaded.url, administratorCookie, { method: 'DELETE' })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await api(uploaded.url, technicianCookie)).status, 404)

  const cleanupDb = new DatabaseSync(databasePath)
  cleanupDb.prepare('DELETE FROM work_history WHERE id = ?').run(record.id)
  cleanupDb.close()
})

test('sirve la aplicación compilada y conserva aisladas las rutas API', async () => {
  const page = await api('/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(await page.text(), /<div id="root"><\/div>/)

  const missingApi = await api('/api/ruta-inexistente')
  assert.equal(missingApi.status, 404)
  assert.match(missingApi.headers.get('content-type'), /application\/json/)
})

test('gestiona solicitudes de contraseña únicamente para administradores', async () => {
  let response = await api('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ email: 'inexistente@pignus.test', password: 'Prueba1234' }) })
  assert.equal(response.status, 404)
  assert.match((await response.json()).error, /no está dado de alta/i)

  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'inexistente@pignus.test' }) })
  assert.equal(response.status, 404)
  assert.match((await response.json()).error, /contacto con un Administrador/i)

  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'QA-TECH@PIGNUS.TEST' }) })
  assert.equal(response.status, 200, await response.clone().text())
  response = await api('/api/auth/password-reset-requests', null, { method: 'POST', body: JSON.stringify({ email: 'qa-tech@pignus.test' }) })
  assert.equal(response.status, 200, await response.clone().text())

  const nonAdministratorCookie = await login('qa-employees@pignus.test')
  response = await api('/api/auth/password-reset-requests', nonAdministratorCookie)
  assert.equal(response.status, 403)

  const administratorCookie = await login('qa-admin@pignus.test')
  response = await api('/api/auth/password-reset-requests', administratorCookie)
  assert.equal(response.status, 200, await response.clone().text())
  let payload = await response.json()
  const matching = payload.requests.filter(request => request.email === 'qa-tech@pignus.test')
  assert.equal(matching.length, 1, 'Las solicitudes repetidas deben consolidarse por correo.')

  response = await api('/api/auth/password-reset-requests', administratorCookie, { method: 'DELETE', body: JSON.stringify({ id: matching[0].id }) })
  assert.equal(response.status, 200, await response.clone().text())
  response = await api('/api/auth/password-reset-requests', administratorCookie)
  payload = await response.json()
  assert.equal(payload.requests.some(request => request.email === 'qa-tech@pignus.test'), false)
})

test('el último ingreso invalida cualquier sesión anterior del mismo correo', async () => {
  const firstCookie = await login('qa-tech@pignus.test')
  let statusResponse = await api('/api/auth/session-status', firstCookie)
  assert.equal(statusResponse.status, 200)
  let statusPayload = await statusResponse.json()
  assert.deepEqual(Object.keys(statusPayload).sort(), ['active', 'expiresAt', 'sessionUser'])
  assert.equal(statusPayload.active, true)
  const ownMetadata = statusPayload.sessionUser
  assert.equal(ownMetadata.id, 'qa-tech')
  assert.equal(ownMetadata.email, 'qa-tech@pignus.test')
  assert.equal(ownMetadata.roleCode, 'technician')
  assert.equal(typeof ownMetadata.permissions, 'object')
  assert.deepEqual(Object.keys(ownMetadata).sort(), ['email', 'id', 'name', 'permissions', 'role', 'roleCode', 'roleId', 'technicalEnabled'])
  for (const key of ['password', 'passwordHash', 'sessionToken', 'token']) assert.equal(Object.hasOwn(ownMetadata, key), false)

  const activityResponse = await api('/api/auth/activity', firstCookie, { method: 'POST' })
  assert.equal(activityResponse.status, 200)
  assert.match(activityResponse.headers.get('set-cookie'), /Max-Age=86400/)

  const secondCookie = await login('qa-tech@pignus.test')
  assert.notEqual(firstCookie, secondCookie)
  const displaced = await api('/api/auth/session-status', firstCookie)
  assert.equal(displaced.status, 401)
  const payload = await displaced.json()
  assert.equal(payload.code, 'SESSION_ENDED')
  assert.match(payload.error, /otro dispositivo|vencido/i)
  statusResponse = await api('/api/auth/session-status', secondCookie)
  statusPayload = await statusResponse.json()
  assert.equal(statusPayload.active, true)
  assert.deepEqual(statusPayload.sessionUser, ownMetadata)
})

test('el ingreso entrega el estado y la recuperación por F5 valida primero la sesión de forma liviana', async () => {
  const loginResponse = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa-admin@pignus.test', password: 'Prueba1234' }) })
  assert.equal(loginResponse.status, 200)
  const loginPayload = await loginResponse.json()
  assert.equal(loginPayload.user.email, 'qa-admin@pignus.test')
  assert.ok(Array.isArray(loginPayload.state.history))
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0]
  const sessionResponse = await api('/api/auth/session', cookie)
  assert.equal(sessionResponse.status, 200)
  const sessionPayload = await sessionResponse.json()
  assert.equal(sessionPayload.user.email, loginPayload.user.email)
  assert.equal('state' in sessionPayload, false)
  const recoveredState = await state(cookie)
  assert.equal(recoveredState.revision, loginPayload.state.revision)
  assert.ok(recoveredState.agenda)
  const logoutResponse = await api('/api/auth/logout', cookie, { method: 'POST', body: JSON.stringify({ discardDailyAgenda: false }) })
  assert.equal(logoutResponse.status, 200)
})

test('cerrar sesión ignora el descarte antiguo y preserva la agenda y las otras sesiones', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const otherCookie = await login('qa-tech@pignus.test')
  const before = await state(cookie)
  const response = await api('/api/auth/logout', cookie, { method: 'POST', body: JSON.stringify({ discardDailyAgenda: true }) })
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal((await api('/api/auth/session-status', cookie)).status, 401)
  assert.equal((await api('/api/auth/session-status', otherCookie)).status, 200)
  const after = await state(await login('qa-admin@pignus.test'))
  assert.deepEqual(after.agenda, before.agenda)
  assert.deepEqual(after.history, before.history)
  assert.equal(after.revision, before.revision)
})

test('Operador consulta la agenda pero no puede escribir, exportar ni usar otros módulos', async () => {
  const cookie = await login('qa-operator@pignus.test')
  const before = await state(cookie)
  assert.ok(before.agenda.weekly)
  assert.deepEqual(before.agenda.teams, [])
  assert.deepEqual(before.vehicles, [])
  assert.ok(before.employees.every(employee => !employee.passwordHash && !employee.email))
  for (const [method, route] of [
    ['PUT', '/api/state'], ['PATCH', '/api/state'], ['POST', '/api/agenda/daily/clear'],
    ['PATCH', '/api/history/bulk'], ['DELETE', '/api/history/qa-history-included'],
    ['POST', '/api/service-photo/qa-history-included'], ['POST', '/api/technician/status'],
    ['GET', '/api/technician/state'], ['GET', '/api/history/export'], ['GET', '/api/audit'],
    ['POST', '/api/services'], ['POST', '/api/vehicles'], ['GET', '/api/customers/import']
  ]) {
    const response = await api(route, cookie, { method, ...(method === 'GET' ? {} : { body: JSON.stringify(before) }) })
    assert.equal(response.status, 403, `${method} ${route}`)
  }
  const after = await state(cookie)
  assert.deepEqual(after, before)
  assert.equal((await api('/api/auth/activity', cookie, { method: 'POST' })).status, 200)
  assert.equal((await api('/api/auth/logout', cookie, { method: 'POST', body: '{}' })).status, 200)
})

test('alta confirmada de empleado Operador admite rol UUID y conserva agenda e historial', async () => {
  const { employeeOperations } = await import('../src/features/state/application/employee-operations.mjs')
  const cookie = await login('qa-admin@pignus.test')
  const before = await state(cookie)
  const role = before.roles.find(item => item.code === 'operator')
  const employee = { id: 'qa-new-operator', firstName: 'Nuevo', lastName: 'Operador', name: 'Nuevo Operador', roleId: role.id, role: 'Operador', email: 'qa-new-operator@pignus.test', password: 'Prueba1234', status: 'Activo', technicalEnabled: false }
  const response = await api('/api/state', cookie, { method: 'PATCH', body: JSON.stringify({ revision: before.revision, operations: employeeOperations(null, employee) }) })
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  const after = await state(cookie)
  assert.equal(after.employees.find(item => item.id === employee.id).roleId, role.id)
  assert.deepEqual(after.agenda, before.agenda)
  assert.deepEqual(after.history, before.history)
  await login('qa-admin@pignus.test')
  await login('qa-tech@pignus.test')
  const operatorCookie = await login(employee.email)
  assert.equal((await api('/api/state', operatorCookie, { method: 'PATCH', body: JSON.stringify({ operations: [] }) })).status, 403)
})

test('un gestor de empleados no puede elevar privilegios', async () => {
  const cookie = await login('qa-employees@pignus.test')
  let current = await state(cookie)
  const administrator = current.employees.find(employee => String(employee.roleId) === '1')
  current.employees.find(employee => employee.id === 'qa-employees').technicalEnabled = true
  administrator.roleId = 3
  administrator.role = 'Técnico'
  current.roles.find(role => String(role.id) === '1').permissions = {}
  let response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(cookie)
  assert.equal(String(current.employees.find(employee => employee.id === administrator.id).roleId), '1')
  assert.equal(current.roles.find(role => String(role.id) === '1').permissions.audit, true)
  assert.equal(current.employees.find(employee => employee.id === 'qa-employees').technicalEnabled, false)
  current.employees.push({ id: 'rogue-admin', firstName: 'Rogue', lastName: 'Admin', name: 'Rogue Admin', roleId: 1, role: 'Administrador', email: 'rogue@pignus.test', phone: '', status: 'Activo', password: 'Prueba1234' })
  response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 403)
})

test('un permiso de configuración no permite alterar roles protegidos', async () => {
  const cookie = await login('qa-settings@pignus.test')
  let current = await state(cookie)
  current.roles.find(role => role.id === 'qa-settings-role').code = 'administrator'
  current.roles.find(role => role.id === 'qa-settings-role').permissions = { audit: true, settings: true, employees: true }
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(cookie)
  assert.equal(current.roles.find(role => role.id === 'qa-settings-role').code, 'qa-settings')
})

test('separa permisos de agenda semanal y diaria', async () => {
  const cookie = await login('qa-weekly@pignus.test')
  let current = await state(cookie)
  const originalDate = current.agenda.date
  const weeklyKey = '2099-01-05'
  current.agenda.date = '2099-01-01'
  current.agenda.teams = []
  current.agenda.weekly = { ...(current.agenda.weekly || {}), [weeklyKey]: { teams: [] } }
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(cookie)
  assert.equal(current.agenda.date, originalDate)
  assert.ok(current.agenda.weekly[weeklyKey])
})

test('rechaza escrituras con una revisión antigua', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const original = await state(cookie)
  const first = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(original) })
  assert.equal(first.status, 200)
  const stale = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(original) })
  assert.equal(stale.status, 409)
  const conflict = await stale.json()
  assert.equal(conflict.code, 'STATE_REVISION_CONFLICT')
  assert.equal(Number.isInteger(conflict.revision), true)
})

test('fusiona dos escrituras concurrentes sobre registros diferentes', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const baseline = await state(cookie)
  const left = { ...baseline, base: baseline, services: [...baseline.services, { id: 'qa-concurrent-left', name: 'Servicio concurrente izquierdo', description: '', estimatedMinutes: 60, status: 'Activo' }] }
  const right = { ...baseline, base: baseline, services: [...baseline.services, { id: 'qa-concurrent-right', name: 'Servicio concurrente derecho', description: '', estimatedMinutes: 60, status: 'Activo' }] }

  const responses = await Promise.all([
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(left) }),
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(right) })
  ])
  assert.deepEqual(responses.map(response => response.status), [200, 200])

  const persisted = await state(cookie)
  const concurrentIds = persisted.services.filter(service => String(service.id).startsWith('qa-concurrent-')).map(service => service.id)
  assert.equal(concurrentIds.length, 2)
})

test('fusiona usando una base compacta sin alterar secciones ajenas', async () => {
  const cookies = await Promise.all([login('qa-admin@pignus.test'), login('qa-admin-secondary@pignus.test')])
  const baseline = await state(cookies[0])
  const update = (id, name) => ({
    ...baseline,
    base: { services: baseline.services },
    services: [...baseline.services, { id, name, description: '', estimatedMinutes: 60, status: 'Activo' }]
  })
  const responses = await Promise.all([
    api('/api/state', cookies[0], { method: 'PUT', body: JSON.stringify(update('qa-compact-left', 'Compacto izquierdo')) }),
    api('/api/state', cookies[1], { method: 'PUT', body: JSON.stringify(update('qa-compact-right', 'Compacto derecho')) })
  ])

  assert.deepEqual(responses.map(response => response.status), [200, 200])
  const persisted = await state(cookies[0])
  assert.equal(persisted.services.some(service => service.id === 'qa-compact-left'), true)
  assert.equal(persisted.services.some(service => service.id === 'qa-compact-right'), true)
  assert.deepEqual(persisted.customers, baseline.customers)
})

test('conserva una ráfaga multiusuario de altas independientes', async () => {
  const cookies = await Promise.all([login('qa-admin@pignus.test'), login('qa-admin-secondary@pignus.test')])
  const baseline = await state(cookies[0])
  const ids = Array.from({ length: 12 }, (_, index) => `qa-stress-${index + 1}`)
  const responses = await Promise.all(ids.map((id, index) => api('/api/state', cookies[index % cookies.length], {
    method: 'PUT',
    body: JSON.stringify({
      ...baseline,
      base: baseline,
      services: [...baseline.services, { id, name: `Servicio de estrés ${index + 1}`, description: '', estimatedMinutes: 60, status: 'Activo' }]
    })
  })))

  assert.equal(responses.every(response => response.status === 200), true)
  const persisted = await state(cookies[0])
  assert.deepEqual(persisted.services.filter(service => ids.includes(service.id)).map(service => service.id).sort(), ids.sort())
})

test('rechaza dos escrituras concurrentes sobre el mismo campo', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const baseline = await state(cookie)
  const target = baseline.services.find(service => service.id === 'qa-service')
  const update = description => ({ ...baseline, base: baseline, services: baseline.services.map(service => service.id === target.id ? { ...service, description } : service) })

  const responses = await Promise.all([
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(update('Cambio concurrente A')) }),
    api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(update('Cambio concurrente B')) })
  ])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  const conflict = await responses.find(response => response.status === 409).json()
  assert.equal(conflict.code, 'STATE_WRITE_CONFLICT')
  assert.match(conflict.conflictPath, /services\[id:qa-service\]\.description/)
})

test('una ráfaga sobre el mismo campo confirma una sola escritura', async () => {
  const cookies = await Promise.all([login('qa-admin@pignus.test'), login('qa-admin-secondary@pignus.test')])
  const baseline = await state(cookies[0])
  const target = baseline.services.find(service => service.id === 'qa-service')
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => api('/api/state', cookies[index % cookies.length], {
    method: 'PUT',
    body: JSON.stringify({
      ...baseline,
      base: baseline,
      services: baseline.services.map(service => service.id === target.id ? { ...service, description: `Colisión ${index + 1}` } : service)
    })
  })))

  assert.equal(responses.filter(response => response.status === 200).length, 1)
  assert.equal(responses.filter(response => response.status === 409).length, 7)
  const conflicts = await Promise.all(responses.filter(response => response.status === 409).map(response => response.json()))
  assert.equal(conflicts.every(conflict => conflict.code === 'STATE_WRITE_CONFLICT'), true)
})

test('revoca inmediatamente una sesión al desactivar el empleado', async () => {
  const adminCookie = await login('qa-admin@pignus.test')
  const employeeCookie = await login('qa-settings@pignus.test')
  const current = await state(adminCookie)
  current.employees.find(employee => employee.id === 'qa-settings').status = 'Inactivo'
  const update = await api('/api/state', adminCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(update.status, 200)
  assert.equal((await api('/api/state', employeeCookie)).status, 401)
})

test('la exportación técnica contiene solamente trabajos asignados', async () => {
  const cookie = await login('qa-tech@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'), { readOnly: true })
  const preference = key => db.prepare('SELECT value FROM preferences WHERE key = ?').get(key).value
  const month = preference('qa_export_month'), included = preference('qa_export_included'), excluded = preference('qa_export_excluded')
  db.close()
  const response = await api(`/api/history/export?month=${month}&category=all`, cookie)
  assert.equal(response.status, 200, await response.clone().text())
  const report = await response.text()
  assert.ok(report.includes(included))
  assert.ok(!report.includes(excluded))
})

test('el técnico inicia únicamente su servicio y el reintento no duplica la operación', async () => {
  const technicianCookie = await login('qa-tech@pignus.test')
  const administratorCookie = await login('qa-admin@pignus.test')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const record = { id: 'qa-tech-start', date: today, time: '00:00', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] }
  const foreignRecord = { ...record, id: 'qa-tech-start-foreign', technicianIds: ['otro-tecnico'], technicians: ['Otro Técnico'] }
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(db, 'work_history', 'id', record)
  upsertJson(db, 'work_history', 'id', foreignRecord)
  db.close()
  try {
    let response = await api('/api/technician/start', technicianCookie, { method: 'POST', body: JSON.stringify({ recordId: record.id }) })
    assert.equal(response.status, 200, await response.clone().text())
    const first = await response.json()
    assert.equal(first.record.startedById, 'qa-tech')
    assert.ok(first.record.startedAt)

    response = await api('/api/technician/start', technicianCookie, { method: 'POST', body: JSON.stringify({ recordId: record.id }) })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal((await response.json()).record.startedAt, first.record.startedAt)

    response = await api('/api/technician/start', technicianCookie, { method: 'POST', body: JSON.stringify({ recordId: foreignRecord.id }) })
    assert.equal(response.status, 403)
    response = await api('/api/technician/start', administratorCookie, { method: 'POST', body: JSON.stringify({ recordId: record.id }) })
    assert.equal(response.status, 403)
  } finally {
    const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
    cleanupDb.prepare('DELETE FROM work_history WHERE id IN (?, ?)').run(record.id, foreignRecord.id)
    cleanupDb.close()
  }
})

test('el historial contextual del técnico es de solo lectura y registra quién informó', async () => {
  const cookie = await login('qa-tech@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const records = [
    { id: 'qa-tech-current', date: today, time: '00:00', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] },
    { id: 'qa-tech-empty-observation', date: today, time: '00:00', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] },
    { id: 'qa-tech-context', date: '2095-01-10', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Completado', technicianIds: ['otro-tecnico'], technicians: ['Otro Técnico'], technicalObservation: 'Revisar magnético.' },
    { id: 'qa-tech-private', date: '2095-01-10', customerId: 'qa-customer-b', clientAccount: 'PIG-9002', client: 'PIG-9002 CLIENTE EXCLUIDO QA', service: 'Service técnico', status: 'Completado', technicianIds: ['otro-tecnico'], technicians: ['Otro Técnico'] }
  ]
  records.forEach(record => upsertJson(db, 'work_history', 'id', record))
  db.close()

  const visible = await state(cookie)
  assert.ok(visible.history.some(record => record.id === 'qa-tech-current'))
  assert.ok(visible.history.some(record => record.id === 'qa-tech-context'))
  assert.equal(visible.history.some(record => record.id === 'qa-tech-private'), false)
  assert.deepEqual(visible.customers, [])

  // Conserva la misma sesión: simula que Administración agrega un servicio
  // después de que el técnico ya abrió su agenda.
  const addedDuringSession = { id: 'qa-tech-added-during-session', date: today, time: '14:30', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CLIENTE INCLUIDO QA', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] }
  const liveUpdateDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(liveUpdateDb, 'work_history', 'id', addedDuringSession)
  liveUpdateDb.close()
  const refreshedDuringSession = await state(cookie)
  assert.ok(refreshedDuringSession.history.some(record => record.id === addedDuringSession.id))

  const futureVehicleControl = { id: 'qa-tech-future-vehicle-control', date: '2999-08-29', time: '15:30', client: 'Ford Ka · QA123AA', service: 'Control semanal de vehículo', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'], vehicleControl: true, vehicleId: 'qa-vehicle' }
  const vehicleControlDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(vehicleControlDb, 'work_history', 'id', futureVehicleControl)
  vehicleControlDb.close()
  try {
    const earlyVehicleControl = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: futureVehicleControl.id, type: 'Completado', observation: '', vehicleMileage: 1, vehiclePhoto: 'data:image/jpeg;base64,YQ==' }) })
    assert.equal(earlyVehicleControl.status, 409)
    assert.match((await earlyVehicleControl.json()).error, /se habilita el/i)
  } finally {
    const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
    cleanupDb.prepare('DELETE FROM work_history WHERE id = ?').run(futureVehicleControl.id)
    cleanupDb.close()
  }

  const withoutObservation = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-empty-observation', type: 'Completado', observation: '   ' }) })
  assert.equal(withoutObservation.status, 400)
  assert.match((await withoutObservation.json()).error, /observación es obligatoria/i)

  const started = await api('/api/technician/start', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-current' }) })
  assert.equal(started.status, 200)
  const response = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-current', type: 'Completado', observation: 'Trabajo completado; revisar magnético en la próxima visita.' }) })
  assert.equal(response.status, 200, await response.clone().text())
  const payload = await response.json()
  assert.equal(payload.record.technicalReportedById, 'qa-tech')
  assert.equal(payload.record.technicalReportedByName, 'QA Técnico')
  assert.match(payload.record.technicalObservation, /revisar magnético/i)

  const repeated = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-current', type: 'Completado', observation: 'Trabajo completado; revisar magnético en la próxima visita.' }) })
  assert.equal(repeated.status, 200)
  const repeatedPayload = await repeated.json()
  assert.equal(repeatedPayload.record.technicalReportedAt, payload.record.technicalReportedAt)

  const forbidden = await api('/api/technician/status', cookie, { method: 'POST', body: JSON.stringify({ recordId: 'qa-tech-context', type: 'Completado', observation: 'No autorizado' }) })
  assert.equal(forbidden.status, 403)
})

test('ordena las instalaciones por fecha en Excel y PDF', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const alarmService = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => service.code === 'alarm-installation')
  assert.ok(alarmService)
  const base = { serviceId: alarmService.id, service: alarmService.name, installationZone: 'docta', address: 'Dirección QA', phone: '3510000000', technicians: ['QA Técnico'], technicianIds: ['qa-tech'], status: 'Completado' }
  const testRecords = [
    { ...base, id: 'qa-installation-oldest', date: '2097-04-01', time: '10:00', client: 'INSTALACIÓN ANTIGUA QA' },
    { ...base, id: 'qa-installation-newest-late', date: '2097-04-03', time: '15:00', client: 'INSTALACIÓN RECIENTE TARDE QA' },
    { ...base, id: 'qa-installation-middle', date: '2097-04-02', time: '09:00', client: 'INSTALACIÓN INTERMEDIA QA' },
    { ...base, id: 'qa-installation-newest-early', date: '2097-04-03', time: '08:00', client: 'INSTALACIÓN RECIENTE TEMPRANO QA' }
  ]
  testRecords.forEach(record => upsertJson(db, 'work_history', 'id', record))
  db.close()

  const excelResponse = await api('/api/history/export?month=2097-04&category=docta', cookie)
  assert.equal(excelResponse.status, 200)
  const report = await excelResponse.text()
  const positions = testRecords.map(record => report.indexOf(record.client))
  assert.ok(positions.every(position => position >= 0))
  assert.ok(positions[3] < positions[1], 'En una misma fecha, la hora más temprana debe aparecer primero.')
  assert.ok(positions[0] < positions[2] && positions[2] < positions[3], 'Las fechas deben aparecer desde la más antigua hasta la más reciente.')

  const pdfResponse = await api('/api/history/export?month=2097-04&category=docta&format=pdf', cookie)
  assert.equal(pdfResponse.status, 200)
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
  const pdf = Buffer.from(await pdfResponse.arrayBuffer())
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')

  const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  cleanupDb.prepare(`DELETE FROM work_history WHERE id IN (${testRecords.map(() => '?').join(', ')})`).run(...testRecords.map(record => record.id))
  cleanupDb.close()
})

test('exporta en Excel únicamente las bajas completadas del mes solicitado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const retirement = db.prepare('SELECT data FROM services').all().map(row => JSON.parse(row.data)).find(service => String(service.name || '').toLocaleLowerCase('es-AR').includes('retiro de equipo'))
  assert.ok(retirement)
  const base = { date: '2098-05-12', serviceId: retirement.id, service: retirement.name, address: 'Dirección QA', phone: '3510000000', technicians: ['QA Técnico'], technicianIds: ['qa-tech'], detail: 'Retiro de prueba', team: 'Equipo 1' }
  upsertJson(db, 'work_history', 'id', { ...base, id: 'qa-retirement-export-complete', client: 'BAJA COMPLETADA QA', status: 'Completado' })
  upsertJson(db, 'work_history', 'id', { ...base, id: 'qa-retirement-export-pending', client: 'BAJA PENDIENTE QA', status: 'Pendiente' })
  db.close()
  const response = await api('/api/history/export?month=2098-05&category=retirements', cookie)
  assert.equal(response.status, 200, await response.clone().text())
  assert.match(response.headers.get('content-disposition') || '', /bajas-servicio-2098-05\.xls/)
  const report = await response.text()
  const pdfResponse = await api('/api/history/export?month=2098-05&category=retirements&format=pdf', cookie)
  assert.equal(pdfResponse.status, 200)
  assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
  assert.match(pdfResponse.headers.get('content-disposition') || '', /bajas-servicio-2098-05\.pdf/)
  const pdf = Buffer.from(await pdfResponse.arrayBuffer())
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  const cleanupDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  cleanupDb.prepare('DELETE FROM work_history WHERE id IN (?, ?)').run('qa-retirement-export-complete', 'qa-retirement-export-pending')
  cleanupDb.close()
  assert.ok(report.includes('BAJA COMPLETADA QA'))
  assert.ok(!report.includes('BAJA PENDIENTE QA'))
  assert.ok(report.includes('PIGNUS · Gestión operativa'))
  assert.ok(report.includes('class="text-value contact"'))
  assert.ok(!report.includes('<th>Equipo</th>'))
  assert.ok(!report.includes('<th>Detalle</th>'))
})

test('limpia solamente la agenda diaria mediante endpoint dedicado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const before = await state(cookie)
  const response = await api('/api/agenda/daily/clear', cookie, { method: 'POST' })
  assert.equal(response.status, 200, await response.clone().text())
  const after = await state(cookie)
  assert.deepEqual(after.agenda.weekly, before.agenda.weekly)
  assert.equal(after.agenda.teams.length, 1)
  assert.equal(after.agenda.teams[0].tasks.length, 0)
})

test('rechaza cuerpos excesivos sin derribar la API', async () => {
  const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(60_000), password: 'Prueba1234' }) })
  assert.equal(response.status, 400)
  assert.equal((await api('/api/state')).status, 401)
})

test('normaliza como pendiente un servicio nuevo sin estado', async () => {
  const cookie = await login('qa-admin@pignus.test')
  const current = await state(cookie)
  const source = current.history[0]
  const id = `qa-history-without-status-${Date.now()}`
  current.history.unshift({ ...source, id, status: undefined })
  const response = await api('/api/state', cookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  const saved = await state(cookie)
  assert.equal(saved.history.find(record => record.id === id).status, 'Pendiente')
})

test('conserva únicamente el autor original de carga de un servicio', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  const base = current.history[0]
  const id = `trace-${Date.now()}`
  current.history.push({
    ...base,
    id,
    sourceTaskId: id,
    detail: 'Servicio de prueba de trazabilidad',
    status: 'Pendiente',
    createdBy: { id: 'falso', name: 'Usuario falso', role: 'Administrador', at: new Date().toISOString() }
  })
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  let record = current.history.find(item => item.id === id)
  assert.equal(record.createdBy.name, 'QA Admin')
  assert.equal(record.lastUpdatedBy, undefined)

  current.employees.find(employee => employee.id === 'qa-settings').status = 'Activo'
  current.roles.find(role => role.id === 'qa-settings-role').permissions = { settings: true, history: true }
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  const settingsCookie = await login('qa-settings@pignus.test')
  current = await state(settingsCookie)
  record = current.history.find(item => item.id === id)
  record.detail = 'Detalle actualizado por otra sesión'
  response = await api('/api/state', settingsCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  record = current.history.find(item => item.id === id)
  assert.equal(record.createdBy.name, 'QA Admin')
  assert.equal(record.lastUpdatedBy, undefined)
})

test('limita la auditoría almacenada y visible a los últimos 100 registros', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  const current = await state(administratorCookie)
  current.services.push(...Array.from({ length: 105 }, (_, index) => ({ id: `qa-audit-service-${index}`, code: `qa-audit-service-${index}`, name: `Servicio de auditoría ${index}`, description: 'Prueba del límite', category: 'service', status: 'Activo' })))
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  response = await api('/api/audit?limit=500', administratorCookie)
  assert.equal(response.status, 200, await response.clone().text())
  const records = (await response.json()).records
  assert.equal(records.length, 100)
  assert.equal(Object.hasOwn(records[0], 'before'), false)
  assert.equal(Object.hasOwn(records[0], 'after'), false)
  const detailResponse = await api(`/api/audit/${encodeURIComponent(records[0].id)}`, administratorCookie)
  assert.equal(detailResponse.status, 200)
  assert.equal((await detailResponse.json()).record.id, records[0].id)
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM audit_log').get().total, 100)
  db.close()
})

test('rechaza clientes nuevos sin dirección y completa abonados importados', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-client-incomplete', kind: 'client', account: 'CLI-9998', name: 'CLIENTE INCOMPLETO', street: '', address: '', locality: '', province: '', phone: '', type: '', fields: {} })
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 400)

  current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-client-without-contact', kind: 'client', account: 'CLI-9997', name: 'CLIENTE SIN CONTACTO', street: 'Calle QA 100', address: 'Calle QA 100', locality: '', province: '', phone: '', type: '', fields: {} })
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 400)

  current = await state(administratorCookie)
  current.customers.push({ customerId: 'qa-subscriber-incomplete', kind: 'subscriber', account: 'PIG-999998', name: '', street: '', address: '', locality: '', province: '', phone: '', type: '', fields: {} })
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  const imported = current.customers.find(customer => customer.customerId === 'qa-subscriber-incomplete')
  assert.equal(imported.name, '-')
  assert.equal(imported.street, '-')
  assert.equal(imported.address, '-')
  assert.equal(imported.phone, '-')
})

test('mantiene vinculados los históricos cuando una baja convierte PIG en CLI', async () => {
  const administratorCookie = await login('qa-admin@pignus.test')
  let current = await state(administratorCookie)
  const customerId = 'qa-converted-customer'
  const originalAccount = 'PIG-999997'
  const base = current.history[0]
  const retirement = current.services.find(service => String(service.name).toLocaleLowerCase('es-AR').includes('retiro de equipo'))
  assert.ok(retirement)
  current.customers.push({ customerId, kind: 'subscriber', account: originalAccount, name: 'CLIENTE CONVERTIDO QA', street: 'Calle QA 123', address: 'Calle QA 123', locality: '', province: '', phone: '3515550101', type: 'Residencial', fields: {} })
  current.history.push(
    { ...base, id: 'qa-before-conversion', date: '2020-01-01', time: '10:00', customerId, clientAccount: originalAccount, client: `${originalAccount} CLIENTE CONVERTIDO QA`, status: 'Completado' },
    { ...base, id: 'qa-retirement-conversion', date: '2020-01-01', time: '10:00', customerId, clientAccount: originalAccount, client: `${originalAccount} CLIENTE CONVERTIDO QA`, serviceId: retirement.id, service: retirement.name, status: 'Completado' }
  )
  let response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  const converted = current.customers.find(customer => customer.customerId === customerId)
  assert.equal(converted.kind, 'client')
  assert.equal(converted.convertedFromAccount, originalAccount)
  for (const id of ['qa-before-conversion', 'qa-retirement-conversion']) {
    const record = current.history.find(item => item.id === id)
    assert.equal(record.customerId, customerId)
    assert.equal(record.clientAccount, converted.account)
    assert.match(record.client, new RegExp(`^${converted.account}`))
  }
  assert.equal(current.customers.filter(customer => customer.name === 'CLIENTE CONVERTIDO QA').length, 1)
  const completed = current.history.find(item => item.id === 'qa-retirement-conversion')
  response = await api(`/api/history/${completed.id}`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: completed, record: { ...completed, status: 'Cancelado' } }) })
  assert.equal(response.status, 200, await response.text())
  current = await state(administratorCookie)
  const restored = current.customers.find(customer => customer.customerId === customerId)
  assert.equal(restored.kind, 'subscriber')
  assert.equal(restored.account, originalAccount)
  assert.equal(restored.type, 'Residencial')
  assert.equal(restored.subscriptionEndedAt, undefined)
  assert.equal(current.history.find(item => item.id === completed.id).status, 'Cancelado')
  assert.equal(current.history.find(item => item.id === 'qa-before-conversion').clientAccount, originalAccount)
  // A stale correction must not undo the successful restoration.
  response = await api(`/api/history/${completed.id}`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: completed, record: { ...completed, status: 'Pendiente' } }) })
  assert.equal(response.status, 409)
  const cancelled = current.history.find(item => item.id === completed.id)
  response = await api(`/api/history/${completed.id}`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: cancelled, record: { ...cancelled, status: 'Completado' } }) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  const recompleted = current.history.find(item => item.id === completed.id)
  response = await api('/api/history/bulk', administratorCookie, { method: 'PATCH', body: JSON.stringify({ updates: [{ base: recompleted, record: { ...recompleted, status: 'Pendiente' } }] }) })
  assert.equal(response.status, 200, await response.text())
  current = await state(administratorCookie)
  assert.equal(current.customers.find(customer => customer.customerId === customerId).account, originalAccount)
  const pendingRetirement = current.history.find(item => item.id === completed.id)
  response = await api(`/api/history/${completed.id}`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: pendingRetirement, record: { ...pendingRetirement, status: 'Completado' } }) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  const cli = current.customers.find(customer => customer.customerId === customerId)
  const importedId = 'qa-reimported-pig'
  current.customers.push({ ...cli, customerId: importedId, account: originalAccount, kind: 'subscriber', convertedFromAccount: undefined, convertedFromType: undefined, subscriptionEndedAt: undefined, softguardRetirementResolution: undefined })
  response = await api('/api/state', administratorCookie, { method: 'PUT', body: JSON.stringify(current) })
  assert.equal(response.status, 200, await response.clone().text())
  current = await state(administratorCookie)
  const toCancel = current.history.find(item => item.id === completed.id)
  response = await api(`/api/history/${completed.id}`, administratorCookie, { method: 'PATCH', body: JSON.stringify({ base: toCancel, record: { ...toCancel, status: 'Cancelado' } }) })
  assert.equal(response.status, 200, await response.text())
  current = await state(administratorCookie)
  assert.equal(current.customers.some(customer => customer.customerId === customerId), false)
  assert.equal(current.customers.find(customer => customer.customerId === importedId).account, originalAccount)
  assert.equal(current.history.find(item => item.id === completed.id).customerId, importedId)
  assert.equal(current.history.find(item => item.id === 'qa-before-conversion').customerId, importedId)
})

test('la importación requiere permiso, pide una revisión vigente y el administrador puede deshacerla', async () => {
  const weeklyCookie = await login('qa-weekly@pignus.test')
  let response = await api('/api/customers/import', weeklyCookie, { method: 'POST', body: JSON.stringify({ revision: 0, customers: [] }) })
  assert.equal(response.status, 403)

  const administratorCookie = await login('qa-admin@pignus.test')
  const before = await state(administratorCookie)
  response = await api('/api/customers/import', administratorCookie)
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).canUndo, false)
  response = await api('/api/customers/import', administratorCookie, { method: 'POST', body: JSON.stringify({ revision: before.revision, customers: [] }) })
  assert.equal(response.status, 409, await response.clone().text())
  assert.match((await response.json()).error, /no puede eliminar abonados ni clientes existentes/)
  assert.equal((await state(administratorCookie)).customers.length, before.customers.length)
  const importedCustomer = { customerId: 'qa-import-reversible', kind: 'subscriber', account: 'PIG-999999', name: 'IMPORTACIÓN REVERSIBLE QA', street: 'Calle QA 999', address: 'Calle QA 999', locality: 'Córdoba', province: 'Córdoba', phone: '3519999999', type: 'Residencial', fields: {} }
  response = await api('/api/customers/import', administratorCookie, { method: 'POST', body: JSON.stringify({ revision: before.revision, customers: [...before.customers, importedCustomer] }) })
  assert.equal(response.status, 200, await response.clone().text())
  const importPayload = await response.json()
  assert.equal(importPayload.customers.length, before.customers.length + 1)
  assert.ok((await state(administratorCookie)).customers.some(customer => customer.customerId === importedCustomer.customerId))

  response = await api('/api/customers/import', administratorCookie)
  assert.equal((await response.json()).canUndo, true)

  response = await api('/api/customers/import', administratorCookie, { method: 'DELETE' })
  assert.equal(response.status, 200, await response.clone().text())
  assert.ok(!(await state(administratorCookie)).customers.some(customer => customer.customerId === importedCustomer.customerId))
  response = await api('/api/customers/import', administratorCookie)
  assert.equal((await response.json()).canUndo, false)

  const afterUndo = await state(administratorCookie)
  response = await api('/api/customers/import', administratorCookie, { method: 'POST', body: JSON.stringify({ revision: afterUndo.revision, customers: [...afterUndo.customers, importedCustomer], responseMode: 'compact-v1' }) })
  assert.equal(response.status, 200, await response.clone().text())
  const compactPayload = await response.json()
  assert.equal(compactPayload.customerCount, before.customers.length + 1)
  assert.equal(Object.hasOwn(compactPayload, 'customers'), false)
  response = await api('/api/customers/import', administratorCookie, { method: 'DELETE' })
  assert.equal(response.status, 200, await response.clone().text())
  assert.ok(!(await state(administratorCookie)).customers.some(customer => customer.customerId === importedCustomer.customerId))
})

test('elimina copias de una misma tarea sin confundir servicios distintos', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'uno', tasks: [{ historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }, { historyId: 'work-1', taskId: 'task-1', client: 'CLIENTE A' }] },
    { teamId: 'dos', tasks: [{ historyId: 'work-2', taskId: 'task-2', client: 'CLIENTE A' }] }
  ])
  assert.equal(teams[0].tasks.length, 1)
  assert.equal(teams[1].tasks.length, 1)
})

test('unifica una visita aunque una copia haya perdido el historyId', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', tasks: [
      { historyId: 'work-pig-6844', taskId: 'task-pig-6844', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5', client: 'PIG-6844 AGUSTIN ROSETTI' },
      { taskId: 'task-pig-6844', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5', client: 'PIG-6844 AGUSTIN ROSETTI' }
    ] }
  ])
  assert.equal(teams[0].tasks.length, 1)
  assert.equal(teams[0].tasks[0].historyId, 'work-pig-6844')
})

test('unifica copias regeneradas de una misma visita pero conserva otro horario', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', tasks: [
      { taskId: 'task-original', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5' },
      { taskId: 'task-regenerated', time: '14:00', customerId: 'customer-pig-6844', serviceId: 'service-5' },
      { taskId: 'task-other-time', time: '16:00', customerId: 'customer-pig-6844', serviceId: 'service-5' }
    ] }
  ])
  assert.deepEqual(teams[0].tasks.map(task => task.time), ['14:00', '16:00'])
})

test('fusiona tarjetas duplicadas del mismo equipo sin perder sus servicios', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-3', label: 'Equipo 3', memberIds: [3], members: ['Santos Diaz'], tasks: [{ historyId: 'work-1', client: 'CLIENTE A' }] },
    { teamId: 'equipo-2', label: 'Equipo 2', memberIds: [2], members: ['Leonardo Rivadero'], tasks: [] },
    { teamId: 'equipo-3', label: 'Equipo 3', memberIds: [3], members: ['Santos Diaz'], tasks: [{ historyId: 'work-2', client: 'CLIENTE B' }] }
  ])
  assert.equal(teams.length, 2)
  assert.deepEqual(teams[0].tasks.map(task => task.historyId), ['work-1', 'work-2'])
  assert.deepEqual(teams[0].members, ['Santos Diaz'])
})

test('conserva un solo horario disponible por equipo al normalizar', () => {
  const teams = dedupeAgendaTeams([
    { teamId: 'equipo-1', label: 'Equipo 1', tasks: [
      { taskId: 'slot-a', time: '08:30', client: '', service: '' },
      { taskId: 'slot-b', time: '08:30', client: '', service: '' },
      { taskId: 'slot-c', time: '13:00', client: '', service: '' }
    ] }
  ])
  assert.deepEqual(teams[0].tasks.map(task => task.time), ['08:30', '13:00'])
})

test('PATCH registra servicios concurrentes, conserva historial y rechaza conflictos sin escrituras parciales', async () => {
  const { weeklyServiceOperations } = await import('../src/features/state/application/weekly-service-save.mjs')
  const { stateOperations } = await import('../src/features/state/application/state-operations.mjs')
  const cookieA = await login('qa-admin@pignus.test'), cookieB = await login('qa-admin-secondary@pignus.test')
  const base = await state(cookieA)
  const date = '2096-10-15'
  const makeCommand = (suffix, time) => {
    const team = { teamId: 'qa-concurrent-team', label: 'Equipo 1', memberIds: ['qa-tech'], members: ['QA Técnico'], tasks: [] }
    const task = { taskId: `qa-operation-${suffix}`, historyId: `work-qa-operation-${suffix}`, time, serviceId: 'qa-service', service: 'Service técnico', estimatedMinutes: 60, estimatedMinutesCustomized: true, customerId: 'qa-customer-a', client: 'PIG-9001 CLIENTE INCLUIDO QA', clientAccount: 'PIG-9001', address: 'Calle QA 100', phone: '3510000001', detail: 'Prueba aislada', status: 'Pendiente' }
    return { day: date, team, task, baseRecord: null, record: { ...task, id: task.historyId, sourceTaskId: task.taskId, date, teamId: team.teamId, team: team.label, technicianIds: team.memberIds, technicians: team.members } }
  }
  const submit = (cookie, operations) => api('/api/state', cookie, { method: 'PATCH', body: JSON.stringify({ revision: base.revision, operations }) })
  const first = weeklyServiceOperations(base, makeCommand('one', '09:00'))
  const second = weeklyServiceOperations(base, makeCommand('two', '11:00'))
  const responses = await Promise.all([submit(cookieA, first), submit(cookieB, second)])
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(await response.json()))
  const saved = await state(cookieA)
  assert.equal(saved.history.length, base.history.length + 2)
  assert.equal(saved.agenda.weekly[date].teams[0].tasks.length, 2)
  const overlap = await submit(cookieB, weeklyServiceOperations(saved, makeCommand('overlap', '09:30')))
  assert.equal(overlap.status, 400, JSON.stringify(await overlap.json()))
  const unchanged = await state(cookieA)
  assert.equal(unchanged.history.length, saved.history.length)
  assert.equal(unchanged.agenda.weekly[date].teams[0].tasks.length, 2)
  const one = saved.history.find(item => item.id === 'work-qa-operation-one')
  const operationA = stateOperations({ history: [one] }, { history: [{ ...one, internalNote: 'Sesión A' }] })
  const operationB = stateOperations({ history: [one] }, { history: [{ ...one, detail: 'Sesión B' }] })
  assert.equal((await submit(cookieA, operationA)).status, 200)
  const conflict = await submit(cookieB, operationB)
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).code, 'RECORD_WRITE_CONFLICT')
  const after = await state(cookieA)
  assert.equal(after.history.find(item => item.id === one.id).internalNote, 'Sesión A')
  assert.equal(after.history.find(item => item.id === one.id).detail, one.detail)
  const tech = await login('qa-tech@pignus.test')
  assert.equal((await submit(tech, operationB)).status, 403)
})

test('varias jornadas: el técnico informa avance, no completa antes de tiempo y conserva la sincronización', async () => {
  const cookie = await login('qa-tech@pignus.test')
  const admin = await login('qa-admin@pignus.test')
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const first = { id:'qa-journey-first',sourceTaskId:'qa-journey-task-1',date:'2020-01-06',time:'09:00',estimatedMinutes:120,customerId:'qa-customer-a',service:'Instalación de alarma',serviceId:'qa-alarm',status:'Pendiente',technicianIds:['qa-tech'],technicians:['QA Técnico'],teamId:'qa-journey-team',team:'Equipo QA',serviceJourney:{id:'qa-journey-first',index:1,total:2} }
  const last = {...first,id:'qa-journey-last',sourceTaskId:'qa-journey-task-2',date:'2020-01-07',serviceJourney:{id:first.id,index:2,total:2}}
  for (const record of [first,last]) upsertJson(db,'work_history','id',record)
  const agenda=JSON.parse(db.prepare("SELECT data FROM agendas WHERE id = 'current'").get().data)
  for (const record of [first,last]) agenda.weekly[record.date]={teams:[{teamId:record.teamId,label:record.team,memberIds:['qa-tech'],members:['QA Técnico'],tasks:[{...record,taskId:record.sourceTaskId,historyId:record.id}]}]}
  db.prepare("UPDATE agendas SET data = ? WHERE id = 'current'").run(JSON.stringify(agenda))
  db.close()
  const report=(recordId,type)=>api('/api/technician/status',cookie,{method:'POST',body:JSON.stringify({recordId,type,observation:'Avance de prueba'})})
  const initial = (await state(admin)).history.find(item => item.id === first.id)
  const identityResponse = await api('/api/history/'+first.id,admin,{method:'PATCH',body:JSON.stringify({base:initial,record:{...initial,customerId:'qa-customer-b',client:'Cliente compartido QA'}})})
  assert.equal(identityResponse.status,200,JSON.stringify(await identityResponse.json()))
  const shared = await state(admin)
  assert.equal(shared.history.find(item=>item.id===last.id).customerId,'qa-customer-b')
  assert.equal(shared.agenda.weekly[last.date].teams[0].tasks[0].customerId,'qa-customer-b')
  let response=await report(first.id,'Completado')
  assert.equal(response.status,400)
  assert.match((await response.json()).error,/intermedia/)
  response=await report(last.id,'Completado')
  assert.equal(response.status,400)
  assert.match((await response.json()).error,/anteriores/)
  response=await report(first.id,'Avance registrado')
  assert.equal(response.status,409)
  assert.match((await response.json()).error,/Iniciar servicio/)
  assert.equal((await api('/api/technician/start',cookie,{method:'POST',body:JSON.stringify({recordId:first.id})})).status,200)
  response=await report(first.id,'Avance registrado')
  assert.equal(response.status,200,JSON.stringify(await response.json()))
  const advanced=await state(admin)
  assert.equal(advanced.history.find(item=>item.id===first.id).status,'Avance registrado')
  assert.equal(advanced.history.find(item=>item.id===first.id).completedAt,undefined)
  assert.equal(advanced.agenda.weekly[first.date].teams[0].tasks[0].status,'Avance registrado')
  assert.equal(advanced.history.find(item=>item.id===last.id).status,'Pendiente')
  const protectedVisit=advanced.history.find(item=>item.id===last.id)
  const rejected=await api('/api/history/'+last.id,admin,{method:'PATCH',body:JSON.stringify({base:protectedVisit,record:{...protectedVisit,customerId:'qa-customer-a'}})})
  assert.equal(rejected.status,400)
  assert.match((await rejected.json()).error,/protegidos/)
  assert.equal((await api('/api/technician/start',cookie,{method:'POST',body:JSON.stringify({recordId:last.id})})).status,200)
  assert.equal((await report(last.id,'Completado')).status,200)
  const completed=await state(admin)
  assert.equal(completed.history.filter(item=>item.serviceJourney?.id===first.id&&item.status==='Completado').length,1)
  assert.equal((await api('/api/history/'+first.id,admin,{method:'DELETE',body:JSON.stringify({base:completed.history.find(item=>item.id===first.id)})})).status,400)
})

test('corrección comercial autorizada actualiza historial y exportación sin abrir agenda', async () => {
  const { subscriptionCorrectionBase } = await import('../src/domain/customers/subscription-correction.mjs')
  const admin = await login('qa-admin@pignus.test')
  const technician = await login('qa-tech@pignus.test')
  const supervisor = await login('qa-supervisor@pignus.test')
  const record = { id: 'qa-subscription-correction', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'PIG-9001 CORRECCION ABONO', date: '2025-02-01', time: '08:30', serviceId: 'qa-alarm', service: 'Instalación de alarma', installationZone: 'residencial', status: 'Completado', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] }
  const fixture = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  upsertJson(fixture, 'work_history', 'id', record)
  fixture.close()
  const initial = await state(admin)
  const current = initial.history.find(item => item.id === record.id)
  const body = JSON.stringify({ customerId: record.customerId, recordId: record.id, base: subscriptionCorrectionBase(current), values: { monthlyFee: '85321.50', monthlyFeeEffectiveFrom: '2025-02-03', freezeMonthlyFee: false, frozenMonths: 0 } })
  for (const cookie of [technician, supervisor]) {
    const denied = await api('/api/customers/subscription-correction', cookie, { method: 'POST', body })
    assert.equal(denied.status, 403)
  }
  const response = await api('/api/customers/subscription-correction', admin, { method: 'POST', body })
  const payload = await response.json()
  assert.equal(response.status, 200, JSON.stringify(payload))
  const corrected = payload.state.history.find(item => item.id === record.id)
  assert.equal(corrected.status, 'Completado')
  assert.equal(corrected.monthlyFee, '85321.5')
  assert.equal(corrected.subscriptionCorrectedBy.id, 'qa-admin')
  assert.equal(corrected.date, record.date)
  assert.deepEqual(payload.state.agenda, initial.agenda)
  assert.equal((await api('/api/customers/subscription-correction', admin, { method: 'POST', body })).status, 409)
  const excel = await api('/api/history/export?month=2025-02&category=residencial', admin)
  assert.equal(excel.status, 200)
  assert.match(await excel.text(), /\$ 85\.321,50/)
  const pdf = await api('/api/history/export?month=2025-02&category=residencial&format=pdf', admin)
  assert.equal(pdf.status, 200)
  assert.match(pdf.headers.get('content-type'), /application\/pdf/)
  assert.ok((await pdf.arrayBuffer()).byteLength > 500)
  const direct = await api('/api/history/' + record.id, admin, { method: 'PATCH', body: JSON.stringify({ base: corrected, record: { ...corrected, time: '17:00' } }) })
  assert.equal(direct.status, 409)
  const persisted = await state(admin)
  assert.equal(persisted.history.find(item => item.id === record.id).monthlyFeeEffectiveFrom, '2025-02-03')
  const technical = await state(technician)
  const technicalRecord = technical.history.find(item => item.id === record.id)
  assert.ok(technicalRecord)
  for (const field of ['monthlyFee', 'monthlyFeeEffectiveFrom', 'freezeMonthlyFee', 'frozenMonths', 'subscriptionCorrectedBy']) assert.equal(technicalRecord[field], undefined)
  const auditDb = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const entries = auditDb.prepare('SELECT data FROM audit_log').all().map(row => JSON.parse(row.data))
  auditDb.close()
  assert.ok(entries.some(entry => entry.action === 'Corrigió datos del abono' && entry.entityId === record.id))
})

test('Tickets: informe técnico se incorpora una vez y se gestiona fuera del estado de agenda', async () => {
  const db = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const record = { id: 'qa-followup-service', customerId: 'qa-customer-a', clientAccount: 'PIG-9001', client: 'CLIENTE SEGUIMIENTO QA', date: '2020-01-01', time: '08:30', serviceId: 'qa-service', service: 'Service técnico', status: 'Pendiente', technicianIds: ['qa-tech'], technicians: ['QA Técnico'] }
  upsertJson(db, 'work_history', 'id', record); db.close()
  const admin = await login('qa-admin@pignus.test'), tech = await login('qa-tech@pignus.test')
  assert.equal((await api('/api/tickets',null)).status,401)
  const report={recordId:record.id,type:'Reprogramación solicitada',observation:'Cliente solicita presupuesto',followup:{type:'Cotizar adicional',description:'Cotizar cámara extra'}}
  for(let i=0;i<2;i++){const r=await api('/api/technician/status',tech,{method:'POST',body:JSON.stringify(report)});assert.equal(r.status,200,await r.clone().text())}
  assert.equal((await api('/api/followups',admin)).status,410)
  const response=await api('/api/tickets?serviceId='+record.id,admin);assert.equal(response.status,200,await response.clone().text())
  const listed=(await response.json()).items;assert.equal(listed.length,1)
  const item=listed[0]
  const assign={id:item.id,action:'assign',version:item.version,assigneeId:'qa-admin',commandId:'qa-ticket-assign'}
  assert.equal((await api('/api/tickets',tech,{method:'POST',body:JSON.stringify(assign)})).status,403)
  const assigned=await api('/api/tickets',admin,{method:'POST',body:JSON.stringify(assign)});assert.equal(assigned.status,200,await assigned.clone().text())
  assert.equal((await api('/api/tickets',admin,{method:'POST',body:JSON.stringify(assign)})).status,200)
  assert.equal((await api('/api/tickets',admin,{method:'POST',body:JSON.stringify({...assign,commandId:'qa-ticket-stale'})})).status,409)
  const resolved=await api('/api/tickets',admin,{method:'POST',body:JSON.stringify({id:item.id,action:'resolve',version:2,commandId:'qa-ticket-resolve',note:'Presupuesto enviado y aceptado'})})
  assert.equal(resolved.status,200,await resolved.clone().text())
  const saved=(await resolved.json()).ticket;assert.equal(saved.status,'Resuelto');assert.equal(saved.messages.length+saved.events.length,3)
  const service=(await state(admin)).history.find(r=>r.id===record.id);assert.equal(service.technicalObservation,report.observation)
  const tampered=await api('/api/history/'+record.id,admin,{method:'PATCH',body:JSON.stringify({base:service,record:{...service,followup:undefined}})});assert.equal(tampered.status,409)
})

test('Tickets: administración del correo protege credenciales y proceso automático por HTTP', async () => {
  const admin = await login('qa-admin@pignus.test'), tech = await login('qa-tech@pignus.test')
  assert.equal((await api('/api/tickets/mail', null)).status, 401)
  assert.equal((await api('/api/tickets/mail', tech)).status, 403)
  assert.equal((await api('/api/tickets/mail/process', admin, { method: 'POST' })).status, 401)
  const first = await api('/api/tickets/mail', admin)
  assert.equal(first.status, 200, await first.clone().text())
  const initial = await first.json()
  const settings = { ...initial.settings, address: 'soporte@example.com', senderName: 'Soporte QA', areaId: 'technical',
    incoming: { ...initial.settings.incoming, user: 'soporte@example.com', password: 'contraseña-ficticia-http-privada' } }
  const input = { action: 'save', version: initial.version, settings }
  const forbidden = await api('/api/tickets/mail', tech, { method: 'POST', body: JSON.stringify(input) })
  assert.equal(forbidden.status, 403)
  const saved = await api('/api/tickets/mail', admin, { method: 'POST', body: JSON.stringify(input) })
  assert.equal(saved.status, 200, await saved.clone().text())
  const data = await saved.json()
  assert.equal(data.enabled, false)
  assert.equal(data.settings.incoming.passwordConfigured, true)
  assert.doesNotMatch(JSON.stringify(data), /contraseña-ficticia-http-privada|ciphertext|"password":/)
  const stale = await api('/api/tickets/mail', admin, { method: 'POST', body: JSON.stringify(input) })
  assert.equal(stale.status, 409)
  const active = await api('/api/tickets/mail', admin, { method: 'POST', body: JSON.stringify({ action: 'activate', version: data.version }) })
  assert.equal(active.status, 409, 'No activar sin pruebas guardadas')
  const fixture = new DatabaseSync(path.join(temporaryDirectory, 'agenda-tecnica.db'))
  const raw = fixture.prepare("SELECT data FROM pignus_ticket_settings WHERE id='mail-channel'").get().data
  fixture.close()
  assert.doesNotMatch(raw, /contraseña-ficticia-http-privada/)
  const response = await fetch(origin + '/api/tickets/mail/process', { method: 'POST', headers: { Authorization: 'Bearer clave-ficticia-del-proceso-para-pruebas-http' } })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json()).enabled, false)
})
