import { Clock } from 'lucide-react'

export default function CashierClosedModal({ open, onClose, onOpenEod, operatingStatus }) {
  if (!open) return null

  return (
    <div className="cashier-closed-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="closed-modal-title">
      <div className="cashier-closed-modal-card">
        <div className="cashier-closed-modal-icon-badge">
          <Clock size={36} strokeWidth={2.4} aria-hidden="true" />
        </div>
        <h2 id="closed-modal-title" className="cashier-closed-modal-title">
          POS is currently closed.
        </h2>
        <p className="cashier-closed-modal-subtitle">
          Operating hours are {operatingStatus?.rangeLabel || '6:00 AM – 10:00 PM'}.
        </p>
        <div className="cashier-closed-modal-actions">
          <button
            type="button"
            className="cashier-closed-modal-btn"
            onClick={onClose}
            autoFocus
          >
            OK
          </button>
          {onOpenEod ? (
            <button
              type="button"
              className="cashier-closed-modal-secondary-btn"
              onClick={() => {
                onClose()
                onOpenEod()
              }}
            >
              View End of Day Summary
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
