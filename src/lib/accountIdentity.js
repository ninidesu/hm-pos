function clean(value) {
  return String(value || '').trim()
}

function emailName(value) {
  return clean(value).split('@')[0]
}

export function getAccountDisplayName(account, fallback = 'User') {
  const candidates = [
    account?.full_name,
    account?.fullName,
    account?.display_name,
    account?.username,
    emailName(account?.email),
    fallback,
  ]
  return candidates.map(clean).find(Boolean) || fallback
}

export function getAccountInitials(account, fallback = 'US') {
  const name = getAccountDisplayName(account, '')
  const initials = name
    .replace(/@.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return initials || fallback
}
