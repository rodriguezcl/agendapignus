import {cityOptions,bankOptions,neighborhoodsFor,OTHER_NEIGHBORHOOD} from './catalogs.mjs'
export const VERSION='2026-10-28'
export const TITLES={docta:'Docta Urbanización','nobu-town':'Nobu Town',residencial:'Pignus Seguridad'}
export const DECLARATION='Declaro que los datos consignados son correctos, completos y verídicos, asumiendo total responsabilidad sobre la información brindada. La firma de esta solicitud se realizará de manera presencial al finalizar la instalación del equipo en señal de aceptación y de haber comprendido los términos y condiciones que figuran en el presente contrato.'
// Standard HTML autofill hints; independent sections prevent mixing the
// subscriber, payment holder and emergency contacts. DNI/CUIT/CBU and alarm
// identification words have no equivalent saved-profile field.
const autofill={
  name:'section-subscriber name',email:'section-subscriber email',phone:'section-subscriber tel',
  address:'section-subscriber address-line1',unit:'section-subscriber address-line2',
  neighborhood:'section-subscriber address-level3',city:'section-subscriber address-level2',
  cardNumber:'section-payment cc-number',cardHolder:'section-payment cc-name',cardExpiry:'section-payment cc-exp',
  bankHolder:'section-bank name',
  contact1:'section-emergency1 name',contactPhone1:'section-emergency1 tel',
  contact2:'section-emergency2 name',contactPhone2:'section-emergency2 tel',
  contact3:'section-emergency3 name',contactPhone3:'section-emergency3 tel'
}
const f=(id,label,options={})=>({id,label,required:true,type:'text',maxLength:160,autoComplete:autofill[id]||'off',...options})
export const secretFields=['subscriberPassword','operatorPassword','cardNumber','cardHolder','cardExpiry','cardDni','cbu','bankHolder','bankDocumentType','bankDocument','bank']
export const financialFields=secretFields.slice(2)
export function stepsFor(kind,values={}) {
  if(!TITLES[kind])return []
  const residential=kind==='residencial'
  const bank=values.paymentMethod==='Débito CBU'
  return [
    {title:'Condiciones del servicio',id:'terms',fields:[f('termsAccepted','Leí y acepto los términos y condiciones',{type:'checkbox'})]},
    {title:'Datos principales',id:'customer',fields:[f('name','Nombre y apellido',{help:'Tal como figura en tu DNI.'}),f('document',residential?'CUIL / CUIT':'DNI',{inputMode:'numeric',maxLength:14}),f('email','Correo electrónico',{type:'email',maxLength:254}),f('phone','Teléfono de contacto',{type:'tel',help:'Incluí el código de área.'}),...(residential?[f('address','Domicilio del sistema'),f('unit','Piso / Depto / Oficina',{required:false}),f('city','Ciudad / localidad de Córdoba',{options:cityOptions}),f('neighborhood','Barrio',{options:[...neighborhoodsFor(values.city),OTHER_NEIGHBORHOOD],help:'Seleccioná primero la ciudad. Si tu barrio no figura, elegí la última opción para que podamos revisarlo.'}),...(values.neighborhood===OTHER_NEIGHBORHOOD?[f('neighborhoodOther','Nombre del barrio o referencia de zona rural',{help:'Este dato quedará pendiente de revisión por Pignus.'})]:[]),f('crossStreets','Entre calles',{required:false})]:[f('block','Manzana',{maxLength:40}),f('lot','Lote',{maxLength:40}),...(kind==='docta'?[f('stage','Etapa',{required:false,maxLength:40}),f('side','Lado',{options:['Lado Córdoba','Lado Malagueño']})]:[f('addressNote','Observación adicional',{required:false,type:'textarea',maxLength:1000})])])]},
    ...(residential?[{title:'Datos del servicio',id:'service',fields:[f('kit','Alarma Anti-Intrusión',{options:['KIT BASICO (1 PIR + 1 MAGNETICO + 1 CONTROL)','KIT ESENCIAL (2 PIR + 1 MAGNETICO + 1 CONTROL)','KIT PLUS (3 PIR + 2 MAGNETICO + 1 CONTROL)','KIT PREMIUM (3 PIR + 2 MAGNETICOS + 2 CONTROLES)','OTRO']}),f('extraDetection','Detección adicional',{required:false}),f('monthlyFee','Abono mensual',{required:false,inputMode:'decimal',help:'Ingresá el importe informado por Pignus.'})]},
      {title:'Débito automático',id:'payment',fields:[f('paymentMethod','Forma de adhesión',{options:['Visa crédito','Mastercard crédito','Débito CBU']}),...(values.paymentMethod?(bank?[f('cbu','CBU bancario',{inputMode:'numeric',maxLength:30,help:'22 dígitos. No se aceptan CVU ni alias.'}),f('bankHolder','Nombre del titular de la cuenta'),f('bankDocumentType','Documento del titular',{options:['DNI','CUIT / CUIL']}),f('bankDocument','Número de documento del titular',{inputMode:'numeric',maxLength:14}),f('bank','Banco',{options:bankOptions,help:'Se sugiere según el código del CBU. Verificá que corresponda a tu cuenta. No comprueba la titularidad ni habilita el débito.'})]:[f('cardNumber','Número de tarjeta',{inputMode:'numeric',maxLength:23,help:'Visa o Mastercard de crédito. No solicitamos código de seguridad.'}),f('cardHolder','Nombre del titular'),f('cardExpiry','Vencimiento (MM/AA)',{inputMode:'numeric',maxLength:7,placeholder:'MM/AA'}),f('cardDni','DNI del titular',{inputMode:'numeric',maxLength:10})]):[])]}]:[]),
    {title:'Datos de monitoreo',id:'monitoring',fields:[f('propertyType','Tipo de propiedad',{options:['Residencial','Comercial','Oficinas','Depósito','Otros']}),f('subscriberPassword','Contraseña Abonado',{type:'password',maxLength:80,help:'Palabra que le dirás al operador para identificarte. Compartila sólo con las personas autorizadas.'}),f('operatorPassword','Contraseña Operador',{type:'password',maxLength:80,help:'Palabra que te dirá el operador para que puedas identificar al centro de monitoreo.'})]},
    {title:'Contactos de emergencia',id:'contacts',help:'Se contactan en este orden. Recomendamos que el primer contacto sea el titular.',fields:[f('contact1','Contacto 1 · Nombre, apellido y relación'),f('contactPhone1','Contacto 1 · Teléfono',{type:'tel'}),...(residential?[f('contact2','Contacto 2 · Nombre, apellido y relación'),f('contactPhone2','Contacto 2 · Teléfono',{type:'tel'})]:[f('guardAccepted',`Contacto 2 · Guardia ${kind==='docta'?'Docta Urbanización (0351 156136584)':'Nobu Town (0351 153144917)'}`,{type:'checkbox'})]),f('contact3','Contacto 3 · Nombre, apellido y relación',{required:false}),f('contactPhone3','Contacto 3 · Teléfono',{type:'tel',required:false})]},
    {title:'Revisión y envío',id:'review',fields:[f('declarationAccepted',DECLARATION,{type:'checkbox'})]}
  ]
}
