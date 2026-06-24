import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  sendChatMessage,
  type ConversationMessage,
  type Recommendation,
} from '../api/chatApi'
import {
  getPublicChips,
  getPublicPromptChips,
  type PublicChip,
  type PublicPromptChip,
} from '../api/chipApi'
import {
  getRecommendationOptions,
  type RecommendationOptionGroup,
  type RecommendationOptions,
} from '../api/recommendationOptionsApi'
import '../styles/app.css'

type FinderFeedback = {
  text: string
  tone: 'notice' | 'error'
}

type SearchMode = 'normal' | 'reference' | 'refinement' | 'comparison'
type FinderStartMode = 'concierge' | 'guided' | 'reference'


type SortOption =
  | 'best-match'
  | 'highest-rated'
  | 'most-voted'
  | 'most-loved'
  | 'most-popular'
  | 'summer'
  | 'winter'
  | 'day'
  | 'night'

type FilterKey =
  | 'high-match'
  | 'elite-rating'
  | 'popular'
  | 'most-loved'
  | 'summer'
  | 'winter'
  | 'day'
  | 'night'

type MobileChipGroup = 'curated' | 'style'

type ActiveSearchContext = {
  label: string
  type: 'curated' | 'reference' | 'search'
}

type ChatState = {
  input: string
  isLoading: boolean
  lastSubmittedMessage: string | undefined
  assistantSearchIntro: string | undefined
  recommendations: Recommendation[]
  referenceFragrance: Recommendation | undefined
  searchMode: SearchMode
  lastSearchQuery: string | undefined
  sortOption: SortOption
  activeFilters: FilterKey[]
  isFilterPanelOpen: boolean
  promptChips: PublicPromptChip[]
  curatedChips: PublicChip[]
  resultSource: 'search' | 'curated' | null
  finderFeedback: FinderFeedback | null
  activeSearchContext: ActiveSearchContext | null
  submittedFinderMode: FinderStartMode | null
  expandedMobileChipGroup: MobileChipGroup | null
  showAllStyleChips: boolean
}

type ChatAction =
  | { type: 'setInput'; value: string }
  | { type: 'setPromptChips'; chips: PublicPromptChip[] }
  | { type: 'setCuratedChips'; chips: PublicChip[] }
  | { type: 'toggleFilter'; filter: FilterKey }
  | { type: 'clearFilters' }
  | { type: 'toggleFilterPanel' }
  | { type: 'setSortOption'; sortOption: SortOption }
  | { type: 'toggleMobileChipGroup'; group: MobileChipGroup }
  | { type: 'toggleStyleChipPreview' }
  | {
      type: 'requestStarted'
      resultSource: 'search' | 'curated'
      submittedMessage: string
      assistantSearchIntro: string
      submittedFinderMode: FinderStartMode
    }
  | {
      type: 'requestSucceeded'
      response: Awaited<ReturnType<typeof sendChatMessage>>
      trimmedMessage: string
      submittedSearchContext: ActiveSearchContext
      isCuratedResult: boolean
    }
  | { type: 'requestFailed'; message: string }
  | { type: 'resetResults' }

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'best-match', label: 'Discovery Order' },
  { value: 'highest-rated', label: 'Highest Rated' },
  { value: 'most-voted', label: 'Most Voted' },
  { value: 'most-loved', label: 'Most Loved' },
  { value: 'most-popular', label: 'Most Popular' },
  { value: 'summer', label: 'Summer-Friendly' },
  { value: 'winter', label: 'Winter-Friendly' },
  { value: 'day', label: 'Day-Friendly' },
  { value: 'night', label: 'Night-Friendly' },
]

const DISCOVERY_ORDER_SORT: SortOption = 'best-match'
const DEFAULT_NORMAL_SEARCH_SORT: SortOption = 'most-popular'

const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'high-match', label: 'Strong Fit' },
  { key: 'elite-rating', label: 'Elite Rating' },
  { key: 'popular', label: 'Popular' },
  { key: 'most-loved', label: 'Most Loved' },
  { key: 'summer', label: 'Summer' },
  { key: 'winter', label: 'Winter' },
  { key: 'day', label: 'Day' },
  { key: 'night', label: 'Night' },
]

const ELITE_RATING_THRESHOLD = 4.4
const CHAT_MESSAGE_MAX_LENGTH = 240
const MAX_CONVERSATION_MESSAGES = 10
const initialChatState: ChatState = {
  input: '',
  isLoading: false,
  lastSubmittedMessage: undefined,
  assistantSearchIntro: undefined,
  recommendations: [],
  referenceFragrance: undefined,
  searchMode: 'normal',
  lastSearchQuery: undefined,
  sortOption: DISCOVERY_ORDER_SORT,
  activeFilters: [],
  isFilterPanelOpen: false,
  promptChips: [],
  curatedChips: [],
  resultSource: null,
  finderFeedback: null,
  activeSearchContext: null,
  submittedFinderMode: null,
  expandedMobileChipGroup: null,
  showAllStyleChips: false,
}
const fallbackPromptChips: PublicPromptChip[] = [
  {
    id: -1,
    label: 'Soft Vanilla',
    prompt: 'Soft vanilla, not too sweet, mature and wearable.',
    sortOrder: 0,
  },
  {
    id: -2,
    label: 'Fresh Citrus',
    prompt: 'Fresh citrus for warm days, clean and expensive-smelling.',
    sortOrder: 1,
  },
  {
    id: -3,
    label: 'Clean Musk',
    prompt: 'Clean musk after a shower, soft and office-safe.',
    sortOrder: 2,
  },
  {
    id: -4,
    label: 'Office Signature',
    prompt: 'A polished office signature that smells refined but not loud.',
    sortOrder: 3,
  },
  {
    id: -5,
    label: 'Date Night',
    prompt: 'Sweet date night warmth, seductive but not childish.',
    sortOrder: 4,
  },
]


type GuidedBriefState = {
  moods: string[]
  occasions: string[]
  notes: string[]
  avoids: string[]
  reference: string
}

const initialGuidedBrief: GuidedBriefState = {
  moods: [],
  occasions: [],
  notes: [],
  avoids: [],
  reference: '',
}

const fallbackRecommendationOptions: RecommendationOptions = {
  moods: [
    {
      label: 'Popular moods',
      options: ['Clean', 'Warm', 'Seductive', 'Fresh', 'Expensive', 'Cozy'].map((label) => ({ label, value: label.toLowerCase() })),
    },
  ],
  occasions: [
    {
      label: 'Popular occasions',
      options: ['Everyday', 'Office', 'Date night', 'Summer', 'Going out', 'Gym / fresh'].map((label) => ({ label, value: label.toLowerCase() })),
    },
  ],
  notes: [
    {
      label: 'Popular notes',
      options: ['Citrus', 'Vanilla', 'Amber', 'Musk', 'Oud', 'Aquatic', 'Rose', 'Tobacco'].map((label) => ({ label, value: label.toLowerCase() })),
    },
  ],
  avoids: [
    {
      label: 'Common avoids',
      options: ['Too sweet', 'Too powdery', 'Too smoky', 'Too loud', 'Too mature', 'Too sharp'].map((label) => ({ label, value: label.toLowerCase() })),
    },
  ],
}


type ReferenceBriefState = {
  fragrance: string
  directions: string[]
}

const initialReferenceBrief: ReferenceBriefState = {
  fragrance: '',
  directions: [],
}



const referenceDirectionOptions = [
  { label: 'Very similar', phrase: 'very similar' },
  { label: 'Fresher', phrase: 'fresher' },
  { label: 'Sweeter', phrase: 'sweeter' },
  { label: 'Less sweet', phrase: 'less sweet' },
  { label: 'More masculine', phrase: 'more masculine' },
  { label: 'More feminine', phrase: 'more feminine' },
  { label: 'Office-safe', phrase: 'more office-safe' },
  { label: 'Date night', phrase: 'better for date night' },
]

function formatJoinedPhrases(values: string[]) {
  if (values.length <= 1) {
    return values.join('')
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`
  }

  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

function buildReferenceBriefText(brief: ReferenceBriefState) {
  const fragrance = brief.fragrance.trim()

  if (!fragrance) {
    return ''
  }

  if (!brief.directions.length) {
    return `Show fragrances similar to ${fragrance}.`
  }

  return `Show fragrances similar to ${fragrance} but ${formatJoinedPhrases(brief.directions)}.`
}




function buildGuidedBriefText(brief: GuidedBriefState) {
  const parts = [
    brief.moods.length ? `${formatJoinedPhrases(brief.moods).toLowerCase()} mood` : null,
    brief.occasions.length ? `for ${formatJoinedPhrases(brief.occasions).toLowerCase()}` : null,
    brief.notes.length ? `with ${brief.notes.join(', ').toLowerCase()}` : null,
    brief.avoids.length ? `avoiding ${formatJoinedPhrases(brief.avoids).toLowerCase()}` : null,
    brief.reference.trim() ? `similar to ${brief.reference.trim()}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(', ') : ''
}

function flattenOptionGroups(groups: RecommendationOptionGroup[]) {
  const seen = new Set<string>()

  return groups.flatMap((group) => group.options).filter((option) => {
    const key = option.value.toLowerCase()

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function getVisibleOptionGroups(
  groups: RecommendationOptionGroup[],
  query: string,
  expanded: boolean,
  defaultLimit = 10,
) {
  const trimmedQuery = query.trim().toLowerCase()

  if (trimmedQuery) {
    const filteredOptions = flattenOptionGroups(groups).filter((option) =>
      `${option.label} ${option.value}`.toLowerCase().includes(trimmedQuery),
    )

    return filteredOptions.length ? [{ label: 'Matching options', options: filteredOptions }] : []
  }

  return expanded ? groups : groups.slice(0, 1).map((group) => ({
    ...group,
    options: group.options.slice(0, defaultLimit),
  }))
}

function getSelectedGuidedOptions(brief: GuidedBriefState) {
  return [
    ...brief.moods.map((value) => ({ label: value, type: 'moods' as const })),
    ...brief.occasions.map((value) => ({ label: value, type: 'occasions' as const })),
    ...brief.notes.map((value) => ({ label: value, type: 'notes' as const })),
    ...brief.avoids.map((value) => ({ label: value, type: 'avoids' as const })),
  ]
}

function normalizeChipKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .map((word) => {
      if (word === '&') {
        return word
      }

      const lowerWord = word.toLowerCase()

      return `${lowerWord.charAt(0).toUpperCase()}${lowerWord.slice(1)}`
    })
    .join(' ')
}

function getCuratedChipDisplayLabel(label: string) {
  const trimmedLabel = label.trim()
  const labelWithoutSource = trimmedLabel
    .replace(/\s+on\s+fragrantica\.?$/i, '')
    .trim()
  const normalizedLabel = labelWithoutSource.toLowerCase()

  if (/^best\s+for\s+summer\b/.test(normalizedLabel)) {
    return 'Summer Picks'
  }

  if (/^best\s+for\s+winter\b/.test(normalizedLabel)) {
    return 'Winter Picks'
  }

  return labelWithoutSource || trimmedLabel
}

function getPromptChipDisplayLabel(chip: PublicPromptChip) {
  const promptLabel = formatPromptChipDisplayText(chip.prompt)
  const labelText = chip.label.trim()
  const label = labelText ? formatPromptChipDisplayText(labelText) : ''

  if (
    label &&
    label.length >= 3 &&
    !looksLikeBrokenPromptChipLabel(label, promptLabel)
  ) {
    return label
  }

  if (promptLabel && promptLabel.length >= 3) {
    return promptLabel
  }

  return label || labelText || chip.prompt
}

function formatPromptChipDisplayText(value: string) {
  const originalText = value.trim().replace(/\s+/g, ' ')
  const displayText = originalText.replace(/[.?!]+$/g, '').trim()

  if (!displayText) {
    return ''
  }

  const similarMatch = displayText.match(
    /^(?:i\s+want\s+|(?:i(?:'|\u2019)m|i\s+am)\s+looking\s+for\s+|show\s+me\s+)?something\s+like\s+(.+)$/i,
  )

  if (similarMatch?.[1]?.trim()) {
    return `Similar to ${titleCaseWords(similarMatch[1].trim())}`
  }

  const withoutIntro = displayText
    .replace(/^i\s+want\s+(?:an?|the)\s+/i, '')
    .replace(/^i\s+want\s+/i, '')
    .replace(/^(?:i(?:'|\u2019)m|i\s+am)\s+looking\s+for\s+(?:an?|the)\s+/i, '')
    .replace(/^(?:i(?:'|\u2019)m|i\s+am)\s+looking\s+for\s+/i, '')
    .replace(/^show\s+me\s+(?:an?|the)\s+/i, '')
    .replace(/^show\s+me\s+/i, '')
    .replace(/^something\s+/i, '')
    .trim()

  if (!withoutIntro || withoutIntro.length < 3) {
    return originalText
  }

  const normalizedText = withoutIntro.toLowerCase()

  if (/^(?:sweet\s+)?date\s+night\s+scent$/.test(normalizedText)) {
    return 'Date Night'
  }

  if (
    normalizedText === 'vanilla but not too sweet' ||
    normalizedText === 'soft vanilla not too sweet'
  ) {
    return 'Soft Vanilla'
  }

  if (normalizedText === 'fresh citrus' || normalizedText === 'fresh citrus for warm days') {
    return 'Fresh Citrus'
  }

  if (normalizedText === 'clean and musky' || normalizedText === 'clean musk after a shower') {
    return 'Clean Musk'
  }

  if (
    normalizedText === 'clean office scent' ||
    normalizedText === 'office scent' ||
    normalizedText === 'a polished office signature'
  ) {
    return 'Office Signature'
  }

  if (normalizedText === 'sweet date night warmth') {
    return 'Date Night'
  }

  if (normalizedText === 'summer scent' || normalizedText === 'a summer scent that feels expensive') {
    return 'Expensive Summer'
  }

  if (normalizedText === 'winter scent') {
    return 'Winter'
  }

  if (normalizedText === 'oud but smoother') {
    return 'Smooth Oud'
  }

  const withAmpersand = withoutIntro.replace(/\s+and\s+/gi, ' & ')

  return titleCaseWords(withAmpersand)
}

function normalizeDisplayLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function looksLikeBrokenPromptChipLabel(label: string, promptLabel: string) {
  const normalizedLabel = normalizeDisplayLabel(label)
  const normalizedPromptLabel = normalizeDisplayLabel(promptLabel)

  if (!normalizedLabel || !normalizedPromptLabel) {
    return false
  }

  const labelWords = normalizedLabel.split(/\s+/)
  const promptWords = normalizedPromptLabel.split(/\s+/)
  const firstLabelWord = labelWords[0] ?? ''
  const firstPromptWord = promptWords[0] ?? ''
  const labelWithoutFirstWord = labelWords.slice(1).join(' ')

  if (
    firstLabelWord.length <= 1 &&
    labelWithoutFirstWord &&
    normalizedPromptLabel.endsWith(labelWithoutFirstWord)
  ) {
    return true
  }

  return (
    firstLabelWord.length > 1 &&
    firstPromptWord.length > firstLabelWord.length &&
    firstPromptWord.endsWith(firstLabelWord)
  )
}

function getVisiblePromptChips(chips: PublicPromptChip[]) {
  const seenPrompts = new Set<string>()

  return chips.filter((chip) => {
    const label = chip.label.trim()
    const prompt = chip.prompt.trim()

    if (!label || !prompt) {
      return false
    }

    const key = normalizeChipKey(prompt)

    if (seenPrompts.has(key)) {
      return false
    }

    seenPrompts.add(key)
    return true
  })
}

function getVisibleCuratedChips(chips: PublicChip[]) {
  const seenLabels = new Set<string>()

  return chips.filter((chip) => {
    const label = chip.label.trim()

    if (!label) {
      return false
    }

    const key = normalizeChipKey(label)

    if (seenLabels.has(key)) {
      return false
    }

    seenLabels.add(key)
    return true
  })
}

function getLoveRatio(recommendation: Recommendation) {
  const rating = recommendation.rating
  const loveCount = rating?.loveCount
  const reactionCounts = [
    loveCount,
    rating?.likeCount,
    rating?.okCount,
    rating?.dislikeCount,
    rating?.hateCount,
  ]

  if (!reactionCounts.every((count) => typeof count === 'number')) {
    return null
  }

  const total = reactionCounts.reduce((sum, count) => sum + (count ?? 0), 0)

  return total > 0 && typeof loveCount === 'number' ? loveCount / total : null
}

function getRatingTier(value: number | null | undefined) {
  if (typeof value !== 'number') return 0
  if (value >= 4.5) return 1
  if (value >= 4.3) return 0.85
  if (value >= 4.2) return 0.7
  if (value >= 4) return 0.45
  if (value >= 3.75) return 0.2
  return 0
}

function countPopularity(count: number | null | undefined) {
  return typeof count === 'number' ? Math.min(1, Math.log10(count + 1) / 4) : 0
}

function getPopularityScore(recommendation: Recommendation) {
  const rating = recommendation.rating

  return (
    countPopularity(rating?.ratingVoteCount) * 0.5 +
    countPopularity(rating?.loveCount) * 0.3 +
    getRatingTier(rating?.ratingValue) * 0.2
  )
}

function getLovedSortScore(recommendation: Recommendation) {
  const loveRatio = getLoveRatio(recommendation)

  if (loveRatio !== null) {
    return loveRatio
  }

  return typeof recommendation.rating?.loveCount === 'number'
    ? countPopularity(recommendation.rating.loveCount)
    : null
}

function getSeasonScore(recommendation: Recommendation, season: 'summer' | 'winter') {
  const share = recommendation.rating?.seasonShares?.[season]

  if (typeof share === 'number') {
    return share
  }

  return recommendation.rating?.bestSeasons?.includes(
    season === 'summer' ? 'Summer' : 'Winter',
  )
    ? 0.5
    : null
}

function getTimeScore(recommendation: Recommendation, time: 'day' | 'night') {
  const share = time === 'day' ? recommendation.rating?.dayShare : recommendation.rating?.nightShare

  if (typeof share === 'number') {
    return share
  }

  const bestTime = recommendation.rating?.bestTime

  if (bestTime === 'Day or Night') {
    return 0.5
  }

  return bestTime?.toLowerCase() === time ? 0.5 : null
}

function seasonIsStrong(recommendation: Recommendation, season: 'summer' | 'winter') {
  const score = getSeasonScore(recommendation, season)

  return typeof score === 'number' && score >= 0.25
}

function matchesFilter(recommendation: Recommendation, filter: FilterKey) {
  const rating = recommendation.rating
  const loveRatio = getLoveRatio(recommendation)

  switch (filter) {
    case 'high-match':
      return recommendation.matchTier
        ? recommendation.matchTier === 'top' || recommendation.matchTier === 'high'
        : (recommendation.matchScore ?? 0) >= 92
    case 'elite-rating':
      return (rating?.ratingValue ?? 0) >= ELITE_RATING_THRESHOLD
    case 'popular':
      return (rating?.ratingVoteCount ?? 0) >= 5000
    case 'most-loved':
      return loveRatio !== null
        ? loveRatio >= 0.4
        : (rating?.loveCount ?? 0) >= 1000
    case 'summer':
      return seasonIsStrong(recommendation, 'summer')
    case 'winter':
      return seasonIsStrong(recommendation, 'winter')
    case 'day':
      return rating?.bestTime === 'Day' || rating?.bestTime === 'Day or Night'
    case 'night':
      return rating?.bestTime === 'Night' || rating?.bestTime === 'Day or Night'
    default:
      return false
  }
}

function compareNullableScores(first: number | null, second: number | null) {
  if (first === null && second === null) return 0
  if (first === null) return 1
  if (second === null) return -1
  return second - first
}

function getDefaultResultSort(isCuratedResult: boolean, searchMode: SearchMode) {
  if (isCuratedResult || searchMode !== 'normal') {
    return DISCOVERY_ORDER_SORT
  }

  return DEFAULT_NORMAL_SEARCH_SORT
}

function keepRecentConversation(messages: ConversationMessage[]) {
  return messages.slice(-MAX_CONVERSATION_MESSAGES)
}

function getAssistantSearchIntro(
  query: string,
  isCuratedResult: boolean,
  contextType: ActiveSearchContext['type'],
) {
  if (isCuratedResult || contextType === 'curated') {
    return 'I’ll pull that curated Mistify list and keep the original order intact.'
  }

  const normalizedQuery = query.toLowerCase()

  if (/\b(something like|similar to|like )\b/.test(normalizedQuery)) {
    return 'I’ll use that as the reference direction and look for fragrances with a similar profile.'
  }

  if (/\b(office|work|professional|daily|everyday)\b/.test(normalizedQuery)) {
    return 'Got it — I’ll focus on polished, wearable fragrances that should feel easy to use day to day.'
  }

  if (/\b(date|night|evening|romantic)\b/.test(normalizedQuery)) {
    return 'Nice — I’ll look for scents with a warmer, more memorable night-out feel.'
  }

  if (/\b(summer|fresh|citrus|bergamot|lemon|orange|grapefruit|lime|yuzu)\b/.test(normalizedQuery)) {
    return 'I’ll look for fresher, brighter options that fit warm weather or a clean profile.'
  }

  if (/\b(winter|tobacco|honey|amber|vanilla|sweet|warm)\b/.test(normalizedQuery)) {
    return 'Perfect — I’ll look for warmer scents with enough depth while keeping the match balanced.'
  }

  if (/\b(oud|woody|wood|smoky|leather)\b/.test(normalizedQuery)) {
    return 'Got it — I’ll look for deeper woody options that still feel wearable.'
  }

  return 'Got it — I’ll match that description against Mistify’s fragrance profiles.'
}




function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'setInput') {
    return { ...state, input: action.value }
  }

  if (action.type === 'setPromptChips') {
    return { ...state, promptChips: action.chips }
  }

  if (action.type === 'setCuratedChips') {
    return { ...state, curatedChips: action.chips }
  }

  if (action.type === 'toggleFilter') {
    return {
      ...state,
      activeFilters: state.activeFilters.includes(action.filter)
        ? state.activeFilters.filter((currentFilter) => currentFilter !== action.filter)
        : [...state.activeFilters, action.filter],
    }
  }

  if (action.type === 'clearFilters') {
    return { ...state, activeFilters: [] }
  }

  if (action.type === 'toggleFilterPanel') {
    return { ...state, isFilterPanelOpen: !state.isFilterPanelOpen }
  }

  if (action.type === 'setSortOption') {
    return { ...state, sortOption: action.sortOption }
  }

  if (action.type === 'toggleMobileChipGroup') {
    return {
      ...state,
      expandedMobileChipGroup:
        state.expandedMobileChipGroup === action.group ? null : action.group,
    }
  }

  if (action.type === 'toggleStyleChipPreview') {
    return { ...state, showAllStyleChips: !state.showAllStyleChips }
  }

  if (action.type === 'requestStarted') {
    return {
      ...state,
      input: '',
      sortOption: getDefaultResultSort(action.resultSource === 'curated', 'normal'),
      activeFilters: [],
      isFilterPanelOpen: false,
      finderFeedback: null,
      expandedMobileChipGroup: null,
      showAllStyleChips: false,
      resultSource: action.resultSource,
      lastSubmittedMessage: action.submittedMessage,
      assistantSearchIntro: action.assistantSearchIntro,
      submittedFinderMode: action.submittedFinderMode,
      isLoading: true,
    }
  }

  if (action.type === 'requestSucceeded') {
    const nextRecommendations = Array.isArray(action.response.recommendations)
      ? action.response.recommendations
      : []
    const nextSearchMode = action.response.searchMode ?? 'normal'

    return {
      ...state,
      recommendations: nextRecommendations,
      referenceFragrance: action.response.referenceFragrance,
      searchMode: nextSearchMode,
      lastSearchQuery: action.response.searchQuery ?? action.trimmedMessage,
      activeSearchContext:
        nextSearchMode === 'reference' &&
        action.response.referenceFragrance?.originalFragranceName
          ? {
              label: action.response.referenceFragrance.originalFragranceName,
              type: 'reference',
            }
          : action.submittedSearchContext,
      sortOption: getDefaultResultSort(action.isCuratedResult, nextSearchMode),
      activeFilters: [],
      finderFeedback:
        nextRecommendations.length || !action.response.reply.trim()
          ? null
          : {
              text: action.response.reply,
              tone: 'notice',
            },
      isLoading: false,
    }
  }

  if (action.type === 'requestFailed') {
    return {
      ...state,
      finderFeedback: {
        text: action.message,
        tone: 'error',
      },
      isLoading: false,
    }
  }

  if (action.type === 'resetResults') {
    return {
      ...initialChatState,
      promptChips: state.promptChips,
      curatedChips: state.curatedChips,
    }
  }

  return state
}

function useChatPageContent() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const [finderStartMode, setFinderStartMode] = useState<FinderStartMode>('concierge')
  const [guidedBrief, setGuidedBrief] = useState<GuidedBriefState>(initialGuidedBrief)
  const [referenceBrief, setReferenceBrief] = useState<ReferenceBriefState>(initialReferenceBrief)
  const [recommendationOptions, setRecommendationOptions] = useState<RecommendationOptions>(fallbackRecommendationOptions)
  const [expandedGuidedGroups, setExpandedGuidedGroups] = useState<Record<'moods' | 'occasions' | 'notes' | 'avoids', boolean>>({
    moods: false,
    occasions: false,
    notes: false,
    avoids: false,
  })
  const [guidedSearch, setGuidedSearch] = useState({
    moods: '',
    occasions: '',
    notes: '',
    avoids: '',
  })
  const [selectedFragrance, setSelectedFragrance] = useState<Recommendation | null>(null)

  const conversationRef = useRef<ConversationMessage[]>([])
  const resultsRef = useRef<HTMLElement | null>(null)
  const hasConsumedPendingPromptRef = useRef(false)
  const {
    input,
    isLoading,
    lastSubmittedMessage,
    recommendations,
    referenceFragrance,
    searchMode,
    lastSearchQuery,
    sortOption,
    activeFilters,
    isFilterPanelOpen,
    promptChips,
    curatedChips,
    resultSource,
    finderFeedback,
    submittedFinderMode,
  } = state
  const visibleRecommendations = useMemo(() => {
    const indexedRecommendations = recommendations.map((recommendation, index) => ({
      recommendation,
      index,
    }))
    const filteredRecommendations = indexedRecommendations.filter(({ recommendation }) =>
      activeFilters.every((filter) => matchesFilter(recommendation, filter)),
    )

    if (sortOption === 'best-match') {
      return filteredRecommendations.map(({ recommendation }) => recommendation)
    }

    return filteredRecommendations
      .toSorted((first, second) => {
        let sortResult = 0

        if (sortOption === 'highest-rated') {
          sortResult = compareNullableScores(
            first.recommendation.rating?.ratingValue ?? null,
            second.recommendation.rating?.ratingValue ?? null,
          )
        } else if (sortOption === 'most-voted') {
          sortResult = compareNullableScores(
            first.recommendation.rating?.ratingVoteCount ?? null,
            second.recommendation.rating?.ratingVoteCount ?? null,
          )
        } else if (sortOption === 'most-loved') {
          sortResult =
            compareNullableScores(
              getLovedSortScore(first.recommendation),
              getLovedSortScore(second.recommendation),
            ) ||
            compareNullableScores(
              first.recommendation.rating?.ratingVoteCount ?? null,
              second.recommendation.rating?.ratingVoteCount ?? null,
            )
        } else if (sortOption === 'most-popular') {
          sortResult =
            getPopularityScore(second.recommendation) -
            getPopularityScore(first.recommendation)
        } else if (sortOption === 'summer' || sortOption === 'winter') {
          sortResult = compareNullableScores(
            getSeasonScore(first.recommendation, sortOption),
            getSeasonScore(second.recommendation, sortOption),
          )
        } else if (sortOption === 'day' || sortOption === 'night') {
          sortResult = compareNullableScores(
            getTimeScore(first.recommendation, sortOption),
            getTimeScore(second.recommendation, sortOption),
          )
        }

        return sortResult || first.index - second.index
      })
      .map(({ recommendation }) => recommendation)
  }, [activeFilters, recommendations, sortOption])
  const hasActiveFilters = activeFilters.length > 0
  const isReferenceSearch = searchMode === 'reference' && Boolean(referenceFragrance)
  const isCuratedResult = resultSource === 'curated'
  const displayedSortOptions = isReferenceSearch
    ? sortOptions.map((option) =>
        option.value === 'best-match'
          ? { ...option, label: 'Discovery Order' }
          : option,
      )
    : sortOptions
  const showingText = hasActiveFilters
    ? `Showing ${visibleRecommendations.length} of ${recommendations.length} fragrances`
    : `Showing ${recommendations.length} ${recommendations.length === 1 ? 'fragrance' : 'fragrances'}`
  const hasResults = recommendations.length > 0 && submittedFinderMode === finderStartMode
  const displayedRecommendations = isCuratedResult
    ? recommendations
    : visibleRecommendations
  const visiblePromptChips = useMemo(
    () => getVisiblePromptChips(promptChips),
    [promptChips],
  )
  const visibleCuratedChips = useMemo(
    () => getVisibleCuratedChips(curatedChips),
    [curatedChips],
  )
  // Removed with V1: assistantResultSummary, resultContextText, submittedFinderModeLabel, conciergeModeCard, referenceModeCard
  const guidedBriefText = buildGuidedBriefText(guidedBrief)
  const selectedGuidedOptions = getSelectedGuidedOptions(guidedBrief)
  const selectedBriefCount = selectedGuidedOptions.length
  const visibleMoodGroups = getVisibleOptionGroups(recommendationOptions.moods, guidedSearch.moods, expandedGuidedGroups.moods)
  const visibleOccasionGroups = getVisibleOptionGroups(recommendationOptions.occasions, guidedSearch.occasions, expandedGuidedGroups.occasions)
  const visibleNoteGroups = getVisibleOptionGroups(recommendationOptions.notes, guidedSearch.notes, expandedGuidedGroups.notes, 12)
  const visibleAvoidGroups = getVisibleOptionGroups(recommendationOptions.avoids, guidedSearch.avoids, expandedGuidedGroups.avoids)
  const referenceBriefText = buildReferenceBriefText(referenceBrief)


  useEffect(() => {
    let ignore = false

    getPublicPromptChips()
      .then((chips) => {
        if (!ignore) {
          dispatch({ type: 'setPromptChips', chips: chips.length ? chips : fallbackPromptChips })
        }
      })
      .catch(() => {
        if (!ignore) {
          dispatch({ type: 'setPromptChips', chips: fallbackPromptChips })
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    getPublicChips()
      .then((chips) => {
        if (!ignore) {
          dispatch({ type: 'setCuratedChips', chips })
        }
      })
      .catch(() => {
        if (!ignore) {
          dispatch({ type: 'setCuratedChips', chips: [] })
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    getRecommendationOptions()
      .then((options) => {
        if (!ignore) {
          setRecommendationOptions(options)
        }
      })
      .catch(() => {
        if (!ignore) {
          setRecommendationOptions(fallbackRecommendationOptions)
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!isLoading && recommendations.length) {
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [isLoading, recommendations.length])

  // Consume a prompt handed off from the standalone catalog app.
  useEffect(() => {
    if (hasConsumedPendingPromptRef.current) {
      return
    }

    hasConsumedPendingPromptRef.current = true

    const url = new URL(window.location.href)
    const pendingPrompt = url.searchParams.get('prompt')

    if (pendingPrompt?.trim()) {
      url.searchParams.delete('prompt')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
      void handleSendMessage(pendingPrompt, undefined, 'concierge')
    }
    // Run once on mount so a catalog handoff prompt is consumed only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleFilter(filter: FilterKey) {
    dispatch({ type: 'toggleFilter', filter })
  }


  function toggleGuidedValue(key: 'moods' | 'occasions' | 'notes' | 'avoids', value: string) {
    setGuidedBrief((currentBrief) => {
      const currentValues = currentBrief[key]
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((currentValue) => currentValue !== value)
        : [...currentValues, value]

      return { ...currentBrief, [key]: nextValues }
    })
  }

  function toggleGuidedGroup(key: 'moods' | 'occasions' | 'notes' | 'avoids') {
    setExpandedGuidedGroups((currentGroups) => ({
      ...currentGroups,
      [key]: !currentGroups[key],
    }))
  }

  function updateGuidedSearch(key: 'moods' | 'occasions' | 'notes' | 'avoids', value: string) {
    setGuidedSearch((currentSearch) => ({ ...currentSearch, [key]: value }))
  }


  function renderGuidedOptionSection({
    id,
    title,
    hint,
    groups,
    selectedValues,
    searchPlaceholder,
  }: {
    id: 'moods' | 'occasions' | 'notes' | 'avoids'
    title: string
    hint: string
    groups: RecommendationOptionGroup[]
    selectedValues: string[]
    searchPlaceholder?: string
  }) {
    const totalOptionCount = flattenOptionGroups(recommendationOptions[id]).length
    const visibleOptionCount = flattenOptionGroups(groups).length
    const isExpanded = expandedGuidedGroups[id]
    const searchValue = guidedSearch[id]

    return (
      <section className="guided-step-card" aria-labelledby={`guided-${id}-title`}>
        <div className="guided-step-heading">
          <div>
            <h4 id={`guided-${id}-title`}>{title}</h4>
            <p>{hint}</p>
          </div>
          <span>{selectedValues.length} selected</span>
        </div>
        {searchPlaceholder ? (
          <input
            className="guided-option-search"
            value={searchValue}
            placeholder={searchPlaceholder}
            onChange={(event) => updateGuidedSearch(id, event.target.value)}
          />
        ) : null}
        <div className="guided-option-groups">
          {groups.map((group) => (
            <div key={group.label} className="guided-option-group">
              <p className="guided-option-group-label">{group.label}</p>
              <div className="guided-option-grid">
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`guided-option ${selectedValues.includes(option.value) ? 'active' : ''}`}
                    onClick={() => toggleGuidedValue(id, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!groups.length ? <p className="guided-empty-options">No matching options.</p> : null}
        {!searchValue && totalOptionCount > visibleOptionCount ? (
          <button type="button" className="guided-view-all" onClick={() => toggleGuidedGroup(id)}>
            {isExpanded ? 'Show popular only' : `View all ${totalOptionCount} options`}
          </button>
        ) : null}
      </section>
    )
  }

  function submitGuidedBrief() {
    const briefText = buildGuidedBriefText(guidedBrief)

    if (!briefText) {
      return
    }

    handleSendMessage(briefText, undefined, 'guided')
  }

  function resetGuidedBrief() {
    setGuidedBrief(initialGuidedBrief)
  }


  function updateReferenceFragrance(value: string) {
    setReferenceBrief((currentBrief) => ({ ...currentBrief, fragrance: value }))
  }

  function toggleReferenceDirection(phrase: string) {
    setReferenceBrief((currentBrief) => ({
      ...currentBrief,
      directions: currentBrief.directions.includes(phrase)
        ? currentBrief.directions.filter((direction) => direction !== phrase)
        : [...currentBrief.directions, phrase].slice(0, 3),
    }))
  }

  function resetReferenceBrief() {
    setReferenceBrief(initialReferenceBrief)
  }

  function submitReferenceBrief() {
    const briefText = buildReferenceBriefText(referenceBrief)

    if (!briefText) {
      return
    }

    handleSendMessage(briefText, undefined, 'reference')
  }

  async function handleSendMessage(
    messageOverride?: string,
    curatedChipId?: number,
    submittedMode: FinderStartMode = finderStartMode,
  ) {
    const rawMessage = typeof messageOverride === 'string' ? messageOverride : input
    const trimmedMessage = rawMessage.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH)

    if (!trimmedMessage || isLoading) {
      return
    }

    const nextResultSource = curatedChipId ? 'curated' : 'search'
    const matchingPromptChip = visiblePromptChips.find(
      (chip) => normalizeChipKey(chip.prompt) === normalizeChipKey(trimmedMessage),
    )
    const matchingCuratedChip = curatedChipId
      ? visibleCuratedChips.find((chip) => chip.id === curatedChipId)
      : undefined
    const submittedSearchContext: ActiveSearchContext = curatedChipId
      ? {
          label: getCuratedChipDisplayLabel(matchingCuratedChip?.label ?? trimmedMessage),
          type: 'curated',
        }
      : {
          label: matchingPromptChip
            ? getPromptChipDisplayLabel(matchingPromptChip)
            : formatPromptChipDisplayText(trimmedMessage),
          type: 'search',
        }

    dispatch({
      type: 'requestStarted',
      resultSource: nextResultSource,
      submittedMessage: submittedSearchContext.label || trimmedMessage,
      assistantSearchIntro: getAssistantSearchIntro(
        trimmedMessage,
        nextResultSource === 'curated',
        submittedSearchContext.type,
      ),
      submittedFinderMode: curatedChipId ? 'concierge' : submittedMode,
    })

    try {
      const response = await sendChatMessage(trimmedMessage, {
        conversation: keepRecentConversation(conversationRef.current),
        lastSearchQuery,
        curatedChipId,
      })

      conversationRef.current = keepRecentConversation([
        ...conversationRef.current,
        { role: 'user', content: trimmedMessage },
        { role: 'assistant', content: response.reply.slice(0, CHAT_MESSAGE_MAX_LENGTH) },
      ])
      dispatch({
        type: 'requestSucceeded',
        response,
        trimmedMessage,
        submittedSearchContext,
        isCuratedResult: nextResultSource === 'curated',
      })
    } catch {
      dispatch({
        type: 'requestFailed',
        message: 'I could not reach the fragrance shelf right now. Please try again in a moment.',
      })
    }
  }

  return (
    <main className={`app-shell ${hasResults ? 'has-results' : 'is-briefing'}`}>
      <header className="v1-topbar">
        <a
          className="v1-topbar-brand"
          href="https://www.mistifyparfums.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          mistify <span>parfums</span>
        </a>
        <div className="v1-mode-switcher">
          <button
            type="button"
            className={`v1-mode-btn ${finderStartMode === 'concierge' ? 'active' : ''}`}
            onClick={() => {
              setFinderStartMode('concierge')
              setGuidedBrief(initialGuidedBrief)
              setReferenceBrief(initialReferenceBrief)
              dispatch({ type: 'resetResults' })
            }}
          >
            Concierge
          </button>
          <button
            type="button"
            className={`v1-mode-btn ${finderStartMode === 'guided' ? 'active' : ''}`}
            onClick={() => {
              setFinderStartMode('guided')
              setGuidedBrief(initialGuidedBrief)
              setReferenceBrief(initialReferenceBrief)
              dispatch({ type: 'resetResults' })
            }}
          >
            Guided
          </button>
          <button
            type="button"
            className={`v1-mode-btn ${finderStartMode === 'reference' ? 'active' : ''}`}
            onClick={() => {
              setFinderStartMode('reference')
              setGuidedBrief(initialGuidedBrief)
              setReferenceBrief(initialReferenceBrief)
              dispatch({ type: 'resetResults' })
            }}
          >
            Reference
          </button>
        </div>
      </header>

      {!hasResults ? (
        <section className="v1-hero">
          <h1>Find your next signature scent</h1>
          <p className="v1-hero-sub">Search by mood, occasion, notes, or a fragrance you already love</p>

          {finderStartMode === 'concierge' ? (
            <>
              <div className="v1-search-row">
                <input
                  className="v1-search-input"
                  value={input}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  onChange={(e) => dispatch({ type: 'setInput', value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSendMessage(undefined, undefined, 'concierge')
                  }}
                  placeholder="Try: fresh citrus for summer, not too sweet"
                  disabled={isLoading}
                />
                <button
                  className="v1-search-btn"
                  onClick={() => void handleSendMessage(undefined, undefined, 'concierge')}
                  disabled={isLoading || !input.trim()}
                >
                  Search
                </button>
              </div>

              <div className="v1-chips">
                {visiblePromptChips.slice(0, 5).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className="v1-chip"
                    onClick={() => handleSendMessage(chip.prompt, undefined, 'concierge')}
                    disabled={isLoading}
                  >
                    {getPromptChipDisplayLabel(chip)}
                  </button>
                ))}
              </div>

              {visibleCuratedChips.length ? (
                <div className="v1-chips" style={{ marginTop: 8 }}>
                  {visibleCuratedChips.slice(0, 4).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className="v1-chip"
                      onClick={() => handleSendMessage(chip.label, chip.id, 'concierge')}
                      disabled={isLoading}
                    >
                      {getCuratedChipDisplayLabel(chip.label)}
                    </button>
                  ))}
                </div>
              ) : null}

              {finderFeedback ? (
                <p className={`finder-feedback ${finderFeedback.tone}`} role="status" style={{ marginTop: 12, textAlign: 'center' }}>
                  {finderFeedback.text}
                </p>
              ) : null}
            </>
          ) : null}

          {finderStartMode === 'guided' ? (
            <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'left' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {renderGuidedOptionSection({ id: 'moods', title: 'Mood', hint: 'How should it feel?', groups: visibleMoodGroups, selectedValues: guidedBrief.moods })}
                {renderGuidedOptionSection({ id: 'occasions', title: 'Occasion', hint: 'Where?', groups: visibleOccasionGroups, selectedValues: guidedBrief.occasions })}
                {renderGuidedOptionSection({ id: 'notes', title: 'Notes', hint: 'Pick notes.', groups: visibleNoteGroups, selectedValues: guidedBrief.notes, searchPlaceholder: 'Search notes...' })}
                {renderGuidedOptionSection({ id: 'avoids', title: 'Avoid', hint: 'Stay away from.', groups: visibleAvoidGroups, selectedValues: guidedBrief.avoids, searchPlaceholder: 'Search avoids...' })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{guidedBriefText || 'Pick some cues to build your brief.'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="details-toggle" onClick={resetGuidedBrief} disabled={!selectedBriefCount}>Clear</button>
                  <button type="button" className="mistify-link mistify-link-button" onClick={submitGuidedBrief} disabled={!guidedBriefText || isLoading}>Curate tray</button>
                </div>
              </div>
            </div>
          ) : null}

          {finderStartMode === 'reference' ? (
            <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'left' }}>
              <input
                id="reference-fragrance"
                className="v1-search-input"
                value={referenceBrief.fragrance}
                placeholder="Example: Bleu de Chanel, Baccarat Rouge 540, Aventus"
                onChange={(e) => updateReferenceFragrance(e.target.value)}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, justifyContent: 'center' }}>
                {referenceDirectionOptions.map((option) => (
                  <button key={option.phrase} type="button" className={`v1-chip ${referenceBrief.directions.includes(option.phrase) ? 'active' : ''}`} onClick={() => toggleReferenceDirection(option.phrase)} style={referenceBrief.directions.includes(option.phrase) ? { background: 'var(--ink-900)', color: '#fff', borderColor: 'var(--ink-900)' } : {}}>{option.label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{referenceBriefText || 'Type a fragrance and choose a direction.'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="details-toggle" onClick={resetReferenceBrief} disabled={!referenceBrief.fragrance.trim() && !referenceBrief.directions.length}>Clear</button>
                  <button type="button" className="mistify-link mistify-link-button" onClick={submitReferenceBrief} disabled={!referenceBriefText || isLoading}>Match</button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

        {recommendations.length ? (
          <section ref={resultsRef} aria-label="Recommendations">
            <button
              type="button"
              className="v1-back-breadcrumb"
              onClick={() => {
                setGuidedBrief(initialGuidedBrief)
                setReferenceBrief(initialReferenceBrief)
                dispatch({ type: 'resetResults' })
              }}
            >
              ← Back to {finderStartMode === 'concierge' ? 'Concierge' : finderStartMode === 'guided' ? 'Guided' : 'Reference'}
            </button>
            <div className="v1-results-bar">
              <div className="v1-results-bar-left">
                <div>
                  <h2>{recommendations.length} fragrances</h2>
                  <p className="v1-results-count">{showingText}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isCuratedResult ? (
                  <select
                    className="v1-sort-select"
                    value={sortOption}
                    onChange={(e) => dispatch({ type: 'setSortOption', sortOption: e.target.value as SortOption })}
                  >
                    {displayedSortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : null}
                <button
                  type="button"
                  className="v1-filter-chip"
                  onClick={() => dispatch({ type: 'toggleFilterPanel' })}
                >
                  Filters{hasActiveFilters ? ` (${activeFilters.length})` : ''}
                </button>
              </div>
            </div>

            {!isCuratedResult && isFilterPanelOpen ? (
              <div className="v1-filter-row">
                {filterOptions.map((f) => (
                  <button key={f.key} type="button" className={`v1-filter-chip ${activeFilters.includes(f.key) ? 'active' : ''}`} onClick={() => toggleFilter(f.key)}>{f.label}</button>
                ))}
                {hasActiveFilters ? <button type="button" className="v1-clear-filters" onClick={() => dispatch({ type: 'clearFilters' })}>Clear</button> : null}
              </div>
            ) : null}

            <div className="v1-results">
              {displayedRecommendations.length ? (
                <div className="v1-card-grid">
                  {displayedRecommendations.map((rec, i) => {
                    const displayName = rec.mistifyProductName?.trim() || rec.originalFragranceName?.trim() || 'Mistify Fragrance'
                    const inspiredBy = rec.originalFragranceName?.trim()
                    const matchLabel = rec.matchTier === 'top' || rec.matchTier === 'high' ? 'Excellent' : rec.matchTier === 'strong' ? 'Strong' : 'Good'
                    const rating = rec.rating?.ratingValue
                    const allNotes = [...(rec.topNotes ?? []), ...(rec.middleNotes ?? []), ...(rec.baseNotes ?? [])]
                    const matchBadgeClass = rec.matchTier === 'top' || rec.matchTier === 'high' ? 'match-badge-high' : rec.matchTier === 'strong' ? 'match-badge-medium' : 'match-badge-low'

                    return (
                      <article
                        key={`${rec.sourceBrandBatch ?? 'src'}-${rec.originalFragranceName ?? 'frag'}-${i + 1}`}
                        className="fragrance-card"
                        onClick={() => setSelectedFragrance(rec)}
                      >
                        <div className="fragrance-card-header">
                          <div className="fragrance-title-group">
                            {rec.classification ? (
                              <div className="fragrance-meta-line">
                                <p className="fragrance-category">{rec.classification}</p>
                              </div>
                            ) : null}
                            <h3>{displayName}</h3>
                            {inspiredBy ? <p className="inspired-by">Inspired by {inspiredBy}</p> : null}
                          </div>
                          <span className={`status-badge ${matchBadgeClass}`}>{matchLabel}</span>
                        </div>

                        {rec.aiExplanation || rec.matchSummary ? (
                          <div className="match-reason-block">
                            <p className="match-reason-label">Why this fits</p>
                            <p className="match-reason">{rec.aiExplanation || rec.matchSummary}</p>
                          </div>
                        ) : null}

                        {rec.bestFor ? (
                          <p className="best-for-line">Best for: {rec.bestFor}</p>
                        ) : null}

                        {allNotes.length ? (
                          <div className="note-preview">
                            <ul className="note-list">
                              {allNotes.filter(Boolean).slice(0, 6).map((note) => (
                                <li key={note}>{note}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="card-actions">
                          <button className="details-toggle" type="button" onClick={(e) => { e.stopPropagation(); setSelectedFragrance(rec); }}>
                            View details
                          </button>
                          {rec.mistifyProductUrl ? (
                            <a
                              className="mistify-link mistify-link-button"
                              href={rec.mistifyProductUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Shop ↗
                            </a>
                          ) : null}
                        </div>

                        {rating || rec.rating?.loveCount != null ? (
                          <div className="fragrance-card-footer">
                            {rating ? <span className="footer-rating">★ {rating.toFixed(1)}</span> : null}
                            {rec.rating?.loveCount != null ? <span className="footer-loves">♥ {rec.rating.loveCount}</span> : null}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              ) : (
                <p>No fragrances fit these filters. Try clearing them.</p>
              )}
            </div>
          </section>
        ) : null}

        {hasResults ? (
          <section className="v1-recent">
            <h3>Recent searches</h3>
            <div className="v1-recent-list">
              {lastSubmittedMessage ? <span className="v1-recent-item" onClick={() => handleSendMessage(lastSubmittedMessage)}>{lastSubmittedMessage}</span> : null}
            </div>
          </section>
        ) : null}

        {selectedFragrance ? (
          <div className="fragrance-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSelectedFragrance(null) }}>
            <div className="fragrance-modal">
              <div className="fragrance-modal-header-row">
                <div className="fragrance-modal-brand-badge">Mistify</div>
                <button className="fragrance-modal-close" onClick={() => setSelectedFragrance(null)} aria-label="Close">&times;</button>
              </div>
              {selectedFragrance.catalogImageUrl ? (
                <img
                  className="fragrance-modal-image"
                  src={selectedFragrance.catalogImageUrl}
                  alt={selectedFragrance.mistifyProductName || selectedFragrance.originalFragranceName || ''}
                />
              ) : (
                <div className="fragrance-modal-fallback-viz">{(() => {
                  const name = selectedFragrance.mistifyProductName?.trim() || selectedFragrance.originalFragranceName?.trim() || 'M'
                  return name[0]
                })()}</div>
              )}
              <p className="fragrance-modal-name">{selectedFragrance.mistifyProductName?.trim() || selectedFragrance.originalFragranceName?.trim() || 'Mistify Fragrance'}</p>
              {selectedFragrance.originalFragranceName?.trim() ? (
                <p className="fragrance-modal-inspired">Inspired by {selectedFragrance.originalFragranceName.trim()}</p>
              ) : null}
              <div className="fragrance-modal-badges">
                {(() => {
                  const badges: string[] = []
                  const tier = selectedFragrance.matchTier
                  if (tier === 'top' || tier === 'high') badges.push('Excellent')
                  else if (tier === 'strong') badges.push('Strong')
                  else badges.push('Worth exploring')
                  const r = selectedFragrance.rating
                  if (r?.ratingValue && r.ratingValue >= 4.4) badges.push('Elite Rating')
                  if (r?.ratingVoteCount && r.ratingVoteCount >= 5000) badges.push('Popular')
                  if (r?.loveCount && r.loveCount >= 1000) badges.push('Most Loved')
                  return badges.map((b,i) => (
                    <span key={i} className={`fragrance-modal-badge ${i === 0 ? 'match-badge-high' : ''}`}>{b}</span>
                  ))
                })()}
              </div>
              <div className="fragrance-modal-section">
                <h4>Notes</h4>
                <div className="fragrance-modal-notes">
                  {(Array.isArray(selectedFragrance.allNotes) ? selectedFragrance.allNotes : []).slice(0, 10).map((n: string) => (
                    <span key={n} className="fragrance-modal-note">{n}</span>
                  ))}
                </div>
              </div>
              <div className="fragrance-modal-section">
                <h4>Stats</h4>
                <div className="fragrance-modal-stats">
                  <div className="fragrance-modal-stat"><div className="fragrance-modal-stat-val">{selectedFragrance.rating?.ratingValue?.toFixed(2) ?? '-'}/5</div><div className="fragrance-modal-stat-label">Rating</div></div>
                  <div className="fragrance-modal-stat"><div className="fragrance-modal-stat-val">{selectedFragrance.rating?.ratingVoteCount?.toLocaleString() ?? '-'}</div><div className="fragrance-modal-stat-label">Votes</div></div>
                  <div className="fragrance-modal-stat"><div className="fragrance-modal-stat-val">{selectedFragrance.rating?.bestTime ?? '-'}</div><div className="fragrance-modal-stat-label">Best Time</div></div>
                  <div className="fragrance-modal-stat"><div className="fragrance-modal-stat-val">{selectedFragrance.rating?.bestSeasons?.join(', ') ?? '-'}</div><div className="fragrance-modal-stat-label">Seasons</div></div>
                </div>
              </div>
              {selectedFragrance.mistifyProductUrl ? (
                <a className="fragrance-modal-url" href={selectedFragrance.mistifyProductUrl} target="_blank" rel="noopener noreferrer">View on Mistify Parfums &rarr;</a>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    )
}

function ChatPage() {
  return useChatPageContent()
}

export default ChatPage
