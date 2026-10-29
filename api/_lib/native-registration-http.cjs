function headers(req,res) {
  res.setHeader('Cache-Control','no-store, private')
  res.setHeader('Referrer-Policy','no-referrer')
  if(req.method==='POST'&&req.headers.origin) {
    let host
    try {host=new URL(req.headers.origin).host}catch{}
    if(host!==req.headers.host)throw Object.assign(new Error('Origen no permitido.'),{statusCode:403})
  }
  if(Number(req.headers['content-length'])>40000)throw Object.assign(new Error('Formulario demasiado extenso.'),{statusCode:413})
}
const errorBody=error=>({error:error.statusCode?error.message:'No se pudo procesar el formulario. Volvé a intentar.',...(error.fields?{fields:error.fields}:{})})
module.exports={headers,errorBody}
