import { Ban } from 'lucide-react'

export default function CashierClosedBanner({ onOpenEod, operatingStatus }) {
  return (
    <aside className="cashier-closed-banner" role="alert" aria-live="assertive">
      <div className="cashier-closed-banner-content">
        <Ban className="cashier-closed-banner-icon" size={30} aria-hidden="true" />
        <div className="cashier-closed-banner-text">
          <strong className="cashier-closed-banner-title">Outside Operating Hours</strong>
          <span className="cashier-closed-banner-subtitle">({operatingStatus?.closedRangeLabel || '10:00 PM – 6:00 AM'})</span>
        </div>
      </div>
      {onOpenEod ? (
        <button
          type="button"
          className="cashier-closed-banner-eod-btn"
          onClick={onOpenEod}
        >
          View End of Day
        </button>
      ) : null}
    </aside>
  )
}
