const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')

const BASE_MIGRATION = '202608250001_pignus_schema.sql'
const SOFTGUARD_MIGRATION = '202608300001_softguard_sync.sql'
const BASE_VERSION = '202608250001'
const SOFTGUARD_VERSION = '202608300001'
const INITIAL_CONFIRMATION = `${BASE_VERSION}+${SOFTGUARD_VERSION}`

const EXPECTED_PIGNUS_TABLES = Object.freeze([
  'pignus_agendas',
  'pignus_audit_log',
  'pignus_customers',
  'pignus_employees',
  'pignus_login_attempts',
  'pignus_preferences',
  'pignus_reviews',
  'pignus_roles',
  'pignus_services',
  'pignus_sessions',
  'pignus_vehicle_control_photos',
  'pignus_work_history',
])

const EXPECTED_SOFTGUARD_TABLES = Object.freeze([
  'softguard_abonados',
  'softguard_sincronizaciones',
  'softguard_sync_batches',
  'softguard_sync_nonces',
  'softguard_sync_stage',
  'softguard_tipos_servicio',
  'softguard_zonas',
])

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function compareNames(actual, expected) {
  const actualNames = sortedUnique(actual)
  const expectedNames = sortedUnique(expected)
  return {
    exact: actualNames.length === expectedNames.length && actualNames.every((name, index) => name === expectedNames[index]),
    missing: expectedNames.filter(name => !actualNames.includes(name)),
    unexpected: actualNames.filter(name => !expectedNames.includes(name)),
  }
}

function classifySchemaState(inventory) {
  const pignus = compareNames(inventory.pignusTables ?? [], EXPECTED_PIGNUS_TABLES)
  const softguard = compareNames(inventory.softguardTables ?? [], EXPECTED_SOFTGUARD_TABLES)
  const versions = new Set(inventory.appliedVersions ?? [])
  const baseRecorded = versions.has(BASE_VERSION)
  const softguardRecorded = versions.has(SOFTGUARD_VERSION)
  const pignusEmpty = (inventory.pignusTables ?? []).length === 0
  const softguardEmpty = (inventory.softguardTables ?? []).length === 0
  const details = { pignus, softguard, baseRecorded, softguardRecorded }

  if (pignusEmpty && softguardEmpty && !baseRecorded && !softguardRecorded) {
    return { status: 'initial-installation', details }
  }
  if (pignus.exact && softguardEmpty && !inventory.migrationHistoryExists) {
    return { status: 'baseline-without-history', details }
  }
  if (pignus.exact && softguardEmpty && inventory.migrationHistoryExists && baseRecorded && !softguardRecorded) {
    return { status: 'softguard-migration-pending', details }
  }
  if (pignus.exact && softguard.exact && inventory.migrationHistoryExists && baseRecorded && softguardRecorded) {
    return { status: 'up-to-date', details }
  }
  return { status: 'unexpected-or-partial', details }
}

function formatNameDifferences(label, comparison) {
  const fragments = []
  if (comparison.missing.length) fragments.push(`faltan: ${comparison.missing.join(', ')}`)
  if (comparison.unexpected.length) fragments.push(`sobran: ${comparison.unexpected.join(', ')}`)
  return fragments.length ? `${label} (${fragments.join('; ')})` : null
}

function describeState(classification) {
  switch (classification.status) {
    case 'initial-installation':
      return 'Instalación inicial: no existen tablas PIGNUS ni SoftGuard y las migraciones no figuran en el historial.'
    case 'baseline-without-history':
      return `Baseline existente sin historial: están las ${EXPECTED_PIGNUS_TABLES.length} tablas PIGNUS exactas y no existe el esquema SoftGuard. No se ejecutará ${BASE_MIGRATION}.`
    case 'softguard-migration-pending':
      return `Migración incremental pendiente: ${BASE_VERSION} está registrada y falta ${SOFTGUARD_MIGRATION}. Usar el historial oficial y supabase db push --dry-run.`
    case 'up-to-date':
      return 'Esquema actualizado: las tablas esperadas y ambas versiones están registradas.'
    default: {
      const differences = [
        formatNameDifferences('pignus_*', classification.details.pignus),
        formatNameDifferences('softguard_*', classification.details.softguard),
      ].filter(Boolean)
      return `Estado remoto inesperado o parcialmente aplicado. ${differences.join(' ')}`.trim()
    }
  }
}

function stripTransactionWrapper(source, migrationName) {
  const match = source.trim().match(/^begin\s*;([\s\S]*?)commit\s*;?$/i)
  if (!match) throw new Error(`${migrationName} debe contener un único wrapper BEGIN/COMMIT externo.`)
  return match[1].trim()
}

async function performInitialInstallation({ confirmation, inspect, transaction, migrations }) {
  const preflight = classifySchemaState(await inspect())
  if (preflight.status !== 'initial-installation') {
    throw new Error(`Escritura bloqueada antes de comenzar: ${describeState(preflight)}`)
  }
  if (confirmation !== INITIAL_CONFIRMATION) {
    throw new Error(`Confirmación específica ausente. Usar --confirm-initial-install=${INITIAL_CONFIRMATION}.`)
  }

  return transaction(async tx => {
    const lockedState = classifySchemaState(await tx.inspect())
    if (lockedState.status !== 'initial-installation') {
      throw new Error(`El estado cambió antes de escribir: ${describeState(lockedState)}`)
    }

    await tx.apply(migrations.base, BASE_MIGRATION)
    await tx.apply(migrations.softguard, SOFTGUARD_MIGRATION)

    const verified = await tx.inspect()
    const pignus = compareNames(verified.pignusTables ?? [], EXPECTED_PIGNUS_TABLES)
    const softguard = compareNames(verified.softguardTables ?? [], EXPECTED_SOFTGUARD_TABLES)
    if (!pignus.exact || !softguard.exact) {
      throw new Error('La verificación posterior falló; la transacción completa debe revertirse.')
    }
    return verified
  })
}

async function readInventory(sql) {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and (left(table_name, 7) = 'pignus_' or left(table_name, 10) = 'softguard_')
    order by table_name
  `
  const history = await sql`select to_regclass('supabase_migrations.schema_migrations')::text as relation`
  const migrationHistoryExists = Boolean(history[0]?.relation)
  const versions = migrationHistoryExists
    ? await sql`select version::text as version from supabase_migrations.schema_migrations order by version`
    : []
  const names = tables.map(row => row.table_name)
  return {
    pignusTables: names.filter(name => name.startsWith('pignus_')),
    softguardTables: names.filter(name => name.startsWith('softguard_')),
    migrationHistoryExists,
    appliedVersions: versions.map(row => row.version),
  }
}

function readArgument(name) {
  const prefix = `${name}=`
  const inline = process.argv.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Configurala localmente; su valor nunca se imprime.')
  }
  if (process.argv.some(argument => argument === '--confirm' || argument.startsWith('--confirm='))) {
    throw new Error('La confirmación genérica --confirm está prohibida. Debe autorizarse una acción específica.')
  }

  const action = readArgument('--action') ?? 'inspect'
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
    ssl: 'require',
  })

  try {
    const inventory = await sql.begin('read only', tx => readInventory(tx))
    const classification = classifySchemaState(inventory)
    console.log(describeState(classification))

    if (classification.status === 'unexpected-or-partial') {
      throw new Error('No se permite ninguna escritura hasta revisar manualmente el estado remoto.')
    }
    if (action === 'inspect') return
    if (action !== 'initial-install') {
      throw new Error('Las reparaciones de baseline y migraciones incrementales deben ejecutarse con el historial oficial de Supabase, dry-run y una autorización separada.')
    }

    const migrationsDirectory = path.join(__dirname, '..', 'supabase', 'migrations')
    const migrations = {
      base: stripTransactionWrapper(fs.readFileSync(path.join(migrationsDirectory, BASE_MIGRATION), 'utf8'), BASE_MIGRATION),
      softguard: stripTransactionWrapper(fs.readFileSync(path.join(migrationsDirectory, SOFTGUARD_MIGRATION), 'utf8'), SOFTGUARD_MIGRATION),
    }
    await performInitialInstallation({
      confirmation: readArgument('--confirm-initial-install'),
      inspect: () => sql.begin('read only', tx => readInventory(tx)),
      migrations,
      transaction: callback => sql.begin(async tx => callback({
        inspect: () => readInventory(tx),
        apply: migration => tx.unsafe(migration),
      })),
    })
    console.log('Instalación inicial aplicada y verificada en una única transacción.')
    console.log('Antes de cualquier migración futura, registrar ambas versiones mediante el historial oficial de Supabase.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Aplicador detenido de forma segura: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  BASE_MIGRATION,
  BASE_VERSION,
  EXPECTED_PIGNUS_TABLES,
  EXPECTED_SOFTGUARD_TABLES,
  INITIAL_CONFIRMATION,
  SOFTGUARD_MIGRATION,
  SOFTGUARD_VERSION,
  classifySchemaState,
  compareNames,
  describeState,
  performInitialInstallation,
  stripTransactionWrapper,
}
