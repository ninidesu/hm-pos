export function StoreReceiptBrand({ store }) {
  const source = store || {}
  const storeName = source.name || source.storeName || source.store_name || 'HM POS'
  const logoUrl = source.logoUrl || source.logo_url || source.logoPath || source.logo_path || ''
  const address = source.address || source.storeAddress || source.store_address || ''
  const email = source.email || source.contactEmail || source.contact_email || ''
  const phone = source.phone || source.contactNumber || source.contact_number || source.contactPhone || source.contact_phone || ''
  const initials = String(storeName).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <div className="receipt-header">
    {logoUrl ? <img className="receipt-logo receipt-logo-image" src={logoUrl} alt={`${storeName} logo`}/> : <span className="receipt-logo receipt-logo-text" aria-hidden="true">{initials}</span>}
    <div className="receipt-store-name">{storeName}</div>
    {address ? <div className="receipt-store-info">{address}</div> : null}
    {email ? <div className="receipt-store-info">{email}</div> : null}
    {phone ? <div className="receipt-store-info">{phone}</div> : null}
  </div>
}

export function StoreReceiptFooter({ store, reprint = false }) {
  return <div className="receipt-footer">Thank you for choosing {store.name || 'HM POS'},<br/>Have a great day!{reprint ? <><br/><small>Reprinted from HM POS</small></> : null}</div>
}
