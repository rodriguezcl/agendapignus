const path = require('node:path')
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/domain/dashboard/dashboard-notifications.mjs')],
  outfile: path.join(__dirname, '../api/_vendor/push-notifications.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' })
console.log('Selector de notificaciones preparado para Web Push.')
