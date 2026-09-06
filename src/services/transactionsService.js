import { supabase } from '../lib/supabase'

const ORDER_SELECT = `id,order_number,receipt_number,status,cashier_id,subtotal,
  discount_type,discount_customer_name,discount_id_number,discount_subtotal,
  discount_amount,vat_exempt_amount,final_total,vat_rate,prices_include_vat,
  payment_status,payment_confirmed,is_voided,voided_reason,voided_by,voided_at,
  created_at,updated_at,
  order_items(id,menu_item_id,item_name,display_name,unit_price,quantity,addons_total,line_total,addons,customizations,is_discounted,discount_amount,vat_exempt_amount),
  payments:transactions!inner(id,method,status,amount_due,amount_received,change_amount,reference_number,bank_name,paid_at,voided_at)`

function cleanSearch(value) {
  return String(value || '').replace(/[%_,]/g, ' ').trim().slice(0, 80)
}

async function fetchCashierNames(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return {}
  const { data, error } = await supabase.from('users').select('id,full_name,username').in('id', uniqueIds)
  if (error) throw error
  return Object.fromEntries((data || []).map((user) => [user.id, user.full_name || user.username || 'Cashier']))
}

function normalize(row, cashierNames) {
  const payment = row.payments?.[0] || null
  return {
    id: row.id,
    orderNumber: row.order_number,
    receiptNumber: row.receipt_number,
    status: row.is_voided ? 'Voided' : row.status,
    isVoided: Boolean(row.is_voided),
    voidedReason: row.voided_reason || '',
    voidedAt: row.voided_at,
    cashierId: row.cashier_id,
    cashierName: cashierNames[row.cashier_id] || 'Cashier',
    subtotal: Number(row.subtotal || 0),
    discountType: row.discount_type || '',
    discountCustomerName: row.discount_customer_name || '',
    discountIdNumber: row.discount_id_number || '',
    discountSubtotal: Number(row.discount_subtotal || 0),
    discountAmount: Number(row.discount_amount || 0),
    vatExemptAmount: Number(row.vat_exempt_amount || 0),
    finalTotal: Number(row.final_total || 0),
    vatRate: Number(row.vat_rate || 0),
    pricesIncludeVat: Boolean(row.prices_include_vat),
    paymentStatus: row.payment_status,
    paymentMethod: payment?.method || '',
    paymentReference: payment?.reference_number || '',
    bankName: payment?.bank_name || '',
    amountReceived: Number(payment?.amount_received || 0),
    changeAmount: Number(payment?.change_amount || 0),
    paidAt: payment?.paid_at,
    items: (row.order_items || []).map((item) => ({
      id: item.id,
      menuItemId: item.menu_item_id,
      name: item.display_name || item.item_name,
      unitPrice: Number(item.unit_price || 0),
      quantity: Number(item.quantity || 0),
      addonsTotal: Number(item.addons_total || 0),
      lineTotal: Number(item.line_total || 0),
      addons: item.addons || [],
      customizations: item.customizations || {},
      isDiscounted: Boolean(item.is_discounted),
      discountAmount: Number(item.discount_amount || 0),
    })),
    itemCount: (row.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchTransactions({ search = '', paymentMethod = 'all', status = 'all', dateFrom = '', dateTo = '', limit = 250 } = {}) {
  let query = supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }).limit(limit)
  if (paymentMethod !== 'all') query = query.eq('transactions.method', paymentMethod)
  if (status === 'completed') query = query.eq('is_voided', false)
  if (status === 'voided') query = query.eq('is_voided', true)
  if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+08:00`)
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999+08:00`)
  const term = cleanSearch(search)
  if (term) query = query.or(`order_number.ilike.%${term}%,receipt_number.ilike.%${term}%`)
  const { data, error } = await query
  if (error) throw error
  const cashierNames = await fetchCashierNames((data || []).map((row) => row.cashier_id))
  return (data || []).map((row) => normalize(row, cashierNames))
}

export async function fetchTransactionById(orderId) {
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const names = await fetchCashierNames([data.cashier_id])
  return normalize(data, names)
}

export async function fetchTransactionAudit(orderId) {
  const { data, error } = await supabase
    .from('transaction_audit_log')
    .select('id,action,reason,previous_value,new_value,performed_by,created_at,users(full_name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((entry) => ({ ...entry, staffName: entry.users?.full_name || 'HM POS' }))
}

export async function voidOrder(orderId, reason) {
  const { error } = await supabase.rpc('staff_void_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw error
}
