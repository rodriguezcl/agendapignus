import React, { useMemo, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import EditorModal from '../../../components/ui/EditorModal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { sortOptionsAlphabetically } from '../../../domain/shared/catalog-order.mjs'
import { normalizeSearchText } from '../../../domain/shared/normalization.mjs'
import { useProductCatalog } from '../application/useProductCatalog.mjs'
import ProductForm, { editableFields, ReferencePhoto } from './ProductForm.jsx'
import './products.css'

const { EQUIPMENT_CATEGORIES, EQUIPMENT_KINDS } = schema
const defaultFilters = { search: '', category: '', brand: '', state: 'active' }
const kindLabel = product => EQUIPMENT_KINDS[product.category]?.[product.kind] || product.kind

function ProductState({ active }) {
  return <span className={active ? 'products-state products-state-active' : 'products-state'}>{active ? 'Activo' : 'De baja'}</span>
}

function ProductDetails({ product, onClose }) {
  return <EditorModal active title={product.model} eyebrow="FICHA DE PRODUCTO" onClose={onClose}>
    <div className="products-details">
      <div>
        <ReferencePhoto large image={product.image} model={product.model} caption={product.caption} />
        {product.caption && <small>{product.caption}</small>}
      </div>
      <dl>
        <dt>Marca</dt><dd>{product.brand || 'Sin especificar'}</dd>
        <dt>Categoría</dt><dd>{EQUIPMENT_CATEGORIES[product.category]}</dd>
        <dt>Tipo de equipo</dt><dd>{kindLabel(product)}</dd>
        <dt>Estado</dt><dd><ProductState active={product.active} /></dd>
      </dl>
      {product.description && <p className="products-detail-description">{product.description}</p>}
      {/^https?:\/\//i.test(product.source || '') && <a href={product.source} target="_blank" rel="noreferrer">Abrir ficha del fabricante o proveedor</a>}
    </div>
  </EditorModal>
}

function StatusDialog({ product, onSave, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const action = product.active ? 'Dar de baja' : 'Reactivar'
  async function changeStatus() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSave({ id: product.id, expectedVersion: product.version, product: { ...editableFields(product), active: !product.active } })
    } catch (cause) {
      setError(cause.message || 'No se pudo actualizar el estado del producto.')
    } finally {
      setBusy(false)
    }
  }
  return <EditorModal active title={`${action} producto`} eyebrow="PRODUCTOS" onClose={onClose} busy={busy}>
    <div className="products-status-dialog">
      <p><strong>{product.brand} {product.model}</strong></p>
      <p>{product.active
        ? 'El modelo dejará de ofrecerse para nuevas cargas. Las fichas técnicas y los planos donde ya se utilizó conservan el equipo.'
        : 'El modelo volverá a estar disponible para cargar equipos en las fichas técnicas y los planos.'}</p>
      {error && <p className="products-error" role="alert">{error}</p>}
      <div className="products-form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className={product.active ? 'danger-button' : 'primary'} disabled={busy} onClick={changeStatus}>
          {busy ? 'Guardando…' : action}
        </button>
      </div>
    </div>
  </EditorModal>
}

function ProductsPagination({ total, page, size, onPage, onSize }) {
  const last = Math.ceil(total / size)
  return <nav className="accounts-pagination products-pagination" aria-label="Páginas de productos">
    <label className="pagination-size">Mostrar <select value={size} aria-label="Productos por página" onChange={event => onSize(Number(event.target.value))}>
      {[20, 50, 100].map(number => <option key={number} value={number}>{number}</option>)}
    </select> productos</label>
    <span className="pagination-summary" aria-live="polite">{(page - 1) * size + 1}–{Math.min(page * size, total)} de {total}</span>
    <div className="pagination-controls">
      <button type="button" className="secondary" disabled={page === 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Página {page} de {last}</span>
      <button type="button" className="secondary" disabled={page >= last} onClick={() => onPage(page + 1)}>Siguiente</button>
    </div>
  </nav>
}

export default function Products() {
  const { products, loading, error, refresh, canManage, saveProduct } = useProductCatalog()
  const [filters, setFilters] = useState(defaultFilters)
  const [page, setPage] = useState(1), [size, setSize] = useState(20)
  const [dialog, setDialog] = useState(null), [notice, setNotice] = useState('')
  const brands = useMemo(() => sortOptionsAlphabetically([...new Set(products.map(product => product.brand).filter(Boolean))]), [products])
  const index = useMemo(() => sortOptionsAlphabetically(products, product => `${product.brand} ${product.model}`).map(product => ({
    product, searchable: normalizeSearchText([product.brand, product.model, product.description, EQUIPMENT_CATEGORIES[product.category], kindLabel(product)].join(' ')),
  })), [products])
  const matches = useMemo(() => {
    const words = filters.search.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)
    return index.filter(({ product, searchable }) =>
      (!filters.category || product.category === filters.category) && (!filters.brand || product.brand === filters.brand) &&
      (filters.state === 'all' || product.active === (filters.state === 'active')) && words.every(word => searchable.includes(word)))
  }, [filters, index])
  const current = Math.min(page, Math.max(1, Math.ceil(matches.length / size)))
  const visible = matches.slice((current - 1) * size, current * size)
  const authorized = canManage && !error

  function filter(key, value) {
    setFilters(previous => ({ ...previous, [key]: value }))
    setPage(1)
  }
  function openDialog(action, product) {
    setNotice('')
    setDialog({ action, product })
  }
  function newProduct() {
    const category = filters.category || 'cctv'
    openDialog('create', { id: 'custom:' + crypto.randomUUID(), category, kind: Object.keys(EQUIPMENT_KINDS[category])[0],
      brand: filters.brand, model: '', active: true, version: 0 })
  }
  async function save(command) {
    await saveProduct(command)
    if (dialog.action === 'create') {
      setFilters({ ...defaultFilters, search: command.product.model })
      setPage(1)
    }
    const message = dialog.action === 'status' ? (command.product.active ? 'Producto reactivado.' : 'Producto dado de baja.') : 'Producto guardado.'
    setNotice(message)
    setDialog(null)
  }
  const close = () => setDialog(null)
  return <section className="products-module" aria-label="Catálogo de productos">
    <ModuleIntroduction><p>Catálogo de equipos para la ficha técnica y la planimetría de las cuentas.</p></ModuleIntroduction>
    <div className="products-toolbar">
      <label>Buscar producto<input type="search" placeholder="Marca, modelo o descripción" value={filters.search}
        onChange={event => filter('search', event.target.value)} /></label>
      <label>Categoría<select aria-label="Categoría" value={filters.category} onChange={event => filter('category', event.target.value)}>
        <option value="">Todas</option>{Object.entries(EQUIPMENT_CATEGORIES).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
      </select></label>
      <label>Marca<select aria-label="Marca" value={filters.brand} onChange={event => filter('brand', event.target.value)}>
        <option value="">Todas</option>{brands.map(brand => <option value={brand} key={brand}>{brand}</option>)}
      </select></label>
      <label>Estado<select aria-label="Estado" value={filters.state} onChange={event => filter('state', event.target.value)}>
        <option value="active">Activos</option><option value="inactive">De baja</option><option value="all">Todos</option>
      </select></label>
      {authorized && <button type="button" className="primary" disabled={loading} onClick={newProduct}><Icon name="plus" size={16} />Nuevo producto</button>}
    </div>
    {error ? <div className="products-feedback"><p role="alert" className="products-error">{error.message || String(error)}</p>
      <button type="button" className="secondary" onClick={() => refresh()} disabled={loading}>Volver a intentar</button>
    </div> : loading ? <p role="status">Cargando productos…</p> : <>
      {notice && <p className="products-notice" role="status">{notice}</p>}
      <div className="products-table-wrap" tabIndex={0} role="region" aria-label="Listado de productos">
        <table className="products-table">
          <thead><tr><th scope="col">Producto</th><th scope="col">Marca</th><th scope="col">Categoría y tipo</th><th scope="col">Estado</th>
            {authorized && <th scope="col">Acciones</th>}</tr></thead>
          <tbody>{visible.map(({ product }) => <tr key={product.id}>
            <td><button type="button" className="products-row-detail" onClick={() => openDialog('view', product)} aria-label={`Ver ficha de ${product.brand} ${product.model}`}>
              <ReferencePhoto image={product.image} model={product.model} caption={product.caption} />
              <span><strong>{product.model}</strong>{product.description && <small>{product.description}</small>}</span>
            </button></td>
            <td>{product.brand || 'Sin especificar'}</td>
            <td>{EQUIPMENT_CATEGORIES[product.category]}<small>{kindLabel(product)}</small></td>
            <td><ProductState active={product.active} /></td>
            {authorized && <td><div className="row-actions products-row-actions">
              <button type="button" title="Editar producto" aria-label={`Editar ${product.model}`} onClick={() => openDialog('edit', product)}><Icon name="edit" size={16} /></button>
              <button type="button" title={product.active ? 'Dar de baja' : 'Reactivar'} aria-label={`${product.active ? 'Dar de baja' : 'Reactivar'} ${product.model}`}
                onClick={() => openDialog('status', product)}><Icon name={product.active ? 'pause' : 'play'} size={16} /></button>
            </div></td>}
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="products-no-results" role="status">No se encontraron productos con estos filtros.</p>}
      </div>
      {matches.length > 0 && <ProductsPagination total={matches.length} page={current} size={size} onPage={setPage}
        onSize={number => { setSize(number); setPage(1) }} />}
    </>}
    {dialog?.action === 'view' && <ProductDetails product={dialog.product} onClose={close} />}
    {canManage && (dialog?.action === 'edit' || dialog?.action === 'create') &&
      <ProductForm key={dialog.product.id} initial={dialog.product} isNew={dialog.action === 'create'} brands={brands} onClose={close} onSave={save} />}
    {canManage && dialog?.action === 'status' && <StatusDialog product={dialog.product} onSave={save} onClose={close} />}
  </section>
}
