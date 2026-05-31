import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/connection'
import {
  curatedChipFragrances,
  curatedChips,
  fragrances,
} from '../db/schema'

type CuratedRecommendation = {
  mistifyProductName: string
  mistifyProductUrl?: string | null
  audience?: string | null
  originalFragranceName: string | null
  sourceBrandBatch: string | null
  classification: string | null
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  sourceConfidence: string | null
  sourceUsed: string | null
  sourceStatus: string | null
  aiExplanation: string
}

const PLACEHOLDER_PRODUCT_NAMES = new Set([
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
])

function normalizeNotes(notes: string[] | null) {
  return Array.isArray(notes) ? notes.filter(Boolean) : []
}

function getDisplayProductName(row: typeof fragrances.$inferSelect) {
  const mistifyProductName = row.mistifyProductName?.trim()

  if (
    mistifyProductName &&
    !PLACEHOLDER_PRODUCT_NAMES.has(mistifyProductName.toLowerCase())
  ) {
    return mistifyProductName
  }

  return row.originalFragranceName?.trim() || 'Mistify Fragrance'
}

function toCuratedRecommendation(
  row: typeof fragrances.$inferSelect,
): CuratedRecommendation {
  return {
    mistifyProductName: getDisplayProductName(row),
    mistifyProductUrl: row.mistifyProductUrl,
    audience: row.audience,
    originalFragranceName: row.originalFragranceName,
    sourceBrandBatch: row.sourceBrandBatch,
    classification: row.classification,
    topNotes: normalizeNotes(row.topNotes),
    middleNotes: normalizeNotes(row.middleNotes),
    baseNotes: normalizeNotes(row.baseNotes),
    allNotes: normalizeNotes(row.allNotes),
    sourceConfidence: row.sourceConfidence,
    sourceUsed: row.sourceUsed,
    sourceStatus: row.sourceStatus,
    aiExplanation: 'Selected by Mistify for this curated list.',
  }
}

export async function getActiveCuratedChip(chipId: number) {
  const [chip] = await db
    .select()
    .from(curatedChips)
    .where(and(eq(curatedChips.id, chipId), eq(curatedChips.isActive, true)))
    .limit(1)

  return chip
}

export async function getCuratedChipRecommendations(chipId: number) {
  const rows = await db
    .select({
      fragrance: fragrances,
    })
    .from(curatedChipFragrances)
    .innerJoin(fragrances, eq(curatedChipFragrances.fragranceId, fragrances.id))
    .where(eq(curatedChipFragrances.chipId, chipId))
    .orderBy(asc(curatedChipFragrances.sortOrder), asc(curatedChipFragrances.id))

  const seenFragranceIds = new Set<number>()
  const recommendations: CuratedRecommendation[] = []

  rows.forEach(({ fragrance }) => {
    if (seenFragranceIds.has(fragrance.id)) {
      return
    }

    seenFragranceIds.add(fragrance.id)
    recommendations.push(toCuratedRecommendation(fragrance))
  })

  return recommendations
}
