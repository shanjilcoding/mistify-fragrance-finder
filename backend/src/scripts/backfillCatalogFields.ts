import { eq } from 'drizzle-orm'
import { db, pool } from '../db/connection'
import { fragrances } from '../db/schema'
import { buildCatalogFields } from '../utils/catalogFields'

// Backfills the public catalog columns (brandName, brandSlug,
// originalFragranceSlug, mistifyProductSlug, publicInspiredByLabel,
// isCatalogVisible, searchableText) for every existing fragrance row using the
// same derivation logic the import/update scripts use. Run this once after
// applying sql/addCatalogFields.sql, and again after bulk data updates.
async function backfillCatalogFields() {
  console.log('Starting catalog field backfill...')

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

  let updatedCount = 0
  let visibleCount = 0
  let errorCount = 0

  for (const row of rows) {
    try {
      const catalogFields = buildCatalogFields(row)

      await db
        .update(fragrances)
        .set({
          ...catalogFields,
          updatedAt: new Date(),
        })
        .where(eq(fragrances.id, row.id))

      updatedCount += 1

      if (catalogFields.isCatalogVisible) {
        visibleCount += 1
      }
    } catch (error) {
      errorCount += 1
      console.error(`Failed to backfill fragrance id ${row.id}.`, error)
    }
  }

  console.log(`Processed ${rows.length} fragrance records.`)
  console.log(`Updated ${updatedCount} fragrance records.`)
  console.log(`Marked ${visibleCount} fragrance records as catalog-visible.`)
  console.log(`Encountered ${errorCount} backfill errors.`)
  console.log('Catalog field backfill finished.')
}

async function main() {
  try {
    await backfillCatalogFields()
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Catalog field backfill failed.')
    console.error(error)
    await pool.end()
    process.exit(1)
  }
}

void main()
