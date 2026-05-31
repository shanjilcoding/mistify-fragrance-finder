import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pool } from '../db/connection'
import {
  type FragranceRecommendation,
  type ReferenceRecommendationDebug,
  getFragranceRecommendationResult,
} from '../services/recommendationService'

type Audience = 'unisex' | 'mens' | 'womens'

type EvaluationCase = {
  query: string
  expectedFamilies?: string[]
  avoidFamilies?: string[]
  requiredTerms?: string[]
  forbiddenTerms?: string[]
  expectedReferenceTerms?: string[]
  expectedAudience?: Audience
  mustNotForceAudience?: Audience
  minRecommendations?: number
  maxRecommendations?: number
  notes?: string
}

type TopResult = {
  rank: number
  name: string
  matchScore: number | null
  matchTier: string | null
  sourceBrandBatch: string | null
  mistifyProductName: string | null
  mistifyProductUrl: string | null
  audience: string | null
  classification: string | null
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  matchSummary?: string
  whyItMatches?: string[]
  bestFor?: string | null
  watchOut?: string | null
  matchedNotes?: string[]
  matchedVibes?: string[]
  matchedOccasions?: string[]
  matchedSeasons?: string[]
  scentProfile?: string[]
  confidenceLabel?: string
  confidenceReason?: string
  referenceSimilarityAngle?: string | null
  sharedWithReference?: string[]
  differentFromReference?: string[]
  missingFromReference?: string[]
  bestIfYouLiked?: string | null
  referenceConfidenceReason?: string | null
  referenceDebug?: ReferenceRecommendationDebug
}

type TestReport = {
  query: string
  notes?: string
  searchMode: string | null
  referenceFragrance: string | null
  recommendationCount: number
  elapsedMs: number
  topResults: TopResult[]
  warnings: string[]
}

type EvaluationReport = {
  generatedAt: string
  totalTests: number
  tests: TestReport[]
  summary: {
    totalWarnings: number
    warningCounts: Record<string, number>
  }
}

const LOW_TOP_SCORE_THRESHOLD = 60
const WEAK_TOP_FIVE_LIMIT = 3
const DENSE_DESSERT_TERMS = [
  'sugar',
  'brown sugar',
  'caramel',
  'praline',
  'chocolate',
  'cacao',
  'cocoa',
  'syrup',
  'ice cream',
  'speculoos',
  'creme brulee',
  'marshmallow',
  'candy',
  'amaretto',
  'coffee',
  'gourmand',
]

const evaluationCases: EvaluationCase[] = [
  {
    query: 'I want coconut and vanilla',
    expectedFamilies: ['coconut', 'vanilla', 'creamy', 'gourmand'],
    requiredTerms: ['coconut', 'vanilla'],
    minRecommendations: 1,
    notes: 'Strict multi-note search should prefer fragrances with both notes or clear family support.',
  },
  {
    query: 'I want a clean office scent',
    expectedFamilies: ['clean', 'fresh', 'musk', 'citrus', 'aromatic'],
    avoidFamilies: ['oud', 'smoke', 'tobacco', 'leather'],
    minRecommendations: 3,
  },
  {
    query: 'I want a sweet date night scent',
    expectedFamilies: ['sweet', 'amber', 'vanilla', 'musk', 'warm', 'gourmand'],
    minRecommendations: 3,
  },
  {
    query: 'I want fresh citrus',
    expectedFamilies: ['fresh', 'citrus', 'bergamot', 'lemon', 'orange', 'neroli'],
    minRecommendations: 3,
  },
  {
    query: "I want a men's fresh citrus fragrance",
    expectedFamilies: ['fresh', 'citrus', 'bergamot', 'lemon', 'orange', 'neroli'],
    expectedAudience: 'mens',
    minRecommendations: 3,
    notes: 'Explicit men audience should prefer mens catalog rows and avoid womens rows when enough mens matches exist.',
  },
  {
    query: "I want a women's vanilla fragrance",
    expectedFamilies: ['vanilla', 'sweet', 'gourmand', 'amber'],
    expectedAudience: 'womens',
    minRecommendations: 3,
    notes: 'Explicit women audience should prefer womens catalog rows and avoid mens rows when enough womens matches exist.',
  },
  {
    query: 'I want a unisex fragrance for date night',
    expectedFamilies: ['amber', 'vanilla', 'musk', 'warm', 'date night'],
    expectedAudience: 'unisex',
    minRecommendations: 3,
    notes: 'Explicit unisex audience should prioritize unisex catalog rows.',
  },
  {
    query: 'I want vanilla but not too feminine',
    expectedFamilies: ['vanilla', 'sweet', 'gourmand'],
    mustNotForceAudience: 'womens',
    minRecommendations: 3,
    notes: 'Negative feminine wording should not be interpreted as a womens audience filter.',
  },
  {
    query: 'I want something masculine but unisex',
    expectedFamilies: ['unisex', 'masculine', 'woody', 'aromatic'],
    expectedAudience: 'unisex',
    minRecommendations: 3,
    notes: 'Explicit unisex should win over masculine style wording.',
  },
  {
    query: 'I want something fresh, maybe citrus',
    expectedFamilies: ['fresh', 'clean', 'citrus', 'bergamot', 'lemon', 'orange'],
    minRecommendations: 3,
    notes: 'Preferred citrus should boost without becoming mandatory.',
  },
  {
    query: 'I want something dark and woody',
    expectedFamilies: ['dark', 'woody', 'oud', 'amber', 'incense', 'leather'],
    minRecommendations: 3,
  },
  {
    query: 'I want rose and musk',
    expectedFamilies: ['rose', 'musk', 'floral', 'clean'],
    requiredTerms: ['rose', 'musk'],
    minRecommendations: 1,
  },
  {
    query: 'I want tobacco and honey',
    expectedFamilies: ['tobacco', 'honey', 'amber', 'vanilla', 'warm'],
    requiredTerms: ['tobacco', 'honey'],
    minRecommendations: 1,
  },
  {
    query: 'I want vanilla and coconut',
    expectedFamilies: ['vanilla', 'coconut', 'creamy', 'musk'],
    requiredTerms: ['vanilla', 'coconut'],
    minRecommendations: 1,
  },
  {
    query: 'I want a gym scent',
    expectedFamilies: ['fresh', 'clean', 'citrus', 'aquatic', 'green', 'musk'],
    avoidFamilies: ['oud', 'tobacco', 'leather', 'smoke', 'gourmand'],
    minRecommendations: 3,
  },
  {
    query: 'something like Blonde Amber',
    expectedFamilies: ['amber', 'warm'],
    expectedReferenceTerms: ['amber'],
    minRecommendations: 1,
    notes: 'Reference query should identify and return a reference fragrance if Blonde Amber exists in the database.',
  },
  {
    query: 'Blonde Amber but fresher',
    expectedFamilies: ['fresh', 'citrus', 'clean', 'green'],
    avoidFamilies: ['smoke', 'heavy tobacco', 'dense gourmand'],
    expectedReferenceTerms: ['amber'],
    minRecommendations: 1,
    notes: 'Leading-reference modifier query should preserve reference similarity while boosting freshness.',
  },
  {
    query: 'Oud Wood but sweeter',
    expectedFamilies: ['oud', 'woody', 'sweet', 'vanilla', 'amber'],
    expectedReferenceTerms: ['oud', 'wood'],
    minRecommendations: 1,
  },
  {
    query: 'I want something like Lafayette Street',
    expectedFamilies: ['fresh', 'woody', 'aromatic', 'citrus'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
    notes: 'Known reference alias should resolve to the matching database row and preserve reference DNA.',
  },
  {
    query: 'I want the same drydown as Lafayette Street',
    expectedFamilies: ['tonka', 'cedar', 'woody', 'vanilla', 'amber'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
    notes: 'Drydown reference request should favor base/middle identity over top-only overlap.',
  },
  {
    query: 'I want the same opening as Lafayette Street',
    expectedFamilies: ['bergamot', 'coriander', 'fresh', 'aromatic'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
  },
  {
    query: 'I want the same heart as Lafayette Street',
    expectedFamilies: ['vanilla', 'apple', 'amber', 'sweet'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
  },
  {
    query: 'I want Lafayette Street but warmer',
    expectedFamilies: ['warm', 'amber', 'woody', 'musk'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
  },
  {
    query: 'I want Lafayette Street but fresher',
    expectedFamilies: ['fresh', 'citrus', 'aromatic', 'green'],
    expectedReferenceTerms: ['lafayette'],
    minRecommendations: 1,
  },
  {
    query: 'I want something like Imagination',
    expectedFamilies: ['fresh', 'citrus', 'tea', 'clean'],
    expectedReferenceTerms: ['imagin'],
    minRecommendations: 1,
  },
  {
    query: 'I want Imagination but warmer',
    expectedFamilies: ['warm', 'amber', 'woody', 'musk'],
    expectedReferenceTerms: ['imagin'],
    minRecommendations: 1,
  },
  {
    query: 'I want something like Afternoon Swim',
    expectedFamilies: ['fresh', 'citrus', 'aquatic'],
    expectedReferenceTerms: ['swim'],
    minRecommendations: 1,
  },
  {
    query: 'I want Afternoon Swim but sweeter',
    expectedFamilies: ['fresh', 'citrus', 'sweet', 'fruity'],
    expectedReferenceTerms: ['swim'],
    minRecommendations: 1,
  },
  {
    query: 'I want Baccarat Rouge 540 but less sweet',
    expectedFamilies: ['amber', 'woody', 'musk', 'fresh', 'clean'],
    avoidFamilies: ['dense gourmand', 'syrup', 'candy'],
    expectedReferenceTerms: ['baccarat', 'baccarata'],
    minRecommendations: 1,
  },
  {
    query: 'I want Oud Wood but sweeter',
    expectedFamilies: ['oud', 'woody', 'sweet', 'vanilla', 'amber'],
    expectedReferenceTerms: ['oud'],
    minRecommendations: 1,
  },
  {
    query: 'I want something like Oud Wood',
    expectedFamilies: ['oud', 'woody', 'spicy', 'amber'],
    expectedReferenceTerms: ['oud'],
    minRecommendations: 1,
  },
  {
    query: 'I want Blonde Amber but fresher',
    expectedFamilies: ['amber', 'fresh', 'citrus', 'clean'],
    expectedReferenceTerms: ['amber'],
    minRecommendations: 1,
  },
  {
    query: 'I want something like Naxos',
    expectedFamilies: ['tobacco', 'honey', 'vanilla', 'warm'],
    expectedReferenceTerms: ['nax'],
    minRecommendations: 1,
  },
  {
    query: 'I want something expensive',
    expectedFamilies: ['luxury', 'expensive', 'saffron', 'oud', 'amber', 'iris', 'sandalwood'],
    minRecommendations: 3,
  },
  {
    query: 'I want compliments',
    expectedFamilies: ['sweet', 'fresh', 'amber', 'vanilla', 'musk'],
    minRecommendations: 1,
    notes: 'Useful broad-language prompt; warnings are expected if this phrase is not strongly modeled yet.',
  },
  {
    query: 'I want vanilla but not too sweet',
    expectedFamilies: ['vanilla', 'musk', 'woody', 'amber'],
    avoidFamilies: ['heavy gourmand', 'dense gourmand', 'syrup', 'candy', 'cotton candy'],
    requiredTerms: ['vanilla'],
    forbiddenTerms: ['cotton candy'],
    minRecommendations: 1,
  },
  {
    query: 'I want no oud',
    avoidFamilies: ['oud', 'agarwood', 'aoud', 'oudh'],
    forbiddenTerms: ['oud', 'agarwood', 'aoud', 'oudh'],
    minRecommendations: 1,
  },
  {
    query: 'I want fresh but not aquatic',
    expectedFamilies: ['fresh', 'citrus', 'clean', 'green'],
    avoidFamilies: ['aquatic', 'marine', 'water notes', 'watery'],
    minRecommendations: 1,
  },
  {
    query: 'I want something without leather',
    expectedFamilies: ['fresh', 'clean', 'musk', 'citrus', 'soft'],
    avoidFamilies: ['leather', 'suede'],
    forbiddenTerms: ['leather', 'suede'],
    minRecommendations: 1,
  },
  {
    query: 'I want something fresh and clean',
    expectedFamilies: ['fresh', 'clean', 'musk', 'citrus', 'green'],
    minRecommendations: 3,
  },
  {
    query: 'I want a winter fragrance',
    expectedFamilies: ['amber', 'vanilla', 'tobacco', 'oud', 'leather', 'spice', 'gourmand'],
    minRecommendations: 3,
  },
  {
    query: 'I want a summer fragrance',
    expectedFamilies: ['fresh', 'citrus', 'aquatic', 'green', 'tropical', 'coconut'],
    avoidFamilies: ['heavy amber', 'tobacco', 'leather', 'smoky'],
    minRecommendations: 3,
  },
  {
    query: 'I want something powdery but not too sweet',
    expectedFamilies: ['powdery', 'iris', 'violet', 'musk', 'almond'],
    requiredTerms: ['powdery'],
    avoidFamilies: ['heavy gourmand', 'dense gourmand', 'syrup', 'candy', 'cotton candy'],
    minRecommendations: 1,
  },
  {
    query: 'I want something powdery but not too feminine',
    expectedFamilies: ['powdery', 'iris', 'violet', 'musk', 'almond'],
    avoidFamilies: ['very feminine', 'feminine'],
    minRecommendations: 1,
  },
  {
    query: 'I want something beginner safe',
    expectedFamilies: ['fresh', 'clean', 'everyday', 'musk', 'citrus', 'soft'],
    avoidFamilies: ['animalic', 'smoky', 'oud', 'loud'],
    minRecommendations: 1,
    notes: 'Broad safety-language prompt; warnings are expected if this phrase is not strongly modeled yet.',
  },
  {
    query: 'I want something creamy and tropical',
    expectedFamilies: ['creamy', 'tropical', 'coconut', 'lactones', 'milk', 'fig', 'pineapple'],
    minRecommendations: 1,
  },
  {
    query: 'I want something musky and clean',
    expectedFamilies: ['musk', 'white musk', 'ambrette', 'clean', 'powdery', 'aldehydes'],
    minRecommendations: 1,
  },
  {
    query: 'I want amber and vanilla',
    expectedFamilies: ['amber', 'vanilla', 'benzoin', 'labdanum', 'tonka'],
    requiredTerms: ['amber', 'vanilla'],
    minRecommendations: 1,
  },
  {
    query: 'I want something smoky but not oud',
    expectedFamilies: ['smoky', 'smoke', 'incense', 'birch', 'leather', 'tobacco'],
    avoidFamilies: ['oud', 'agarwood', 'aoud', 'oudh'],
    forbiddenTerms: ['oud', 'agarwood', 'aoud', 'oudh'],
    minRecommendations: 1,
  },
  {
    query: 'I want a soft floral musk',
    expectedFamilies: ['soft floral', 'floral', 'musk', 'peony', 'magnolia', 'orchid'],
    requiredTerms: ['musk'],
    minRecommendations: 1,
  },
  {
    query: 'I want a woody fragrance, preferably sandalwood',
    expectedFamilies: ['woody', 'sandalwood', 'cedar', 'vetiver', 'palo santo'],
    minRecommendations: 1,
    notes: 'Preferred sandalwood should boost without becoming mandatory.',
  },
  {
    query: 'I want something green and aromatic',
    expectedFamilies: ['green', 'aromatic', 'mint', 'basil', 'tea', 'lavender', 'rosemary'],
    minRecommendations: 1,
  },
  {
    query: 'I want something powdery and floral',
    expectedFamilies: ['powdery', 'floral', 'iris', 'orris', 'violet', 'heliotrope'],
    minRecommendations: 1,
  },
  {
    query: 'I want something resinous and warm',
    expectedFamilies: ['resinous', 'warm', 'amber', 'myrrh', 'olibanum', 'frankincense', 'incense'],
    minRecommendations: 1,
  },
  {
    query: 'I want something aquatic but not too sharp',
    expectedFamilies: ['aquatic', 'marine', 'sea notes', 'watery', 'ozonic', 'fresh'],
    minRecommendations: 1,
  },
  {
    query: 'I want a citrus opening',
    expectedFamilies: ['citrus', 'bergamot', 'lemon', 'orange', 'mandarin', 'grapefruit'],
    minRecommendations: 1,
  },
  {
    query: 'I want a vanilla drydown',
    expectedFamilies: ['vanilla', 'tonka', 'benzoin'],
    minRecommendations: 1,
  },
  {
    query: 'I want a musky base',
    expectedFamilies: ['musk', 'white musk', 'ambrette'],
    minRecommendations: 1,
  },
  {
    query: 'I want a floral heart',
    expectedFamilies: ['floral', 'rose', 'jasmine', 'iris', 'violet', 'orange blossom'],
    minRecommendations: 1,
  },
  {
    query: 'I want warm amber in the base',
    expectedFamilies: ['amber', 'labdanum', 'benzoin', 'amberwood', 'ambroxan'],
    minRecommendations: 1,
  },
  {
    query: 'I want fresh citrus but not heavy',
    expectedFamilies: ['fresh', 'citrus', 'bergamot', 'lemon', 'orange', 'mandarin'],
    minRecommendations: 1,
  },
  {
    query: 'I want an office-safe vanilla',
    expectedFamilies: ['vanilla', 'clean', 'musk', 'soft woods', 'amber'],
    avoidFamilies: ['oud', 'tobacco', 'leather', 'smoke', 'dense gourmand'],
    requiredTerms: ['vanilla'],
    minRecommendations: 1,
  },
  {
    query: 'I want a gym scent that is clean and fresh',
    expectedFamilies: ['fresh', 'clean', 'musk', 'citrus', 'green', 'aquatic'],
    avoidFamilies: ['oud', 'tobacco', 'leather', 'smoke', 'gourmand'],
    minRecommendations: 1,
  },
  {
    query: 'I want a bold night out scent',
    expectedFamilies: ['bold', 'amber', 'vanilla', 'tobacco', 'leather', 'oud', 'spicy', 'sweet'],
    minRecommendations: 1,
  },
  {
    query: 'I want an everyday fragrance',
    expectedFamilies: ['clean', 'fresh', 'musk', 'woody', 'aromatic', 'soft amber'],
    avoidFamilies: ['animalic', 'heavy oud', 'harsh leather', 'dense gourmand'],
    minRecommendations: 1,
  },
  {
    query: 'I want a summer date scent',
    expectedFamilies: ['fresh', 'warm', 'musk', 'vanilla', 'citrus', 'soft woods'],
    avoidFamilies: ['heavy oud', 'dense gourmand', 'tobacco', 'leather'],
    minRecommendations: 1,
  },
  {
    query: 'I want a winter fragrance that feels cozy',
    expectedFamilies: ['warm', 'amber', 'vanilla', 'woods', 'spice', 'gourmand'],
    minRecommendations: 1,
  },
  {
    query: 'I want a beginner-safe vanilla',
    expectedFamilies: ['vanilla', 'musk', 'clean', 'soft amber', 'woody'],
    avoidFamilies: ['oud', 'tobacco', 'leather', 'smoke', 'dense gourmand'],
    requiredTerms: ['vanilla'],
    minRecommendations: 1,
  },
  {
    query: 'I want a formal scent',
    expectedFamilies: ['polished', 'woods', 'musk', 'amber', 'soft floral', 'iris'],
    avoidFamilies: ['candy sweet', 'animalic', 'harsh smoke'],
    minRecommendations: 1,
  },
  {
    query: 'I want a vanilla fragrance',
    expectedFamilies: ['vanilla', 'amber', 'musk', 'woody', 'gourmand'],
    requiredTerms: ['vanilla'],
    minRecommendations: 1,
    notes: 'Diversity check: keep vanilla relevance while avoiding an all-dense-gourmand vanilla list.',
  },
  {
    query: 'I want a fresh fragrance',
    expectedFamilies: ['fresh', 'citrus', 'green', 'aromatic', 'aquatic', 'clean'],
    minRecommendations: 3,
    notes: 'Diversity check: fresh results should vary across fresh subprofiles when comparable options exist.',
  },
  {
    query: 'I want a clean fragrance',
    expectedFamilies: ['clean', 'musk', 'citrus', 'green', 'aromatic', 'soft woods'],
    minRecommendations: 3,
  },
  {
    query: 'I want a sweet fragrance',
    expectedFamilies: ['sweet', 'vanilla', 'amber', 'fruity', 'gourmand', 'floral'],
    minRecommendations: 3,
  },
  {
    query: 'I want a versatile office fragrance',
    expectedFamilies: ['clean', 'fresh', 'musk', 'soft woods', 'citrus', 'aromatic'],
    avoidFamilies: ['oud', 'tobacco', 'leather', 'smoke'],
    minRecommendations: 3,
  },
    {
    query: 'I want a date night fragrance',
    expectedFamilies: ['warm', 'amber', 'vanilla', 'musk', 'rose', 'spicy'],
    minRecommendations: 3,
  },
  {
    query: 'I want coconut and vanilla',
    requiredTerms: ['coconut', 'vanilla'],
    minRecommendations: 1,
    notes: 'Explanation check: should mention coconut/vanilla support and useful layer or family context.',
  },
  {
    query: 'I want vanilla but not too sweet',
    requiredTerms: ['vanilla'],
    minRecommendations: 1,
    notes: 'Explanation check: should mention vanilla plus less-sweet or non-dessert direction.',
  },
  {
    query: 'I want fresh citrus',
    minRecommendations: 1,
    notes: 'Explanation check: should highlight fresh/citrus support without heavy conflict language.',
  },
  {
    query: 'I want a clean office scent',
    minRecommendations: 1,
    notes: 'Explanation check: should mention office-safe, clean, or non-heavy reasoning.',
  },
  {
    query: 'I want a gym scent',
    minRecommendations: 1,
    notes: 'Explanation check: should mention light, fresh, or clean gym suitability.',
  },
  {
    query: 'I want compliments',
    minRecommendations: 1,
    notes: 'Explanation check: should use careful compliment-friendly wording without guarantees.',
  },
  {
    query: 'I want something like Lafayette Street',
    expectedReferenceTerms: ['Lafayette', 'Avenue'],
    minRecommendations: 1,
    notes: 'Explanation check: should describe reference relationship, shared notes, and difference direction.',
  },
  {
    query: 'I want Lafayette Street but warmer',
    expectedReferenceTerms: ['Lafayette', 'Avenue'],
    minRecommendations: 1,
    notes: 'Explanation check: should mention reference DNA plus warmer direction.',
  },
  {
    query: 'I want Oud Wood but sweeter',
    expectedReferenceTerms: ['Oud', 'Wood', 'Woody Oud'],
    minRecommendations: 1,
    notes: 'Explanation check: should mention reference DNA plus sweeter direction.',
  },
  {
    query: 'I want fresh but not aquatic',
    minRecommendations: 1,
    notes: 'Explanation check: should mention fresh direction and aquatic avoidance.',
  },
]

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesTerm(haystack: string, term: string) {
  const normalizedHaystack = ` ${normalizeText(haystack)} `
  const normalizedTerm = normalizeText(term)

  return Boolean(normalizedTerm && normalizedHaystack.includes(` ${normalizedTerm} `))
}

function getRecommendationSearchText(recommendation: FragranceRecommendation) {
  return [
    recommendation.mistifyProductName,
    recommendation.originalFragranceName,
    recommendation.sourceBrandBatch,
    recommendation.classification,
    recommendation.aiExplanation,
    ...recommendation.topNotes,
    ...recommendation.middleNotes,
    ...recommendation.baseNotes,
    ...recommendation.allNotes,
  ]
    .filter(Boolean)
    .join(' ')
}

function getRecommendationDirectText(recommendation: FragranceRecommendation) {
  return [
    recommendation.mistifyProductName,
    recommendation.originalFragranceName,
    recommendation.classification,
    ...recommendation.topNotes,
    ...recommendation.middleNotes,
    ...recommendation.baseNotes,
    ...recommendation.allNotes,
  ]
    .filter(Boolean)
    .join(' ')
}

function hasDirectTerm(recommendation: FragranceRecommendation, term: string) {
  return includesTerm(getRecommendationDirectText(recommendation), term)
}

function layerHasAnyTerm(notes: string[], terms: string[]) {
  const text = notes.join(' ')

  return terms.some((term) => includesTerm(text, term))
}

function getDenseDessertTermCount(recommendation: FragranceRecommendation) {
  const directText = getRecommendationDirectText(recommendation)

  return DENSE_DESSERT_TERMS.filter((term) => includesTerm(directText, term)).length
}

function getEvaluationDominantProfile(recommendation: FragranceRecommendation) {
  const text = getRecommendationDirectText(recommendation)

  if (['oud', 'leather', 'tobacco', 'smoke', 'smoky'].some((term) => includesTerm(text, term))) {
    return 'dark-oud-leather-tobacco'
  }

  if (getDenseDessertTermCount(recommendation) >= 2) {
    return 'dense-sweet-gourmand'
  }

  if (['citrus', 'bergamot', 'lemon', 'grapefruit', 'orange', 'mandarin'].some((term) => includesTerm(text, term))) {
    return 'fresh-citrus'
  }

  if (['aquatic', 'marine', 'sea notes', 'watery', 'ozonic'].some((term) => includesTerm(text, term))) {
    return 'fresh-aquatic'
  }

  if (['musk', 'white musk', 'clean', 'soapy', 'aldehydes'].some((term) => includesTerm(text, term))) {
    return 'clean-musk'
  }

  if (['rose', 'musk'].every((term) => includesTerm(text, term))) {
    return 'rose-musk'
  }

  if (['vanilla', 'amber'].every((term) => includesTerm(text, term))) {
    return 'warm-amber-vanilla'
  }

  if (['woody', 'cedar', 'sandalwood', 'vetiver'].some((term) => includesTerm(text, term))) {
    return 'woody-aromatic'
  }

  return normalizeText(recommendation.classification ?? '').split(' ')[0] || 'unknown'
}

function isFreshCitrusEvaluationQuery(query: string) {
  return [
    'I want fresh citrus',
    'I want a fresh fragrance',
    'I want something fresh, maybe citrus',
    'I want fresh citrus but not heavy',
  ].includes(query)
}

function isExactFreshCitrusEvaluationQuery(query: string) {
  return ['I want fresh citrus'].includes(query)
}

function hasFreshCitrusOffProfileConflict(recommendation: FragranceRecommendation) {
  const text = getRecommendationDirectText(recommendation)
  const classification = normalizeText(recommendation.classification ?? '')
  const denseDessertCount = getDenseDessertTermCount(recommendation)
  const hasDarkConflict = [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'tobacco',
    'tobacco leaf',
    'leather',
    'smoke',
    'smoky',
    'incense',
  ].some((term) => includesTerm(text, term))
  const hasGourmandConflict =
    denseDessertCount >= 2 ||
    classification.includes('gourmand') ||
    classification.includes('floral gourmand')

  return hasDarkConflict || hasGourmandConflict
}

function hasExactFreshCitrusOffProfileConflict(recommendation: FragranceRecommendation) {
  const text = getRecommendationDirectText(recommendation)
  const classification = normalizeText(recommendation.classification ?? '')
  const hasFreshCitrusClassification = [
    'citrus',
    'citrus aromatic',
    'green citrus',
    'fresh',
    'fresh aromatic',
    'aquatic',
    'clean',
  ].some((term) => includesTerm(classification, term))
  const hasFloralSweetProfile =
    !hasFreshCitrusClassification &&
    ['floral woody musk', 'floral', 'fruity floral', 'floral sweet'].some((term) =>
      includesTerm(classification, term),
    ) &&
    ['caramel', 'milk', 'cream', 'vanilla', 'amber', 'peach', 'cherry', 'fruity'].some(
      (term) => includesTerm(text, term),
    )

  return hasFreshCitrusOffProfileConflict(recommendation) || hasFloralSweetProfile
}

function getMostCommonCount(values: string[]) {
  return values.reduce((highest, value) => {
    const count = values.filter((candidate) => candidate === value).length

    return Math.max(highest, count)
  }, 0)
}

function getExplanationText(recommendation: FragranceRecommendation) {
  return [
    recommendation.aiExplanation,
    recommendation.matchSummary,
    recommendation.confidenceReason,
    recommendation.referenceConfidenceReason,
    recommendation.watchOut,
    ...(recommendation.whyItMatches ?? []),
    ...(recommendation.sharedWithReference ?? []),
    ...(recommendation.differentFromReference ?? []),
  ]
    .filter(Boolean)
    .join(' ')
}

function isGenericExplanationText(value: string) {
  const normalized = normalizeText(value)

  return (
    !normalized ||
    normalized === 'strong profile support' ||
    normalized.includes('has strong profile support for this broader request') ||
    normalized.includes('supports profile cues') ||
    normalized.includes('supports fresh and citrus profile cues') ||
    normalized.includes('crowd feedback helps it rank within this fit tier') ||
    normalized.includes('generic ranking system')
  )
}

function hasSuspiciousPublicScentProfile(recommendation: FragranceRecommendation) {
  const directText = getRecommendationDirectText(recommendation)
  const profileTags = recommendation.scentProfile ?? []

  if (
    profileTags.some((tag) =>
      ['not verified', 'not fully verified', 'not verified on mistify'].some((placeholder) =>
        normalizeText(tag).includes(placeholder),
      ) || normalizeText(tag).includes('not listed clearly'),
    )
  ) {
    return true
  }

  return profileTags.some((tag) => {
    const normalizedTag = normalizeText(tag)
    const suspiciousTags = ['oud', 'tobacco', 'leather', 'smoke', 'smoky']

    return suspiciousTags.includes(normalizedTag) && !includesTerm(directText, normalizedTag)
  })
}

function hasWarmSweetFreshCitrusContrast(recommendation: FragranceRecommendation) {
  const text = getRecommendationDirectText(recommendation)
  const classification = normalizeText(recommendation.classification ?? '')
  const hasClearFreshCitrusClassification = [
    'citrus',
    'citrus aromatic',
    'green citrus',
    'fresh aromatic',
    'aquatic citrus',
  ].some((term) => includesTerm(classification, term))
  const contrastCount = [
    'vanilla',
    'rum',
    'cacao',
    'cocoa',
    'caramel',
    'tobacco',
    'patchouli',
    'amber',
    'gourmand',
    'oriental vanilla',
  ].filter((term) => includesTerm(text, term)).length

  return !hasClearFreshCitrusClassification && contrastCount >= 2
}

function hasFloralSweetBroadFreshContrast(recommendation: FragranceRecommendation) {
  const text = getRecommendationDirectText(recommendation)
  const classification = normalizeText(recommendation.classification ?? '')
  const hasFloralProfile = [
    'floral',
    'floral woody musk',
    'floral fruity',
    'fruity floral',
  ].some((term) => includesTerm(classification, term))
  const sweetWarmCount = [
    'vanilla',
    'caramel',
    'milk',
    'cream',
    'amber',
    'peach',
    'cherry',
    'gourmand',
  ].filter((term) => includesTerm(text, term)).length

  return hasFloralProfile && sweetWarmCount >= 2
}

function isBroadDiversityQuery(query: string) {
  return [
    'I want compliments',
    'I want something beginner safe',
    'I want something expensive',
    'I want an everyday fragrance',
    'I want a winter fragrance',
    'I want a vanilla fragrance',
    'I want a fresh fragrance',
    'I want a clean fragrance',
    'I want a sweet fragrance',
    'I want a versatile office fragrance',
    'I want a date night fragrance',
  ].includes(query)
}

function allowsTightContextProfile(query: string) {
  const normalizedQuery = normalizeText(query)

  return (
    normalizedQuery.includes('office') ||
    normalizedQuery.includes('gym') ||
    normalizedQuery.includes('formal')
  )
}

function getSharedMiddleBaseIdentityCount(
  recommendation: FragranceRecommendation,
  referenceFragrance: Awaited<
    ReturnType<typeof getFragranceRecommendationResult>
  >['referenceFragrance'],
) {
  if (!referenceFragrance) {
    return 0
  }

  const candidateTerms = new Set(
    [...recommendation.middleNotes, ...recommendation.baseNotes].map(normalizeText),
  )

  return [...referenceFragrance.middleNotes, ...referenceFragrance.baseNotes]
    .map(normalizeText)
    .filter((term) => term && candidateTerms.has(term)).length
}

function getRecommendationName(recommendation: FragranceRecommendation) {
  return (
    recommendation.mistifyProductName?.trim() ||
    recommendation.originalFragranceName?.trim() ||
    'Unnamed fragrance'
  )
}

function normalizeAudience(value: string | null | undefined): Audience | null {
  if (value === 'unisex' || value === 'mens' || value === 'womens') {
    return value
  }

  return null
}

function toTopResult(
  recommendation: FragranceRecommendation,
  index: number,
): TopResult {
  return {
    rank: index + 1,
    name: getRecommendationName(recommendation),
    matchScore:
      typeof recommendation.matchScore === 'number'
        ? recommendation.matchScore
        : null,
    matchTier: recommendation.matchTier ?? null,
    sourceBrandBatch: recommendation.sourceBrandBatch ?? null,
    mistifyProductName: recommendation.mistifyProductName ?? null,
    mistifyProductUrl: recommendation.mistifyProductUrl ?? null,
    audience: recommendation.audience ?? null,
    classification: recommendation.classification ?? null,
    topNotes: recommendation.topNotes,
    middleNotes: recommendation.middleNotes,
    baseNotes: recommendation.baseNotes,
    allNotes: recommendation.allNotes,
    matchSummary: recommendation.matchSummary,
    whyItMatches: recommendation.whyItMatches,
    bestFor: recommendation.bestFor,
    watchOut: recommendation.watchOut,
    matchedNotes: recommendation.matchedNotes,
    matchedVibes: recommendation.matchedVibes,
    matchedOccasions: recommendation.matchedOccasions,
    matchedSeasons: recommendation.matchedSeasons,
    scentProfile: recommendation.scentProfile,
    confidenceLabel: recommendation.confidenceLabel,
    confidenceReason: recommendation.confidenceReason,
    referenceSimilarityAngle: recommendation.referenceSimilarityAngle,
    sharedWithReference: recommendation.sharedWithReference,
    differentFromReference: recommendation.differentFromReference,
    missingFromReference: recommendation.missingFromReference,
    bestIfYouLiked: recommendation.bestIfYouLiked,
    referenceConfidenceReason: recommendation.referenceConfidenceReason,
    referenceDebug: recommendation.referenceDebug,
  }
}

function isReferenceQuery(testCase: EvaluationCase) {
  const query = testCase.query.toLowerCase()
  const knownReferenceNames = [
    'lafayette street',
    'imagination',
    'afternoon swim',
    'baccarat rouge 540',
    'oud wood',
    'blonde amber',
    'naxos',
  ]

  return (
    query.includes('something like') ||
    query.includes('similar to') ||
    query.includes('smells like') ||
    query.includes('reminds me of') ||
    query.includes('alternative to') ||
    query.includes('dupe of') ||
    query.includes('inspired by') ||
    (query.includes(' but ') &&
      knownReferenceNames.some((referenceName) => query.includes(referenceName)))
  )
}

function getReferenceName(
  referenceFragrance: Awaited<
    ReturnType<typeof getFragranceRecommendationResult>
  >['referenceFragrance'],
) {
  if (!referenceFragrance) {
    return null
  }

  return (
    referenceFragrance.mistifyProductName?.trim() ||
    referenceFragrance.originalFragranceName?.trim() ||
    null
  )
}

function buildWarnings(params: {
  testCase: EvaluationCase
  recommendations: FragranceRecommendation[]
  topResults: TopResult[]
  searchMode: string | undefined
  referenceFragrance: Awaited<
    ReturnType<typeof getFragranceRecommendationResult>
  >['referenceFragrance']
}) {
  const {
    testCase,
    recommendations,
    topResults,
    searchMode,
    referenceFragrance,
  } = params
  const warnings: string[] = []
  const minRecommendations = testCase.minRecommendations ?? 1
  const topRecommendations = recommendations.slice(0, 5)

  if (recommendations.length === 0) {
    warnings.push('no recommendations')
  }

  if (recommendations.length < minRecommendations) {
    warnings.push(
      `fewer than minRecommendations (${recommendations.length}/${minRecommendations})`,
    )
  }

  if (
    typeof topResults[0]?.matchScore === 'number' &&
    topResults[0].matchScore < LOW_TOP_SCORE_THRESHOLD
  ) {
    warnings.push(
      `top result has low match score (${topResults[0].matchScore})`,
    )
  }

  if (
    typeof testCase.maxRecommendations === 'number' &&
    recommendations.length > testCase.maxRecommendations
  ) {
    warnings.push(
      `more than maxRecommendations (${recommendations.length}/${testCase.maxRecommendations})`,
    )
  }

  const weakTopFiveCount = topResults.filter(
    (result) => result.matchTier === 'possible',
  ).length

  if (
    topResults.length >= 5 &&
    recommendations.length >= 10 &&
    weakTopFiveCount >= WEAK_TOP_FIVE_LIMIT
  ) {
    warnings.push(`too many weak/possible matches in top 5 (${weakTopFiveCount})`)
  }

  const missingExplanationResult = topRecommendations.find(
    (recommendation) =>
      !recommendation.matchSummary ||
      !recommendation.whyItMatches?.length ||
      !recommendation.confidenceLabel ||
      !recommendation.confidenceReason,
  )

  if (missingExplanationResult) {
    warnings.push(
      `missing structured explanation fields (${getRecommendationName(
        missingExplanationResult,
      )})`,
    )
  }

  const genericExplanationResult = topRecommendations.find((recommendation) =>
    isGenericExplanationText(getExplanationText(recommendation)),
  )

  if (genericExplanationResult) {
    warnings.push(
      `generic or empty explanation text (${getRecommendationName(
        genericExplanationResult,
      )})`,
    )
  }

  const suspiciousProfileResult = topRecommendations.find(
    hasSuspiciousPublicScentProfile,
  )

  if (suspiciousProfileResult) {
    warnings.push(
      `scentProfile contains unsupported or noisy tag (${getRecommendationName(
        suspiciousProfileResult,
      )})`,
    )
  }

  if (testCase.expectedAudience) {
    const expectedAudience = testCase.expectedAudience
    const matchingAudienceCount = recommendations.filter(
      (recommendation) => normalizeAudience(recommendation.audience) === expectedAudience,
    ).length
    const wrongAudienceResult = topRecommendations.find((recommendation) => {
      const audience = normalizeAudience(recommendation.audience)

      return audience !== null && audience !== expectedAudience
    })

    if (matchingAudienceCount >= 5 && wrongAudienceResult) {
      warnings.push(
        `explicit ${expectedAudience} audience query returned ${normalizeAudience(
          wrongAudienceResult.audience,
        )} in top 5 (${getRecommendationName(wrongAudienceResult)})`,
      )
    }
  }

  if (testCase.mustNotForceAudience && topRecommendations.length >= 5) {
    const forcedAudienceCount = topRecommendations.filter(
      (recommendation) =>
        normalizeAudience(recommendation.audience) === testCase.mustNotForceAudience,
    ).length

    if (forcedAudienceCount === topRecommendations.length) {
      warnings.push(
        `non-explicit audience query appears forced to ${testCase.mustNotForceAudience}`,
      )
    }
  }

  if (testCase.query === 'I want fresh citrus') {
    const overconfidentContrastResult = topRecommendations.find(
      (recommendation) =>
        recommendation.confidenceLabel === 'Excellent fit' &&
        hasWarmSweetFreshCitrusContrast(recommendation) &&
        !recommendation.watchOut,
    )

    if (overconfidentContrastResult) {
      warnings.push(
        `exact fresh/citrus result is overconfident without watchOut (${getRecommendationName(
          overconfidentContrastResult,
        )})`,
      )
    }
  }

  if (testCase.query === 'I want something fresh, maybe citrus') {
    const overstatedFreshResult = topRecommendations.find((recommendation) => {
      const summary = normalizeText(recommendation.matchSummary ?? '')

      return (
        summary.includes('leans fresh and citrus') &&
        hasFloralSweetBroadFreshContrast(recommendation) &&
        !recommendation.watchOut
      )
    })

    if (overstatedFreshResult) {
      warnings.push(
        `broad fresh explanation overstates fresh/citrus without watchOut (${getRecommendationName(
          overstatedFreshResult,
        )})`,
      )
    }
  }

  const longExplanationResult = topRecommendations.find((recommendation) => {
    const explanationText = getExplanationText(recommendation)

    return (
      (recommendation.matchSummary?.length ?? 0) > 220 ||
      (recommendation.watchOut?.length ?? 0) > 160 ||
      explanationText.length > 900
    )
  })

  if (longExplanationResult) {
    warnings.push(
      `explanation text is too long (${getRecommendationName(
        longExplanationResult,
      )})`,
    )
  }

  if (isBroadDiversityQuery(testCase.query) && recommendations.length >= 10) {
    const topTenRecommendations = recommendations.slice(0, 10)
    const brandCounts = topTenRecommendations
      .map((recommendation) => normalizeText(recommendation.sourceBrandBatch))
      .filter(Boolean)
    const profileCounts = topTenRecommendations.map(getEvaluationDominantProfile)
    const uniqueClassificationCount = new Set(
      topTenRecommendations.map((recommendation) =>
        normalizeText(recommendation.classification ?? ''),
      ),
    ).size
    const repeatedBrandCount = getMostCommonCount(brandCounts)
    const repeatedProfileCount = getMostCommonCount(profileCounts)

    if (brandCounts.length >= 8 && repeatedBrandCount >= 5) {
      warnings.push(`too many top 10 results from same brand (${repeatedBrandCount})`)
    }

    if (
      !allowsTightContextProfile(testCase.query) &&
      repeatedProfileCount >= 8 &&
      uniqueClassificationCount <= 4
    ) {
      warnings.push(`too many top 10 results with same dominant profile (${repeatedProfileCount})`)
    }

    if (
      testCase.query === 'I want a vanilla fragrance' &&
      topTenRecommendations.filter((recommendation) => getDenseDessertTermCount(recommendation) >= 3).length >= 7
    ) {
      warnings.push('vanilla diversity check found too many dense gourmand vanilla results')
    }
  }

  if (testCase.query.toLowerCase().includes('compliments')) {
    const overpromisingResult = topRecommendations.find((recommendation) =>
      /\bguarantee(?:d|s)?\b|\bwill get\b|\bgets compliments\b/i.test(
        getExplanationText(recommendation),
      ),
    )

    if (overpromisingResult) {
      warnings.push(
        `broad compliment explanation overpromises (${getRecommendationName(
          overpromisingResult,
        )})`,
      )
    }
  }

  const forbiddenTerms = testCase.forbiddenTerms ?? []
  for (const term of forbiddenTerms) {
    const matchedResult = recommendations.find((recommendation) =>
      includesTerm(getRecommendationDirectText(recommendation), term),
    )

    if (matchedResult) {
      warnings.push(
        `forbidden term "${term}" appears in returned results (${getRecommendationName(
          matchedResult,
        )})`,
      )
    }
  }

  const avoidFamilies = testCase.avoidFamilies ?? []
  for (const family of avoidFamilies) {
    const matchedResult = recommendations.find((recommendation) =>
      includesTerm(getRecommendationDirectText(recommendation), family),
    )

    if (matchedResult) {
      warnings.push(
        `avoid family "${family}" appears in returned results (${getRecommendationName(
          matchedResult,
        )})`,
      )
    }
  }

  const requiredTerms = testCase.requiredTerms ?? []
  for (const term of requiredTerms) {
    const hasTerm = topRecommendations.some((recommendation) =>
      includesTerm(getRecommendationSearchText(recommendation), term),
    )

    if (!hasTerm) {
      warnings.push(`required term "${term}" not found in top results`)
    }
  }

  if (isReferenceQuery(testCase) && !referenceFragrance) {
    warnings.push(
      `reference query did not return referenceFragrance (searchMode=${searchMode ?? 'normal'})`,
    )
  }

  if (isReferenceQuery(testCase) && searchMode !== 'reference') {
    warnings.push(`reference query was classified as ${searchMode ?? 'normal'}`)
  }

  if (isReferenceQuery(testCase)) {
    const missingReferenceExplanation = topRecommendations
      .slice(0, 3)
      .find(
        (recommendation) =>
          !recommendation.referenceSimilarityAngle ||
          !recommendation.sharedWithReference?.length ||
          !recommendation.referenceConfidenceReason,
      )

    if (missingReferenceExplanation) {
      warnings.push(
        `reference explanation missing relationship fields (${getRecommendationName(
          missingReferenceExplanation,
        )})`,
      )
    }
  }

  if (referenceFragrance && testCase.expectedReferenceTerms?.length) {
    const referenceText = normalizeText(
      [
        referenceFragrance.mistifyProductName,
        referenceFragrance.originalFragranceName,
        referenceFragrance.sourceBrandBatch,
      ]
        .filter(Boolean)
        .join(' '),
    )
    const hasExpectedReferenceTerm = testCase.expectedReferenceTerms.some((term) =>
      referenceText.includes(normalizeText(term)),
    )

    if (!hasExpectedReferenceTerm) {
      warnings.push(
        `reference fragrance does not match expected reference terms (${getReferenceName(
          referenceFragrance,
        ) ?? 'unknown'})`,
      )
    }
  }

  if (
    testCase.query.toLowerCase().includes('but not too') &&
    searchMode === 'reference'
  ) {
    warnings.push('but-not-too prompt was misclassified as reference mode')
  }

  if (
    testCase.query.toLowerCase().includes('not') ||
    testCase.query.toLowerCase().includes('without') ||
    testCase.query.toLowerCase().includes('avoid')
  ) {
    const avoidedTerms = [
      ...(testCase.forbiddenTerms ?? []),
      ...(testCase.avoidFamilies ?? []),
      ...testCase.query
        .toLowerCase()
        .split(/\bnot too\b|\bnot\b|\bwithout\b|\bavoid\b/)
        .slice(1)
        .join(' ')
        .split(/\band\b|,|\./)
        .map(normalizeText)
        .filter(Boolean)
        .slice(0, 2),
    ]
    const explanationText = getExplanationText(topRecommendations[0] ?? ({} as FragranceRecommendation))
    const mentionsAvoidedTerm = avoidedTerms.some((term) =>
      includesTerm(explanationText, term),
    )

    if (avoidedTerms.length && !mentionsAvoidedTerm) {
      warnings.push('negative-prompt explanation does not mention avoided direction')
    }
  }

  if (testCase.query === 'I want vanilla but not too sweet') {
    const weakNonVanillaTopResult = topRecommendations.find(
      (recommendation) =>
        recommendation.matchTier === 'possible' &&
        !hasDirectTerm(recommendation, 'vanilla'),
    )

    if (weakNonVanillaTopResult) {
      warnings.push(
        `top 5 contains weak possible result without direct vanilla (${getRecommendationName(
          weakNonVanillaTopResult,
        )})`,
      )
    }

    const highDenseDessertResult = topRecommendations.find(
      (recommendation) =>
        recommendation.matchTier === 'high' &&
        getDenseDessertTermCount(recommendation) >= 3,
    )

    if (highDenseDessertResult) {
      warnings.push(
        `top 5 contains high dense dessert/gourmand result (${getRecommendationName(
          highDenseDessertResult,
        )})`,
      )
    }
  }

  if (testCase.query === 'I want something powdery but not too feminine') {
    const feminineDominatedTopResult = topRecommendations.find(
      (recommendation) =>
        recommendation.matchTier === 'high' &&
        includesTerm(getRecommendationDirectText(recommendation), 'feminine'),
    )

    if (feminineDominatedTopResult) {
      warnings.push(
        `top 5 contains high feminine-coded result despite soft cap (${getRecommendationName(
          feminineDominatedTopResult,
        )})`,
      )
    }
  }

  const layerExpectations: Record<
    string,
    { layer: 'topNotes' | 'middleNotes' | 'baseNotes'; terms: string[] }
  > = {
    'I want a citrus opening': {
      layer: 'topNotes',
      terms: ['citrus', 'bergamot', 'lemon', 'orange', 'mandarin', 'grapefruit', 'citron', 'lime'],
    },
    'I want a vanilla drydown': {
      layer: 'baseNotes',
      terms: ['vanilla', 'tonka', 'benzoin'],
    },
    'I want a musky base': {
      layer: 'baseNotes',
      terms: ['musk', 'white musk', 'ambrette'],
    },
    'I want a floral heart': {
      layer: 'middleNotes',
      terms: ['floral', 'rose', 'jasmine', 'iris', 'violet', 'orange blossom', 'tuberose', 'peony'],
    },
    'I want warm amber in the base': {
      layer: 'baseNotes',
      terms: ['amber', 'labdanum', 'benzoin', 'amberwood', 'ambroxan'],
    },
  }
  const layerExpectation = layerExpectations[testCase.query]

  if (layerExpectation && topRecommendations.length > 0) {
    const topLayerMatches = topRecommendations.slice(0, 3).filter(
      (recommendation) =>
        layerHasAnyTerm(
          recommendation[layerExpectation.layer],
          layerExpectation.terms,
        ),
    ).length

    if (topLayerMatches === 0) {
      warnings.push(
        `requested ${layerExpectation.layer} support missing from top results`,
      )
    }
  }

  if (testCase.query === 'I want fresh citrus but not heavy') {
    const heavyTopResult = topRecommendations.find((recommendation) =>
      ['oud', 'tobacco', 'dense gourmand', 'heavy amber'].some((term) =>
        includesTerm(getRecommendationDirectText(recommendation), term),
      ),
    )

    if (heavyTopResult) {
      warnings.push(
        `heavy profile appears in top fresh-light results (${getRecommendationName(
          heavyTopResult,
        )})`,
      )
    }
  }

  if (isFreshCitrusEvaluationQuery(testCase.query)) {
    const offProfileTopResult = topRecommendations.find(
      hasFreshCitrusOffProfileConflict,
    )

    if (offProfileTopResult) {
      warnings.push(
        `off-profile fresh/citrus result appears in top 5 (${getRecommendationName(
          offProfileTopResult,
        )})`,
      )
    }
  }

  if (isExactFreshCitrusEvaluationQuery(testCase.query)) {
    const offProfileTopResult = topRecommendations.find(
      hasExactFreshCitrusOffProfileConflict,
    )

    if (offProfileTopResult) {
      warnings.push(
        `exact fresh/citrus top 5 contains floral-sweet off-profile result (${getRecommendationName(
          offProfileTopResult,
        )})`,
      )
    }
  }

  if (
    [
      'I want compliments',
      'I want something beginner safe',
      'I want something expensive',
      'I want fresh citrus',
    ].includes(testCase.query)
  ) {
    const topScores = topResults
      .map((result) => result.matchScore)
      .filter((score): score is number => typeof score === 'number')
    const nearIdenticalHighScoreCount = topScores.filter(
      (score) => Math.abs(score - (topScores[0] ?? 0)) <= 1 && score >= 90,
    ).length

    if (nearIdenticalHighScoreCount >= 4) {
      warnings.push(
        `too many near-identical high match scores in top 5 (${nearIdenticalHighScoreCount})`,
      )
    }
  }

  if (referenceFragrance) {
    const missingDebugResult = topRecommendations
      .slice(0, 3)
      .find((recommendation) => !recommendation.referenceDebug?.similarityAngle)

    if (missingDebugResult) {
      warnings.push(
        `similarityAngle missing for top reference result (${getRecommendationName(
          missingDebugResult,
        )})`,
      )
    }

    const topTenAngles = recommendations
      .slice(0, 10)
      .map((recommendation) => recommendation.referenceDebug?.similarityAngle ?? '')
      .filter(Boolean)
    const topTenReferenceDirections = new Set(
      recommendations
        .slice(0, 10)
        .flatMap((recommendation) => [
          ...(recommendation.referenceDebug?.secondarySimilarityAngles ?? []),
          ...(recommendation.referenceDebug?.differenceDirections ?? []),
        ])
        .filter(Boolean),
    )

    if (
      topTenAngles.length >= 8 &&
      getMostCommonCount(topTenAngles) >= 8 &&
      topTenReferenceDirections.size <= 1 &&
      ['I want something like Lafayette Street', 'I want something like Oud Wood'].includes(
        testCase.query,
      )
    ) {
      warnings.push('reference diversity check found too many repeated similarity angles')
    }

    const weakLayerSupportResult = topRecommendations.find((recommendation) => {
      const debug = recommendation.referenceDebug

      return (
        recommendation.matchTier === 'high' &&
        debug &&
        debug.sameLayerMatches.length === 0 &&
        debug.nearLayerMatches.length === 0
      )
    })

    if (weakLayerSupportResult) {
      warnings.push(
        `high reference match lacks same-layer or near-layer support (${getRecommendationName(
          weakLayerSupportResult,
        )})`,
      )
    }

    const referenceName = normalizeText(getReferenceName(referenceFragrance) ?? '')
    const originalReferenceName = normalizeText(
      referenceFragrance.originalFragranceName ?? '',
    )
    const exactReferenceResult = recommendations.find((recommendation) => {
      const recommendationName = normalizeText(getRecommendationName(recommendation))
      const recommendationOriginalName = normalizeText(
        recommendation.originalFragranceName ?? '',
      )

      return (
        recommendationName === referenceName ||
        (originalReferenceName &&
          recommendationOriginalName === originalReferenceName)
      )
    })

    if (exactReferenceResult) {
      warnings.push(
        `exact reference fragrance appears in recommendations (${getRecommendationName(
          exactReferenceResult,
        )})`,
      )
    }

    const weakDnaHighMatch = topRecommendations.find(
      (recommendation) =>
        recommendation.matchTier === 'high' &&
        getSharedMiddleBaseIdentityCount(recommendation, referenceFragrance) < 2,
    )

    if (weakDnaHighMatch) {
      warnings.push(
        `high reference match lacks shared middle/base identity (${getRecommendationName(
          weakDnaHighMatch,
        )})`,
      )
    }

    const modifierReferenceQuery =
      testCase.query.toLowerCase().includes(' but ') ||
      testCase.query.toLowerCase().includes('less ') ||
      testCase.query.toLowerCase().includes('more ')
    const modifierDominatedHighMatch = topRecommendations.find(
      (recommendation) =>
        modifierReferenceQuery &&
        recommendation.matchTier === 'high' &&
        getSharedMiddleBaseIdentityCount(recommendation, referenceFragrance) === 0,
    )

    if (modifierDominatedHighMatch) {
      warnings.push(
        `modifier appears to dominate weak reference DNA (${getRecommendationName(
          modifierDominatedHighMatch,
        )})`,
      )
    }

    if (testCase.query === 'I want the same drydown as Lafayette Street') {
      const weakDrydownResult = topRecommendations.find((recommendation) => {
        const debug = recommendation.referenceDebug

        return (
          recommendation.matchTier === 'high' &&
          debug &&
          !debug.sameLayerMatches.some((term) =>
            ['tonka', 'tonka bean', 'cedar', 'cedarwood', 'dry wood accord'].some(
              (drydownTerm) => includesTerm(term, drydownTerm),
            ),
          ) &&
          debug.nearLayerMatches.length < 2
        )
      })

      if (weakDrydownResult) {
        warnings.push(
          `same drydown request has high result without drydown support (${getRecommendationName(
            weakDrydownResult,
          )})`,
        )
      }
    }

    if (testCase.query.toLowerCase().includes('lafayette street')) {
      const weakLafayetteResult = topRecommendations.find((recommendation) => {
        const debug = recommendation.referenceDebug

        return (
          recommendation.matchTier === 'high' &&
          debug &&
          debug.sharedReferenceNotes.length < 2 &&
          debug.accordPairMatches.length === 0
        )
      })

      if (weakLafayetteResult) {
        warnings.push(
          `Lafayette Street high result misses most middle/base DNA (${getRecommendationName(
            weakLafayetteResult,
          )})`,
        )
      }
    }
  }

  return warnings
}

function printTestReport(report: TestReport) {
  console.log('')
  console.log(`Query: ${report.query}`)
  console.log(`Search mode: ${report.searchMode ?? 'normal'}`)
  console.log(`Reference fragrance: ${report.referenceFragrance ?? 'none'}`)
  console.log(`Recommendations: ${report.recommendationCount}`)
  console.log(`Elapsed: ${report.elapsedMs}ms`)

  if (report.notes) {
    console.log(`Notes: ${report.notes}`)
  }

  if (report.topResults.length) {
    console.log('Top 5:')
    for (const result of report.topResults) {
      console.log(
        `  ${result.rank}. ${result.name} | score=${result.matchScore ?? 'n/a'} | tier=${result.matchTier ?? 'n/a'} | brand=${result.sourceBrandBatch ?? 'n/a'} | mistify=${result.mistifyProductName ?? 'n/a'} | audience=${result.audience ?? 'n/a'}`,
      )
      if (result.referenceDebug) {
        console.log(
          `     reference: angle=${result.referenceDebug.similarityAngle ?? 'n/a'} dna=${result.referenceDebug.referenceDNAFit} layer=${result.referenceDebug.referenceLayerFit} family=${result.referenceDebug.referenceFamilyFit} modifier=${result.referenceDebug.modifierFit} cap=${result.referenceDebug.capReason ?? 'none'}`,
        )
        console.log(
          `     shared=${result.referenceDebug.sharedReferenceNotes.slice(0, 6).join(', ') || 'none'} pairs=${result.referenceDebug.accordPairMatches.slice(0, 3).join('; ') || 'none'} directions=${result.referenceDebug.differenceDirections.slice(0, 3).join(', ') || 'none'}`,
        )
      }
    }
  } else {
    console.log('Top 5: none')
  }

  if (report.warnings.length) {
    console.log('Warnings:')
    for (const warning of report.warnings) {
      console.log(`  - ${warning}`)
    }
  } else {
    console.log('Warnings: none')
  }
}

function countWarnings(tests: TestReport[]) {
  return tests.reduce<Record<string, number>>((counts, test) => {
    for (const warning of test.warnings) {
      const warningKey = warning.replace(/\s*\([^)]*\)/g, '')
      counts[warningKey] = (counts[warningKey] ?? 0) + 1
    }

    return counts
  }, {})
}

async function evaluateTestCase(testCase: EvaluationCase): Promise<TestReport> {
  const startedAt = Date.now()
  const result = await getFragranceRecommendationResult(testCase.query, {
    includeReferenceDebug: true,
  })
  const elapsedMs = Date.now() - startedAt
  const recommendations = result.recommendations
  const topResults = recommendations.slice(0, 5).map(toTopResult)
  const referenceFragrance = getReferenceName(result.referenceFragrance)
  const warnings = buildWarnings({
    testCase,
    recommendations,
    topResults,
    searchMode: result.searchMode,
    referenceFragrance: result.referenceFragrance,
  })

  return {
    query: testCase.query,
    notes: testCase.notes,
    searchMode: result.searchMode ?? 'normal',
    referenceFragrance,
    recommendationCount: recommendations.length,
    elapsedMs,
    topResults,
    warnings,
  }
}

async function writeJsonReport(report: EvaluationReport) {
  const outputDirectory = join(process.cwd(), 'tmp')
  const outputPath = join(outputDirectory, 'recommendation-evaluation-report.json')

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  return outputPath
}

async function main() {
  console.log('Mistify recommendation evaluation')
  console.log(`Tests: ${evaluationCases.length}`)

  const tests: TestReport[] = []

  for (const testCase of evaluationCases) {
    const report = await evaluateTestCase(testCase)
    tests.push(report)
    printTestReport(report)
  }

  const warningCounts = countWarnings(tests)
  const totalWarnings = tests.reduce(
    (total, test) => total + test.warnings.length,
    0,
  )
  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    totalTests: tests.length,
    tests,
    summary: {
      totalWarnings,
      warningCounts,
    },
  }
  const outputPath = await writeJsonReport(report)

  console.log('')
  console.log('Summary')
  console.log(`Total tests: ${report.totalTests}`)
  console.log(`Total warnings: ${report.summary.totalWarnings}`)
  console.log(`JSON report: ${outputPath}`)
}

main()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error(
      '[evaluation] recommendation evaluation failed',
      error instanceof Error ? error.message : 'Unknown error',
    )
    await pool.end()
    process.exit(1)
  })
