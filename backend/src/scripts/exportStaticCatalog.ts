import 'dotenv/config'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { db, pool } from '../db/connection'
import { type Fragrance, fragrances } from '../db/schema'
import {
  buildFragranceSlug,
  toCatalogFragrance,
  type CatalogFragrance,
} from '../utils/catalogMappers'
import { findSimilarFragrances } from '../utils/fragranceSimilarity'

const SIMILAR_LIMIT = 6

type CatalogFragranceWithSearch = CatalogFragrance & {
  searchableText: string
  createdAt: string | null
}

type CatalogBrandExport = {
  brandName: string
  brandSlug: string
  fragranceCount: number
  searchableText: string
}

type CatalogManifest = {
  generatedAt: string
  fragranceCount: number
  brandCount: number
  files: {
    fragrancesIndex: string
    brandsIndex: string
    brandDirectory: string
    fragranceDirectory: string
    similarDirectory: string
  }
}

function getDefaultOutputDirectory() {
  return resolve(process.cwd(), '..', 'apps', 'catalog-web', 'public', 'data')
}

const outputDirectory = resolve(
  process.env.CATALOG_EXPORT_DIR?.trim() || getDefaultOutputDirectory(),
)
const brandsDirectory = join(outputDirectory, 'brands')
const fragrancesDirectory = join(outputDirectory, 'fragrances')
const similarDirectory = join(outputDirectory, 'similar')

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function resetOutputDirectories() {
  mkdirSync(outputDirectory, { recursive: true })

  for (const directory of [brandsDirectory, fragrancesDirectory, similarDirectory]) {
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
  }
}

function toStaticCatalogFragrance(row: Fragrance): CatalogFragranceWithSearch {
  return {
    ...toCatalogFragrance(row),
    searchableText: row.searchableText ?? '',
    createdAt: row.createdAt?.toISOString() ?? null,
  }
}

function buildBrandExports(fragranceRows: Fragrance[]): CatalogBrandExport[] {
  const brands = new Map<string, CatalogBrandExport>()

  for (const row of fragranceRows) {
    const brandName = row.brandName?.trim()
    const brandSlug = row.brandSlug?.trim().toLowerCase()

    if (!brandName || !brandSlug) {
      continue
    }

    const existing = brands.get(brandSlug)
    const searchableText = [
      row.originalFragranceName,
      row.mistifyProductName,
      row.publicInspiredByLabel,
      row.searchableText,
    ]
      .filter(Boolean)
      .join(' ')

    if (existing) {
      existing.fragranceCount += 1
      existing.searchableText = `${existing.searchableText} ${searchableText}`.trim()
    } else {
      brands.set(brandSlug, {
        brandName,
        brandSlug,
        fragranceCount: 1,
        searchableText,
      })
    }
  }

  return [...brands.values()].sort((first, second) =>
    first.brandName.localeCompare(second.brandName),
  )
}

async function fetchVisibleCatalogRows() {
  return db
    .select()
    .from(fragrances)
    .where(eq(fragrances.isCatalogVisible, true))
    .orderBy(
      asc(fragrances.brandName),
      asc(fragrances.catalogSortOrder),
      asc(fragrances.originalFragranceName),
      asc(fragrances.id),
    )
}

async function exportStaticCatalog() {
  const generatedAt = new Date().toISOString()
  const rows = await fetchVisibleCatalogRows()
  const fragranceIndex = rows.map(toStaticCatalogFragrance)
  const brandsIndex = buildBrandExports(rows)
  const rowsByBrand = new Map<string, Fragrance[]>()

  resetOutputDirectories()

  for (const row of rows) {
    const fragranceSlug = buildFragranceSlug(row)
    const brandSlug = row.brandSlug?.trim().toLowerCase()

    writeJson(join(fragrancesDirectory, `${fragranceSlug}.json`), {
      fragrance: toStaticCatalogFragrance(row),
    })

    const similar = findSimilarFragrances(
      row,
      rows.filter((candidate) => candidate.id !== row.id),
      SIMILAR_LIMIT,
    ).map((scored) => ({
      ...toStaticCatalogFragrance(scored.fragrance),
      sharedNotes: scored.sharedNotes,
    }))

    writeJson(join(similarDirectory, `${fragranceSlug}.json`), {
      fragrances: similar,
    })

    if (brandSlug) {
      const existingRows = rowsByBrand.get(brandSlug) ?? []
      existingRows.push(row)
      rowsByBrand.set(brandSlug, existingRows)
    }
  }

  for (const brand of brandsIndex) {
    const brandRows = rowsByBrand.get(brand.brandSlug) ?? []

    writeJson(join(brandsDirectory, `${brand.brandSlug}.json`), {
      brand,
      fragrances: brandRows.map(toStaticCatalogFragrance),
    })
  }

  const manifest: CatalogManifest = {
    generatedAt,
    fragranceCount: fragranceIndex.length,
    brandCount: brandsIndex.length,
    files: {
      fragrancesIndex: '/data/fragrances-index.json',
      brandsIndex: '/data/brands-index.json',
      brandDirectory: '/data/brands',
      fragranceDirectory: '/data/fragrances',
      similarDirectory: '/data/similar',
    },
  }

  writeJson(join(outputDirectory, 'catalog-manifest.json'), manifest)
  writeJson(join(outputDirectory, 'fragrances-index.json'), {
    fragrances: fragranceIndex,
    pagination: {
      page: 1,
      pageSize: fragranceIndex.length,
      total: fragranceIndex.length,
      totalPages: 1,
    },
  })
  writeJson(join(outputDirectory, 'brands-index.json'), { brands: brandsIndex })

  console.log(
    `[catalog-export] wrote ${fragranceIndex.length} fragrances and ${brandsIndex.length} brands to ${outputDirectory}`,
  )
}

exportStaticCatalog()
  .catch((error) => {
    console.error('[catalog-export] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
