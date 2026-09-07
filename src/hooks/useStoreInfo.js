import { useEffect, useState } from 'react'
import { SYSTEM_DEFAULTS, fetchPortalConfiguration } from '../services/adminPortalConfigurationService'

const EVENT_NAME = 'hm-pos:store-info-updated'
let cachedStore = { ...SYSTEM_DEFAULTS.store }

export function publishStoreInfo(store) {
  cachedStore = { ...SYSTEM_DEFAULTS.store, ...store }
  document.title = cachedStore.name || 'HM POS'
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cachedStore }))
}

export default function useStoreInfo() {
  const [store, setStore] = useState(cachedStore)
  useEffect(() => {
    let active = true
    const update = (event) => setStore(event.detail)
    window.addEventListener(EVENT_NAME, update)
    fetchPortalConfiguration('system').then(({ values }) => {
      if (!active) return
      cachedStore = { ...SYSTEM_DEFAULTS.store, ...values.store }
      document.title = cachedStore.name || 'HM POS'
      setStore(cachedStore)
    }).catch(() => {})
    return () => { active = false; window.removeEventListener(EVENT_NAME, update) }
  }, [])
  return store
}
