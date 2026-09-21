import { useEffect, useMemo, useState } from 'react'
import { Calendar, Printer, RefreshCw, X } from 'lucide-react'
import { fetchEodSummary, EOD_ITEM_NAMES } from '../services/eodService'
import { getAccountDisplayName } from '../lib/accountIdentity'
import { StoreReceiptBrand } from './StoreReceiptBrand'
import { formatBusinessDate, formatOperatingTime, getCalendarDateKey, normalizeOperatingHours } from '../utils/operatingHours'

const formatAmount = (value) => Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatCount = (value) => String(Math.max(0, Math.round(Number(value || 0)))).padStart(2, '0')
const formatDate = (value) => {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? month + '/' + day + '/' + year : '--/--/----'
}
const formatSignedAmount = (value) => {
  const amount = Number(value || 0)
  return amount > 0 ? '+' + formatAmount(amount) : formatAmount(amount)
}
const readStorage = (key, fallback) => {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const writeStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The receipt remains usable when browser storage is unavailable.
  }
}

export default function CashierEodModal({
  open,
  onClose,
  cashierProfile,
  initialDateKey,
  storeInfo = {},
}) {
  const storeOpenTime = storeInfo?.openTime
  const storeCloseTime = storeInfo?.closeTime
  const configuredHours = useMemo(() => normalizeOperatingHours({ openTime: storeOpenTime, closeTime: storeCloseTime }), [storeOpenTime, storeCloseTime])
  const [selectedDate, setSelectedDate] = useState(() => initialDateKey || getCalendarDateKey(new Date()))
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cashError, setCashError] = useState('')
  const [filterCashierOnly, setFilterCashierOnly] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [terminalNumber, setTerminalNumber] = useState(() => storeInfo?.terminalNumber || readStorage('hm-pos:terminal-number', '01'))
  const [startingCash, setStartingCash] = useState('0.00')
  const [actualCash, setActualCash] = useState('')

  const cashierName = getAccountDisplayName(cashierProfile, 'Cashier')
  const latestReportDate = getCalendarDateKey(new Date())
  const cashKey = 'hm-pos:eod-cash:' + (cashierProfile?.id || 'all') + ':' + selectedDate

  useEffect(() => {
    if (initialDateKey) setSelectedDate(initialDateKey)
  }, [initialDateKey])

  useEffect(() => {
    setStartingCash(readStorage(cashKey + ':starting', '0.00'))
    setActualCash(readStorage(cashKey + ':actual', ''))
    setCashError('')
  }, [cashKey])

  useEffect(() => {
    if (!open) return undefined
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      try {
          const result = await fetchEodSummary({
          businessDate: selectedDate,
          cashierId: filterCashierOnly ? cashierProfile?.id : null,
          cashierName: filterCashierOnly ? cashierName : 'All Cashiers',
          openingTime: configuredHours.openTime,
          closingTime: configuredHours.closeTime,
        })
        if (active) setSummary(result)
      } catch (err) {
        if (active) setError(err.message || 'Could not load the EOD receipt.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [open, selectedDate, filterCashierOnly, cashierProfile?.id, cashierName, configuredHours.openTime, configuredHours.closeTime, refreshKey])

  const expectedCash = useMemo(
    () => Number(startingCash || 0) + Number(summary?.cashCollected || 0),
    [startingCash, summary?.cashCollected],
  )
  const cashDifference = actualCash.trim() === '' ? null : Number(actualCash || 0) - expectedCash

  function updateStartingCash(value) {
    const next = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
    setStartingCash(next)
    writeStorage(cashKey + ':starting', next)
  }

  function updateActualCash(value) {
    const next = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
    setActualCash(next)
    setCashError('')
    writeStorage(cashKey + ':actual', next)
  }

  function handlePrint() {
    if (actualCash.trim() === '') {
      setCashError('Enter Actual Cash before printing.')
      return
    }
    window.print()
  }

  if (!open) return null

  const itemSales = summary?.itemSales || {}
  const payments = summary?.paymentBreakdown || {}
  const vat = summary?.vatSummary || {}
  const openingTime = summary?.openingTime || formatOperatingTime(configuredHours.openTime)
  const closingTime = summary?.closingTime || formatOperatingTime(configuredHours.closeTime)
  const footerDate = new Date().toLocaleDateString('en-US')
  const footerTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="cashier-eod-backdrop" role="dialog" aria-modal="true" aria-labelledby="eod-modal-title">
      <div className="cashier-eod-modal cashier-eod-receipt-modal">
        <header className="cashier-eod-header cashier-eod-screen-header">
          <div>
            <span className="cashier-eod-screen-kicker">Cashier closeout</span>
            <h2 id="eod-modal-title" className="cashier-eod-title">End of Day</h2>
          </div>
          <div className="cashier-eod-header-actions">
            <button type="button" className="cashier-eod-print-btn" onClick={handlePrint} disabled={loading || !summary} title="Print EOD receipt">
              <Printer size={16} aria-hidden="true" />
              <span>Print</span>
            </button>
            <button type="button" className="cashier-eod-close-btn" onClick={onClose} aria-label="Close EOD receipt">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="cashier-eod-toolbar">
          <label className="cashier-eod-date-picker">
            <Calendar size={16} aria-hidden="true" />
            <span className="sr-only">Business date</span>
            <input
              type="date"
              value={selectedDate}
              max={latestReportDate}
              onChange={(event) => setSelectedDate(event.target.value > latestReportDate ? latestReportDate : event.target.value)}
              className="cashier-eod-input"
              title="Past dates are available for audit. Future dates cannot have an EOD report."
            />
          </label>
          <div className="cashier-eod-cashier-filter" aria-label="Cashier filter">
            <button type="button" className={'cashier-eod-pill' + (filterCashierOnly ? ' active' : '')} onClick={() => setFilterCashierOnly(true)}>
              My Register
            </button>
            <button type="button" className={'cashier-eod-pill' + (!filterCashierOnly ? ' active' : '')} onClick={() => setFilterCashierOnly(false)}>
              All Cashiers
            </button>
          </div>
          <button type="button" className="cashier-eod-refresh-btn" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} title="Refresh EOD data">
            <RefreshCw size={15} className={loading ? 'spinning' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </section>

        <div className="cashier-eod-body cashier-eod-summary-body">
          <section className="cashier-eod-entry-strip" aria-label="EOD cash count">
            <label><span>Terminal</span><input value={terminalNumber} maxLength={12} onChange={(event) => { const next = event.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 12); setTerminalNumber(next); writeStorage('hm-pos:terminal-number', next) }} /></label>
            <label><span>Starting cash</span><input inputMode="decimal" value={startingCash} onChange={(event) => updateStartingCash(event.target.value)} /></label>
            <label><span>Actual cash</span><input inputMode="decimal" value={actualCash} onChange={(event) => updateActualCash(event.target.value)} placeholder="Enter count" /></label>
            <span className="cashier-eod-entry-note"><span className="cashier-eod-entry-label">Expected cash</span><b>PHP {formatAmount(expectedCash)}</b></span>
          </section>

          <section className="cashier-eod-summary-layout" aria-label="End of day summary">
            {error ? <div className="cashier-eod-error" role="alert">{error}</div> : null}
            {cashError ? <div className="cashier-eod-cash-error" role="alert">{cashError}</div> : null}

            <section className="cashier-eod-meta-banner" aria-label="Report details">
              <div className="cashier-eod-meta-item"><span>Business date</span><strong>{formatBusinessDate(selectedDate)}</strong></div>
              <div className="cashier-eod-meta-item"><span>Operating hours</span><strong>{openingTime} – {closingTime}</strong></div>
              <div className="cashier-eod-meta-item"><span>Register</span><strong>{terminalNumber || '--'}</strong></div>
              <div className="cashier-eod-meta-item"><span>Cashier</span><strong>{filterCashierOnly ? cashierName : 'All cashiers'}</strong></div>
            </section>

            <section className="cashier-eod-metrics-grid" aria-label="Key totals">
              <article className="cashier-eod-metric-card is-primary"><span>Net sales</span><strong>PHP {formatAmount(summary?.netSales)}</strong><small>After discounts and voids</small></article>
              <article className="cashier-eod-metric-card"><span>Total collected</span><strong>PHP {formatAmount(summary?.totalCollected)}</strong><small>All payment channels</small></article>
              <article className="cashier-eod-metric-card"><span>Transactions</span><strong>{formatCount(summary?.completedTransactions)}</strong><small>Completed orders</small></article>
              <article className="cashier-eod-metric-card"><span>Items sold</span><strong>{formatCount(summary?.totalItemsSold)}</strong><small>Tracked menu items</small></article>
            </section>

            <div className="cashier-eod-summary-grid">
              <section className="cashier-eod-summary-panel" aria-labelledby="eod-payments-title">
                <header><div><span>Collections</span><h3 id="eod-payments-title">Payment summary</h3></div><strong>PHP {formatAmount(summary?.totalCollected)}</strong></header>
                <div className="cashier-eod-summary-list">
                  <div><span>Cash <small>{formatCount(payments.cash?.count)} transactions</small></span><b>PHP {formatAmount(payments.cash?.amount)}</b></div>
                  <div><span>GCash <small>{formatCount(payments.gcash?.count)} transactions</small></span><b>PHP {formatAmount(payments.gcash?.amount)}</b></div>
                  <div><span>Bank <small>{formatCount(payments.bank?.count)} transactions</small></span><b>PHP {formatAmount(payments.bank?.amount)}</b></div>
                </div>
              </section>

              <section className="cashier-eod-summary-panel" aria-labelledby="eod-cash-title">
                <header><div><span>Register closeout</span><h3 id="eod-cash-title">Cash summary</h3></div><strong>PHP {formatAmount(expectedCash)}</strong></header>
                <div className="cashier-eod-summary-list">
                  <div><span>Starting cash</span><b>PHP {formatAmount(startingCash)}</b></div>
                  <div><span>Cash collected</span><b>PHP {formatAmount(summary?.cashCollected)}</b></div>
                  <div className="is-emphasis"><span>Expected cash</span><b>PHP {formatAmount(expectedCash)}</b></div>
                  <div><span>Cash difference</span><b>{cashDifference === null ? '--' : `PHP ${formatSignedAmount(cashDifference)}`}</b></div>
                </div>
              </section>
            </div>

            <div className="cashier-eod-summary-grid">
              <section className="cashier-eod-summary-panel" aria-labelledby="eod-items-title">
                <header><div><span>Menu performance</span><h3 id="eod-items-title">Item sales</h3></div><strong>{formatCount(summary?.totalItemsSold)} items</strong></header>
                <div className="cashier-eod-summary-list">
                  {EOD_ITEM_NAMES.map((name) => <div key={name}><span>{name}<small>{formatCount(itemSales[name]?.quantity)} sold</small></span><b>PHP {formatAmount(itemSales[name]?.amount)}</b></div>)}
                </div>
              </section>

              <section className="cashier-eod-summary-panel" aria-labelledby="eod-vat-title">
                <header><div><span>Tax reporting</span><h3 id="eod-vat-title">VAT summary</h3></div><strong>12%</strong></header>
                <div className="cashier-eod-summary-list">
                  <div><span>VATable sales</span><b>PHP {formatAmount(vat.vatableSales)}</b></div>
                  <div><span>VAT amount</span><b>PHP {formatAmount(vat.vatAmount)}</b></div>
                  <div><span>VAT-exempt sales</span><b>PHP {formatAmount(vat.vatExemptSales)}</b></div>
                  <div><span>Zero-rated sales</span><b>PHP {formatAmount(vat.zeroRatedSales)}</b></div>
                </div>
              </section>
            </div>

            <section className="cashier-eod-secondary-summary" aria-label="Additional sales totals">
              <div><span>Gross sales</span><b>PHP {formatAmount(summary?.grossSales)}</b></div>
              <div><span>Discounts</span><b>PHP {formatAmount(summary?.discounts)}</b></div>
              <div><span>Voids and refunds</span><b>PHP {formatAmount(summary?.refundsAndVoids)}</b></div>
            </section>
          </section>

          <div className="cashier-eod-receipt-preview printable-eod-area">
            <div className="cashier-eod-receipt-paper receipt-print-area">
              <StoreReceiptBrand store={storeInfo} />
              <div className="eod-line" />
              <div className="eod-center eod-title">END OF DAY</div>
              <div className="eod-line" />
              <div className="eod-row"><span>Date:</span><b>{formatDate(selectedDate)}</b></div>
              <div className="eod-row"><span>Terminal:</span><b>{terminalNumber || '--'}</b></div>
              <div className="eod-row"><span>Cashier:</span><b>{cashierName}</b></div>
              <div className="eod-row"><span>Opening Time:</span><b>{openingTime}</b></div>
              <div className="eod-row"><span>Closing Time:</span><b>{closingTime}</b></div>

              <EodSectionHeading>ITEM SALES SUMMARY</EodSectionHeading>
              {EOD_ITEM_NAMES.map((name) => (
                <div className="eod-item-row" key={name}>
                  <span>{formatCount(itemSales[name]?.quantity)} {name}</span>
                  <b>{formatAmount(itemSales[name]?.amount)}(+)</b>
                </div>
              ))}
              <EodDashedLine />
              <div className="eod-row"><span>TOTAL ITEMS SOLD:</span><b>{formatCount(summary?.totalItemsSold)}</b></div>
              <div className="eod-row"><span>TOTAL ITEM SALES:</span><b>{formatAmount(summary?.totalItemSales)}</b></div>

              <EodSectionHeading>SALES SUMMARY</EodSectionHeading>
              <div className="eod-row"><span>Gross Sales:</span><b>{formatAmount(summary?.grossSales)}</b></div>
              <div className="eod-row"><span>SC/PWD Discount:</span><b>{formatAmount(summary?.discounts)}(-)</b></div>
              <EodDashedLine />
              <div className="eod-row eod-strong"><span>NET SALES:</span><b>{formatAmount(summary?.netSales)}</b></div>

              <EodSectionHeading>VAT SUMMARY</EodSectionHeading>
              <div className="eod-row"><span>VATable Sales:</span><b>{formatAmount(vat.vatableSales)}</b></div>
              <div className="eod-row"><span>VAT (12%):</span><b>{formatAmount(vat.vatAmount)}</b></div>
              <div className="eod-row"><span>VAT-Exempt Sales:</span><b>{formatAmount(vat.vatExemptSales)}</b></div>
              <div className="eod-row"><span>Zero-Rated Sales:</span><b>{formatAmount(vat.zeroRatedSales)}</b></div>

              <EodSectionHeading>PAYMENT SUMMARY</EodSectionHeading>
              <div className="eod-row"><span>{formatCount(payments.cash?.count)} Cash</span><b>{formatAmount(payments.cash?.amount)}(+)</b></div>
              <div className="eod-row"><span>{formatCount(payments.gcash?.count)} GCash</span><b>{formatAmount(payments.gcash?.amount)}(+)</b></div>
              <div className="eod-row"><span>{formatCount(payments.bank?.count)} Bank</span><b>{formatAmount(payments.bank?.amount)}(+)</b></div>
              <EodDashedLine />
              <div className="eod-row"><span>TOTAL TRANSACTIONS:</span><b>{formatCount(summary?.completedTransactions)}</b></div>
              <div className="eod-row"><span>TOTAL PAYMENTS:</span><b>{formatAmount(summary?.totalCollected)}</b></div>

              <EodSectionHeading>CASH SUMMARY</EodSectionHeading>
              <div className="eod-row"><span>Starting Cash:</span><b>{formatAmount(startingCash)}</b></div>
              <div className="eod-row"><span>Cash Collected:</span><b>{formatAmount(summary?.cashCollected)}(+)</b></div>
              <EodDashedLine />
              <div className="eod-row eod-strong"><span>EXPECTED CASH:</span><b>{formatAmount(expectedCash)}</b></div>
              <div className="eod-row"><span>Actual Cash:</span><b>{actualCash.trim() === '' ? '--' : formatAmount(actualCash)}</b></div>
              <EodDashedLine />
              <div className="eod-row eod-strong"><span>CASH DIFFERENCE:</span><b>{cashDifference === null ? '--' : formatSignedAmount(cashDifference)}</b></div>

              <div className="eod-line eod-footer-line" />
              <div className="eod-center eod-title">EOD CLOSED</div>
              <div className="eod-center">Closed By: {cashierName}</div>
              <div className="eod-center">{footerDate}  {footerTime}</div>
            </div>
          </div>
        </div>

        <footer className="cashier-eod-footer cashier-eod-screen-footer">
          <span>{loading ? 'Loading...' : summary ? 'Ready to close' : 'Waiting for data'}</span>
          <button type="button" className="cashier-eod-done-btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  )
}

function EodSectionHeading({ children }) {
  return <div className="eod-section-heading">******** {children} ********</div>
}

function EodDashedLine() {
  return <div className="eod-dashed-line" aria-hidden="true">----------------------------------------</div>
}
