import { supabase } from '../lib/supabase.js'
import { getAccountDisplayName } from '../lib/accountIdentity.js'
import { formatOperatingTime, normalizeOperatingHours } from '../utils/operatingHours'

export const EOD_HOURS = {
  openingTime: '06:00 AM',
  closingTime: '10:00 PM',
}

export const EOD_ITEM_NAMES = [
  'Ube Malunggay Mochi',
  'Lava Rice Pops',
  'Guava Shake',
]

const normalizeMethod = (value) => {
  const method = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (method === 'bank' || method === 'banktransfer') return 'bank'
  return method === 'gcash' ? 'gcash' : 'cash'
}

const cleanItemName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
const clampRate = (value) => {
  const rate = Number(value)
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0.12
}

function createItemSales() {
  return Object.fromEntries(EOD_ITEM_NAMES.map((name) => [name, { name, quantity: 0, amount: 0 }]))
}

function getLineAmount(item) {
  const quantity = Number(item?.quantity || item?.qty || 0)
  const lineTotal = Number(item?.line_total ?? item?.lineTotal)
  if (Number.isFinite(lineTotal) && lineTotal > 0) return lineTotal
  return Number(item?.unit_price || item?.unitPrice || 0) * quantity
}

function getVatBreakdown(order, subtotal, discount) {
  const rate = clampRate(order?.vat_rate)
  const pricesIncludeVat = order?.prices_include_vat !== false
  const eligibleGross = ['pwd', 'senior'].includes(String(order?.discount_type || '').trim().toLowerCase())
    ? Math.min(Math.max(Number(order?.discount_subtotal || 0), 0), subtotal)
    : 0
  const vatableGross = Math.max(0, subtotal - eligibleGross)
  const vatableSales = pricesIncludeVat ? round(vatableGross / (1 + rate)) : round(vatableGross)
  const vatAmount = pricesIncludeVat ? round(vatableGross - vatableSales) : 0
  const vatExemptSales = pricesIncludeVat ? round(eligibleGross / (1 + rate)) : round(eligibleGross)

  return { vatRate: pricesIncludeVat ? rate : 0, vatableSales, vatAmount, vatExemptSales, zeroRatedSales: 0, discount }
}

export function computeEodMetrics(orders = [], { businessDate = '', cashierName = 'Cashier', openingTime = '06:00', closingTime = '22:00' } = {}) {
  const configuredHours = normalizeOperatingHours({ openTime: openingTime, closeTime: closingTime })
  const itemSales = createItemSales()
  const paymentBreakdown = {
    cash: { label: 'Cash', count: 0, amount: 0 },
    gcash: { label: 'GCash', count: 0, amount: 0 },
    bank: { label: 'Bank', count: 0, amount: 0 },
  }
  let completedTransactions = 0
  let voidedTransactions = 0
  let grossSales = 0
  let discounts = 0
  let netSales = 0
  let totalCollected = 0
  let refundsAndVoids = 0
  let vatableSales = 0
  let vatAmount = 0
  let vatExemptSales = 0

  orders.forEach((order) => {
    const isVoided = Boolean(order.is_voided)
    const isPaid = String(order.payment_status || '').toLowerCase() === 'paid' || Boolean(order.payment_confirmed)
    const subtotal = round(order.subtotal)
    const discount = round(order.discount_amount)
    const total = round(order.final_total)

    if (isVoided) {
      voidedTransactions += 1
      refundsAndVoids += total || subtotal
      return
    }
    if (!isPaid) return

    completedTransactions += 1
    grossSales += subtotal
    discounts += discount
    netSales += total
    totalCollected += total

    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments
    const method = normalizeMethod(payment?.method || order.payment_method)
    paymentBreakdown[method].count += 1
    paymentBreakdown[method].amount += total

    const tax = getVatBreakdown(order, subtotal, discount)
    vatableSales += tax.vatableSales
    vatAmount += tax.vatAmount
    vatExemptSales += tax.vatExemptSales

    for (const item of order.order_items || []) {
      const itemName = EOD_ITEM_NAMES.find((name) => cleanItemName(name) === cleanItemName(item.display_name || item.item_name))
      if (!itemName) continue
      itemSales[itemName].quantity += Number(item.quantity || 0)
      itemSales[itemName].amount += getLineAmount(item)
    }
  })

  const normalizedItems = Object.fromEntries(Object.entries(itemSales).map(([name, item]) => [
    name,
    { ...item, quantity: Math.round(item.quantity), amount: round(item.amount) },
  ]))

  return {
    businessDate,
    openingTime: formatOperatingTime(configuredHours.openTime),
    closingTime: formatOperatingTime(configuredHours.closeTime),
    cashierName,
    completedTransactions,
    grossSales: round(grossSales),
    discounts: round(discounts),
    netSales: round(netSales),
    totalCollected: round(totalCollected),
    refundsAndVoids: round(refundsAndVoids),
    voidedTransactions,
    totalItemsSold: Object.values(normalizedItems).reduce((sum, item) => sum + item.quantity, 0),
    totalItemSales: round(Object.values(normalizedItems).reduce((sum, item) => sum + item.amount, 0)),
    itemSales: normalizedItems,
    vatSummary: {
      vatRate: 0.12,
      vatableSales: round(vatableSales),
      vatAmount: round(vatAmount),
      vatExemptSales: round(vatExemptSales),
      zeroRatedSales: 0,
    },
    paymentBreakdown: {
      cash: { ...paymentBreakdown.cash, amount: round(paymentBreakdown.cash.amount) },
      gcash: { ...paymentBreakdown.gcash, amount: round(paymentBreakdown.gcash.amount) },
      bank: { ...paymentBreakdown.bank, amount: round(paymentBreakdown.bank.amount) },
    },
    cashCollected: round(paymentBreakdown.cash.amount),
    rawOrders: orders,
    generatedAt: new Date().toISOString(),
  }
}

export async function fetchEodSummary({ businessDate, cashierId = null, cashierName = 'Cashier', openingTime = '06:00', closingTime = '22:00' }) {
  if (!businessDate) throw new Error('Business date is required to generate the End of Day receipt.')

  const configuredHours = normalizeOperatingHours({ openTime: openingTime, closeTime: closingTime })
  // Match the calendar date shown in Transaction History. Operating-hour
  // enforcement still controls new sales; historical out-of-hours records
  // remain visible for audit instead of disappearing from EOD.
  const dateFrom = `${businessDate}T00:00:00+08:00`
  const dateTo = `${businessDate}T23:59:59.999+08:00`
  let query = supabase
    .from('orders')
    .select('id,order_number,receipt_number,subtotal,discount_type,discount_subtotal,discount_amount,final_total,vat_rate,prices_include_vat,vat_exempt_amount,payment_status,payment_confirmed,is_voided,voided_reason,voided_at,cashier_id,created_at,order_items(item_name,display_name,unit_price,quantity,line_total,is_discounted,discount_amount,vat_exempt_amount),payments:transactions(id,method,amount_due,amount_received,status)')
    .not('cashier_id', 'is', null)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: true })

  if (cashierId) query = query.eq('cashier_id', cashierId)

  const { data: orders, error } = await query
  if (error) throw error

  return computeEodMetrics(orders || [], {
    businessDate,
    cashierName: getAccountDisplayName({ username: cashierName }, 'Cashier'),
    openingTime: configuredHours.openTime,
    closingTime: configuredHours.closeTime,
  })
}
