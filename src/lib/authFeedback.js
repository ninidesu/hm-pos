const AUTH_WELCOME_STORAGE_KEY = 'hrm-pos-auth-welcome'

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeWelcomeName(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed || isEmailLike(trimmed)) return ''
  return trimmed
}

export function resolveAuthWelcomeName(...sources) {
  for (const source of sources) {
    if (!source) continue
    if (typeof source === 'string') {
      const direct = normalizeWelcomeName(source)
      if (direct) return direct
      continue
    }
    const candidate = [
      source.full_name,
      source.display_name,
      source.username,
      source.first_name,
      source.name,
    ].map(normalizeWelcomeName).find(Boolean)
    if (candidate) return candidate
  }
  return ''
}

export function buildAuthWelcomeMessage(name, storeName = 'HM POS') {
  const brand = String(storeName || 'HM POS').trim() || 'HM POS'
  return name ? `Welcome to ${brand}, ${name}!` : `Welcome to ${brand}!`
}

export function queueAuthWelcome(...sources) {
  if (typeof window === 'undefined') return
  const name = resolveAuthWelcomeName(...sources)
  const storeName = sources.map((source) => source && typeof source === 'object' ? source.storeName || source.store_name : '').find(Boolean) || 'HM POS'
  window.sessionStorage.setItem(AUTH_WELCOME_STORAGE_KEY, JSON.stringify({ name, storeName, queuedAt: Date.now() }))
}

export function readAuthWelcome() {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(AUTH_WELCOME_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return {
      name: normalizeWelcomeName(parsed?.name),
      storeName: String(parsed?.storeName || 'HM POS').trim() || 'HM POS',
      token: String(parsed?.queuedAt || ''),
    }
  } catch {
    return { name: '', storeName: 'HM POS', token: '' }
  }
}

export function clearAuthWelcome() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(AUTH_WELCOME_STORAGE_KEY)
}
