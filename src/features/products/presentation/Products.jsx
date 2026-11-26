import React, { useMemo, useState } from 'react'
import schema from '../../../../shared/cctv-schema.cjs'
import ModuleIntroduction from '../../../components/ModuleIntroduction.jsx'
import EditorModal from '../../../components/ui/EditorModal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { useProductCatalog } from '../application/useProductCatalog.mjs'
import { productName, productType } from '../domain/product-name.mjs'
import { indexProducts, productBrands, productSearchWords } from '../domain/product-search.mjs'
import ProductForm, { editableFields, ReferencePhoto } from './ProductForm.jsx'
import './products.css'

const { EQUIPMENT_CATEGORIES, EQUIPMENT_KINDS } = schema
const defaultFilters = { search: '', category: '', brand: '', state: 'active' }

function ProductState({ active }) {
  return <span className={active ? 'products-state products-state-active' : 'products-state'}>{active ? 'Activo' : 'De baja'}</span>
}

function ProductDetails({ product, onClose }) {
  return <EditorModal active title="Ficha de producto" eyebrow="PRODUCTOS" onClose={onClose}>
    <div className="products-details">
      <div>
        <ReferencePhoto large image={product.image} model={product.model} caption={product.caption} />
        {product.caption && <small>{product.caption}</small>}
      </div>
      <dl>
        <dt>Código</dt><dd>{product.model}</dd>
        <dt>Nombre</dt><dd>{productName(product)}</dd>
        <dt>Categoría</dt><dd>{EQUIPMENT_CATEGORIES[product.category]}</dd>
        <dt>Familia del catálogo</dt><dd>{productType(product)}</dd>
        <dt>Estado</dt><dd><ProductState active={product.active} /></dd>
      </dl>
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
      <p><strong>{product.model}</strong><br />{productName(product)}</p>
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
  const brands = useMemo(() => productBrands(products, filters.category), [products, filters.category])
  const index = useMemo(() => indexProducts(products), [products])
  const matches = useMemo(() => {
    const words = productSearchWords(filters.search)
    return index.filter(({ product, searchable }) =>
      (!filters.category || product.category === filters.category) && (!filters.brand || product.brand === filters.brand) &&
      (filters.state === 'all' || product.active === (filters.state === 'active')) && words.every(word => searchable.includes(word)))
  }, [filters, index])
  const current = Math.min(page, Math.max(1, Math.ceil(matches.length / size)))
  const visible = matches.slice((current - 1) * size, current * size)
  const authorized = canManage && !error

  // A category change or a catalog edit can remove the selected brand.
  if (filters.brand && !brands.includes(filters.brand)) {
    setFilters({ ...filters, brand: '' })
    setPage(1)
  }

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
      <label>Buscar producto<input type="search" placeholder="Código, nombre o características" value={filters.search}
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
          <thead><tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Categoría</th><th scope="col">Estado</th>
            {authorized && <th scope="col">Acciones</th>}</tr></thead>
          <tbody>{visible.map(({ product, name }) => <tr key={product.id}>
            <td className="products-code">{product.model}</td>
            <td><button type="button" className="products-row-detail" onClick={() => openDialog('view', product)} aria-label={`Ver ficha de ${name} (${product.model})`}>
              <ReferencePhoto image={product.image} model={product.model} caption={product.caption} />
              <strong>{name}</strong>
            </button></td>
            <td>{EQUIPMENT_CATEGORIES[product.category]}</td>
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
      <ProductForm key={dialog.product.id} initial={dialog.product} isNew={dialog.action === 'create'} brands={productBrands(products)} onClose={close} onSave={save} />}
    {canManage && dialog?.action === 'status' && <StatusDialog product={dialog.product} onSave={save} onClose={close} />}
  </section>
}
