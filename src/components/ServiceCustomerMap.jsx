import React from 'react'
import CustomerMap from './CustomerMap.jsx'
import { serviceMapCustomer } from '../domain/customers/service-map-customer.mjs'

export default function ServiceCustomerMap({ record, customers }) {
  const customer = serviceMapCustomer(record, customers)
  return customer ? <CustomerMap key={customer.customerId || customer.account} customer={customer} /> : null
}
