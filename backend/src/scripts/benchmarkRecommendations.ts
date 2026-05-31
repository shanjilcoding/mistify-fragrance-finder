import { pool } from '../db/connection'
import { getFragranceRecommendationResult } from '../services/recommendationService'

const benchmarkQueries = [
  'I want fresh citrus',
  'I want coconut and vanilla',
  'I want tobacco and honey',
  'I want vanilla but not too sweet',
  'I want something fresh, maybe citrus',
  'I want a clean office scent',
  'I want a gym scent',
  'I want compliments',
  'I want something dark and woody',
  'I want something like Lafayette Street',
  'I want Lafayette Street but warmer',
  'I want something like Oud Wood',
  'Oud Wood but sweeter',
  'Blonde Amber but fresher',
]

const iterationsPerQuery = 3

type BenchmarkRun = {
  query: string
  iteration: number
  elapsedMs: number
  searchMode: string
  recommendationCount: number
  topResults: string[]
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) {
    return 0
  }

  const sortedValues = [...values].sort((first, second) => first - second)
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileValue / 100) * sortedValues.length) - 1,
  )

  return sortedValues[index]
}

function average(values: number[]) {
  if (!values.length) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatNumber(value: number) {
  return Math.round(value)
}

function getSummary(values: number[]) {
  return {
    min: formatNumber(Math.min(...values)),
    max: formatNumber(Math.max(...values)),
    avg: formatNumber(average(values)),
    p50: formatNumber(percentile(values, 50)),
    p95: formatNumber(percentile(values, 95)),
  }
}

function getName(recommendation: { mistifyProductName?: string; originalFragranceName?: string | null }) {
  return recommendation.mistifyProductName || recommendation.originalFragranceName || 'Unknown'
}

function printSummary(label: string, runs: BenchmarkRun[]) {
  if (!runs.length) {
    return
  }

  const elapsedValues = runs.map((run) => run.elapsedMs)
  const summary = getSummary(elapsedValues)

  console.log(
    `${label}: count=${runs.length} min=${summary.min}ms max=${summary.max}ms avg=${summary.avg}ms p50=${summary.p50}ms p95=${summary.p95}ms`,
  )
}

async function runBenchmark() {
  console.log('Mistify recommendation benchmark')
  console.log(`Queries: ${benchmarkQueries.length}`)
  console.log(`Iterations per query: ${iterationsPerQuery}`)

  const runs: BenchmarkRun[] = []

  for (const query of benchmarkQueries) {
    for (let iteration = 1; iteration <= iterationsPerQuery; iteration += 1) {
      const startedAt = Date.now()
      const result = await getFragranceRecommendationResult(query, {
        includeReferenceDebug: true,
      })
      const elapsedMs = Date.now() - startedAt
      const run: BenchmarkRun = {
        query,
        iteration,
        elapsedMs,
        searchMode: result.searchMode ?? 'normal',
        recommendationCount: result.recommendations.length,
        topResults: result.recommendations.slice(0, 5).map(getName),
      }

      runs.push(run)

      console.log(
        [
          `query="${query}"`,
          `iteration=${iteration}`,
          `mode=${run.searchMode}`,
          `elapsedMs=${run.elapsedMs}`,
          `recommendations=${run.recommendationCount}`,
          `top5=${run.topResults.join(' | ')}`,
        ].join(' '),
      )
    }
  }

  const coldRuns = runs.filter((run) => run.iteration === 1)
  const warmRuns = runs.filter((run) => run.iteration > 1)
  const normalRuns = runs.filter((run) => run.searchMode !== 'reference')
  const referenceRuns = runs.filter((run) => run.searchMode === 'reference')
  const warmNormalRuns = warmRuns.filter((run) => run.searchMode !== 'reference')
  const warmReferenceRuns = warmRuns.filter((run) => run.searchMode === 'reference')

  console.log('')
  console.log('Summary')
  printSummary('All runs', runs)
  printSummary('Cold-ish first runs', coldRuns)
  printSummary('Warm cached runs', warmRuns)
  printSummary('Normal runs', normalRuns)
  printSummary('Reference runs', referenceRuns)
  printSummary('Warm normal runs', warmNormalRuns)
  printSummary('Warm reference runs', warmReferenceRuns)
}

runBenchmark()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error(
      '[benchmark] recommendation benchmark failed',
      error instanceof Error ? error.message : 'Unknown error',
    )
    await pool.end()
    process.exit(1)
  })
