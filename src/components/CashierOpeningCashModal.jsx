import { Banknote, LockKeyhole } from 'lucide-react'

export default function CashierOpeningCashModal({
  open,
  cashierName,
  storeName,
  openingLabel,
  greeting,
  value,
  error,
  saving,
  onChange,
  onConfirm,
}) {
  if (!open) return null

  return (
    <div className="cashier-opening-backdrop" role="dialog" aria-modal="true" aria-labelledby="cashier-opening-title" aria-describedby="cashier-opening-description">
      <section className="cashier-opening-modal">
        <div className="cashier-opening-icon" aria-hidden="true"><Banknote size={28} strokeWidth={2.2} /></div>
        <span className="cashier-opening-kicker">Opening shift</span>
        <h2 id="cashier-opening-title">{greeting}, {cashierName}!</h2>
        <p id="cashier-opening-description" className="cashier-opening-intro">
          Welcome to {storeName}. Before you start today&apos;s sales, confirm the cash currently inside the POS drawer.
        </p>
        <div className="cashier-opening-hours"><span>Store opens at</span><strong>{openingLabel}</strong></div>
        <label className="cashier-opening-field">
          <span>Starting cash in drawer</span>
          <div className="cashier-opening-input-wrap">
            <span>PHP</span>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="0.00"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'cashier-opening-error' : undefined}
            />
          </div>
        </label>
        {error ? <p className="cashier-opening-error" id="cashier-opening-error" role="alert">{error}</p> : null}
        <p className="cashier-opening-note"><LockKeyhole size={14} aria-hidden="true" /> This confirmation is recorded once for your account today.</p>
        <button type="button" className="cashier-opening-confirm" onClick={onConfirm} disabled={saving}>
          {saving ? 'Opening register…' : 'Confirm starting cash'}
        </button>
      </section>
    </div>
  )
}
