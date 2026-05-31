import { pool } from '../db/connection'
import { getFragranceRecommendationResult } from '../services/recommendationService'

type RegressionCase = {
  query: string
  expectedMode: 'normal' | 'reference'
  minRecommendations: number
  expectedTopIncludes?: string[]
  expectedReference?: string
  maxWarmElapsedMs?: number
}

const regressionCases: RegressionCase[] = [
  {
    query: 'I want fresh citrus',
    expectedMode: 'normal',
    minRecommendations: 10,
    expectedTopIncludes: ['Imaginique'],
    maxWarmElapsedMs: 2500,
  },
  {
    query: 'I want coconut and vanilla',
    expectedMode: 'normal',
    minRecommendations: 5,
    expectedTopIncludes: ['Vanilla Powder'],
    maxWarmElapsedMs: 1200,
  },
  {
    query: 'I want tobacco and honey',
    expectedMode: 'normal',
    minRecommendations: 5,
    expectedTopIncludes: ['Le Miel Elixir'],
    maxWarmElapsedMs: 1200,
  },
  {
    query: 'I want something like Lafayette Street',
    expectedMode: 'reference',
    minRecommendations: 10,
    expectedTopIncludes: ['Laytonington'],
    expectedReference: 'Lafayette Street',
    maxWarmElapsedMs: 4000,
  },
  {
    query: 'Oud Wood but sweeter',
    expectedMode: 'reference',
    minRecommendations: 10,
    expectedTopIncludes: ['True Purpose'],
    expectedReference: 'Oud Wood',
    maxWarmElapsedMs: 4000,
  },
  {
    query: 'Blonde Amber but fresher',
    expectedMode: 'reference',
    minRecommendations: 10,
    expectedTopIncludes: ['True Purpose'],
    expectedReference: 'Blonde Amber',
    maxWarmElapsedMs: 4000,
  },
]

function getRecommendationName(recommendation: {
  mistifyProductName?: string
  originalFragranceName?: string | null
}) {
  return recommendation.mistifyProductName || recommendation.originalFragranceName || 'Unknown'
}

function assertCondition(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function runCase(testCase: RegressionCase) {
  const coldStartedAt = Date.now()
  await getFragranceRecommendationResult(testCase.query, {
    includeReferenceDebug: true,
  })
  const coldElapsedMs = Date.now() - coldStartedAt

  const warmStartedAt = Date.now()
  const result = await getFragranceRecommendationResult(testCase.query, {
    includeReferenceDebug: true,
  })
  const warmElapsedMs = Date.now() - warmStartedAt
  const mode = result.searchMode ?? 'normal'
  const topNames = result.recommendations.slice(0, 5).map(getRecommendationName)
  const referenceName = result.referenceFragrance?.originalFragranceName ?? null

  assertCondition(
    mode === testCase.expectedMode,
    `${testCase.query}: expected mode ${testCase.expectedMode}, got ${mode}`,
  )
  assertCondition(
    result.recommendations.length >= testCase.minRecommendations,
    `${testCase.query}: expected at least ${testCase.minRecommendations} ` +
      `recommendations, got ${result.recommendations.length}`,
  )

  for (const expectedName of testCase.expectedTopIncludes ?? []) {
    assertCondition(
      topNames.includes(expectedName),
      `${testCase.query}: expected top 5 to include ${expectedName}, got ${topNames.join(' | ')}`,
    )
  }

  if (testCase.expectedReference) {
    assertCondition(
      referenceName === testCase.expectedReference,
      `${testCase.query}: expected reference ${testCase.expectedReference}, got ${referenceName ?? 'none'}`,
    )
  }

  if (testCase.maxWarmElapsedMs) {
    assertCondition(
      warmElapsedMs <= testCase.maxWarmElapsedMs,
      `${testCase.query}: warm run ${warmElapsedMs}ms exceeded ${testCase.maxWarmElapsedMs}ms`,
    )
  }

  console.log(
    [
      `PASS query="${testCase.query}"`,
      `mode=${mode}`,
      `coldMs=${coldElapsedMs}`,
      `warmMs=${warmElapsedMs}`,
      `count=${result.recommendations.length}`,
      `top5=${topNames.join(' | ')}`,
    ].join(' '),
  )
}

async function runRegression() {
  console.log('Mistify recommendation regression guardrails')

  for (const testCase of regressionCases) {
    await runCase(testCase)
  }
}

runRegression()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error(
      '[regression] recommendation regression failed',
      error instanceof Error ? error.message : 'Unknown error',
    )
    await pool.end()
    process.exit(1)
  })
