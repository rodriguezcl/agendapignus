import {bankForCbu,canonicalChoice} from './catalogs.mjs'
import cardValidator from 'card-validator'
import {stepsFor,TITLES} from './schema.mjs'
const digits=value=>String(value||'').replace(/[\s.-]/g,'')
export function validCbu(value) {
  const n=digits(value)
  const check=(part,weights)=>String((10-part.split('').reduce((s,d,i)=>s+Number(d)*weights[i],0)%10)%10)
  return /^\d{22}$/.test(n)&&!n.startsWith('000')&&check(n.slice(0,7),[7,1,3,9,7,1,3])===n[7]&&check(n.slice(8,21),[3,9,7,1,3,9,7,1,3,9,7,1,3])===n[21]
}
export function validCuit(value) {
  const n=digits(value);if(!/^\d{11}$/.test(n)||/^0+$/.test(n))return false
  let check=11-n.slice(0,10).split('').reduce((s,d,i)=>s+Number(d)*[5,4,3,2,7,6,5,4,3,2][i],0)%11
  if(check===11)check=0;if(check===10)check=9
  return Number(n[10])===check
}
export function validate(kind,input,now=new Date()) {
  const errors={},values={}
  if(!TITLES[kind]||!input||typeof input!=='object'||Array.isArray(input))return {values,errors:{form:'Formulario inválido.'}}
  const fields=stepsFor(kind,input).flatMap(s=>s.fields)
  for(const field of fields) {
    const raw=input[field.id],value=field.type==='checkbox'?raw===true:typeof raw==='string'?(field.options?canonicalChoice(raw.trim(),field.options):raw.trim()):''
    values[field.id]=value
    if(field.required&&!value)errors[field.id]='Completá este campo.'
    else if(typeof value==='string'&&value.length>(field.maxLength||160))errors[field.id]='El texto es demasiado largo.'
    else if(value&&field.options&&!field.options.includes(value))errors[field.id]='Seleccioná una opción válida.'
    else if(value&&field.type==='email'&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))errors[field.id]='Ingresá un correo válido.'
    else if(value&&field.type==='tel'&&!/^\+?[\d\s()–-]{6,30}$/.test(value))errors[field.id]='Ingresá un teléfono con código de área.'
  }
  const dni=v=>/^\d{6,8}$/.test(digits(v))&&!/^0+$/.test(digits(v))
  if(!(kind==='residencial'?validCuit(values.document):dni(values.document)))errors.document=kind==='residencial'?'Revisá el CUIL / CUIT de 11 dígitos.':'Revisá el DNI, sin puntos.'
  if(values.monthlyFee&&!/^\d+(?:[.,]\d{1,2})?$/.test(values.monthlyFee))errors.monthlyFee='Ingresá el importe sin separador de miles, por ejemplo 65000,00.'
  if(Boolean(values.contact3)!==Boolean(values.contactPhone3))errors[values.contact3?'contactPhone3':'contact3']='Completá ambos datos del tercer contacto o dejalos vacíos.'
  if(kind==='residencial'&&values.paymentMethod==='Débito CBU') {
    if(!validCbu(values.cbu))errors.cbu=digits(values.cbu).startsWith('000')?'No aceptamos CVU. Ingresá el CBU de una cuenta bancaria.':'Revisá los 22 dígitos y verificadores del CBU.'
    if(validCbu(values.cbu)&&bankForCbu(values.cbu)?.name!==values.bank)errors.bank='El banco seleccionado no corresponde al código del CBU. Revisá ambos datos.'
    if(!(values.bankDocumentType==='DNI'?dni(values.bankDocument):validCuit(values.bankDocument)))errors.bankDocument='Revisá el documento del titular de la cuenta.'
  } else if(kind==='residencial'&&values.paymentMethod) {
    const card=cardValidator.number(values.cardNumber),expected=values.paymentMethod==='Visa crédito'?'visa':'mastercard'
    if(!card.isValid||card.card?.type!==expected)errors.cardNumber='Revisá el número y la marca de la tarjeta.'
    const expiry=/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(values.cardExpiry||'')
    const month=Number(expiry?.[1]),year=expiry?.[2]?.length===2?2000+Number(expiry[2]):Number(expiry?.[2])
    if(!expiry||month<1||month>12||year<now.getFullYear()||year===now.getFullYear()&&month<now.getMonth()+1||year>now.getFullYear()+25)errors.cardExpiry='Ingresá un vencimiento vigente (MM/AA).'
    if(!dni(values.cardDni))errors.cardDni='Revisá el DNI del titular.'
  }
  // Only known, applicable fields can be stored. In particular no CVV/CVC/PIN.
  for(const key of ['document','cardNumber','cardDni','cbu','bankDocument'])if(values[key])values[key]=digits(values[key])
  values.email=values.email?.toLowerCase()
  return {values,errors}
}
