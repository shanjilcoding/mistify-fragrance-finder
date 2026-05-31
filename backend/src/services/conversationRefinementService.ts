const CLARIFICATION_REPLY =
  'What kind of scent are you starting from: fresh, vanilla, woody, floral, or something else?'
const MAX_SEARCH_QUERY_LENGTH = 240

const REFINEMENT_PHRASES = [
  'make it sweeter',
  'sweeter',
  'less sweet',
  'make it fresher',
  'fresher',
  'less smoky',
  'more smoky',
  'more office safe',
  'office safe',
  'date night',
  'summer',
  'winter',
  'more masculine',
  'more feminine',
  'more woody',
  'more floral',
  'more oud',
  'less oud',
  'safer blind buy',
]

const REFINEMENT_PREFIXES = [
  'but ',
  'make it ',
  'make them ',
  'more ',
  'less ',
]

export type ConversationRefinementResult = {
  effectiveSearchQuery: string | null
  needsClarification: boolean
  clarificationReply: string | null
  isRefinement: boolean
}

function normalizeRefinementText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getCleanSearchQuery(value: string | undefined) {
  const trimmedValue = value?.trim()

  return trimmedValue ? trimmedValue.slice(0, MAX_SEARCH_QUERY_LENGTH) : null
}

export function isRefinementOnlyMessage(message: string) {
  const normalizedMessage = normalizeRefinementText(message)

  if (!normalizedMessage) {
    return false
  }

  if (REFINEMENT_PHRASES.includes(normalizedMessage)) {
    return true
  }

  return REFINEMENT_PREFIXES.some(
    (prefix) =>
      normalizedMessage.startsWith(prefix) &&
      REFINEMENT_PHRASES.some((phrase) =>
        normalizedMessage.includes(normalizeRefinementText(phrase)),
      ),
  )
}

export function getConversationRefinementResult(params: {
  message: string
  lastSearchQuery?: string
}): ConversationRefinementResult {
  const message = params.message.trim()
  const previousQuery = getCleanSearchQuery(params.lastSearchQuery)
  const isRefinement = isRefinementOnlyMessage(message)

  if (!isRefinement) {
    return {
      effectiveSearchQuery: message,
      needsClarification: false,
      clarificationReply: null,
      isRefinement: false,
    }
  }

  if (!previousQuery) {
    return {
      effectiveSearchQuery: null,
      needsClarification: true,
      clarificationReply: CLARIFICATION_REPLY,
      isRefinement: true,
    }
  }

  return {
    effectiveSearchQuery: `${previousQuery} ${message}`.slice(
      0,
      MAX_SEARCH_QUERY_LENGTH,
    ),
    needsClarification: false,
    clarificationReply: null,
    isRefinement: true,
  }
}
