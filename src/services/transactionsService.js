import { supabase } from '../lib/supabase'
import { getAccountDisplayName } from '../lib/accountIdentity'

const ORDER_SELECT = `id,order_number,receipt_number,status,order_source,cashier_id,subtotal,
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
  return Object.fromEntries((data || []).map((user) => [user.id, getAccountDisplayName(user, 'Cashier')]))
}

function normalizePaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (method === 'bank' || method === 'banktransfer') return 'bank_transfer'
  return method
}

function normalize(row, cashierNames) {
  const payment = Array.isArray(row.payments) ? row.payments[0] : row.payments || null
  return {
    id: row.id,
    orderNumber: row.order_number,
    receiptNumber: row.receipt_number,
    status: row.is_voided ? 'Voided' : row.order_source === 'cashier_pos' && row.payment_status === 'paid' ? 'Completed' : row.status,
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
    paymentMethod: normalizePaymentMethod(payment?.method),
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
  query = query.eq('order_source', 'cashier_pos')
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
    .select('id,action,reason,previous_value,new_value,performed_by,created_at,users(full_name,username)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((entry) => ({ ...entry, staffName: getAccountDisplayName(entry.users, 'HM POS') }))
}

export async function voidOrder(orderId, reason) {
  const { error } = await supabase.rpc('staff_void_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw error
}

const EXPORT_COLUMNS = [
  { label: 'Receipt Number', value: (record) => record.receiptNumber || '' },
  { label: 'Order Number', value: (record) => record.orderNumber || '' },
  { label: 'Date & Time', value: (record) => safeDate(record.createdAt) || '', date: true },
  { label: 'Cashier', value: (record) => record.cashierName || '' },
  { label: 'Order Type', value: () => 'Walk-in' },
  { label: 'Items', value: (record) => Number(record.itemCount || 0), integer: true },
  { label: 'Payment Method', value: (record) => paymentLabel(record.paymentMethod) },
  { label: 'Subtotal', value: (record) => Number(record.subtotal || 0), money: true },
  { label: 'Discount', value: (record) => Number(record.discountAmount || 0), money: true },
  { label: 'Net Total', value: (record) => Number(record.finalTotal || 0), money: true },
  { label: 'Status', value: (record) => record.isVoided ? 'Voided' : 'Completed' },
  { label: 'Void Reason', value: (record) => record.voidedReason || '' },
]

function paymentLabel(value) {
  return ({ cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer' })[value] || value || 'Not recorded'
}

function safeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function csvCell(value) {
  let text = value instanceof Date
    ? value.toLocaleString('en-PH')
    : String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}

function exportFilename(extension) {
  return `hm-pos-transaction-history-${new Date().toISOString().slice(0, 10)}.${extension}`
}

export function exportTransactionsToCsv({ records = [], summary = {}, filterLabel = 'All walk-in transactions', generatedBy = 'HM POS Admin' }) {
  const rows = [
    ['HM POS TRANSACTION HISTORY'],
    ['Generated', new Date().toLocaleString('en-PH')],
    ['Generated by', generatedBy],
    ['Active filters', filterLabel],
    [],
    ['REPORT SUMMARY'],
    ['Net Sales', Number(summary.sales || 0).toFixed(2)],
    ['Completed Transactions', Number(summary.completed || 0)],
    ['Voided Transactions', Number(summary.voided || 0)],
    ['Average Sale', Number(summary.average || 0).toFixed(2)],
    [],
    EXPORT_COLUMNS.map((column) => column.label),
    ...records.map((record) => EXPORT_COLUMNS.map((column) => {
      const value = column.value(record)
      if (column.date) return value instanceof Date ? value.toLocaleString('en-PH') : ''
      if (column.money) return Number(value || 0).toFixed(2)
      return value
    })),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportFilename('csv'))
}

export async function exportTransactionsToXlsx({ records = [], summary = {}, filterLabel = 'All walk-in transactions', generatedBy = 'HM POS Admin' }) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = generatedBy
  workbook.created = new Date()
  workbook.subject = 'HM POS walk-in transaction history'

  const purple = '542475'
  const deepPurple = '2D0A4E'
  const softPurple = 'F3ECF7'
  const borderColor = 'E3D8EA'
  const border = { style: 'thin', color: { argb: borderColor } }
  const sheet = workbook.addWorksheet('Transaction History', {
    views: [{ state: 'frozen', ySplit: 10, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.mergeCells('A1:L1')
  const titleCell = sheet.getCell('A1')
  titleCell.value = 'HM POS — TRANSACTION HISTORY'
  titleCell.font = { bold: true, size: 17, color: { argb: 'FFFFFF' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: deepPurple } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 32

  sheet.getCell('A3').value = 'Generated'
  sheet.getCell('B3').value = new Date()
  sheet.getCell('B3').numFmt = 'mmm d, yyyy h:mm AM/PM'
  sheet.getCell('D3').value = 'Generated by'
  sheet.getCell('E3').value = generatedBy
  sheet.getCell('A4').value = 'Active filters'
  sheet.mergeCells('B4:L4')
  sheet.getCell('B4').value = filterLabel

  const metrics = [
    ['Net Sales', Number(summary.sales || 0), true],
    ['Completed', Number(summary.completed || 0), false],
    ['Voided', Number(summary.voided || 0), false],
    ['Average Sale', Number(summary.average || 0), true],
  ]
  metrics.forEach(([label, value, isMoney], index) => {
    const startColumn = 1 + (index * 3)
    const labelCell = sheet.getCell(6, startColumn)
    const valueCell = sheet.getCell(7, startColumn)
    sheet.mergeCells(6, startColumn, 6, startColumn + 1)
    sheet.mergeCells(7, startColumn, 7, startColumn + 1)
    labelCell.value = label.toUpperCase()
    labelCell.font = { bold: true, size: 9, color: { argb: purple } }
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softPurple } }
    labelCell.alignment = { vertical: 'middle' }
    valueCell.value = value
    valueCell.font = { bold: true, size: 14, color: { argb: deepPurple } }
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: softPurple } }
    valueCell.numFmt = isMoney ? '₱#,##0.00' : '#,##0'
    for (let row = 6; row <= 7; row += 1) {
      for (let column = startColumn; column <= startColumn + 1; column += 1) {
        sheet.getCell(row, column).border = {
          top: border, bottom: border,
          left: column === startColumn ? border : undefined,
          right: column === startColumn + 1 ? border : undefined,
        }
      }
    }
  })

  const headerRow = sheet.getRow(10)
  headerRow.values = EXPORT_COLUMNS.map((column) => column.label)
  headerRow.height = 24
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: purple } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })

  records.forEach((record, index) => {
    const row = sheet.getRow(index + 11)
    row.values = EXPORT_COLUMNS.map((column) => column.value(record))
    row.height = 22
    row.eachCell((cell) => {
      cell.border = { bottom: border }
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FAF8FC' } }
    })
    EXPORT_COLUMNS.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1)
      if (column.date) cell.numFmt = 'mmm d, yyyy h:mm AM/PM'
      if (column.money) cell.numFmt = '₱#,##0.00'
      if (column.integer) cell.numFmt = '#,##0'
    })
    const statusCell = row.getCell(11)
    statusCell.font = { bold: true, color: { argb: record.isVoided ? '9F1239' : purple } }
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: record.isVoided ? 'FFF1F2' : softPurple } }
  })

  sheet.autoFilter = { from: 'A10', to: `L${Math.max(10, records.length + 10)}` }
  sheet.columns = [
    { width: 18 }, { width: 18 }, { width: 23 }, { width: 20 },
    { width: 13 }, { width: 10 }, { width: 18 }, { width: 15 },
    { width: 15 }, { width: 15 }, { width: 13 }, { width: 34 },
  ]
  sheet.headerFooter.oddFooter = '&LHM POS&CPage &P of &N&RTransaction History'

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    exportFilename('xlsx'),
  )
}
