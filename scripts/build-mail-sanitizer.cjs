const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const outputDirectory = path.join(root, 'api', '_vendor')
const outputPath = path.join(outputDirectory, 'sanitize-html.cjs')

function packageForFile(file) {
  let directory = path.dirname(file)
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json')
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      if (pkg.name && pkg.version) return { directory, pkg }
    }
    directory = path.dirname(directory)
  }
  return null
}

function buildMailSanitizer() {
  // Vercel desactiva require(ESM) en su runtime CommonJS. Se conserva la
  // biblioteca actualizada y se empaqueta su grafo ESM antes del despliegue.
  const result = buildSync({
    absWorkingDir: root,
    entryPoints: [require.resolve('sanitize-html')],
    outfile: outputPath,
    platform: 'node', format: 'cjs', target: 'node22', bundle: true,
    write: false, metafile: true, legalComments: 'eof', logLevel: 'silent',
    banner: { js: '// Generado por scripts/build-mail-sanitizer.cjs. No editar.' }
  })
  const packages = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    const info = packageForFile(path.resolve(root, input))
    if (info) packages.set(`${info.pkg.name}@${info.pkg.version}`, info)
  }
  const notices = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, { directory, pkg }]) => {
    const licenses = fs.readdirSync(directory).filter(file => /^(?:licen[cs]e|copying)(?:\.|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile())
    return [name, `Licencia declarada: ${pkg.license || 'Consultar paquete original'}`, ...licenses.map(file => fs.readFileSync(path.join(directory, file), 'utf8'))].join('\n\n')
  })
  fs.mkdirSync(outputDirectory, { recursive: true })
  fs.writeFileSync(outputPath, result.outputFiles[0].contents)
  fs.writeFileSync(path.join(outputDirectory, 'sanitize-html.LICENSE.txt'), notices.join('\n\n--------------------\n\n') + '\n')
  return { outputPath, bytes: result.outputFiles[0].contents.length }
}

if (require.main === module) {
  try {
    const result = buildMailSanitizer()
    console.log(`Sanitizador de correo compatible con Vercel generado (${result.bytes} bytes).`)
  } catch (error) {
    console.error(`No se pudo preparar el sanitizador de correo: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { buildMailSanitizer, outputPath }
