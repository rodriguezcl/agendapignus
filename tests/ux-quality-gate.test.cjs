const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { evaluateUxQuality } = require('../scripts/ux-quality-gate.cjs')

test('el Quality Gate UX alcanza el mínimo constitucional sin controles críticos fallidos', () => {
  const result = evaluateUxQuality()
  assert.equal(result.maximum, 100)
  assert.ok(result.score >= 90, `Puntaje UX insuficiente: ${result.score}/100`)
  assert.deepEqual(result.checks.filter(check => !check.pass), [])
})

test('el Quality Gate cubre todas las categorías constitucionales', () => {
  const result = evaluateUxQuality()
  assert.deepEqual([...new Set(result.checks.map(check => check.category))].sort(), [
    'Accesibilidad',
    'Arquitectura de información',
    'Consistencia',
    'Eficiencia operacional',
    'Feedback del sistema',
    'Jerarquía visual',
    'Prevención de errores',
    'Responsive',
    'Usabilidad'
  ])
})

test('la Constitución UX/UI completa queda versionada como referencia normativa', () => {
  const constitution = fs.readFileSync(path.join(__dirname, '..', 'docs', 'UX-UI-CONSTITUTION.md'), 'utf8')
  assert.match(constitution, /^# AGENDA PIGNUS — UX\/UI CONSTITUTION/m)
  assert.match(constitution, /^# 61\. PRINCIPIO FINAL/m)
  assert.match(constitution, /^# DIRECTIVA PARA AGENTES DE IA/m)
  assert.match(constitution, /UX Quality Score < 90/)
})
