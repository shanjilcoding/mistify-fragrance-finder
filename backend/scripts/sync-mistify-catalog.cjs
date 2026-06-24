require('dotenv/config')

const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Pool } = require('pg')

let buildCatalogFields = null
try {
  ;({ buildCatalogFields } = require('../dist/utils/catalogFields'))
} catch {
  // Product-name/URL apply mode needs this. Image-only mode does not.
}

const MISTIFY_BASE_URL = 'https://www.mistifyparfums.com'
const PRODUCTS_PAGE_SIZE = 250
const MAX_PRODUCT_PAGES = 20
const outputDirectory = join(process.cwd(), 'tmp')
const summaryOutputPath = join(outputDirectory, 'mistify-catalog-sync-summary.json')
const matchesOutputPath = join(outputDirectory, 'mistify-catalog-sync-matches.csv')
const manualReviewOutputPath = join(outputDirectory, 'mistify-catalog-sync-manual-review.csv')
const skippedOutputPath = join(outputDirectory, 'mistify-catalog-sync-skipped.csv')
const shopOnlyOutputPath = join(outputDirectory, 'mistify-catalog-sync-shop-only.csv')

const brandAliasMap = new Map([
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
  ['maison martin margiela replica', 'maison margiela'],
  ['maison martin margiela', 'maison margiela'],
  ['maison margiela', 'maison margiela'],
])

function parseArgs() {
  const args = process.argv.slice(2)
  const onlyFlagIndex = args.indexOf('--only')
  const scope = onlyFlagIndex >= 0 ? args[onlyFlagIndex + 1] : 'all'
  const isDryRun = args.includes('--dry-run')
  const isApply = args.includes('--apply')

  if (isDryRun && isApply) {
    throw new Error('Use either --dry-run or --apply, not both.')
  }

  if (!['all', 'images', 'products'].includes(scope)) {
    throw new Error('Invalid --only value. Use all, images, or products.')
  }

  return { mode: isApply ? 'apply' : 'dry-run', scope }
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

function normalizeUrl(value) {
  if (!value || !String(value).trim()) return ''

  try {
    const parsedUrl = new URL(String(value).trim())
    parsedUrl.hash = ''
    parsedUrl.search = ''
    return `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return String(value).trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function tokenOverlapScore(firstValue, secondValue) {
  const firstTokens = normalizeText(firstValue).split(' ').filter((token) => token.length >= 3)
  const secondTokens = new Set(normalizeText(secondValue).split(' ').filter((token) => token.length >= 3))

  if (!firstTokens.length || !secondTokens.size) return 0

  const matchedCount = firstTokens.filter((token) => secondTokens.has(token)).length
  return matchedCount / Math.max(firstTokens.length, secondTokens.size)
}

function normalizeBrandForMatch(value) {
  const normalizedBrand = normalizeText(value)
  return brandAliasMap.get(normalizedBrand) ?? normalizedBrand
}

function isPlaceholderProductName(value) {
  const normalizedValue = normalizeText(value)
  return !normalizedValue || normalizedValue === 'not verified' || normalizedValue === 'not verified on mistify'
}

function toMistifyProductUrl(handle) {
  return `${MISTIFY_BASE_URL}/products/${handle}`
}

function getMistifyProductHandleFromUrl(value) {
  if (!value || !String(value).trim()) return ''

  try {
    const parsedUrl = new URL(String(value).trim(), MISTIFY_BASE_URL)
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
    return pathParts[pathParts.length - 1] ?? ''
  } catch {
    return String(value).trim().replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop() ?? ''
  }
}

function extractInspirationText(value) {
  const text = stripHtml(value)
  const match = text.match(/(?:inspiration|inspired\s+by|impression\s+of|our\s+version\s+of)\s*:?\s*(.{0,180})/i)
  return match ? match[0].trim() : ''
}

async function fetchAllMistifyShopProducts() {
  const products = []

  for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
    const response = await fetch(`${MISTIFY_BASE_URL}/products.json?limit=${PRODUCTS_PAGE_SIZE}&page=${page}`, {
      headers: { 'user-agent': 'Mistify catalog sync (local admin)' },
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
        inspirationText: extractInspirationText(`${vendor} ${bodyHtml}`),
        bodyText: stripHtml(bodyHtml),
      })
    }
  }

  return products
}

function buildProductText(product) {
  return [product.title, product.handle, product.vendor, product.inspirationText, product.bodyText].join(' ')
}

function includesNormalizedPhrase(text, phrase) {
  return phrase !== '' && ` ${text} `.includes(` ${phrase} `)
}

function matchFragranceToShopProduct(fragrance, products, productsByHandle) {
  const currentHandle = getMistifyProductHandleFromUrl(fragrance.mistify_product_url)
  const handleMatch = currentHandle ? productsByHandle.get(currentHandle) : null

  if (handleMatch) {
    return {
      fragrance,
      product: handleMatch,
      matchType: 'url_handle',
      confidence: 'high',
      reason: 'Existing DB Mistify product URL handle matched Shopify product handle.',
    }
  }

  const normalizedMistifyName = normalizeText(fragrance.mistify_product_name)
  if (normalizedMistifyName && !isPlaceholderProductName(fragrance.mistify_product_name)) {
    const nameMatch = products.find((product) => normalizeText(product.title) === normalizedMistifyName)
    if (nameMatch) {
      return {
        fragrance,
        product: nameMatch,
        matchType: 'mistify_name',
        confidence: 'high',
        reason: 'Existing DB Mistify product name matched Shopify product title exactly.',
      }
    }
  }

  const normalizedOriginal = normalizeText(fragrance.original_fragrance_name)
  const normalizedBrand = normalizeBrandForMatch(fragrance.source_brand_batch)
  if (!normalizedOriginal) return null

  const best = products
    .map((product) => {
      const productText = normalizeText(buildProductText(product))
      const hasOriginalPhrase = includesNormalizedPhrase(productText, normalizedOriginal)
      const hasBrand = normalizedBrand !== '' && productText.includes(normalizedBrand)
      const overlapScore = tokenOverlapScore(normalizedOriginal, productText)
      const score = (hasOriginalPhrase ? 70 : 0) + (hasBrand ? 20 : 0) + overlapScore * 10
      return { product, hasOriginalPhrase, hasBrand, overlapScore, score }
    })
    .sort((first, second) => second.score - first.score)[0]

  if (!best || best.score < 35) return null

  if (best.hasOriginalPhrase && best.hasBrand) {
    return {
      fragrance,
      product: best.product,
      matchType: 'inspiration_original_brand',
      confidence: 'high',
      reason: 'Original fragrance name and brand appeared in Shopify product text.',
    }
  }

  if (best.hasOriginalPhrase || best.overlapScore >= 0.72) {
    return {
      fragrance,
      product: best.product,
      matchType: 'original_brand_fuzzy',
      confidence: best.hasOriginalPhrase ? 'medium' : 'low',
      reason: best.hasOriginalPhrase
        ? 'Original fragrance name appeared in Shopify product text, but brand support was unclear.'
        : `High token overlap with Shopify product text (${best.overlapScore.toFixed(2)}).`,
    }
  }

  return null
}

function didUrlChange(currentUrl, nextUrl) {
  return normalizeUrl(currentUrl) !== normalizeUrl(nextUrl)
}

function shouldUpdateImage(fragrance, product) {
  return Boolean(product.imageUrl) && fragrance.catalog_image_url !== product.imageUrl
}

function shouldUpdateProduct(fragrance, product) {
  return (
    isPlaceholderProductName(fragrance.mistify_product_name) ||
    !String(fragrance.mistify_product_url ?? '').trim() ||
    didUrlChange(fragrance.mistify_product_url, product.url)
  )
}

function getFieldsToUpdate(fragrance, product, scope) {
  const fields = []

  if ((scope === 'all' || scope === 'products') && shouldUpdateProduct(fragrance, product)) {
    if (fragrance.mistify_product_name !== product.title) fields.push('mistify_product_name')
    if (didUrlChange(fragrance.mistify_product_url, product.url)) fields.push('mistify_product_url')
  }

  if ((scope === 'all' || scope === 'images') && shouldUpdateImage(fragrance, product)) {
    fields.push('catalog_image_url')
  }

  return fields
}

function toMatchRow(fragrance, product, matchType, confidence, fieldsToUpdate, reason) {
  return {
    fragrance_id: fragrance.id,
    source_brand_batch: fragrance.source_brand_batch ?? '',
    original_fragrance_name: fragrance.original_fragrance_name ?? '',
    old_mistify_product_name: fragrance.mistify_product_name ?? '',
    old_mistify_product_url: fragrance.mistify_product_url ?? '',
    old_catalog_image_url: fragrance.catalog_image_url ?? '',
    new_mistify_product_name: product.title,
    new_mistify_product_url: product.url,
    new_catalog_image_url: product.imageUrl,
    shop_handle: product.handle,
    match_type: matchType,
    match_confidence: confidence,
    fields_to_update: fieldsToUpdate.join('|'),
    reason,
  }
}

function analyzeSyncPlan(fragrances, products, scope) {
  const productsByHandle = new Map(products.map((product) => [product.handle, product]))
  const matchedShopHandles = new Set()
  const matches = []
  const manualReviewRows = []
  const skippedRows = []
  const staleDbProductUrls = []

  for (const fragrance of fragrances) {
    const currentHandle = getMistifyProductHandleFromUrl(fragrance.mistify_product_url)
    const handleExists = currentHandle ? productsByHandle.has(currentHandle) : false
    const match = matchFragranceToShopProduct(fragrance, products, productsByHandle)

    if (!match) {
      skippedRows.push({
        fragrance_id: fragrance.id,
        source_brand_batch: fragrance.source_brand_batch ?? '',
        original_fragrance_name: fragrance.original_fragrance_name ?? '',
        mistify_product_name: fragrance.mistify_product_name ?? '',
        mistify_product_url: fragrance.mistify_product_url ?? '',
        reason: 'No Shopify product match found.',
      })
      if (currentHandle && !handleExists) staleDbProductUrls.push(fragrance)
      continue
    }

    matchedShopHandles.add(match.product.handle)
    if (currentHandle && !handleExists && match.matchType !== 'url_handle') staleDbProductUrls.push(fragrance)

    const fieldsToUpdate = getFieldsToUpdate(fragrance, match.product, scope)

    if (scope === 'images' && match.matchType !== 'url_handle' && fieldsToUpdate.length) {
      manualReviewRows.push({
        ...toMatchRow(fragrance, match.product, match.matchType, match.confidence, fieldsToUpdate, match.reason),
        review_reason: 'Image-only mode only applies existing DB product URL handle matches.',
      })
      continue
    }

    if (!fieldsToUpdate.length) {
      skippedRows.push({
        fragrance_id: fragrance.id,
        source_brand_batch: fragrance.source_brand_batch ?? '',
        original_fragrance_name: fragrance.original_fragrance_name ?? '',
        mistify_product_name: fragrance.mistify_product_name ?? '',
        mistify_product_url: fragrance.mistify_product_url ?? '',
        reason: 'Matched Shopify product, but no selected fields need updating.',
      })
      continue
    }

    const matchRow = toMatchRow(fragrance, match.product, match.matchType, match.confidence, fieldsToUpdate, match.reason)
    if (match.confidence === 'high') matches.push(matchRow)
    else manualReviewRows.push({ ...matchRow, review_reason: 'Match was not high-confidence; review before applying.' })
  }

  return {
    matches,
    manualReviewRows,
    skippedRows,
    staleDbProductUrls,
    shopProductsNotLinked: products.filter((product) => !matchedShopHandles.has(product.handle)),
  }
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

function writeReports(plan, products, fragrances, mode, scope, updatedRows) {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(matchesOutputPath, `${toCsv([
    'fragrance_id', 'source_brand_batch', 'original_fragrance_name', 'old_mistify_product_name',
    'old_mistify_product_url', 'old_catalog_image_url', 'new_mistify_product_name',
    'new_mistify_product_url', 'new_catalog_image_url', 'shop_handle', 'match_type',
    'match_confidence', 'fields_to_update', 'reason',
  ], plan.matches)}\n`, 'utf8')
  writeFileSync(manualReviewOutputPath, `${toCsv([
    'fragrance_id', 'source_brand_batch', 'original_fragrance_name', 'old_mistify_product_name',
    'old_mistify_product_url', 'old_catalog_image_url', 'new_mistify_product_name',
    'new_mistify_product_url', 'new_catalog_image_url', 'shop_handle', 'match_type',
    'match_confidence', 'fields_to_update', 'reason', 'review_reason',
  ], plan.manualReviewRows)}\n`, 'utf8')
  writeFileSync(skippedOutputPath, `${toCsv([
    'fragrance_id', 'source_brand_batch', 'original_fragrance_name',
    'mistify_product_name', 'mistify_product_url', 'reason',
  ], plan.skippedRows)}\n`, 'utf8')
  writeFileSync(shopOnlyOutputPath, `${toCsv([
    'shop_title', 'shop_handle', 'shop_url', 'image_url', 'vendor', 'inspiration_text',
  ], plan.shopProductsNotLinked.map((product) => ({
    shop_title: product.title,
    shop_handle: product.handle,
    shop_url: product.url,
    image_url: product.imageUrl,
    vendor: product.vendor,
    inspiration_text: product.inspirationText,
  })))}\n`, 'utf8')
  writeFileSync(summaryOutputPath, `${JSON.stringify({
    mode,
    scope,
    generatedAt: new Date().toISOString(),
    shopProductsFetched: products.length,
    dbFragrancesRead: fragrances.length,
    exactMatchesEligibleForApply: plan.matches.length,
    manualReviewRows: plan.manualReviewRows.length,
    skippedRows: plan.skippedRows.length,
    shopProductsNotLinked: plan.shopProductsNotLinked.length,
    staleDbProductUrls: plan.staleDbProductUrls.length,
    rowsUpdated: updatedRows,
    reports: {
      matches: matchesOutputPath,
      manualReview: manualReviewOutputPath,
      skipped: skippedOutputPath,
      shopOnly: shopOnlyOutputPath,
    },
  }, null, 2)}\n`, 'utf8')
}

function toCatalogSourceRow(row) {
  return {
    originalFragranceName: row.original_fragrance_name,
    mistifyProductName: row.mistify_product_name,
    mistifyProductUrl: row.mistify_product_url,
    sourceBrandBatch: row.source_brand_batch,
    classification: row.classification,
    audience: row.audience,
    allNotes: row.all_notes,
    verifiedOnMistify: row.verified_on_mistify,
    mistifyProductFound: row.mistify_product_found,
  }
}

async function recomputeCatalogFieldsForIds(client, ids) {
  if (!ids.length) return 0
  if (!buildCatalogFields) {
    throw new Error('Product-field apply mode requires existing dist/utils/catalogFields.js. Run npm run build on a larger machine or use --only images.')
  }

  const { rows } = await client.query(
    `select id, original_fragrance_name, mistify_product_name, mistify_product_url, source_brand_batch,
      classification, audience, all_notes, verified_on_mistify, mistify_product_found
     from fragrances where id = any($1::bigint[])`,
    [Array.from(new Set(ids))],
  )

  for (const row of rows) {
    const fields = buildCatalogFields(toCatalogSourceRow(row))
    await client.query(
      `update fragrances
       set brand_name = $1, brand_slug = $2, original_fragrance_slug = $3,
         mistify_product_slug = $4, public_inspired_by_label = $5,
         is_catalog_visible = $6, searchable_text = $7, updated_at = now()
       where id = $8`,
      [
        fields.brandName,
        fields.brandSlug,
        fields.originalFragranceSlug,
        fields.mistifyProductSlug,
        fields.publicInspiredByLabel,
        fields.isCatalogVisible,
        fields.searchableText,
        row.id,
      ],
    )
  }

  return rows.length
}

async function applyMatches(pool, matches) {
  if (!matches.length) return 0

  const client = await pool.connect()
  const productFieldUpdateIds = []
  let updatedCount = 0

  try {
    await client.query('begin')

    for (const match of matches) {
      const fieldsToUpdate = new Set(match.fields_to_update.split('|').filter(Boolean))
      const setClauses = []
      const values = []

      if (fieldsToUpdate.has('mistify_product_name')) {
        values.push(match.new_mistify_product_name)
        setClauses.push(`mistify_product_name = $${values.length}`)
      }

      if (fieldsToUpdate.has('mistify_product_url')) {
        values.push(match.new_mistify_product_url)
        setClauses.push(`mistify_product_url = $${values.length}`)
      }

      if (fieldsToUpdate.has('catalog_image_url')) {
        values.push(match.new_catalog_image_url)
        setClauses.push(`catalog_image_url = $${values.length}`)
      }

      setClauses.push('updated_at = now()')
      values.push(match.fragrance_id)

      const result = await client.query(
        `update fragrances set ${setClauses.join(', ')} where id = $${values.length} returning id`,
        values,
      )

      if (result.rowCount !== 1) {
        throw new Error(`Expected to update exactly one fragrance row for id ${match.fragrance_id}; updated ${result.rowCount}.`)
      }

      if (fieldsToUpdate.has('mistify_product_name') || fieldsToUpdate.has('mistify_product_url')) {
        productFieldUpdateIds.push(match.fragrance_id)
      }
      updatedCount += 1
    }

    const recomputedCount = await recomputeCatalogFieldsForIds(client, productFieldUpdateIds)
    if (recomputedCount) console.log(`- catalog fields recomputed for ${recomputedCount} rows`)

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  return updatedCount
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in backend/.env or the environment.')
  }

  const { mode, scope } = parseArgs()
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log('Mistify catalog sync starting.')
  console.log(`Mode: ${mode}.`)
  console.log(`Scope: ${scope}.`)
  console.log('Fetching Mistify Shopify product feed...')

  try {
    const products = await fetchAllMistifyShopProducts()
    const { rows: fragrances } = await pool.query(
      `select id, original_fragrance_name, source_brand_batch, mistify_product_name,
        mistify_product_url, catalog_image_url, audience, classification, all_notes,
        verified_on_mistify, mistify_product_found
       from fragrances`,
    )
    const plan = analyzeSyncPlan(fragrances, products, scope)
    const updatedRows = mode === 'apply' ? await applyMatches(pool, plan.matches) : 0

    writeReports(plan, products, fragrances, mode, scope, updatedRows)

    console.log('Mistify catalog sync summary:')
    console.log(`- shop products fetched: ${products.length}`)
    console.log(`- DB fragrances read: ${fragrances.length}`)
    console.log(`- high-confidence rows eligible for apply: ${plan.matches.length}`)
    console.log(`- manual-review rows: ${plan.manualReviewRows.length}`)
    console.log(`- skipped rows: ${plan.skippedRows.length}`)
    console.log(`- shop products not linked in DB: ${plan.shopProductsNotLinked.length}`)
    console.log(`- stale DB product URLs: ${plan.staleDbProductUrls.length}`)
    console.log(`- rows updated: ${updatedRows}`)
    console.log(`- summary report: ${summaryOutputPath}`)
    console.log(`- matches report: ${matchesOutputPath}`)
    console.log(`- manual review report: ${manualReviewOutputPath}`)
    console.log(`- skipped report: ${skippedOutputPath}`)
    console.log(`- shop-only report: ${shopOnlyOutputPath}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Mistify catalog sync failed.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
