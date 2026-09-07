import { supabase } from '../lib/supabase'

const CENTER_EVENT = 'hrm-pos:notification-center-changed'
const MAX_NOTIFICATIONS = 50

function storageKey(userId) {
  return `hrm-pos:notifications:${userId || 'anonymous'}`
}

function readStored(userId) {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStored(userId, notifications) {
  if (typeof window === 'undefined') return notifications
  window.localStorage.setItem(storageKey(userId), JSON.stringify(notifications))
  window.dispatchEvent(new CustomEvent(CENTER_EVENT, { detail: { userId, notifications } }))
  return notifications
}

export function getStaffNotifications(userId) {
  return readStored(userId)
}

export function addStaffNotification(userId, notification) {
  const item = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: notification.title,
    message: notification.message,
    category: notification.category || 'general',
    createdAt: notification.createdAt || new Date().toISOString(),
    read: false,
  }
  return writeStored(userId, [item, ...readStored(userId)].slice(0, MAX_NOTIFICATIONS))
}

export async function addCurrentUserNotification(notification) {
  const { data } = await supabase.auth.getUser()
  const userId = data?.user?.id
  if (!userId) return []
  return addStaffNotification(userId, notification)
}

export function markStaffNotificationRead(userId, notificationId) {
  return writeStored(userId, readStored(userId).map((item) => item.id === notificationId ? { ...item, read: true } : item))
}

export function markAllStaffNotificationsRead(userId) {
  return writeStored(userId, readStored(userId).map((item) => ({ ...item, read: true })))
}

export function clearStaffNotifications(userId) {
  return writeStored(userId, [])
}

export function subscribeToStaffNotifications(userId, callback) {
  if (typeof window === 'undefined') return () => {}
  const receiveCustomEvent = (event) => {
    if (event.detail?.userId === userId) callback(event.detail.notifications)
  }
  const receiveStorageEvent = (event) => {
    if (event.key === storageKey(userId)) callback(readStored(userId))
  }
  window.addEventListener(CENTER_EVENT, receiveCustomEvent)
  window.addEventListener('storage', receiveStorageEvent)
  return () => {
    window.removeEventListener(CENTER_EVENT, receiveCustomEvent)
    window.removeEventListener('storage', receiveStorageEvent)
  }
}
