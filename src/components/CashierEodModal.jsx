import { useEffect, useState } from 'react'
import {
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  TrendingDown,
  User,
  X,
} from 'lucide-react'
import { fetchEodSummary, EOD_HOURS } from '../services/eodService'
import { formatBusinessDate, getBusinessDateKey } from '../utils/operatingHours'

const peso = (val) => `PHP ${Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CashierEodModal({
  open,
  onClose,
  cashierProfile,
  initialDateKey,
  storeInfo = {},
}) {
  const [selectedDate, setSelectedDate] = useState(() => initialDateKey || getBusinessDateKey(new Date()))
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterCashierOnly, setFilterCashierOnly] = useState(true)

  const cashierName = cashierProfile?.full_name || cashierProfile?.username || 'Cashier'

  useEffect(() => {
    if (initialDateKey) {
      setSelectedDate(initialDateKey)
    }
  }, [initialDateKey])

  useEffect(() => {
    if (!open) return
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      try {
        const result = await fetchEodSummary({
          businessDate: selectedDate,
          cashierId: filterCashierOnly ? cashierProfile?.id : null,
          cashierName: filterCashierOnly ? cashierName : 'All Cashiers',
        })
        if (active) {
          setSummary(result)
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Failed to load End of Day summary.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [open, selectedDate, filterCashierOnly, cashierProfile?.id, cashierName])

  if (!open) return null

  function handlePrint() {
    window.print()
  }

  return (
    <div className="cashier-eod-backdrop" role="dialog" aria-modal="true" aria-labelledby="eod-modal-title">
      <div className="cashier-eod-modal">
        {/* Header */}
        <header className="cashier-eod-header">
          <div className="cashier-eod-header-info">
            <span className="cashier-eod-header-badge">
              <FileSpreadsheet size={18} aria-hidden="true" />
              <span>Shift Settlement</span>
            </span>
            <h2 id="eod-modal-title" className="cashier-eod-title">
              End of Day (EOD) Summary
            </h2>
            <p className="cashier-eod-subtitle">
              Financial and transaction summary for business operations.
            </p>
          </div>
          <div className="cashier-eod-header-actions">
            <button
              type="button"
              className="cashier-eod-print-btn"
              onClick={handlePrint}
              title="Print EOD Report"
            >
              <Printer size={16} aria-hidden="true" />
              <span>Print Slip</span>
            </button>
            <button
              type="button"
              className="cashier-eod-close-btn"
              onClick={onClose}
              aria-label="Close EOD modal"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Filters / Toolbar */}
        <section className="cashier-eod-toolbar">
          <div className="cashier-eod-date-picker">
            <Calendar size={16} aria-hidden="true" />
            <label htmlFor="eod-business-date-input" className="sr-only">Business Date</label>
            <input
              id="eod-business-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="cashier-eod-input"
            />
          </div>

          <div className="cashier-eod-cashier-filter">
            <User size={16} aria-hidden="true" />
            <button
              type="button"
              className={`cashier-eod-pill ${filterCashierOnly ? 'active' : ''}`}
              onClick={() => setFilterCashierOnly(true)}
            >
              My Register ({cashierName})
            </button>
            <button
              type="button"
              className={`cashier-eod-pill ${!filterCashierOnly ? 'active' : ''}`}
              onClick={() => setFilterCashierOnly(false)}
            >
              All Cashiers
            </button>
          </div>

          <button
            type="button"
            className="cashier-eod-refresh-btn"
            onClick={() => setSelectedDate((d) => d)}
            disabled={loading}
            title="Refresh numbers"
          >
            <RefreshCw size={15} className={loading ? 'spinning' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </section>

        {/* Content Body */}
        <div className="cashier-eod-body printable-eod-area">
          {error ? (
            <div className="cashier-eod-error" role="alert">
              {error}
            </div>
          ) : null}

          {/* Store / Shift Meta Card */}
          <div className="cashier-eod-meta-banner">
            <div className="cashier-eod-meta-item">
              <span className="cashier-eod-meta-label">Business Date</span>
              <strong className="cashier-eod-meta-value">
                {formatBusinessDate(selectedDate)}
              </strong>
            </div>
            <div className="cashier-eod-meta-item">
              <span className="cashier-eod-meta-label">Operating Schedule</span>
              <strong className="cashier-eod-meta-value">
                <Clock size={14} className="inline-icon" aria-hidden="true" />
                {EOD_HOURS.openingTime} – {EOD_HOURS.closingTime}
              </strong>
            </div>
            <div className="cashier-eod-meta-item">
              <span className="cashier-eod-meta-label">Register / Cashier</span>
              <strong className="cashier-eod-meta-value">
                {filterCashierOnly ? cashierName : 'All Registers Combined'}
              </strong>
            </div>
            <div className="cashier-eod-meta-item">
              <span className="cashier-eod-meta-label">Report Finalized</span>
              <strong className="cashier-eod-meta-value">
                {new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
              </strong>
            </div>
          </div>

          {/* Primary Metrics Grid */}
          <div className="cashier-eod-metrics-grid">
            <div className="cashier-eod-metric-card highlight-net">
              <span className="cashier-eod-metric-title">Net Sales</span>
              <b className="cashier-eod-metric-amount">{peso(summary?.netSales)}</b>
              <small className="cashier-eod-metric-hint">Gross Sales less Discounts & Refunds</small>
            </div>

            <div className="cashier-eod-metric-card highlight-collected">
              <span className="cashier-eod-metric-title">Total Amount Collected</span>
              <b className="cashier-eod-metric-amount">{peso(summary?.totalCollected)}</b>
              <small className="cashier-eod-metric-hint">Total payments received today</small>
            </div>

            <div className="cashier-eod-metric-card">
              <span className="cashier-eod-metric-title">Completed Transactions</span>
              <b className="cashier-eod-metric-amount">{summary?.completedTransactions ?? 0}</b>
              <small className="cashier-eod-metric-hint">Settled sales orders</small>
            </div>

            <div className="cashier-eod-metric-card">
              <span className="cashier-eod-metric-title">Gross Sales</span>
              <b className="cashier-eod-metric-amount">{peso(summary?.grossSales)}</b>
              <small className="cashier-eod-metric-hint">Total sales before deductions</small>
            </div>

            <div className="cashier-eod-metric-card">
              <span className="cashier-eod-metric-title">Discounts Applied</span>
              <b className="cashier-eod-metric-amount text-negative">
                {summary?.discounts > 0 ? `-${peso(summary?.discounts)}` : peso(0)}
              </b>
              <small className="cashier-eod-metric-hint">Senior / PWD discounts</small>
            </div>

            <div className="cashier-eod-metric-card">
              <span className="cashier-eod-metric-title">Refunds / Void Amounts</span>
              <b className="cashier-eod-metric-amount text-negative">
                {summary?.refundsAndVoids > 0 ? `-${peso(summary?.refundsAndVoids)}` : peso(0)}
              </b>
              <small className="cashier-eod-metric-hint">
                {summary?.voidedTransactions ? `${summary.voidedTransactions} voided orders` : 'No voids recorded'}
              </small>
            </div>
          </div>

          {/* Payment Collection Breakdown */}
          <section className="cashier-eod-breakdown-section">
            <h3 className="cashier-eod-section-heading">Collections by Payment Method</h3>
            <div className="cashier-eod-payment-table">
              <div className="cashier-eod-table-row cashier-eod-table-head">
                <span>Payment Channel</span>
                <span className="text-center">Transactions</span>
                <span className="text-right">Total Collected</span>
              </div>
              <div className="cashier-eod-table-row">
                <span className="font-semibold">Cash</span>
                <span className="text-center">{summary?.paymentBreakdown?.cash?.count ?? 0}</span>
                <span className="text-right font-semibold">{peso(summary?.paymentBreakdown?.cash?.amount)}</span>
              </div>
              <div className="cashier-eod-table-row">
                <span className="font-semibold">GCash</span>
                <span className="text-center">{summary?.paymentBreakdown?.gcash?.count ?? 0}</span>
                <span className="text-right font-semibold">{peso(summary?.paymentBreakdown?.gcash?.amount)}</span>
              </div>
              <div className="cashier-eod-table-row">
                <span className="font-semibold">Bank Transfer</span>
                <span className="text-center">{summary?.paymentBreakdown?.bank_transfer?.count ?? 0}</span>
                <span className="text-right font-semibold">{peso(summary?.paymentBreakdown?.bank_transfer?.amount)}</span>
              </div>
              {summary?.paymentBreakdown?.other?.count > 0 ? (
                <div className="cashier-eod-table-row">
                  <span className="font-semibold">Other</span>
                  <span className="text-center">{summary?.paymentBreakdown?.other?.count}</span>
                  <span className="text-right font-semibold">{peso(summary?.paymentBreakdown?.other?.amount)}</span>
                </div>
              ) : null}
              <div className="cashier-eod-table-row cashier-eod-table-total">
                <span>Total Collections</span>
                <span className="text-center">{summary?.completedTransactions ?? 0}</span>
                <span className="text-right font-bold">{peso(summary?.totalCollected)}</span>
              </div>
            </div>
          </section>

          {/* Printable Thermal Receipt Footer */}
          <div className="cashier-eod-print-footer">
            <p>*** END OF DAY SUMMARY - HM POS ***</p>
            <p>Store: {storeInfo?.name || 'HM POS'}</p>
            <p>Generated: {new Date().toLocaleString('en-PH')}</p>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <footer className="cashier-eod-footer">
          <div className="cashier-eod-footer-status">
            <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
            <span>Operational records synchronized for {selectedDate}.</span>
          </div>
          <button
            type="button"
            className="cashier-eod-done-btn"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
