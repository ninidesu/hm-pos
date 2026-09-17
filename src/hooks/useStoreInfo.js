import { useEffect, useState } from 'react'
import { SYSTEM_DEFAULTS, fetchPublicStoreConfiguration } from '../services/adminPortalConfigurationService'

const EVENT_NAME = 'hm-pos:store-info-updated'
const CACHE_KEY = 'hm-pos:public-store-info'

function readCachedStore() {
  try {
    return { ...SYSTEM_DEFAULTS.store, ...JSON.parse(window.localStorage.getItem(CACHE_KEY) || '{}') }
  } catch {
    return { ...SYSTEM_DEFAULTS.store }
  }
}

let cachedStore = readCachedStore()

export function publishStoreInfo(store) {
  cachedStore = { ...SYSTEM_DEFAULTS.store, ...store }
  document.title = cachedStore.name || 'HM POS'
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cachedStore))
  } catch {
    // The latest value remains available in memory when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cachedStore }))
}

export default function useStoreInfo() {
  const [store, setStore] = useState(cachedStore)
  useEffect(() => {
    let active = true
    const update = (event) => setStore(event.detail)
    window.addEventListener(EVENT_NAME, update)
    fetchPublicStoreConfiguration().then((latestStore) => {
      if (!active) return
      publishStoreInfo(latestStore)
    }).catch(() => {})
    return () => { active = false; window.removeEventListener(EVENT_NAME, update) }
  }, [])
  return store
}
