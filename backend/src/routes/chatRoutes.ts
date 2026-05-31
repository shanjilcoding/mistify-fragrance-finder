import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { recommendFragrance } from '../controllers/chatController'

const chatRouter = Router()
const chatRecommendationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many searches in a short time. Please wait a moment and try again.',
  },
})

chatRouter.post('/recommend', chatRecommendationLimiter, recommendFragrance)

export default chatRouter
