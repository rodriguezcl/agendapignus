const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function evaluateUxQuality() {
  const app = read('src/App.jsx')
  const css = read('src/constitution-ui.css')
  const systemState = read('src/components/ui/SystemState.jsx')
  const sources = `${app}\n${css}\n${systemState}`
  const checks = [
    ['Usabilidad', 5, /historyPageSize/, app, 'Historial paginado'],
    ['Usabilidad', 5, /technician-quick-actions/, app, 'Acciones técnicas directas'],
    ['Usabilidad', 5, /empty-state/, sources, 'Estados vacíos explicativos'],
    ['Usabilidad', 5, /expandedServiceCardsRef/, app, 'Detalle progresivo'],
    ['Accesibilidad', 4, /trapModalFocus/, app, 'Foco contenido en diálogos'],
    ['Accesibilidad', 4, /origin\.focus/, app, 'Foco restaurado al cerrar'],
    ['Accesibilidad', 4, /min-height: 44px/, css, 'Objetivos táctiles'],
    ['Accesibilidad', 4, /prefers-reduced-motion: reduce/, css, 'Movimiento reducido'],
    ['Accesibilidad', 4, /role=\{urgent \? 'alert' : 'status'\}/, systemState, 'Anuncios semánticos'],
    ['Eficiencia operacional', 5, /PRÓXIMO SERVICIO/, app, 'Próximo servicio priorizado'],
    ['Eficiencia operacional', 5, /Gestionar selección/, app, 'Gestión múltiple disponible'],
    ['Eficiencia operacional', 5, /Paginación del historial/, app, 'Densidad controlada'],
    ['Arquitectura de información', 5, /Siguientes servicios/, app, 'Jerarquía de agenda técnica'],
    ['Arquitectura de información', 5, /<nav>/, app, 'Navegación semántica'],
    ['Prevención de errores', 5, /aria-required="true"/, app, 'Campos críticos identificados'],
    ['Prevención de errores', 5, /confirmedSaving/, app, 'Operación protegida durante guardado'],
    ['Consistencia', 5, /--pignus-color-brand:/, css, 'Tokens visuales'],
    ['Consistencia', 5, /function SystemState|export default function SystemState/, systemState, 'Patrón único de estados'],
    ['Jerarquía visual', 5, /primary, \.secondary, \.danger-button/, css, 'Jerarquía de acciones'],
    ['Responsive', 5, /@media \(pointer: coarse\), \(max-width: 640px\)/, css, 'Composición táctil específica'],
    ['Feedback del sistema', 5, /noticeElement\.dataset\.tone/, app, 'Feedback según resultado']
  ].map(([category, points, pattern, source, label]) => ({ category, points, label, pass: pattern.test(source) }))

  const score = checks.reduce((total, check) => total + (check.pass ? check.points : 0), 0)
  const maximum = checks.reduce((total, check) => total + check.points, 0)
  return { score, maximum, passed: checks.filter(check => check.pass).length, total: checks.length, checks }
}

if (require.main === module) {
  const result = evaluateUxQuality()
  result.checks.forEach(check => console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.category} · ${check.label} (${check.points})`))
  console.log(`UX Quality Gate automatizado: ${result.score}/${result.maximum} · ${result.passed}/${result.total} controles`)
  if (result.score < 90 || result.checks.some(check => !check.pass)) process.exitCode = 1
}

module.exports = { evaluateUxQuality }
