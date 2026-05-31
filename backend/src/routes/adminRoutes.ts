import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/connection'
import { allowedOrigins } from '../utils/env'
import {
  adminAuditLogs,
  adminSessions,
  curatedChipFragrances,
  curatedChips,
  fragrances,
  genericPromptChips,
} from '../db/schema'

const adminRouter = Router()
const tokenTtlMs = 8 * 60 * 60 * 1000
const maxPageSize = 50
const maxActiveGenericPromptChips = 30
const maxActiveCuratedChips = 8
const maxCuratedChipFragrances = 25

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin login attempts. Please wait and try again.',
  },
})

const adminRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin requests. Please wait a moment and try again.',
  },
})

const adminProductsGetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin product requests. Please wait a moment and try again.',
  },
})

const adminProductsPatchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin product updates. Please wait a moment and try again.',
  },
})

const placeholderProductNames = [
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
]
const placeholderProductNameSql = sql.join(
  placeholderProductNames.map((name) => sql`${name}`),
  sql`, `,
)

const loginSchema = z.object({
  username: z.string().trim().max(100).optional(),
  password: z.string().min(1).max(200),
})

const productQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  missingProductName: z.enum(['true', 'false']).optional(),
  missingProductUrl: z.enum(['true', 'false']).optional(),
  sourceBrandBatch: z.string().trim().max(100).optional(),
  classification: z.string().trim().max(100).optional(),
  verifiedOnMistify: z.enum(['true', 'false']).optional(),
  sourceStatus: z.string().trim().max(100).optional(),
  sortBy: z
    .enum([
      'originalFragranceName',
      'sourceBrandBatch',
      'mistifyProductName',
      'classification',
    ])
    .optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(maxPageSize).optional(),
})

const updateProductSchema = z
  .object({
    mistifyProductName: z.string().trim().max(100).optional(),
    mistifyProductUrl: z.string().trim().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.mistifyProductUrl === undefined ||
      data.mistifyProductUrl === '' ||
      z.string().url().safeParse(data.mistifyProductUrl).success,
    {
      message: 'Mistify product URL must be a valid URL.',
      path: ['mistifyProductUrl'],
    },
  )

const chipBodySchema = z.object({
  label: z.string().trim().min(1, 'Label is required.').max(80, 'Label must be 80 characters or fewer.'),
  description: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative.').optional(),
}).strict()

const chipPatchSchema = chipBodySchema.partial().strict()

const genericPromptChipBodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(240),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative.').optional(),
})

const genericPromptChipPatchSchema = genericPromptChipBodySchema.partial().strict()

const bulkGenericPromptChipSchema = z.object({
  chips: z.array(genericPromptChipBodySchema).min(1).max(maxActiveGenericPromptChips),
})

const genericPromptChipReorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.coerce.number().int().positive(),
        sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative.'),
      }),
    )
    .min(1)
    .max(100),
})

const chipFragranceBodySchema = z.object({
  fragranceId: z.coerce.number().int().positive(),
  sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative.').optional(),
  adminNote: z.string().trim().max(200).optional().nullable(),
})

const chipFragrancePatchSchema = z
  .object({
    sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative.').optional(),
    adminNote: z.string().trim().max(200).optional().nullable(),
  })
  .strict()

const fragranceSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
})

function safeStringCompare(input: string, expected: string) {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)

  if (inputBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(inputBuffer, expectedBuffer)
}

function hashAdminToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function getClientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || null
}

async function createAdminToken(req: Request) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + tokenTtlMs)
  const [session] = await db
    .insert(adminSessions)
    .values({
      tokenHash: hashAdminToken(token),
      expiresAt,
      lastUsedAt: new Date(),
      ipAddress: getClientIp(req),
      userAgent: req.header('user-agent') ?? null,
    })
    .returning()

  return { token, session }
}

function getAdminBearerToken(req: Request) {
  const header = req.header('authorization')
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

async function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getAdminBearerToken(req)
    const tokenHash = token ? hashAdminToken(token) : ''
    const [session] = tokenHash
      ? await db
          .select()
          .from(adminSessions)
          .where(eq(adminSessions.tokenHash, tokenHash))
          .limit(1)
      : []

    if (!token || !session || session.revokedAt || session.expiresAt <= new Date()) {
      if (session && !session.revokedAt) {
        await db
          .update(adminSessions)
          .set({ revokedAt: new Date() })
          .where(eq(adminSessions.id, session.id))
      }

      res.status(401).json({ error: 'Admin authorization is required.' })
      return
    }

    res.locals.adminSessionId = session.id
    await db
      .update(adminSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(adminSessions.id, session.id))
    next()
  } catch (error) {
    next(error)
  }
}

function getOriginFromUrl(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function requireAllowedAdminOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.header('origin')
  const refererOrigin = getOriginFromUrl(req.header('referer') ?? '')

  if (
    (origin && !allowedOrigins.has(origin)) ||
    (!origin && refererOrigin && !allowedOrigins.has(refererOrigin))
  ) {
    res.status(403).json({ error: 'Admin request origin is not allowed.' })
    return
  }

  next()
}

type AdminAuditDetails = {
  action: string
  entityType: string
  entityId?: string | number
  summary: string
  requestJson?: Record<string, unknown>
}

async function writeAdminAuditLog(req: Request, res: Response, details: AdminAuditDetails) {
  try {
    await db.insert(adminAuditLogs).values({
      sessionId: typeof res.locals.adminSessionId === 'number' ? res.locals.adminSessionId : null,
      action: details.action,
      entityType: details.entityType,
      entityId: details.entityId === undefined ? null : String(details.entityId),
      summary: details.summary,
      requestJson: details.requestJson ?? null,
      ipAddress: getClientIp(req),
      userAgent: req.header('user-agent') ?? null,
    })
  } catch (error) {
    console.warn('[admin] audit log write failed', error)
  }
}

function auditRequestBody(req: Request) {
  return typeof req.body === 'object' && req.body !== null
    ? (req.body as Record<string, unknown>)
    : undefined
}

function toAdminProduct(row: typeof fragrances.$inferSelect) {
  const trimmedProductName = row.mistifyProductName?.trim() ?? ''
  const displayProductName = placeholderProductNames.includes(
    trimmedProductName.toLowerCase(),
  )
    ? null
    : row.mistifyProductName

  return {
    id: row.id,
    originalFragranceName: row.originalFragranceName,
    sourceBrandBatch: row.sourceBrandBatch,
    classification: row.classification,
    mistifyProductName: displayProductName,
    mistifyProductUrl: row.mistifyProductUrl,
    verifiedOnMistify: row.verifiedOnMistify,
    sourceStatus: row.sourceStatus,
    topNotes: row.topNotes ?? [],
    middleNotes: row.middleNotes ?? [],
    baseNotes: row.baseNotes ?? [],
    allNotes: row.allNotes ?? [],
  }
}

function toAdminChip(row: typeof curatedChips.$inferSelect, selectedCount = 0) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    isActive: row.isActive ?? true,
    sortOrder: row.sortOrder ?? 0,
    selectedFragranceCount: selectedCount,
  }
}

function toAdminGenericPromptChip(row: typeof genericPromptChips.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    prompt: row.prompt,
    isActive: row.isActive ?? true,
    sortOrder: row.sortOrder ?? 0,
  }
}

function toAdminChipFragrance(
  row: typeof curatedChipFragrances.$inferSelect,
  fragrance: typeof fragrances.$inferSelect,
) {
  return {
    id: row.id,
    chipId: row.chipId,
    fragranceId: row.fragranceId,
    sortOrder: row.sortOrder ?? 0,
    adminNote: row.adminNote,
    fragrance: toAdminProduct(fragrance),
  }
}

async function getActiveGenericPromptChipCount(excludeId?: number) {
  const filters = [eq(genericPromptChips.isActive, true)]

  if (excludeId) {
    filters.push(sql`${genericPromptChips.id} <> ${excludeId}`)
  }

  const [result] = await db
    .select({ value: count() })
    .from(genericPromptChips)
    .where(and(...filters))

  return result?.value ?? 0
}

async function getActiveCuratedChipCount(excludeId?: number) {
  const filters = [eq(curatedChips.isActive, true)]

  if (excludeId) {
    filters.push(sql`${curatedChips.id} <> ${excludeId}`)
  }

  const [result] = await db
    .select({ value: count() })
    .from(curatedChips)
    .where(and(...filters))

  return result?.value ?? 0
}

async function getCuratedChipFragranceCount(chipId: number) {
  const [result] = await db
    .select({ value: count() })
    .from(curatedChipFragrances)
    .where(eq(curatedChipFragrances.chipId, chipId))

  return result?.value ?? 0
}

function normalizeDuplicateValue(value: string) {
  return value.trim().toLowerCase()
}

function buildProductFilters(query: z.infer<typeof productQuerySchema>) {
  const filters = []

  if (query.q) {
    const term = `%${query.q}%`
    filters.push(
      or(
        ilike(fragrances.originalFragranceName, term),
        ilike(fragrances.mistifyProductName, term),
        ilike(fragrances.sourceBrandBatch, term),
        ilike(fragrances.classification, term),
      ),
    )
  }

  if (query.missingProductName === 'true') {
    filters.push(
      or(
        isNull(fragrances.mistifyProductName),
        sql`trim(${fragrances.mistifyProductName}) = ''`,
        sql`lower(trim(${fragrances.mistifyProductName})) in (${placeholderProductNameSql})`,
      ),
    )
  }

  if (query.missingProductUrl === 'true') {
    filters.push(
      or(
        isNull(fragrances.mistifyProductUrl),
        sql`trim(${fragrances.mistifyProductUrl}) = ''`,
      ),
    )
  }

  if (query.sourceBrandBatch) {
    filters.push(eq(fragrances.sourceBrandBatch, query.sourceBrandBatch))
  }

  if (query.classification) {
    filters.push(eq(fragrances.classification, query.classification))
  }

  if (query.verifiedOnMistify) {
    filters.push(eq(fragrances.verifiedOnMistify, query.verifiedOnMistify === 'true'))
  }

  if (query.sourceStatus) {
    filters.push(eq(fragrances.sourceStatus, query.sourceStatus))
  }

  return filters.length ? and(...filters) : undefined
}

adminRouter.use(requireAllowedAdminOrigin)
adminRouter.use(adminRouteLimiter)

adminRouter.post('/login', adminLoginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    const adminUsername = process.env.ADMIN_USERNAME?.trim()
    const adminPassword = process.env.ADMIN_PASSWORD

    if (!parsed.success || !adminPassword) {
      res.status(401).json({ error: 'Invalid admin credentials.' })
      return
    }

    if (adminUsername && !safeStringCompare(parsed.data.username ?? '', adminUsername)) {
      res.status(401).json({ error: 'Invalid admin credentials.' })
      return
    }

    if (!safeStringCompare(parsed.data.password, adminPassword)) {
      res.status(401).json({ error: 'Invalid admin credentials.' })
      return
    }

    const { token } = await createAdminToken(req)

    res.json({
      token,
      expiresInSeconds: Math.floor(tokenTtlMs / 1000),
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/logout', requireAdminToken, async (req, res, next) => {
  try {
    const token = getAdminBearerToken(req)

    if (token) {
      await db
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.tokenHash, hashAdminToken(token)))
    }

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/products', requireAdminToken, adminProductsGetLimiter, async (req, res, next) => {
  try {
    const parsed = productQuerySchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid product query.' })
      return
    }

    const query = parsed.data
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 50
    const offset = (page - 1) * pageSize
    const sortBy = query.sortBy ?? 'originalFragranceName'
    const sortDirection = query.sortDirection ?? 'asc'
    const sortColumns = {
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      mistifyProductName: fragrances.mistifyProductName,
      classification: fragrances.classification,
    }
    const where = buildProductFilters(query)
    const orderBy = sortDirection === 'desc' ? desc(sortColumns[sortBy]) : asc(sortColumns[sortBy])

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(fragrances)
        .where(where)
        .orderBy(orderBy, asc(fragrances.id))
        .limit(pageSize)
        .offset(offset),
      db.select({ value: count() }).from(fragrances).where(where),
    ])

    res.json({
      products: rows.map(toAdminProduct),
      pagination: {
        page,
        pageSize,
        total: totalRows[0]?.value ?? 0,
        totalPages: Math.ceil((totalRows[0]?.value ?? 0) / pageSize),
      },
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.patch('/products/:id', requireAdminToken, adminProductsPatchLimiter, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)
    const body = updateProductSchema.safeParse(req.body)

    if (!id.success || !body.success) {
      res.status(400).json({ error: 'Invalid product update.' })
      return
    }

    const updates: {
      mistifyProductName?: string | null
      mistifyProductUrl?: string | null
      updatedAt: Date
    } = {
      updatedAt: new Date(),
    }

    if ('mistifyProductName' in body.data) {
      updates.mistifyProductName = body.data.mistifyProductName || null
    }

    if ('mistifyProductUrl' in body.data) {
      updates.mistifyProductUrl = body.data.mistifyProductUrl || null
    }

    const [updatedProduct] = await db
      .update(fragrances)
      .set(updates)
      .where(eq(fragrances.id, id.data))
      .returning()

    if (!updatedProduct) {
      res.status(404).json({ error: 'Product not found.' })
      return
    }

    await writeAdminAuditLog(req, res, {
      action: 'update_product',
      entityType: 'fragrance',
      entityId: updatedProduct.id,
      summary: `Updated product mapping for fragrance ${updatedProduct.id}.`,
      requestJson: auditRequestBody(req),
    })

    res.json({ product: toAdminProduct(updatedProduct) })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/fragrances/search', requireAdminToken, adminProductsGetLimiter, async (req, res) => {
  try {
    const parsed = fragranceSearchQuerySchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid fragrance search.' })
      return
    }

    const term = `%${parsed.data.q}%`
    const rows = await db
      .select()
      .from(fragrances)
      .where(
        or(
          ilike(fragrances.originalFragranceName, term),
          ilike(fragrances.mistifyProductName, term),
          ilike(fragrances.sourceBrandBatch, term),
          ilike(fragrances.classification, term),
        ),
      )
      .orderBy(asc(fragrances.originalFragranceName), asc(fragrances.id))
      .limit(25)

    const fragranceIds = rows.map((row) => row.id)
    const memberships = fragranceIds.length
      ? await db
          .select({
            fragranceId: curatedChipFragrances.fragranceId,
            chipId: curatedChips.id,
            label: curatedChips.label,
          })
          .from(curatedChipFragrances)
          .innerJoin(curatedChips, eq(curatedChipFragrances.chipId, curatedChips.id))
          .where(inArray(curatedChipFragrances.fragranceId, fragranceIds))
          .orderBy(asc(curatedChips.sortOrder), asc(curatedChips.id))
      : []
    const membershipsByFragranceId = memberships.reduce<
      Record<number, { chipId: number; label: string }[]>
    >((current, membership) => {
      current[membership.fragranceId] = current[membership.fragranceId] ?? []
      current[membership.fragranceId].push({
        chipId: membership.chipId,
        label: membership.label,
      })
      return current
    }, {})

    res.json({
      fragrances: rows.map((row) => ({
        ...toAdminProduct(row),
        chipMemberships: membershipsByFragranceId[row.id] ?? [],
      })),
    })
  } catch (error) {
    console.error('[admin] fragrance search failed', error)
    res.status(500).json({ error: 'Could not search fragrances. Check that curated chip tables exist.' })
  }
})

adminRouter.get('/chips', requireAdminToken, async (_req, res, next) => {
  try {
    const [chips, selections] = await Promise.all([
      db.select().from(curatedChips).orderBy(asc(curatedChips.sortOrder), asc(curatedChips.id)),
      db.select({ chipId: curatedChipFragrances.chipId }).from(curatedChipFragrances),
    ])
    const counts = selections.reduce<Record<number, number>>((current, selection) => {
      current[selection.chipId] = (current[selection.chipId] ?? 0) + 1
      return current
    }, {})

    res.json({
      chips: chips.map((chip) => toAdminChip(chip, counts[chip.id] ?? 0)),
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/prompt-chips', requireAdminToken, async (_req, res, next) => {
  try {
    const chips = await db
      .select()
      .from(genericPromptChips)
      .orderBy(asc(genericPromptChips.sortOrder), asc(genericPromptChips.id))

    res.json({ chips: chips.map(toAdminGenericPromptChip) })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/prompt-chips', requireAdminToken, async (req, res, next) => {
  try {
    const parsed = genericPromptChipBodySchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid prompt chip details.' })
      return
    }

    if ((parsed.data.isActive ?? true) && (await getActiveGenericPromptChipCount()) >= maxActiveGenericPromptChips) {
      res.status(400).json({ error: `You can only have up to ${maxActiveGenericPromptChips} active generic helper chips.` })
      return
    }

    const [chip] = await db
      .insert(genericPromptChips)
      .values({
        label: parsed.data.label,
        prompt: parsed.data.prompt,
        isActive: parsed.data.isActive ?? true,
        sortOrder: parsed.data.sortOrder ?? 0,
        updatedAt: new Date(),
      })
      .returning()

    await writeAdminAuditLog(req, res, {
      action: 'create_prompt_chip',
      entityType: 'generic_prompt_chip',
      entityId: chip.id,
      summary: `Created prompt chip ${chip.id}.`,
      requestJson: auditRequestBody(req),
    })

    res.status(201).json({ chip: toAdminGenericPromptChip(chip) })
  } catch (error) {
    next(error)
  }
})

adminRouter.patch('/prompt-chips/reorder', requireAdminToken, async (req, res) => {
  try {
    const parsed = genericPromptChipReorderSchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid prompt chip reorder details.' })
      return
    }

    const ids = parsed.data.items.map((item) => item.id)
    const uniqueIds = new Set(ids)

    if (uniqueIds.size !== ids.length) {
      res.status(400).json({ error: 'Prompt chip reorder items must not include duplicate ids.' })
      return
    }

    const existingChips = await db
      .select()
      .from(genericPromptChips)
      .where(inArray(genericPromptChips.id, ids))

    if (existingChips.length !== ids.length) {
      res.status(400).json({ error: 'Prompt chip reorder includes an unknown chip id.' })
      return
    }

    const normalizedItems = parsed.data.items
      .slice()
      .sort((first, second) => first.sortOrder - second.sortOrder || first.id - second.id)
      .map((item, index) => ({
        id: item.id,
        sortOrder: index,
      }))
    const now = new Date()

    await Promise.all(
      normalizedItems.map((item) =>
        db
          .update(genericPromptChips)
          .set({ sortOrder: item.sortOrder, updatedAt: now })
          .where(eq(genericPromptChips.id, item.id)),
      ),
    )

    const updatedChips = await db
      .select()
      .from(genericPromptChips)
      .orderBy(asc(genericPromptChips.sortOrder), asc(genericPromptChips.id))

    await writeAdminAuditLog(req, res, {
      action: 'reorder_prompt_chips',
      entityType: 'generic_prompt_chip',
      summary: `Reordered ${normalizedItems.length} prompt chips.`,
      requestJson: auditRequestBody(req),
    })

    res.json({ chips: updatedChips.map(toAdminGenericPromptChip) })
  } catch (error) {
    console.error('[admin] generic prompt chip reorder failed', error)
    res.status(500).json({ error: 'Could not save generic helper chip order.' })
  }
})

adminRouter.patch('/prompt-chips/:id', requireAdminToken, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)
    const parsed = genericPromptChipPatchSchema.safeParse(req.body)

    if (!id.success || !parsed.success) {
      res.status(400).json({ error: 'Invalid prompt chip update.' })
      return
    }

    if (
      parsed.data.isActive === true &&
      (await getActiveGenericPromptChipCount(id.data)) >= maxActiveGenericPromptChips
    ) {
      res.status(400).json({ error: `You can only have up to ${maxActiveGenericPromptChips} active generic helper chips.` })
      return
    }

    const updates: Partial<typeof genericPromptChips.$inferInsert> = {
      updatedAt: new Date(),
    }

    if ('label' in parsed.data) updates.label = parsed.data.label
    if ('prompt' in parsed.data) updates.prompt = parsed.data.prompt
    if ('isActive' in parsed.data) updates.isActive = parsed.data.isActive
    if ('sortOrder' in parsed.data) updates.sortOrder = parsed.data.sortOrder

    const [chip] = await db
      .update(genericPromptChips)
      .set(updates)
      .where(eq(genericPromptChips.id, id.data))
      .returning()

    if (!chip) {
      res.status(404).json({ error: 'Prompt chip not found.' })
      return
    }

    await writeAdminAuditLog(req, res, {
      action: 'update_prompt_chip',
      entityType: 'generic_prompt_chip',
      entityId: chip.id,
      summary: `Updated prompt chip ${chip.id}.`,
      requestJson: auditRequestBody(req),
    })

    res.json({ chip: toAdminGenericPromptChip(chip) })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/prompt-chips/bulk', requireAdminToken, async (req, res, next) => {
  try {
    const parsed = bulkGenericPromptChipSchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bulk prompt chip details.' })
      return
    }

    const existingChips = await db.select().from(genericPromptChips)
    const existingLabels = new Set(
      existingChips.map((chip) => normalizeDuplicateValue(chip.label)),
    )
    const existingPrompts = new Set(
      existingChips.map((chip) => normalizeDuplicateValue(chip.prompt)),
    )
    const seenLabels = new Set<string>()
    const seenPrompts = new Set<string>()
    const errors: string[] = []
    const skipped: string[] = []
    const validChips: (typeof genericPromptChips.$inferInsert)[] = []
    let activeCount = await getActiveGenericPromptChipCount()

    parsed.data.chips.forEach((chip, index) => {
      const rowNumber = index + 1
      const normalizedLabel = normalizeDuplicateValue(chip.label)
      const normalizedPrompt = normalizeDuplicateValue(chip.prompt)

      if (existingLabels.has(normalizedLabel) || seenLabels.has(normalizedLabel)) {
        skipped.push(`Row ${rowNumber} skipped: duplicate label.`)
        return
      }

      if (existingPrompts.has(normalizedPrompt) || seenPrompts.has(normalizedPrompt)) {
        skipped.push(`Row ${rowNumber} skipped: duplicate prompt.`)
        return
      }

      const isActive = chip.isActive ?? true

      if (isActive && activeCount >= maxActiveGenericPromptChips) {
        skipped.push(`Row ${rowNumber} skipped: active generic helper chip limit reached.`)
        return
      }

      seenLabels.add(normalizedLabel)
      seenPrompts.add(normalizedPrompt)
      if (isActive) activeCount += 1
      validChips.push({
        label: chip.label,
        prompt: chip.prompt,
        isActive,
        sortOrder: chip.sortOrder ?? 0,
        updatedAt: new Date(),
      })
    })

    const createdChips = validChips.length
      ? await db.insert(genericPromptChips).values(validChips).returning()
      : []

    await writeAdminAuditLog(req, res, {
      action: 'bulk_create_prompt_chips',
      entityType: 'generic_prompt_chip',
      summary: `Bulk-created ${createdChips.length} prompt chips and skipped ${skipped.length}.`,
      requestJson: auditRequestBody(req),
    })

    res.status(201).json({
      created: createdChips.length,
      skipped: skipped.length,
      errors,
      skippedRows: skipped,
      chips: createdChips.map(toAdminGenericPromptChip),
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/prompt-chips/:id', requireAdminToken, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)

    if (!id.success) {
      res.status(400).json({ error: 'Invalid prompt chip id.' })
      return
    }

    const [deletedChip] = await db
      .delete(genericPromptChips)
      .where(eq(genericPromptChips.id, id.data))
      .returning()

    if (deletedChip) {
      await writeAdminAuditLog(req, res, {
        action: 'delete_prompt_chip',
        entityType: 'generic_prompt_chip',
        entityId: deletedChip.id,
        summary: `Deleted prompt chip ${deletedChip.id}.`,
      })
    }

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/chips', requireAdminToken, async (req, res, next) => {
  try {
    const parsed = chipBodySchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid chip details.',
      })
      return
    }

    if ((parsed.data.isActive ?? true) && (await getActiveCuratedChipCount()) >= maxActiveCuratedChips) {
      res.status(400).json({ error: 'You can only have up to 8 active curated recommendation chips.' })
      return
    }

    const [chip] = await db
      .insert(curatedChips)
      .values({
        label: parsed.data.label,
        description: parsed.data.description || null,
        isActive: parsed.data.isActive ?? true,
        sortOrder: parsed.data.sortOrder ?? 0,
        updatedAt: new Date(),
      })
      .returning()

    await writeAdminAuditLog(req, res, {
      action: 'create_curated_chip',
      entityType: 'curated_chip',
      entityId: chip.id,
      summary: `Created curated chip ${chip.id}.`,
      requestJson: auditRequestBody(req),
    })

    res.status(201).json({ chip: toAdminChip(chip) })
  } catch (error) {
    console.error('[admin] curated chip create failed', error)
    next(error)
  }
})

adminRouter.patch('/chips/:id', requireAdminToken, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)
    const parsed = chipPatchSchema.safeParse(req.body)

    if (!id.success || !parsed.success) {
      res.status(400).json({ error: 'Invalid chip update.' })
      return
    }

    if (
      parsed.data.isActive === true &&
      (await getActiveCuratedChipCount(id.data)) >= maxActiveCuratedChips
    ) {
      res.status(400).json({ error: 'You can only have up to 8 active curated recommendation chips.' })
      return
    }

    const updates: Partial<typeof curatedChips.$inferInsert> = {
      updatedAt: new Date(),
    }

    if ('label' in parsed.data) updates.label = parsed.data.label
    if ('description' in parsed.data) updates.description = parsed.data.description || null
    if ('isActive' in parsed.data) updates.isActive = parsed.data.isActive
    if ('sortOrder' in parsed.data) updates.sortOrder = parsed.data.sortOrder

    const [chip] = await db
      .update(curatedChips)
      .set(updates)
      .where(eq(curatedChips.id, id.data))
      .returning()

    if (!chip) {
      res.status(404).json({ error: 'Chip not found.' })
      return
    }

    await writeAdminAuditLog(req, res, {
      action: 'update_curated_chip',
      entityType: 'curated_chip',
      entityId: chip.id,
      summary: `Updated curated chip ${chip.id}.`,
      requestJson: auditRequestBody(req),
    })

    res.json({ chip: toAdminChip(chip) })
  } catch (error) {
    next(error)
  }
})

adminRouter.delete('/chips/:id', requireAdminToken, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)

    if (!id.success) {
      res.status(400).json({ error: 'Invalid chip id.' })
      return
    }

    const [deletedChip] = await db.delete(curatedChips).where(eq(curatedChips.id, id.data)).returning()

    if (deletedChip) {
      await writeAdminAuditLog(req, res, {
        action: 'delete_curated_chip',
        entityType: 'curated_chip',
        entityId: deletedChip.id,
        summary: `Deleted curated chip ${deletedChip.id}.`,
      })
    }

    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/chips/:id/fragrances', requireAdminToken, async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)

    if (!id.success) {
      res.status(400).json({ error: 'Invalid chip id.' })
      return
    }

    const rows = await db
      .select({
        selection: curatedChipFragrances,
        fragrance: fragrances,
      })
      .from(curatedChipFragrances)
      .innerJoin(fragrances, eq(curatedChipFragrances.fragranceId, fragrances.id))
      .where(eq(curatedChipFragrances.chipId, id.data))
      .orderBy(asc(curatedChipFragrances.sortOrder), asc(curatedChipFragrances.id))

    res.json({
      fragrances: rows.map((row) => toAdminChipFragrance(row.selection, row.fragrance)),
    })
  } catch (error) {
    console.error('[admin] curated chip fragrances load failed', error)
    res.status(500).json({ error: 'Could not load curated chip fragrances. Check that curated chip tables exist.' })
  }
})

adminRouter.post('/chips/:id/fragrances', requireAdminToken, async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().safeParse(req.params.id)
    const parsed = chipFragranceBodySchema.safeParse(req.body)

    if (!id.success || !parsed.success) {
      res.status(400).json({ error: 'Invalid chip fragrance details.' })
      return
    }

    const [existing] = await db
      .select()
      .from(curatedChipFragrances)
      .where(
        and(
          eq(curatedChipFragrances.chipId, id.data),
          eq(curatedChipFragrances.fragranceId, parsed.data.fragranceId),
        ),
      )
      .limit(1)

    if (existing) {
      res.status(409).json({ error: 'This fragrance is already selected for the chip.' })
      return
    }

    if ((await getCuratedChipFragranceCount(id.data)) >= maxCuratedChipFragrances) {
      res.status(400).json({ error: `A curated chip can only include up to ${maxCuratedChipFragrances} fragrances.` })
      return
    }

    const [fragrance] = await db
      .select()
      .from(fragrances)
      .where(eq(fragrances.id, parsed.data.fragranceId))
      .limit(1)

    if (!fragrance) {
      res.status(404).json({ error: 'Fragrance not found.' })
      return
    }

    const [selection] = await db
      .insert(curatedChipFragrances)
      .values({
        chipId: id.data,
        fragranceId: parsed.data.fragranceId,
        sortOrder: parsed.data.sortOrder ?? 0,
        adminNote: parsed.data.adminNote || null,
      })
      .returning()

    await writeAdminAuditLog(req, res, {
      action: 'add_curated_chip_fragrance',
      entityType: 'curated_chip_fragrance',
      entityId: selection.id,
      summary: `Added fragrance ${selection.fragranceId} to curated chip ${selection.chipId}.`,
      requestJson: auditRequestBody(req),
    })

    res.status(201).json({ fragrance: toAdminChipFragrance(selection, fragrance) })
  } catch (error) {
    console.error('[admin] curated chip fragrance add failed', error)
    res.status(500).json({ error: 'Could not add fragrance to curated chip. Check that curated chip tables exist.' })
  }
})

adminRouter.patch('/chips/:id/fragrances/:fragranceId', requireAdminToken, async (req, res) => {
  try {
    const chipId = z.coerce.number().int().positive().safeParse(req.params.id)
    const fragranceId = z.coerce.number().int().positive().safeParse(req.params.fragranceId)
    const parsed = chipFragrancePatchSchema.safeParse(req.body)

    if (!chipId.success || !fragranceId.success || !parsed.success) {
      res.status(400).json({ error: 'Invalid chip fragrance update.' })
      return
    }

    const updates: Partial<typeof curatedChipFragrances.$inferInsert> = {}

    if ('sortOrder' in parsed.data) updates.sortOrder = parsed.data.sortOrder
    if ('adminNote' in parsed.data) updates.adminNote = parsed.data.adminNote || null

    const [selection] = await db
      .update(curatedChipFragrances)
      .set(updates)
      .where(
        and(
          eq(curatedChipFragrances.chipId, chipId.data),
          eq(curatedChipFragrances.fragranceId, fragranceId.data),
        ),
      )
      .returning()
    const [fragrance] = await db
      .select()
      .from(fragrances)
      .where(eq(fragrances.id, fragranceId.data))
      .limit(1)

    if (!selection || !fragrance) {
      res.status(404).json({ error: 'Selected fragrance not found.' })
      return
    }

    await writeAdminAuditLog(req, res, {
      action: 'update_curated_chip_fragrance',
      entityType: 'curated_chip_fragrance',
      entityId: selection.id,
      summary: `Updated fragrance ${selection.fragranceId} on curated chip ${selection.chipId}.`,
      requestJson: auditRequestBody(req),
    })

    res.json({ fragrance: toAdminChipFragrance(selection, fragrance) })
  } catch (error) {
    console.error('[admin] curated chip fragrance update failed', error)
    res.status(500).json({ error: 'Could not update curated chip fragrance. Check that curated chip tables exist.' })
  }
})

adminRouter.delete('/chips/:id/fragrances/:fragranceId', requireAdminToken, async (req, res) => {
  try {
    const chipId = z.coerce.number().int().positive().safeParse(req.params.id)
    const fragranceId = z.coerce.number().int().positive().safeParse(req.params.fragranceId)

    if (!chipId.success || !fragranceId.success) {
      res.status(400).json({ error: 'Invalid selected fragrance id.' })
      return
    }

    const [deletedSelection] = await db
      .delete(curatedChipFragrances)
      .where(
        and(
          eq(curatedChipFragrances.chipId, chipId.data),
          eq(curatedChipFragrances.fragranceId, fragranceId.data),
        ),
      )
      .returning()

    if (deletedSelection) {
      await writeAdminAuditLog(req, res, {
        action: 'delete_curated_chip_fragrance',
        entityType: 'curated_chip_fragrance',
        entityId: deletedSelection.id,
        summary: `Removed fragrance ${deletedSelection.fragranceId} from curated chip ${deletedSelection.chipId}.`,
      })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[admin] curated chip fragrance remove failed', error)
    res.status(500).json({ error: 'Could not remove fragrance from curated chip. Check that curated chip tables exist.' })
  }
})

export default adminRouter
