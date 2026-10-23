// La ruta estática permite a Vercel incluir el paquete generado en la función.
// Si falta en producción, fallar evita usar una variante incompatible o insegura.
module.exports = process.env.VERCEL
  ? require('../_vendor/sanitize-html.cjs')
  : require('sanitize-html')
