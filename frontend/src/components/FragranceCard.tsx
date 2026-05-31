import { useEffect, useMemo, useState } from 'react'
import type { Recommendation } from '../api/chatApi'

type FragranceCardProps = {
  recommendation: Recommendation
  rank: number
  featured?: boolean
  isReferenceMode?: boolean
  isCuratedResult?: boolean
  sharedNotes?: string[]
}

type NoteSectionProps = {
  label: string
  notes?: string[]
  sharedNoteSet?: Set<string>
}

const ELITE_RATING_THRESHOLD = 4.4
const COMPACT_COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
})
const EMPTY_SHARED_NOTES: string[] = []

function NoteSection({ label, notes, sharedNoteSet }: NoteSectionProps) {
  const safeNotes = Array.isArray(notes) ? notes : []

  if (!safeNotes.length) {
    return null
  }

  return (
    <div className="note-section">
      <p>{label}</p>
      <ul className="note-list">
        {safeNotes.map((note) => (
          <li
            className={sharedNoteSet?.has(normalizeNote(note)) ? 'shared-note' : ''}
            key={note}
          >
            {note}
          </li>
        ))}
      </ul>
    </div>
  )
}

function getMatchTierFromScore(score: number): NonNullable<Recommendation['matchTier']> {
  if (score >= 98) {
    return 'top'
  }

  if (score >= 92) {
    return 'high'
  }

  if (score >= 80) {
    return 'strong'
  }

  if (score >= 66) {
    return 'good'
  }

  return 'possible'
}

function getMatchBadge(tier: NonNullable<Recommendation['matchTier']>) {
  if (tier === 'top') {
    return {
      className: 'match-badge match-badge-high',
      label: 'Excellent fit',
    }
  }

  if (tier === 'high') {
    return {
      className: 'match-badge match-badge-high',
      label: 'Strong fit',
    }
  }

  if (tier === 'strong' || tier === 'good') {
    return {
      className: 'match-badge match-badge-medium',
      label: 'Good fit',
    }
  }

  return {
    className: 'match-badge match-badge-low',
    label: 'Worth exploring',
  }
}

function getDisplayConfidenceLabel(value: string | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  return trimmedValue === 'Possible fit' ? 'Worth exploring' : trimmedValue
}

function formatCount(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : null
}

function formatCompactCount(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return null
  }

  return COMPACT_COUNT_FORMATTER.format(value).toLowerCase()
}

function formatRating(value: number | null | undefined) {
  return typeof value === 'number' ? `${value.toFixed(2)}/5` : null
}

function isInvalidClassification(classification: string | null | undefined) {
  if (!classification) {
    return true
  }

  const normalizedClassification = classification.trim().toLowerCase()

  if (!normalizedClassification) {
    return true
  }

  return [
    'not fully verified',
    'not verified',
    'verified',
    'mistify page',
    'fallback',
    'source',
    'status',
  ].some((invalidText) => normalizedClassification.includes(invalidText))
}

function getDisplayClassification(classification: string | null | undefined) {
  if (isInvalidClassification(classification)) {
    return null
  }

  return (classification ?? '')
    .split(/\s*[/|]\s*/)
    .flatMap((category) => {
      const normalizedCategory = category.trim().toLowerCase()

      return normalizedCategory ? [capitalizeText(normalizedCategory)] : []
    })
    .join(' / ')
}

function isPlaceholderDisplayText(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase() ?? ''

  return [
    'not verified',
    'not verified on mistify',
    'not fully verified from mistify page',
    'not verified from source',
  ].includes(normalizedValue)
}

function getDisplayProductName(recommendation: Recommendation) {
  const mistifyProductName = recommendation.mistifyProductName?.trim()

  return mistifyProductName && !isPlaceholderDisplayText(mistifyProductName)
    ? mistifyProductName
    : 'Mistify Fragrance'
}

function getInspiredByText(recommendation: Recommendation) {
  const originalFragranceName = recommendation.originalFragranceName?.trim()
  const sourceBrandBatch = recommendation.sourceBrandBatch?.trim()
  const safeSourceBrandBatch =
    sourceBrandBatch && !isPlaceholderDisplayText(sourceBrandBatch)
      ? sourceBrandBatch
      : null

  if (!originalFragranceName || isPlaceholderDisplayText(originalFragranceName)) {
    return null
  }

  return `Inspired by ${originalFragranceName}${
    safeSourceBrandBatch ? ` by ${safeSourceBrandBatch}` : ''
  }`
}

function getAudienceLabel(value: string | null | undefined) {
  const normalizedValue = value?.trim().toLowerCase()

  if (normalizedValue === 'unisex') {
    return 'Unisex'
  }

  if (normalizedValue === 'mens') {
    return 'Men'
  }

  if (normalizedValue === 'womens') {
    return 'Women'
  }

  return null
}

function getSafeProductUrl(value: string | null | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  try {
    const url = new URL(trimmedValue)

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function getUniqueNotes(notes: string[]) {
  return Array.from(new Set(notes.filter(Boolean)))
}

function normalizeNote(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function getRatingBadge(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return null
  }

  if (value >= ELITE_RATING_THRESHOLD) {
    return 'Elite Rating'
  }

  if (value >= 4.3) {
    return 'Excellent Rating'
  }

  return null
}

function getPopularBadge(voteCount: number | null | undefined) {
  return typeof voteCount === 'number' && voteCount >= 5000
    ? 'Popular Pick'
    : null
}

function getLoveRatio(recommendation: Recommendation) {
  const rating = recommendation.rating
  const loveCount = rating?.loveCount
  const reactionCounts = [
    loveCount,
    rating?.likeCount,
    rating?.okCount,
    rating?.dislikeCount,
    rating?.hateCount,
  ]

  if (!reactionCounts.every((count) => typeof count === 'number')) {
    return null
  }

  const total = reactionCounts.reduce((sum, count) => sum + (count ?? 0), 0)

  return total > 0 && typeof loveCount === 'number' ? loveCount / total : null
}

function formatPercent(value: number | null) {
  return value === null ? null : `${Math.round(value * 100)}%`
}

function capitalizeText(value: string) {
  return value
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function formatNoteList(notes: string[]) {
  if (notes.length <= 1) {
    return notes.join('')
  }

  if (notes.length === 2) {
    return `${notes[0]} and ${notes[1]}`
  }

  return `${notes.slice(0, -1).join(', ')}, and ${notes[notes.length - 1]}`
}

function compactStringList(values: string[] | null | undefined, limit = 4) {
  return Array.isArray(values)
    ? values.flatMap((value) => {
        const trimmedValue = value.trim()

        return trimmedValue ? [trimmedValue] : []
      }).slice(0, limit)
    : []
}

function buildPreviewChips(
  groups: Array<string[] | null | undefined>,
  fallbackNotes: string[],
  limit = 4,
) {
  const chips: string[] = []
  const seen = new Set<string>()

  function addChip(value: string) {
    const trimmedValue = value.trim()
    const normalizedValue = normalizeNote(trimmedValue)

    if (!trimmedValue || !normalizedValue || seen.has(normalizedValue)) {
      return
    }

    seen.add(normalizedValue)
    chips.push(trimmedValue)
  }

  for (const group of groups) {
    if (chips.length >= limit) {
      break
    }

    for (const value of group ?? []) {
      addChip(value)

      if (chips.length >= limit) {
        break
      }
    }
  }

  if (!chips.length) {
    for (const note of fallbackNotes) {
      addChip(note)

      if (chips.length >= limit) {
        break
      }
    }
  }

  return chips
}

function buildFallbackReason(
  recommendation: Recommendation,
  notes: string[],
  displayClassification: string | null,
) {
  const noteText = formatNoteList(notes.slice(0, 4))
  const classification = displayClassification?.toLowerCase()
  const seasonText = recommendation.rating?.bestSeasons?.slice(0, 2).join(' and ')
  const timeText = recommendation.rating?.bestTime?.toLowerCase()

  if (noteText && classification) {
    return `${capitalizeText(classification)} fit with ${noteText}.`
  }

  if (noteText) {
    return `Built around ${noteText}.`
  }

  if (seasonText || timeText) {
    return `Best suited to ${[seasonText, timeText].filter(Boolean).join(' and ')} wear.`
  }

  return 'Strong fit from the available fragrance profile.'
}

function isRepeatedCuratedReason(value: string) {
  return value.trim().toLowerCase().replace(/[.]+$/g, '') === 'selected by mistify for this curated list'
}


const wardrobeRoles = [
  'Best overall',
  'Cleanest daily wear',
  'Most polished',
  'Most memorable',
  'Wildcard pick',
]

function noteTextIncludes(notes: string[], terms: string[]) {
  const normalizedNotes = notes.join(' ').toLowerCase()

  return terms.some((term) => normalizedNotes.includes(term))
}

function clampProfileScore(value: number) {
  return Math.max(18, Math.min(96, value))
}

function buildScentDna(recommendation: Recommendation, notes: string[]) {
  const classification = recommendation.classification?.toLowerCase() ?? ''
  const bestSeasons = recommendation.rating?.bestSeasons?.join(' ').toLowerCase() ?? ''
  const bestTime = recommendation.rating?.bestTime?.toLowerCase() ?? ''
  const profile = [
    ...(recommendation.scentProfile ?? []),
    ...(recommendation.matchedVibes ?? []),
  ].join(' ').toLowerCase()
  const corpus = `${classification} ${bestSeasons} ${bestTime} ${profile}`

  return [
    {
      label: 'Fresh',
      value: clampProfileScore(
        34 +
          (noteTextIncludes(notes, ['citrus', 'bergamot', 'lemon', 'grapefruit', 'orange', 'neroli', 'aquatic']) ? 34 : 0) +
          (corpus.includes('fresh') || corpus.includes('summer') || corpus.includes('day') ? 18 : 0),
      ),
    },
    {
      label: 'Sweet',
      value: clampProfileScore(
        28 +
          (noteTextIncludes(notes, ['vanilla', 'honey', 'caramel', 'tonka', 'praline', 'sugar']) ? 38 : 0) +
          (corpus.includes('sweet') ? 18 : 0),
      ),
    },
    {
      label: 'Warm',
      value: clampProfileScore(
        30 +
          (noteTextIncludes(notes, ['amber', 'tobacco', 'cinnamon', 'spice', 'oud', 'leather', 'wood']) ? 38 : 0) +
          (corpus.includes('winter') || corpus.includes('night') || corpus.includes('warm') ? 16 : 0),
      ),
    },
    {
      label: 'Woody',
      value: clampProfileScore(
        24 +
          (noteTextIncludes(notes, ['wood', 'cedar', 'sandalwood', 'vetiver', 'oud', 'patchouli']) ? 44 : 0) +
          (classification.includes('woody') ? 18 : 0),
      ),
    },
    {
      label: 'Loud',
      value: clampProfileScore(
        26 +
          (bestTime.includes('night') ? 16 : 0) +
          (noteTextIncludes(notes, ['oud', 'tobacco', 'leather', 'saffron', 'patchouli']) ? 24 : 0) +
          ((recommendation.matchScore ?? 0) >= 92 ? 8 : 0),
      ),
    },
  ]
}

function useFragranceCardContent({
  recommendation,
  rank,
  featured = false,
  isReferenceMode = false,
  isCuratedResult = false,
  sharedNotes = EMPTY_SHARED_NOTES,
}: FragranceCardProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const topNotes = useMemo(
    () => (Array.isArray(recommendation.topNotes) ? recommendation.topNotes : []),
    [recommendation.topNotes],
  )
  const middleNotes = useMemo(() => (Array.isArray(recommendation.middleNotes) ? recommendation.middleNotes : []), [recommendation.middleNotes])
  const baseNotes = useMemo(
    () => (Array.isArray(recommendation.baseNotes) ? recommendation.baseNotes : []),
    [recommendation.baseNotes],
  )
  const allNotes = useMemo(
    () => (Array.isArray(recommendation.allNotes) ? recommendation.allNotes : []),
    [recommendation.allNotes],
  )
  const hasGroupedNotes = topNotes.length || middleNotes.length || baseNotes.length
  const shouldShowFallbackNotes = !hasGroupedNotes && allNotes.length > 0
  const combinedNotes = useMemo(
    () => getUniqueNotes([...topNotes, ...middleNotes, ...baseNotes, ...allNotes]),
    [allNotes, baseNotes, middleNotes, topNotes],
  )
  const fallbackNotes = combinedNotes.slice(0, 4)
  const sharedNoteSet = useMemo(() => new Set(sharedNotes.map(normalizeNote)), [sharedNotes])
  const rating = recommendation.rating
  const displayClassification = getDisplayClassification(recommendation.classification)
  const ratingBadge = getRatingBadge(rating?.ratingValue)
  const popularBadge = getPopularBadge(rating?.ratingVoteCount)
  const loveRatio = getLoveRatio(recommendation)
  const lovedBadge =
    (loveRatio !== null && loveRatio >= 0.4) || (rating?.loveCount ?? 0) >= 1000
      ? 'Most Loved'
      : null
  const confidenceLabel = getDisplayConfidenceLabel(recommendation.confidenceLabel)
  const ratingHighlights = [ratingBadge, popularBadge, lovedBadge]
    .filter((badge): badge is string => Boolean(badge))
    .slice(0, 3)
  const detailItems = [
    {
      label: 'Rating',
      value: formatRating(rating?.ratingValue),
    },
    {
      label: 'Votes',
      value: formatCount(rating?.ratingVoteCount),
    },
    {
      label: 'Loved',
      value:
        [
          formatCompactCount(rating?.loveCount)
            ? `${formatCompactCount(rating?.loveCount)} loved`
            : null,
          formatPercent(loveRatio),
        ]
          .filter(Boolean)
          .join(', ') || null,
    },
    {
      label: 'Best seasons',
      value: rating?.bestSeasons?.length
        ? rating.bestSeasons.join(', ')
        : null,
    },
    { label: 'Best time', value: rating?.bestTime },
  ].filter((item) => item.value)
  const matchBadge =
    recommendation.matchTier || typeof recommendation.matchScore === 'number'
      ? getMatchBadge(
          recommendation.matchTier ??
            getMatchTierFromScore(recommendation.matchScore ?? 0),
        )
      : null
  const primaryBadgeLabel =
    confidenceLabel ||
    matchBadge?.label ||
    'Worth exploring'
  const primaryBadgeClassName =
    primaryBadgeLabel === 'Excellent fit' || primaryBadgeLabel === 'Strong fit'
      ? 'match-badge match-badge-high'
      : primaryBadgeLabel === 'Good fit'
        ? 'match-badge match-badge-medium'
        : matchBadge?.className ?? 'match-badge match-badge-low'
  const scoreBreakdown = recommendation.scoreBreakdown
  const scoreItems = [
    {
      label: 'Confidence',
      value: confidenceLabel,
    },
    {
      label: 'Match confidence',
      value:
        typeof recommendation.matchScore === 'number'
          ? `${recommendation.matchScore}/100`
          : null,
    },
    {
      label: 'Profile fit',
      value: scoreBreakdown?.profileFit,
    },
    {
      label: 'Popularity',
      value: scoreBreakdown?.popularity,
    },
    {
      label: 'Rating confidence',
      value: scoreBreakdown?.ratingConfidence,
    },
    {
      label: 'Reference angle',
      value: recommendation.referenceSimilarityAngle,
    },
  ].filter((item) => item.value)
  const displayProductName = getDisplayProductName(recommendation)
  const audienceLabel = getAudienceLabel(recommendation.audience)
  const productUrl = getSafeProductUrl(recommendation.mistifyProductUrl)
  const inspiredByText = getInspiredByText(recommendation)
  const reason =
    recommendation.matchSummary?.trim() ||
    recommendation.aiExplanation ||
    buildFallbackReason(
      recommendation,
      fallbackNotes,
      displayClassification,
    )
  const shouldUseCuratedBadgeReason =
    isCuratedResult && isRepeatedCuratedReason(reason)
  const detailReason = shouldUseCuratedBadgeReason
    ? 'Selected from this curated list.'
    : reason
  const modalTitleId = `fragrance-details-title-${rank}`
  const wardrobeRole = wardrobeRoles[rank - 1] ?? 'Curator pick'
  const whyItMatches = compactStringList(recommendation.whyItMatches, 4)
  const matchedNotes = compactStringList(recommendation.matchedNotes, 6)
  const matchedVibes = compactStringList(recommendation.matchedVibes, 5)
  const matchedOccasions = compactStringList(recommendation.matchedOccasions, 4)
  const matchedSeasons = compactStringList(recommendation.matchedSeasons, 4)
  const scentProfile = compactStringList(recommendation.scentProfile, 5)
  const sharedWithReference = compactStringList(recommendation.sharedWithReference, 6)
  const differentFromReference = compactStringList(recommendation.differentFromReference, 4)
  const missingFromReference = compactStringList(recommendation.missingFromReference, 4)
  const previewChips = useMemo(
    () =>
      buildPreviewChips(
        [
          recommendation.matchedNotes,
          recommendation.matchedVibes,
          recommendation.matchedOccasions,
          recommendation.matchedSeasons,
          recommendation.scentProfile,
        ],
        combinedNotes,
        4,
      ),
    [
      combinedNotes,
      recommendation.matchedNotes,
      recommendation.matchedOccasions,
      recommendation.matchedSeasons,
      recommendation.matchedVibes,
      recommendation.scentProfile,
    ],
  )
  const hasCueDetails =
    matchedNotes.length ||
    matchedVibes.length ||
    matchedOccasions.length ||
    matchedSeasons.length
  const hasReferenceChipDetails =
    sharedWithReference.length ||
    differentFromReference.length ||
    missingFromReference.length
  const scentDna = buildScentDna(recommendation, combinedNotes)
  const productItems = [
    {
      label: 'Displayed as',
      value: displayProductName,
    },
    {
      label: 'Audience',
      value: audienceLabel,
    },
    {
      label: 'Inspired style',
      value: inspiredByText,
    },
    {
      label: 'Classification',
      value: displayClassification,
    },
  ].filter((item) => item.value)

  useEffect(() => {
    if (!isDetailsOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsDetailsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('modal-open')

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('modal-open')
    }
  }, [isDetailsOpen])

  return (
    <>
    <article className={`fragrance-card ${featured ? 'featured-card' : ''}`}>
      <p className="curator-rank-label">Curator Pick {String(rank).padStart(2, '0')} · {wardrobeRole}</p>
      <div className="fragrance-card-header">
        <div className="fragrance-title-group">
          {displayClassification || audienceLabel ? (
            <div className="fragrance-meta-line">
              {displayClassification ? (
                <p className="fragrance-category">{displayClassification}</p>
              ) : null}
              {audienceLabel ? (
                <span className="audience-pill">{audienceLabel}</span>
              ) : null}
            </div>
          ) : null}
          <h3>{displayProductName}</h3>
          {inspiredByText ? <p className="inspired-by">{inspiredByText}</p> : null}
        </div>
        <span className={primaryBadgeClassName}>{primaryBadgeLabel}</span>
      </div>

      {shouldUseCuratedBadgeReason ? (
        <p className="curated-card-note">Curated pick</p>
      ) : (
        <div className="match-reason-block">
          <p className="match-reason-label">Why this fits</p>
          <p className="match-reason">{reason}</p>
        </div>
      )}

      {recommendation.bestFor ? (
        <p className="best-for-line">Best for: {recommendation.bestFor}</p>
      ) : null}

      {previewChips.length ? (
        <div className="note-preview" aria-label="Note preview">
          <ul className="note-list">
            {previewChips.map((note) => (
              <li
                className={sharedNoteSet.has(normalizeNote(note)) ? 'shared-note' : ''}
                key={note}
              >
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}


      <div className="scent-dna-panel" aria-label="Scent DNA">
        <div className="scent-dna-heading">
          <p>Scent DNA</p>
          <span>{wardrobeRole}</span>
        </div>
        <div className="scent-dna-list">
          {scentDna.map((profileItem) => (
            <div className="scent-dna-row" key={profileItem.label}>
              <span>{profileItem.label}</span>
              <div className="scent-dna-track" aria-hidden="true">
                <span style={{ width: `${profileItem.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-actions">
        <button
          className="details-toggle"
          type="button"
          onClick={() => setIsDetailsOpen(true)}
        >
          View details
        </button>
        {productUrl ? (
          <a
            aria-label={`View ${displayProductName} on Mistify`}
            className="mistify-link mistify-link-button"
            href={productUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            View product
          </a>
        ) : null}
      </div>

    </article>

    {isDetailsOpen ? (
      <div
        aria-labelledby={modalTitleId}
        aria-modal="true"
        className="details-modal-overlay"
        role="dialog"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsDetailsOpen(false)
          }
        }}
      >
        <div className="details-modal">
          <div className="details-modal-header">
            <div>
              <p className="details-modal-kicker">
                {isReferenceMode ? 'You may also like' : 'Fragrance to research'}
              </p>
              <h2 id={modalTitleId}>{displayProductName}</h2>
              {inspiredByText ? (
                <p className="inspired-by">{inspiredByText}</p>
              ) : null}
            </div>
            <button
              aria-label="Close details"
              className="modal-close-button"
              type="button"
              onClick={() => setIsDetailsOpen(false)}
            >
              X
            </button>
          </div>

          <div className="details-modal-meta">
            <span className={primaryBadgeClassName}>{primaryBadgeLabel}</span>
            {audienceLabel ? (
              <span className="audience-pill">{audienceLabel}</span>
            ) : null}
            {ratingHighlights.map((badge) => (
              <span className="status-badge" key={badge}>
                {badge}
              </span>
            ))}
            {displayClassification ? (
              <p className="fragrance-category">{displayClassification}</p>
            ) : null}
          </div>

          <div className="details-modal-body">
            <div className="details-modal-column">
              <div className="detail-block why-match-card">
                <p className="detail-label">Why this may fit</p>
                <p className="detail-copy">{detailReason}</p>
                {recommendation.confidenceReason ? (
                  <p className="detail-support-copy">{recommendation.confidenceReason}</p>
                ) : null}
                {whyItMatches.length ? (
                  <ul className="detail-list">
                    {whyItMatches.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {recommendation.watchOut ? (
                <div className="detail-block">
                  <p className="detail-label">Worth noting</p>
                  <p className="detail-copy watch-out-copy">{recommendation.watchOut}</p>
                </div>
              ) : null}

              {recommendation.bestFor ||
              recommendation.bestIfYouLiked ||
              recommendation.referenceConfidenceReason ? (
                <div className="detail-block">
                  <p className="detail-label">Good to know</p>
                  {recommendation.bestFor ? (
                    <p className="detail-copy">Best for: {recommendation.bestFor}</p>
                  ) : null}
                  {recommendation.bestIfYouLiked ? (
                    <p className="detail-copy">{recommendation.bestIfYouLiked}</p>
                  ) : null}
                  {recommendation.referenceConfidenceReason ? (
                    <p className="detail-copy">{recommendation.referenceConfidenceReason}</p>
                  ) : null}
                </div>
              ) : null}

              {scoreItems.length ? (
                <div className="detail-block">
                  <p className="detail-label">Match confidence</p>
                  <dl className="expanded-stat-list">
                    {scoreItems.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {productItems.length ? (
                <div className="detail-block">
                  <p className="detail-label">Product details</p>
                  {productUrl ? (
                    <a
                      aria-label={`View ${displayProductName} on Mistify`}
                      className="mistify-link mistify-link-button"
                      href={productUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      View on Mistify
                    </a>
                  ) : null}
                  <dl className="expanded-stat-list">
                    {productItems.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {detailItems.length ? (
                <div className="detail-block">
                  <p className="detail-label">Rating details</p>
                  <dl className="expanded-stat-list">
                    {detailItems.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </div>

            <div className="details-modal-column notes-column">
              {hasCueDetails ? (
                <div className="detail-block">
                  <p className="detail-label">Matched cues</p>
                  <div className="note-sections">
                    <NoteSection label="Matched notes" notes={matchedNotes} />
                    <NoteSection label="Matched vibes" notes={matchedVibes} />
                    <NoteSection label="Occasions" notes={matchedOccasions} />
                    <NoteSection label="Seasons" notes={matchedSeasons} />
                  </div>
                </div>
              ) : null}

              {scentProfile.length ? (
                <div className="detail-block">
                  <p className="detail-label">Scent profile</p>
                  <div className="note-sections">
                    <NoteSection label="Profile" notes={scentProfile} />
                  </div>
                </div>
              ) : null}

              {hasReferenceChipDetails ? (
                <div className="detail-block">
                  <p className="detail-label">Reference relationship</p>
                  <div className="note-sections">
                    <NoteSection label="Shared with reference" notes={sharedWithReference} />
                    <NoteSection label="Different direction" notes={differentFromReference} />
                    <NoteSection label="Less present than reference" notes={missingFromReference} />
                  </div>
                </div>
              ) : null}

              {hasGroupedNotes || shouldShowFallbackNotes ? (
                <div className="detail-block">
                  <p className="detail-label">Notes</p>
                  {hasGroupedNotes ? (
                    <div className="note-sections">
                      <NoteSection label="TOP" notes={topNotes} sharedNoteSet={sharedNoteSet} />
                      <NoteSection label="MIDDLE" notes={middleNotes} sharedNoteSet={sharedNoteSet} />
                      <NoteSection label="BASE" notes={baseNotes} sharedNoteSet={sharedNoteSet} />
                    </div>
                  ) : shouldShowFallbackNotes ? (
                    <div className="note-sections">
                      <NoteSection label="NOTES" notes={allNotes} sharedNoteSet={sharedNoteSet} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      ) : null}
    </>
  )
}

function FragranceCard(props: FragranceCardProps) {
  return useFragranceCardContent(props)
}

export default FragranceCard
