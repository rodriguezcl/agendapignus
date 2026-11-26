import { writeFile } from 'node:fs/promises'

const sources = ['https://www.dahuasecurity.com/la/sitemap.xml', 'https://www.dahuasecurity.com/en/sitemap.xml']
const groups = { dvr: new Set(), xvr: new Set(), nvr: new Set(), analog_camera: new Set(), ip_camera: new Set() }
const familyPath = /\/(?:network-recorders|network-cameras|hdcvi-recorders|hdcvi-cameras|hdcvi-ptz-cameras|ptz-cameras|thermal-cameras|wireless-products|explosion-proof(?:-cameras)?|ez-ip)\//

// Model codes from Dahua's HDCVI Standalone DVR manuals (specification and rear-panel sections).
// https://www.dahuasecurity.com/asset/upload/product/20180525/Dahua-HDCVI-DVR-Users-Manual-V2_3_4-4.pdf
// https://material.dahuasecurity.com/download/Dahua_HDCVI_DVR_Users_Manual_V1.8.2_20160938.pdf
const legacyRecorders = [
  'HCVR2108C-S2', 'HCVR2108HS-S2', 'HCVR2116HS-S2',
  'HCVR4104HS-S3', 'HCVR4108C-S2', 'HCVR4108HS-S3', 'HCVR4116HS-S3',
  'HCVR4216AN-S2', 'HCVR4224', 'HCVR4232AN-S2',
  'HCVR5104C', 'HCVR5104C-V2', 'HCVR5108C-V2', 'HCVR5104H', 'HCVR5108H',
  'HCVR5104H-V2', 'HCVR5108H-V2', 'HCVR5116H-V2',
  'HCVR5104HC', 'HCVR5108HC', 'HCVR5104HC-V2', 'HCVR5108HC-V2', 'HCVR5116HC-V2',
  'HCVR5104HE', 'HCVR5108HE', 'HCVR5104HE-V2', 'HCVR5108HE-V2', 'HCVR5116HE-V2',
  'HCVR5104HS-S3', 'HCVR5108HS-S3', 'HCVR5116HS-S3', 'HCVR5216AN-S2',
  'HCVR7104C-S2', 'HCVR7104C-V2', 'HCVR7104H-V2', 'HCVR7108H-V2',
  'HCVR7104HC-V2', 'HCVR7108HC-V2', 'HCVR7104HE-V2', 'HCVR7108HE-V2', 'HCVR7216AN-S3'
]

function productFromUrl(href, title) {
  const path = new URL(href.replaceAll('&amp;', '&')).pathname.toLowerCase()
  if (!path.includes('/products/') || path.includes('/key-technologies/')) return null
  const model = (title || decodeURIComponent(path.split('/').filter(Boolean).at(-1))).trim().toUpperCase().replace(/^(?:DH|DHI)-/, '')
  if (!/^[A-Z][A-Z0-9.=_+/() -]{2,99}$/.test(model) || /(?:SERIES|SOFTWARE|FIRMWARE)$/.test(model)) return null
  if (/\/(?:network-recorders|hdcvi-recorders|ez-ip|discontinued-products|recorder-server)\//.test(path)) {
    if (/^NVR-?\d/.test(model)) return ['nvr', model]
    if (/^(?:S-)?XVR-?\d/.test(model)) return ['xvr', model]
    if (/^(?:DVR|HCVR)-?\d/.test(model)) return ['dvr', model]
  }
  if (/\/(?:hdcvi-cameras|hdcvi-ptz-cameras|ptz-cameras)\//.test(path)) {
    if (/^HAC-?[A-Z]+\d/.test(model) || (/\/hdcvi-ptz-cameras\//.test(path) && /^SD[A-Z]*\d{2,}/.test(model))) return ['analog_camera', model]
  }
  if (/\/(?:network-cameras|wireless-products|ptz-cameras|thermal-cameras|ez-ip|explosion-proof(?:-cameras)?|anti-corrosion)\//.test(path)) {
    if (/^(?:IPC|TPC)-?[A-Z]+\d/.test(model) || /^(?:SD[A-Z]*|PSD[A-Z]*|PTZ[A-Z]*|P|H|B|BP|F)\d[A-Z0-9]+/.test(model) || /^(?:HERO|PICOO|CUBE|BULLET)-[A-Z]+\d/.test(model)) return ['ip_camera', model]
  }
  return null
}

const indexes = await Promise.all(sources.map(async source => {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Dahua devolvió HTTP ${response.status} para ${source}`)
  const urls = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
  if (!urls.length) throw new Error(`No se pudieron leer los productos de ${source}`)
  return urls
}))

const archiveCategories = ['HDCVI-Recorders', 'Network-Recorders', 'HDCVI-Cameras', 'Network-Cameras', 'PTZ-Cameras']
const archiveUrls = archiveCategories.flatMap(category => ['', '/la'].map(region =>
  `https://previous.dahuasecurity.com${region}/products/All-Products/Discontinued-Products/${category}`
))
archiveUrls.push('https://previous.dahuasecurity.com/ph/Products/All-Products/Discontinued-Products/HDCVI-Recorders')
const archived = await Promise.all(archiveUrls.map(async source => {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Dahua devolvió HTTP ${response.status} para ${source}`)
  const html = await response.text()
  return [...html.matchAll(/href="([^"]*\/Discontinued-Products\/[^"]+)"/gi)].map(match => new URL(match[1], source).href)
}))

const indexUrls = new Set(indexes.flat())
const official = 'https://www.dahuasecurity.com'
const categories = [...indexUrls].filter(href => {
  if (!href.startsWith(official + '/products/') && !href.startsWith(official + '/la/products/')) return false
  const pathname = new URL(href).pathname
  return pathname === pathname.toLowerCase() && !pathname.includes('discontinued-products') &&
    familyPath.test(pathname) && !productFromUrl(href) && !/\/(accessories|software)(\/|$)/.test(pathname)
})
const menus = new Map()
for (let offset = 0; offset < categories.length; offset += 10) {
  await Promise.all(categories.slice(offset, offset + 10).map(async source => {
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) return
    const language = new URL(source).pathname.startsWith('/la/') ? 'la' : 'en'
    const html = await response.text()
    for (const match of html.matchAll(/class="tabs-li[^"]*"[^>]*data-id="(\d+)"/g)) menus.set(`${language}:${match[1]}`, source)
  }))
}

async function listModels(menu, source) {
  const [language, menuId] = menu.split(':')
  const limit = 48
  for (let page = 1; ; page++) {
    const response = await fetch(`${official}/api/${language}/product/productSelect`, {
      method: 'POST', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ id: '', keyword: '', child: '', menuId, page, limit }),
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) throw new Error(`Dahua devolvió HTTP ${response.status} para ${source}`)
    const { data } = await response.json()
    if (!Array.isArray(data?.productList)) throw new Error(`Respuesta inválida del catálogo para ${source}`)
    for (const item of data.productList) {
      const product = productFromUrl(new URL(item.product_keywords, source).href, item.product_name)
      if (product) groups[product[0]].add(product[1])
    }
    if (!data.productList.length || page * limit >= Number(data.currentCount)) return
  }
}

const series = [...menus]
if (!series.length) throw new Error('Dahua no publicó las categorías del selector de productos.')
for (let offset = 0; offset < series.length; offset += 8) {
  await Promise.all(series.slice(offset, offset + 8).map(([menu, source]) => listModels(menu, source)))
}

for (const url of new Set([...indexUrls, ...archived.flat()])) {
  const product = productFromUrl(url)
  if (product) groups[product[0]].add(product[1])
}
for (const model of legacyRecorders) groups.dvr.add(model)
for (const model of groups.analog_camera) groups.ip_camera.delete(model)
const models = Object.fromEntries(Object.entries(groups).map(([kind, values]) => [kind, [...values].sort()]))
const missing = Object.keys(models).filter(kind => !models[kind].length)
if (missing.length) throw new Error(`Familias ausentes en las fuentes oficiales: ${missing.join(', ')}`)
await writeFile(new URL('../src/features/cctv/domain/dahua-models.json', import.meta.url), JSON.stringify(models, null, 2) + '\n')
console.log(Object.fromEntries(Object.entries(models).map(([kind, values]) => [kind, values.length])))
