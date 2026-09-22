const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { buildSync } = require('esbuild')

test('cancelar jornadas usa modal, conserva el borrador y solo descarta al confirmar', () => {
  const root = path.resolve(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'src/components/ServiceJourneys.jsx'), 'utf8')
  assert.doesNotMatch(source, /window\.confirm\(/)
  const bundle = buildSync({ entryPoints: [path.join(root, 'src/components/ServiceJourneys.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.css': 'empty' } })
  const values = []; let cursor = 0
  const context = { enabled: true, today: '2026-09-21', teamsForDate: () => [] }
  const mock = { ...React, useContext: () => context, useEffect: () => {}, useId: () => 'title', useRef: () => ({ current: null }), useState: initial => {
    const index = cursor++; if (!(index in values)) values[index] = initial
    return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
  } }
  const compiled = new Module(path.join(root, 'test-journey-dialog.cjs'), module)
  compiled.paths = module.paths
  compiled.require = name => name === 'react' ? mock : name === 'react-dom' ? { createPortal: child => child } : require(name)
  compiled._compile('const document = {body:{}};\n' + bundle.outputFiles[0].text, path.join(root, 'test-journey-dialog.cjs'))
  const record = { id:'one',date:'2026-09-24',time:'08:45',teamId:'team',team:'Equipo',estimatedMinutes:150,status:'Pendiente',service:'Instalación' }
  const render = () => { cursor = 0; return compiled.exports.ServiceJourneys({record}) }
  const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : React.isValidElement(node) ? [node, ...flatten(node.props.children)] : []
  const find = (tree, predicate) => flatten(tree).find(predicate)
  const button = (tree, text) => find(tree, node => node.type === 'button' && node.props.children === text)
  const event = {stopPropagation(){},preventDefault(){}}
  let tree = render(); button(tree,'Planificar varias jornadas').props.onClick(event)
  tree = render()
  find(tree,node => node.props['aria-label'] === 'Horas jornada 2').props.onChange({target:{value:'3'}})
  tree = render(); button(tree,'Cancelar').props.onClick()
  tree = render(); assert.ok(find(tree,node => node.props.role === 'alertdialog'))
  assert.ok(find(tree,node => node.type === 'form' && node.props.hidden))
  button(tree,'Seguir editando').props.onClick()
  tree = render(); assert.equal(find(tree,node => node.props['aria-label'] === 'Horas jornada 2').props.value,3)
  find(tree,node => node.props.className === 'modal-layer journey-layer').props.onKeyDown({...event,key:'Escape'})
  tree = render(); assert.ok(button(tree,'Descartar planificación'))
  find(tree,node => node.props.className === 'modal-layer journey-layer').props.onKeyDown({...event,key:'Escape'})
  tree = render(); assert.equal(find(tree,node => node.props['aria-label'] === 'Horas jornada 2').props.value,3)
  button(tree,'Cancelar').props.onClick(); tree=render();button(tree,'Descartar planificación').props.onClick()
  tree=render();assert.equal(find(tree,node=>node.props.role==='dialog'),undefined)
  button(tree,'Planificar varias jornadas').props.onClick(event);tree=render()
  assert.equal(find(tree,node=>node.props['aria-label']==='Horas jornada 2').props.value,1)
})
