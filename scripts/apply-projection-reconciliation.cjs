const manifest = require('./reconciliation-projections-20260909.json')
const { applyReconciliationManifest } = require('../api/_lib/reconciliation-application.cjs')
const EXPECTED_MANIFEST = '0c945370eb74a4a2776d420d0b2f183deaa4d5d957fe4036f9203e498b13c2da'
const BACKUP_KEY = 'backup_projection_reconciliation_20260909'
async function main() {
  const args = process.argv.slice(2), confirmation = args.length === 2 && args[0] === '--confirm-manifest' ? args[1] : ''
  console.log(JSON.stringify(await applyReconciliationManifest(manifest, { expectedManifest: EXPECTED_MANIFEST, confirmation, backupKey: BACKUP_KEY, eventName: 'Conciliación de proyecciones' }), null, 2))
}
if (require.main === module) main().catch(error => { console.error(`No se aplicó la conciliación: ${error.message}`); process.exitCode = 1 })
module.exports = { BACKUP_KEY, EXPECTED_MANIFEST, main }
