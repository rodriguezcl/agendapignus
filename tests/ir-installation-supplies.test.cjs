const test = require('node:test')
const assert = require('node:assert/strict')
const supplies = require('../src/features/cctv/domain/ir-installation-supplies.json')
const { baseProducts, createBaseProductId, mergeCatalog } = require('../shared/product-catalog.cjs')
const { EQUIPMENT_KINDS } = require('../shared/cctv-schema.cjs')

const newModels = [
  'IR-RJ45 PLUG', 'JACK HEMBRA BORNERA', 'JACK MACHO BORNERA', 'IR-BALUN 2',
  'F2A', 'F4A NITTO / LITEON', 'F5A MICROPERFORADA', 'SPLITER 1X4', 'SPLITER 1X8',
  '120 TOMA HEMBRA', '113 TOMA', 'CP3100', '50106032 TORNILLO MEDIANO N6', '50108032',
  'PY 3320', 'PY 3321', 'IW884', 'IW887', 'TOL75860', 'TOL76132', 'TOL38023', 'TOL20313',
  'ST2-64-S1', 'JL 1515 NEGRA', 'JAULA 20X20 NEGRA', 'TX-114SR', 'TX-114FR', 'BRAZO RECTO 60 CM',
  'BATERIA 9V ENERGIZER /PHILCO', 'CR2 LITIO', 'SILICONA X 1KG PREMIUN', 'TOR AUTOP N6 M',
  'CP2 X 0.75 X 100MTS', 'CABLE PORTERO 2 PARES X 200 MT', 'CABLE PORTERO 4 PARES X 200 MT',
  'UTP 305-EXTERIOR-IR', 'UTP 305-INTERIOR-IR', 'PRE 300X4.8', '511K'
]
const existingCameras = ['C32EP', 'K3DP-3H0WF', 'S7XP-8M0WED', 'K7CP-3H1WE', 'K2EP-3R1W']

test('el listado de IR incorpora los insumos faltantes con su ficha, foto y tipo de producto', () => {
  for (const model of newModels) {
    const entries = supplies.filter(item => item.model === model)
    assert.equal(entries.length, 1, model)
    const [item] = entries
    assert.ok(Object.hasOwn(EQUIPMENT_KINDS[item.category] || {}, item.kind), model)
    assert.ok(item.description.trim(), model)
    assert.match(item.source, /^https:\/\/irseguridad\.com\.ar\/producto\/.+/, model)
    assert.match(item.image, /^https:\/\/irseguridad\.com\.ar\/img\/products\/(?:\d+\/)?[^/]+\.(?:jpe?g|webp|png)$/i, model)
    const matches = baseProducts.filter(product => product.source === item.source)
    assert.equal(matches.length, 1, model)
    assert.equal(matches[0].image, item.image, model)
    assert.equal(matches[0].model, model)
    assert.equal(matches[0].active, true, model)
  }
})

test('los seis modelos ya cargados conservan una sola ficha y el estado previo de cada cámara', () => {
  const originalModels = [...existingCameras, 'CR123A']
  assert.deepEqual(supplies.filter(item => originalModels.includes(item.model)), [])
  const disabledCameras = ['K3DP-3H0WF', 'S7XP-8M0WED', 'K7CP-3H1WE']
  const saved = baseProducts.filter(item => disabledCameras.includes(item.model))
    .map(item => ({ ...item, active: false, version: 2 }))
  const effective = mergeCatalog(saved)
  for (const model of originalModels) {
    const matches = effective.filter(item => item.model === model)
    assert.equal(matches.length, 1, model)
    const [product] = matches
    const expectedId = model === 'CR123A'
      ? createBaseProductId('alarm', 'Garnet', model)
      : createBaseProductId('cctv', 'IMOU', model)
    assert.equal(product.id, expectedId)
    assert.equal(product.active, !disabledCameras.includes(model), model)
  }
})

test('un insumo que ya se dio de baja por código o por ficha de IR conserva la baja y su ID', () => {
  const connector = baseProducts.find(product => product.model === 'IR-RJ45 PLUG')
  const box = baseProducts.find(product => product.model === 'CP3100')
  const byCode = { ...connector, id: 'custom:conector', category: 'other', kind: 'other', source: '', active: false, version: 3 }
  const bySource = { ...box, id: 'custom:caja', category: 'cctv', kind: 'other', model: 'CP 3100', active: false, version: 2 }
  const effective = mergeCatalog([byCode, bySource])
  assert.equal(effective.length, baseProducts.length)
  assert.ok(!effective.some(product => product.id === connector.id || product.id === box.id))
  assert.deepEqual(effective.filter(product => product.model === connector.model), [byCode])
  assert.deepEqual(effective.filter(product => product.source === box.source), [bySource])
  assert.ok(effective.find(product => product.model === 'PY 3321').active)
})

test('los insumos activos se encuentran por código y características en Productos y materiales', async () => {
  const { indexProducts, productSearchWords } = await import('../src/features/products/domain/product-search.mjs')
  const index = indexProducts(baseProducts.filter(product => product.active))
  for (const [query, model] of [['PY 3320 tarugo', 'PY 3320'], ['UTP 305 exterior', 'UTP 305-EXTERIOR-IR']]) {
    const words = productSearchWords(query)
    assert.ok(index.some(({ product, searchable }) => product.model === model && words.every(word => searchable.includes(word))), query)
  }
})
