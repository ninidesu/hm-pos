import { supabase } from '../lib/supabase'
import { getAccountDisplayName } from '../lib/accountIdentity'

export const PORTAL_ROLES = [
  { value: 'admin', label: 'Admin / Manager' },
  { value: 'cashier', label: 'Cashier' },
]

const roleLabel = (role) => role === 'manager' ? 'Admin / Manager' : PORTAL_ROLES.find((item) => item.value === role)?.label || String(role || 'Unknown').replaceAll('_', ' ')

const usersAccessSetupMessage = 'Users & Access needs its database migration before this action is available.'

function isMissingUsersAccessSchema(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST202' || error?.code === 'PGRST204' ||
    message.includes('portal_audit_events') || message.includes('admin_create_portal_user') ||
    message.includes('admin_update_portal_user') || message.includes('admin_remove_portal_user') || message.includes('last_active_at')
}

function setupAwareError(error) {
  if (!isMissingUsersAccessSchema(error)) return error
  const nextError = new Error(usersAccessSetupMessage)
  nextError.cause = error
  return nextError
}

export async function fetchManagedUsers() {
  let { data, error } = await supabase
    .from('users')
    .select('id,email,full_name,username,role,created_at,updated_at,last_active_at,removed_at')
    .in('role', ['admin', 'cashier'])
    .is('removed_at', null)
    .order('full_name', { ascending: true })

  if (isMissingUsersAccessSchema(error)) {
    const legacyResult = await supabase
      .from('users')
      .select('id,email,full_name,username,role')
      .in('role', ['admin', 'cashier'])
      .order('full_name', { ascending: true })
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  return (data || []).map((user) => ({
    ...user,
    roleLabel: roleLabel(user.role),
  }))
}

export async function createPortalUser(values) {
  const { data, error } = await supabase.rpc('admin_create_portal_user', {
    p_full_name: values.fullName,
    p_username: values.username,
    p_password: values.password,
    p_role: values.role,
  })
  if (error) throw setupAwareError(error)
  return data
}

export async function removePortalUser(userId) {
  const { data, error } = await supabase.rpc('admin_remove_portal_user', {
    p_user_id: userId,
  })
  if (error) throw setupAwareError(error)
  return data
}

export async function updatePortalUser(userId, values) {
  const { data, error } = await supabase.rpc('admin_update_portal_user_credentials', {
    p_user_id: userId,
    p_username: values.username,
    p_password: values.password || null,
  })
  if (error) throw setupAwareError(error)
  return data
}

export async function updatePortalUserRole(userId, role) {
  const { data, error } = await supabase.rpc('admin_update_portal_user', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw setupAwareError(error)
  return data
}

function applyAuditFilters(query, filters) {
  if (filters.surface && filters.surface !== 'all') query = query.eq('surface', filters.surface)
  if (filters.module && filters.module !== 'all') query = query.eq('module', filters.module)
  if (filters.result && filters.result !== 'all') query = query.eq('result', filters.result)
  if (filters.severity && filters.severity !== 'all') query = query.eq('severity', filters.severity)
  if (filters.actorId) query = query.eq('actor_id', filters.actorId)
  if (filters.dateFrom) query = query.gte('occurred_at', `${filters.dateFrom}T00:00:00+08:00`)
  if (filters.dateTo) query = query.lte('occurred_at', `${filters.dateTo}T23:59:59.999+08:00`)
  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[,%_]/g, ' ').slice(0, 80)
    query = query.or(`summary.ilike.%${term}%,entity_label.ilike.%${term}%,actor_name_snapshot.ilike.%${term}%,action.ilike.%${term}%`)
  }
  return query
}

const auditSelect = 'id,occurred_at,actor_id,actor_name_snapshot,actor_role_snapshot,surface,module,action,entity_type,entity_id,entity_label,summary,result,severity,before_data,after_data,metadata,correlation_id'

async function withUsernameActors(events) {
  const actorIds = [...new Set((events || []).map((event) => event.actor_id).filter(Boolean))]
  if (!actorIds.length) return events || []
  const { data, error } = await supabase.from('users').select('id,username,full_name,email').in('id', actorIds)
  if (error) return events || []
  const labels = new Map((data || []).map((user) => [user.id, getAccountDisplayName(user, '')]))
  return (events || []).map((event) => {
    const label = labels.get(event.actor_id)
    if (!label) return event
    const previousLabel = String(event.actor_name_snapshot || '')
    const summary = previousLabel && String(event.summary || '').startsWith(previousLabel)
      ? label + String(event.summary).slice(previousLabel.length)
      : event.summary
    return { ...event, actor_name_snapshot: label, summary }
  })
}

export async function fetchPortalAuditEvents(filters, { page = 1, pageSize = 25 } = {}) {
  let query = supabase.from('portal_audit_events').select(auditSelect, { count: 'exact' })
  query = applyAuditFilters(query, filters)
  const start = (page - 1) * pageSize
  const { data, error, count } = await query.order('occurred_at', { ascending: false }).range(start, start + pageSize - 1)
  if (error) throw setupAwareError(error)
  return { events: await withUsernameActors(data || []), count: count || 0 }
}

export async function fetchUserRecentActivity(userId, limit = 4) {
  const activityLimit = Math.max(1, Math.min(Number(limit) || 4, 10))
  const [auditResult, orderResult] = await Promise.allSettled([
    fetchPortalAuditEvents({ actorId: userId }, { pageSize: Math.max(activityLimit * 2, 8) }),
    supabase
      .from('orders')
      .select('id,order_number,receipt_number,final_total,is_voided,created_at')
      .eq('cashier_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.max(activityLimit * 2, 8)),
  ])

  const auditEvents = auditResult.status === 'fulfilled' ? auditResult.value.events : []
  const orderRows = orderResult.status === 'fulfilled' && !orderResult.value.error ? orderResult.value.data || [] : []
  const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
  const transactionEvents = orderRows.map((order) => ({
    id: `transaction-${order.id}`,
    occurred_at: order.created_at,
    severity: order.is_voided ? 'warning' : 'info',
    activity_type: 'transaction',
    summary: `${order.is_voided ? 'Voided' : 'Completed'} transaction ${order.receipt_number || order.order_number || ''} · ${currency.format(Number(order.final_total || 0))}`,
  }))

  const byNewest = [...auditEvents, ...transactionEvents]
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
  const recent = byNewest.slice(0, activityLimit)

  if (transactionEvents.length && !recent.some((event) => event.activity_type === 'transaction')) {
    recent[recent.length - 1] = transactionEvents[0]
    recent.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
  }

  return recent
}

export async function fetchPortalAuditExport(filters) {
  let query = supabase.from('portal_audit_events').select(auditSelect)
  query = applyAuditFilters(query, filters)
  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(5000)
  if (error) throw setupAwareError(error)
  return withUsernameActors(data || [])
}

export function downloadAuditCsv(events) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const header = ['Date & Time', 'Actor', 'Role', 'Surface', 'Module', 'Action', 'Target', 'Result', 'Severity', 'Summary']
  const rows = events.map((event) => [
    event.occurred_at, event.actor_name_snapshot || 'System', roleLabel(event.actor_role_snapshot), event.surface,
    event.module, event.action, event.entity_label || event.entity_id || '', event.result, event.severity, event.summary,
  ])
  const blob = new Blob([[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `hm-pos-activity-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
