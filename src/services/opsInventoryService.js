import { supabase } from '../lib/supabase'

const STOCK_SELECT = 'id,menu_item_id,quantity,min_stock_level,high_stock_level,unit,sku,supplier,notes,cost_per_unit,expiration_date,is_archived,created_at,updated_at,menu_items(id,name,price,is_available,is_archived)'

function normalize(row) {
  const menuItem = Array.isArray(row.menu_items) ? row.menu_items[0] : row.menu_items
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: menuItem?.name || 'Menu item',
    price: Number(menuItem?.price || 0),
    quantity: Number(row.quantity || 0),
    minStockLevel: Number(row.min_stock_level || 0),
    highStockLevel: Number(row.high_stock_level || 0),
    unit: row.unit || 'piece',
    sku: row.sku || '',
    supplier: row.supplier || '',
    notes: row.notes || '',
    costPerUnit: row.cost_per_unit == null ? null : Number(row.cost_per_unit),
    expirationDate: row.expiration_date || '',
    isArchived: Boolean(row.is_archived),
    isAvailable: Boolean(menuItem?.is_available),
    updatedAt: row.updated_at || row.created_at,
  }
}

export async function fetchStockItems() {
  const { data, error } = await supabase
    .from('stock')
    .select(STOCK_SELECT)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data || []).map(normalize)
}

export async function fetchMenuItemOptions() {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id,name,price,is_available,is_archived')
    .eq('is_archived', false)
    .order('name')
  if (error) throw error
  return data || []
}

export async function upsertStock(payload) {
  const { data, error } = await supabase.rpc('staff_upsert_stock', {
    p_id: payload.id || null,
    p_menu_item_id: payload.menuItemId,
    p_quantity: Number(payload.quantity || 0),
    p_min_stock_level: Number(payload.minStockLevel || 0),
    p_high_stock_level: Number(payload.highStockLevel || 0),
    p_unit: payload.unit || 'piece',
    p_supplier: payload.supplier || null,
    p_notes: payload.notes || null,
    p_sku: payload.sku || null,
    p_cost_per_unit: payload.costPerUnit === '' || payload.costPerUnit == null ? null : Number(payload.costPerUnit),
    p_expiration_date: payload.expirationDate || null,
  })
  if (error) throw error
  return data
}

export async function adjustStock(stockId, delta, reason) {
  const { data, error } = await supabase.rpc('staff_adjust_stock', {
    p_stock_id: stockId,
    p_delta: Number(delta),
    p_reason: reason || null,
  })
  if (error) throw error
  return data
}
