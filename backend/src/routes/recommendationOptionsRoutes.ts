import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getRecommendationOptions } from '../services/recommendationService'

const recommendationOptionsRouter = Router()
const recommendationOptionsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many option requests. Please wait a moment and try again.',
  },
})

recommendationOptionsRouter.get('/', recommendationOptionsLimiter, (_req, res) => {
  res.json(getRecommendationOptions())
})

export default recommendationOptionsRouter
