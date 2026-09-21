export const DEFAULT_OPERATING_HOURS = Object.freeze({
  openTime: '06:00',
  closeTime: '22:00',
})

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const MANILA_TIME_ZONE = 'Asia/Manila'

function getManilaDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: partValue }) => [type, Number(partValue)]))
  return values
}

function formatDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function minutesFromTime(value) {
  const [hour, minute] = value.split(':').map(Number)
  return (hour * 60) + minute
}

export function normalizeOperatingHours(value = {}) {
  const openTime = TIME_PATTERN.test(String(value?.openTime || '')) ? String(value.openTime) : DEFAULT_OPERATING_HOURS.openTime
  const closeTime = TIME_PATTERN.test(String(value?.closeTime || '')) ? String(value.closeTime) : DEFAULT_OPERATING_HOURS.closeTime

  if (minutesFromTime(closeTime) <= minutesFromTime(openTime)) return { ...DEFAULT_OPERATING_HOURS }
  return { openTime, closeTime }
}

export function formatOperatingTime(value) {
  const normalized = TIME_PATTERN.test(String(value || '')) ? String(value) : DEFAULT_OPERATING_HOURS.openTime
  const [hour, minute] = normalized.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

const defaultOpenLabel = formatOperatingTime(DEFAULT_OPERATING_HOURS.openTime)
const defaultCloseLabel = formatOperatingTime(DEFAULT_OPERATING_HOURS.closeTime)

export const OPERATING_HOURS = Object.freeze({
  OPEN_HOUR: 6,
  OPEN_MINUTE: 0,
  CLOSE_HOUR: 22,
  CLOSE_MINUTE: 0,
  OPEN_LABEL: defaultOpenLabel,
  CLOSE_LABEL: defaultCloseLabel,
  RANGE_LABEL: `${defaultOpenLabel} – ${defaultCloseLabel}`,
  CLOSED_RANGE_LABEL: `${defaultCloseLabel} – ${defaultOpenLabel}`,
  CLOSED_MESSAGE: `POS is currently closed. Operating hours are ${defaultOpenLabel} – ${defaultCloseLabel}.`,
})

/**
 * Checks whether the POS is within the configured active operating hours.
 * Evaluates based on the provided date (local system time).
 */
export function getOperatingHoursStatus(date = new Date(), configuredHours = {}) {
  const hours = normalizeOperatingHours(configuredHours)
  const { hour, minute, second } = getManilaDateParts(date)

  const currentSeconds = (hour * 3600) + (minute * 60) + second
  const openSeconds = minutesFromTime(hours.openTime) * 60
  const closeSeconds = minutesFromTime(hours.closeTime) * 60
  const isOpen = currentSeconds >= openSeconds && currentSeconds < closeSeconds

  let secondsUntilChange = 0
  if (isOpen) {
    secondsUntilChange = closeSeconds - currentSeconds
  } else if (currentSeconds < openSeconds) {
    secondsUntilChange = openSeconds - currentSeconds
  } else {
    secondsUntilChange = (86400 - currentSeconds) + openSeconds
  }

  const openLabel = formatOperatingTime(hours.openTime)
  const closeLabel = formatOperatingTime(hours.closeTime)
  return {
    isOpen,
    isClosed: !isOpen,
    hour,
    minute,
    second,
    openTime: hours.openTime,
    closeTime: hours.closeTime,
    openLabel,
    closeLabel,
    rangeLabel: `${openLabel} – ${closeLabel}`,
    closedRangeLabel: `${closeLabel} – ${openLabel}`,
    closedMessage: `POS is currently closed. Operating hours are ${openLabel} – ${closeLabel}.`,
    secondsUntilChange,
  }
}

/**
 * Returns the business date string (YYYY-MM-DD) for a given timestamp.
 * If the current time is before the configured opening time, it is considered
 * part of the previous day's shift for auditing/EOD reporting purposes.
 */
export function getBusinessDateKey(date = new Date(), configuredHours = {}) {
  const hours = normalizeOperatingHours(configuredHours)
  const current = getManilaDateParts(date)
  const currentMinutes = (current.hour * 60) + current.minute
  if (currentMinutes >= minutesFromTime(hours.openTime)) return formatDateKey(current.year, current.month, current.day)

  const previousDate = new Date(Date.UTC(current.year, current.month - 1, current.day - 1))
  return formatDateKey(previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1, previousDate.getUTCDate())
}

/**
 * Returns the local calendar date (YYYY-MM-DD) without shifting closed hours.
 * EOD reports use this so their date matches the date shown in Transaction History.
 */
export function getCalendarDateKey(date = new Date()) {
  const current = getManilaDateParts(date)
  return formatDateKey(current.year, current.month, current.day)
}

/**
 * Formats a business date for display (e.g., "Thursday, September 17, 2026").
 */
export function formatBusinessDate(dateInput) {
  if (!dateInput) return ''
  let dateObj
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-').map(Number)
    dateObj = new Date(y, m - 1, d)
  } else {
    dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput)
  }
  return dateObj.toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
