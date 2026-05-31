import { and, eq } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, pool } from '../db/connection'
import { fragranceRatings, type NewFragranceRating } from '../db/schema'
import {
  normalizeBrandName,
  normalizeFragranceName,
} from '../utils/fragranceMatching'

type CsvRow = Record<string, string>

const csvPath = join(process.cwd(), 'local-imports', 'fragrance_ratings_output.csv')

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

function parseNullableNumber(value: string | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  const parsedValue = Number(trimmedValue)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

function parseCount(value: string | undefined) {
  const parsedValue = parseNullableNumber(value)

  return parsedValue === null ? 0 : Math.trunc(parsedValue)
}

function parseTimestamp(value: string | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  const parsedDate = new Date(trimmedValue)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function toNumericString(value: number | null, fractionDigits?: number) {
  if (value === null) {
    return null
  }

  return typeof fractionDigits === 'number'
    ? value.toFixed(fractionDigits)
    : String(value)
}

function calculateShare(count: number, total: number) {
  return total > 0 ? count / total : null
}

function buildRatingRecord(row: CsvRow): NewFragranceRating | null {
  const brandForMatching = row.parsed_brand || row.input_brand
  const nameForMatching = row.parsed_name || row.input_name
  const normalizedBrand = normalizeBrandName(brandForMatching)
  const normalizedName = normalizeFragranceName(nameForMatching)

  if (!normalizedBrand || !normalizedName) {
    return null
  }

  const winterCount = parseCount(row.winter_count)
  const springCount = parseCount(row.spring_count)
  const summerCount = parseCount(row.summer_count)
  const fallCount = parseCount(row.fall_count)
  const dayCount = parseCount(row.day_count)
  const nightCount = parseCount(row.night_count)
  const seasonTotalCount = winterCount + springCount + summerCount + fallCount
  const dayNightTotalCount = dayCount + nightCount
  const now = new Date()

  return {
    inputBrand: emptyStringToNull(row.input_brand),
    inputName: emptyStringToNull(row.input_name),
    parsedBrand: emptyStringToNull(row.parsed_brand),
    parsedName: emptyStringToNull(row.parsed_name),
    normalizedBrand,
    normalizedName,
    fragranticaUrl: emptyStringToNull(row.fragrantica_url),
    ratingValue: toNumericString(parseNullableNumber(row.rating_value), 2),
    ratingVoteCount: parseCount(row.rating_vote_count),
    reviewCount: parseCount(row.review_count),
    loveCount: parseCount(row.love_count),
    likeCount: parseCount(row.like_count),
    okCount: parseCount(row.ok_count),
    dislikeCount: parseCount(row.dislike_count),
    hateCount: parseCount(row.hate_count),
    winterCount,
    springCount,
    summerCount,
    fallCount,
    dayCount,
    nightCount,
    seasonTotalCount,
    dayNightTotalCount,
    winterShare: toNumericString(
      calculateShare(winterCount, seasonTotalCount),
      5,
    ),
    springShare: toNumericString(
      calculateShare(springCount, seasonTotalCount),
      5,
    ),
    summerShare: toNumericString(
      calculateShare(summerCount, seasonTotalCount),
      5,
    ),
    fallShare: toNumericString(calculateShare(fallCount, seasonTotalCount), 5),
    dayShare: toNumericString(calculateShare(dayCount, dayNightTotalCount), 5),
    nightShare: toNumericString(
      calculateShare(nightCount, dayNightTotalCount),
      5,
    ),
    sourceName: 'Fragrantica',
    sourceType: 'ratings',
    scrapeStatus: emptyStringToNull(row.status),
    errorMessage: emptyStringToNull(row.error_message),
    scrapedAt: parseTimestamp(row.scraped_at),
    createdAt: now,
    updatedAt: now,
  }
}

async function upsertRatingRecord(record: NewFragranceRating) {
  const existingRecord = await db
    .select({ id: fragranceRatings.id })
    .from(fragranceRatings)
    .where(
      and(
        eq(fragranceRatings.normalizedBrand, record.normalizedBrand),
        eq(fragranceRatings.normalizedName, record.normalizedName),
      ),
    )
    .limit(1)

  if (existingRecord.length) {
    await db
      .update(fragranceRatings)
      .set({
        ...record,
        createdAt: undefined,
        updatedAt: new Date(),
      })
      .where(eq(fragranceRatings.id, existingRecord[0].id))

    return 'updated'
  }

  await db.insert(fragranceRatings).values(record)

  return 'inserted'
}

async function importFragranceRatings() {
  console.log('Starting fragrance ratings import...')

  if (!existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`)
  }

  const csvContent = readFileSync(csvPath, 'utf8')
  const rows = parseCsv(csvContent)
  let insertedCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const [index, row] of rows.entries()) {
    try {
      const ratingRecord = buildRatingRecord(row)

      if (!ratingRecord) {
        skippedCount += 1
        continue
      }

      const result = await upsertRatingRecord(ratingRecord)

      if (result === 'inserted') {
        insertedCount += 1
      } else {
        updatedCount += 1
      }
    } catch (error) {
      errorCount += 1
      console.error(`Failed to import ratings row ${index + 2}.`, error)
    }
  }

  console.log(`Inserted ${insertedCount} fragrance rating records.`)
  console.log(`Updated ${updatedCount} fragrance rating records.`)
  console.log(`Skipped ${skippedCount} fragrance rating records.`)
  console.log(`Encountered ${errorCount} fragrance rating import errors.`)
  console.log('Fragrance ratings import finished.')
}

async function main() {
  try {
    await importFragranceRatings()
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Fragrance ratings import failed.')
    console.error(error)
    await pool.end()
    process.exit(1)
  }
}

void main()
