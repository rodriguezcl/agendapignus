// Defaults to a read-only diagnosis. Applying requires the exact inspected base:
// node --env-file-if-exists=.env.local scripts/repair-session-metadata.cjs
// node --env-file-if-exists=.env.local scripts/repair-session-metadata.cjs --apply --expected-revision=N --expected-fingerprint=SHA256
const { database } = require('../api/_lib/database.cjs')
const { inspectSessionMetadataRepair, repairSessionMetadata } = require('../api/_lib/session-metadata-repair.cjs')

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply' && !/^--expected-revision=\d+$/.test(arg) && !/^--expected-fingerprint=[a-f0-9]{64}$/.test(arg)) ||
      args.filter(arg => arg === '--apply').length > 1 ||
      args.filter(arg => arg.startsWith('--expected-revision=')).length > 1 ||
      args.filter(arg => arg.startsWith('--expected-fingerprint=')).length > 1) {
    throw Object.assign(new Error('INVALID_REPAIR_ARGUMENTS'), { code: 'INVALID_REPAIR_ARGUMENTS' })
  }
  const apply = args.includes('--apply')
  const revision = args.find(arg => arg.startsWith('--expected-revision='))?.split('=')[1]
  const expectedFingerprint = args.find(arg => arg.startsWith('--expected-fingerprint='))?.split('=')[1]
  if (apply && (revision === undefined || !expectedFingerprint)) {
    throw Object.assign(new Error('EXPECTED_BASE_REQUIRED'), { code: 'EXPECTED_BASE_REQUIRED' })
  }
  const sql = database()
  try {
    const result = apply
      ? await repairSessionMetadata(sql, { expectedRevision: Number(revision), expectedFingerprint })
      : await inspectSessionMetadataRepair(sql)
    // Deliberately omit employees, roles, session metadata and database errors.
    console.log(JSON.stringify({ readOnly: !apply, ...result }))
  } finally { await sql.end() }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, code: error.code || 'SESSION_METADATA_REPAIR_FAILED' }))
  process.exitCode = 1
})
