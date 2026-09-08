import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Package, PackageMinus, Plus, RefreshCw, Search, X } from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { sanitizeDecimal } from '../utils/inputValidation'
import { adjustStock, fetchMenuItemOptions, fetchStockItems, upsertStock } from '../services/opsInventoryService'
import TablePagination from '../components/TablePagination'

const TABLE_PAGE_SIZE = 10

const EMPTY_FORM = {
  id: '', menuItemId: '', quantity: 0, minStockLevel: 0, highStockLevel: 0,
  unit: 'piece', sku: '', supplier: '', notes: '', costPerUnit: '', expirationDate: '',
}

function stockState(item) {
  if (item.quantity <= 0) return 'out'
  if (item.minStockLevel > 0 && item.quantity <= item.minStockLevel) return 'low'
  return 'healthy'
}

const STATUS = {
  out: { label: 'Out of stock', className: 'is-out' },
  low: { label: 'Low stock', className: 'is-low' },
  healthy: { label: 'Healthy', className: 'is-healthy' },
}

function formatQuantity(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

export default function InventoryStockPage({ role = 'admin' }) {
  const [items, setItems] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(null)
  const [adjustment, setAdjustment] = useState(null)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [page, setPage] = useState(1)

  const load = async () => {
    setLoading(true)
    try {
      const [stock, options] = await Promise.all([fetchStockItems(), fetchMenuItemOptions()])
      setItems(stock)
      setMenuItems(options)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load stock.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (query && !item.name.toLowerCase().includes(query)) return false
      if (statusFilter !== 'all' && stockState(item) !== statusFilter) return false
      return true
    })
  }, [items, search, statusFilter])

  const summary = useMemo(() => ({
    total: items.length,
    low: items.filter((item) => stockState(item) === 'low').length,
    out: items.filter((item) => stockState(item) === 'out').length,
  }), [items])
  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE))
  const pagedItems = useMemo(() => filtered.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE), [filtered, page])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const openNew = () => setForm({ ...EMPTY_FORM, menuItemId: menuItems[0]?.id || '' })
  const openEdit = (item) => setForm({
    ...EMPTY_FORM,
    id: item.id,
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    minStockLevel: item.minStockLevel,
    highStockLevel: item.highStockLevel,
    unit: item.unit,
    sku: item.sku,
    supplier: item.supplier,
    notes: item.notes,
    costPerUnit: item.costPerUnit ?? '',
    expirationDate: item.expirationDate,
  })

  const save = async (event) => {
    event.preventDefault()
    if (!form?.menuItemId || saving) return
    setSaving(true)
    try {
      await upsertStock(form)
      setForm(null)
      setNotice('Stock record saved.')
      await load()
    } catch (cause) {
      setError(describeError(cause, 'Could not save stock.'))
    } finally {
      setSaving(false)
    }
  }

  const requestRemoval = (event) => {
    event.preventDefault()
    if (!adjustment || saving) return
    const amount = Number(adjustment.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(adjustment.current)) {
      setError(`Enter an amount from 0.01 to ${formatQuantity(adjustment.current)}.`)
      return
    }
    setError('')
    setRemoveConfirmOpen(true)
  }

  const confirmRemoval = async () => {
    if (!adjustment || saving) return
    setSaving(true)
    try {
      await adjustStock(adjustment.id, -Number(adjustment.amount), adjustment.reason || 'Stock removed')
      setRemoveConfirmOpen(false)
      setAdjustment(null)
      setForm(null)
      setNotice(`${formatQuantity(adjustment.amount)} ${adjustment.unit} removed from ${adjustment.name}.`)
      await load()
    } catch (cause) {
      setRemoveConfirmOpen(false)
      setError(describeError(cause, 'Could not remove stock.'))
    } finally {
      setSaving(false)
    }
  }

  return <AppShell role={role} title="Stock Management" eyebrow="Track sellable item quantities and low-stock indicators." onRefresh={load}>
    <section className="stock-page">
      <div className="hm-dashboard-summary stock-summary" aria-label="Stock summary">
        <article><small>Tracked items</small><strong>{summary.total}</strong><p>Inventory records</p></article>
        <article><small>Low stock</small><strong>{summary.low}</strong><p>Needs replenishment</p></article>
        <article><small>Out of stock</small><strong>{summary.out}</strong><p>Unavailable items</p></article>
      </div>
      {notice && <div className="stock-notice" role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
      {error && <div className="stock-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => { setError(''); load() }}><RefreshCw size={15} /> Try again</button></div>}
      <section className="stock-panel" aria-label="Stock records">
        <div className="stock-toolbar"><label className="stock-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu item" aria-label="Search stock" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter stock status"><option value="all">All stock states</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="healthy">Healthy</option></select><button type="button" className="stock-add-button" onClick={openNew}><Plus size={16} /> Add stock</button></div>
        {loading ? <div className="stock-empty">Loading stock…</div> : filtered.length === 0 ? <div className="stock-empty"><Package size={28} /><b>No stock records found</b><span>Add a stock record to connect a menu item to quantity tracking.</span></div> : <><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>Menu item</th><th>On hand</th><th>Low stock at</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>{pagedItems.map((item) => { const status = STATUS[stockState(item)]; return <tr key={item.id}><td><b>{item.name}</b><small>{item.unit}</small></td><td><strong>{formatQuantity(item.quantity)}</strong> {item.unit}</td><td>{formatQuantity(item.minStockLevel)} {item.unit}</td><td><span className={`stock-status ${status.className}`}>{status.label}</span></td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('en-PH') : '—'}</td><td><div className="stock-actions"><button type="button" className="stock-edit-button" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`}>Edit</button></div></td></tr> })}</tbody></table></div><TablePagination page={page} pageSize={TABLE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} label="stock records"/></>}
      </section>
    </section>
    {form && <Modal title={form.id ? 'Edit stock record' : 'Add stock record'} onClose={() => !saving && setForm(null)}><form onSubmit={save} className="stock-form"><label>Menu item<select required value={form.menuItemId} onChange={(event) => setForm((current) => ({ ...current, menuItemId: event.target.value }))} disabled={Boolean(form.id)}><option value="">Select a menu item</option>{menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="stock-form-grid"><label>Quantity<input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: sanitizeDecimal(event.target.value) }))} /></label><label>Low stock indicator<input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" min="0" step="0.01" value={form.minStockLevel} onChange={(event) => setForm((current) => ({ ...current, minStockLevel: sanitizeDecimal(event.target.value) }))} /></label><label>Healthy level<input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" min="0" step="0.01" value={form.highStockLevel} onChange={(event) => setForm((current) => ({ ...current, highStockLevel: sanitizeDecimal(event.target.value) }))} /></label><label>Unit<input maxLength="20" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} /></label></div><label>Notes<textarea rows="3" maxLength="500" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label><ModalActions saving={saving} onClose={() => setForm(null)} onRemove={form.id ? () => setAdjustment({ id: form.id, name: menuItems.find((item) => item.id === form.menuItemId)?.name || 'this item', current: Number(form.quantity), unit: form.unit || 'piece', amount: '', reason: '' }) : null} /></form></Modal>}
    {adjustment && !removeConfirmOpen && <Modal title={`Remove stock from ${adjustment.name}`} onClose={() => !saving && setAdjustment(null)}><form onSubmit={requestRemoval} className="stock-form"><p className="stock-adjustment-copy">Available stock: <b>{formatQuantity(adjustment.current)} {adjustment.unit}</b>. Enter how much should be deducted.</p><label>Amount to remove<input required type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" min="0.01" max={adjustment.current} step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: sanitizeDecimal(event.target.value) }))} autoFocus /></label><label>Reason<input required maxLength="160" value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} placeholder="Waste, damage, count correction…" /></label><footer className="stock-modal-actions"><button type="button" className="secondary-button" onClick={() => setAdjustment(null)}>Cancel</button><button type="submit" className="danger-button"><PackageMinus size={16}/>Continue</button></footer></form></Modal>}
    {adjustment && removeConfirmOpen && <ConfirmRemoval adjustment={adjustment} saving={saving} onCancel={() => setRemoveConfirmOpen(false)} onConfirm={confirmRemoval}/>}
  </AppShell>
}

function Modal({ title, onClose, children }) {
  return <div className="stock-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-modal-title"><header><div><span className="eyebrow">Stock</span><h2 id="stock-modal-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>{children}</section></div>
}

function ModalActions({ saving, onClose, onRemove }) {
  return <footer className="stock-modal-actions">{onRemove && <button type="button" className="danger-button stock-remove-button" onClick={onRemove} disabled={saving}><PackageMinus size={16}/>Remove stock</button>}<span className="stock-modal-action-group"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></span></footer>
}

function ConfirmRemoval({ adjustment, saving, onCancel, onConfirm }) {
  return <div className="stock-modal-backdrop stock-confirm-backdrop" role="presentation"><section className="stock-confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="stock-remove-confirm-title" aria-describedby="stock-remove-confirm-copy"><span className="stock-confirm-icon"><AlertTriangle size={21}/></span><h2 id="stock-remove-confirm-title">Remove this stock?</h2><p id="stock-remove-confirm-copy">This will deduct <b>{formatQuantity(adjustment.amount)} {adjustment.unit}</b> from <b>{adjustment.name}</b>.</p><div><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Go back</button><button type="button" className="danger-button" onClick={onConfirm} disabled={saving}>{saving ? 'Removing…' : 'Yes, remove stock'}</button></div></section></div>
}
