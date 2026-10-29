import data from './catalog-data.mjs'

export const OTHER_NEIGHBORHOOD = 'Mi barrio no figura / zona rural'
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const cities = data.cities
export const banks = data.banks
export const cityOptions = cities.map(city => city.label)
export const bankOptions = banks.map(bank => bank.name)
export const cityFor = value => cities.find(city => normalize(city.label) === normalize(value))
export const neighborhoodsFor = value => data.neighborhoods[cityFor(value)?.id]?.names || []
export const neighborhoodCoverage = value => data.neighborhoods[cityFor(value)?.id]?.coverage || 'Todavía no contamos con un catálogo público de barrios para esta localidad.'
export const bankForCbu = value => banks.find(bank => bank.code === String(value || '').replace(/[\s.-]/g, '').slice(0, 3))
export function canonicalChoice(value, options) { return options.find(option => normalize(option) === normalize(value)) || value }
export const catalogMetadata = { retrievedAt: data.retrievedAt, citySource: data.citySource, bankSource: data.bankSource, bankPublishedAt: data.bankPublishedAt }
