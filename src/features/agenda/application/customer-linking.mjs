import { normalizeCustomerName } from "../../../domain/shared/normalization.mjs";
import { serviceActor } from "./agenda-model.mjs";

export const subscriberReservationPatch = (value, user) => ({
  newCustomer: false,
  subscriberReservation: true,
  customerId: '',
  client: normalizeCustomerName(value),
  clientAccount: '',
  clientNameAtService: normalizeCustomerName(value),
  address: '',
  phone: '',
  reservationCreatedAt: new Date().toISOString(),
  reservationCreatedBy: serviceActor(user)
})

export const clearSubscriberReservationPatch = task => task?.subscriberReservation ? {
  newCustomer: false,
  subscriberReservation: false,
  customerId: '',
  client: '',
  clientAccount: '',
  clientNameAtService: '',
  address: '',
  phone: '',
  reservationCreatedAt: '',
  reservationCreatedBy: null
} : {}

export const customerLinkPatch = (task, customer, user) => ({
  newCustomer: false,
  subscriberReservation: false,
  customerId: customer.customerId,
  client: `${customer.account} ${customer.name}`,
  clientAccount: customer.account,
  clientNameAtService: customer.name,
  address: customer.address,
  phone: customer.phone,
  ...(task?.subscriberReservation ? {
    reservationOriginal: task.reservationOriginal || {
      name: task.clientNameAtService || task.client || '',
      address: task.address || '',
      phone: task.phone || ''
    },
    reservationLinkedAt: new Date().toISOString(),
    reservationLinkedBy: serviceActor(user)
  } : {})
})
