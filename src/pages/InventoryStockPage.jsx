import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Package, PackageX, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { adjustStock, fetchMenuItemOptions, fetchStockItems, upsertStock } from '../services/opsInventoryService'

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

  const submitAdjustment = async (event) => {
    event.preventDefault()
    if (!adjustment || saving) return
    const delta = Number(adjustment.delta)
    if (!Number.isFinite(delta) || delta === 0) return
    setSaving(true)
    try {
      await adjustStock(adjustment.id, delta, adjustment.reason)
      setAdjustment(null)
      setNotice('Stock quantity adjusted.')
      await load()
    } catch (cause) {
      setError(describeError(cause, 'Could not adjust stock.'))
    } finally {
      setSaving(false)
    }
  }

  return <AppShell role={role} title="Stock Management" eyebrow="Track sellable item quantities and low-stock indicators." onRefresh={load}>
    <section className="stock-page">
      <div className="stock-summary" aria-label="Stock summary">
        <div><Package size={18} /><span><b>{summary.total}</b><small>Tracked items</small></span></div>
        <div className="is-warning"><AlertTriangle size={18} /><span><b>{summary.low}</b><small>Low stock</small></span></div>
        <div className="is-danger"><PackageX size={18} /><span><b>{summary.out}</b><small>Out of stock</small></span></div>
      </div>
      {notice && <div className="stock-notice" role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
      {error && <div className="stock-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => { setError(''); load() }}><RefreshCw size={15} /> Try again</button></div>}
      <section className="stock-panel" aria-label="Stock records">
        <div className="stock-toolbar"><label className="stock-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu item" aria-label="Search stock" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter stock status"><option value="all">All stock states</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="healthy">Healthy</option></select><button type="button" className="stock-add-button" onClick={openNew}><Plus size={16} /> Add stock</button></div>
        {loading ? <div className="stock-empty">Loading stock…</div> : filtered.length === 0 ? <div className="stock-empty"><Package size={28} /><b>No stock records found</b><span>Add a stock record to connect a menu item to quantity tracking.</span></div> : <div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>Menu item</th><th>On hand</th><th>Low stock at</th><th>Status</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((item) => { const status = STATUS[stockState(item)]; return <tr key={item.id}><td><b>{item.name}</b><small>{item.unit}</small></td><td><strong>{formatQuantity(item.quantity)}</strong> {item.unit}</td><td>{formatQuantity(item.minStockLevel)} {item.unit}</td><td><span className={`stock-status ${status.className}`}>{status.label}</span></td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('en-PH') : '—'}</td><td><div className="stock-actions"><button type="button" className="icon-button" onClick={() => setAdjustment({ id: item.id, name: item.name, current: item.quantity, delta: '', reason: '' })} aria-label={`Adjust ${item.name}`}><Package size={15} /></button><button type="button" className="icon-button" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`}><Pencil size={15} /></button></div></td></tr> })}</tbody></table></div>}
      </section>
    </section>
    {form && <Modal title={form.id ? 'Edit stock record' : 'Add stock record'} onClose={() => !saving && setForm(null)}><form onSubmit={save} className="stock-form"><label>Menu item<select required value={form.menuItemId} onChange={(event) => setForm((current) => ({ ...current, menuItemId: event.target.value }))} disabled={Boolean(form.id)}><option value="">Select a menu item</option>{menuItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="stock-form-grid"><label>Quantity<input type="number" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label><label>Low stock indicator<input type="number" min="0" step="0.01" value={form.minStockLevel} onChange={(event) => setForm((current) => ({ ...current, minStockLevel: event.target.value }))} /></label><label>Healthy level<input type="number" min="0" step="0.01" value={form.highStockLevel} onChange={(event) => setForm((current) => ({ ...current, highStockLevel: event.target.value }))} /></label><label>Unit<input maxLength="20" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} /></label></div><label>Notes<textarea rows="3" maxLength="500" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label><ModalActions saving={saving} onClose={() => setForm(null)} /></form></Modal>}
    {adjustment && <Modal title={`Adjust ${adjustment.name}`} onClose={() => !saving && setAdjustment(null)}><form onSubmit={submitAdjustment} className="stock-form"><p className="stock-adjustment-copy">Current quantity: <b>{formatQuantity(adjustment.current)}</b>. Enter a positive number to add stock or a negative number to remove it.</p><label>Quantity change<input required type="number" step="0.01" value={adjustment.delta} onChange={(event) => setAdjustment((current) => ({ ...current, delta: event.target.value }))} autoFocus /></label><label>Reason<input maxLength="160" value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} placeholder="Restock, count correction, waste…" /></label><ModalActions saving={saving} onClose={() => setAdjustment(null)} /></form></Modal>}
  </AppShell>
}

function Modal({ title, onClose, children }) {
  return <div className="stock-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-modal-title"><header><div><span className="eyebrow">Stock</span><h2 id="stock-modal-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>{children}</section></div>
}

function ModalActions({ saving, onClose }) {
  return <footer className="stock-modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></footer>
}
