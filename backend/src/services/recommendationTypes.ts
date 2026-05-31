export type MatchTier = 'top' | 'high' | 'strong' | 'good' | 'possible'
export type Audience = 'unisex' | 'mens' | 'womens'

export type ConfidenceLabel =
  | 'Excellent fit'
  | 'Strong fit'
  | 'Good fit'
  | 'Possible fit'
  | 'Exploratory pick'

export type ScoreBreakdown = {
  profileFit: string
  popularity: string
  ratingConfidence: string
}

export type RecommendationRating = {
  ratingValue: number | null
  ratingVoteCount: number | null
  reviewCount: number | null
  loveCount: number | null
  likeCount: number | null
  okCount: number | null
  dislikeCount: number | null
  hateCount: number | null
  bestSeasons: string[]
  bestTime: 'Day' | 'Night' | 'Day or Night' | null
  seasonShares: {
    winter: number | null
    spring: number | null
    summer: number | null
    fall: number | null
  }
  dayShare: number | null
  nightShare: number | null
}

export type ReferenceRecommendationDebug = {
  referenceDNAFit: number
  referenceLayerFit: number
  referenceFamilyFit: number
  modifierFit: number
  conflictAvoidance: number
  differenceControl: number
  similarityAngle: string | null
  secondarySimilarityAngles: string[]
  sameLayerMatches: string[]
  nearLayerMatches: string[]
  farLayerMatches: string[]
  sharedReferenceNotes: string[]
  missingReferenceNotes: string[]
  sharedReferenceFamilies: string[]
  accordPairMatches: string[]
  distinctiveNoteMatches: string[]
  differenceDirections: string[]
  capReason: string | null
}

export type FragranceRecommendation = {
  mistifyProductName: string
  mistifyProductUrl?: string | null
  audience?: Audience | string | null
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
  rating?: RecommendationRating
  matchScore: number
  matchTier: MatchTier
  scoreBreakdown?: ScoreBreakdown
  aiExplanation?: string
  matchSummary?: string
  whyItMatches?: string[]
  bestFor?: string | null
  watchOut?: string | null
  matchedNotes?: string[]
  matchedVibes?: string[]
  matchedOccasions?: string[]
  matchedSeasons?: string[]
  scentProfile?: string[]
  confidenceLabel?: ConfidenceLabel
  confidenceReason?: string
  referenceSimilarityAngle?: string | null
  sharedWithReference?: string[]
  differentFromReference?: string[]
  missingFromReference?: string[]
  bestIfYouLiked?: string | null
  referenceConfidenceReason?: string | null
  referenceDebug?: ReferenceRecommendationDebug
}

export type ReferenceFragrance = {
  mistifyProductName?: string
  mistifyProductUrl?: string
  audience?: Audience | string
  originalFragranceName: string
  sourceBrandBatch?: string
  classification?: string
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  rating?: RecommendationRating
}
