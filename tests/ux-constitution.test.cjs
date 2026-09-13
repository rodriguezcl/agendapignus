const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
const constitutionStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'constitution-ui.css'), 'utf8')
const systemState = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ui', 'SystemState.jsx'), 'utf8')

test('los diálogos administran foco, Escape y restauración al disparador', () => {
  assert.match(app, /const trapModalFocus/)
  assert.match(app, /modalOrigins\.set/)
  assert.match(app, /origin\.focus/)
  assert.match(app, /role="alertdialog" aria-modal="true"/)
})

test('los controles sin texto visible reciben nombre accesible', () => {
  assert.match(app, /Cambiar tema de color/)
  assert.match(app, /Cerrar notificación/)
  assert.match(app, /button\[title\]:not\(\[aria-label\]\)/)
  assert.match(app, /context \? `\$\{control\.title\}: \$\{context\}`/)
  assert.match(app, /aria-pressed/)
  assert.match(app, /input\[placeholder\*="Buscar"\]/)
})

test('los selectores no modales también se cierran por teclado y los roles admiten Enter o Espacio', () => {
  assert.match(app, /\.picker-backdrop, \.backdrop, \.profile-trigger\[aria-expanded="true"\]/)
  assert.match(app, /dataKeyboardSelectable|keyboardSelectable/)
  assert.match(app, /\['Enter', ' '\]\.includes\(event\.key\)/)
})

test('el portal técnico comunica conectividad y ofrece acciones de campo', () => {
  assert.match(app, /connectionStatus/)
  assert.match(app, /Sin conexión/)
  assert.match(app, /technician-quick-actions/)
  assert.match(app, /google\.com\/maps\/search/)
  assert.match(app, /tel:/)
  assert.match(app, /Iniciar servicio/)
  assert.match(app, /startTechnicianService/)
  const startClient = fs.readFileSync(path.join(__dirname, '..', 'src', 'infrastructure', 'http', 'technician-start.mjs'), 'utf8')
  assert.match(startClient, /\/api\/technician\/start/)
})

test('el portal técnico prioriza el próximo servicio y resume los siguientes sin perder acciones', () => {
  assert.match(app, /PRÓXIMO SERVICIO/)
  assert.match(app, /Siguientes servicios/)
  assert.match(app, /technician-detail-toggle/)
  assert.match(app, /Ver detalle/)
  assert.match(app, /aria-busy/)
  assert.match(app, /Acciones rápidas para/)
  assert.match(constitutionStyles, /\.technician-next-service/)
  assert.match(constitutionStyles, /\.technician-service\.is-collapsed/)
  assert.match(constitutionStyles, /\.technician-start-service \{ grid-column: 1 \/ -1/)
})

test('el historial limita los registros renderizados y expone semántica de tabla', () => {
  assert.match(app, /matchingRecords\.slice/)
  assert.match(app, /historyPageSize/)
  assert.match(app, /setAttribute\('role', 'table'\)/)
  assert.match(app, /Paginación del historial/)
})

test('la capa constitucional define tokens, foco, objetivos táctiles y movimiento reducido', () => {
  assert.match(constitutionStyles, /--pignus-color-brand:/)
  assert.match(constitutionStyles, /--pignus-font-family:/)
  assert.match(constitutionStyles, /--pignus-space-7:/)
  assert.match(constitutionStyles, /--pignus-shadow-card:/)
  assert.match(constitutionStyles, /--pignus-breakpoint-mobile:/)
  assert.match(constitutionStyles, /--ui-radius: var\(--pignus-radius-md\)/)
  assert.match(constitutionStyles, /:focus-visible/)
  assert.match(constitutionStyles, /min-height: 44px/)
  assert.match(constitutionStyles, /\.row-actions button/)
  assert.match(constitutionStyles, /\.work-status, \.role-chip/)
  assert.match(constitutionStyles, /\.data-card, \.history-table/)
  assert.match(constitutionStyles, /prefers-reduced-motion: reduce/)
})

test('los estados del sistema diferencian carga, error, vacío y recuperación', () => {
  assert.match(systemState, /type === 'loading' \|\| type === 'syncing'/)
  assert.match(systemState, /role=\{urgent \? 'alert' : 'status'\}/)
  assert.match(systemState, /system-state-skeleton/)
  assert.match(app, /const noticeTone/)
  assert.match(app, /noticeElement\.dataset\.tone/)
  assert.match(app, /SystemState type="syncing"/)
  assert.match(app, /type=\{databaseError \? 'error' : 'loading'\}/)
  assert.match(constitutionStyles, /\.empty-state::before/)
  assert.match(constitutionStyles, /notice\[data-tone='error'\]/)
})
