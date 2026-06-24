require('dotenv/config')

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Pool } = require('pg')

const MISTIFY_BASE_URL = 'https://www.mistifyparfums.com'
const PRODUCTS_PAGE_SIZE = 250
const MAX_PRODUCT_PAGES = 20
const inputCsvPath = join(process.cwd(), 'tmp', 'mistify-catalog-sync-shop-only.csv')
const outputDirectory = join(process.cwd(), 'tmp')
const summaryOutputPath = join(outputDirectory, 'mistify-shop-only-import-summary.json')
const candidatesOutputPath = join(outputDirectory, 'mistify-shop-only-import-candidates.csv')
const manualReviewOutputPath = join(outputDirectory, 'mistify-shop-only-import-manual-review.csv')
const skippedOutputPath = join(outputDirectory, 'mistify-shop-only-import-skipped.csv')

function parseArgs() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isApply = args.includes('--apply')

  if (isDryRun && isApply) {
    throw new Error('Use either --dry-run or --apply, not both.')
  }

  return { mode: isApply ? 'apply' : 'dry-run' }
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtml(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' '))
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || null
}

function toTitleCase(value) {
  return String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (['de', 'du', 'des', 'd', 'le', 'la', 'les', 'van', 'von', 'and', 'of'].includes(lower)) return lower
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
    })
    .join(' ')
    .replace(/\bYsl\b/g, 'YSL')
}

function toBrandDisplayName(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null

  const normalized = normalizeText(trimmed)
  const aliases = new Map([
    ['ysl', 'Yves Saint Laurent'],
    ['christian dior', 'Dior'],
    ['dior', 'Dior'],
    ['paco rabanne', 'Rabanne'],
    ['rabanne', 'Rabanne'],
    ['by kilian', 'Kilian'],
    ['kilian', 'Kilian'],
    ['maison martin margiela replica', 'Maison Margiela'],
    ['maison martin margiela', 'Maison Margiela'],
    ['maison margiela', 'Maison Margiela'],
  ])

  return aliases.get(normalized) ?? toTitleCase(trimmed)
}

function buildInspiredByLabel(brandName, originalFragranceName) {
  if (brandName && originalFragranceName) return `${brandName} ${originalFragranceName}`
  return originalFragranceName || brandName || null
}

function splitCsvLine(line) {
  const values = []
  let currentValue = ''
  let isInsideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"' && nextChar === '"' && isInsideQuotes) {
      currentValue += '"'
      index += 1
      continue
    }

    if (char === '"') {
      isInsideQuotes = !isInsideQuotes
      continue
    }

    if (char === ',' && !isInsideQuotes) {
      values.push(currentValue)
      currentValue = ''
      continue
    }

    currentValue += char
  }

  values.push(currentValue)
  return values
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []

  const headers = splitCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? '')
  if (!/[",\r\n]/.test(stringValue)) return stringValue
  return `"${stringValue.replace(/"/g, '""')}"`
}

function toCsv(headers, rows) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
}

function toMistifyProductUrl(handle) {
  return `${MISTIFY_BASE_URL}/products/${handle}`
}

async function fetchAllMistifyShopProducts() {
  const products = []

  for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
    const response = await fetch(`${MISTIFY_BASE_URL}/products.json?limit=${PRODUCTS_PAGE_SIZE}&page=${page}`, {
      headers: { 'user-agent': 'Mistify shop-only import (local admin)' },
    })

    if (!response.ok) {
      throw new Error(`Mistify Shopify products request failed with HTTP ${response.status}`)
    }

    const payload = await response.json()
    const pageProducts = payload.products ?? []
    if (!pageProducts.length) break

    for (const product of pageProducts) {
      const title = typeof product.title === 'string' ? product.title.trim() : ''
      const handle = typeof product.handle === 'string' ? product.handle.trim() : ''
      if (!title || !handle) continue

      const vendor = typeof product.vendor === 'string' ? product.vendor.trim() : ''
      const bodyHtml = typeof product.body_html === 'string' ? product.body_html : ''
      const imageUrl = product.images?.find((image) => typeof image.src === 'string')?.src ?? ''

      products.push({
        title,
        handle,
        url: toMistifyProductUrl(handle),
        imageUrl,
        vendor,
        bodyText: stripHtml(bodyHtml),
      })
    }
  }

  return products
}

function normalizeLabelText(value) {
  return String(value ?? '')
    .replace(/I\s+nspiration\s*:/gi, 'Inspiration:')
    .replace(/Base Note\b/gi, 'Base Notes')
    .replace(/Middle Note\b/gi, 'Middle Notes')
    .replace(/Top Note\b/gi, 'Top Notes')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractField(text, label, nextLabels) {
  const labelPattern = label.replace(/\s+/g, '\\s+')
  const nextPattern = nextLabels.map((nextLabel) => nextLabel.replace(/\s+/g, '\\s+')).join('|')
  const regex = new RegExp(`${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=${nextPattern ? `\\b(?:${nextPattern})\\s*:` : '$'}|$)`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim().replace(/[.;,\s]+$/, '') : ''
}

function trimDescriptionTail(value, productTitle) {
  const stopPhrases = [
    productTitle,
    'Note:',
    'Now available',
    'Available in',
    'Due to the high extract concentration',
  ].filter(Boolean)
  const stopPattern = stopPhrases.map(escapeRegExp).join('|')
  if (!stopPattern) return value

  return String(value ?? '').split(new RegExp(`\\b(?:${stopPattern})`, 'i'))[0].trim().replace(/[.;,\s]+$/, '')
}

function splitNotes(value) {
  return String(value ?? '')
    .split(/,|\band\b/i)
    .map((note) => note.trim().replace(/[.;]+$/, ''))
    .filter(Boolean)
}

function parseInspiredBy(value) {
  const cleaned = String(value ?? '').replace(/^\s*(?:Inspiration|Inspired by)\s*:\s*/i, '').trim()
  const byMatch = cleaned.match(/^(.+)\s+by\s+(.+)$/i)
  if (!byMatch) return { originalFragranceName: cleaned, sourceBrandBatch: '' }

  return {
    originalFragranceName: byMatch[1].trim(),
    sourceBrandBatch: byMatch[2].trim(),
  }
}

function parseProductMetadata(product) {
  const sourceText = normalizeLabelText(product.bodyText || product.vendor)
  const firstInspiration = extractField(sourceText, 'Inspiration', [
    'Inspiration',
    'Classification',
    'Top Notes',
    'Middle Notes',
    'Base Notes',
  ])
  const classification = extractField(sourceText, 'Classification', ['Top Notes', 'Middle Notes', 'Base Notes'])
  const topNotes = splitNotes(extractField(sourceText, 'Top Notes', ['Middle Notes', 'Base Notes']))
  const middleNotes = splitNotes(extractField(sourceText, 'Middle Notes', ['Base Notes']))
  const baseNotes = splitNotes(trimDescriptionTail(extractField(sourceText, 'Base Notes', []), product.title))
  const inspiredBy = parseInspiredBy(firstInspiration || product.vendor)
  const allNotes = [...new Set([...topNotes, ...middleNotes, ...baseNotes])]

  return {
    inspirationText: firstInspiration ? `Inspiration: ${firstInspiration}` : product.vendor,
    originalFragranceName: inspiredBy.originalFragranceName,
    sourceBrandBatch: inspiredBy.sourceBrandBatch,
    classification,
    topNotes,
    middleNotes,
    baseNotes,
    allNotes,
  }
}

function buildSearchableText(row, brandName) {
  return [
    brandName,
    row.sourceBrandBatch,
    row.originalFragranceName,
    row.mistifyProductName,
    row.classification,
    ...row.allNotes,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function buildCatalogFields(row) {
  const brandName = toBrandDisplayName(row.sourceBrandBatch)
  const originalFragranceName = row.originalFragranceName?.trim() ?? ''
  const mistifyProductName = row.mistifyProductName?.trim() ?? ''

  return {
    brandName,
    brandSlug: brandName ? slugify(brandName) : null,
    originalFragranceSlug: brandName && originalFragranceName
      ? slugify(`${brandName} ${originalFragranceName}`)
      : originalFragranceName
        ? slugify(originalFragranceName)
        : null,
    mistifyProductSlug: mistifyProductName ? slugify(mistifyProductName) : null,
    publicInspiredByLabel: buildInspiredByLabel(brandName, originalFragranceName),
    isCatalogVisible: Boolean(brandName && originalFragranceName),
    searchableText: buildSearchableText(row, brandName),
  }
}

function buildCandidate(product) {
  const metadata = parseProductMetadata(product)
  const catalogFields = buildCatalogFields({
    ...metadata,
    mistifyProductName: product.title,
  })

  return {
    shop_title: product.title,
    shop_handle: product.handle,
    shop_url: product.url,
    image_url: product.imageUrl,
    vendor: product.vendor,
    inspiration_text: metadata.inspirationText,
    original_fragrance_name: metadata.originalFragranceName,
    source_brand_batch: metadata.sourceBrandBatch,
    classification: metadata.classification,
    top_notes: metadata.topNotes.join('|'),
    middle_notes: metadata.middleNotes.join('|'),
    base_notes: metadata.baseNotes.join('|'),
    all_notes: metadata.allNotes.join('|'),
    brand_name: catalogFields.brandName ?? '',
    brand_slug: catalogFields.brandSlug ?? '',
    original_fragrance_slug: catalogFields.originalFragranceSlug ?? '',
    mistify_product_slug: catalogFields.mistifyProductSlug ?? '',
    public_inspired_by_label: catalogFields.publicInspiredByLabel ?? '',
    searchable_text: catalogFields.searchableText,
    is_catalog_visible: catalogFields.isCatalogVisible,
  }
}

function analyzeCandidates(inputRows, products, existingRows) {
  const requestedHandles = new Set(inputRows.map((row) => row.shop_handle).filter(Boolean))
  const productsByHandle = new Map(products.map((product) => [product.handle, product]))
  const existingByUrl = new Map(existingRows.map((row) => [normalizeText(row.mistify_product_url), row]).filter(([key]) => key))
  const existingByMistifyName = new Map(existingRows.map((row) => [normalizeText(row.mistify_product_name), row]).filter(([key]) => key))
  const existingByOriginalBrand = new Map(
    existingRows
      .map((row) => [`${normalizeText(row.source_brand_batch)}||${normalizeText(row.original_fragrance_name)}`, row])
      .filter(([key]) => key !== '||'),
  )

  const candidates = []
  const manualReviewRows = []
  const skippedRows = []

  for (const handle of requestedHandles) {
    const product = productsByHandle.get(handle)
    if (!product) {
      skippedRows.push({ shop_handle: handle, reason: 'Shop-only CSV handle no longer exists in Shopify product feed.' })
      continue
    }

    const candidate = buildCandidate(product)
    const duplicateReasons = []
    const urlDuplicate = existingByUrl.get(normalizeText(candidate.shop_url))
    const mistifyNameDuplicate = existingByMistifyName.get(normalizeText(candidate.shop_title))
    const originalBrandDuplicate = existingByOriginalBrand.get(
      `${normalizeText(candidate.source_brand_batch)}||${normalizeText(candidate.original_fragrance_name)}`,
    )

    if (urlDuplicate) duplicateReasons.push(`mistify_product_url already exists on fragrance id ${urlDuplicate.id}`)
    if (mistifyNameDuplicate) duplicateReasons.push(`mistify_product_name already exists on fragrance id ${mistifyNameDuplicate.id}`)
    if (originalBrandDuplicate) duplicateReasons.push(`brand + original fragrance already exists on fragrance id ${originalBrandDuplicate.id}`)

    const missingReasons = []
    if (!candidate.original_fragrance_name) missingReasons.push('missing original fragrance name')
    if (!candidate.source_brand_batch) missingReasons.push('missing source brand')
    if (!candidate.classification) missingReasons.push('missing classification')
    if (!candidate.all_notes) missingReasons.push('missing notes')
    if (!candidate.image_url) missingReasons.push('missing image URL')

    if (duplicateReasons.length) {
      skippedRows.push({ ...candidate, reason: duplicateReasons.join('; ') })
      continue
    }

    if (missingReasons.length) {
      manualReviewRows.push({ ...candidate, review_reason: missingReasons.join('; ') })
      continue
    }

    candidates.push(candidate)
  }

  return { candidates, manualReviewRows, skippedRows }
}

async function insertCandidates(pool, candidates) {
  if (!candidates.length) return 0

  const client = await pool.connect()
  let insertedCount = 0

  try {
    await client.query('begin')

    for (const candidate of candidates) {
      const result = await client.query(
        `insert into fragrances (
          original_fragrance_name, mistify_product_name, mistify_product_url, audience,
          source_brand_batch, classification, top_notes, middle_notes, base_notes, all_notes,
          source_status, source_used, source_notes, source_confidence,
          verified_on_mistify, mistify_product_found, notes_source_type,
          inferred_classifications, inferred_seasons, inferred_occasions, inferred_intensity,
          season_scores, profile_scores, inference_reason, reviewed_by_admin, searchable_text,
          brand_name, brand_slug, original_fragrance_slug, mistify_product_slug,
          public_inspired_by_label, catalog_image_url, is_catalog_visible, catalog_sort_order,
          created_at, updated_at
        ) values (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30,
          $31, $32, $33, $34,
          now(), now()
        ) returning id`,
        [
          candidate.original_fragrance_name,
          candidate.shop_title,
          candidate.shop_url,
          null,
          candidate.source_brand_batch,
          candidate.classification,
          candidate.top_notes ? candidate.top_notes.split('|') : [],
          candidate.middle_notes ? candidate.middle_notes.split('|') : [],
          candidate.base_notes ? candidate.base_notes.split('|') : [],
          candidate.all_notes ? candidate.all_notes.split('|') : [],
          'verified_mistify_shop_import',
          'Mistify',
          `Mistify Shopify product feed: ${candidate.inspiration_text}`,
          'high',
          true,
          true,
          'mistify',
          [],
          [],
          [],
          null,
          {},
          {},
          'Imported from Mistify Shopify product feed after shop-only catalog sync review.',
          false,
          candidate.searchable_text,
          candidate.brand_name || null,
          candidate.brand_slug || null,
          candidate.original_fragrance_slug || null,
          candidate.mistify_product_slug || null,
          candidate.public_inspired_by_label || null,
          candidate.image_url,
          candidate.is_catalog_visible,
          0,
        ],
      )

      if (result.rowCount !== 1) {
        throw new Error(`Expected to insert one fragrance row for ${candidate.shop_title}; inserted ${result.rowCount}.`)
      }
      insertedCount += 1
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  return insertedCount
}

function writeReports(plan, mode, insertedRows, shopProductsFetched, inputRowsRead) {
  mkdirSync(outputDirectory, { recursive: true })

  const candidateHeaders = [
    'shop_title', 'shop_handle', 'shop_url', 'image_url', 'vendor', 'inspiration_text',
    'original_fragrance_name', 'source_brand_batch', 'classification', 'top_notes',
    'middle_notes', 'base_notes', 'all_notes', 'brand_name', 'brand_slug',
    'original_fragrance_slug', 'mistify_product_slug', 'public_inspired_by_label',
    'is_catalog_visible',
  ]

  writeFileSync(candidatesOutputPath, `${toCsv(candidateHeaders, plan.candidates)}\n`, 'utf8')
  writeFileSync(manualReviewOutputPath, `${toCsv([...candidateHeaders, 'review_reason'], plan.manualReviewRows)}\n`, 'utf8')
  writeFileSync(skippedOutputPath, `${toCsv([...candidateHeaders, 'reason'], plan.skippedRows)}\n`, 'utf8')
  writeFileSync(summaryOutputPath, `${JSON.stringify({
    mode,
    generatedAt: new Date().toISOString(),
    inputRowsRead,
    shopProductsFetched,
    candidatesEligibleForApply: plan.candidates.length,
    manualReviewRows: plan.manualReviewRows.length,
    skippedRows: plan.skippedRows.length,
    rowsInserted: insertedRows,
    reports: {
      candidates: candidatesOutputPath,
      manualReview: manualReviewOutputPath,
      skipped: skippedOutputPath,
    },
  }, null, 2)}\n`, 'utf8')
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in backend/.env or the environment.')
  }

  if (!existsSync(inputCsvPath)) {
    throw new Error(`Shop-only CSV not found at ${inputCsvPath}. Run npm run sync:mistify-catalog -- --dry-run first.`)
  }

  const { mode } = parseArgs()
  const inputRows = parseCsv(readFileSync(inputCsvPath, 'utf8'))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log('Mistify shop-only import starting.')
  console.log(`Mode: ${mode}.`)
  console.log(`Input: ${inputCsvPath}`)
  console.log('Fetching current Mistify Shopify product feed...')

  try {
    const products = await fetchAllMistifyShopProducts()
    const { rows: existingRows } = await pool.query(
      `select id, original_fragrance_name, source_brand_batch, mistify_product_name, mistify_product_url
       from fragrances`,
    )
    const plan = analyzeCandidates(inputRows, products, existingRows)
    const insertedRows = mode === 'apply' ? await insertCandidates(pool, plan.candidates) : 0

    writeReports(plan, mode, insertedRows, products.length, inputRows.length)

    console.log('Mistify shop-only import summary:')
    console.log(`- input rows read: ${inputRows.length}`)
    console.log(`- shop products fetched: ${products.length}`)
    console.log(`- candidates eligible for apply: ${plan.candidates.length}`)
    console.log(`- manual-review rows: ${plan.manualReviewRows.length}`)
    console.log(`- skipped rows: ${plan.skippedRows.length}`)
    console.log(`- rows inserted: ${insertedRows}`)
    console.log(`- summary report: ${summaryOutputPath}`)
    console.log(`- candidates report: ${candidatesOutputPath}`)
    console.log(`- manual review report: ${manualReviewOutputPath}`)
    console.log(`- skipped report: ${skippedOutputPath}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Mistify shop-only import failed.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
