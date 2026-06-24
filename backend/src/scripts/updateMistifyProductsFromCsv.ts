import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { db, pool } from '../db/connection'
import { fragrances } from '../db/schema'
import { buildCatalogFields } from '../utils/catalogFields'

type CsvRow = Record<string, string>

type CandidateFragrance = {
  id: number
  originalFragranceName: string | null
  sourceBrandBatch: string | null
  mistifyProductName: string | null
  mistifyProductUrl: string | null
}

type ValidCsvProduct = {
  rowNumber: number
  perfumeName: string
  brandName: string
  mistifyName: string
  url: string
  collection: string
  originalBrandKey: string
  mistifyNameKey: string
}

type MatchReportRow = {
  fragrance_id: number | string
  db_original_fragrance_name: string
  db_source_brand_batch: string
  old_mistify_product_name: string
  old_mistify_product_url: string
  new_mistify_product_name: string
  new_mistify_product_url: string
  csv_perfume_name: string
  csv_brand_name: string
  csv_mistify_name: string
  collection: string
  match_type: string
  fields_to_update: string
  reason: string
}

type SkippedReportRow = {
  csv_row_number: number | string
  csv_perfume_name: string
  csv_brand_name: string
  csv_mistify_name: string
  csv_url: string
  collection: string
  reason: string
}

type AnalysisResult = {
  exactMatches: MatchReportRow[]
  skippedRows: SkippedReportRow[]
  manualReviewRows: MatchReportRow[]
  duplicateCsvOriginalBrandKeys: Set<string>
  duplicateCsvMistifyNameKeys: Set<string>
  duplicateDbOriginalBrandKeys: Set<string>
  duplicateDbMistifyNameKeys: Set<string>
  csvRowsRead: number
  dbCandidateRowsFound: number
}

const requiredHeaders = [
  'perfume name',
  'brand name',
  'mistify name',
  'url',
  'collection',
]
const mistifyProductUrlPrefix = 'https://www.mistifyparfums.com/products/'
const placeholderProductNames = [
  'not verified',
  'not verified on mistify',
]
const brandAliasMap = new Map<string, string>([
  ['by kilian', 'kilian'],
  ['kilian', 'kilian'],
  ['initio parfums', 'initio'],
  ['initio', 'initio'],
  ['ysl', 'yves saint laurent'],
  ['yves saint laurent', 'yves saint laurent'],
  ['ysl yves saint laurent', 'yves saint laurent'],
  ['christian dior', 'dior'],
  ['dior', 'dior'],
  ['paco rabanne', 'rabanne'],
  ['rabanne', 'rabanne'],
  ['stephane h lucas', 'stephane humbert lucas'],
  ['stephane humbert lucas', 'stephane humbert lucas'],
  ['parfums de marly', 'parfums de marly'],
  ['maison martin margiela replica', 'maison margiela'],
  ['maison martin margiela', 'maison margiela'],
  ['maison margiela', 'maison margiela'],
])
const outputDirectory = join(process.cwd(), 'tmp')
const matchOutputPath = join(outputDirectory, 'mistify-product-update-dry-run-matches.csv')
const skippedOutputPath = join(outputDirectory, 'mistify-product-update-skipped.csv')
const manualReviewOutputPath = join(outputDirectory, 'mistify-product-update-manual-review.csv')

function parseArgs() {
  const args = process.argv.slice(2)
  const csvFlagIndex = args.indexOf('--csv')
  const csvPath = csvFlagIndex >= 0 ? args[csvFlagIndex + 1] : ''
  const isDryRun = args.includes('--dry-run')
  const isApply = args.includes('--apply')

  if (!csvPath) {
    throw new Error('Missing required --csv path.')
  }

  if (isDryRun && isApply) {
    throw new Error('Use either --dry-run or --apply, not both.')
  }

  return {
    csvPath: resolve(process.cwd(), csvPath),
    mode: isApply ? 'apply' as const : 'dry-run' as const,
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

function normalizeForMatch(value: string | null | undefined) {
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

function normalizeBrandForMatch(value: string | null | undefined) {
  const normalizedBrand = normalizeForMatch(value)

  return brandAliasMap.get(normalizedBrand) ?? normalizedBrand
}

function buildMatchKey(brandName: string | null | undefined, perfumeName: string | null | undefined) {
  return `${normalizeBrandForMatch(brandName)}::${normalizeForMatch(perfumeName)}`
}

function normalizeMistifyNameKey(value: string | null | undefined) {
  return normalizeForMatch(value)
}

function didUseBrandAlias(firstBrandName: string | null | undefined, secondBrandName: string | null | undefined) {
  const firstNormalizedBrand = normalizeForMatch(firstBrandName)
  const secondNormalizedBrand = normalizeForMatch(secondBrandName)
  const firstCanonicalBrand = normalizeBrandForMatch(firstBrandName)
  const secondCanonicalBrand = normalizeBrandForMatch(secondBrandName)

  return (
    firstCanonicalBrand !== '' &&
    firstCanonicalBrand === secondCanonicalBrand &&
    firstNormalizedBrand !== secondNormalizedBrand
  )
}

function isPlaceholderProductName(value: string | null | undefined) {
  const normalizedValue = normalizeForMatch(value)

  return !normalizedValue || placeholderProductNames.includes(normalizedValue)
}

function isValidMistifyProductUrl(value: string) {
  return value.startsWith(mistifyProductUrlPrefix)
}

function toValidCsvProducts(rows: CsvRow[]) {
  const validProducts: ValidCsvProduct[] = []
  const skippedRows: SkippedReportRow[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const perfumeName = row['perfume name']?.trim() ?? ''
    const brandName = row['brand name']?.trim() ?? ''
    const mistifyName = row['mistify name']?.trim() ?? ''
    const url = row.url?.trim() ?? ''
    const collection = row.collection?.trim() ?? ''

    if (!perfumeName || !brandName || !mistifyName || !url) {
      skippedRows.push({
        csv_row_number: rowNumber,
        csv_perfume_name: perfumeName,
        csv_brand_name: brandName,
        csv_mistify_name: mistifyName,
        csv_url: url,
        collection,
        reason: 'Missing required CSV value.',
      })
      return
    }

    if (!isValidMistifyProductUrl(url)) {
      skippedRows.push({
        csv_row_number: rowNumber,
        csv_perfume_name: perfumeName,
        csv_brand_name: brandName,
        csv_mistify_name: mistifyName,
        csv_url: url,
        collection,
        reason: 'Invalid Mistify product URL.',
      })
      return
    }

    validProducts.push({
      rowNumber,
      perfumeName,
      brandName,
      mistifyName,
      url,
      collection,
      originalBrandKey: buildMatchKey(brandName, perfumeName),
      mistifyNameKey: normalizeMistifyNameKey(mistifyName),
    })
  })

  return { validProducts, skippedRows }
}

function groupByKey<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const key = getKey(item)

    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  return groups
}

async function fetchCandidateFragrances() {
  return db
    .select({
      id: fragrances.id,
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
    })
    .from(fragrances)
    .where(
      and(
        or(
          isNull(fragrances.mistifyProductName),
          sql`trim(${fragrances.mistifyProductName}) = ''`,
          sql`lower(trim(${fragrances.mistifyProductName})) in ('not verified', 'not verified on mistify')`,
          isNull(fragrances.mistifyProductUrl),
          sql`trim(${fragrances.mistifyProductUrl}) = ''`,
        ),
        sql`${fragrances.originalFragranceName} is not null`,
        sql`trim(${fragrances.originalFragranceName}) <> ''`,
        sql`${fragrances.sourceBrandBatch} is not null`,
        sql`trim(${fragrances.sourceBrandBatch}) <> ''`,
      ),
    )
}

function buildMatchReportRow(
  fragrance: CandidateFragrance,
  product: ValidCsvProduct,
  matchType: string,
  fieldsToUpdate: string[],
  reason: string,
): MatchReportRow {
  return {
    fragrance_id: fragrance.id,
    db_original_fragrance_name: fragrance.originalFragranceName ?? '',
    db_source_brand_batch: fragrance.sourceBrandBatch ?? '',
    old_mistify_product_name: fragrance.mistifyProductName ?? '',
    old_mistify_product_url: fragrance.mistifyProductUrl ?? '',
    new_mistify_product_name: product.mistifyName,
    new_mistify_product_url: product.url,
    csv_perfume_name: product.perfumeName,
    csv_brand_name: product.brandName,
    csv_mistify_name: product.mistifyName,
    collection: product.collection,
    match_type: matchType,
    fields_to_update: fieldsToUpdate.join('|'),
    reason,
  }
}

function hasMissingProductUrl(value: string | null | undefined) {
  return !value?.trim()
}

function getOriginalBrandFieldsToUpdate(fragrance: CandidateFragrance) {
  return [
    isPlaceholderProductName(fragrance.mistifyProductName)
      ? 'mistify_product_name'
      : null,
    hasMissingProductUrl(fragrance.mistifyProductUrl)
      ? 'mistify_product_url'
      : null,
  ].filter((field): field is string => Boolean(field))
}

function tokenOverlapScore(firstValue: string, secondValue: string) {
  const firstTokens = normalizeForMatch(firstValue)
    .split(' ')
    .filter((token) => token.length >= 3)
  const secondTokens = new Set(
    normalizeForMatch(secondValue)
      .split(' ')
      .filter((token) => token.length >= 3),
  )

  if (!firstTokens.length || !secondTokens.size) {
    return 0
  }

  const matchedCount = firstTokens.filter((token) => secondTokens.has(token)).length

  return matchedCount / Math.max(firstTokens.length, secondTokens.size)
}

function findManualReviewCandidates(
  product: ValidCsvProduct,
  dbGroups: Map<string, CandidateFragrance[]>,
  duplicateDbOriginalBrandKeys: Set<string>,
) {
  const normalizedBrand = normalizeBrandForMatch(product.brandName)
  const normalizedPerfume = normalizeForMatch(product.perfumeName)
  const candidates: MatchReportRow[] = []

  for (const [key, fragrancesForKey] of dbGroups.entries()) {
    if (duplicateDbOriginalBrandKeys.has(key)) {
      continue
    }

    const [dbBrand, dbPerfume] = key.split('::')

    if (dbBrand !== normalizedBrand || !dbPerfume || !normalizedPerfume) {
      continue
    }

    const containsMatch =
      dbPerfume.includes(normalizedPerfume) || normalizedPerfume.includes(dbPerfume)
    const overlapScore = tokenOverlapScore(dbPerfume, normalizedPerfume)

    if (!containsMatch && overlapScore < 0.72) {
      continue
    }

    candidates.push(
      buildMatchReportRow(
        fragrancesForKey[0],
        product,
        'manual_review_fuzzy',
        [],
        containsMatch
          ? 'Same normalized brand; one fragrance name contains the other.'
          : `Same normalized brand; high token overlap (${overlapScore.toFixed(2)}).`,
      ),
    )
  }

  return candidates.slice(0, 5)
}

function analyzeMatches(
  csvRows: CsvRow[],
  validProducts: ValidCsvProduct[],
  initialSkippedRows: SkippedReportRow[],
  dbCandidates: CandidateFragrance[],
): AnalysisResult {
  const csvOriginalBrandGroups = groupByKey(validProducts, (product) => product.originalBrandKey)
  const csvMistifyNameGroups = groupByKey(validProducts, (product) => product.mistifyNameKey)
  const dbOriginalBrandGroups = groupByKey(dbCandidates, (fragrance) =>
    buildMatchKey(fragrance.sourceBrandBatch, fragrance.originalFragranceName),
  )
  const dbMistifyNameGroups = groupByKey(
    dbCandidates.filter(
      (fragrance) =>
        !isPlaceholderProductName(fragrance.mistifyProductName) &&
        hasMissingProductUrl(fragrance.mistifyProductUrl),
    ),
    (fragrance) => normalizeMistifyNameKey(fragrance.mistifyProductName),
  )
  const duplicateCsvOriginalBrandKeys = new Set(
    Array.from(csvOriginalBrandGroups.entries())
      .filter(([, products]) => products.length > 1)
      .map(([key]) => key),
  )
  const duplicateCsvMistifyNameKeys = new Set(
    Array.from(csvMistifyNameGroups.entries())
      .filter(([, products]) => products.length > 1)
      .map(([key]) => key),
  )
  const duplicateDbOriginalBrandKeys = new Set(
    Array.from(dbOriginalBrandGroups.entries())
      .filter(([, fragrancesForKey]) => fragrancesForKey.length > 1)
      .map(([key]) => key),
  )
  const duplicateDbMistifyNameKeys = new Set(
    Array.from(dbMistifyNameGroups.entries())
      .filter(([, fragrancesForKey]) => fragrancesForKey.length > 1)
      .map(([key]) => key),
  )
  const exactMatches: MatchReportRow[] = []
  const skippedRows = [...initialSkippedRows]
  const manualReviewRows: MatchReportRow[] = []
  const matchedFragranceIds = new Set<number>()

  for (const product of validProducts) {
    if (duplicateCsvOriginalBrandKeys.has(product.originalBrandKey)) {
      manualReviewRows.push({
        fragrance_id: '',
        db_original_fragrance_name: '',
        db_source_brand_batch: '',
        old_mistify_product_name: '',
        old_mistify_product_url: '',
        new_mistify_product_name: product.mistifyName,
        new_mistify_product_url: product.url,
        csv_perfume_name: product.perfumeName,
        csv_brand_name: product.brandName,
        csv_mistify_name: product.mistifyName,
        collection: product.collection,
        match_type: 'manual_review_duplicate_csv_original_brand_key',
        fields_to_update: '',
        reason: 'Duplicate normalized brand + perfume name in CSV.',
      })
    } else {
      const dbMatches = dbOriginalBrandGroups.get(product.originalBrandKey) ?? []

      if (duplicateDbOriginalBrandKeys.has(product.originalBrandKey)) {
        for (const fragrance of dbMatches) {
          manualReviewRows.push(
            buildMatchReportRow(
              fragrance,
              product,
              'manual_review_duplicate_db_original_brand_key',
              [],
              'Duplicate normalized brand + fragrance name in database candidates.',
            ),
          )
        }
      } else {
        const exactMatch = dbMatches[0]

        if (exactMatch && isPlaceholderProductName(exactMatch.mistifyProductName)) {
          const fieldsToUpdate = getOriginalBrandFieldsToUpdate(exactMatch)

          if (fieldsToUpdate.length) {
            const usedBrandAlias = didUseBrandAlias(
              exactMatch.sourceBrandBatch,
              product.brandName,
            )

            exactMatches.push(
              buildMatchReportRow(
                exactMatch,
                product,
                usedBrandAlias
                  ? 'exact_original_name_brand_alias'
                  : 'exact_original_brand_name',
                fieldsToUpdate,
                usedBrandAlias
                  ? 'Original fragrance name matched exactly and brand matched through an explicit alias.'
                  : 'Normalized source brand and original fragrance name matched CSV exactly.',
              ),
            )
            matchedFragranceIds.add(exactMatch.id)
            continue
          }
        }
      }
    }

    if (duplicateCsvMistifyNameKeys.has(product.mistifyNameKey)) {
      manualReviewRows.push({
        fragrance_id: '',
        db_original_fragrance_name: '',
        db_source_brand_batch: '',
        old_mistify_product_name: '',
        old_mistify_product_url: '',
        new_mistify_product_name: product.mistifyName,
        new_mistify_product_url: product.url,
        csv_perfume_name: product.perfumeName,
        csv_brand_name: product.brandName,
        csv_mistify_name: product.mistifyName,
        collection: product.collection,
        match_type: 'manual_review_duplicate_csv_mistify_name_key',
        fields_to_update: '',
        reason: 'Duplicate normalized Mistify product name in CSV.',
      })
      continue
    }

    if (duplicateDbMistifyNameKeys.has(product.mistifyNameKey)) {
      for (const fragrance of dbMistifyNameGroups.get(product.mistifyNameKey) ?? []) {
        manualReviewRows.push(
          buildMatchReportRow(
            fragrance,
            product,
            'manual_review_duplicate_db_mistify_name_key',
            [],
            'Duplicate normalized Mistify product name in database URL-fill candidates.',
          ),
        )
      }
      continue
    }

    const mistifyNameMatch = dbMistifyNameGroups.get(product.mistifyNameKey)?.[0]

    if (mistifyNameMatch && !matchedFragranceIds.has(mistifyNameMatch.id)) {
      exactMatches.push(
        buildMatchReportRow(
          mistifyNameMatch,
          product,
          'exact_mistify_name_url_fill',
          ['mistify_product_url'],
          'Existing DB Mistify product name matched CSV Mistify name exactly; URL is missing.',
        ),
      )
      matchedFragranceIds.add(mistifyNameMatch.id)
      continue
    }

    const fuzzyCandidates = findManualReviewCandidates(
      product,
      dbOriginalBrandGroups,
      duplicateDbOriginalBrandKeys,
    )

    if (fuzzyCandidates.length) {
      manualReviewRows.push(...fuzzyCandidates)
    } else {
      skippedRows.push({
        csv_row_number: product.rowNumber,
        csv_perfume_name: product.perfumeName,
        csv_brand_name: product.brandName,
        csv_mistify_name: product.mistifyName,
        csv_url: product.url,
        collection: product.collection,
        reason: 'No matching database candidate row found.',
      })
    }
  }

  return {
    exactMatches,
    skippedRows,
    manualReviewRows,
    duplicateCsvOriginalBrandKeys,
    duplicateCsvMistifyNameKeys,
    duplicateDbOriginalBrandKeys,
    duplicateDbMistifyNameKeys,
    csvRowsRead: csvRows.length,
    dbCandidateRowsFound: dbCandidates.length,
  }
}

function escapeCsvValue(value: string | number) {
  const stringValue = String(value)

  if (!/[",\r\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replace(/"/g, '""')}"`
}

function writeReportCsv<T extends Record<string, string | number>>(
  outputPath: string,
  headers: Array<keyof T>,
  rows: T[],
) {
  const content = [
    headers.map(String).join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(','),
    ),
  ].join('\n')

  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(outputPath, `${content}\n`, 'utf8')
}

function writeReports(result: AnalysisResult) {
  writeReportCsv<MatchReportRow>(
    matchOutputPath,
    [
      'fragrance_id',
      'db_original_fragrance_name',
      'db_source_brand_batch',
      'old_mistify_product_name',
      'old_mistify_product_url',
      'new_mistify_product_name',
      'new_mistify_product_url',
      'csv_perfume_name',
      'csv_brand_name',
      'csv_mistify_name',
      'collection',
      'match_type',
      'fields_to_update',
      'reason',
    ],
    result.exactMatches,
  )
  writeReportCsv<SkippedReportRow>(
    skippedOutputPath,
    [
      'csv_row_number',
      'csv_perfume_name',
      'csv_brand_name',
      'csv_mistify_name',
      'csv_url',
      'collection',
      'reason',
    ],
    result.skippedRows,
  )
  writeReportCsv<MatchReportRow>(
    manualReviewOutputPath,
    [
      'fragrance_id',
      'db_original_fragrance_name',
      'db_source_brand_batch',
      'old_mistify_product_name',
      'old_mistify_product_url',
      'new_mistify_product_name',
      'new_mistify_product_url',
      'csv_perfume_name',
      'csv_brand_name',
      'csv_mistify_name',
      'collection',
      'match_type',
      'fields_to_update',
      'reason',
    ],
    result.manualReviewRows,
  )
}

async function applyExactMatches(exactMatches: MatchReportRow[]) {
  if (!exactMatches.length) {
    return 0
  }

  let updatedCount = 0

  await db.transaction(async (transaction) => {
    for (const match of exactMatches) {
      const fragranceId = Number(match.fragrance_id)
      const fieldsToUpdate = new Set(match.fields_to_update.split('|').filter(Boolean))

      if (!Number.isFinite(fragranceId)) {
        throw new Error('Exact match report included an invalid fragrance id.')
      }

      if (!fieldsToUpdate.size) {
        throw new Error(`Exact match for fragrance id ${fragranceId} had no fields to update.`)
      }

      const updatedRows = await transaction
        .update(fragrances)
        .set({
          ...(fieldsToUpdate.has('mistify_product_name')
            ? { mistifyProductName: match.new_mistify_product_name }
            : {}),
          ...(fieldsToUpdate.has('mistify_product_url')
            ? { mistifyProductUrl: match.new_mistify_product_url }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fragrances.id, fragranceId),
            fieldsToUpdate.has('mistify_product_name')
              ? or(
                  isNull(fragrances.mistifyProductName),
                  sql`trim(${fragrances.mistifyProductName}) = ''`,
                  sql`lower(trim(${fragrances.mistifyProductName})) in ('not verified', 'not verified on mistify')`,
                )
              : sql`true`,
            fieldsToUpdate.has('mistify_product_url')
              ? or(
                  isNull(fragrances.mistifyProductUrl),
                  sql`trim(${fragrances.mistifyProductUrl}) = ''`,
                )
              : sql`true`,
          ),
        )
        .returning({ id: fragrances.id })

      if (updatedRows.length !== 1) {
        throw new Error(
          `Expected to update exactly one row for fragrance id ${fragranceId}; updated ${updatedRows.length}.`,
        )
      }

      updatedCount += 1
    }
  })

  if (updatedCount !== exactMatches.length) {
    throw new Error(
      `Updated ${updatedCount} rows, but expected ${exactMatches.length}.`,
    )
  }

  return updatedCount
}

// After Mistify product name/URL fills, the derived catalog fields (slugs,
// inspired-by label, searchable text, visibility) may change for those rows.
// Recompute them from the freshly updated rows so the public catalog stays
// consistent without requiring a separate full backfill run.
async function recomputeCatalogFieldsForIds(ids: number[]) {
  const uniqueIds = Array.from(new Set(ids)).filter((id) => Number.isFinite(id))

  if (!uniqueIds.length) {
    return 0
  }

  const rows = await db
    .select({
      id: fragrances.id,
      originalFragranceName: fragrances.originalFragranceName,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      classification: fragrances.classification,
      audience: fragrances.audience,
      allNotes: fragrances.allNotes,
      verifiedOnMistify: fragrances.verifiedOnMistify,
      mistifyProductFound: fragrances.mistifyProductFound,
    })
    .from(fragrances)
    .where(inArray(fragrances.id, uniqueIds))

  for (const row of rows) {
    await db
      .update(fragrances)
      .set({
        ...buildCatalogFields(row),
        updatedAt: new Date(),
      })
      .where(eq(fragrances.id, row.id))
  }

  return rows.length
}

function printSummary(result: AnalysisResult, mode: 'dry-run' | 'apply', updatedCount = 0) {
  const exactOriginalBrandMatches = result.exactMatches.filter(
    (match) => match.match_type === 'exact_original_brand_name',
  ).length
  const exactBrandAliasMatches = result.exactMatches.filter(
    (match) => match.match_type === 'exact_original_name_brand_alias',
  ).length
  const exactMistifyNameUrlFillMatches = result.exactMatches.filter(
    (match) => match.match_type === 'exact_mistify_name_url_fill',
  ).length
  const rowsUpdatingProductName = result.exactMatches.filter((match) =>
    match.fields_to_update.split('|').includes('mistify_product_name'),
  ).length
  const rowsUpdatingProductUrl = result.exactMatches.filter((match) =>
    match.fields_to_update.split('|').includes('mistify_product_url'),
  ).length

  console.log('Mistify product CSV update summary:')
  console.log(`- mode: ${mode}`)
  console.log(`- CSV rows read: ${result.csvRowsRead}`)
  console.log(`- DB candidate rows found: ${result.dbCandidateRowsFound}`)
  console.log(`- exact original+brand matches: ${exactOriginalBrandMatches}`)
  console.log(`- exact brand-alias matches: ${exactBrandAliasMatches}`)
  console.log(`- exact Mistify-name URL-fill matches: ${exactMistifyNameUrlFillMatches}`)
  console.log(`- exact matches total: ${result.exactMatches.length}`)
  console.log(`- skipped invalid/no-match rows: ${result.skippedRows.length}`)
  console.log(`- duplicate CSV original+brand keys: ${result.duplicateCsvOriginalBrandKeys.size}`)
  console.log(`- duplicate CSV Mistify-name keys: ${result.duplicateCsvMistifyNameKeys.size}`)
  console.log(`- duplicate DB original+brand keys: ${result.duplicateDbOriginalBrandKeys.size}`)
  console.log(`- duplicate DB Mistify-name keys: ${result.duplicateDbMistifyNameKeys.size}`)
  console.log(`- ambiguous/fuzzy/manual-review rows: ${result.manualReviewRows.length}`)
  console.log(`- rows that would update mistify_product_name: ${rowsUpdatingProductName}`)
  console.log(`- rows that would update mistify_product_url: ${rowsUpdatingProductUrl}`)
  console.log(`- rows updated: ${updatedCount}`)
  console.log(`- matches report: ${matchOutputPath}`)
  console.log(`- skipped report: ${skippedOutputPath}`)
  console.log(`- manual review report: ${manualReviewOutputPath}`)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in the backend environment.')
  }

  const { csvPath, mode } = parseArgs()

  if (!existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`)
  }

  console.log('Mistify product CSV updater starting.')
  console.log(`Mode: ${mode}.`)
  console.log(`CSV path: ${csvPath}`)
  console.log('Only exact normalized brand + fragrance matches are eligible for update.')

  const csvRows = parseCsv(readFileSync(csvPath, 'utf8'))
  const { validProducts, skippedRows } = toValidCsvProducts(csvRows)
  const dbCandidates = await fetchCandidateFragrances()
  const result = analyzeMatches(csvRows, validProducts, skippedRows, dbCandidates)

  writeReports(result)

  const updatedCount = mode === 'apply'
    ? await applyExactMatches(result.exactMatches)
    : 0

  if (mode === 'apply' && updatedCount) {
    const updatedIds = result.exactMatches
      .map((match) => Number(match.fragrance_id))
      .filter((id) => Number.isFinite(id))
    const recomputedCount = await recomputeCatalogFieldsForIds(updatedIds)

    console.log(`- catalog fields recomputed for ${recomputedCount} rows`)
  }

  printSummary(result, mode, updatedCount)
}

main()
  .catch((error) => {
    console.error('Mistify product CSV updater failed.')
    console.error(error instanceof Error ? error.message : 'Unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
