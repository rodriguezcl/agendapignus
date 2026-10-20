

export const servicePhotoUrl = record => record?.servicePhotoUrl || (record?.servicePhotoAttached ? `/api/service-photo/${encodeURIComponent(String(record.id || record.historyId || ''))}` : '')
