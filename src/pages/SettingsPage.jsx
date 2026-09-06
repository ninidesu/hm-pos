import AppShell from '../components/AppShell'
import { ChevronRight, CircleDollarSign, LockKeyhole, MonitorCog, ReceiptText, ShieldCheck, Store, UserRoundCog, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { saveStaffUsername } from '../services/staffSettingsService'
import { sanitizeUsername } from '../utils/inputValidation'
import { describeError } from '../utils/describeError'

export default function SettingsPage() {
  return <AppShell role="admin" title="Settings">
    <SettingsHome />
  </AppShell>
}

function SettingsHome() {
  const { profile, user, updateProfile } = useAuth()
  const [username, setUsername] = useState(profile?.username || '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const email = profile?.email || user?.email || ''

  useEffect(() => { setUsername(profile?.username || '') }, [profile?.username])

  const saveUsername = async (event) => {
    event.preventDefault()
    setNotice(null)
    const cleanUsername = username.trim()
    if (!/^[A-Za-z0-9._-]{3,24}$/.test(cleanUsername)) {
      setNotice({ tone: 'error', message: 'Username must be 3 to 24 letters, numbers, dots, underscores, or hyphens.' })
      return
    }
    setSaving(true)
    try {
      const updated = await saveStaffUsername(user?.id || profile?.id, cleanUsername)
      updateProfile((current) => ({ ...current, username: updated.username }))
      setUsername(updated.username)
      setNotice({ tone: 'success', message: 'Username updated successfully.' })
    } catch (cause) {
      setNotice({ tone: 'error', message: cause?.code === '23505' ? 'That username is already in use.' : describeError(cause, 'Could not update your username.') })
    } finally {
      setSaving(false)
    }
  }

  const settings = [
    { icon: Store, label: 'Store name', value: 'HM POS' },
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
          <label className="ua-field"><span>Username</span><input autoFocus required value={username} onChange={(event) => setUsername(sanitizeUsername(event.target.value, 24))} autoComplete="username" autoCapitalize="none" spellCheck="false" minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]+"/><small>You can edit your administration username here.</small></label>
          <label className="ua-field simple-account-locked"><span>Email <em><LockKeyhole size={13} aria-hidden="true"/>Database only</em></span><input type="email" value={email} readOnly aria-readonly="true"/><small>Email can only be edited directly in the database.</small></label>
          <label className="ua-field simple-account-locked"><span>Password <em><LockKeyhole size={13} aria-hidden="true"/>Database only</em></span><input type="text" value="Managed in database" readOnly aria-readonly="true"/><small>Password can only be edited directly in the database.</small></label>
        </div>
        {notice && <p className={`simple-account-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
        <footer className="simple-account-actions"><button type="submit" className="ua-primary-action" disabled={saving || username.trim() === (profile?.username || '')}>{saving ? 'Saving…' : 'Save changes'}</button></footer>
      </form>
    </section>

    <section className="simple-settings" aria-labelledby="simple-settings-title">
      <header className="simple-settings-header">
        <span><MonitorCog size={20} aria-hidden="true" /></span>
        <div><h2 id="simple-settings-title">System settings</h2><p>Current configuration for this HM POS workspace.</p></div>
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
