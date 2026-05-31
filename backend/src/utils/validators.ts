import { z } from 'zod'

const chatConversationItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z
    .string({
      required_error: 'Conversation content is required.',
      invalid_type_error: 'Conversation content must be a string.',
    })
    .trim()
    .max(240, 'Conversation messages must be 240 characters or fewer.'),
})

export const chatRequestSchema = z.object({
  message: z
    .string({
      required_error: 'Message is required.',
      invalid_type_error: 'Message must be a string.',
    })
    .trim()
    .min(1, 'Message cannot be empty.')
    .max(240, 'Message must be 240 characters or fewer.'),
  conversation: z.array(chatConversationItemSchema).max(10).optional(),
  lastSearchQuery: z
    .string({
      invalid_type_error: 'Last search query must be a string.',
    })
    .trim()
    .max(240, 'Last search query must be 240 characters or fewer.')
    .optional(),
  lastRecommendations: z.array(z.unknown()).max(20).optional(),
  curatedChipId: z.coerce.number().int().positive().optional(),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>
