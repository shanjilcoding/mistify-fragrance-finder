import { normalizeBrandName } from './fragranceMatching'
import {
  buildInspiredByLabel,
  slugify,
  toBrandDisplayName,
} from './brandNormalization'

// Subset of fragrance columns required to derive the public catalog fields.
export type CatalogSourceRow = {
  originalFragranceName: string | null | undefined
  mistifyProductName: string | null | undefined
  mistifyProductUrl?: string | null | undefined
  sourceBrandBatch: string | null | undefined
  classification?: string | null | undefined
  audience?: string | null | undefined
  allNotes?: string[] | null | undefined
  verifiedOnMistify?: boolean | null | undefined
  mistifyProductFound?: boolean | null | undefined
}

export type DerivedCatalogFields = {
  brandName: string | null
  brandSlug: string | null
  originalFragranceSlug: string | null
  mistifyProductSlug: string | null
  publicInspiredByLabel: string | null
  isCatalogVisible: boolean
  searchableText: string
}

const PLACEHOLDER_PRODUCT_NAMES = [
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
]

function isNonEmpty(value: string | null | undefined): value is string {
  return Boolean(value && value.trim())
}

function isPlaceholderProductName(value: string | null | undefined): boolean {
  const normalizedValue = value?.trim().toLowerCase() ?? ''

  return !normalizedValue || PLACEHOLDER_PRODUCT_NAMES.includes(normalizedValue)
}

// Computes catalog visibility. For MVP, all fragrances should be visible publicly
// unless they are clearly test/broken. We keep basic validation but don't require
// shop URLs or perfect product names.
export function computeCatalogVisibility(
  row: CatalogSourceRow,
  brandName: string | null,
): boolean {
  // Basic validation: must have brand and original fragrance name
  // Don't require shop URL or verified status for MVP
  return Boolean(
    isNonEmpty(brandName) &&
      isNonEmpty(row.originalFragranceName)
  )
}

function buildCatalogSearchableText(
  row: CatalogSourceRow,
  brandName: string | null,
): string {
  const notes = Array.isArray(row.allNotes) ? row.allNotes : []

  return [
    brandName,
    normalizeBrandName(row.sourceBrandBatch),
    row.sourceBrandBatch,
    row.originalFragranceName,
    row.mistifyProductName,
    row.classification,
    row.audience,
    ...notes,
  ]
    .map((value) => (value ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

// Derives every public catalog field from a fragrance row. Shared by the import
// script, the Mistify product updater, and the backfill script so derivation
// stays consistent everywhere.
export function buildCatalogFields(row: CatalogSourceRow): DerivedCatalogFields {
  const brandName = toBrandDisplayName(row.sourceBrandBatch) || null
  const originalFragranceName = row.originalFragranceName?.trim() ?? ''
  const mistifyProductName = isPlaceholderProductName(row.mistifyProductName)
    ? ''
    : row.mistifyProductName?.trim() ?? ''

  return {
    brandName,
    brandSlug: brandName ? slugify(brandName) : null,
    originalFragranceSlug:
      brandName && originalFragranceName
        ? slugify(`${brandName} ${originalFragranceName}`)
        : originalFragranceName
          ? slugify(originalFragranceName)
          : null,
    mistifyProductSlug: mistifyProductName ? slugify(mistifyProductName) : null,
    publicInspiredByLabel: buildInspiredByLabel(brandName, originalFragranceName),
    isCatalogVisible: computeCatalogVisibility(row, brandName),
    searchableText: buildCatalogSearchableText(row, brandName),
  }
}
