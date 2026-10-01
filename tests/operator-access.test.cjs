const test = require('node:test')
const assert = require('node:assert/strict')
const { userCan, authorizeIncomingState, visibleStateForUser } = require('../api/_lib/core.cjs')
const { operatorRouteAllowed } = require('../api/_lib/operator-access.cjs')
const { canPerformTechnicalServices } = require('../api/_lib/technical-capability.cjs')

test('Operador tiene únicamente weekly aunque sus permisos almacenados habiliten escritura', async () => {
  const { resolvedRolePermissions, roleCode } = await import('../src/domain/access/permissions.mjs')
  const role = { name: 'Operador', code: 'legacy', permissions: { dashboard: true, agenda: true, weeklyTeams: true, settings: true } }
  assert.equal(roleCode(role), 'operator')
  assert.deepEqual(Object.entries(resolvedRolePermissions(role)).filter(([, value]) => value).map(([key]) => key), ['weekly'])
  const user = { role: role.name, permissions: role.permissions, technicalEnabled: true }
  assert.equal(userCan(user, 'weekly'), true)
  for (const key of ['agenda', 'history', 'settings', 'weeklyTeams', 'accountsEdit']) assert.equal(userCan(user, key), false)
  assert.equal(canPerformTechnicalServices(user), false)
  assert.throws(() => authorizeIncomingState({}, {}, user), { statusCode: 403 })
  assert.equal(operatorRouteAllowed('GET', '/state'), true)
  assert.equal(operatorRouteAllowed('POST', '/auth/activity'), true)
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) assert.equal(operatorRouteAllowed(method, '/state'), false)
  assert.equal(operatorRouteAllowed('GET', '/future-module'), false)
  const view = visibleStateForUser({ roles: [], employees: [{ id: '1', email: 'secret', passwordHash: 'secret' }], agenda: { teams: [{ private: true }], weekly: {} } }, user)
  assert.deepEqual(view.agenda.teams, [])
  assert.equal(view.employees[0].email, undefined)
})

test('la creación de Operador es idempotente y no cambia empleados ni agenda', async () => {
  const { plan } = require('../scripts/create-operator-role.cjs')
  const current = { revision: 1, roles: [{ id: '1', name: 'Administrador' }], employees: [], agenda: { weekly: {} } }
  const { next, role } = await plan(current)
  assert.equal(next.roles.length, 2)
  assert.equal(next.employees, current.employees)
  assert.equal(next.agenda, current.agenda)
  assert.equal(role.name, 'Operador')
  assert.deepEqual((await plan(next)).next.roles, next.roles)
})

test('la Agenda semanal del Operador no ofrece acciones de modificación ni otros módulos', () => {
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
  const React = require('react'), { renderToString } = require('react-dom/server')
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  // Supply a loaded holiday calendar so the actual team/action markup renders.
  const readySource = source.replace('function useNationalHolidays(years)', 'function unusedNationalHolidays(years)')
  const bundle = require('esbuild').buildSync({ stdin: { contents: `${readySource}\nfunction useNationalHolidays() { return { records: [], loading: false, error: '' } }\nexport { WeeklyPlanner };`, loader: 'jsx', resolveDir: path.join(root, 'src') }, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' }, logLevel: 'silent' })
  const compiled = new Module(path.join(root, 'operator-render.cjs'), module)
  compiled.paths = module.paths
  compiled._compile(bundle.outputFiles[0].text, path.join(root, 'operator-render.cjs'))
  const noop = () => {}
  const html = renderToString(React.createElement(compiled.exports.WeeklyPlanner, { weekly: {}, customers: [], services: [], activeTechs: [], history: [], vehicles: [], permissions: { weeklyTeams: true }, authUser: { roleCode: 'operator', role: 'Operador' }, setWeekly: noop, setHistory: noop, setNotice: noop, openDaily: noop }))
  assert.match(html, /Consulta de solo lectura/)
  assert.match(html, /week-team-header/)
  assert.doesNotMatch(html, /Agregar servicio|Agregar otro equipo|Abrir día|Ver día|Agregar técnicos|Quitar Equipo|Guardar servicio|Equipos del mes/)
  assert.match(source, /const module = isOperator \? 'weekly'/)
  assert.match(source, /if \(isReadOnly \|\| saveDraftConflictRef.current\) return/)
})
