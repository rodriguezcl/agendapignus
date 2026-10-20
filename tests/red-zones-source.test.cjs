const assert = require('node:assert/strict');
const test = require('node:test');
const zones = require('../src/domain/maps/red-zones.json');

const polygonsOf = feature => feature.geometry.type === 'Polygon'
  ? [feature.geometry.coordinates]
  : feature.geometry.coordinates;

test('red zones snapshot identifies the user supplied source and import date', () => {
  assert.equal(zones.type, 'FeatureCollection');
  assert.equal(
    zones.metadata.sourceUrl,
    'https://www.google.com/maps/d/u/0/viewer?mid=1BIDwlVJ6VzXOfRAy-LrukC-ddg8BDiI',
  );
  assert.equal(zones.metadata.sourceTitle, 'MAPA DE ZONAS DE RIESGO PARA REPARTIDORES Y CONDUCTORES DE APPS');
  assert.ok(Number.isFinite(Date.parse(zones.metadata.importedAt)));
  assert.match(zones.metadata.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(zones.metadata.note, /comunitaria/);
  assert.match(zones.metadata.note, /no incluye.*tiempo real/);
});

test('red zones contains the 59 source areas and preserves its multi polygon boundary', () => {
  assert.equal(zones.metadata.areaCount, 59);
  assert.equal(zones.features.length, zones.metadata.areaCount);
  assert.equal(zones.metadata.polygonCount, 60);
  assert.equal(zones.features.reduce((count, feature) => count + polygonsOf(feature).length, 0), zones.metadata.polygonCount);
  assert.equal(new Set(zones.features.map(feature => feature.id)).size, zones.features.length);
  const multiple = zones.features.filter(feature => feature.geometry.type === 'MultiPolygon');
  assert.equal(multiple.length, 1);
  assert.equal(multiple[0].properties.name, 'Otras zonas');
  assert.equal(multiple[0].geometry.coordinates.length, 2);
});

test('red zones preserves original names, layers and colors without importing point incidents', () => {
  assert.deepEqual(zones.metadata.sourceLayers, ['Zonas', 'Barrios y Zonas de Córdoba']);
  const layers = {};
  const colors = {};
  for (const feature of zones.features) {
    assert.equal(feature.type, 'Feature');
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    assert.ok(feature.properties.name.trim());
    assert.ok(zones.metadata.sourceLayers.includes(feature.properties.sourceLayer));
    assert.match(feature.properties.sourceColor, /^#[0-9A-F]{6}$/);
    assert.equal(Object.hasOwn(feature.properties, 'riskLevel'), false);
    layers[feature.properties.sourceLayer] = (layers[feature.properties.sourceLayer] || 0) + 1;
    colors[feature.properties.sourceColor] = (colors[feature.properties.sourceColor] || 0) + 1;
  }
  assert.deepEqual(layers, { Zonas: 30, 'Barrios y Zonas de Córdoba': 29 });
  assert.deepEqual(colors, {
    '#795548': 16, '#EDA29B': 7, '#FF5252': 23, '#A52714': 5, '#F57C00': 3, '#000000': 5,
  });
  assert.equal(zones.features[0].properties.name, 'Villa urquiza');
  assert.equal(zones.features.some(feature => feature.properties.name === 'Country - Predio cerrado'), false);
  assert.equal(zones.features.find(feature => feature.properties.name === 'Zona roja - Amp ferreyra').properties.sourceColor, '#000000');
});

test('source boundaries retain complete unrounded longitude latitude rings in Córdoba', () => {
  let positions = 0;
  for (const feature of zones.features) {
    for (const polygon of polygonsOf(feature)) {
      assert.ok(polygon.length >= 1);
      for (const ring of polygon) {
        assert.ok(ring.length >= 4);
        assert.deepEqual(ring[0], ring.at(-1));
        const distinct = new Set(ring.map(position => position.join(',')));
        assert.ok(distinct.size >= 3);
        for (const position of ring) {
          assert.equal(position.length, 2);
          const [lng, lat] = position;
          assert.ok(Number.isFinite(lng) && lng > -64.4 && lng < -64);
          assert.ok(Number.isFinite(lat) && lat > -31.6 && lat < -31.2);
          positions++;
        }
      }
    }
  }
  assert.equal(positions, 1194);
  assert.deepEqual(zones.features[0].geometry.coordinates[0][1], [-64.2480397, -31.3850104]);
});
