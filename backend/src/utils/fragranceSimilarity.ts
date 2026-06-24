import type { Fragrance } from '../db/schema'

// Deterministic similarity scoring for the "Similar Mistify Fragrances" section
// on catalog detail pages. Driven entirely by stored notes and classification
// so results are stable and computable without any AI calls.

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function toNoteSet(notes: string[] | null | undefined): Set<string> {
  const set = new Set<string>()

  for (const note of notes ?? []) {
    const normalized = normalizeToken(note)

    if (normalized) {
      set.add(normalized)
    }
  }

  return set
}

function jaccard(first: Set<string>, second: Set<string>): number {
  if (!first.size || !second.size) {
    return 0
  }

  let intersectionSize = 0

  for (const value of first) {
    if (second.has(value)) {
      intersectionSize += 1
    }
  }

  const unionSize = first.size + second.size - intersectionSize

  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

export type ScoredFragrance = {
  fragrance: Fragrance
  score: number
  sharedNotes: string[]
}

function getSharedNotes(source: Fragrance, candidate: Fragrance): string[] {
  const candidateLookup = new Map<string, string>()

  for (const note of candidate.allNotes ?? []) {
    const normalized = normalizeToken(note)

    if (normalized && !candidateLookup.has(normalized)) {
      candidateLookup.set(normalized, note)
    }
  }

  const shared: string[] = []
  const seen = new Set<string>()

  for (const note of source.allNotes ?? []) {
    const normalized = normalizeToken(note)
    const match = candidateLookup.get(normalized)

    if (normalized && match && !seen.has(normalized)) {
      seen.add(normalized)
      shared.push(match)
    }
  }

  return shared
}

export function scoreSimilarity(source: Fragrance, candidate: Fragrance): number {
  if (source.id === candidate.id) {
    return -1
  }

  const exactNoteScore =
    jaccard(toNoteSet(source.allNotes), toNoteSet(candidate.allNotes)) * 45
  const layerScore =
    jaccard(toNoteSet(source.topNotes), toNoteSet(candidate.topNotes)) * 8 +
    jaccard(toNoteSet(source.middleNotes), toNoteSet(candidate.middleNotes)) * 7 +
    jaccard(toNoteSet(source.baseNotes), toNoteSet(candidate.baseNotes)) * 10
  const classificationScore =
    normalizeToken(source.classification ?? '') &&
    normalizeToken(source.classification ?? '') ===
      normalizeToken(candidate.classification ?? '')
      ? 10
      : 0
  const audienceScore =
    normalizeToken(source.audience ?? '') &&
    normalizeToken(source.audience ?? '') === normalizeToken(candidate.audience ?? '')
      ? 3
      : 0

  return Math.round(exactNoteScore + layerScore + classificationScore + audienceScore)
}

// Ranks candidates against a source fragrance and returns the strongest
// matches (score > 0), sorted by score then by original fragrance name.
export function findSimilarFragrances(
  source: Fragrance,
  candidates: Fragrance[],
  limit = 6,
): ScoredFragrance[] {
  return candidates
    .map((candidate) => ({
      fragrance: candidate,
      score: scoreSimilarity(source, candidate),
      sharedNotes: getSharedNotes(source, candidate),
    }))
    .filter((scored) => scored.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score ||
        (first.fragrance.originalFragranceName ?? '').localeCompare(
          second.fragrance.originalFragranceName ?? '',
        ),
    )
    .slice(0, limit)
}
