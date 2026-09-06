import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEFAULT_PRICING } from '../utils/pricing'
import { validateImageFile } from '../utils/imageUpload'

export const CONTENT_DEFAULTS = {
  hero: {
    eyebrow: 'HM POS operations workspace',
    title: 'A focused workspace for faster store operations.',
    body: 'Manage the menu, inventory, staff access, transactions, and cashier checkout from one trusted system.',
    primaryLabel: 'View full menu', primaryHref: '/menu', secondaryLabel: 'Send us a message', secondaryHref: '/help',
  },
  featured: { eyebrow: 'Featured items', title: 'Keep the menu current.', visible: true, itemIds: [] },
  inquiry: {
    kicker: 'Staff workspace', title: 'Keep store operations clear and current.',
    responseTitle: 'Reply by email', responseBody: 'Our team responds directly to the address you provide.', visible: true,
  },
  about: {
    eyebrow: 'About HM POS', title: 'A practical operating system for your store.',
    paragraphs: [
      'HM POS keeps catalog, stock, cashier, and transaction work connected without mixing operational data with presentation logic.',
      'Use the manager workspace to keep item availability, inventory thresholds, reports, and staff access up to date.',
    ],
  },
  footer: {
    tagline: 'HM POS · Store operations, kept clear.',
    facebookUrl: '', instagramUrl: '', tiktokUrl: '',
  },
}
export const SYSTEM_DEFAULTS = {
  store: {
    name: 'HM POS', email: '', phone: '',
    address: '', timezone: 'Asia/Manila',
  },
  ordering: {
    storeStatus: 'open', closureMessage: 'Online ordering is temporarily unavailable. Please check again later.',
    openTime: '10:00', closeTime: '23:30', deliveryEnabled: true, pickupEnabled: true, minimumOrder: 0,
  },
  payments: {
    enabledMethods: ['cod', 'gcash', 'bank_transfer'], codMaximum: 1000,
    gcashQrUrl: '', bankQrUrl: '',
    gcashInstructions: 'Open GCash, scan the QR code, and send the exact order total.',
    bankName: '', bankAccountName: '', bankAccountNumber: '', bankInstructions: 'Transfer the exact order total and save a clear receipt.',
  },
  notices: { checkoutNotice: '', inquiryReplyTarget: '' },
  pricing: { ...DEFAULT_PRICING },
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const mergeGroup = (defaults, rows) => {
  const result = clone(defaults)
  for (const row of rows || []) result[row.key] = { ...(result[row.key] || {}), ...(row.value || {}) }
  return result
}

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured for this workspace.')
}

export async function fetchPortalConfiguration(scope) {
  requireSupabase()
  const defaults = scope === 'content' ? CONTENT_DEFAULTS : SYSTEM_DEFAULTS
  const { data, error } = await supabase.from('portal_configuration').select('key,value,is_public,updated_at,updated_by').eq('scope', scope)
  if (error) {
    if (error.code === '42P01' || /portal_configuration/i.test(error.message || '')) return { values: clone(defaults), updatedAt: null, setupRequired: true }
    throw error
  }
  const updatedAt = (data || []).map((row) => row.updated_at).filter(Boolean).sort().at(-1) || null
  return { values: mergeGroup(defaults, data), updatedAt, setupRequired: false }
}

export async function savePortalConfiguration(scope, key, value, isPublic = true) {
  requireSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('portal_configuration').upsert({
    scope, key, value, is_public: Boolean(isPublic), updated_by: auth?.user?.id || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,key' }).select().single()
  if (error) throw error
  return data
}

const storagePathFromPublicUrl = (url) => {
  const marker = '/storage/v1/object/public/portal-assets/'
  const index = String(url || '').indexOf(marker)
  return index < 0 ? null : decodeURIComponent(String(url).slice(index + marker.length))
}

export async function savePaymentConfiguration(settings, qrFiles = {}) {
  requireSupabase()
  const next = { ...settings }
  const uploadedPaths = []
  const replacedPaths = []
  try {
    for (const [method, file] of Object.entries(qrFiles)) {
      if (!file) continue
      const { extension } = await validateImageFile(file, { label: 'Payment QR image' })
      const settingKey = method === 'gcash' ? 'gcashQrUrl' : 'bankQrUrl'
      const path = `payment-qr/${method}-${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('portal-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      uploadedPaths.push(path)
      const { data } = supabase.storage.from('portal-assets').getPublicUrl(path)
      if (!data?.publicUrl) throw new Error('The uploaded QR image URL could not be created.')
      const previousPath = storagePathFromPublicUrl(next[settingKey])
      if (previousPath) replacedPaths.push(previousPath)
      next[settingKey] = data.publicUrl
    }
    const row = await savePortalConfiguration('system', 'payments', next, true)
    if (replacedPaths.length) await supabase.storage.from('portal-assets').remove(replacedPaths)
    return { settings: next, row }
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from('portal-assets').remove(uploadedPaths)
    throw error
  }
}

export async function fetchContentMenuOptions() {
  requireSupabase()
  const { data, error } = await supabase.from('menu_items')
    .select('id,name,description,price,image_url,is_available,is_bestseller,is_featured,subcategories(display_name,name)')
    .eq('is_archived', false).order('sort_order')
  if (error) throw error
  return (data || []).map((item) => ({ ...item, category: item.subcategories?.display_name || item.subcategories?.name || 'Menu' }))
}

