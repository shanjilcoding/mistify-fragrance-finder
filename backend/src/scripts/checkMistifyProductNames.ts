import { and, inArray, isNotNull, sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, pool } from '../db/connection'
import { fragrances } from '../db/schema'

type FragranceToCheck = Awaited<ReturnType<typeof fetchFragrancesToCheck>>[number]

type MatchStatus =
  | 'exact_inspired_by_match'
  | 'strong_name_match'
  | 'possible_match'
  | 'no_match'
  | 'error'

type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

type MistifyCandidate = {
  title: string
  url: string
  inspiredByText: string
}

type ReviewRow = {
  fragrance_id: number
  source_brand_batch: string
  original_fragrance_name: string
  old_mistify_product_name: string
  match_status: MatchStatus
  match_confidence: MatchConfidence
  suggested_mistify_product_name: string
  suggested_mistify_url: string
  suggested_inspired_by_text: string
  reason: string
  checked_at: string
}

const TARGET_PLACEHOLDERS = ['Not verified on Mistify', 'Not verified']
const MISTIFY_BASE_URL = 'https://www.mistifyparfums.com'
const OUTPUT_PATH = join(process.cwd(), 'tmp', 'mistify-product-name-check.csv')
const IGNORED_PRODUCT_HANDLE_PARTS = [
  'home-reed-diffuser',
  'reed-diffuser',
  'car-diffuser',
  'diffuser-any-scent',
  'gift-card',
  'sample',
  'discovery',
  'bundle',
  'collection',
  'oil',
  'room-spray',
  'room spray',
]
const BLOCKED_PRODUCT_TITLE_LABELS = [
  'quick shop',
  'quick view',
  'add to cart',
  'add to bag',
  'sold out',
  'sale',
  'regular price',
  'unit price',
  'view full details',
]
const CSV_HEADERS: (keyof ReviewRow)[] = [
  'fragrance_id',
  'source_brand_batch',
  'original_fragrance_name',
  'old_mistify_product_name',
  'match_status',
  'match_confidence',
  'suggested_mistify_product_name',
  'suggested_mistify_url',
  'suggested_inspired_by_text',
  'reason',
  'checked_at',
]

async function fetchFragrancesToCheck() {
  return db
    .select({
      id: fragrances.id,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      originalFragranceName: fragrances.originalFragranceName,
      mistifyProductName: fragrances.mistifyProductName,
    })
    .from(fragrances)
    .where(
      and(
        inArray(fragrances.mistifyProductName, TARGET_PLACEHOLDERS),
        isNotNull(fragrances.originalFragranceName),
        sql`trim(${fragrances.originalFragranceName}) <> ''`,
      ),
    )
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value: string) {
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

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
}

function isBlockedProductTitle(value: string) {
  return BLOCKED_PRODUCT_TITLE_LABELS.includes(normalizeText(value))
}

function escapeCsvValue(value: string | number) {
  const stringValue = String(value)

  if (!/[",\r\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replace(/"/g, '""')}"`
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function getPoliteDelay() {
  return 5000 + Math.floor(Math.random() * 3000)
}

async function fetchWithPoliteDelay(url: string) {
  const delayMilliseconds = getPoliteDelay()

  console.log(
    `Waiting ${delayMilliseconds}ms before requesting Mistify: ${url}`,
  )
  await sleep(delayMilliseconds)

  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mistify product-name verification dry-run (contact: local admin)',
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`)
  }

  return response.text()
}

function getAbsoluteMistifyUrl(url: string) {
  if (url.startsWith('http')) {
    return url
  }

  return new URL(url, MISTIFY_BASE_URL).toString()
}

function canonicalizeMistifyProductUrl(url: string) {
  const parsedUrl = new URL(getAbsoluteMistifyUrl(url))
  const pathname = parsedUrl.pathname.replace(/\/$/, '')

  return `${parsedUrl.origin}${pathname}`
}

function getProductHandleFromUrl(url: string) {
  const parsedUrl = new URL(getAbsoluteMistifyUrl(url))
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean)

  return pathParts[pathParts.length - 1] ?? ''
}

function getTitleFromProductHandle(url: string) {
  const productHandle = getProductHandleFromUrl(url)

  return productHandle
    .split('-')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function isIgnoredProductUrl(url: string) {
  const parsedUrl = new URL(getAbsoluteMistifyUrl(url))
  const pathname = decodeURIComponent(parsedUrl.pathname).toLowerCase()
  const normalizedPathname = pathname.replace(/[-_]+/g, ' ')

  return IGNORED_PRODUCT_HANDLE_PARTS.some((ignoredHandlePart) => {
    const normalizedIgnoredHandlePart = ignoredHandlePart.replace(/[-_]+/g, ' ')

    return (
      pathname.includes(ignoredHandlePart) ||
      normalizedPathname.includes(normalizedIgnoredHandlePart)
    )
  })
}

function buildSearchQuery(fragrance: FragranceToCheck) {
  return [
    fragrance.originalFragranceName?.trim(),
    fragrance.sourceBrandBatch?.trim(),
  ]
    .filter(Boolean)
    .join(' ')
}

function buildMistifySearchUrl(searchQuery: string) {
  const searchParams = new URLSearchParams()

  searchParams.set('type', 'product')
  searchParams.append('options[prefix]', 'none')
  searchParams.set('q', searchQuery)
  searchParams.append('options[prefix]', 'last')

  return `${MISTIFY_BASE_URL}/search?${searchParams.toString()}`
}

function extractSearchCandidates(html: string) {
  const candidates: MistifyCandidate[] = []
  const seenUrls = new Set<string>()
  const productLinkPattern =
    /<a\b[^>]*href=["']([^"']*\/products\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(productLinkPattern)) {
    const url = canonicalizeMistifyProductUrl(match[1])
    const title = stripHtml(match[2])

    if (seenUrls.has(url) || isIgnoredProductUrl(url)) {
      continue
    }

    seenUrls.add(url)
    candidates.push({
      title:
        title && !isBlockedProductTitle(title)
          ? title
          : getTitleFromProductHandle(url),
      url,
      inspiredByText: '',
    })
  }

  return candidates.slice(0, 5)
}

function extractInspiredByText(html: string) {
  const bodyText = stripHtml(html)
  const inspiredMatch = bodyText.match(
    /(inspired\s+by|impression\s+of|our\s+version\s+of)\s+(.{0,160})/i,
  )

  return inspiredMatch ? inspiredMatch[0].trim() : ''
}

function extractMetaContent(html: string, attributeName: 'property' | 'name', value: string) {
  const metaPattern = new RegExp(
    `<meta\\b[^>]*${attributeName}=["']${value}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i',
  )
  const reversedMetaPattern = new RegExp(
    `<meta\\b[^>]*content=["']([^"']+)["'][^>]*${attributeName}=["']${value}["'][^>]*>`,
    'i',
  )
  const match = html.match(metaPattern) ?? html.match(reversedMetaPattern)

  return match ? decodeHtml(match[1]) : ''
}

function cleanPageTitle(value: string) {
  return decodeHtml(value)
    .replace(/\s+[-–|]\s+Mistify Parfums.*$/i, '')
    .replace(/\s+[-–|]\s+Mistify.*$/i, '')
    .trim()
}

function findProductNameInJsonLd(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const productName = findProductNameInJsonLd(item)

      if (productName) {
        return productName
      }
    }

    return ''
  }

  const record = value as Record<string, unknown>
  const type = record['@type']
  const types = Array.isArray(type) ? type : [type]
  const isProduct = types.some(
    (item) => typeof item === 'string' && item.toLowerCase() === 'product',
  )

  if (isProduct && typeof record.name === 'string') {
    return record.name
  }

  return findProductNameInJsonLd(record['@graph'])
}

function extractJsonLdProductName(html: string) {
  const jsonLdPattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      const productName = findProductNameInJsonLd(JSON.parse(match[1]))

      if (productName) {
        return decodeHtml(productName)
      }
    } catch {
      continue
    }
  }

  return ''
}

function extractShopifyProductJsonName(html: string) {
  const productJsonPattern =
    /<script\b[^>]*(?:id=["']ProductJson[^"']*["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi

  for (const match of html.matchAll(productJsonPattern)) {
    try {
      const parsedJson = JSON.parse(match[1])

      if (
        parsedJson &&
        typeof parsedJson === 'object' &&
        typeof (parsedJson as { title?: unknown }).title === 'string'
      ) {
        return decodeHtml((parsedJson as { title: string }).title)
      }
    } catch {
      continue
    }
  }

  return ''
}

function extractProductTitle(html: string, url: string) {
  const pageTitleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const titleCandidates = [
    extractMetaContent(html, 'property', 'og:title'),
    extractMetaContent(html, 'name', 'twitter:title'),
    pageTitleMatch ? cleanPageTitle(stripHtml(pageTitleMatch[1])) : '',
    extractJsonLdProductName(html),
    extractShopifyProductJsonName(html),
    getTitleFromProductHandle(url),
  ]

  return (
    titleCandidates.find((title) => title && !isBlockedProductTitle(title)) ??
    getTitleFromProductHandle(url)
  )
}

async function searchMistify(searchQuery: string) {
  const searchUrl = buildMistifySearchUrl(searchQuery)
  const searchHtml = await fetchWithPoliteDelay(searchUrl)
  const candidates = extractSearchCandidates(searchHtml)

  console.log(`Found ${candidates.length} candidate product links.`)

  for (const candidate of candidates) {
    try {
      const productHtml = await fetchWithPoliteDelay(candidate.url)

      candidate.title = extractProductTitle(productHtml, candidate.url)
      candidate.inspiredByText = extractInspiredByText(productHtml)
      console.log(`Suggested product name found: ${candidate.title}`)
    } catch {
      if (isBlockedProductTitle(candidate.title)) {
        candidate.title = getTitleFromProductHandle(candidate.url)
      }
      candidate.inspiredByText = ''
      console.log(`Suggested product name fallback: ${candidate.title}`)
    }
  }

  return candidates
}

function hasMeaningfulOverlap(firstValue: string, secondValue: string) {
  const firstTokens = normalizeText(firstValue)
    .split(' ')
    .filter((token) => token.length >= 4)
  const secondText = normalizeText(secondValue)

  if (!firstTokens.length || !secondText) {
    return false
  }

  const matchedTokenCount = firstTokens.filter((token) =>
    secondText.includes(token),
  ).length

  return matchedTokenCount >= Math.min(2, firstTokens.length)
}

function includesNormalizedPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `)
}

function scoreCandidate(
  fragrance: FragranceToCheck,
  candidate: MistifyCandidate,
  searchQuery: string,
) {
  const normalizedOriginal = normalizeText(fragrance.originalFragranceName)
  const normalizedBrand = normalizeText(fragrance.sourceBrandBatch)
  const normalizedTitle = normalizeText(candidate.title)
  const normalizedUrl = normalizeText(candidate.url)
  const normalizedHandle = normalizeText(getProductHandleFromUrl(candidate.url))
  const normalizedInspiredBy = normalizeText(candidate.inspiredByText)
  const combinedCandidateText = [
    normalizedTitle,
    normalizedHandle,
    normalizedUrl,
    normalizedInspiredBy,
  ].join(' ')
  const originalTokens = normalizedOriginal.split(' ').filter(Boolean)
  const isBroadOneWordOriginal =
    originalTokens.length === 1 && normalizedOriginal.length <= 4
  const hasOriginalInInspiredBy =
    normalizedOriginal !== '' &&
    includesNormalizedPhrase(normalizedInspiredBy, normalizedOriginal)
  const hasOriginalInTitleOrUrl =
    normalizedOriginal !== '' &&
    (includesNormalizedPhrase(normalizedTitle, normalizedOriginal) ||
      includesNormalizedPhrase(normalizedHandle, normalizedOriginal) ||
      includesNormalizedPhrase(normalizedUrl, normalizedOriginal))
  const hasExactProductIdentitySupport =
    normalizedTitle === normalizedOriginal || normalizedHandle === normalizedOriginal
  const hasBrandSupport =
    normalizedBrand !== '' && combinedCandidateText.includes(normalizedBrand)
  const hasPartialNameSupport = hasMeaningfulOverlap(
    fragrance.originalFragranceName ?? '',
    combinedCandidateText,
  )

  if (
    hasOriginalInInspiredBy &&
    hasBrandSupport &&
    (!isBroadOneWordOriginal || hasExactProductIdentitySupport)
  ) {
    return {
      confidence: 100,
      reason: `Searched "${searchQuery}"; original fragrance name and brand appear in Inspired By/product text.`,
      status: 'exact_inspired_by_match' as MatchStatus,
      matchConfidence: 'high' as MatchConfidence,
    }
  }

  if (hasOriginalInInspiredBy && !isBroadOneWordOriginal) {
    return {
      confidence: 90,
      reason: `Searched "${searchQuery}"; original fragrance name appears in Inspired By text.`,
      status: 'exact_inspired_by_match' as MatchStatus,
      matchConfidence: 'high' as MatchConfidence,
    }
  }

  if (
    hasOriginalInTitleOrUrl &&
    hasBrandSupport &&
    (!isBroadOneWordOriginal || hasExactProductIdentitySupport)
  ) {
    return {
      confidence: 82,
      reason: `Searched "${searchQuery}"; original fragrance name and brand appear in product title or URL text.`,
      status: 'strong_name_match' as MatchStatus,
      matchConfidence: 'high' as MatchConfidence,
    }
  }

  if (hasOriginalInTitleOrUrl && !isBroadOneWordOriginal) {
    return {
      confidence: 70,
      reason: `Searched "${searchQuery}"; original fragrance name appears in product title or URL text, but brand support is unclear.`,
      status: 'strong_name_match' as MatchStatus,
      matchConfidence: 'medium' as MatchConfidence,
    }
  }

  if (hasPartialNameSupport) {
    return {
      confidence: 45,
      reason: `Searched "${searchQuery}"; some meaningful fragrance-name terms overlap with Mistify product text.`,
      status: 'possible_match' as MatchStatus,
      matchConfidence: 'low' as MatchConfidence,
    }
  }

  if (isBroadOneWordOriginal && (hasOriginalInInspiredBy || hasOriginalInTitleOrUrl)) {
    return {
      confidence: hasBrandSupport ? 42 : 35,
      reason: `Searched "${searchQuery}"; broad one-word fragrance name appears in candidate text, so this is treated as a low-confidence possible match.`,
      status: 'possible_match' as MatchStatus,
      matchConfidence: 'low' as MatchConfidence,
    }
  }

  return {
    confidence: 0,
    reason: `Searched "${searchQuery}"; no meaningful name or Inspired By overlap found.`,
    status: 'no_match' as MatchStatus,
    matchConfidence: 'none' as MatchConfidence,
  }
}

function chooseBestCandidate(
  fragrance: FragranceToCheck,
  candidates: MistifyCandidate[],
  searchQuery: string,
) {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(fragrance, candidate, searchQuery),
    }))
    .sort((first, second) => second.score.confidence - first.score.confidence)[0]
}

function buildNoMatchRow(
  fragrance: FragranceToCheck,
  searchQuery: string,
): ReviewRow {
  return {
    fragrance_id: fragrance.id,
    source_brand_batch: fragrance.sourceBrandBatch ?? '',
    original_fragrance_name: fragrance.originalFragranceName ?? '',
    old_mistify_product_name: fragrance.mistifyProductName ?? '',
    match_status: 'no_match',
    match_confidence: 'none',
    suggested_mistify_product_name: '',
    suggested_mistify_url: '',
    suggested_inspired_by_text: '',
    reason: `Searched "${searchQuery}"; no matching Mistify product found in search results.`,
    checked_at: new Date().toISOString(),
  }
}

function buildErrorRow(
  fragrance: FragranceToCheck,
  error: unknown,
  searchQuery: string,
): ReviewRow {
  return {
    fragrance_id: fragrance.id,
    source_brand_batch: fragrance.sourceBrandBatch ?? '',
    original_fragrance_name: fragrance.originalFragranceName ?? '',
    old_mistify_product_name: fragrance.mistifyProductName ?? '',
    match_status: 'error',
    match_confidence: 'none',
    suggested_mistify_product_name: '',
    suggested_mistify_url: '',
    suggested_inspired_by_text: '',
    reason: `Searched "${searchQuery}"; ${
      error instanceof Error ? error.message : 'Unknown error'
    }`,
    checked_at: new Date().toISOString(),
  }
}

function buildReviewRow(
  fragrance: FragranceToCheck,
  bestMatch: ReturnType<typeof chooseBestCandidate>,
  searchQuery: string,
): ReviewRow {
  if (!bestMatch || bestMatch.score.status === 'no_match') {
    return buildNoMatchRow(fragrance, searchQuery)
  }

  return {
    fragrance_id: fragrance.id,
    source_brand_batch: fragrance.sourceBrandBatch ?? '',
    original_fragrance_name: fragrance.originalFragranceName ?? '',
    old_mistify_product_name: fragrance.mistifyProductName ?? '',
    match_status: bestMatch.score.status,
    match_confidence: bestMatch.score.matchConfidence,
    suggested_mistify_product_name: bestMatch.candidate.title,
    suggested_mistify_url: bestMatch.candidate.url,
    suggested_inspired_by_text: bestMatch.candidate.inspiredByText,
    reason: bestMatch.score.reason,
    checked_at: new Date().toISOString(),
  }
}

function writeCsv(rows: ReviewRow[]) {
  const csvContent = [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      CSV_HEADERS.map((header) => escapeCsvValue(row[header])).join(','),
    ),
  ].join('\n')

  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  writeFileSync(OUTPUT_PATH, `${csvContent}\n`, 'utf8')
}

function countRowsByStatus(rows: ReviewRow[]) {
  const counts: Record<MatchStatus, number> = {
    exact_inspired_by_match: 0,
    strong_name_match: 0,
    possible_match: 0,
    no_match: 0,
    error: 0,
  }

  for (const row of rows) {
    counts[row.match_status] += 1
  }

  return counts
}

async function checkMistifyProductNames() {
  console.log('Mistify product-name checker starting.')
  console.log('Mode: dry-run only. No database rows will be updated.')
  console.log(
    `Checking only rows where mistify_product_name is exactly one of: ${TARGET_PLACEHOLDERS.map(
      (placeholder) => `"${placeholder}"`,
    ).join(', ')}...`,
  )
  console.log('Ignoring blank/null names, other placeholders, and existing names.')
  console.log('Request delay: randomized 5000ms to 7999ms before each Mistify request.')
  console.log(
    'Search URL format: /search?type=product&options%5Bprefix%5D=none&q=<query>&options%5Bprefix%5D=last',
  )
  console.log(`CSV output: ${OUTPUT_PATH}`)

  const fragrancesToCheck = await fetchFragrancesToCheck()
  const reviewRows: ReviewRow[] = []

  console.log(`Found ${fragrancesToCheck.length} rows to check.`)

  for (const [index, fragrance] of fragrancesToCheck.entries()) {
    try {
      console.log(
        `Checking ${index + 1}/${fragrancesToCheck.length}: ${fragrance.originalFragranceName}`,
      )
      const searchQuery = buildSearchQuery(fragrance)

      console.log(`Search query: "${searchQuery}"`)
      const candidates = await searchMistify(searchQuery)
      const bestMatch = chooseBestCandidate(fragrance, candidates, searchQuery)
      const reviewRow = buildReviewRow(fragrance, bestMatch, searchQuery)

      reviewRows.push(reviewRow)
      console.log(
        `Result: ${reviewRow.match_status}/${reviewRow.match_confidence} - ${
          reviewRow.suggested_mistify_product_name || reviewRow.reason
        }`,
      )
    } catch (error) {
      const searchQuery = buildSearchQuery(fragrance)
      const errorRow = buildErrorRow(fragrance, error, searchQuery)

      reviewRows.push(errorRow)
      console.log(`Result: error/none - ${errorRow.reason}`)
    }
  }

  writeCsv(reviewRows)
  const statusCounts = countRowsByStatus(reviewRows)

  console.log('Summary by match status:')
  console.log(`- exact_inspired_by_match: ${statusCounts.exact_inspired_by_match}`)
  console.log(`- strong_name_match: ${statusCounts.strong_name_match}`)
  console.log(`- possible_match: ${statusCounts.possible_match}`)
  console.log(`- no_match: ${statusCounts.no_match}`)
  console.log(`- error: ${statusCounts.error}`)
  console.log(`Dry-run finished. Review CSV saved to ${OUTPUT_PATH}`)
}

async function main() {
  try {
    await checkMistifyProductNames()
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Mistify product-name dry-run failed.')
    console.error(error)
    await pool.end()
    process.exit(1)
  }
}

void main()
