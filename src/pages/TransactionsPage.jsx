import { AlertTriangle, Ban, FileSpreadsheet, FileText, Printer, ReceiptText, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import { getAccountDisplayName } from '../lib/accountIdentity'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { exportTransactionsToCsv, exportTransactionsToXlsx, fetchTransactions, voidOrder } from '../services/transactionsService'
import { addCurrentUserNotification } from '../services/notificationCenterService'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import useStoreInfo from '../hooks/useStoreInfo'
import TablePagination from '../components/TablePagination'

const PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer' }
const TABLE_PAGE_SIZE = 10

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character]))
}

function receiptOptions(item) {
  return [
    item.customizations?.variantLabel,
    item.customizations?.temperature,
    item.customizations?.sugarLevel,
    item.customizations?.iceLevel,
    ...(item.addons || []).map((addon) => addon.name || addon),
  ].filter(Boolean)
}

function receiptPaymentRows(transaction) {
  if (transaction.paymentMethod === 'gcash') {
    return [
      ['Payment Reference Number', transaction.paymentReference],
    ].filter((row) => row[1])
  }
  if (transaction.paymentMethod === 'bank_transfer') {
    return [
      ['Bank Name', transaction.bankName],
      ['Payment Reference Number', transaction.paymentReference],
    ].filter((row) => row[1])
  }
  return [
    ['Cash Received', Number(transaction.amountReceived || transaction.finalTotal || 0).toFixed(2)],
    ['Change', Number(transaction.changeAmount || 0).toFixed(2)],
  ]
}

function printReceipt(transaction, receiptStore) {
  const printWindow = window.open('', '_blank', 'width=440,height=760')
  if (!printWindow) return
  const itemCount = (transaction.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const itemRows = (transaction.items || []).map((item) => {
    const options = receiptOptions(item)
    return `<div class="receipt-item"><div>${escapeHtml(item.quantity)}</div><div class="receipt-item-name">${escapeHtml(item.name || 'Menu item')}${options.map((option) => `<div class="receipt-option">+ ${escapeHtml(option)}</div>`).join('')}${item.isDiscounted ? `<div class="receipt-option">+ ${escapeHtml(transaction.discountType || 'Discount')} discount applied</div>` : ''}</div><div class="receipt-item-price">${Number(item.lineTotal || 0).toFixed(2)}</div></div>`
  }).join('')
  const paymentRows = receiptPaymentRows(transaction).map(([label, value]) => `<div class="receipt-row"><span class="receipt-label">${escapeHtml(label)}:</span><span class="receipt-value">${escapeHtml(value)}</span></div>`).join('')
  const storeName = receiptStore.name || 'HM POS'
  const initials = storeName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const logo = receiptStore.logoUrl ? `<img class="receipt-logo" src="${escapeHtml(receiptStore.logoUrl)}" alt="">` : `<span class="receipt-logo receipt-logo-text">${escapeHtml(initials)}</span>`
  const discountRow = transaction.discountAmount > 0 ? `<div class="receipt-total-row"><span>Discount:</span><span>-${Number(transaction.discountAmount).toFixed(2)}</span></div>` : ''
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(transaction.receiptNumber)}</title><style>
    *{box-sizing:border-box}body{margin:0;padding:22px;background:#fff;color:#000;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.45}.receipt-print-area{width:300px;max-width:100%;min-width:260px;margin:0 auto;padding:8px 10px;background:#fff;color:#000}.receipt-print-area *{box-sizing:border-box;font-family:inherit;white-space:normal;word-break:normal;overflow-wrap:break-word}.receipt-logo{width:42px;height:42px;max-width:42px;max-height:42px;object-fit:contain;display:block;margin:0 auto 4px}.receipt-logo-text{display:grid;place-items:center;font-size:24px;font-weight:800;color:#542475}.receipt-header,.receipt-footer{text-align:center}.receipt-store-name{font-size:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase}.receipt-store-info{font-size:10px;line-height:1.25}.receipt-line{border-top:1px dashed #000;margin:6px 0;width:100%}.receipt-row,.receipt-total-row{display:flex;justify-content:space-between;gap:8px;width:100%;align-items:flex-start}.receipt-label{flex:0 0 112px;min-width:112px;text-align:left}.receipt-value{flex:1 1 auto;min-width:0;text-align:right}.receipt-table-header,.receipt-item{display:grid;grid-template-columns:24px minmax(0,1fr) 58px;gap:4px;width:100%;max-width:100%}.receipt-table-header{font-weight:800}.receipt-item-name{min-width:0}.receipt-item-price{text-align:right;white-space:nowrap}.receipt-option{grid-column:2 / 4;padding-left:0;font-size:10px}.receipt-grand-total{font-size:14px;font-weight:900}.receipt-footer{margin-top:8px;font-size:10px}@media print{body{padding:0}.receipt-print-area{position:absolute;left:0;top:0;width:80mm;max-width:80mm;min-width:80mm;margin:0}}
  </style></head><body>
    <div class="receipt-print-area"><div class="receipt-header">${logo}<div class="receipt-store-name">${escapeHtml(storeName)}</div>${receiptStore.address ? `<div class="receipt-store-info">${escapeHtml(receiptStore.address)}</div>` : ''}${receiptStore.email ? `<div class="receipt-store-info">${escapeHtml(receiptStore.email)}</div>` : ''}${receiptStore.phone ? `<div class="receipt-store-info">${escapeHtml(receiptStore.phone)}</div>` : ''}</div>
    <div class="receipt-line"></div><div class="receipt-row"><span class="receipt-label">Order #:</span><span class="receipt-value">${escapeHtml(transaction.orderNumber)}</span></div><div class="receipt-row"><span class="receipt-label">Reference #:</span><span class="receipt-value">${escapeHtml(transaction.receiptNumber || 'N/A')}</span></div><div class="receipt-row"><span class="receipt-label">Date:</span><span class="receipt-value">${escapeHtml(formatDateTime(transaction.createdAt))}</span></div><div class="receipt-row"><span class="receipt-label">Type:</span><span class="receipt-value">Walk-in</span></div><div class="receipt-row"><span class="receipt-label">Cashier:</span><span class="receipt-value">${escapeHtml(transaction.cashierName || 'Cashier')}</span></div><div class="receipt-line"></div><div class="receipt-table-header"><div>QTY</div><div>ITEM</div><div>PRICE</div></div><div class="receipt-line"></div><div class="receipt-items">${itemRows}</div><div class="receipt-line"></div><div class="receipt-total-row"><span>Subtotal:</span><span>${Number(transaction.subtotal || 0).toFixed(2)}</span></div>${discountRow}<div class="receipt-total-row"><span>TOTAL:</span><span class="receipt-grand-total">${Number(transaction.finalTotal || 0).toFixed(2)}</span></div><div class="receipt-line"></div><div class="receipt-row"><span class="receipt-label">Payment Method:</span><span class="receipt-value">${escapeHtml(PAYMENT_LABELS[transaction.paymentMethod] || transaction.paymentMethod || 'Not recorded')}</span></div>${paymentRows}<div class="receipt-line"></div><div class="receipt-row"><span class="receipt-label">Items:</span><span class="receipt-value">${itemCount}</span></div><div class="receipt-line"></div><div class="receipt-footer">Thank you for choosing ${escapeHtml(storeName)},<br>Have a great day!</div><div class="receipt-line"></div></div>
  </body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

export default function TransactionsPage() {
  const { profile, user } = useAuth()
  const receiptStore = useStoreInfo()
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [status, setStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [savingVoid, setSavingVoid] = useState(false)
  const [exporting, setExporting] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchTransactions({ search, paymentMethod, status, dateFrom, dateTo })
      setTransactions(rows)
      setError('')
      setSelected((current) => current ? rows.find((row) => row.id === current.id) || null : null)
    } catch (cause) {
      setError(describeError(cause, 'Transactions could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, paymentMethod, search, status])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [dateFrom, dateTo, paymentMethod, search, status])
  const pageCount = Math.max(1, Math.ceil(transactions.length / TABLE_PAGE_SIZE))
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const pagedTransactions = useMemo(() => transactions.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE), [page, transactions])
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    const channel = supabase.channel('walk-in-transactions-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const summary = useMemo(() => {
    const completed = transactions.filter((row) => !row.isVoided)
    const sales = completed.reduce((sum, row) => sum + row.finalTotal, 0)
    return {
      sales,
      completed: completed.length,
      voided: transactions.filter((row) => row.isVoided).length,
      average: completed.length ? sales / completed.length : 0,
      cash: completed.filter((row) => row.paymentMethod === 'cash').reduce((sum, row) => sum + row.finalTotal, 0),
      gcash: completed.filter((row) => row.paymentMethod === 'gcash').reduce((sum, row) => sum + row.finalTotal, 0),
      bank: completed.filter((row) => row.paymentMethod === 'bank_transfer').reduce((sum, row) => sum + row.finalTotal, 0),
    }
  }, [transactions])

  const filterLabel = useMemo(() => {
    const filters = ['Walk-in orders']
    if (search.trim()) filters.push(`Search: ${search.trim()}`)
    if (paymentMethod !== 'all') filters.push(`Payment: ${PAYMENT_LABELS[paymentMethod] || paymentMethod}`)
    if (status !== 'all') filters.push(`Status: ${status === 'voided' ? 'Voided' : 'Completed'}`)
    if (dateFrom) filters.push(`From: ${dateFrom}`)
    if (dateTo) filters.push(`To: ${dateTo}`)
    return filters.join(' · ')
  }, [dateFrom, dateTo, paymentMethod, search, status])

  const runExport = async (format) => {
    if (!transactions.length || exporting) return
    setExporting(format)
    setError('')
    try {
      const input = { records: transactions, summary, filterLabel, generatedBy: getAccountDisplayName(profile || user?.user_metadata || user, 'HM POS Admin') }
      if (format === 'xlsx') await exportTransactionsToXlsx(input)
      else exportTransactionsToCsv(input)
      await addCurrentUserNotification({ category: 'exports', title: `${format.toUpperCase()} downloaded`, message: `Transaction history was exported with ${transactions.length} record${transactions.length === 1 ? '' : 's'}.` })
    } catch (cause) {
      setError(describeError(cause, `The ${format.toUpperCase()} report could not be exported.`))
    } finally {
      setExporting('')
    }
  }

  const submitVoid = async (event) => {
    event.preventDefault()
    if (!voidTarget || !voidReason.trim()) return
    setSavingVoid(true)
    try {
      await voidOrder(voidTarget.id, voidReason.trim())
      setVoidTarget(null)
      setVoidReason('')
      await load()
    } catch (cause) {
      setError(describeError(cause, 'The order could not be voided.'))
    } finally {
      setSavingVoid(false)
    }
  }

  return <AppShell role="admin" title="Transaction History" onRefresh={load}>
    <section className="transactions-page">
      <header className="transactions-hero">
        <div><span className="eyebrow">Walk-in POS records</span><p>Completed sales stay immutable. Incorrect sales can only be voided.</p></div>
        <div className="transactions-hero-actions">
          <button type="button" className="txn-export-action" onClick={() => runExport('csv')} disabled={loading || !transactions.length || Boolean(exporting)}><FileText size={16}/>{exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</button>
          <button type="button" className="txn-export-action txn-export-action--primary" onClick={() => runExport('xlsx')} disabled={loading || !transactions.length || Boolean(exporting)}><FileSpreadsheet size={16}/>{exporting === 'xlsx' ? 'Exporting…' : 'Export XLSX'}</button>
        </div>
      </header>

      <div className="txn-report-overview">
        <article className="txn-report-total">
          <span>Net sales</span><b>{money(summary.sales)}</b><p>Completed walk-in sales, excluding voided orders.</p>
          <div className="txn-report-total-meta">
            <span>Completed<b>{summary.completed}</b></span>
            <span>Cash<b>{money(summary.cash)}</b></span>
            <span>GCash<b>{money(summary.gcash)}</b></span>
            <span>Bank transfer<b>{money(summary.bank)}</b></span>
          </div>
        </article>
        <article className="txn-report-stat txn-report-stat--transactions"><span>Total records</span><b>{transactions.length}</b><small>Current filtered view</small></article>
        <article className="txn-report-stat txn-report-stat--completed"><span>Voided</span><b>{summary.voided}</b><small>Retained for audit</small></article>
        <article className="txn-report-stat txn-report-stat--average"><span>Average sale</span><b>{money(summary.average)}</b><small>Completed sales only</small></article>
      </div>

      <section className="transaction-controls">
        <label className="transaction-search"><Search size={16}/><span className="sr-only">Search receipts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order or receipt number"/></label>
        <label><span>Payment</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="all">All methods</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank Transfer</option></select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="completed">Completed</option><option value="voided">Voided</option></select></label>
        <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label>
      </section>

      {error && <div className="ad-error" role="alert"><AlertTriangle size={18}/><span>{error}</span></div>}
      <div className="transaction-table-wrap" aria-busy={loading}>
        {loading && <div className="transaction-loading" role="status">Loading transactions…</div>}
        <table className="transaction-table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{pagedTransactions.map((transaction) => <tr key={transaction.id}>
            <td><b>{transaction.receiptNumber}</b><small>{transaction.orderNumber}</small></td>
            <td>{formatDateTime(transaction.createdAt)}</td>
            <td>{transaction.cashierName}</td>
            <td>{transaction.itemCount}</td>
            <td>{PAYMENT_LABELS[transaction.paymentMethod] || transaction.paymentMethod}</td>
            <td><b>{money(transaction.finalTotal)}</b></td>
            <td><span className={`status-chip status-chip--${transaction.isVoided ? 'cancelled' : 'completed'}`}>{transaction.status}</span></td>
            <td><div className="transaction-row-actions"><button type="button" className="is-view" onClick={() => setSelected(transaction)} title="View receipt" aria-label={`View receipt ${transaction.receiptNumber}`}>View</button><button type="button" onClick={() => printReceipt(transaction, receiptStore)} title="Print receipt" aria-label={`Print receipt ${transaction.receiptNumber}`}><Printer size={15}/></button>{!transaction.isVoided && <button type="button" className="is-danger" onClick={() => { setVoidTarget(transaction); setVoidReason('') }} title="Void order" aria-label={`Void order ${transaction.orderNumber}`}><Ban size={15}/></button>}</div></td>
          </tr>)}</tbody>
        </table>
        {!loading && !transactions.length && <div className="inv-empty"><ReceiptText size={26}/><h3>No transactions found</h3><p>Completed walk-in orders will appear here.</p></div>}
        {!loading && transactions.length > 0 && <TablePagination page={page} pageSize={TABLE_PAGE_SIZE} total={transactions.length} onPageChange={setPage} label="transactions"/>}
      </div>
    </section>

    {selected && <div className="ops-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><aside className="ops-drawer txn-receipt-drawer" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title"><header><div><span className="settings-kicker">Transaction record</span><h2 id="transaction-detail-title">Order Details</h2><p>{selected.orderNumber}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close"><X size={20}/></button></header><div className="ops-drawer-body"><div className="txn-detail-meta"><div><span>Date</span><b>{formatDateTime(selected.createdAt)}</b></div><div><span>Payment</span><b>{PAYMENT_LABELS[selected.paymentMethod] || selected.paymentMethod || 'Not recorded'}</b></div></div><section><h3>Items</h3>{selected.items.length ? selected.items.map((item, index) => <div className="txn-detail-item" key={item.id || index}><div><b>{item.name || 'Menu item'}</b>{item.customizations && <small>{[item.customizations.variantLabel, item.customizations.temperature, item.customizations.sugarLevel, item.customizations.iceLevel, ...(item.addons || []).map((addon) => addon.name || addon)].filter(Boolean).join(' / ') || 'Standard preparation'}</small>}</div><span>×{item.quantity}</span><b>{money(item.lineTotal)}</b></div>) : <p>No item details are available for this transaction.</p>}</section><section><h3>Payment details</h3><div className="txn-detail-rows"><p><span>Receipt reference</span><b>{selected.receiptNumber || '—'}</b></p>{selected.paymentReference && <p><span>{selected.paymentMethod === 'gcash' ? 'Reference number' : 'Payment reference'}</span><b>{selected.paymentReference}</b></p>}{selected.bankName && <p><span>Bank name</span><b>{selected.bankName}</b></p>}<p><span>Amount paid</span><b>{money(selected.amountReceived || selected.finalTotal)}</b></p><p><span>Change</span><b>{money(selected.changeAmount)}</b></p></div></section><section><h3>Order summary</h3><div className="txn-detail-rows"><p><span>Subtotal</span><b>{money(selected.subtotal)}</b></p><p><span>Discount</span><b>{selected.discountAmount > 0 ? `-${money(selected.discountAmount)}` : 'No discount'}</b></p></div></section><div className="txn-detail-total"><span>Total</span><b>{money(selected.finalTotal)}</b></div>{selected.isVoided && <p className="form-error">Voided: {selected.voidedReason}</p>}</div><footer className="ops-drawer-footer"><button type="button" className="ops-main-action" onClick={() => printReceipt(selected, receiptStore)}><Printer size={16}/>Print receipt</button>{!selected.isVoided && <button type="button" className="ops-destructive-action" onClick={() => { setVoidTarget(selected); setVoidReason('') }}><Ban size={16}/>Void order</button>}</footer></aside></div>}

    {voidTarget && <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingVoid) setVoidTarget(null) }}><form className="payment-modal" onSubmit={submitVoid} role="alertdialog" aria-modal="true" aria-labelledby="void-order-title"><span className="payment-modal-kicker">Permanent audit action</span><h2 id="void-order-title">Void {voidTarget.orderNumber}?</h2><p>The sale remains in transaction history and its stock quantities are restored.</p><label className="field"><span>Void reason</span><textarea autoFocus required rows="3" maxLength={300} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explain why this sale is being voided."/></label><div className="payment-modal-actions"><button type="button" className="secondary-button" onClick={() => setVoidTarget(null)} disabled={savingVoid}>Keep order</button><button type="submit" className="danger-button" disabled={savingVoid || !voidReason.trim()}>{savingVoid ? 'Voiding…' : 'Void order'}</button></div></form></div>}
  </AppShell>
}
