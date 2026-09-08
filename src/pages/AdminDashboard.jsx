import {
  AlertTriangle, ArrowRight, Clock3, Coffee, PackageCheck,
  ReceiptText, RefreshCw, Store,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import SettingsPage from './SettingsPage'
import UsersAccessPage from './UsersAccessPage'
import InventoryStockPage from './InventoryStockPage'
import ManageMenuPage from './ManageMenuPage'
import TransactionsPage from './TransactionsPage'
import StaffSettingsPage from './StaffSettingsPage'
import { computeDashboardMetrics, fetchDashboardData } from '../services/adminDashboardService'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import { getAccountDisplayName } from '../lib/accountIdentity'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const adminPageTitles = {
  '/admin': 'Dashboard',
  '/admin/inventory': 'Stock Management',
  '/admin/menu': 'Manage Menu',
  '/admin/transactions': 'Transaction History',
  '/admin/inventory-report': 'Inventory Report',
  '/admin/users-access/users': 'Users & Access',
  '/admin/settings': 'Settings',
  '/admin/preferences': 'Settings',
}

const paymentLabels = { gcash: 'GCash', bank_transfer: 'Bank transfer', cod: 'Cash / COD', cash: 'Cash', other: 'Other' }

function dashboardPaymentMethod(payments) {
  const payment = Array.isArray(payments) ? payments[0] : payments
  const method = String(payment?.method || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return paymentLabels[method] || (method === 'bank' || method === 'banktransfer' ? paymentLabels.bank_transfer : 'Not recorded')
}
function formatCount(value) {
  return Math.round(value).toLocaleString('en-PH')
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function timeAgo(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60000) return 'Just now'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`
  return formatShortDate(value)
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatHour(hour) {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric' }).format(date)
}

function chartAxisCurrency(value) {
  if (value >= 1000) return `₱${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`
  return `₱${Math.round(value).toLocaleString('en-PH')}`
}

function chartAxisStep(value) {
  if (value <= 4) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value / 4))
  const normalized = (value / 4) / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

function smoothSparklineGeometry(points, x, y) {
  if (points.length < 2) return { path: `M ${x(0)} ${y(points[0])}`, pointProgress: [0] }
  let path = `M ${x(0)} ${y(points[0])}`
  const cumulativeLengths = [0]
  let totalLength = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = Math.max(0, index - 1)
    const next = Math.min(points.length - 1, index + 2)
    const currentX = x(index)
    const nextX = x(index + 1)
    const controlOneX = currentX + (nextX - x(previous)) / 6
    const segmentTop = Math.min(y(points[index]), y(points[index + 1]))
    const segmentBottom = Math.max(y(points[index]), y(points[index + 1]))
    const rawControlOneY = y(points[index]) + (y(points[index + 1]) - y(points[previous])) / 6
    const controlOneY = Math.min(segmentBottom, Math.max(segmentTop, rawControlOneY))
    const controlTwoX = nextX - (x(next) - currentX) / 6
    const rawControlTwoY = y(points[index + 1]) - (y(points[next]) - y(points[index])) / 6
    const controlTwoY = Math.min(segmentBottom, Math.max(segmentTop, rawControlTwoY))
    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${nextX} ${y(points[index + 1])}`
    let previousX = currentX
    let previousY = y(points[index])
    for (let sample = 1; sample <= 16; sample += 1) {
      const time = sample / 16
      const inverse = 1 - time
      const sampleX = inverse ** 3 * currentX + 3 * inverse ** 2 * time * controlOneX + 3 * inverse * time ** 2 * controlTwoX + time ** 3 * nextX
      const sampleY = inverse ** 3 * y(points[index]) + 3 * inverse ** 2 * time * controlOneY + 3 * inverse * time ** 2 * controlTwoY + time ** 3 * y(points[index + 1])
      totalLength += Math.hypot(sampleX - previousX, sampleY - previousY)
      previousX = sampleX
      previousY = sampleY
    }
    cumulativeLengths.push(totalLength)
  }
  return {
    path,
    pointProgress: cumulativeLengths.map((length) => totalLength ? length / totalLength : 0),
  }
}

function smoothSparklinePath(points, x, y) {
  return smoothSparklineGeometry(points, x, y).path
}

export default function AdminDashboard() {
  const { pathname } = useLocation()
  if (pathname === '/admin/team') return <Navigate to="/admin/users-access/users" replace />
  if (pathname === '/admin/logs' || pathname === '/admin/users-access/activity' || pathname === '/admin/settings/activity') return <Navigate to="/admin/settings" replace />
  if (pathname === '/admin/users-access') return <Navigate to="/admin/users-access/users" replace />
  if (pathname === '/admin/users-access/approvals') return <Navigate to="/admin/users-access/users" replace />
  if (pathname.startsWith('/admin/users-access/')) return <UsersAccessPage />
  if (pathname.startsWith('/admin/settings')) return <SettingsPage />
  if (pathname === '/admin/preferences') return <StaffSettingsPage role="admin" />
  if (pathname === '/admin/menu') return <ManageMenuPage role="admin" />
  if (pathname === '/admin/inventory') return <InventoryStockPage role="admin" />
  if (pathname === '/admin/inventory-report') return <InventoryStockPage role="admin" />
  if (pathname === '/admin/transactions' || pathname.startsWith('/admin/transactions/')) return <TransactionsPage />
  if (pathname !== '/admin') return <AppShell role="admin" title={adminPageTitles[pathname] || 'Dashboard'} />
  return <AdminDashboardHome />
}

function AdminDashboardHome() {
  const { profile, user } = useAuth()
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const raw = await fetchDashboardData()
      setMetrics(computeDashboardMetrics(raw))
      setLastUpdated(new Date())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'The dashboard could not be loaded.'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    const refresh = () => load({ quiet: true })
    const channel = supabase.channel('admin-dashboard-live')
    ;['orders', 'transactions', 'stock', 'menu_items'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const attentionCount = metrics ? metrics.attentionOrders.length + metrics.pendingRefunds.length + metrics.outOfStockItems.length + metrics.criticalAuditEvents.length : 0

  return <AppShell
    role="admin"
    title="Dashboard"
    onRefresh={load}
    notificationCount={attentionCount}
    titleActions={<div className="ad-live-state"><i />Live monitoring{lastUpdated && <span>Updated {timeAgo(lastUpdated)}</span>}</div>}
  >
    {error && <div className="ad-error" role="alert"><AlertTriangle size={19} /><div><b>Dashboard unavailable</b><span>{error}</span></div><button type="button" onClick={() => load()}><RefreshCw size={15} />Try again</button></div>}
    {loading ? <DashboardSkeleton /> : metrics && <DashboardContent metrics={metrics} username={getAccountDisplayName(profile || user?.user_metadata || user, 'Admin')} />}
  </AppShell>
}

function DashboardContent({ metrics, username }) {
  const quickLinks = [
    { label: 'Transactions', detail: 'View all transactions', icon: ReceiptText, to: '/admin/transactions' },
    { label: 'Inventory', detail: 'Check inventory levels', icon: PackageCheck, to: '/admin/inventory' },
  ]

  const summaries = [
    { label: 'Net sales', value: money(metrics.totalSales), detail: 'Completed sales today' },
    { label: 'Orders', value: formatCount(metrics.totalOrders), detail: `${metrics.completedOrders} completed` },
    { label: 'Average order', value: money(metrics.avgOrderValue), detail: 'Per completed order' },
    { label: 'Peak hour', value: metrics.peakHours[0] ? formatHour(metrics.peakHours[0].hour) : 'No data', detail: metrics.peakHours[0] ? `${metrics.peakHours[0].orders} completed orders` : 'Waiting for completed sales' },
  ]

  return <div className="hm-admin-dashboard">
    <section className="hm-dashboard-welcome" aria-labelledby="hm-dashboard-welcome-title">
      <span className="hm-dashboard-welcome-icon" aria-hidden="true"><Store size={24} /></span>
      <div><small>Store operations</small><h2 id="hm-dashboard-welcome-title">Welcome back, {username}</h2></div>
      <nav aria-label="Dashboard shortcuts">{quickLinks.map(({ label, detail, icon: Icon, to }) => <Link to={to} key={label}><Icon size={18} /><span><b>{label}</b><small>{detail}</small></span><ArrowRight size={15} /></Link>)}</nav>
    </section>

    <section className="hm-dashboard-summary" aria-label="Today's overview">{summaries.map(({ label, value, detail }) => <article key={label}><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>)}</section>

    <section className="hm-dashboard-primary-grid">
      <SalesOverview points={metrics.salesTrend} />
      <article className="hm-dashboard-panel hm-dashboard-transactions">
        <header><div><h2>Recent transactions</h2><p>Latest completed walk-in sales</p></div><Link to="/admin/transactions">View all <ArrowRight size={14} /></Link></header>
        <div className="hm-dashboard-table-wrap"><table><thead><tr><th>Transaction</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th>Time</th></tr></thead><tbody>{metrics.recentOrders.slice(0, 7).map((order) => { const items = order.order_items || []; return <tr key={order.id}><td><b>{order.order_number}</b></td><td>{items.length ? items.map((item) => item.display_name || item.item_name).slice(0, 2).join(', ') : 'No item details'}</td><td>{dashboardPaymentMethod(order.payments)}</td><td><b>{money(order.final_total)}</b></td><td><span>{order.is_voided ? 'Voided' : order.status}</span></td><td>{formatTime(order.created_at)}</td></tr> })}</tbody></table>{!metrics.recentOrders.length && <SimpleEmpty icon={ReceiptText} text="No recent transactions yet." />}</div>
      </article>

    </section>

    <section className="hm-dashboard-secondary-grid">
      <ProductPerformance title="Best-selling items" detail="Highest sales volume" products={metrics.bestSellers} />
      <ProductPerformance title="Low-selling items" detail="Lowest sales volume" products={metrics.lowSellers} low />
      <PeakHours hours={metrics.peakHours} />
    </section>
  </div>
}

function SalesOverview({ points }) {
  const [range, setRange] = useState(7)
  const [activeIndex, setActiveIndex] = useState(null)
  const visible = points.slice(-range)
  const width = 720
  const height = 230
  const inset = { left: 54, right: 22, top: 28, bottom: 34 }
  const maxValue = Math.max(1, ...visible.map((point) => point.total))
  const axisMax = chartAxisStep(maxValue) * 4
  const plotHeight = height - inset.top - inset.bottom
  const x = (index) => inset.left + (index / Math.max(1, visible.length - 1)) * (width - inset.left - inset.right)
  const y = (value) => inset.top + (1 - value / axisMax) * plotHeight
  const line = smoothSparklinePath(visible.map((point) => point.total), x, y)
  const area = `${line} L ${x(visible.length - 1)} ${height - inset.bottom} L ${x(0)} ${height - inset.bottom} Z`
  const selectedIndex = activeIndex ?? visible.length - 1
  const selected = visible[selectedIndex]
  const total = visible.reduce((sum, point) => sum + point.total, 0)

  return <article className="hm-dashboard-panel hm-dashboard-sales">
    <header><div><h2>Sales overview</h2><p>Completed sales over the selected period</p></div><div className="hm-chart-ranges" aria-label="Sales chart period">{[[7, '7 days'], [14, '14 days'], [30, 'Month']].map(([days, label]) => <button type="button" className={range === days ? 'active' : ''} key={days} onClick={() => { setRange(days); setActiveIndex(null) }}>{label}</button>)}</div></header>
    <div className="hm-sales-chart-summary"><div><small>Period sales</small><strong>{money(total)}</strong></div>{selected && <div><small>{formatShortDate(selected.day)}</small><strong>{money(selected.total)}</strong></div>}</div>
    <div className="hm-sales-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Sales overview for the last ${range} days`} preserveAspectRatio="none">
      <defs><linearGradient id="hmSalesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6b368f" stopOpacity=".24"/><stop offset="1" stopColor="#6b368f" stopOpacity=".02"/></linearGradient></defs>
      {[0, .25, .5, .75, 1].map((step) => <g key={step}><line className="hm-chart-gridline" x1={inset.left} x2={width - inset.right} y1={inset.top + step * plotHeight} y2={inset.top + step * plotHeight}/><text className="hm-chart-y-label" x="2" y={inset.top + step * plotHeight + 4}>{chartAxisCurrency(axisMax * (1 - step))}</text></g>)}
      <path d={area} fill="url(#hmSalesArea)"/>
      <path className="hm-chart-line" d={line} vectorEffect="non-scaling-stroke"/>
      {visible.map((point, index) => <g className={selectedIndex === index ? 'is-active' : ''} key={point.day} tabIndex="0" role="button" aria-label={`${formatShortDate(point.day)}: ${money(point.total)}`} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => setActiveIndex(index)}><rect x={Math.max(0, x(index) - 20)} y="0" width="40" height={height} fill="transparent"/><circle cx={x(index)} cy={y(point.total)} r={selectedIndex === index ? 6 : 4}/></g>)}
    </svg><div className="hm-chart-dates">{visible.map((point) => <span key={point.day}>{formatShortDate(point.day)}</span>)}</div></div>
  </article>
}

function ProductPerformance({ title, detail, products, low = false }) {
  return <article className="hm-dashboard-panel hm-dashboard-performance"><header><div><h2>{title}</h2><p>{detail}</p></div></header><div className="hm-performance-list">{products.slice(0, 4).map((item, index) => <div key={item.name}><span>{index + 1}</span><div><b>{item.name}</b><small>{item.qty} sold</small></div><strong>{money(item.revenue)}</strong></div>)}{!products.length && <SimpleEmpty icon={Coffee} text={low ? 'No low-selling items yet.' : 'No completed product sales yet.'}/>}</div></article>
}

function PeakHours({ hours }) {
  const maxOrders = Math.max(1, ...hours.map((item) => item.orders))
  return <article className="hm-dashboard-panel hm-dashboard-peak"><header><div><h2>Peak hours</h2><p>Busiest times by completed orders</p></div></header><div className="hm-peak-list">{hours.slice(0, 5).map((item) => <div key={item.hour}><span><b>{formatHour(item.hour)}</b><small>{item.orders} order{item.orders === 1 ? '' : 's'}</small></span><i><em style={{ width: `${(item.orders / maxOrders) * 100}%` }}/></i><strong>{money(item.revenue)}</strong></div>)}{!hours.length && <SimpleEmpty icon={Clock3} text="Peak hours will appear after completed sales."/>}</div></article>
}

function SimpleEmpty({ icon: Icon, text }) {
  return <div className="hm-dashboard-empty"><Icon size={20} /><span>{text}</span></div>
}

function DashboardSkeleton() {
  return <div className="ad-skeleton" aria-label="Loading dashboard"><i className="wide" /><div>{Array.from({ length: 4 }).map((_, index) => <i key={index} />)}</div><div>{Array.from({ length: 3 }).map((_, index) => <i key={index} />)}</div><i className="tall" /><i className="tall" /></div>
}
