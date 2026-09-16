import { supabase } from '../lib/supabase.js'
import { getAccountDisplayName } from '../lib/accountIdentity.js'

export const EOD_HOURS = {
  openingTime: '6:00 AM',
  closingTime: '10:00 PM',
}

const normalizeMethod = (val) => {
  const m = String(val || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (m === 'bank' || m === 'banktransfer') return 'bank_transfer'
  return m || 'cash'
}

/**
 * Computes EOD summary from orders array
 */
export function computeEodMetrics(orders = [], { businessDate = '', cashierName = 'Cashier' } = {}) {
  let completedCount = 0
  let voidedCount = 0
  let grossSales = 0
  let discounts = 0
  let voidAmount = 0
  let refundAmount = 0
  let netSales = 0
  let totalCollected = 0

  const paymentBreakdown = {
    cash: { label: 'Cash', count: 0, amount: 0 },
    gcash: { label: 'GCash', count: 0, amount: 0 },
    bank_transfer: { label: 'Bank Transfer', count: 0, amount: 0 },
    other: { label: 'Other', count: 0, amount: 0 },
  }

  orders.forEach((order) => {
    const isVoided = Boolean(order.is_voided)
    const isPaid = String(order.payment_status || '').toLowerCase() === 'paid' || Boolean(order.payment_confirmed)
    const subtotal = Number(order.subtotal || 0)
    const discount = Number(order.discount_amount || 0)
    const total = Number(order.final_total || 0)
    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments
    const method = normalizeMethod(payment?.method || order.payment_method)

    if (isVoided) {
      voidedCount += 1
      voidAmount += total || subtotal
      return
    }

    if (isPaid) {
      completedCount += 1
      grossSales += subtotal
      discounts += discount
      netSales += total
      totalCollected += total

      if (paymentBreakdown[method]) {
        paymentBreakdown[method].count += 1
        paymentBreakdown[method].amount += total
      } else {
        paymentBreakdown.other.count += 1
        paymentBreakdown.other.amount += total
      }
    }
  })

  // Round all currency figures
  const round = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100

  return {
    businessDate,
    openingTime: EOD_HOURS.openingTime,
    closingTime: EOD_HOURS.closingTime,
    cashierName,
    completedTransactions: completedCount,
    voidedTransactions: voidedCount,
    grossSales: round(grossSales),
    discounts: round(discounts),
    refundsAndVoids: round(voidAmount + refundAmount),
    voidAmount: round(voidAmount),
    refundAmount: round(refundAmount),
    netSales: round(netSales),
    totalCollected: round(totalCollected),
    paymentBreakdown: {
      cash: { ...paymentBreakdown.cash, amount: round(paymentBreakdown.cash.amount) },
      gcash: { ...paymentBreakdown.gcash, amount: round(paymentBreakdown.gcash.amount) },
      bank_transfer: { ...paymentBreakdown.bank_transfer, amount: round(paymentBreakdown.bank_transfer.amount) },
      other: { ...paymentBreakdown.other, amount: round(paymentBreakdown.other.amount) },
    },
    rawOrders: orders,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Fetches EOD summary for a given business date from Supabase
 */
export async function fetchEodSummary({ businessDate, cashierId = null, cashierName = 'Cashier' }) {
  if (!businessDate) {
    throw new Error('Business date is required to generate the End of Day summary.')
  }

  // 1. Try RPC call first if configured
  try {
    const { data, error } = await supabase.rpc('get_cashier_eod_summary', {
      p_business_date: businessDate,
      p_cashier_id: cashierId || null,
    })
    if (!error && data) {
      return {
        ...data,
        cashierName: cashierName || data.cashier_name || 'Cashier',
        openingTime: EOD_HOURS.openingTime,
        closingTime: EOD_HOURS.closingTime,
        businessDate,
      }
    }
  } catch {
    // Fall back to direct query below
  }

  // 2. Direct query fallback
  const dateFrom = `${businessDate}T06:00:00+08:00`
  const dateTo = `${businessDate}T23:59:59.999+08:00`

  let query = supabase
    .from('orders')
    .select(`
      id, order_number, receipt_number, subtotal, discount_type,
      discount_amount, final_total, payment_status, payment_confirmed,
      is_voided, voided_reason, voided_at, cashier_id, created_at,
      payments:transactions(id, method, amount_due, amount_received, status)
    `)
    .not('cashier_id', 'is', null)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: true })

  if (cashierId) {
    query = query.eq('cashier_id', cashierId)
  }

  const { data: orders, error } = await query
  if (error) throw error

  return computeEodMetrics(orders || [], { businessDate, cashierName })
}
