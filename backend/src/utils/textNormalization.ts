export function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
}

export function normalizeUrl(value: string | null | undefined) {
  if (!value?.trim()) {
    return ''
  }

  try {
    const parsedUrl = new URL(value.trim())
    parsedUrl.hash = ''
    parsedUrl.search = ''

    return `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

export function tokenOverlapScore(firstValue: string, secondValue: string) {
  const firstTokens = normalizeText(firstValue)
    .split(' ')
    .filter((token) => token.length >= 3)
  const secondTokens = new Set(
    normalizeText(secondValue)
      .split(' ')
      .filter((token) => token.length >= 3),
  )

  if (!firstTokens.length || !secondTokens.size) {
    return 0
  }

  const matchedCount = firstTokens.filter((token) => secondTokens.has(token)).length

  return matchedCount / Math.max(firstTokens.length, secondTokens.size)
}
