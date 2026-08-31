const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  EXPECTED_PIGNUS_TABLES,
  EXPECTED_SOFTGUARD_TABLES,
  INITIAL_CONFIRMATION,
  classifySchemaState,
  describeState,
  performInitialInstallation,
  stripTransactionWrapper,
} = require('../scripts/apply-supabase-schema.cjs')

const root = path.resolve(__dirname, '..')

const baseInventory = overrides => ({
  pignusTables: [],
  softguardTables: [],
  migrationHistoryExists: false,
  appliedVersions: [],
  ...overrides,
})

test('reconoce exactamente las 12 tablas PIGNUS esperadas', () => {
  assert.equal(EXPECTED_PIGNUS_TABLES.length, 12)
  const result = classifySchemaState(baseInventory({ pignusTables: [...EXPECTED_PIGNUS_TABLES] }))
  assert.equal(result.details.pignus.exact, true)
  assert.deepEqual(result.details.pignus.missing, [])
  assert.deepEqual(result.details.pignus.unexpected, [])
})

test('rechaza un conteo correcto con nombres PIGNUS incorrectos', () => {
  const wrongNames = [...EXPECTED_PIGNUS_TABLES.slice(1), 'pignus_tabla_equivocada']
  const result = classifySchemaState(baseInventory({ pignusTables: wrongNames }))
  assert.equal(wrongNames.length, 12)
  assert.equal(result.status, 'unexpected-or-partial')
  assert.deepEqual(result.details.pignus.missing, ['pignus_agendas'])
  assert.deepEqual(result.details.pignus.unexpected, ['pignus_tabla_equivocada'])
})

test('clasifica el esquema base aplicado sin historial como baseline existente', () => {
  const result = classifySchemaState(baseInventory({ pignusTables: [...EXPECTED_PIGNUS_TABLES] }))
  assert.equal(result.status, 'baseline-without-history')
})

test('detecta la migración SoftGuard pendiente después de registrar el baseline', () => {
  const result = classifySchemaState(baseInventory({
    pignusTables: [...EXPECTED_PIGNUS_TABLES],
    migrationHistoryExists: true,
    appliedVersions: ['202608250001'],
  }))
  assert.equal(result.status, 'softguard-migration-pending')
  assert.match(describeState(result), /historial oficial.*db push --dry-run/i)
})

test('detecta la migración SoftGuard ya aplicada y registrada', () => {
  const result = classifySchemaState(baseInventory({
    pignusTables: [...EXPECTED_PIGNUS_TABLES],
    softguardTables: [...EXPECTED_SOFTGUARD_TABLES],
    migrationHistoryExists: true,
    appliedVersions: ['202608250001', '202608300001'],
  }))
  assert.equal(result.status, 'up-to-date')
})

test('bloquea un estado SoftGuard parcialmente aplicado', () => {
  const result = classifySchemaState(baseInventory({
    pignusTables: [...EXPECTED_PIGNUS_TABLES],
    softguardTables: EXPECTED_SOFTGUARD_TABLES.slice(0, 3),
  }))
  assert.equal(result.status, 'unexpected-or-partial')
  assert.ok(result.details.softguard.missing.length > 0)
})

test('falla antes de abrir una transacción de escritura si el estado es inesperado', async () => {
  let transactions = 0
  let writes = 0
  await assert.rejects(() => performInitialInstallation({
    confirmation: INITIAL_CONFIRMATION,
    inspect: async () => baseInventory({ pignusTables: ['pignus_parcial'] }),
    migrations: { base: 'base', softguard: 'softguard' },
    transaction: async callback => {
      transactions += 1
      return callback({ apply: async () => { writes += 1 } })
    },
  }), /Escritura bloqueada antes de comenzar/)
  assert.equal(transactions, 0)
  assert.equal(writes, 0)
})

test('exige una confirmación específica antes de abrir la transacción inicial', async () => {
  let transactions = 0
  await assert.rejects(() => performInitialInstallation({
    confirmation: 'confirm',
    inspect: async () => baseInventory(),
    migrations: { base: 'base', softguard: 'softguard' },
    transaction: async () => { transactions += 1 },
  }), /Confirmación específica ausente/)
  assert.equal(transactions, 0)
})

test('prohíbe reaplicar la migración base cuando las tablas PIGNUS ya existen', async () => {
  let writes = 0
  await assert.rejects(() => performInitialInstallation({
    confirmation: INITIAL_CONFIRMATION,
    inspect: async () => baseInventory({ pignusTables: [...EXPECTED_PIGNUS_TABLES] }),
    migrations: { base: 'base', softguard: 'softguard' },
    transaction: async callback => callback({ apply: async () => { writes += 1 } }),
  }), /No se ejecutará 202608250001_pignus_schema.sql/)
  assert.equal(writes, 0)
})

test('la instalación inicial verifica dentro de la misma transacción antes de confirmar', async () => {
  const applied = []
  let verified = false
  await performInitialInstallation({
    confirmation: INITIAL_CONFIRMATION,
    inspect: async () => baseInventory(),
    migrations: { base: 'base sql', softguard: 'softguard sql' },
    transaction: async callback => callback({
      inspect: async () => {
        if (applied.length === 0) return baseInventory()
        verified = true
        return baseInventory({
          pignusTables: [...EXPECTED_PIGNUS_TABLES],
          softguardTables: [...EXPECTED_SOFTGUARD_TABLES],
        })
      },
      apply: async migration => applied.push(migration),
    }),
  })
  assert.deepEqual(applied, ['base sql', 'softguard sql'])
  assert.equal(verified, true)
})

test('selecciona migraciones conocidas y elimina su commit externo para la transacción controladora', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/apply-supabase-schema.cjs'), 'utf8')
  assert.doesNotMatch(runner, /readdirSync/)

  for (const migration of ['202608250001_pignus_schema.sql', '202608300001_softguard_sync.sql']) {
    const source = fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8')
    const body = stripTransactionWrapper(source, migration)
    assert.doesNotMatch(body, /^\s*begin\s*;/i)
    assert.doesNotMatch(body, /commit\s*;?\s*$/i)
  }
})
