import { eq } from 'drizzle-orm'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { db, pool } from '../db/connection'
import { fragrances } from '../db/schema'

type Audience = 'unisex' | 'mens' | 'womens'
type MatchType = 'url' | 'mistify_name' | 'original_name_brand'
type CsvRow = Record<string, string>

type CandidateFragrance = {
  id: number
  originalFragranceName: string | null
  sourceBrandBatch: string | null
  mistifyProductName: string | null
  mistifyProductUrl: string | null
  audience: string | null
}

type ValidCsvRow = {
  rowNumber: number
  perfumeName: string
  brandName: string
  mistifyName: string
  url: string
  audience: Audience
}

type ReportMatch = {
  csvRowNumber: number
  fragranceId: number
  matchType: MatchType
  oldAudience: string | null
  newAudience: Audience
  perfumeName: string
  brandName: string
  mistifyName: string
  url: string
  dbOriginalFragranceName: string | null
  dbSourceBrandBatch: string | null
  dbMistifyProductName: string | null
  dbMistifyProductUrl: string | null
}

type ReportIssue = {
  rowNumber: number
  perfumeName: string
  brandName: string
  mistifyName: string
  url: string
  collection: string
  reason: string
  candidateFragranceIds?: number[]
}

type AnalysisResult = {
  csvRowsRead: number
  validCollectionRows: number
  matchedByUrlRows: number
  matchedByMistifyNameRows: number
  matchedByOriginalNameBrandRows: number
  matches: ReportMatch[]
  unmatchedRows: ReportIssue[]
  ambiguousRows: ReportIssue[]
  invalidRows: ReportIssue[]
}

const requiredHeaders = [
  'perfume name',
  'brand name',
  'mistify name',
  'url',
  'collection',
]
const reportPath = join(process.cwd(), 'tmp', 'fragrance-audience-update-report.json')

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\/+$/, '')
}

function normalizeAudience(value: string | null | undefined): Audience | null {
  const normalizedValue = normalizeText(value)

  if (normalizedValue === 'unisex') return 'unisex'
  if (normalizedValue === 'mens' || normalizedValue === 'men' || normalizedValue === 'male') {
    return 'mens'
  }
  if (
    normalizedValue === 'womens' ||
    normalizedValue === 'women' ||
    normalizedValue === 'female'
  ) {
    return 'womens'
  }

  return null
}

function parseArgs() {
  const args = process.argv.slice(2)
  const fileFlagIndex = args.indexOf('--file')
  const csvPath = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : ''
  const apply = args.includes('--apply')

  if (!csvPath) {
    throw new Error('Missing required --file path.')
  }

  return {
    apply,
    csvPath: resolve(process.cwd(), csvPath),
  }
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let currentValue = ''
  let isInsideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && nextCharacter === '"') {
      currentValue += '"'
      index += 1
      continue
    }

    if (character === '"') {
      isInsideQuotes = !isInsideQuotes
      continue
    }

    if (character === ',' && !isInsideQuotes) {
      values.push(currentValue)
      currentValue = ''
      continue
    }

    currentValue += character
  }

  values.push(currentValue)

  return values.map((value) => value.trim())
}

function parseCsv(csvContent: string): CsvRow[] {
  const lines = csvContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const headers = parseCsvLine(lines[0] ?? '').map((header) =>
    header.trim().toLowerCase(),
  )
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))

  if (missingHeaders.length) {
    throw new Error(`CSV is missing required columns: ${missingHeaders.join(', ')}`)
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)

    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {})
  })
}

async function fetchCandidateFragrances() {
  return db
    .select({
      id: fragrances.id,
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
      audience: fragrances.audience,
    })
    .from(fragrances)
}

function toIssue(row: CsvRow, rowNumber: number, reason: string): ReportIssue {
  return {
    rowNumber,
    perfumeName: row['perfume name']?.trim() ?? '',
    brandName: row['brand name']?.trim() ?? '',
    mistifyName: row['mistify name']?.trim() ?? '',
    url: row.url?.trim() ?? '',
    collection: row.collection?.trim() ?? '',
    reason,
  }
}

function toValidCsvRows(rows: CsvRow[]) {
  const validRows: ValidCsvRow[] = []
  const invalidRows: ReportIssue[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const audience = normalizeAudience(row.collection)

    if (!audience) {
      invalidRows.push(toIssue(row, rowNumber, 'Invalid collection value.'))
      return
    }

    validRows.push({
      rowNumber,
      perfumeName: row['perfume name']?.trim() ?? '',
      brandName: row['brand name']?.trim() ?? '',
      mistifyName: row['mistify name']?.trim() ?? '',
      url: row.url?.trim() ?? '',
      audience,
    })
  })

  return { validRows, invalidRows }
}

function canTreatDuplicatesAsSameProduct(
  matches: CandidateFragrance[],
  row: ValidCsvRow,
) {
  const csvUrl = normalizeUrl(row.url)
  const csvMistifyName = normalizeText(row.mistifyName)
  const urls = new Set(matches.map((match) => normalizeUrl(match.mistifyProductUrl)).filter(Boolean))
  const names = new Set(
    matches.map((match) => normalizeText(match.mistifyProductName)).filter(Boolean),
  )

  return (
    (csvUrl && urls.size === 1 && urls.has(csvUrl)) ||
    (csvMistifyName && names.size === 1 && names.has(csvMistifyName))
  )
}

function findMatchesByType(
  row: ValidCsvRow,
  candidates: CandidateFragrance[],
  matchType: MatchType,
) {
  if (matchType === 'url') {
    const csvUrl = normalizeUrl(row.url)
    return csvUrl
      ? candidates.filter((candidate) => normalizeUrl(candidate.mistifyProductUrl) === csvUrl)
      : []
  }

  if (matchType === 'mistify_name') {
    const csvMistifyName = normalizeText(row.mistifyName)
    return csvMistifyName
      ? candidates.filter(
          (candidate) => normalizeText(candidate.mistifyProductName) === csvMistifyName,
        )
      : []
  }

  const csvPerfumeName = normalizeText(row.perfumeName)
  const csvBrandName = normalizeText(row.brandName)

  return csvPerfumeName && csvBrandName
    ? candidates.filter(
        (candidate) =>
          normalizeText(candidate.originalFragranceName) === csvPerfumeName &&
          normalizeText(candidate.sourceBrandBatch) === csvBrandName,
      )
    : []
}

function findMatchingFragrance(
  row: ValidCsvRow,
  candidates: CandidateFragrance[],
) {
  for (const matchType of ['url', 'mistify_name', 'original_name_brand'] as const) {
    const matches = findMatchesByType(row, candidates, matchType)

    if (!matches.length) {
      continue
    }

    if (matches.length === 1 || canTreatDuplicatesAsSameProduct(matches, row)) {
      return { matches, matchType }
    }

    return {
      ambiguousMatches: matches,
      matchType,
    }
  }

  return {}
}

function toReportMatch(
  row: ValidCsvRow,
  fragrance: CandidateFragrance,
  matchType: MatchType,
): ReportMatch {
  return {
    csvRowNumber: row.rowNumber,
    fragranceId: fragrance.id,
    matchType,
    oldAudience: fragrance.audience,
    newAudience: row.audience,
    perfumeName: row.perfumeName,
    brandName: row.brandName,
    mistifyName: row.mistifyName,
    url: row.url,
    dbOriginalFragranceName: fragrance.originalFragranceName,
    dbSourceBrandBatch: fragrance.sourceBrandBatch,
    dbMistifyProductName: fragrance.mistifyProductName,
    dbMistifyProductUrl: fragrance.mistifyProductUrl,
  }
}

function analyzeRows(
  csvRows: CsvRow[],
  validRows: ValidCsvRow[],
  invalidRows: ReportIssue[],
  candidates: CandidateFragrance[],
): AnalysisResult {
  const result: AnalysisResult = {
    csvRowsRead: csvRows.length,
    validCollectionRows: validRows.length,
    matchedByUrlRows: 0,
    matchedByMistifyNameRows: 0,
    matchedByOriginalNameBrandRows: 0,
    matches: [],
    unmatchedRows: [],
    ambiguousRows: [],
    invalidRows,
  }

  for (const row of validRows) {
    const matchResult = findMatchingFragrance(row, candidates)

    if (matchResult.ambiguousMatches?.length && matchResult.matchType) {
      result.ambiguousRows.push({
        rowNumber: row.rowNumber,
        perfumeName: row.perfumeName,
        brandName: row.brandName,
        mistifyName: row.mistifyName,
        url: row.url,
        collection: row.audience,
        reason: `Ambiguous duplicate match by ${matchResult.matchType}.`,
        candidateFragranceIds: matchResult.ambiguousMatches.map((match) => match.id),
      })
      continue
    }

    if (!matchResult.matches?.length || !matchResult.matchType) {
      result.unmatchedRows.push({
        rowNumber: row.rowNumber,
        perfumeName: row.perfumeName,
        brandName: row.brandName,
        mistifyName: row.mistifyName,
        url: row.url,
        collection: row.audience,
        reason: 'No matching fragrance row found.',
      })
      continue
    }

    if (matchResult.matchType === 'url') result.matchedByUrlRows += 1
    if (matchResult.matchType === 'mistify_name') result.matchedByMistifyNameRows += 1
    if (matchResult.matchType === 'original_name_brand') {
      result.matchedByOriginalNameBrandRows += 1
    }

    result.matches.push(
      ...matchResult.matches.map((match) =>
        toReportMatch(row, match, matchResult.matchType),
      ),
    )
  }

  return result
}

function buildReport(
  result: AnalysisResult,
  dryRun: boolean,
  updatedRows: ReportMatch[],
) {
  return {
    dryRun,
    timestamp: new Date().toISOString(),
    summary: {
      csvRowsRead: result.csvRowsRead,
      validCollectionRows: result.validCollectionRows,
      matchedByUrlRows: result.matchedByUrlRows,
      matchedByMistifyNameRows: result.matchedByMistifyNameRows,
      matchedByOriginalNameBrandRows: result.matchedByOriginalNameBrandRows,
      unmatchedRows: result.unmatchedRows.length,
      ambiguousRows: result.ambiguousRows.length,
      invalidRows: result.invalidRows.length,
      rowsEligibleForUpdate: result.matches.length,
      updatedRows: updatedRows.length,
    },
    updatedRows,
    unmatchedRows: result.unmatchedRows,
    ambiguousRows: result.ambiguousRows,
    invalidRows: result.invalidRows,
  }
}

async function applyMatches(matches: ReportMatch[]) {
  const updatedRows: ReportMatch[] = []

  await db.transaction(async (transaction) => {
    for (const match of matches) {
      const updated = await transaction
        .update(fragrances)
        .set({
          audience: match.newAudience,
          updatedAt: new Date(),
        })
        .where(eq(fragrances.id, match.fragranceId))
        .returning({ id: fragrances.id })

      if (updated.length !== 1) {
        throw new Error(
          `Expected to update one fragrance row for id ${match.fragranceId}; updated ${updated.length}.`,
        )
      }

      updatedRows.push(match)
    }
  })

  return updatedRows
}

function printExamples(label: string, rows: ReportIssue[]) {
  if (!rows.length) {
    return
  }

  console.log(`- ${label} examples:`)
  for (const row of rows.slice(0, 5)) {
    const candidateText = row.candidateFragranceIds?.length
      ? ` candidates=${row.candidateFragranceIds.join('|')}`
      : ''

    console.log(
      `  row ${row.rowNumber}: ${row.perfumeName || '(missing perfume)'} / ${row.brandName || '(missing brand)'} / ${row.collection || '(missing collection)'} - ${row.reason}${candidateText}`,
    )
  }
}

function printSummary(result: AnalysisResult, dryRun: boolean, updatedCount: number) {
  console.log('Fragrance audience CSV update summary:')
  console.log(`- mode: ${dryRun ? 'dry-run' : 'apply'}`)
  console.log(`- total CSV rows read: ${result.csvRowsRead}`)
  console.log(`- rows with valid collection: ${result.validCollectionRows}`)
  console.log(`- rows matched by URL: ${result.matchedByUrlRows}`)
  console.log(`- rows matched by Mistify name: ${result.matchedByMistifyNameRows}`)
  console.log(`- rows matched by original name + brand: ${result.matchedByOriginalNameBrandRows}`)
  console.log(`- rows unmatched: ${result.unmatchedRows.length}`)
  console.log(`- rows skipped due to invalid collection: ${result.invalidRows.length}`)
  console.log(`- rows skipped due to ambiguous duplicates: ${result.ambiguousRows.length}`)
  console.log(`- rows that would update: ${result.matches.length}`)
  console.log(`- rows updated: ${updatedCount}`)
  printExamples('unmatched', result.unmatchedRows)
  printExamples('ambiguous', result.ambiguousRows)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in the backend environment.')
  }

  const { apply, csvPath } = parseArgs()
  const dryRun = !apply

  if (!existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`)
  }

  console.log('Fragrance audience CSV updater starting.')
  console.log(`Mode: ${dryRun ? 'dry-run' : 'apply'}.`)
  console.log(`CSV path: ${csvPath}`)

  const csvRows = parseCsv(readFileSync(csvPath, 'utf8'))
  const { validRows, invalidRows } = toValidCsvRows(csvRows)
  const candidates = await fetchCandidateFragrances()
  const result = analyzeRows(csvRows, validRows, invalidRows, candidates)
  const updatedRows = dryRun ? [] : await applyMatches(result.matches)

  printSummary(result, dryRun, updatedRows.length)

  if (!dryRun) {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    writeFileSync(
      reportPath,
      `${JSON.stringify(buildReport(result, dryRun, updatedRows), null, 2)}\n`,
      'utf8',
    )
    console.log(`- JSON report: ${reportPath}`)
  }
}

main()
  .catch((error) => {
    console.error('Fragrance audience CSV updater failed.')
    console.error(error instanceof Error ? error.message : 'Unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
