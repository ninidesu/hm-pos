export function StoreReceiptBrand({ store }) {
  const initials = String(store.name || 'HM POS').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <div className="receipt-header">
    {store.logoUrl ? <img className="receipt-logo receipt-logo-image" src={store.logoUrl} alt={`${store.name || 'Store'} logo`}/> : <span className="receipt-logo receipt-logo-text" aria-hidden="true">{initials}</span>}
    <div className="receipt-store-name">{store.name || 'HM POS'}</div>
    {store.address ? <div className="receipt-store-info">{store.address}</div> : null}
    {store.email ? <div className="receipt-store-info">{store.email}</div> : null}
    {store.phone ? <div className="receipt-store-info">{store.phone}</div> : null}
  </div>
}

export function StoreReceiptFooter({ store, reprint = false }) {
  return <div className="receipt-footer">Thank you for choosing {store.name || 'HM POS'},<br/>Have a great day!{reprint ? <><br/><small>Reprinted from HM POS</small></> : null}</div>
}
