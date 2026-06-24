import type { Fragrance } from '../db/schema'
import { buildInspiredByLabel } from './brandNormalization'

export type CatalogFragrance = {
  id: number
  fragranceSlug: string
  brandName: string | null
  brandSlug: string | null
  originalFragranceName: string | null
  originalFragranceSlug: string | null
  mistifyProductName: string | null
  mistifyProductSlug: string | null
  mistifyProductUrl: string | null
  publicInspiredByLabel: string
  audience: string | null
  classification: string | null
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  catalogImageUrl: string | null
}

export type CatalogBrand = {
  brandName: string
  brandSlug: string
  fragranceCount: number
}

// Builds the public, collision-proof slug used in catalog fragrance URLs. The
// trailing id keeps concentration variants that share an original-fragrance
// slug distinct, and the detail route reads the id back off the end.
export function buildFragranceSlug(row: Pick<Fragrance, 'id' | 'originalFragranceSlug'>): string {
  const baseSlug = row.originalFragranceSlug?.trim()

  return baseSlug ? `${baseSlug}-${row.id}` : String(row.id)
}

// Extracts the numeric fragrance id from a public fragrance slug, e.g.
// "tom-ford-tobacco-vanille-123" -> 123. Returns null when absent.
export function parseFragranceIdFromSlug(slug: string): number | null {
  const match = slug.trim().match(/(\d+)$/)

  if (!match) {
    return null
  }

  const id = Number(match[1])

  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function toCatalogFragrance(row: Fragrance): CatalogFragrance {
  return {
    id: row.id,
    fragranceSlug: buildFragranceSlug(row),
    brandName: row.brandName,
    brandSlug: row.brandSlug,
    originalFragranceName: row.originalFragranceName,
    originalFragranceSlug: row.originalFragranceSlug,
    mistifyProductName: row.mistifyProductName,
    mistifyProductSlug: row.mistifyProductSlug,
    mistifyProductUrl: row.mistifyProductUrl,
    publicInspiredByLabel:
      row.publicInspiredByLabel?.trim() ||
      buildInspiredByLabel(row.brandName, row.originalFragranceName),
    audience: row.audience,
    classification: row.classification,
    topNotes: row.topNotes ?? [],
    middleNotes: row.middleNotes ?? [],
    baseNotes: row.baseNotes ?? [],
    allNotes: row.allNotes ?? [],
    catalogImageUrl: row.catalogImageUrl,
  }
}
