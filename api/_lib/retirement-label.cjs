// Keep report output consistent with the browser's retirement label.
function retirementClientLabel(record = {}) {
  const label = String(record.client || '').trim()
  const account = String(record.clientAccount || '').trim().toUpperCase()
  if (!/^CLI-\d+$/.test(account)) return label || 'Cliente sin especificar'
  const name = label.replace(/^(?:PIG|CLI)-\d+(?:\s+|$)/i, '').trim() || String(record.clientNameAtService || '').trim()
  return [account, name].filter(Boolean).join(' ')
}

module.exports = { retirementClientLabel }
