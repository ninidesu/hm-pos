import AppShell from '../components/AppShell'
import { ChevronRight, CircleDollarSign, History, MonitorCog, ReceiptText, ShieldCheck, SlidersHorizontal, Store, Users } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { ActivityLogsModule } from './UsersAccessPage'

export default function SettingsPage() {
  const { pathname } = useLocation()
  const [refreshSignal, setRefreshSignal] = useState(0)
  const activityOpen = pathname.endsWith('/activity')
  const tabs = <nav className="ua-tabs" aria-label="Settings sections">
    <NavLink to="/admin/settings" end><SlidersHorizontal size={18} aria-hidden="true"/><span><b>Settings</b><small>System preferences</small></span></NavLink>
    <NavLink to="/admin/settings/activity"><History size={18} aria-hidden="true"/><span><b>Activity Logs</b><small>Portal-wide audit trail</small></span></NavLink>
  </nav>
  return <AppShell role="admin" title="Settings" titleActions={tabs} onRefresh={() => setRefreshSignal((value) => value + 1)}>
    {activityOpen ? <ActivityLogsModule refreshSignal={refreshSignal} /> : <SettingsHome />}
  </AppShell>
}

function SettingsHome() {
  const settings = [
    { icon: Store, label: 'Store name', value: 'HM POS' },
    { icon: ReceiptText, label: 'Sales channel', value: 'Walk-in POS' },
    { icon: CircleDollarSign, label: 'Currency', value: 'Philippine peso (PHP)' },
    { icon: ShieldCheck, label: 'Access model', value: 'Admin / Manager and Cashier' },
  ]
  return <section className="simple-settings" aria-labelledby="simple-settings-title">
    <header className="simple-settings-header">
      <span><MonitorCog size={20} aria-hidden="true" /></span>
      <div><h2 id="simple-settings-title">System settings</h2><p>Current configuration for this HM POS workspace.</p></div>
    </header>
    <div className="simple-settings-list">
      {settings.map(({ icon: Icon, label, value }) => <div key={label}><span className="simple-settings-icon"><Icon size={18} aria-hidden="true" /></span><span><small>{label}</small><b>{value}</b></span></div>)}
    </div>
    <nav className="simple-settings-links" aria-label="Related settings">
      <NavLink to="/admin/users-access/users"><Users size={18} aria-hidden="true" /><span><b>Users & Access</b><small>Manage portal accounts and roles</small></span><ChevronRight size={17} aria-hidden="true" /></NavLink>
      <NavLink to="/admin/settings/activity"><History size={18} aria-hidden="true" /><span><b>Activity Logs</b><small>Review recorded system activity</small></span><ChevronRight size={17} aria-hidden="true" /></NavLink>
    </nav>
  </section>
}
