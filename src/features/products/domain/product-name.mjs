import schema from '../../../../shared/cctv-schema.cjs'

const collator = new Intl.Collator('es', { sensitivity: 'base' })
const cameraKinds = schema.CCTV_SYMBOL_KINDS.camera
const alarmComponent = /^(?:soporte|módulo|detector|panel|central|placa|comunicador|sensor|sirena|teclado|lector|control remoto|pulsador|receptor|transceptor|repetidor|expansor|relé|fuente|kit|batería|antena|llavero|contacto magnético|transformador|botón)(?=$|[\s·,.:/–—-])/iu

export const productType = ({ category, kind }) => schema.EQUIPMENT_KINDS[category]?.[kind] || kind || ''

function startsWithTerm(text, term) {
  return term && collator.compare(text.slice(0, term.length), term) === 0 &&
    (!text[term.length] || /[\s·,.:/–—-]/.test(text[term.length]))
}

export function productName(product) {
  const brand = (product.brand || '').trim()
  const type = productType(product)
  let details = (product.description || '').trim().replace(/\s+/g, ' ')
  if (startsWithTerm(details, brand)) details = details.slice(brand.length).replace(/^[\s·,.:/–—-]+/, '')

  // Existing descriptions may already include the equipment type or a more specific camera format.
  let body
  if (cameraKinds.includes(product.kind) && /^(?:domo|bullet|torreta|turret|fisheye|ptz)\b/i.test(details)) {
    body = 'Cámara ' + details.replace(/^(domo|bullet|torreta|turret|fisheye)\b/i, format => format.toLowerCase())
  } else if ((product.id?.startsWith('base:') && product.category === 'alarm' && alarmComponent.test(details)) ||
      [type, ...type.split(' / ')].some(label => startsWithTerm(details, label)) ||
      (cameraKinds.includes(product.kind) && startsWithTerm(details, 'Cámara'))) {
    body = details
  } else {
    body = [type, details].filter(Boolean).join(' · ')
  }
  return [brand, body].filter(Boolean).join(' · ')
}
