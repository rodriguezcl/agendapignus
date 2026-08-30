const test = require('node:test')
const assert = require('node:assert/strict')

test('convierte una foto compatible del teléfono a JPEG compacto', async t => {
  const originalFileReader = global.FileReader
  const originalImage = global.Image
  const originalDocument = global.document
  t.after(() => {
    global.FileReader = originalFileReader
    global.Image = originalImage
    global.document = originalDocument
  })

  global.FileReader = class {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,AAAA`
      this.onload()
    }
  }
  global.Image = class {
    set src(value) {
      this.naturalWidth = 2400
      this.naturalHeight = 1200
      this.onload()
    }
  }
  const drawCalls = []
  global.document = {
    createElement: name => {
      assert.equal(name, 'canvas')
      return {
        width: 0,
        height: 0,
        getContext: context => {
          assert.equal(context, '2d')
          return { drawImage: (...args) => drawCalls.push(args) }
        },
        toDataURL: (type, quality) => {
          assert.equal(type, 'image/jpeg')
          assert.equal(quality, 0.78)
          return 'data:image/jpeg;base64,BBBB'
        }
      }
    }
  }

  const { compactVehiclePhoto } = await import(`../src/image-upload.mjs?success=${Date.now()}`)
  const compact = await compactVehiclePhoto({ type: 'image/heic' })
  assert.equal(compact, 'data:image/jpeg;base64,BBBB')
  assert.equal(drawCalls.length, 1)
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 1280, 640])
})

test('explica cómo continuar si el navegador no puede decodificar el formato', async t => {
  const originalFileReader = global.FileReader
  const originalImage = global.Image
  t.after(() => {
    global.FileReader = originalFileReader
    global.Image = originalImage
  })

  global.FileReader = class {
    readAsDataURL() {
      this.result = 'data:image/heic;base64,AAAA'
      this.onload()
    }
  }
  global.Image = class {
    set src(value) {
      this.onerror()
    }
  }

  const { compactVehiclePhoto } = await import(`../src/image-upload.mjs?failure=${Date.now()}`)
  await assert.rejects(
    compactVehiclePhoto({ type: 'image/heic' }),
    /Probá tomar una foto nueva con la cámara/
  )
})
