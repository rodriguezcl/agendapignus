const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { applyStateOperations } = require('../api/_lib/state-operations.cjs')

test('el alta de empleado no transporta agenda ni pierde cambios de otras sesiones', async () => {
  const { employeeOperations } = await import('../src/features/state/application/employee-operations.mjs')
  const current = { employees: [{ id: 'another', name: 'Editado por otro usuario' }], history: [{ id: 'service', detail: 'Cambio remoto' }], agenda: { weekly: {} } }
  const employee = { id: 'new', firstName: 'Operador', lastName: 'QA', roleId: 'd9d7a587-a581-44f2-88d2-bc2deb579a1e', role: 'Operador' }
  const operations = employeeOperations(null, employee)
  assert.equal(operations.length, 1)
  assert.equal(operations[0].path[0], 'employees')
  const next = applyStateOperations(current, operations)
  assert.deepEqual(next.history, current.history)
  assert.deepEqual(next.agenda, current.agenda)
  assert.deepEqual(next.employees, [...current.employees, employee])
  assert.throws(() => applyStateOperations(next, employeeOperations({ ...employee, lastName: 'Versión vieja' }, { ...employee, lastName: 'Intento de sobrescribir' })), { code: 'RECORD_WRITE_CONFLICT' })
})

test('alta y edición usan el modal y el éxito ocurre después de la respuesta del servidor', () => {
  const React = require('react'), { renderToString } = require('react-dom/server')
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  const bundle = require('esbuild').buildSync({ stdin: { contents: `${source}\nexport { EmployeeForm };`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'employee-render.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, path.join(root, 'employee-render.cjs'))
  for (const editing of [null, 'existing']) {
    const html = renderToString(React.createElement(compiled.exports.EmployeeForm, { form: { roleId: 'operator', password: '' }, roles: [{ id: 'operator', name: 'Operador', code: 'operator' }], editing, canEnableTechnical: true, setForm() {}, save() {}, cancel() {} }))
    assert.match(html, /catalog-editor-modal/)
    assert.match(html, editing ? /Editar empleado/ : /Nuevo empleado/)
    assert.match(html, /Este rol es de solo lectura/)
    assert.match(html, /type="checkbox" disabled=""/)
  }
  const save = source.slice(source.indexOf('  const save = event =>', source.indexOf('function Employees(')), source.indexOf('  const removeEmployee', source.indexOf('function Employees(')))
  assert.ok(save.indexOf('await persistEmployee(baseline, record)') < save.indexOf("setNotice('El empleado fue guardado correctamente.')"))
  assert.ok(save.indexOf('await persistEmployee(baseline, record)') < save.indexOf('setOpen(false)'))
  assert.doesNotMatch(save, /setEmployees\(/)
})

test('el guardado de empleado valida permisos, contraseña y duplicados sin tocar servicios completados', () => {
  const { applyEmployeeOperation } = require('../api/_lib/employee-operation.cjs')
  const role = { id: 'uuid-role', code: 'operator', name: 'Operador' }
  const current = { roles: [role], employees: [], history: [{ id: 'old', status: 'Completado', detail: 'Conservar' }], agenda: { weekly: {} } }
  const record = { id: 'new', firstName: 'QA', lastName: 'Operador', email: 'qa@example.test', roleId: role.id, status: 'Activo', password: 'Prueba1234', technicalEnabled: true }
  const op = after => [{ path: ['employees', { key: 'id', id: after.id }], existed: false, exists: true, before: null, after }]
  const admin = { roleCode: 'administrator' }
  const next = applyEmployeeOperation(current, op(record), admin)
  assert.deepEqual(next.history, current.history)
  assert.equal(next.employees[0].password, undefined)
  assert.ok(next.employees[0].passwordHash)
  assert.equal(next.employees[0].technicalEnabled, false)
  assert.throws(() => applyEmployeeOperation(current, op(record), { roleCode: 'operator' }), { statusCode: 403 })
  assert.throws(() => applyEmployeeOperation(current, op({ ...record, password: 'weak' }), admin), /contraseñas/)
  assert.throws(() => applyEmployeeOperation(next, op({ ...record, id: 'another' }), admin), /Ya existe/)
})
