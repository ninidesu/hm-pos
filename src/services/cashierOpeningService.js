const OPENING_SHIFT_STORAGE_PREFIX = 'hm-pos:cashier-opening-v1'

export function getCashierOpeningStorageKey(cashierId, businessDate) {
  if (!cashierId || !businessDate) return ''
  return `${OPENING_SHIFT_STORAGE_PREFIX}:${cashierId}:${businessDate}`
}

export function getCashierOpening(cashierId, businessDate) {
  const key = getCashierOpeningStorageKey(cashierId, businessDate)
  if (!key) return null
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null')
    return value?.cashierId === cashierId && value?.businessDate === businessDate ? value : null
  } catch {
    return null
  }
}

export function saveCashierOpening({ cashierId, businessDate, startingCash }) {
  const key = getCashierOpeningStorageKey(cashierId, businessDate)
  if (!key) return null
  const record = {
    cashierId,
    businessDate,
    startingCash: Number(startingCash).toFixed(2),
    confirmedAt: new Date().toISOString(),
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(record))
    return record
  } catch {
    return null
  }
}

export function saveEodStartingCash(cashierId, businessDate, startingCash) {
  if (!cashierId || !businessDate) return false
  try {
    window.localStorage.setItem(`hm-pos:eod-cash:${cashierId}:${businessDate}:starting`, Number(startingCash).toFixed(2))
    return true
  } catch {
    return false
  }
}
