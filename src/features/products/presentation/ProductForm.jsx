import React, { useEffect, useId, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import EditorModal from '../../../components/ui/EditorModal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import RequiredLabel from '../../../presentation/components/forms/RequiredLabel.jsx'

const { EQUIPMENT_CATEGORIES, EQUIPMENT_KINDS } = schema
const photoTypes = ['image/jpeg', 'image/png', 'image/webp']

export function editableFields(product) {
  return {
    category: product.category, kind: product.kind, brand: product.brand || '', model: product.model || '',
    description: product.description || '', source: product.source || '', active: product.active,
  }
}

export function ReferencePhoto({ image, model, caption, large = false }) {
  const [failed, setFailed] = useState('')
  return <span className={large ? 'products-photo products-photo-large' : 'products-photo'}>
    {image && failed !== image
      ? <img src={image} loading={large ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer"
        alt={`${caption || 'Foto de referencia'} de ${model || 'producto'}`} onError={() => setFailed(image)} />
      : <span>{large ? 'Imagen no disponible' : 'Sin foto'}</span>}
  </span>
}

export default function ProductForm({ initial, isNew, brands, onSave, onClose }) {
  const [original] = useState(() => editableFields(initial))
  const [form, setForm] = useState(original)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const brandListId = useId(), photoHintId = useId()
  const dirty = Boolean(file) || Object.keys(form).some(key => form[key] !== original[key])
  useEffect(() => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.onerror = () => setError('No se pudo leer la foto. Volvé a seleccionarla.')
    reader.readAsDataURL(file)
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort() }
  }, [file])

  function change(key, value) {
    setForm(current => ({ ...current, [key]: value }))
    setError('')
  }
  function changePhoto(event) {
    const selected = event.target.files[0]
    setPreview('')
    setError('')
    if (selected && (!photoTypes.includes(selected.type) || selected.size > 3 * 1024 * 1024 || !selected.size)) {
      setError('Seleccioná una foto JPG, PNG o WebP de hasta 3 MB.')
      event.target.value = ''
      setFile(null)
      return
    }
    setFile(selected || null)
  }
  async function submit(event) {
    event.preventDefault()
    if (busy || (file && !preview)) return
    setError('')
    if (!form.model.trim() || (!form.brand.trim() && (isNew || initial.brand))) {
      setError('Completá la marca y el modelo del producto.')
      return
    }
    if (form.source.trim() && !/^https?:\/\//i.test(form.source.trim())) {
      setError('Ingresá un enlace a la ficha del producto que comience con https:// o http://.')
      return
    }
    if (isNew && !file) { setError('Seleccioná una foto de referencia para el nuevo producto.'); return }
    setBusy(true)
    try {
      const product = { ...form, brand: form.brand.trim(), model: form.model.trim(), description: form.description.trim(), source: form.source.trim() }
      const photo = file ? { mimeType: file.type, contentBase64: preview.split(',')[1] } : null
      await onSave({ id: initial.id, expectedVersion: initial.version, product, ...(photo && { photo }) })
    } catch (cause) {
      setError(cause.message || 'No se pudo guardar el producto.')
    } finally {
      setBusy(false)
    }
  }
  return <EditorModal active title={isNew ? 'Nuevo producto' : 'Editar producto'} eyebrow="PRODUCTOS" dirty={dirty} busy={busy} onClose={onClose}>
    {({ requestClose }) => <form className="products-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label><RequiredLabel>Categoría</RequiredLabel>
          <select value={form.category} required onChange={event => {
            const category = event.target.value
            setForm(current => ({ ...current, category, kind: Object.keys(EQUIPMENT_KINDS[category])[0] }))
            setError('')
          }}>{Object.entries(EQUIPMENT_CATEGORIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </label>
        <label><RequiredLabel>Tipo de equipo</RequiredLabel>
          <select value={form.kind} required onChange={event => change('kind', event.target.value)}>
            {Object.entries(EQUIPMENT_KINDS[form.category]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label><RequiredLabel required={Boolean(isNew || initial.brand)}>Marca</RequiredLabel>
          <input list={brandListId} value={form.brand} maxLength={100} required={Boolean(isNew || initial.brand)}
            onChange={event => change('brand', event.target.value)} />
        </label>
        <datalist id={brandListId}>{brands.map(brand => <option key={brand} value={brand} />)}</datalist>
        <label><RequiredLabel>Modelo</RequiredLabel>
          <input value={form.model} maxLength={100} required onChange={event => change('model', event.target.value)} />
        </label>
        <label className="products-wide">Descripción
          <textarea rows="2" maxLength={2000} value={form.description} onChange={event => change('description', event.target.value)} />
        </label>
        <label className="products-wide">Enlace a la ficha del producto
          <input type="url" placeholder="https://" maxLength={2048} value={form.source} onChange={event => change('source', event.target.value)} />
        </label>
        <div className="products-file-field products-wide">
          <label><RequiredLabel required={isNew}>{isNew ? 'Foto de referencia' : 'Reemplazar foto de referencia'}</RequiredLabel>
            <input type="file" required={isNew} accept={photoTypes.join(',')} aria-describedby={photoHintId} onChange={changePhoto} />
          </label>
          <small id={photoHintId}>JPG, PNG o WebP. Hasta 3 MB.</small>
          {(preview || initial.image) && <ReferencePhoto large image={preview || initial.image} model={form.model} caption={preview ? '' : initial.caption} />}
        </div>
      </fieldset>
      {error && <p className="products-error" role="alert">{error}</p>}
      <div className="products-form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={requestClose}>Cancelar</button>
        <button type="submit" className="primary" disabled={busy || !dirty || (file && !preview)}><Icon name="check" size={16} />{busy ? 'Guardando…' : 'Guardar producto'}</button>
      </div>
    </form>}
  </EditorModal>
}
