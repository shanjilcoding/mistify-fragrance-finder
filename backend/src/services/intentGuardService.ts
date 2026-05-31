import { getRecommendationIntentGuardTerms } from './recommendationService'

const coreFragranceTerms = [
  'perfume',
  'fragrance',
  'cologne',
  'scent',
  'smell',
  'note',
  'notes',
  'accord',
  'accords',
  'Mistify',
  'longevity',
  'sillage',
  'projection',
]

const commonReferenceTerms = [
  'lafayette',
  'laffyette',
  'angels share',
  'angle share',
  'baccarat rouge',
  'bakarat rouge',
  'imagination',
  'imaginaton',
  'delina',
  'delena',
  'naxos',
  'naxoes',
]

const commonFragranceTypos = [
  'vanila',
  'cocunut',
  'bergamont',
  'sandlewood',
  'tabacco',
  'carmel',
]

const fragranceKeywords = Array.from(
  new Set([
    ...coreFragranceTerms,
    ...getRecommendationIntentGuardTerms(),
    ...commonReferenceTerms,
    ...commonFragranceTypos,
  ]),
)

const referenceRequestPhrases = [
  'something like',
  'similar to',
  'smells like',
  'reminds me of',
  'alternative to',
  'dupe of',
  'inspired by',
]

function normalizeGuardText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasGuardTerm(
  normalizedMessage: string,
  normalizedTokens: Set<string>,
  keyword: string,
) {
  const normalizedKeyword = normalizeGuardText(keyword)

  if (normalizedKeyword.length < 2) {
    return false
  }

  if (normalizedKeyword.includes(' ')) {
    return ` ${normalizedMessage} `.includes(` ${normalizedKeyword} `)
  }

  return normalizedTokens.has(normalizedKeyword)
}

export function isLikelyFragranceRelated(message: string): boolean {
  const normalizedMessage = normalizeGuardText(message)
  const normalizedTokens = new Set(normalizedMessage.split(' ').filter(Boolean))
  const hasReferenceRequestPhrase = referenceRequestPhrases.some((phrase) =>
    hasGuardTerm(normalizedMessage, normalizedTokens, phrase),
  )
  const hasCapitalizedReferenceLikeRequest =
    /\b(?:i like|i love)\s+[A-Z0-9][\w'\u2019.-]*(?:\s+[A-Z0-9][\w'\u2019.-]*){0,5}/.test(
      message,
    )
  const hasCapitalizedReferenceModifierRequest =
    /^[A-Z0-9][\w'\u2019.-]*(?:\s+[A-Z0-9][\w'\u2019.-]*){0,5}\s+but\s+/i.test(
      message,
    )

  return (
    fragranceKeywords.some((keyword) =>
      hasGuardTerm(normalizedMessage, normalizedTokens, keyword),
    ) ||
    hasReferenceRequestPhrase ||
    hasCapitalizedReferenceLikeRequest ||
    hasCapitalizedReferenceModifierRequest
  )
}
