// Communications cover alarms and cameras. Alarm-zone validation stays alarm-only.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
function installationType(record) {
  if (!record || record.vehicleControl) return null
  const names = [record.service, ...(record.serviceTypes || []).map(item => item.name || item.label)]
    .flatMap(value => normalize(value).split(/\s*[·|+]\s*/))
  const alarm = names.includes('instalacion de alarma'), cameras = names.includes('instalacion de camaras')
  return alarm && cameras ? 'combined' : cameras ? 'cameras' : alarm ? 'alarm' : null
}
const descriptions = {
  alarm: { serviceType: 'Instalación de alarma', installationDescription: 'tu alarma', usageDescription: 'la alarma' },
  cameras: { serviceType: 'Instalación de cámaras', installationDescription: 'tu sistema de cámaras', usageDescription: 'las cámaras' },
  combined: { serviceType: 'Instalación de alarma y cámaras', installationDescription: 'tu alarma y tu sistema de cámaras', usageDescription: 'la alarma y las cámaras' }
}
const describe = type => ({ installationType: type || 'alarm', ...descriptions[type || 'alarm'] })
const installation = record => Boolean(installationType(record))
// Combined visits use the camera workflow, whose template has a dynamic subject.
const channelFor = type => type === 'cameras' || type === 'combined' ? 'cameras' : 'alarm'
module.exports = { installation, installationType, describe, channelFor }
