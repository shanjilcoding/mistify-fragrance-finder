import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, pool } from '../db/connection'
import { fragrances } from '../db/schema'
import { buildCatalogFields } from '../utils/catalogFields'
import { toCsv } from '../utils/csv'
import {
  didUrlChange,
  indexProductsByHandle,
  isPlaceholderProductName,
  matchFragranceToShopProduct,
  type CatalogMatchInput,
} from '../utils/fragranceCatalogMatching'
import {
  fetchAllMistifyShopProducts,
  getMistifyProductHandleFromUrl,
  type MistifyShopProduct,
} from '../utils/mistifyShopify'

const outputDirectory = join(process.cwd(), 'tmp')
const summaryOutputPath = join(outputDirectory, 'mistify-catalog-sync-summary.json')
const matchesOutputPath = join(outputDirectory, 'mistify-catalog-sync-matches.csv')
const manualReviewOutputPath = join(outputDirectory, 'mistify-catalog-sync-manual-review.csv')
const skippedOutputPath = join(outputDirectory, 'mistify-catalog-sync-skipped.csv')

type SyncScope = 'all' | 'images' | 'products'

type CandidateFragrance = CatalogMatchInput & {
  catalogImageUrl: string | null
  audience: string | null
}

type SyncMatchRow = {
  fragrance_id: number
  source_brand_batch: string
  original_fragrance_name: string
  old_mistify_product_name: string
  old_mistify_product_url: string
  old_catalog_image_url: string
  new_mistify_product_name: string
  new_mistify_product_url: string
  new_catalog_image_url: string
  shop_handle: string
  match_type: string
  match_confidence: string
  fields_to_update: string
  reason: string
}

type ReviewRow = SyncMatchRow & {
  review_reason: string
}

type SkippedRow = {
  fragrance_id: number | string
  source_brand_batch: string
  original_fragrance_name: string
  mistify_product_name: string
  mistify_product_url: string
  reason: string
}

type SyncPlan = {
  matches: SyncMatchRow[]
  manualReviewRows: ReviewRow[]
  skippedRows: SkippedRow[]
  shopProductsNotLinked: MistifyShopProduct[]
  staleDbProductUrls: CandidateFragrance[]
}

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

  return {
    mode: isApply ? 'apply' as const : 'dry-run' as const,
    scope: scope as SyncScope,
  }
}

function hasBlankValue(value: string | null | undefined) {
  return !value?.trim()
}

function shouldUpdateImage(fragrance: CandidateFragrance, product: MistifyShopProduct) {
  return Boolean(product.imageUrl) && fragrance.catalogImageUrl !== product.imageUrl
}

function shouldUpdateProduct(fragrance: CandidateFragrance, product: MistifyShopProduct) {
  return (
    isPlaceholderProductName(fragrance.mistifyProductName) ||
    hasBlankValue(fragrance.mistifyProductUrl) ||
    didUrlChange(fragrance.mistifyProductUrl, product.url)
  )
}

function getFieldsToUpdate(
  fragrance: CandidateFragrance,
  product: MistifyShopProduct,
  scope: SyncScope,
) {
  const fields: string[] = []

  if ((scope === 'all' || scope === 'products') && shouldUpdateProduct(fragrance, product)) {
    if (fragrance.mistifyProductName !== product.title) {
      fields.push('mistify_product_name')
    }

    if (didUrlChange(fragrance.mistifyProductUrl, product.url)) {
      fields.push('mistify_product_url')
    }
  }

  if ((scope === 'all' || scope === 'images') && shouldUpdateImage(fragrance, product)) {
    fields.push('catalog_image_url')
  }

  return fields
}

async function fetchCandidateFragrances() {
  return db
    .select({
      id: fragrances.id,
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
      catalogImageUrl: fragrances.catalogImageUrl,
      audience: fragrances.audience,
    })
    .from(fragrances)
}

function toMatchRow(
  fragrance: CandidateFragrance,
  product: MistifyShopProduct,
  matchType: string,
  confidence: string,
  fieldsToUpdate: string[],
  reason: string,
): SyncMatchRow {
  return {
    fragrance_id: fragrance.id,
    source_brand_batch: fragrance.sourceBrandBatch ?? '',
    original_fragrance_name: fragrance.originalFragranceName ?? '',
    old_mistify_product_name: fragrance.mistifyProductName ?? '',
    old_mistify_product_url: fragrance.mistifyProductUrl ?? '',
    old_catalog_image_url: fragrance.catalogImageUrl ?? '',
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

function analyzeSyncPlan(
  fragrancesToSync: CandidateFragrance[],
  products: MistifyShopProduct[],
  scope: SyncScope,
): SyncPlan {
  const productsByHandle = indexProductsByHandle(products)
  const matchedShopHandles = new Set<string>()
  const matches: SyncMatchRow[] = []
  const manualReviewRows: ReviewRow[] = []
  const skippedRows: SkippedRow[] = []
  const staleDbProductUrls: CandidateFragrance[] = []

  for (const fragrance of fragrancesToSync) {
    const currentHandle = getMistifyProductHandleFromUrl(fragrance.mistifyProductUrl)
    const handleExists = currentHandle ? productsByHandle.has(currentHandle) : false
    const match = matchFragranceToShopProduct(fragrance, products, productsByHandle)

    if (!match) {
      skippedRows.push({
        fragrance_id: fragrance.id,
        source_brand_batch: fragrance.sourceBrandBatch ?? '',
        original_fragrance_name: fragrance.originalFragranceName ?? '',
        mistify_product_name: fragrance.mistifyProductName ?? '',
        mistify_product_url: fragrance.mistifyProductUrl ?? '',
        reason: 'No Shopify product match found.',
      })

      if (currentHandle && !handleExists) {
        staleDbProductUrls.push(fragrance)
      }

      continue
    }

    matchedShopHandles.add(match.product.handle)

    if (currentHandle && !handleExists && match.matchType !== 'url_handle') {
      staleDbProductUrls.push(fragrance)
    }

    const fieldsToUpdate = getFieldsToUpdate(fragrance, match.product, scope)

    if (scope === 'images' && match.matchType !== 'url_handle' && fieldsToUpdate.length) {
      manualReviewRows.push({
        ...toMatchRow(
          fragrance,
          match.product,
          match.matchType,
          match.confidence,
          fieldsToUpdate,
          match.reason,
        ),
        review_reason: 'Image-only mode only applies existing DB product URL handle matches.',
      })
      continue
    }

    if (!fieldsToUpdate.length) {
      skippedRows.push({
        fragrance_id: fragrance.id,
        source_brand_batch: fragrance.sourceBrandBatch ?? '',
        original_fragrance_name: fragrance.originalFragranceName ?? '',
        mistify_product_name: fragrance.mistifyProductName ?? '',
        mistify_product_url: fragrance.mistifyProductUrl ?? '',
        reason: 'Matched Shopify product, but no selected fields need updating.',
      })
      continue
    }

    const matchRow = toMatchRow(
      fragrance,
      match.product,
      match.matchType,
      match.confidence,
      fieldsToUpdate,
      match.reason,
    )

    if (match.confidence === 'high') {
      matches.push(matchRow)
    } else {
      manualReviewRows.push({
        ...matchRow,
        review_reason: 'Match was not high-confidence; review before applying.',
      })
    }
  }

  return {
    matches,
    manualReviewRows,
    skippedRows,
    staleDbProductUrls,
    shopProductsNotLinked: products.filter((product) => !matchedShopHandles.has(product.handle)),
  }
}

function writeReports(plan: SyncPlan, products: MistifyShopProduct[], fragrancesToSync: CandidateFragrance[], mode: 'dry-run' | 'apply', scope: SyncScope, updatedRows = 0) {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(
    matchesOutputPath,
    `${toCsv<SyncMatchRow>([
      'fragrance_id',
      'source_brand_batch',
      'original_fragrance_name',
      'old_mistify_product_name',
      'old_mistify_product_url',
      'old_catalog_image_url',
      'new_mistify_product_name',
      'new_mistify_product_url',
      'new_catalog_image_url',
      'shop_handle',
      'match_type',
      'match_confidence',
      'fields_to_update',
      'reason',
    ], plan.matches)}\n`,
    'utf8',
  )
  writeFileSync(
    manualReviewOutputPath,
    `${toCsv<ReviewRow>([
      'fragrance_id',
      'source_brand_batch',
      'original_fragrance_name',
      'old_mistify_product_name',
      'old_mistify_product_url',
      'old_catalog_image_url',
      'new_mistify_product_name',
      'new_mistify_product_url',
      'new_catalog_image_url',
      'shop_handle',
      'match_type',
      'match_confidence',
      'fields_to_update',
      'reason',
      'review_reason',
    ], plan.manualReviewRows)}\n`,
    'utf8',
  )
  writeFileSync(
    skippedOutputPath,
    `${toCsv<SkippedRow>([
      'fragrance_id',
      'source_brand_batch',
      'original_fragrance_name',
      'mistify_product_name',
      'mistify_product_url',
      'reason',
    ], plan.skippedRows)}\n`,
    'utf8',
  )
  writeFileSync(
    summaryOutputPath,
    `${JSON.stringify({
      mode,
      scope,
      generatedAt: new Date().toISOString(),
      shopProductsFetched: products.length,
      dbFragrancesRead: fragrancesToSync.length,
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
      },
    }, null, 2)}\n`,
    'utf8',
  )
}

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

async function applyMatches(matches: SyncMatchRow[]) {
  if (!matches.length) {
    return 0
  }

  let updatedCount = 0
  const productFieldUpdateIds: number[] = []

  await db.transaction(async (transaction) => {
    for (const match of matches) {
      const fieldsToUpdate = new Set(match.fields_to_update.split('|').filter(Boolean))
      const updateValues = {
        ...(fieldsToUpdate.has('mistify_product_name')
          ? { mistifyProductName: match.new_mistify_product_name }
          : {}),
        ...(fieldsToUpdate.has('mistify_product_url')
          ? { mistifyProductUrl: match.new_mistify_product_url }
          : {}),
        ...(fieldsToUpdate.has('catalog_image_url')
          ? { catalogImageUrl: match.new_catalog_image_url }
          : {}),
        updatedAt: new Date(),
      }

      const updatedRows = await transaction
        .update(fragrances)
        .set(updateValues)
        .where(
          and(
            eq(fragrances.id, match.fragrance_id),
            fieldsToUpdate.has('mistify_product_name')
              ? or(
                  isNull(fragrances.mistifyProductName),
                  sql`trim(${fragrances.mistifyProductName}) = ''`,
                  sql`lower(trim(${fragrances.mistifyProductName})) in ('not verified', 'not verified on mistify')`,
                )
              : sql`true`,
          ),
        )
        .returning({ id: fragrances.id })

      if (updatedRows.length !== 1) {
        throw new Error(
          `Expected to update exactly one fragrance row for id ${match.fragrance_id}; updated ${updatedRows.length}.`,
        )
      }

      if (fieldsToUpdate.has('mistify_product_name') || fieldsToUpdate.has('mistify_product_url')) {
        productFieldUpdateIds.push(match.fragrance_id)
      }

      updatedCount += 1
    }
  })

  if (productFieldUpdateIds.length) {
    const recomputedCount = await recomputeCatalogFieldsForIds(productFieldUpdateIds)
    console.log(`- catalog fields recomputed for ${recomputedCount} rows`)
  }

  return updatedCount
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in the backend environment.')
  }

  const { mode, scope } = parseArgs()

  console.log('Mistify catalog sync starting.')
  console.log(`Mode: ${mode}.`)
  console.log(`Scope: ${scope}.`)
  console.log('Fetching Mistify Shopify product feed...')

  const products = await fetchAllMistifyShopProducts()
  const fragrancesToSync = await fetchCandidateFragrances()
  const plan = analyzeSyncPlan(fragrancesToSync, products, scope)
  const updatedRows = mode === 'apply' ? await applyMatches(plan.matches) : 0

  writeReports(plan, products, fragrancesToSync, mode, scope, updatedRows)

  console.log('Mistify catalog sync summary:')
  console.log(`- shop products fetched: ${products.length}`)
  console.log(`- DB fragrances read: ${fragrancesToSync.length}`)
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
}

main()
  .catch((error) => {
    console.error('Mistify catalog sync failed.')
    console.error(error instanceof Error ? error.message : 'Unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
