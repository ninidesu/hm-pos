import AppShell from '../components/AppShell'
import { ChevronRight, CircleDollarSign, LockKeyhole, MonitorCog, ReceiptText, ShieldCheck, Store, UserRoundCog, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { saveStaffUsername } from '../services/staffSettingsService'
import { describeError } from '../utils/describeError'
import { SYSTEM_DEFAULTS, fetchPortalConfiguration, saveStoreConfiguration } from '../services/adminPortalConfigurationService'
import { EMAIL_MAX_LENGTH, isValidEmail, isValidPhone, sanitizeCatalogText, sanitizePhone, sanitizeUsername } from '../utils/inputValidation'
import { IMAGE_UPLOAD_ACCEPT, validateImageFile } from '../utils/imageUpload'
import { publishStoreInfo } from '../hooks/useStoreInfo'

export default function SettingsPage() {
  return <AppShell role="admin" title="Settings">
    <SettingsHome />
  </AppShell>
}

function SettingsHome() {
  const { profile, user, updateProfile } = useAuth()
  const [username, setUsername] = useState(profile?.username || '')
  const [saving, setSaving] = useState(false)
  const [accountNotice, setAccountNotice] = useState(null)
  const [storeNotice, setStoreNotice] = useState(null)
  const [store, setStore] = useState(SYSTEM_DEFAULTS.store)
  const [logoFile, setLogoFile] = useState(null)
  const [savingStore, setSavingStore] = useState(false)
  const email = profile?.email || user?.email || ''
  const logoPreview = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : store.logoUrl, [logoFile, store.logoUrl])

  useEffect(() => { setUsername(profile?.username || '') }, [profile?.username])
  useEffect(() => { fetchPortalConfiguration('system').then(({ values }) => setStore({ ...SYSTEM_DEFAULTS.store, ...values.store })).catch(() => {}) }, [])
  useEffect(() => () => { if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview) }, [logoPreview])

  const saveUsername = async (event) => {
    event.preventDefault()
    setAccountNotice(null)
    const cleanUsername = username.trim()
    if (!/^[A-Za-z0-9._-]{3,24}$/.test(cleanUsername)) {
      setAccountNotice({ tone: 'error', message: 'Username must be 3 to 24 letters, numbers, dots, underscores, or hyphens.' })
      return
    }
    setSaving(true)
    try {
      const updated = await saveStaffUsername(user?.id || profile?.id, cleanUsername)
      updateProfile((current) => ({ ...current, username: updated.username }))
      setUsername(updated.username)
      setAccountNotice({ tone: 'success', message: 'Username updated successfully.' })
    } catch (cause) {
      setAccountNotice({ tone: 'error', message: cause?.code === '23505' ? 'That username is already in use.' : describeError(cause, 'Could not update your username.') })
    } finally {
      setSaving(false)
    }
  }

  const updateStore = (values) => setStore((current) => ({ ...current, ...values }))
  const chooseLogo = async (event) => {
    const file = event.target.files?.[0] || null
    if (!file) return
    try { await validateImageFile(file, { label: 'Store logo', maxBytes: 10 * 1024 * 1024 }); setLogoFile(file); setStoreNotice(null) }
    catch (cause) { event.target.value = ''; setStoreNotice({ tone: 'error', message: describeError(cause, 'Choose a valid store logo image.') }) }
  }
  const removeLogo = () => {
    setLogoFile(null)
    setStore((current) => ({ ...current, logoUrl: '' }))
    setStoreNotice({ tone: 'success', message: 'Logo removed. Save changes to restore the default logo.' })
  }
  const saveStore = async (event) => {
    event.preventDefault(); setStoreNotice(null)
    if (!store.name.trim()) return setStoreNotice({ tone: 'error', message: 'Store name is required.' })
    if (store.email && !isValidEmail(store.email)) return setStoreNotice({ tone: 'error', message: 'Enter a valid store email address.' })
    if (store.phone && !isValidPhone(store.phone)) return setStoreNotice({ tone: 'error', message: 'Phone number must contain 11 digits and start with 09.' })
    setSavingStore(true)
    try {
      const result = await saveStoreConfiguration(store, logoFile)
      setStore(result.settings); setLogoFile(null); publishStoreInfo(result.settings)
      setStoreNotice({ tone: 'success', message: 'Store information saved and connected to receipts.' })
    } catch (cause) { setStoreNotice({ tone: 'error', message: describeError(cause, 'Could not save store information.') }) }
    finally { setSavingStore(false) }
  }

  const settings = [
    { icon: Store, label: 'Store name', value: store.name || 'HM POS' },
    { icon: ReceiptText, label: 'Sales channel', value: 'Walk-in POS' },
    { icon: CircleDollarSign, label: 'Currency', value: 'Philippine peso (PHP)' },
    { icon: ShieldCheck, label: 'Access model', value: 'Admin / Manager and Cashier' },
  ]
  return <div className="settings-stack">
    <section className="simple-settings" aria-labelledby="admin-account-title">
      <header className="simple-settings-header">
        <span><UserRoundCog size={20} aria-hidden="true" /></span>
        <div><h2 id="admin-account-title">Admin account</h2><p>Manage the username used in this administration workspace.</p></div>
      </header>
      <form className="simple-account-form" onSubmit={saveUsername}>
        <div className="simple-account-fields">
          <label className="ua-field"><span>Username</span><input required value={username} onChange={(event) => setUsername(sanitizeUsername(event.target.value, 24))} autoComplete="username" autoCapitalize="none" spellCheck="false" minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]+"/><small>You can edit your administration username here.</small></label>
          <label className="ua-field simple-account-locked"><span>Email <em><LockKeyhole size={13} aria-hidden="true"/>Database only</em></span><input type="email" value={email} readOnly aria-readonly="true"/><small>Email can only be edited directly in the database.</small></label>
          <label className="ua-field simple-account-locked"><span>Password <em><LockKeyhole size={13} aria-hidden="true"/>Database only</em></span><input type="text" value="Managed in database" readOnly aria-readonly="true"/><small>Password can only be edited directly in the database.</small></label>
        </div>
        {accountNotice && <p className={`simple-account-notice is-${accountNotice.tone}`} role={accountNotice.tone === 'error' ? 'alert' : 'status'}>{accountNotice.message}</p>}
        <footer className="simple-account-actions"><button type="submit" className="ua-primary-action" disabled={saving || username.trim() === (profile?.username || '')}>{saving ? 'Saving…' : 'Save changes'}</button></footer>
      </form>
    </section>

    <section className="simple-settings" aria-labelledby="store-info-title">
      <header className="simple-settings-header">
        <div><h2 id="store-info-title">Store info</h2><p>These details are used across the system and on receipts.</p></div>
      </header>
      <form className="simple-account-form" onSubmit={saveStore}>
        <div className="simple-store-grid">
          <div className="simple-store-preview-field"><span>Logo preview</span><div className="simple-store-logo-preview">{logoPreview ? <img src={logoPreview} alt="Store logo preview"/> : <span aria-hidden="true">No logo</span>}</div></div>
          <label className="ua-field"><span>Store name</span><input required value={store.name} maxLength={80} onChange={(event) => updateStore({ name: sanitizeCatalogText(event.target.value, 80) })}/></label>
          <label className="ua-field"><span>Address</span><input placeholder="Leave blank" maxLength={200} value={store.address} onChange={(event) => updateStore({ address: event.target.value.slice(0, 200) })}/></label>
          <label className="simple-logo-upload"><span>Upload</span><span className="simple-logo-upload-control">{logoFile ? logoFile.name : 'Choose image'}<input type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={chooseLogo}/></span><button type="button" className="simple-logo-remove" onClick={removeLogo} disabled={savingStore || (!logoFile && !store.logoUrl)}>Remove image</button><small>JPG, PNG, or WebP only, up to 10 MB.</small></label>
          <label className="ua-field"><span>Email</span><input type="email" placeholder="Leave blank" maxLength={EMAIL_MAX_LENGTH} value={store.email} onChange={(event) => updateStore({ email: event.target.value.slice(0, EMAIL_MAX_LENGTH) })}/></label>
          <label className="ua-field"><span>Contact number</span><input type="tel" inputMode="numeric" placeholder="Leave blank" maxLength={11} value={store.phone} onChange={(event) => updateStore({ phone: sanitizePhone(event.target.value) })}/></label>
        </div>
        {storeNotice && <p className={`simple-account-notice is-${storeNotice.tone}`} role={storeNotice.tone === 'error' ? 'alert' : 'status'}>{storeNotice.message}</p>}
        <footer className="simple-account-actions"><button type="submit" className="ua-primary-action" disabled={savingStore}>{savingStore ? 'Saving…' : 'Save changes'}</button></footer>
      </form>
    </section>

    <section className="simple-settings" aria-labelledby="simple-settings-title">
      <header className="simple-settings-header">
        <span><MonitorCog size={20} aria-hidden="true" /></span>
        <div><h2 id="simple-settings-title">System settings</h2><p>Current configuration for this workspace.</p></div>
      </header>
      <div className="simple-settings-list">
        {settings.map(({ icon: Icon, label, value }) => <div key={label}><span className="simple-settings-icon"><Icon size={18} aria-hidden="true" /></span><span><small>{label}</small><b>{value}</b></span></div>)}
      </div>
      <nav className="simple-settings-links" aria-label="Related settings">
        <NavLink to="/admin/users-access/users"><Users size={18} aria-hidden="true" /><span><b>Users & Access</b><small>Manage portal accounts and roles</small></span><ChevronRight size={17} aria-hidden="true" /></NavLink>
      </nav>
    </section>
  </div>
}
