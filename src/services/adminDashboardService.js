import { supabase } from '../lib/supabase'

const ORDER_SELECT = `id,order_number,receipt_number,status,final_total,discount_amount,
  payment_status,is_voided,created_at,updated_at,
  order_items(item_name,display_name,quantity,line_total),
  payments:transactions(method,status)`

function dayStart(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(0, 0, 0, 0)
  return date
}

function isoDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isRevenueOrder(order) {
  return !order.is_voided && order.status === 'Completed' && order.payment_status === 'paid'
}

export async function fetchDashboardData() {
  const windowStart = dayStart(-29)
  const [ordersResult, stockResult, menuResult, auditResult] = await Promise.all([
    supabase.from('orders').select(ORDER_SELECT).gte('created_at', windowStart.toISOString()).order('created_at', { ascending: true }),
    supabase.from('stock').select('id,quantity,min_stock_level,high_stock_level,unit,supplier,expiration_date,menu_items(name)').eq('is_archived', false),
    supabase.from('menu_items').select('id,name,is_available,manual_available,unavailable_reason').eq('is_archived', false),
    supabase.from('portal_audit_events').select('id,occurred_at,actor_name_snapshot,module,summary,result,severity').order('occurred_at', { ascending: false }).limit(12),
  ])
  if (ordersResult.error) throw ordersResult.error
  if (stockResult.error) throw stockResult.error
  if (menuResult.error) throw menuResult.error
  return {
    orders: ordersResult.data || [],
    stockRows: stockResult.data || [],
    menuItems: menuResult.data || [],
    auditEvents: auditResult.data || [],
  }
}

export function computeDashboardMetrics({ orders, stockRows = [], menuItems = [], auditEvents = [] }) {
  const today = isoDay(dayStart())
  const yesterday = isoDay(dayStart(-1))
  const todayOrders = orders.filter((order) => isoDay(new Date(order.created_at)) === today)
  const yesterdayOrders = orders.filter((order) => isoDay(new Date(order.created_at)) === yesterday)
  const paidToday = todayOrders.filter(isRevenueOrder)
  const paidYesterday = yesterdayOrders.filter(isRevenueOrder)
  const totalSales = paidToday.reduce((sum, order) => sum + Number(order.final_total || 0), 0)
  const yesterdaySales = paidYesterday.reduce((sum, order) => sum + Number(order.final_total || 0), 0)
  const salesChangePct = yesterdaySales > 0 ? ((totalSales - yesterdaySales) / yesterdaySales) * 100 : totalSales > 0 ? 100 : 0
  const totalOrders = todayOrders.filter((order) => !order.is_voided).length
  const completedOrders = paidToday.length
  const avgOrderValue = completedOrders ? totalSales / completedOrders : 0

  const inventoryItems = stockRows.map((row) => ({
    id: row.id,
    name: row.menu_items?.name || 'Menu item',
    unit: row.unit || 'piece',
    supplier: row.supplier || '',
    expirationDate: row.expiration_date,
    quantity: Number(row.quantity || 0),
    min: Number(row.min_stock_level || 0),
    healthy: Number(row.high_stock_level || 0),
  }))
  const lowStockItems = inventoryItems
    .filter((item) => item.min > 0 && item.quantity <= item.min)
    .sort((left, right) => (left.quantity / left.min) - (right.quantity / right.min))
  const outOfStockItems = lowStockItems.filter((item) => item.quantity <= 0)

  const salesByDay = new Map()
  const ordersByDay = new Map()
  const paidOrdersByDay = new Map()
  orders.filter((order) => !order.is_voided).forEach((order) => {
    const day = isoDay(new Date(order.created_at))
    ordersByDay.set(day, (ordersByDay.get(day) || 0) + 1)
  })
  orders.filter(isRevenueOrder).forEach((order) => {
    const day = isoDay(new Date(order.created_at))
    salesByDay.set(day, (salesByDay.get(day) || 0) + Number(order.final_total || 0))
    paidOrdersByDay.set(day, (paidOrdersByDay.get(day) || 0) + 1)
  })
  const salesTrend = []
  const ordersTrend = []
  const averageOrderTrend = []
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = isoDay(dayStart(-offset))
    const sales = salesByDay.get(day) || 0
    const count = paidOrdersByDay.get(day) || 0
    salesTrend.push({ day, total: sales })
    ordersTrend.push({ day, total: ordersByDay.get(day) || 0 })
    averageOrderTrend.push({ day, total: count ? sales / count : 0 })
  }

  const itemTotals = new Map()
  const hourlyTotals = new Map()
  orders.filter(isRevenueOrder).forEach((order) => {
    const hour = new Date(order.created_at).getHours()
    const hourly = hourlyTotals.get(hour) || { hour, orders: 0, revenue: 0 }
    hourly.orders += 1
    hourly.revenue += Number(order.final_total || 0)
    hourlyTotals.set(hour, hourly)
    ;(order.order_items || []).forEach((item) => {
      const name = item.display_name || item.item_name
      const current = itemTotals.get(name) || { name, qty: 0, revenue: 0 }
      current.qty += Number(item.quantity || 0)
      current.revenue += Number(item.line_total || 0)
      itemTotals.set(name, current)
    })
  })
  const rankedItems = [...itemTotals.values()].sort((left, right) => right.qty - left.qty)
  const peakHours = [...hourlyTotals.values()].sort((left, right) => right.orders - left.orders || right.revenue - left.revenue).slice(0, 5)

  return {
    totalSales,
    salesChangePct,
    totalOrders,
    completedOrders,
    avgOrderValue,
    salesTrend,
    ordersTrend,
    averageOrderTrend,
    bestSellers: rankedItems.slice(0, 5),
    lowSellers: [...rankedItems].sort((left, right) => left.qty - right.qty || left.revenue - right.revenue).slice(0, 5),
    peakHours,
    recentOrders: [...orders].sort((left, right) => new Date(right.created_at) - new Date(left.created_at)).slice(0, 7),
    lowStockItems,
    outOfStockItems,
    unavailableMenuItems: menuItems.filter((item) => !item.is_available).length,
    criticalAuditEvents: auditEvents.filter((event) => event.severity === 'critical' || event.result === 'failed'),
    attentionOrders: [],
    pendingRefunds: [],
  }
}
