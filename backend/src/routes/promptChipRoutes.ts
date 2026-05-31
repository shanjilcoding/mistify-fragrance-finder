import { Router } from 'express'
import { asc, eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { genericPromptChips } from '../db/schema'

const promptChipRouter = Router()
const publicPromptChipLimit = 30

promptChipRouter.get('/', async (_req, res, next) => {
  try {
    const chips = await db
      .select({
        id: genericPromptChips.id,
        label: genericPromptChips.label,
        prompt: genericPromptChips.prompt,
        sortOrder: genericPromptChips.sortOrder,
      })
      .from(genericPromptChips)
      .where(eq(genericPromptChips.isActive, true))
      .orderBy(asc(genericPromptChips.sortOrder), asc(genericPromptChips.id))
      .limit(publicPromptChipLimit)

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

export default promptChipRouter
