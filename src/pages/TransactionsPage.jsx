import { AlertTriangle, Ban, CheckCircle2, FileSpreadsheet, FileText, Gauge, Printer, ReceiptText, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { exportTransactionsToCsv, exportTransactionsToXlsx, fetchTransactions, voidOrder } from '../services/transactionsService'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'

const PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer' }
const receiptStore = {
  name: import.meta.env.VITE_POS_NAME || 'HM POS',
  branch: import.meta.env.VITE_POS_BRANCH || '',
  address: import.meta.env.VITE_POS_ADDRESS || '',
  phone: import.meta.env.VITE_POS_PHONE || '',
  tin: import.meta.env.VITE_POS_TIN || '',
}

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

function printReceipt(transaction) {
  const printWindow = window.open('', '_blank', 'width=440,height=760')
  if (!printWindow) return
  const itemRows = transaction.items.map((item) => `
    <div class="item"><span>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)}</span><b>${escapeHtml(money(item.lineTotal))}</b></div>
    ${item.addons?.length ? `<small>${escapeHtml(item.addons.map((addon) => addon.name || addon).join(', '))}</small>` : ''}
  `).join('')
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(transaction.receiptNumber)}</title><style>
    *{box-sizing:border-box}body{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#111;margin:0;padding:22px;font-size:12px}
    header{text-align:center;border-bottom:1px dashed #777;padding-bottom:12px;margin-bottom:12px}h1{font-size:20px;margin:0 0 4px}p{margin:3px 0}.meta,.totals{border-bottom:1px dashed #777;padding-bottom:10px;margin-bottom:10px}.row,.item{display:flex;justify-content:space-between;gap:16px;margin:6px 0}.item span{max-width:72%}.items small{display:block;margin:-3px 0 7px 16px;color:#555}.total{font-size:15px;font-weight:800;border-top:1px dashed #777;padding-top:8px}.void{border:1px solid #b91c1c;color:#b91c1c;padding:8px;text-align:center;font-weight:800;margin:12px 0}footer{text-align:center;margin-top:18px;color:#444}@media print{body{padding:0}}
  </style></head><body>
    <header><h1>${escapeHtml(receiptStore.name)}</h1>${receiptStore.branch ? `<p>${escapeHtml(receiptStore.branch)}</p>` : ''}${receiptStore.address ? `<p>${escapeHtml(receiptStore.address)}</p>` : ''}${receiptStore.phone ? `<p>${escapeHtml(receiptStore.phone)}</p>` : ''}${receiptStore.tin ? `<p>TIN: ${escapeHtml(receiptStore.tin)}</p>` : ''}</header>
    <section class="meta"><div class="row"><span>Receipt</span><b>${escapeHtml(transaction.receiptNumber)}</b></div><div class="row"><span>Order</span><b>${escapeHtml(transaction.orderNumber)}</b></div><div class="row"><span>Date</span><b>${escapeHtml(formatDateTime(transaction.createdAt))}</b></div><div class="row"><span>Cashier</span><b>${escapeHtml(transaction.cashierName)}</b></div><div class="row"><span>Order type</span><b>Walk-in</b></div></section>
    <section class="items">${itemRows}</section>
    <section class="totals"><div class="row"><span>Subtotal</span><b>${escapeHtml(money(transaction.subtotal))}</b></div>${transaction.discountAmount > 0 ? `<div class="row"><span>${escapeHtml(transaction.discountType || 'Discount')}</span><b>-${escapeHtml(money(transaction.discountAmount))}</b></div>` : ''}<div class="row total"><span>Total</span><b>${escapeHtml(money(transaction.finalTotal))}</b></div><div class="row"><span>Payment</span><b>${escapeHtml(PAYMENT_LABELS[transaction.paymentMethod] || transaction.paymentMethod)}</b></div>${transaction.paymentMethod === 'cash' ? `<div class="row"><span>Received</span><b>${escapeHtml(money(transaction.amountReceived))}</b></div><div class="row"><span>Change</span><b>${escapeHtml(money(transaction.changeAmount))}</b></div>` : ''}${transaction.paymentReference ? `<div class="row"><span>Reference</span><b>${escapeHtml(transaction.paymentReference)}</b></div>` : ''}</section>
    ${transaction.isVoided ? `<div class="void">VOIDED<br><small>${escapeHtml(transaction.voidedReason)}</small></div>` : ''}
    <footer><p>Thank you.</p><p>Reprinted from HM POS</p></footer>
  </body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

export default function TransactionsPage() {
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
      const input = { records: transactions, summary, filterLabel }
      if (format === 'xlsx') await exportTransactionsToXlsx(input)
      else exportTransactionsToCsv(input)
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
        <div><span className="eyebrow">Walk-in POS records</span><h2>Transactions and receipts</h2><p>Completed sales stay immutable. Incorrect sales can only be voided.</p></div>
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
        <article className="txn-report-stat txn-report-stat--transactions"><ReceiptText size={18}/><span>Total records</span><b>{transactions.length}</b><small>Current filtered view</small></article>
        <article className="txn-report-stat txn-report-stat--completed"><CheckCircle2 size={18}/><span>Voided</span><b>{summary.voided}</b><small>Retained for audit</small></article>
        <article className="txn-report-stat txn-report-stat--average"><Gauge size={18}/><span>Average sale</span><b>{money(summary.average)}</b><small>Completed sales only</small></article>
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
          <tbody>{transactions.map((transaction) => <tr key={transaction.id}>
            <td><b>{transaction.receiptNumber}</b><small>{transaction.orderNumber}</small></td>
            <td>{formatDateTime(transaction.createdAt)}</td>
            <td>{transaction.cashierName}</td>
            <td>{transaction.itemCount}</td>
            <td>{PAYMENT_LABELS[transaction.paymentMethod] || transaction.paymentMethod}</td>
            <td><b>{money(transaction.finalTotal)}</b></td>
            <td><span className={`status-chip status-chip--${transaction.isVoided ? 'cancelled' : 'completed'}`}>{transaction.status}</span></td>
            <td><div className="transaction-row-actions"><button type="button" className="is-view" onClick={() => setSelected(transaction)} title="View receipt" aria-label={`View receipt ${transaction.receiptNumber}`}>View</button><button type="button" onClick={() => printReceipt(transaction)} title="Print receipt" aria-label={`Print receipt ${transaction.receiptNumber}`}><Printer size={15}/></button>{!transaction.isVoided && <button type="button" className="is-danger" onClick={() => { setVoidTarget(transaction); setVoidReason('') }} title="Void order" aria-label={`Void order ${transaction.orderNumber}`}><Ban size={15}/></button>}</div></td>
          </tr>)}</tbody>
        </table>
        {!loading && !transactions.length && <div className="inv-empty"><ReceiptText size={26}/><h3>No transactions found</h3><p>Completed walk-in orders will appear here.</p></div>}
      </div>
    </section>

    {selected && <div className="ops-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><aside className="ops-drawer txn-receipt-drawer" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title"><header><div><span className="settings-kicker">Receipt {selected.receiptNumber}</span><h2 id="transaction-detail-title">{selected.orderNumber}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Close"><X size={20}/></button></header><div className="ops-drawer-body"><section><h3>Sale</h3><p>Walk-in · {formatDateTime(selected.createdAt)}</p><p>Cashier: {selected.cashierName}</p><p>Payment: {PAYMENT_LABELS[selected.paymentMethod] || selected.paymentMethod || 'Not recorded'}</p></section><section><h3>Items</h3>{selected.items.map((item) => <p key={item.id}>{item.quantity} × {item.name} <b>{money(item.lineTotal)}</b></p>)}</section><section><h3>Totals</h3><p>Subtotal: {money(selected.subtotal)}</p>{selected.discountAmount > 0 && <p>Discount: -{money(selected.discountAmount)}</p>}<p><b>Total: {money(selected.finalTotal)}</b></p>{selected.isVoided && <p className="form-error">Voided: {selected.voidedReason}</p>}</section></div><footer className="ops-drawer-footer"><button type="button" className="ops-main-action" onClick={() => printReceipt(selected)}><Printer size={16}/>Print receipt</button>{!selected.isVoided && <button type="button" className="ops-destructive-action" onClick={() => { setVoidTarget(selected); setVoidReason('') }}><Ban size={16}/>Void order</button>}</footer></aside></div>}

    {voidTarget && <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingVoid) setVoidTarget(null) }}><form className="payment-modal" onSubmit={submitVoid} role="alertdialog" aria-modal="true" aria-labelledby="void-order-title"><span className="payment-modal-kicker">Permanent audit action</span><h2 id="void-order-title">Void {voidTarget.orderNumber}?</h2><p>The sale remains in transaction history and its stock quantities are restored.</p><label className="field"><span>Void reason</span><textarea autoFocus required rows="3" maxLength={300} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explain why this sale is being voided."/></label><div className="payment-modal-actions"><button type="button" className="secondary-button" onClick={() => setVoidTarget(null)} disabled={savingVoid}>Keep order</button><button type="submit" className="danger-button" disabled={savingVoid || !voidReason.trim()}>{savingVoid ? 'Voiding…' : 'Void order'}</button></div></form></div>}
  </AppShell>
}
