import {bankForCbu,canonicalChoice,cityOptions,neighborhoodsFor,OTHER_NEIGHBORHOOD,neighborhoodCoverage} from '../../../shared/registration/catalogs.mjs'
import React,{useEffect,useRef,useState} from 'react'
import {stepsFor,TITLES,VERSION} from '../../../shared/registration/schema.mjs'
import {validate} from '../../../shared/registration/validate.mjs'
import {requestJson} from '../../infrastructure/http/json-request.mjs'
import './registration.css'
function normalizePrefill(prefill) {
  const values={...prefill};if(values.city)values.city=canonicalChoice(values.city,cityOptions)
  if(values.neighborhood){const match=canonicalChoice(values.neighborhood,neighborhoodsFor(values.city));if(neighborhoodsFor(values.city).includes(match))values.neighborhood=match;else if(values.neighborhood!==OTHER_NEIGHBORHOOD){values.neighborhoodOther=values.neighborhood;values.neighborhood=OTHER_NEIGHBORHOOD}}
  return values
}
const api=input=>requestJson('/api/registration/public',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify(input)})
export default function PublicRegistration() {
  const token=useRef(window.location.hash.slice(1)),[data,setData]=useState(null),[values,setValues]=useState({}),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[errors,setErrors]=useState({}),[retry,setRetry]=useState(0)
  const heading=useRef(null),sending=useRef(false),formRef=useRef(null)
  useEffect(()=>{let live=true;setError('');api({action:'read',token:token.current}).then(result=>{if(live){setData(result);setValues(normalizePrefill(result.prefill||{}))}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[retry])
  useEffect(()=>{heading.current?.focus()},[step,data?.submitted])
  useEffect(()=>{const leave=e=>{if(!data?.submitted&&Object.keys(values).length){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[values,data?.submitted])
  const steps=stepsFor(data?.kind,values),current=steps[step],last=step===steps.length-1
  function currentValues() {
    // Some browser autofill implementations update DOM values without firing
    // React's change event. Read the visible controls before either navigation.
    const fields=new FormData(formRef.current),next={...values}
    for(const field of current.fields)next[field.id]=field.type==='checkbox'?fields.has(field.id):String(fields.get(field.id)??'')
    return next
  }
  async function advance(event) {
    event.preventDefault();if(sending.current)return
    const entered=currentValues();setValues(entered)
    const checked=validate(data.kind,entered),ids=last?null:new Set(current.fields.map(f=>f.id)),invalid=Object.fromEntries(Object.entries(checked.errors).filter(([key])=>!ids||ids.has(key)))
    setErrors(invalid);setError('')
    if(Object.keys(invalid).length){const first=Object.keys(invalid)[0],index=steps.findIndex(s=>s.fields.some(f=>f.id===first));if(index>=0)setStep(index);setTimeout(()=>document.getElementById(`registration-${first}`)?.focus(),0);return}
    if(!last){setStep(n=>n+1);return}
    sending.current=true;setBusy(true)
    try {const result=await api({action:'submit',token:token.current,version:data.version,termsVersion:VERSION,values:checked.values});setValues({});setData(result)}
    catch(e){setError(e.message);if(e.payload?.fields){setErrors(e.payload.fields);const index=steps.findIndex(s=>s.fields.some(f=>e.payload.fields[f.id]));if(index>=0)setStep(index)}}
    finally{setBusy(false);sending.current=false}
  }
  function update(id,value){
    setValues(old=>{const next={...old,[id]:value};if(id==='city'){next.neighborhood='';next.neighborhoodOther=''}if(id==='neighborhood')next.neighborhoodOther='';if(id==='cbu')next.bank=bankForCbu(value)?.name||'';return next})
    setErrors(old=>({...old,[id]:undefined,...(id==='city'?{neighborhood:undefined,neighborhoodOther:undefined}:{}),...(id==='cbu'?{bank:undefined}:{})}))
  }
  return <main className="public-registration"><header className="registration-brand"><strong>PIGNUS</strong><span>Alta de servicio</span></header><article className="registration-card">
    {!data&&<><h1 ref={heading} tabIndex={-1}>Alta de servicio</h1>{!error&&<p role="status">Cargando tu formulario…</p>}</>}
    {data?.submitted?<><h1 ref={heading} tabIndex={-1}>Recibimos tu formulario</h1><p>Gracias por completar tus datos. Nuestro equipo revisará la información para gestionar el alta.</p><p>Si necesitás corregir algún dato, pedile a Pignus un enlace de corrección.</p><p>Ya podés cerrar esta página.</p></>:current&&<>
      <p className="registration-kicker">{TITLES[data.kind]}</p><p className="registration-appointment">{data.appointment.awaitingConfirmation?'Visita pendiente de confirmación · propuesta:':'Visita coordinada:'} {String(data.appointment.date||'').split('-').reverse().join('/')} · {data.appointment.time} hs</p>
      {data.reason&&<aside className="registration-correction"><strong>Corrección solicitada</strong><p>{data.reason}</p><small>Por seguridad, volvé a ingresar los datos de monitoreo y de débito, si corresponden.</small></aside>}
      <nav aria-label="Progreso del formulario"><span>Paso {step+1} de {steps.length}</span><progress value={step+1} max={steps.length} /></nav>
      <h1 tabIndex={-1} ref={heading}>{current.title}</h1>{current.help&&<p>{current.help}</p>}
      {current.id==='terms'&&<><p>Leé las condiciones antes de continuar. Podés abrirlas para consultar el texto completo.</p><details className="registration-contract"><summary>Términos y condiciones del servicio</summary><div>{data.terms.split('\n\n').map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div></details></>}
      {current.id==='payment'&&<p>La cuenta o tarjeta puede pertenecer a otra persona. Completá los datos de su titular. Verificamos el formato; la adhesión se gestiona posteriormente.</p>}
      {last&&<><p>Revisá los datos antes de enviarlos. Podés volver a cada paso para corregirlos.</p><dl className="registration-review">{steps.filter(s=>!['terms','review','monitoring','payment'].includes(s.id)).flatMap(s=>s.fields).filter(f=>values[f.id]&&f.type!=='checkbox').map(f=><div key={f.id}><dt>{f.label}</dt><dd>{values[f.id]}</dd></div>)}{values.paymentMethod&&<div><dt>Débito automático</dt><dd>{values.paymentMethod} · terminación {String(values.cbu||values.cardNumber||'').replace(/\s/g,'').slice(-4)}</dd></div>}</dl><p>La firma, aclaración, DNI, número de cuenta y fecha de instalación se completarán presencialmente al finalizar la instalación.</p></>}
      <form ref={formRef} name="service-registration" autoComplete="on" onSubmit={advance} noValidate><fieldset disabled={busy} className="registration-fields"><legend className="sr-only">{current.title}</legend>{current.fields.map(f=><div key={f.id} className={`registration-field ${f.type==='checkbox'?'registration-checkbox':''}`}>
        <label htmlFor={`registration-${f.id}`}>{f.type==='checkbox'&&<input id={`registration-${f.id}`} name={f.id} autoComplete={f.autoComplete} type="checkbox" checked={values[f.id]===true} onChange={e=>update(f.id,e.target.checked)} aria-invalid={Boolean(errors[f.id])} aria-describedby={errors[f.id]?`error-${f.id}`:undefined} />}{f.label}{f.required&&f.type!=='checkbox'&&<span aria-hidden="true"> *</span>}</label>
        {f.type!=='checkbox'&&(f.options?<select id={`registration-${f.id}`} name={f.id} autoComplete={f.autoComplete} value={values[f.id]||''} onChange={e=>update(f.id,e.target.value)} aria-required={f.required} aria-invalid={Boolean(errors[f.id])} aria-describedby={`help-${f.id} error-${f.id}`}><option value="">Seleccioná una opción</option>{f.options.map(o=><option key={o}>{o}</option>)}</select>:f.type==='textarea'?<textarea id={`registration-${f.id}`} name={f.id} autoComplete={f.autoComplete} maxLength={f.maxLength} value={values[f.id]||''} onChange={e=>update(f.id,e.target.value)} aria-invalid={Boolean(errors[f.id])}/>:<input id={`registration-${f.id}`} name={f.id} autoComplete={f.autoComplete} type={f.type} inputMode={f.inputMode} maxLength={f.maxLength} placeholder={f.placeholder} value={values[f.id]||''} onChange={e=>update(f.id,e.target.value)} aria-required={f.required} aria-invalid={Boolean(errors[f.id])} aria-describedby={`help-${f.id} error-${f.id}`} />)}
        {f.id==='neighborhood'&&values.city&&<small>{neighborhoodCoverage(values.city)}</small>}{f.help&&<small id={`help-${f.id}`}>{f.help}</small>}{errors[f.id]&&<p className="registration-error" id={`error-${f.id}`} role="alert">{errors[f.id]}</p>}
      </div>)}</fieldset><footer className="registration-actions">{step>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setValues(currentValues());setStep(n=>n-1);setError('')}}>Anterior</button>}<button type="submit" className="primary" disabled={busy}>{busy?'Enviando…':last?'Enviar formulario':'Continuar'}</button></footer></form>
    </>}
    {error&&<p role="alert" className="registration-error">{error} {!data&&<button type="button" onClick={()=>setRetry(n=>n+1)}>Reintentar</button>}</p>}
  </article><footer className="registration-footer">Pignus · Guardianes por naturaleza</footer></main>
}
