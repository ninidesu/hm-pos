export const OPERATING_HOURS = {
  OPEN_HOUR: 6,
  OPEN_MINUTE: 0,
  CLOSE_HOUR: 22,
  CLOSE_MINUTE: 0,
  OPEN_LABEL: '6:00 AM',
  CLOSE_LABEL: '10:00 PM',
  RANGE_LABEL: '6:00 AM – 10:00 PM',
  CLOSED_RANGE_LABEL: '10:00 PM – 6:00 AM',
  CLOSED_MESSAGE: 'POS is currently closed. Operating hours are 6:00 AM – 10:00 PM.',
}

/**
 * Checks whether the POS is within active operating hours (6:00 AM to before 10:00 PM).
 * Evaluates based on the provided date (local system time).
 */
export function getOperatingHoursStatus(date = new Date()) {
  const current = date instanceof Date ? date : new Date(date)
  const hour = current.getHours()
  const minute = current.getMinutes()
  const second = current.getSeconds()

  const currentSeconds = (hour * 3600) + (minute * 60) + second
  const openSeconds = (OPERATING_HOURS.OPEN_HOUR * 3600) + (OPERATING_HOURS.OPEN_MINUTE * 60)
  const closeSeconds = (OPERATING_HOURS.CLOSE_HOUR * 3600) + (OPERATING_HOURS.CLOSE_MINUTE * 60)

  const isOpen = currentSeconds >= openSeconds && currentSeconds < closeSeconds

  let secondsUntilChange = 0
  if (isOpen) {
    secondsUntilChange = closeSeconds - currentSeconds
  } else if (currentSeconds < openSeconds) {
    secondsUntilChange = openSeconds - currentSeconds
  } else {
    // After 10:00 PM, until next day 6:00 AM
    secondsUntilChange = (86400 - currentSeconds) + openSeconds
  }

  return {
    isOpen,
    isClosed: !isOpen,
    hour,
    minute,
    second,
    openLabel: OPERATING_HOURS.OPEN_LABEL,
    closeLabel: OPERATING_HOURS.CLOSE_LABEL,
    rangeLabel: OPERATING_HOURS.RANGE_LABEL,
    closedRangeLabel: OPERATING_HOURS.CLOSED_RANGE_LABEL,
    closedMessage: OPERATING_HOURS.CLOSED_MESSAGE,
    secondsUntilChange,
  }
}

/**
 * Returns the business date string (YYYY-MM-DD) for a given timestamp.
 * If the current time is before 6:00 AM, it is considered part of the previous day's shift
 * for auditing/EOD reporting purposes.
 */
export function getBusinessDateKey(date = new Date()) {
  const current = date instanceof Date ? new Date(date) : new Date(date)
  if (current.getHours() < OPERATING_HOURS.OPEN_HOUR) {
    current.setDate(current.getDate() - 1)
  }
  const year = current.getFullYear()
  const month = String(current.getMonth() + 1).padStart(2, '0')
  const day = String(current.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
