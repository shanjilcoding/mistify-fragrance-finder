import type { CatalogFragrance } from '../api/catalogApi'

const PLACEHOLDER_TEXT = [
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
]

export const NON_AFFILIATION_DISCLAIMER =
  'Designer brand names are used for comparison and identification purposes only. Mistify Parfums is not affiliated with, endorsed by, or sponsored by any designer brand referenced on this site.'

function isPlaceholder(value: string | null | undefined): boolean {
  return PLACEHOLDER_TEXT.includes(value?.trim().toLowerCase() ?? '')
}

export function getAudienceLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()

  if (normalized === 'unisex') return 'Unisex'
  if (normalized === 'mens') return 'Men'
  if (normalized === 'womens') return 'Women'

  return null
}

export function getDisplayProductName(fragrance: CatalogFragrance): string {
  const name = fragrance.mistifyProductName?.trim()

  return name && !isPlaceholder(name)
    ? name
    : fragrance.publicInspiredByLabel || fragrance.originalFragranceName || 'Inspired fragrance'
}

export function hasUsableProductName(fragrance: CatalogFragrance): boolean {
  const name = fragrance.mistifyProductName?.trim()

  return Boolean(name && !isPlaceholder(name))
}

export function getDisplayClassification(
  classification: string | null | undefined,
): string[] {
  if (!classification || isPlaceholder(classification)) {
    return []
  }

  return classification
    .split(/\s*[/|·,]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function getSafeProductUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()

  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(trimmed)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// Picks a short, de-duplicated preview of the most important notes for cards.
export function getNotePreview(fragrance: CatalogFragrance, limit = 5): string[] {
  const ordered = [
    ...fragrance.topNotes,
    ...fragrance.middleNotes,
    ...fragrance.baseNotes,
    ...fragrance.allNotes,
  ]
  const preview: string[] = []
  const seen = new Set<string>()

  for (const note of ordered) {
    const trimmed = note.trim()
    const key = trimmed.toLowerCase()

    if (!trimmed || seen.has(key)) {
      continue
    }

    seen.add(key)
    preview.push(trimmed)

    if (preview.length >= limit) {
      break
    }
  }

  return preview
}

export function formatNoteList(notes: string[]): string {
  return notes.join(' · ')
}
