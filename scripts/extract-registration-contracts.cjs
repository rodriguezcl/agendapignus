// Source: user-supplied raster PDFs, visually checked on 2026-10-28.
// Reads local OCR only; never copies filled responses or PDF metadata.
const fs=require('node:fs')
const contracts={version:'2026-10-28',texts:{}}
for(const kind of ['docta','nobu','residencial']) {
  let text=fs.readFileSync(`tmp/pdfs/${kind}-contract-ocr.txt`,'utf8')
  text=text.slice(text.indexOf('De mi mayor consideración.'),text.indexOf('Se ha registrado'))
  text=text.split(/\r?\n/).filter(line=>!/^--- PAGE|^28\/10\/26|^Alta de Servicio|^Docta Urbanización$|^https:|^\d+\/\d+$/.test(line.trim())).join('\n')
  text=text.replace(/\bAGNUS\b|PIGNIJS/g,'PIGNUS').replace(/\bEI\b/g,'El').replace(/\beI\b/g,'el').replace(/únicarnente/g,'únicamente').replace(/\b10 (?=que|adquiriré|cual|entienda)/g,'lo ').replace(/\na persona o entidad/g,'\nla persona o entidad').replace(/\nos Tribunales/g,'\nlos Tribunales').replace(/(\d\.\d) \./g,'$1.')
  text=text.replace(/\n(?=\d+(?:\.\d+\.| - ))/g,'\n\n').replace(/(?<!\n)\n(?!\n)/g,' ').trim()
  if(!text.endsWith('aceptación por parte de PIGNUS.'))throw new Error('Incomplete contract')
  if(/@|https:|respuesta=/.test(text))throw new Error('Personal metadata in contract')
  contracts.texts[kind==='nobu'?'nobu-town':kind]=text
}
fs.mkdirSync('shared/registration',{recursive:true})
fs.writeFileSync('shared/registration/contracts.json',JSON.stringify(contracts,null,2)+'\n')
