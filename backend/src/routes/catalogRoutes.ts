import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db } from '../db/connection'
import { fragrances } from '../db/schema'
import {
  parseFragranceIdFromSlug,
  toCatalogFragrance,
} from '../utils/catalogMappers'
import { findSimilarFragrances } from '../utils/fragranceSimilarity'

const catalogRouter = Router()
const catalogLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many catalog requests. Please wait a moment and try again.',
  },
})

catalogRouter.use(catalogLimiter)

const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60
const SIMILAR_LIMIT = 6

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : ''
  }

  return typeof value === 'string' ? value.trim() : ''
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function buildFragranceFilters(query: Record<string, unknown>): SQL[] {
  const conditions: SQL[] = [eq(fragrances.isCatalogVisible, true)]
  const q = firstQueryValue(query.q)
  const brand = firstQueryValue(query.brand)
  const note = firstQueryValue(query.note)
  const audience = firstQueryValue(query.audience)
  const classification = firstQueryValue(query.classification)

  if (q) {
    conditions.push(ilike(fragrances.searchableText, `%${q}%`))
  }

  if (brand) {
    conditions.push(eq(fragrances.brandSlug, brand.toLowerCase()))
  }

  if (note) {
    conditions.push(
      sql`exists (select 1 from unnest(${fragrances.allNotes}) as note where lower(note) = ${note.toLowerCase()})`,
    )
  }

  if (audience) {
    conditions.push(ilike(fragrances.audience, audience))
  }

  if (classification) {
    conditions.push(ilike(fragrances.classification, `%${classification}%`))
  }

  return conditions
}

function buildSortOrder(sort: string) {
  if (sort === 'name') {
    return [asc(fragrances.originalFragranceName), asc(fragrances.id)]
  }

  if (sort === 'newest') {
    return [desc(fragrances.createdAt), asc(fragrances.id)]
  }

  // Default: Brand A-Z, then catalog sort order, then original fragrance A-Z.
  return [
    asc(fragrances.brandName),
    asc(fragrances.catalogSortOrder),
    asc(fragrances.originalFragranceName),
    asc(fragrances.id),
  ]
}

catalogRouter.get('/fragrances', async (req, res, next) => {
  try {
    const conditions = buildFragranceFilters(req.query as Record<string, unknown>)
    const page = parsePositiveInt(firstQueryValue(req.query.page), 1)
    const pageSize = Math.min(
      parsePositiveInt(firstQueryValue(req.query.pageSize), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    )
    const whereClause = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(fragrances)
      .where(whereClause)

    const rows = await db
      .select()
      .from(fragrances)
      .where(whereClause)
      .orderBy(...buildSortOrder(firstQueryValue(req.query.sort)))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    res.json({
      fragrances: rows.map(toCatalogFragrance),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/fragrances/:fragranceSlug/similar', async (req, res, next) => {
  try {
    const fragranceId = parseFragranceIdFromSlug(req.params.fragranceSlug)

    if (!fragranceId) {
      res.status(404).json({ error: 'Fragrance not found.' })
      return
    }

    const [source] = await db
      .select()
      .from(fragrances)
      .where(
        and(
          eq(fragrances.id, fragranceId),
          eq(fragrances.isCatalogVisible, true),
        ),
      )
      .limit(1)

    if (!source) {
      res.status(404).json({ error: 'Fragrance not found.' })
      return
    }

    const candidates = await db
      .select()
      .from(fragrances)
      .where(
        and(
          sql`${fragrances.id} <> ${fragranceId}`,
          eq(fragrances.isCatalogVisible, true),
        ),
      )

    const similar = findSimilarFragrances(source, candidates, SIMILAR_LIMIT)

    res.json({
      fragrances: similar.map((scored) => ({
        ...toCatalogFragrance(scored.fragrance),
        sharedNotes: scored.sharedNotes,
      })),
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/fragrances/:fragranceSlug', async (req, res, next) => {
  try {
    const fragranceId = parseFragranceIdFromSlug(req.params.fragranceSlug)

    if (!fragranceId) {
      res.status(404).json({ error: 'Fragrance not found.' })
      return
    }

    const [row] = await db
      .select()
      .from(fragrances)
      .where(
        and(
          eq(fragrances.id, fragranceId),
          eq(fragrances.isCatalogVisible, true),
        ),
      )
      .limit(1)

    if (!row) {
      res.status(404).json({ error: 'Fragrance not found.' })
      return
    }

    res.json({ fragrance: toCatalogFragrance(row) })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/brands', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        brandName: fragrances.brandName,
        brandSlug: fragrances.brandSlug,
        fragranceCount: count(),
        searchableText: sql<string>`string_agg(concat_ws(' ', ${fragrances.originalFragranceName}, ${fragrances.mistifyProductName}, ${fragrances.publicInspiredByLabel}), ' ')`,
      })
      .from(fragrances)
      .where(
        and(
          eq(fragrances.isCatalogVisible, true),
          isNotNull(fragrances.brandSlug),
          isNotNull(fragrances.brandName),
        ),
      )
      .groupBy(fragrances.brandName, fragrances.brandSlug)
      .orderBy(asc(fragrances.brandName))

    res.json({
      brands: rows.map((row) => ({
        brandName: row.brandName ?? '',
        brandSlug: row.brandSlug ?? '',
        fragranceCount: Number(row.fragranceCount),
        searchableText: row.searchableText ?? '',
      })),
    })
  } catch (error) {
    next(error)
  }
})

catalogRouter.get('/brands/:brandSlug', async (req, res, next) => {
  try {
    const brandSlug = req.params.brandSlug.trim().toLowerCase()

    const rows = await db
      .select()
      .from(fragrances)
      .where(
        and(
          eq(fragrances.brandSlug, brandSlug),
          eq(fragrances.isCatalogVisible, true),
        ),
      )
      .orderBy(
        asc(fragrances.catalogSortOrder),
        asc(fragrances.originalFragranceName),
        asc(fragrances.id),
      )

    if (!rows.length) {
      res.status(404).json({ error: 'Brand not found.' })
      return
    }

    res.json({
      brand: {
        brandName: rows[0].brandName ?? '',
        brandSlug,
        fragranceCount: rows.length,
      },
      fragrances: rows.map(toCatalogFragrance),
    })
  } catch (error) {
    next(error)
  }
})

export default catalogRouter
