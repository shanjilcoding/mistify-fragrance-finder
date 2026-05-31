import { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import {
  bigserial,
  bigint,
  boolean,
  serial,
  index,
  integer,
  numeric,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

type ScoreMap = Record<string, number>

export const fragrances = pgTable('fragrances', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  originalFragranceName: text('original_fragrance_name'),
  mistifyProductName: text('mistify_product_name'),
  mistifyProductUrl: text('mistify_product_url'),
  audience: text('audience'),
  sourceBrandBatch: text('source_brand_batch'),
  classification: text('classification'),
  topNotes: text('top_notes').array(),
  middleNotes: text('middle_notes').array(),
  baseNotes: text('base_notes').array(),
  allNotes: text('all_notes').array(),
  sourceStatus: text('source_status'),
  sourceUsed: text('source_used'),
  sourceNotes: text('source_notes'),
  sourceConfidence: text('source_confidence'),
  verifiedOnMistify: boolean('verified_on_mistify'),
  mistifyProductFound: boolean('mistify_product_found'),
  notesSourceType: text('notes_source_type'),
  inferredClassifications: text('inferred_classifications').array(),
  inferredSeasons: text('inferred_seasons').array(),
  inferredOccasions: text('inferred_occasions').array(),
  inferredIntensity: text('inferred_intensity'),
  seasonScores: jsonb('season_scores').$type<ScoreMap>(),
  profileScores: jsonb('profile_scores').$type<ScoreMap>(),
  inferenceReason: text('inference_reason'),
  reviewedByAdmin: boolean('reviewed_by_admin'),
  searchableText: text('searchable_text'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export type Fragrance = InferSelectModel<typeof fragrances>
export type NewFragrance = InferInsertModel<typeof fragrances>

export const fragranceRatings = pgTable(
  'fragrance_ratings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    inputBrand: text('input_brand'),
    inputName: text('input_name'),
    parsedBrand: text('parsed_brand'),
    parsedName: text('parsed_name'),
    normalizedBrand: text('normalized_brand').notNull(),
    normalizedName: text('normalized_name').notNull(),
    fragranticaUrl: text('fragrantica_url'),
    ratingValue: numeric('rating_value', { precision: 3, scale: 2 }),
    ratingVoteCount: integer('rating_vote_count'),
    reviewCount: integer('review_count'),
    loveCount: integer('love_count'),
    likeCount: integer('like_count'),
    okCount: integer('ok_count'),
    dislikeCount: integer('dislike_count'),
    hateCount: integer('hate_count'),
    winterCount: integer('winter_count'),
    springCount: integer('spring_count'),
    summerCount: integer('summer_count'),
    fallCount: integer('fall_count'),
    dayCount: integer('day_count'),
    nightCount: integer('night_count'),
    seasonTotalCount: integer('season_total_count'),
    dayNightTotalCount: integer('day_night_total_count'),
    winterShare: numeric('winter_share', { precision: 6, scale: 5 }),
    springShare: numeric('spring_share', { precision: 6, scale: 5 }),
    summerShare: numeric('summer_share', { precision: 6, scale: 5 }),
    fallShare: numeric('fall_share', { precision: 6, scale: 5 }),
    dayShare: numeric('day_share', { precision: 6, scale: 5 }),
    nightShare: numeric('night_share', { precision: 6, scale: 5 }),
    sourceName: text('source_name'),
    sourceType: text('source_type'),
    scrapeStatus: text('scrape_status'),
    errorMessage: text('error_message'),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('fragrance_ratings_normalized_brand_name_unique').on(
      table.normalizedBrand,
      table.normalizedName,
    ),
    index('fragrance_ratings_normalized_lookup_idx').on(
      table.normalizedBrand,
      table.normalizedName,
    ),
    index('fragrance_ratings_rating_value_idx').on(table.ratingValue),
    index('fragrance_ratings_season_shares_idx').on(
      table.winterShare,
      table.springShare,
      table.summerShare,
      table.fallShare,
    ),
  ],
)

export type FragranceRating = InferSelectModel<typeof fragranceRatings>
export type NewFragranceRating = InferInsertModel<typeof fragranceRatings>

export const curatedChips = pgTable('curated_chips', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export type CuratedChip = InferSelectModel<typeof curatedChips>
export type NewCuratedChip = InferInsertModel<typeof curatedChips>

export const genericPromptChips = pgTable('generic_prompt_chips', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  prompt: text('prompt').notNull(),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export type GenericPromptChip = InferSelectModel<typeof genericPromptChips>
export type NewGenericPromptChip = InferInsertModel<typeof genericPromptChips>

export const curatedChipFragrances = pgTable(
  'curated_chip_fragrances',
  {
    id: serial('id').primaryKey(),
    chipId: integer('chip_id')
      .notNull()
      .references(() => curatedChips.id, { onDelete: 'cascade' }),
    fragranceId: bigint('fragrance_id', { mode: 'number' })
      .notNull()
      .references(() => fragrances.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').default(0),
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('curated_chip_fragrances_chip_fragrance_unique').on(
      table.chipId,
      table.fragranceId,
    ),
    index('curated_chip_fragrances_chip_sort_idx').on(
      table.chipId,
      table.sortOrder,
    ),
  ],
)

export type CuratedChipFragrance = InferSelectModel<typeof curatedChipFragrances>
export type NewCuratedChipFragrance = InferInsertModel<typeof curatedChipFragrances>

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_sessions_token_hash_unique').on(table.tokenHash),
    index('admin_sessions_active_idx').on(table.expiresAt, table.revokedAt),
  ],
)

export type AdminSession = InferSelectModel<typeof adminSessions>
export type NewAdminSession = InferInsertModel<typeof adminSessions>

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: bigint('session_id', { mode: 'number' }).references(() => adminSessions.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    requestJson: jsonb('request_json').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('admin_audit_logs_created_at_idx').on(table.createdAt),
    index('admin_audit_logs_entity_idx').on(table.entityType, table.entityId),
  ],
)

export type AdminAuditLog = InferSelectModel<typeof adminAuditLogs>
export type NewAdminAuditLog = InferInsertModel<typeof adminAuditLogs>
