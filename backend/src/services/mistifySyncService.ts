import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/connection'
import { fragrances, type Fragrance } from '../db/schema'
import {
  didUrlChange,
  indexProductsByHandle,
  isPlaceholderProductName,
  matchFragranceToShopProduct,
  type CatalogMatchInput,
} from '../utils/fragranceCatalogMatching'
import {
  fetchAllMistifyShopProducts,
  type MistifyShopProduct,
} from '../utils/mistifyShopify'
import { buildCatalogFields, type CatalogSourceRow } from '../utils/catalogFields'
import {
  buildInspiredByLabel,
  slugify,
  toBrandDisplayName,
} from '../utils/brandNormalization'
import { normalizeText } from '../utils/textNormalization'

// ── Types ──────────────────────────────────────────────────────────

export type SyncScope = 'all' | 'images' | 'products'

export type SyncMatchRow = {
  fragranceId: number
  sourceBrandBatch: string
  originalFragranceName: string
  oldMistifyProductName: string
  oldMistifyProductUrl: string
  oldCatalogImageUrl: string
  newMistifyProductName: string
  newMistifyProductUrl: string
  newCatalogImageUrl: string
  shopHandle: string
  matchType: string
  matchConfidence: 'high' | 'medium' | 'low'
  fieldsToUpdate: string[]
  reason: string
}

export type SyncManualReviewRow = SyncMatchRow & {
  reviewReason: string
}

export type SyncSkippedRow = {
  fragranceId: number
  sourceBrandBatch: string
  originalFragranceName: string
  mistifyProductName: string
  mistifyProductUrl: string
  reason: string
}

export type NewProductCandidate = {
  shopTitle: string
  shopHandle: string
  shopUrl: string
  imageUrl: string
  vendor: string
  inspirationText: string
  originalFragranceName: string
  sourceBrandBatch: string
  classification: string
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  brandName: string | null
  brandSlug: string | null
  originalFragranceSlug: string | null
  mistifyProductSlug: string | null
  publicInspiredByLabel: string | null
  searchableText: string
  isCatalogVisible: boolean
  duplicateReasons: string[]
  missingFields: string[]
}

export type AnalyzeResult = {
  shopProductsFetched: number
  dbFragrancesRead: number
  highConfidenceMatches: SyncMatchRow[]
  manualReviewRows: SyncManualReviewRow[]
  skippedRows: SyncSkippedRow[]
  newProductCandidates: NewProductCandidate[]
  staleDbProductUrls: { fragranceId: number; originalFragranceName: string; mistifyProductUrl: string }[]
}

export type ApplyInput = {
  fragranceId: number
  mistifyProductName?: string
  mistifyProductUrl?: string
  catalogImageUrl?: string
}

export type ImportInput = {
  shopTitle: string
  shopUrl: string
  imageUrl: string
  originalFragranceName: string
  sourceBrandBatch: string
  classification: string
  inspirationText: string
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  brandName: string | null
  brandSlug: string | null
  originalFragranceSlug: string | null
  mistifyProductSlug: string | null
  publicInspiredByLabel: string | null
  searchableText: string
  isCatalogVisible: boolean
}

export type ApplyResult = {
  updatedCount: number
  importedCount: number
  catalogFieldsRecomputed: number
}

// ── Helpers ────────────────────────────────────────────────────────

function hasBlankValue(value: string | null | undefined) {
  return !value?.trim()
}

function shouldUpdateImage(
  fragrance: Pick<Fragrance, 'catalogImageUrl'>,
  product: MistifyShopProduct,
) {
  return Boolean(product.imageUrl) && fragrance.catalogImageUrl !== product.imageUrl
}

function shouldUpdateProduct(
  fragrance: Pick<Fragrance, 'mistifyProductName' | 'mistifyProductUrl'>,
  product: MistifyShopProduct,
) {
  return (
    isPlaceholderProductName(fragrance.mistifyProductName) ||
    hasBlankValue(fragrance.mistifyProductUrl) ||
    didUrlChange(fragrance.mistifyProductUrl, product.url)
  )
}

function getFieldsToUpdate(
  fragrance: Pick<Fragrance, 'mistifyProductName' | 'mistifyProductUrl' | 'catalogImageUrl'>,
  product: MistifyShopProduct,
  scope: SyncScope,
): string[] {
  const fields: string[] = []
  if ((scope === 'all' || scope === 'products') && shouldUpdateProduct(fragrance, product)) {
    if (fragrance.mistifyProductName !== product.title) fields.push('mistify_product_name')
    if (didUrlChange(fragrance.mistifyProductUrl, product.url)) fields.push('mistify_product_url')
  }
  if ((scope === 'all' || scope === 'images') && shouldUpdateImage(fragrance, product)) {
    fields.push('catalog_image_url')
  }
  return fields
}

function getMistifyProductHandleFromUrl(value: string | null | undefined) {
  if (!value?.trim()) return ''
  try {
    const parsedUrl = new URL(value.trim(), 'https://www.mistifyparfums.com')
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
    return pathParts[pathParts.length - 1] ?? ''
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop() ?? ''
  }
}

// ── Body HTML Parser (ported from import-mistify-shop-only.cjs) ───

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

function normalizeLabelText(value: string) {
  return value
    .replace(/I\s+nspiration\s*:/gi, 'Inspiration:')
    .replace(/Base Note\b/gi, 'Base Notes')
    .replace(/Middle Note\b/gi, 'Middle Notes')
    .replace(/Top Note\b/gi, 'Top Notes')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractField(text: string, label: string, nextLabels: string[]): string {
  const labelPattern = label.replace(/\s+/g, '\\s+')
  const nextPattern = nextLabels.map((l) => l.replace(/\s+/g, '\\s+')).join('|')
  const regex = new RegExp(
    `${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=${nextPattern ? `\\b(?:${nextPattern})\\s*:` : '$'}|$)`,
    'i',
  )
  const match = text.match(regex)
  return match ? match[1].trim().replace(/[.;,\s]+$/, '') : ''
}

function trimDescriptionTail(value: string, productTitle: string) {
  const stopPhrases = [
    productTitle,
    'Note:',
    'Now available',
    'Available in',
    'Due to the high extract concentration',
  ].filter(Boolean)
  const stopPattern = stopPhrases.map(escapeRegExp).join('|')
  if (!stopPattern) return value
  const split = value.split(new RegExp(`\\b(?:${stopPattern})`, 'i'))
  return (split[0] ?? '').trim().replace(/[.;,\s]+$/, '')
}

function splitNotes(value: string): string[] {
  return value
    .split(/,|\band\b/i)
    .map((n) => n.trim().replace(/[.;]+$/, ''))
    .filter(Boolean)
}

function parseInspiredBy(value: string): { originalFragranceName: string; sourceBrandBatch: string } {
  const cleaned = value.replace(/^\s*(?:Inspiration|Inspired by)\s*:\s*/i, '').trim()
  const byMatch = cleaned.match(/^(.+)\s+by\s+(.+)$/i)
  if (!byMatch) return { originalFragranceName: cleaned, sourceBrandBatch: '' }
  return { originalFragranceName: byMatch[1].trim(), sourceBrandBatch: byMatch[2].trim() }
}

function buildSearchableText(
  brandName: string | null,
  sourceBrandBatch: string,
  originalFragranceName: string,
  mistifyProductName: string,
  classification: string,
  allNotes: string[],
): string {
  return [brandName, sourceBrandBatch, originalFragranceName, mistifyProductName, classification, ...allNotes]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function parseProductMetadata(product: MistifyShopProduct) {
  const sourceText = normalizeLabelText(product.bodyText || product.vendor)
  const firstInspiration = extractField(sourceText, 'Inspiration', [
    'Inspiration',
    'Classification',
    'Top Notes',
    'Middle Notes',
    'Base Notes',
  ])
  const classification = extractField(sourceText, 'Classification', [
    'Top Notes',
    'Middle Notes',
    'Base Notes',
  ])
  const topNotes = splitNotes(extractField(sourceText, 'Top Notes', ['Middle Notes', 'Base Notes']))
  const middleNotes = splitNotes(extractField(sourceText, 'Middle Notes', ['Base Notes']))
  const baseNotes = splitNotes(
    trimDescriptionTail(extractField(sourceText, 'Base Notes', []), product.title),
  )
  const inspiredBy = parseInspiredBy(firstInspiration || product.vendor)
  const allNotes = [...new Set([...topNotes, ...middleNotes, ...baseNotes])]

  return {
    inspirationText: firstInspiration ? `Inspiration: ${firstInspiration}` : product.vendor,
    originalFragranceName: inspiredBy.originalFragranceName,
    sourceBrandBatch: inspiredBy.sourceBrandBatch,
    classification,
    topNotes,
    middleNotes,
    baseNotes,
    allNotes,
  }
}

// ── New Product Candidate Builder ──────────────────────────────────

function buildCandidate(product: MistifyShopProduct): NewProductCandidate {
  const meta = parseProductMetadata(product)
  const brandName = toBrandDisplayName(meta.sourceBrandBatch) || null
  const mistifyProductName = product.title

  const candidate: NewProductCandidate = {
    shopTitle: product.title,
    shopHandle: product.handle,
    shopUrl: product.url,
    imageUrl: product.imageUrl,
    vendor: product.vendor,
    inspirationText: meta.inspirationText,
    originalFragranceName: meta.originalFragranceName,
    sourceBrandBatch: meta.sourceBrandBatch,
    classification: meta.classification,
    topNotes: meta.topNotes,
    middleNotes: meta.middleNotes,
    baseNotes: meta.baseNotes,
    allNotes: meta.allNotes,
    brandName,
    brandSlug: brandName ? slugify(brandName) : null,
    originalFragranceSlug:
      brandName && meta.originalFragranceName
        ? slugify(`${brandName} ${meta.originalFragranceName}`)
        : meta.originalFragranceName
          ? slugify(meta.originalFragranceName)
          : null,
    mistifyProductSlug: slugify(mistifyProductName),
    publicInspiredByLabel: buildInspiredByLabel(brandName, meta.originalFragranceName),
    searchableText: buildSearchableText(
      brandName,
      meta.sourceBrandBatch,
      meta.originalFragranceName,
      mistifyProductName,
      meta.classification,
      meta.allNotes,
    ),
    isCatalogVisible: Boolean(brandName && meta.originalFragranceName),
    duplicateReasons: [],
    missingFields: [],
  }

  // Check for missing critical fields
  if (!meta.originalFragranceName) candidate.missingFields.push('missing original fragrance name')
  if (!meta.sourceBrandBatch) candidate.missingFields.push('missing source brand')
  if (!meta.classification) candidate.missingFields.push('missing classification')
  if (!meta.allNotes.length) candidate.missingFields.push('missing notes')
  if (!product.imageUrl) candidate.missingFields.push('missing image URL')

  return candidate
}

// ── Analysis ───────────────────────────────────────────────────────

export async function analyzeSyncPlan(scope: SyncScope): Promise<AnalyzeResult> {
  const products = await fetchAllMistifyShopProducts()
  const productsByHandle = indexProductsByHandle(products)

  const allFragrances = await db
    .select({
      id: fragrances.id,
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
      catalogImageUrl: fragrances.catalogImageUrl,
    })
    .from(fragrances)

  // Build lookups for dedup
  const existingByUrl = new Map<string, number>()
  const existingByMistifyName = new Map<string, number>()
  const existingByOriginalBrand = new Map<string, number>()
  for (const f of allFragrances) {
    const urlKey = normalizeText(f.mistifyProductUrl)
    const nameKey = normalizeText(f.mistifyProductName)
    const obKey = `${normalizeText(f.sourceBrandBatch)}||${normalizeText(f.originalFragranceName)}`
    if (urlKey) existingByUrl.set(urlKey, f.id)
    if (nameKey) existingByMistifyName.set(nameKey, f.id)
    if (obKey !== '||') existingByOriginalBrand.set(obKey, f.id)
  }

  const matches: SyncMatchRow[] = []
  const manualReviewRows: SyncManualReviewRow[] = []
  const skippedRows: SyncSkippedRow[] = []
  const staleDbProductUrls: AnalyzeResult['staleDbProductUrls'] = []
  const matchedShopHandles = new Set<string>()

  for (const fragrance of allFragrances) {
    const matchInput: CatalogMatchInput = {
      id: fragrance.id,
      originalFragranceName: fragrance.originalFragranceName,
      sourceBrandBatch: fragrance.sourceBrandBatch,
      mistifyProductName: fragrance.mistifyProductName,
      mistifyProductUrl: fragrance.mistifyProductUrl,
    }

    const match = matchFragranceToShopProduct(matchInput, products, productsByHandle)

    if (!match) {
      skippedRows.push({
        fragranceId: fragrance.id,
        sourceBrandBatch: fragrance.sourceBrandBatch ?? '',
        originalFragranceName: fragrance.originalFragranceName ?? '',
        mistifyProductName: fragrance.mistifyProductName ?? '',
        mistifyProductUrl: fragrance.mistifyProductUrl ?? '',
        reason: 'No Shopify product match found.',
      })

      const currentHandle = getMistifyProductHandleFromUrl(fragrance.mistifyProductUrl)
      if (currentHandle && !productsByHandle.has(currentHandle)) {
        staleDbProductUrls.push({
          fragranceId: fragrance.id,
          originalFragranceName: fragrance.originalFragranceName ?? '',
          mistifyProductUrl: fragrance.mistifyProductUrl ?? '',
        })
      }

      continue
    }

    matchedShopHandles.add(match.product.handle)

    const fieldsToUpdate = getFieldsToUpdate(fragrance, match.product, scope)

    if (scope === 'images' && match.matchType !== 'url_handle' && fieldsToUpdate.length) {
      manualReviewRows.push({
        fragranceId: fragrance.id,
        sourceBrandBatch: fragrance.sourceBrandBatch ?? '',
        originalFragranceName: fragrance.originalFragranceName ?? '',
        oldMistifyProductName: fragrance.mistifyProductName ?? '',
        oldMistifyProductUrl: fragrance.mistifyProductUrl ?? '',
        oldCatalogImageUrl: fragrance.catalogImageUrl ?? '',
        newMistifyProductName: match.product.title,
        newMistifyProductUrl: match.product.url,
        newCatalogImageUrl: match.product.imageUrl,
        shopHandle: match.product.handle,
        matchType: match.matchType,
        matchConfidence: match.confidence,
        fieldsToUpdate,
        reason: match.reason,
        reviewReason: 'Image-only mode only applies existing DB product URL handle matches.',
      })
      continue
    }

    if (!fieldsToUpdate.length) {
      skippedRows.push({
        fragranceId: fragrance.id,
        sourceBrandBatch: fragrance.sourceBrandBatch ?? '',
        originalFragranceName: fragrance.originalFragranceName ?? '',
        mistifyProductName: fragrance.mistifyProductName ?? '',
        mistifyProductUrl: fragrance.mistifyProductUrl ?? '',
        reason: 'Matched Shopify product, but no selected fields need updating.',
      })
      continue
    }

    const matchRow: SyncMatchRow = {
      fragranceId: fragrance.id,
      sourceBrandBatch: fragrance.sourceBrandBatch ?? '',
      originalFragranceName: fragrance.originalFragranceName ?? '',
      oldMistifyProductName: fragrance.mistifyProductName ?? '',
      oldMistifyProductUrl: fragrance.mistifyProductUrl ?? '',
      oldCatalogImageUrl: fragrance.catalogImageUrl ?? '',
      newMistifyProductName: match.product.title,
      newMistifyProductUrl: match.product.url,
      newCatalogImageUrl: match.product.imageUrl,
      shopHandle: match.product.handle,
      matchType: match.matchType,
      matchConfidence: match.confidence,
      fieldsToUpdate,
      reason: match.reason,
    }

    if (match.confidence === 'high') {
      matches.push(matchRow)
    } else {
      manualReviewRows.push({
        ...matchRow,
        reviewReason: 'Match was not high-confidence; review before applying.',
      })
    }
  }

  // Build new product candidates from unlinked Shopify products
  const newProductCandidates: NewProductCandidate[] = []
  for (const product of products) {
    if (matchedShopHandles.has(product.handle)) continue
    const candidate = buildCandidate(product)

    // Dedup checks
    const urlDup = existingByUrl.get(normalizeText(candidate.shopUrl))
    const nameDup = existingByMistifyName.get(normalizeText(candidate.shopTitle))
    const obDup = existingByOriginalBrand.get(
      `${normalizeText(candidate.sourceBrandBatch)}||${normalizeText(candidate.originalFragranceName)}`,
    )

    if (urlDup) candidate.duplicateReasons.push(`mistify_product_url already exists (id ${urlDup})`)
    if (nameDup) candidate.duplicateReasons.push(`mistify_product_name already exists (id ${nameDup})`)
    if (obDup) candidate.duplicateReasons.push(`brand + original fragrance already exists (id ${obDup})`)

    newProductCandidates.push(candidate)
  }

  return {
    shopProductsFetched: products.length,
    dbFragrancesRead: allFragrances.length,
    highConfidenceMatches: matches,
    manualReviewRows,
    skippedRows,
    newProductCandidates,
    staleDbProductUrls,
  }
}

// ── Apply ──────────────────────────────────────────────────────────

export async function applySyncPlan(
  updates: ApplyInput[],
  imports: ImportInput[],
): Promise<ApplyResult> {
  let updatedCount = 0
  let importedCount = 0
  const productFieldUpdateIds: number[] = []

  if (updates.length) {
    await db.transaction(async (tx) => {
      for (const match of updates) {
        const updateValues: Record<string, unknown> = { updatedAt: new Date() }

        if (match.mistifyProductName !== undefined) {
          updateValues.mistifyProductName = match.mistifyProductName || null
          productFieldUpdateIds.push(match.fragranceId)
        }
        if (match.mistifyProductUrl !== undefined) {
          updateValues.mistifyProductUrl = match.mistifyProductUrl || null
          productFieldUpdateIds.push(match.fragranceId)
        }
        if (match.catalogImageUrl !== undefined) {
          updateValues.catalogImageUrl = match.catalogImageUrl || null
        }

        const result = await tx
          .update(fragrances)
          .set(updateValues)
          .where(eq(fragrances.id, match.fragranceId))
          .returning({ id: fragrances.id })

        if (result.length !== 1) {
          throw new Error(
            `Expected to update exactly one fragrance row for id ${match.fragranceId}; updated ${result.length}.`,
          )
        }

        updatedCount += 1
      }
    })
  }

  if (imports.length) {
    await db.transaction(async (tx) => {
      for (const imp of imports) {
        const result = await tx
          .insert(fragrances)
          .values({
            originalFragranceName: imp.originalFragranceName,
            mistifyProductName: imp.shopTitle,
            mistifyProductUrl: imp.shopUrl,
            sourceBrandBatch: imp.sourceBrandBatch,
            classification: imp.classification,
            topNotes: imp.topNotes,
            middleNotes: imp.middleNotes,
            baseNotes: imp.baseNotes,
            allNotes: imp.allNotes,
            sourceStatus: 'verified_mistify_shop_import',
            sourceUsed: 'Mistify',
            sourceNotes: `Mistify Shopify product feed: ${imp.inspirationText}`,
            sourceConfidence: 'high',
            verifiedOnMistify: true,
            mistifyProductFound: true,
            notesSourceType: 'mistify',
            inferredClassifications: [],
            inferredSeasons: [],
            inferredOccasions: [],
            inferredIntensity: null,
            seasonScores: {},
            profileScores: {},
            inferenceReason: 'Imported from Mistify Shopify product feed via admin sync.',
            reviewedByAdmin: false,
            searchableText: imp.searchableText,
            catalogImageUrl: imp.imageUrl,
            brandName: imp.brandName,
            brandSlug: imp.brandSlug,
            originalFragranceSlug: imp.originalFragranceSlug,
            mistifyProductSlug: imp.mistifyProductSlug,
            publicInspiredByLabel: imp.publicInspiredByLabel,
            isCatalogVisible: imp.isCatalogVisible,
            catalogSortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: fragrances.id })

        if (result.length !== 1) {
          throw new Error(
            `Expected to insert exactly one fragrance row for "${imp.shopTitle}"; inserted ${result.length}.`,
          )
        }

        importedCount += 1
      }
    })
  }

  // Recompute catalog fields for updated rows
  const uniqueIds = Array.from(new Set(productFieldUpdateIds))
  let catalogFieldsRecomputed = 0

  if (uniqueIds.length) {
    const rows = await db
      .select({
        id: fragrances.id,
        originalFragranceName: fragrances.originalFragranceName,
        mistifyProductName: fragrances.mistifyProductName,
        mistifyProductUrl: fragrances.mistifyProductUrl,
        sourceBrandBatch: fragrances.sourceBrandBatch,
        classification: fragrances.classification,
        audience: fragrances.audience,
        allNotes: fragrances.allNotes,
        verifiedOnMistify: fragrances.verifiedOnMistify,
        mistifyProductFound: fragrances.mistifyProductFound,
      })
      .from(fragrances)
      .where(inArray(fragrances.id, uniqueIds))

    for (const row of rows) {
      const sourceRow: CatalogSourceRow = {
        originalFragranceName: row.originalFragranceName,
        mistifyProductName: row.mistifyProductName,
        sourceBrandBatch: row.sourceBrandBatch,
        classification: row.classification,
        audience: row.audience,
        allNotes: row.allNotes,
        verifiedOnMistify: row.verifiedOnMistify,
        mistifyProductFound: row.mistifyProductFound,
      }

      await db
        .update(fragrances)
        .set({
          ...buildCatalogFields(sourceRow),
          updatedAt: new Date(),
        })
        .where(eq(fragrances.id, row.id))
    }

    catalogFieldsRecomputed = rows.length
  }

  return { updatedCount, importedCount, catalogFieldsRecomputed }
}
