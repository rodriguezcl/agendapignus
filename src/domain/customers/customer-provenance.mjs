export function previousSubscriberAccount(customer = {}) {
  const currentAccount = String(customer.account || '').trim().toUpperCase()
  const previousAccount = String(customer.convertedFromAccount || '').trim().toUpperCase()
  const isClient = customer.kind === 'client' || currentAccount.startsWith('CLI-')
  return isClient && /^PIG-\d+$/.test(previousAccount) ? previousAccount : ''
}

