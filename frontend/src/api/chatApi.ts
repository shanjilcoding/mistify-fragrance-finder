export type Recommendation = {
  mistifyProductName?: string
  mistifyProductUrl?: string | null
  audience?: 'unisex' | 'mens' | 'womens' | string | null
  originalFragranceName?: string
  sourceBrandBatch?: string
  classification?: string
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  sourceConfidence?: string
  sourceUsed?: string
  sourceStatus?: string
  rating?: {
    ratingValue: number | null
    ratingVoteCount: number | null
    reviewCount: number | null
    loveCount?: number | null
    likeCount?: number | null
    okCount?: number | null
    dislikeCount?: number | null
    hateCount?: number | null
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
  matchScore?: number
  matchTier?: 'top' | 'high' | 'strong' | 'good' | 'possible'
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
  confidenceLabel?:
    | 'Excellent fit'
    | 'Strong fit'
    | 'Good fit'
    | 'Possible fit'
    | 'Exploratory pick'
  confidenceReason?: string
  referenceSimilarityAngle?: string | null
  sharedWithReference?: string[]
  differentFromReference?: string[]
  missingFromReference?: string[]
  bestIfYouLiked?: string | null
  referenceConfidenceReason?: string | null
  scoreBreakdown?: {
    profileFit: string
    popularity: string
    ratingConfidence: string
  }
}

export type ChatResponse = {
  reply: string
  filters: {
    notes: string[]
    classifications: string[]
    seasons: string[]
    occasions: string[]
    avoid: string[]
  }
  searchQuery?: string
  searchMode?: 'normal' | 'reference' | 'refinement' | 'comparison'
  referenceFragrance?: Omit<Recommendation, 'matchScore' | 'matchTier' | 'aiExplanation' | 'scoreBreakdown'>
  recommendations?: Recommendation[]
}

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatRequestContext = {
  conversation?: ConversationMessage[]
  lastSearchQuery?: string
  lastRecommendations?: Recommendation[]
  curatedChipId?: number
}

type ErrorResponse = {
  error: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')

export async function sendChatMessage(
  message: string,
  context: ChatRequestContext = {},
): Promise<ChatResponse> {
  try {
    const response = await fetch(`${apiUrl}/chat/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversation: context.conversation,
        lastSearchQuery: context.lastSearchQuery,
        lastRecommendations: context.lastRecommendations,
        curatedChipId: context.curatedChipId,
      }),
    })

    const data = (await response.json()) as ChatResponse | ErrorResponse

    if (!response.ok) {
      throw new Error('error' in data ? data.error : 'Something went wrong.')
    }

    return data as ChatResponse
  } catch (error) {
    if (error instanceof Error && error.message !== 'Failed to fetch') {
      throw error
    }

    throw new Error(
      'Unable to connect to the Mistify fragrance finder API. Make sure the backend is running.',
      { cause: error },
    )
  }
}
