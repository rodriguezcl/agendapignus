import {useEffect,useState} from 'react'
import {requestJson} from '../../infrastructure/http/json-request.mjs'
export default function useRegistrationNotifications({enabled,userKey}) {
  const [snapshot,setSnapshot]=useState({key:null,items:[]})
  useEffect(()=>{
    if(!enabled||!userKey)return
    let disposed=false,running=false
    const refresh=async()=>{if(disposed||running||document.hidden)return;running=true;try{const data=await requestJson('/api/registration/forms?notices=1');if(!disposed)setSnapshot({key:userKey,items:data.items})}catch(error){if(!disposed&&[401,403].includes(error.status))setSnapshot({key:null,items:[]})}finally{running=false}}
    refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('registration-changed',refresh)
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('registration-changed',refresh)}
  },[enabled,userKey])
  return {items:enabled&&snapshot.key===userKey?snapshot.items:[],ready:enabled&&snapshot.key===userKey}
}
