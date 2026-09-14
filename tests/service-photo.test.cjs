const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('la interfaz permite adjuntar desde archivo o cámara y muestra la foto en todas las vistas solicitadas', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8')
  assert.match(source, /Galería o archivo/)
  assert.match(source, /capture="environment"/)
  assert.match(source, /weekly-service-photo/)
  assert.match(source, /daily-service-photo|ServicePhotoManager/)
  assert.match(source, /technician-service-photo/)
  assert.match(source, /history-service-photo/)
  assert.match(source, /servicePhotoRepository\.upload/)
  assert.match(source, /servicePhotoRepository\.remove/)
})

test('el almacenamiento separa el binario del estado general y lo vincula al servicio', () => {
  const legacy = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202608250001_pignus_schema.sql'), 'utf8')
  const normalized = fs.readFileSync(path.join(__dirname, '../supabase/proposals/normalized-shadow-v1.sql'), 'utf8')
  assert.match(legacy, /pignus_service_photos[\s\S]*record_id text primary key references public\.pignus_work_history\(id\) on delete cascade/)
  assert.match(normalized, /normalized_shadow\.service_photos[\s\S]*job_id text primary key references normalized_shadow\.jobs\(id\) on delete cascade/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/infrastructure/repositories/service-photo-repository.mjs'), 'utf8'), /data:image/)
})
