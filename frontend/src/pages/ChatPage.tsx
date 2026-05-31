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
import ChatBox from '../components/ChatBox'
import FragranceCard from '../components/FragranceCard'
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
const refinementChips = [
  { label: 'Sweeter', prompt: 'Make these recommendations sweeter.' },
  { label: 'Fresher', prompt: 'Show fresher and cleaner options.' },
  { label: 'More masculine', prompt: 'Make these recommendations more masculine.' },
  { label: 'More feminine', prompt: 'Make these recommendations more feminine.' },
  { label: 'Office-safe', prompt: 'Show more office-safe options.' },
  { label: 'Date night', prompt: 'Show more date night options.' },
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

const finderModeCards: Array<{
  mode: FinderStartMode
  title: string
  copy: string
  icon: string
  example: string
  cta: string
}> = [
  {
    mode: 'concierge',
    title: 'Concierge',
    copy: 'Free-text scent search',
    icon: '✦',
    example: '“fresh citrus for summer”',
    cta: 'Start writing',
  },
  {
    mode: 'guided',
    title: 'Guided',
    copy: 'Step-by-step brief',
    icon: '✓',
    example: 'Mood → occasion → notes',
    cta: 'Build my brief',
  },
  {
    mode: 'reference',
    title: 'Reference',
    copy: 'Find similar to one you like',
    icon: '⌕',
    example: 'Bleu de Chanel, but fresher',
    cta: 'Match a fragrance',
  },
]

const conciergePromptExamples = [
  'fresh citrus for summer, not too sweet',
  'warm vanilla date night, mature not childish',
  'clean musk after a shower, office-safe',
]

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

function getFinderModeLabel(mode: FinderStartMode | null) {
  if (mode === 'guided') return 'Guided'
  if (mode === 'reference') return 'Reference'
  return 'Concierge'
}

function getFinderModeCard(mode: FinderStartMode) {
  return finderModeCards.find((card) => card.mode === mode) ?? finderModeCards[0]
}

const wardrobeLabels = [
  'Best overall',
  'Cleanest daily wear',
  'Most polished',
  'Most memorable',
  'Wildcard pick',
]

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

function normalizeNote(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function getSharedNotes(
  referenceFragrance: Recommendation | undefined,
  recommendation: Recommendation,
) {
  if (!referenceFragrance) {
    return []
  }

  const recommendationNotes = Array.isArray(recommendation.allNotes)
    ? recommendation.allNotes
    : []
  const referenceNotes = Array.isArray(referenceFragrance.allNotes)
    ? referenceFragrance.allNotes
    : []
  const recommendationNoteMap = new Map(
    recommendationNotes.map((note) => [normalizeNote(note), note]),
  )

  const sharedNotes: string[] = []

  for (const referenceNote of referenceNotes) {
    const normalizedReferenceNote = normalizeNote(referenceNote)
    const sharedNote = recommendationNoteMap.get(normalizedReferenceNote)

    if (normalizedReferenceNote && sharedNote) {
      sharedNotes.push(sharedNote)
    }
  }

  return sharedNotes
}

function isPlaceholderText(value: string | null | undefined) {
  return [
    'not verified',
    'not verified on mistify',
    'not fully verified from mistify page',
    'not verified from source',
  ].includes(value?.trim().toLowerCase() ?? '')
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

function getAssistantResultSummary(
  query: string | undefined,
  isReferenceSearch: boolean,
  isCuratedResult: boolean,
) {
  if (isReferenceSearch) {
    return 'Fragrances that share parts of the reference scent notes, profile, or overall direction.'
  }

  if (isCuratedResult) {
    return 'I kept the shortlist focused so each fragrance has a reason to be here.'
  }

  const normalizedQuery = query?.toLowerCase() ?? ''

  if (/\b(fresh|citrus|bergamot|lemon|orange|grapefruit|lime|yuzu)\b/.test(normalizedQuery)) {
    return 'Fresh, citrus, and easy-to-wear options that still feel polished.'
  }

  return 'Use these as a curated shelf: compare the fit notes, then refine the direction.'
}

function getResultContextPrefix(contextType: ActiveSearchContext['type']) {
  if (contextType === 'curated') {
    return 'Curated list'
  }

  if (contextType === 'reference') {
    return 'Similar direction'
  }

  return 'Showing matches for'
}

function NoteGroup({ label, notes }: { label: string; notes?: string[] }) {
  const safeNotes = Array.isArray(notes) ? notes.filter(Boolean) : []

  if (!safeNotes.length) {
    return null
  }

  return (
    <div className="reference-note-group">
      <p>{label}</p>
      <ul className="note-list">
        {safeNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}

function ReferenceFragranceCard({
  referenceFragrance,
}: {
  referenceFragrance: Recommendation
}) {
  const topNotes = Array.isArray(referenceFragrance.topNotes)
    ? referenceFragrance.topNotes
    : []
  const middleNotes = Array.isArray(referenceFragrance.middleNotes)
    ? referenceFragrance.middleNotes
    : []
  const baseNotes = Array.isArray(referenceFragrance.baseNotes)
    ? referenceFragrance.baseNotes
    : []
  const allNotes = Array.isArray(referenceFragrance.allNotes)
    ? referenceFragrance.allNotes
    : []
  const mistifyProductName =
    referenceFragrance.mistifyProductName &&
    !isPlaceholderText(referenceFragrance.mistifyProductName) &&
    referenceFragrance.mistifyProductName !== referenceFragrance.originalFragranceName
      ? referenceFragrance.mistifyProductName
      : null
  const sourceBrandBatch =
    referenceFragrance.sourceBrandBatch &&
    !isPlaceholderText(referenceFragrance.sourceBrandBatch)
      ? referenceFragrance.sourceBrandBatch
      : null
  const classification =
    referenceFragrance.classification &&
    !isPlaceholderText(referenceFragrance.classification)
      ? referenceFragrance.classification
      : null
  const rating = referenceFragrance.rating
  const ratingLine = [
    typeof rating?.ratingValue === 'number'
      ? `${rating.ratingValue.toFixed(2)} rating`
      : null,
    typeof rating?.ratingVoteCount === 'number'
      ? `${rating.ratingVoteCount.toLocaleString('en-US')} votes`
      : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <article className="reference-card">
      <p className="reference-card-kicker">Your reference</p>
      <h3>{referenceFragrance.originalFragranceName?.trim() || 'Reference fragrance'}</h3>
      {sourceBrandBatch ? <p className="reference-brand">{sourceBrandBatch}</p> : null}
      {mistifyProductName ? (
        <p className="reference-product">Mistify match: {mistifyProductName}</p>
      ) : null}
      {classification ? (
        <p className="fragrance-category">{classification}</p>
      ) : null}
      {ratingLine.length ? (
        <p className="reference-rating">{ratingLine.join(', ')}</p>
      ) : null}
      <div className="reference-notes">
        <NoteGroup label="Top" notes={topNotes} />
        <NoteGroup label="Middle" notes={middleNotes} />
        <NoteGroup label="Base" notes={baseNotes} />
        {!topNotes.length && !middleNotes.length && !baseNotes.length ? (
          <NoteGroup label="Notes" notes={allNotes} />
        ) : null}
      </div>
    </article>
  )
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

  const conversationRef = useRef<ConversationMessage[]>([])
  const resultsRef = useRef<HTMLElement | null>(null)
  const {
    input,
    isLoading,
    lastSubmittedMessage,
    assistantSearchIntro,
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
    activeSearchContext,
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
  const hasResults = recommendations.length > 0
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
  const assistantResultSummary = getAssistantResultSummary(
    lastSearchQuery,
    isReferenceSearch,
    isCuratedResult,
  )
  const resultContextText =
    activeSearchContext?.label && hasResults
      ? `${getResultContextPrefix(activeSearchContext.type)}: ${activeSearchContext.label}`
      : null
  const guidedBriefText = buildGuidedBriefText(guidedBrief)
  const selectedGuidedOptions = getSelectedGuidedOptions(guidedBrief)
  const selectedBriefCount = selectedGuidedOptions.length
  const visibleMoodGroups = getVisibleOptionGroups(recommendationOptions.moods, guidedSearch.moods, expandedGuidedGroups.moods)
  const visibleOccasionGroups = getVisibleOptionGroups(recommendationOptions.occasions, guidedSearch.occasions, expandedGuidedGroups.occasions)
  const visibleNoteGroups = getVisibleOptionGroups(recommendationOptions.notes, guidedSearch.notes, expandedGuidedGroups.notes, 12)
  const visibleAvoidGroups = getVisibleOptionGroups(recommendationOptions.avoids, guidedSearch.avoids, expandedGuidedGroups.avoids)
  const referenceBriefText = buildReferenceBriefText(referenceBrief)
  const submittedFinderModeLabel = getFinderModeLabel(submittedFinderMode)

  const conciergeModeCard = getFinderModeCard('concierge')
  const referenceModeCard = getFinderModeCard('reference')


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

  function removeGuidedValue(key: 'moods' | 'occasions' | 'notes' | 'avoids', value: string) {
    setGuidedBrief((currentBrief) => ({
      ...currentBrief,
      [key]: currentBrief[key].filter((currentValue) => currentValue !== value),
    }))
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
    <main className={`app-shell scent-atelier-shell ${hasResults ? 'has-results' : 'is-briefing'}`}>
      <section className="atelier-page" aria-labelledby="page-title">
        <header className="brand-bar atelier-brand-bar" aria-label="Mistify Fragrance Finder">
          <div className="brand-lockup">
            <a
              className="brand-mark brand-link"
              href="https://www.mistifyparfums.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Mistify Parfums website"
            >
              mistify
            </a>
            <a
              className="brand-subtitle brand-link"
              href="https://mistify-chatbot.vercel.app/"
              aria-label="Open Mistify Fragrance Finder"
            >
              Mistify Fragrance Finder
            </a>
          </div>
          <p className="atelier-header-note">Brief → Curated Tray → Refine</p>
        </header>

        {!hasResults ? (
          <section className="atelier-landing" aria-label="Mistify Fragrance Finder start">
            <section className="atelier-brief-card" aria-label="Start a scent brief">
              <div className="atelier-brief-header">
                <div className="chat-avatar atelier-avatar" aria-hidden="true">M</div>
                <div>
                  <p className="chat-speaker">Mistify Concierge</p>
                  <h1 id="page-title">What should your next scent feel like?</h1>
                  <p>Type freely, use a popular start, or switch modes below.</p>
                </div>
              </div>

              <section className="finder-mode-section finder-mode-workspace" aria-label="Choose how to start">
                <div className="finder-mode-header">
                  <div>
                    <p className="current-brief-label">Choose your starting point</p>
                    <h3>Three ways into the same curated tray.</h3>
                  </div>
                </div>

                <div className="finder-mode-grid equal-mode-grid">
                  {finderModeCards.map((card) => (
                    <button
                      key={card.mode}
                      type="button"
                      className={`finder-mode-card ${finderStartMode === card.mode ? 'active' : ''}`}
                      onClick={() => setFinderStartMode(card.mode)}
                      aria-pressed={finderStartMode === card.mode}
                    >
                      <span className="mode-card-header">
                        <span className="mode-card-icon" aria-hidden="true">{card.icon}</span>
                        <span className="mode-card-title">{card.title}</span>
                      </span>
                      <span className="mode-card-copy">{card.copy}</span>
                      <span className="mode-card-example">{card.example}</span>
                      <span className="mode-card-cta">
                        {card.cta}<span className="mode-card-arrow" aria-hidden="true">→</span>
                      </span>
                    </button>
                  ))}
                </div>

                <section className={`mode-panel active-mode-panel ${finderStartMode}-mode-panel`} aria-label={`${getFinderModeLabel(finderStartMode)} workspace`}>
                  {finderStartMode === 'concierge' ? (
                    <div className="mode-workspace-content concierge-workspace">
                      <div className="mode-workspace-heading">
                        <span className="mode-card-icon" aria-hidden="true">{conciergeModeCard.icon}</span>
                        <div>
                          <p className="current-brief-label">Concierge</p>
                          <h3>Describe what you want.</h3>
                          <p>Tell Mistify the vibe, notes, occasion, or mood in your own words.</p>
                        </div>
                      </div>

                      <ChatBox
                        value={input}
                        isLoading={isLoading}
                        maxLength={CHAT_MESSAGE_MAX_LENGTH}
                        inputId="chat-message"
                        placeholder="Try: fresh citrus for summer, not too sweet"
                        onChange={(value) => dispatch({ type: 'setInput', value })}
                        onSubmit={() => {
                          void handleSendMessage(undefined, undefined, 'concierge')
                        }}
                      />

                      {finderFeedback ? (
                        <p className={`atelier-feedback ${finderFeedback.tone}`} role="status">
                          {finderFeedback.text}
                        </p>
                      ) : null}

                      <div className="quick-start-header"><p className="hero-chip-label">Popular starts</p></div>
                      <div className="atelier-quick-start" aria-label="Popular scent starts">
                        {visiblePromptChips.slice(0, 5).map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            className="hero-chip quick-start-chip"
                            onClick={() => handleSendMessage(chip.prompt, undefined, 'concierge')}
                            disabled={isLoading}
                          >
                            {getPromptChipDisplayLabel(chip)}
                          </button>
                        ))}
                      </div>

                      <div className="example-prompt-list" aria-label="Example concierge prompts">
                        {conciergePromptExamples.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => handleSendMessage(prompt, undefined, 'concierge')}
                            disabled={isLoading}
                          >
                            “{prompt}”
                          </button>
                        ))}
                      </div>

                      {visibleCuratedChips.length ? (
                        <section className="curated-shortcuts" aria-label="Curated Mistify lists">
                          <p className="hero-chip-label">Or open a curated shelf</p>
                          <div className="hero-chip-list">
                            {visibleCuratedChips.slice(0, 6).map((chip) => (
                              <button
                                key={chip.id}
                                type="button"
                                className="hero-chip curated-pick-chip"
                                onClick={() => handleSendMessage(chip.label, chip.id, 'concierge')}
                                disabled={isLoading}
                              >
                                {getCuratedChipDisplayLabel(chip.label)}
                              </button>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  ) : null}

                  {finderStartMode === 'guided' ? (
                    <div className="guided-brief-builder" aria-label="Guided scent brief builder">
                      <div className="guided-builder-header">
                        <div>
                          <p className="current-brief-label">Guided brief</p>
                          <h3>Build a precise scent brief</h3>
                          <p>Choose popular cues first, or open the full engine vocabulary when you want more control.</p>
                        </div>
                        <span>{selectedBriefCount} selected</span>
                      </div>

                      <div className="guided-step-grid enhanced-guided-grid">
                        {renderGuidedOptionSection({
                          id: 'moods',
                          title: 'Mood',
                          hint: 'How should it feel?',
                          groups: visibleMoodGroups,
                          selectedValues: guidedBrief.moods,
                        })}
                        {renderGuidedOptionSection({
                          id: 'occasions',
                          title: 'Occasion',
                          hint: 'Where will you wear it?',
                          groups: visibleOccasionGroups,
                          selectedValues: guidedBrief.occasions,
                        })}
                        {renderGuidedOptionSection({
                          id: 'notes',
                          title: 'Notes',
                          hint: 'Pick notes or families from the engine.',
                          groups: visibleNoteGroups,
                          selectedValues: guidedBrief.notes,
                          searchPlaceholder: 'Search notes, accords, families...',
                        })}
                        {renderGuidedOptionSection({
                          id: 'avoids',
                          title: 'Avoid',
                          hint: 'Tell Mistify what to stay away from.',
                          groups: visibleAvoidGroups,
                          selectedValues: guidedBrief.avoids,
                          searchPlaceholder: 'Search avoids...',
                        })}
                      </div>

                      <div className="guided-selected-tray" aria-label="Selected guided brief cues">
                        <p className="current-brief-label">Selected</p>
                        {selectedGuidedOptions.length ? (
                          <div className="guided-selected-list">
                            {selectedGuidedOptions.map((item) => (
                              <button
                                key={`${item.type}-${item.label}`}
                                type="button"
                                onClick={() => removeGuidedValue(item.type, item.label)}
                              >
                                {item.label}<span aria-hidden="true">×</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p>Pick a few cues and they’ll collect here.</p>
                        )}
                      </div>

                      <div className="brief-preview-panel">
                        <div>
                          <p className="current-brief-label">Live brief</p>
                          <p>{guidedBriefText || 'Choose a few cues and Mistify will compose the brief here.'}</p>
                        </div>
                        <div className="brief-preview-actions">
                          <button
                            type="button"
                            className="details-toggle"
                            onClick={resetGuidedBrief}
                            disabled={!selectedBriefCount}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="mistify-link mistify-link-button"
                            onClick={submitGuidedBrief}
                            disabled={!guidedBriefText || isLoading}
                          >
                            Curate tray
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {finderStartMode === 'reference' ? (
                    <div className="mode-workspace-content reference-workspace">
                      <div className="mode-workspace-heading">
                        <span className="mode-card-icon" aria-hidden="true">{referenceModeCard.icon}</span>
                        <div>
                          <p className="current-brief-label">Reference</p>
                          <h3>Find similar to one you like.</h3>
                          <p>Start with a fragrance you own or admire, then choose the direction.</p>
                        </div>
                      </div>

                      <label className="reference-input-label" htmlFor="reference-fragrance">
                        Fragrance you like
                      </label>
                      <input
                        id="reference-fragrance"
                        className="guided-reference-input"
                        value={referenceBrief.fragrance}
                        placeholder="Example: Bleu de Chanel, Baccarat Rouge 540, Aventus"
                        onChange={(event) => updateReferenceFragrance(event.target.value)}
                      />

                      <div className="reference-direction-group" aria-label="Reference direction">
                        <p className="hero-chip-label">Make it</p>
                        <div className="guided-option-grid">
                          {referenceDirectionOptions.map((option) => (
                            <button
                              key={option.phrase}
                              type="button"
                              className={`guided-option ${referenceBrief.directions.includes(option.phrase) ? 'active' : ''}`}
                              onClick={() => toggleReferenceDirection(option.phrase)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="brief-preview-panel">
                        <div>
                          <p className="current-brief-label">Generated reference brief</p>
                          <p>{referenceBriefText || 'Type a fragrance and select a direction to preview the request.'}</p>
                        </div>
                        <div className="brief-preview-actions">
                          <button
                            type="button"
                            className="details-toggle"
                            onClick={resetReferenceBrief}
                            disabled={!referenceBrief.fragrance.trim() && !referenceBrief.directions.length}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="mistify-link mistify-link-button"
                            onClick={submitReferenceBrief}
                            disabled={!referenceBriefText || isLoading}
                          >
                            Match fragrance
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              </section>
            </section>
          </section>
        ) : null}

        {recommendations.length ? (
          <section
            ref={resultsRef}
            className={`atelier-results ${isReferenceSearch ? 'reference-results' : 'standard-results'} ${isCuratedResult ? 'curated-results' : 'search-results'}`}
            aria-label="Recommendations"
          >
            <aside className="atelier-brief-sidebar" aria-label="Current scent brief">
              <div className="brief-sidebar-card">
                <p className="eyebrow">YOUR SCENT BRIEF</p>
                <h2>{resultContextText ?? lastSubmittedMessage ?? 'Your fragrance search'}</h2>
                <p>{assistantResultSummary}</p>
                <div className="submitted-mode-pill" aria-label="Submitted search mode">
                  Mode: {submittedFinderModeLabel}
                </div>
              </div>

              <div className="brief-timeline" aria-label="Brief timeline">
                <p className="current-brief-label">Brief timeline</p>
                <ol>
                  <li>
                    <span>01</span>
                    <p>{lastSubmittedMessage ?? 'Initial brief'}</p>
                  </li>
                  {assistantSearchIntro ? (
                    <li>
                      <span>02</span>
                      <p>{assistantSearchIntro}</p>
                    </li>
                  ) : null}
                </ol>
              </div>

              <div className="results-command-panel atelier-refine-panel" aria-label="Refine scent brief">
                <p className="current-brief-label">Refine without restarting</p>
                <ChatBox
                  value={input}
                  isLoading={isLoading}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  inputId="results-chat-message"
                  placeholder="Make it fresher, warmer, softer, or more office-safe"
                  onChange={(value) => dispatch({ type: 'setInput', value })}
                  onSubmit={handleSendMessage}
                />
                {!isCuratedResult ? (
                  <div className="inline-refinement-rail" aria-label="Quick refinements">
                    {refinementChips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        className="refinement-chip"
                        onClick={() => handleSendMessage(chip.prompt)}
                        disabled={isLoading}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </aside>

            <div className="atelier-tray-area">
              <div className="curated-tray-header">
                <div>
                  <p className="eyebrow">CURATED TRAY</p>
                  <h2>{isReferenceSearch ? 'A shelf in the same direction' : 'Your fragrance wardrobe'}</h2>
                  <p>{showingText}</p>
                </div>
                <div className={`results-toolbar ${isCuratedResult ? 'curated-results-toolbar' : ''}`}>
                  {isCuratedResult ? (
                    <p className="curated-order-label">Curated order</p>
                  ) : (
                    <>
                      <div className="sort-control">
                        <label htmlFor="recommendation-sort">Sort</label>
                        <select
                          id="recommendation-sort"
                          value={sortOption}
                          onChange={(event) =>
                            dispatch({
                              type: 'setSortOption',
                              sortOption: event.target.value as SortOption,
                            })
                          }
                        >
                          {displayedSortOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className="filter-toggle-button"
                        aria-expanded={isFilterPanelOpen}
                        onClick={() => dispatch({ type: 'toggleFilterPanel' })}
                      >
                        Filters{hasActiveFilters ? ` (${activeFilters.length})` : ''}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!isCuratedResult && isFilterPanelOpen ? (
                <div className="filter-section atelier-filter-section">
                  <p className="filter-section-label">Refine results</p>
                  <div className="filter-chip-list" aria-label="Recommendation filters">
                    {filterOptions.map((filter) => {
                      const isActive = activeFilters.includes(filter.key)

                      return (
                        <button
                          aria-pressed={isActive}
                          className={`filter-chip ${isActive ? 'active' : ''}`}
                          key={filter.key}
                          type="button"
                          onClick={() => toggleFilter(filter.key)}
                        >
                          {filter.label}
                        </button>
                      )
                    })}
                    {hasActiveFilters ? (
                      <button
                        className="clear-filters-button"
                        type="button"
                        onClick={() => dispatch({ type: 'clearFilters' })}
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {displayedRecommendations.length ? (
                <div className={isReferenceSearch ? 'reference-comparison-layout' : ''}>
                  {isReferenceSearch && referenceFragrance ? (
                    <aside className="reference-column">
                      <ReferenceFragranceCard referenceFragrance={referenceFragrance} />
                    </aside>
                  ) : null}
                  <div className="similar-matches-column">
                    <div className="wardrobe-label-row" aria-label="Scent wardrobe roles">
                      {displayedRecommendations.slice(0, 5).map((recommendation, index) => (
                        <span key={`${recommendation.originalFragranceName ?? index}-${wardrobeLabels[index]}`}>
                          {String(index + 1).padStart(2, '0')} · {wardrobeLabels[index] ?? 'Curator pick'}
                        </span>
                      ))}
                    </div>
                    <div className="recommendation-list atelier-card-grid">
                      {displayedRecommendations.map((recommendation, index) => (
                        <FragranceCard
                          key={`${recommendation.sourceBrandBatch ?? 'source'}-${recommendation.originalFragranceName ?? 'fragrance'}-${index + 1}`}
                          recommendation={recommendation}
                          rank={index + 1}
                          featured={index === 0}
                          isReferenceMode={isReferenceSearch}
                          isCuratedResult={isCuratedResult}
                          sharedNotes={getSharedNotes(referenceFragrance, recommendation)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="empty-results-message">
                  No returned fragrances fit these filters. Try clearing filters or searching again.
                </p>
              )}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}

function ChatPage() {
  return useChatPageContent()
}

export default ChatPage
