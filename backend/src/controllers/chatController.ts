import type { Request, Response } from 'express'
import { getConversationRefinementResult } from '../services/conversationRefinementService'
import { isLikelyFragranceRelated } from '../services/intentGuardService'
import { hasPromptInjectionAttempt } from '../services/promptInjectionGuardService'
import {
  getActiveCuratedChip,
  getCuratedChipRecommendations,
} from '../services/curatedChipService'
import { getFragranceRecommendationResult } from '../services/recommendationService'
import { FRAGRANCE_ONLY_MESSAGE } from '../utils/constants'
import { chatRequestSchema } from '../utils/validators'

export async function recommendFragrance(req: Request, res: Response) {
  const requestStartedAt = Date.now()
  const parsedBody = chatRequestSchema.safeParse(req.body)

  if (!parsedBody.success) {
    console.log(
      `[chat] recommend invalidRequest elapsedMs=${Date.now() - requestStartedAt}`,
    )

    return res.status(400).json({
      error: parsedBody.error.issues[0]?.message ?? 'Invalid request body.',
    })
  }

  const { message, lastSearchQuery, curatedChipId } = parsedBody.data
  console.log(
    `[chat] recommend start messageLength=${message.length} hasCuratedChip=${curatedChipId ? 'yes' : 'no'}`,
  )

  try {
    if (curatedChipId) {
      const curatedStartedAt = Date.now()
      const chip = await getActiveCuratedChip(curatedChipId)

      if (chip) {
        const recommendations = await getCuratedChipRecommendations(chip.id)

        console.log(
          `[chat] curated recommend complete recommendations=${recommendations.length} elapsedMs=${Date.now() - curatedStartedAt} totalElapsedMs=${Date.now() - requestStartedAt}`,
        )

        return res.json({
          reply: recommendations.length
            ? `Here are Mistify's curated picks for ${chip.label}.`
            : 'This curated list does not have fragrances selected yet.',
          filters: {
            notes: [],
            classifications: [],
            seasons: [],
            occasions: [],
            avoid: [],
          },
          searchQuery: message,
          searchMode: 'normal',
          recommendations,
        })
      }
    }
  } catch (error) {
    console.error(
      `[chat] curated recommend failed totalElapsedMs=${Date.now() - requestStartedAt}`,
      error,
    )

    return res.status(500).json({
      error: 'Something went wrong while loading the curated fragrance list.',
    })
  }

  const refinementStartedAt = Date.now()
  const refinementResult = getConversationRefinementResult({
    message,
    lastSearchQuery,
  })
  console.log(
    `[chat] refinement complete needsClarification=${refinementResult.needsClarification ? 'yes' : 'no'} elapsedMs=${Date.now() - refinementStartedAt}`,
  )

  const promptGuardStartedAt = Date.now()
  if (hasPromptInjectionAttempt(message)) {
    console.log(
      `[chat] prompt guard blocked messageLength=${message.length} elapsedMs=${Date.now() - promptGuardStartedAt} totalElapsedMs=${Date.now() - requestStartedAt}`,
    )

    return res.status(400).json({
      error: FRAGRANCE_ONLY_MESSAGE,
    })
  }
  console.log(
    `[chat] prompt guard passed elapsedMs=${Date.now() - promptGuardStartedAt}`,
  )

  if (refinementResult.needsClarification) {
    console.log(
      `[chat] recommend clarification reason=missing_context elapsedMs=${Date.now() - requestStartedAt}`,
    )

    return res.json({
      reply: refinementResult.clarificationReply,
      filters: {
        notes: [],
        classifications: [],
        seasons: [],
        occasions: [],
        avoid: [],
      },
      recommendations: [],
    })
  }

  const effectiveSearchQuery = refinementResult.effectiveSearchQuery ?? message

  const topicGuardStartedAt = Date.now()
  if (
    hasPromptInjectionAttempt(effectiveSearchQuery) ||
    !isLikelyFragranceRelated(effectiveSearchQuery)
  ) {
    console.log(
      `[chat] topic guard blocked messageLength=${message.length} effectiveMessageLength=${effectiveSearchQuery.length} elapsedMs=${Date.now() - topicGuardStartedAt} totalElapsedMs=${Date.now() - requestStartedAt}`,
    )

    return res.status(400).json({
      error: FRAGRANCE_ONLY_MESSAGE,
    })
  }
  console.log(
    `[chat] topic guard passed effectiveMessageLength=${effectiveSearchQuery.length} elapsedMs=${Date.now() - topicGuardStartedAt}`,
  )

  try {
    const recommendationStartedAt = Date.now()
    const recommendationResult =
      await getFragranceRecommendationResult(effectiveSearchQuery)
    const recommendationElapsedMs = Date.now() - recommendationStartedAt

    console.log(
      `[chat] recommend resultReady recommendations=${recommendationResult.recommendations.length} recommendationElapsedMs=${recommendationElapsedMs}`,
    )
    console.log(
      `[chat] recommend deterministicResponseReady recommendations=${recommendationResult.recommendations.length}`,
    )

    console.log(
      `[chat] recommend success totalElapsedMs=${Date.now() - requestStartedAt}`,
    )

    return res.json({
      reply: recommendationResult.reply,
      filters: {
        notes: [],
        classifications: [],
        seasons: [],
        occasions: [],
        avoid: [],
      },
      searchQuery: effectiveSearchQuery,
      searchMode: recommendationResult.searchMode,
      referenceFragrance: recommendationResult.referenceFragrance,
      recommendations: recommendationResult.recommendations,
    })
  } catch (error) {
    console.error(
      `[chat] recommend failed totalElapsedMs=${Date.now() - requestStartedAt}`,
      error,
    )

    return res.status(500).json({
      error: 'Something went wrong while searching the fragrance database.',
    })
  }
}
