import { Router } from 'express'
import { asc, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { curatedChipFragrances, curatedChips } from '../db/schema'

const chipRouter = Router()

chipRouter.get('/', async (_req, res, next) => {
  try {
    const chips = await db
      .select({
        id: curatedChips.id,
        label: curatedChips.label,
        description: curatedChips.description,
        sortOrder: curatedChips.sortOrder,
      })
      .from(curatedChips)
      .where(
        sql`${curatedChips.isActive} = true and exists (
          select 1 from ${curatedChipFragrances}
          where ${curatedChipFragrances.chipId} = ${curatedChips.id}
        )`,
      )
      .orderBy(asc(curatedChips.sortOrder), asc(curatedChips.id))
      .limit(8)

    res.json({
      chips: chips.map((chip) => ({
        ...chip,
        sortOrder: chip.sortOrder ?? 0,
      })),
    })
  } catch (error) {
    next(error)
  }
})

export default chipRouter
