const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helpSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'HelpCenter.jsx'), 'utf8')

test('el Centro de ayuda documenta las funciones operativas vigentes', () => {
  for (const expected of [
    'Día laboral',
    'Día no operativo',
    'entre las 16:00 y las 20:00',
    'Copiar un solo servicio',
    'No aplica',
    'Ver el historial de un cliente',
    'Observación técnica',
    'Cada tarjeta muestra su estado vigente',
    'La ficha muestra también si el servicio está Pendiente',
    "id: 'technician'",
    "id: 'mobile'"
  ]) assert.match(helpSource, new RegExp(expected, 'i'))
})

test('la ayuda explica el orden actual del Historial', () => {
  assert.match(helpSource, /primero todos los servicios pendientes/)
  assert.match(helpSource, /fecha más antigua a la más nueva/)
  assert.match(helpSource, /horario más temprano al más tarde/)
  assert.match(helpSource, /La columna Hora/)
  assert.doesNotMatch(helpSource, /También podés limitar los resultados por fecha y estado/)
})

test('la búsqueda incluye módulos y preguntas frecuentes', () => {
  assert.match(helpSource, /const faqResults = FAQ/)
  assert.match(helpSource, /return \[\.\.\.moduleResults, \.\.\.faqResults\]/)
  assert.match(helpSource, /choose\(result\.section\.id, result\.index\)/)
})

test('la fecha visible de actualización corresponde a esta revisión', () => {
  assert.match(helpSource, /Actualizado · 28 de agosto de 2026/)
})
