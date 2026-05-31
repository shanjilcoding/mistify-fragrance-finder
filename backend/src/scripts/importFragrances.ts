import { and, eq } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, pool } from '../db/connection'
import { fragrances, type NewFragrance } from '../db/schema'

type CsvRow = Record<string, string>
type ImportableFragrance = NewFragrance & {
  sourceBrandBatch: string
  originalFragranceName: string
  mistifyProductName: string
}

const csvPath = join(process.cwd(), 'local-imports', 'fragrances_import.csv')

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
  const headers = parseCsvLine(lines[0] ?? '')

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)

    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {})
  })
}

function emptyStringToNull(value: string | undefined) {
  const trimmedValue = value?.trim()

  return trimmedValue ? trimmedValue : null
}

function parseNotes(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((note) => note.trim())
    .filter(Boolean)
}

function parseBoolean(value: string | undefined) {
  const normalizedValue = value?.trim().toLowerCase()

  return (
    normalizedValue === 'true' ||
    normalizedValue === 'yes' ||
    normalizedValue === '1'
  )
}

function normalizeSourceConfidence(
  value: string | undefined,
  fallback: 'high' | 'medium' | 'low',
  allowedValues: Array<'high' | 'medium' | 'low'>,
) {
  const normalizedValue = value?.trim().toLowerCase()

  return allowedValues.includes(normalizedValue as 'high' | 'medium' | 'low')
    ? normalizedValue
    : fallback
}

function buildAllNotes(
  topNotes: string[],
  middleNotes: string[],
  baseNotes: string[],
) {
  return [...topNotes, ...middleNotes, ...baseNotes]
}

function buildSearchableText(record: {
  originalFragranceName: string
  mistifyProductName: string
  sourceBrandBatch: string | null
  classification: string | null
  allNotes: string[]
}) {
  return [
    record.originalFragranceName,
    record.mistifyProductName,
    record.sourceBrandBatch,
    record.classification,
    ...record.allNotes,
  ]
    .filter(Boolean)
    .join(' ')
}

function buildFragranceRecord(row: CsvRow): ImportableFragrance | null {
  const originalFragranceName = row.original_fragrance_name?.trim()
  const rawMistifyProductName = row.mistify_product_name?.trim()
  const hasVerifiedMistifyProductName =
    rawMistifyProductName &&
    rawMistifyProductName !== 'Not verified on Mistify'
  const sourceBrandBatch = row.source_brand_batch?.trim()

  if (!sourceBrandBatch || !originalFragranceName) {
    return null
  }

  const csvMistifyProductFound = parseBoolean(row.mistify_product_found)
  const csvVerifiedOnMistify = parseBoolean(row.verified_on_mistify)
  const isVerifiedMistifyRow =
    csvMistifyProductFound &&
    csvVerifiedOnMistify &&
    Boolean(hasVerifiedMistifyProductName)
  const mistifyProductName = hasVerifiedMistifyProductName
    ? rawMistifyProductName
    : 'Not verified on Mistify'
  const mistifyProductFound = isVerifiedMistifyRow
  const verifiedOnMistify = isVerifiedMistifyRow

  const topNotes = parseNotes(row.top_notes)
  const middleNotes = parseNotes(row.middle_notes)
  const baseNotes = parseNotes(row.base_notes)
  const explicitAllNotes = parseNotes(row.all_notes)
  const allNotes = explicitAllNotes.length
    ? explicitAllNotes
    : buildAllNotes(topNotes, middleNotes, baseNotes)
  const now = new Date()
  const record = {
    sourceBrandBatch,
    originalFragranceName,
    mistifyProductName,
    classification: emptyStringToNull(row.classification),
    topNotes,
    middleNotes,
    baseNotes,
    allNotes,
    sourceStatus: isVerifiedMistifyRow
      ? emptyStringToNull(row.source_status)
      : emptyStringToNull(row.source_status) ?? 'Fallback',
    sourceUsed: isVerifiedMistifyRow ? 'Mistify' : 'Fallback',
    sourceNotes: emptyStringToNull(row.source_notes),
    sourceConfidence: isVerifiedMistifyRow
      ? normalizeSourceConfidence(row.source_confidence, 'high', [
          'high',
          'medium',
          'low',
        ])
      : normalizeSourceConfidence(row.source_confidence, 'low', [
          'low',
          'medium',
        ]),
    verifiedOnMistify,
    mistifyProductFound,
    notesSourceType: isVerifiedMistifyRow ? 'mistify' : 'fallback',
    inferredClassifications: [],
    inferredSeasons: [],
    inferredOccasions: [],
    inferredIntensity: null,
    seasonScores: {},
    profileScores: {},
    inferenceReason: null,
    reviewedByAdmin: false,
    searchableText: '',
    createdAt: now,
    updatedAt: now,
  }

  return {
    ...record,
    searchableText: buildSearchableText(record),
  }
}

async function upsertFragranceRecord(record: ImportableFragrance) {
  const existingRecord = await db
    .select({ id: fragrances.id })
    .from(fragrances)
    .where(
      and(
        eq(fragrances.sourceBrandBatch, record.sourceBrandBatch),
        eq(fragrances.originalFragranceName, record.originalFragranceName),
      ),
    )
    .limit(1)

  if (existingRecord.length) {
    await db
      .update(fragrances)
      .set({
        ...record,
        createdAt: undefined,
        updatedAt: new Date(),
      })
      .where(eq(fragrances.id, existingRecord[0].id))

    return 'updated'
  }

  await db.insert(fragrances).values(record)

  return 'inserted'
}

async function importFragrances() {
  console.log('Starting generic fragrance import...')

  if (!existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`)
  }

  const csvContent = readFileSync(csvPath, 'utf8')
  const rows = parseCsv(csvContent)
  let insertedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let fallbackCount = 0
  let verifiedCount = 0
  let errorCount = 0

  for (const [index, row] of rows.entries()) {
    try {
      const fragranceRecord = buildFragranceRecord(row)

      if (!fragranceRecord) {
        skippedCount += 1
        continue
      }

      const result = await upsertFragranceRecord(fragranceRecord)

      if (result === 'inserted') {
        insertedCount += 1
      } else {
        updatedCount += 1
      }

      if (fragranceRecord.mistifyProductFound) {
        verifiedCount += 1
      } else {
        fallbackCount += 1
      }
    } catch (error) {
      errorCount += 1
      console.error(`Failed to import fragrance row ${index + 2}.`, error)
    }
  }

  console.log(`Inserted ${insertedCount} fragrance records.`)
  console.log(`Updated ${updatedCount} fragrance records.`)
  console.log(`Skipped ${skippedCount} fragrance records.`)
  console.log(`Processed ${verifiedCount} verified Mistify fragrance records.`)
  console.log(`Processed ${fallbackCount} fallback fragrance records.`)
  console.log(`Encountered ${errorCount} fragrance import errors.`)
  console.log('Generic fragrance import finished.')
}

async function main() {
  try {
    await importFragrances()
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Generic fragrance import failed.')
    console.error(error)
    await pool.end()
    process.exit(1)
  }
}

void main()
