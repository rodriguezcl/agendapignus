import {useEffect,useState} from 'react'
import {requestJson} from '../infrastructure/http/json-request.mjs'
const title=item=>item.manualContact?'Visita no realizada: contactar al cliente para ofrecer una nueva fecha':item.cancelledNotice?'Cancelación de visita pendiente de comunicar':item.channel==='whatsapp'?(item.kind==='experience'?'WhatsApp de postventa pendiente de revisión':'WhatsApp de confirmación pendiente de revisión'):item.kind==='appointment'?'Correo de confirmación de visita pendiente':item.kind==='registration'?(item.status==='needs_email'?'Falta el email para confirmar el alta':'Confirmación de alta pendiente de revisión'):item.status==='needs_email'?'Falta el email para solicitar la experiencia':'Correo de experiencia pendiente de revisión'
export default function useExperienceMailNotifications({enabled,userKey}) {
  const [snapshot,setSnapshot]=useState({userKey:null,items:[]})
  useEffect(()=>{
    if(!enabled||!userKey)return
    let disposed=false,running=false;setSnapshot({userKey:null,items:[]})
    const refresh=async()=>{
      if(disposed||running||document.hidden)return
      running=true
      try {const data=await requestJson('/api/customers/experience-mail?notices=1');if(!disposed)setSnapshot({userKey,items:data.items.map(item=>({id:`experience-mail:${item.id}`,title:title(item),detail:`${item.account} · ${item.client}. ${item.manualContact?'Contactá por teléfono o WhatsApp para ofrecerle coordinar una nueva fecha y registrá la gestión.':item.status==='needs_action'?'Informá al cliente que la visita fue cancelada y registrá la gestión.':item.status==='needs_phone'?'Corregí el teléfono de contacto del servicio.':item.status==='needs_email'?'Registrá el correo del cliente para enviar el correo.':item.error||(item.channel==='whatsapp'?'Revisá el canal de WhatsApp.':'Revisá que el correo de soporte esté activo.')}`,tone:'warning',target:{type:'experience-mail',id:item.id}}))})}
      catch(error){if(!disposed&&[401,403].includes(error.status))setSnapshot({userKey:null,items:[]})}
      finally{running=false}
    }
    refresh();const timer=setInterval(refresh,60000)
    window.addEventListener('focus',refresh);window.addEventListener('experience-mail-changed',refresh)
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('experience-mail-changed',refresh)}
  },[enabled,userKey])
  return {items:enabled&&snapshot.userKey===userKey?snapshot.items:[],ready:enabled&&snapshot.userKey===userKey}
}
