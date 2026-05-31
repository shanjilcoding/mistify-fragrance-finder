import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import adminRouter from './routes/adminRoutes'
import chatRouter from './routes/chatRoutes'
import chipRouter from './routes/chipRoutes'
import promptChipRouter from './routes/promptChipRoutes'
import recommendationOptionsRouter from './routes/recommendationOptionsRoutes'

const app = express()
const port = Number(process.env.PORT) || 5000
const frontendUrl = process.env.FRONTEND_URL?.trim()
const allowedOrigins = new Set(
  [frontendUrl, 'http://localhost:5173', 'http://localhost:3000'].filter(
    (origin): origin is string => Boolean(origin),
  ),
)

if (process.env.NODE_ENV === 'production' && !frontendUrl) {
  console.warn('[security] FRONTEND_URL is not set; production CORS will only allow known local origins.')
}

app.set('trust proxy', 1)
app.use(helmet())
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Not allowed by CORS'))
    },
  }),
)
app.use(express.json({ limit: '10kb' }))

app.get('/', (_req, res) => {
  res.json({
    message: 'Mistify fragrance chatbot API is running.',
  })
})

app.use('/api/chat', chatRouter)
app.use('/api/prompt-chips', promptChipRouter)
app.use('/api/recommendation-options', recommendationOptionsRouter)
app.use('/api/chips', chipRouter)
app.use('/api/admin', adminRouter)

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const statusCode =
      error instanceof SyntaxError ||
      (typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.parse.failed')
        ? 400
        : 500

    console.warn(
      `[api] safeError status=${statusCode} type=${
        error instanceof Error ? error.name : 'unknown'
      }`,
    )

    res.status(statusCode).json({
      error:
        statusCode === 400
          ? 'Invalid request body.'
          : 'Something went wrong. Please try again later.',
    })
  },
)

app.listen(port, () => {
  console.log(`Mistify fragrance chatbot API is running on port ${port}.`)
})
