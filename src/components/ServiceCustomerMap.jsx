import { useActionPermissions } from '../presentation/hooks/useActionPermissions.mjs'
import React from 'react'
import CustomerMap from './CustomerMap.jsx'
import addressChange from '../../api/_lib/address-change.cjs'
import { serviceMapCustomer } from '../domain/customers/service-map-customer.mjs'

export default function ServiceCustomerMap({ record, customers }) {
  const { can } = useActionPermissions()
  if (!can('records.contact')) return null
  if (addressChange.isAddressChange(record)) return <p><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(record.address || '')}`} target="_blank" rel="noopener noreferrer">Consultar domicilio actual · retiro en Google Maps</a></p>
  const customer = serviceMapCustomer(record, customers)
  return customer ? <CustomerMap key={customer.customerId || customer.account} customer={customer} /> : null
}
