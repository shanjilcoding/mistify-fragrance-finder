import { useEffect, useState } from 'react'
import {
  fetchCatalogFragrance,
  fetchSimilarFragrances,
  type CatalogFragrance,
} from '../api/catalogApi'
import CatalogLayout from '../components/catalog/CatalogLayout'
import NotePyramid from '../components/catalog/NotePyramid'
import SimilarFragranceCard from '../components/catalog/SimilarFragranceCard'
import {
  formatNoteList,
  getDisplayClassification,
  getDisplayProductName,
  getSafeProductUrl,
  hasUsableProductName,
} from '../utils/catalogFormat'
import {
  contactMistifyToOrder,
  handleInternalLinkClick,
} from '../utils/catalogNavigation'

const DEFAULT_CATALOG_IMAGE = '/assets/mistify/catalog/default-fragrance-bottle.jpeg'

function getFragranceSlugFromPath(): string {
  const segments = window.location.pathname.split('/').filter(Boolean)

  return decodeURIComponent(segments[2] ?? '')
}

function buildDescription(fragrance: CatalogFragrance): string {
  const parts: string[] = []

  if (fragrance.originalFragranceName) {
    parts.push(`Inspired by ${fragrance.originalFragranceName}`)
  } else if (fragrance.publicInspiredByLabel) {
    parts.push(fragrance.publicInspiredByLabel)
  }

  const classification = getDisplayClassification(fragrance.classification).filter(Boolean)

  if (classification.length) {
    parts.push(`A ${classification.join(' · ').toLowerCase()} fragrance`)
  }

  if (fragrance.allNotes.length) {
    parts.push(`featuring notes of ${formatNoteList(fragrance.allNotes.slice(0, 4))}`)
  }

  return parts.join(', ')
}

function CatalogFragrancePage() {
  const fragranceSlug = getFragranceSlugFromPath()
  const [fragrance, setFragrance] = useState<CatalogFragrance | null>(null)
  const [similar, setSimilar] = useState<CatalogFragrance[]>([])
  const [notFoundSlug, setNotFoundSlug] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    fetchCatalogFragrance(fragranceSlug)
      .then((response) => {
        if (!ignore) {
          setFragrance(response.fragrance)
          setNotFoundSlug(null)
        }
      })
      .catch(() => {
        if (!ignore) {
          setFragrance(null)
          setSimilar([])
          setNotFoundSlug(fragranceSlug)
        }
      })

    fetchSimilarFragrances(fragranceSlug)
      .then((response) => {
        if (!ignore) {
          setSimilar(response.fragrances)
        }
      })
      .catch(() => {
        if (!ignore) {
          setSimilar([])
        }
      })

    return () => {
      ignore = true
    }
  }, [fragranceSlug])

  const isCurrentFragrance = fragrance?.fragranceSlug === fragranceSlug
  const notFound = notFoundSlug === fragranceSlug
  const isLoading = !notFound && !isCurrentFragrance

  if (isLoading) {
    return (
      <CatalogLayout>
        <p className="catalog-status">Loading fragrance…</p>
      </CatalogLayout>
    )
  }

  if (notFound || !fragrance) {
    return (
      <CatalogLayout>
        <p className="catalog-eyebrow">Fragrance not found</p>
        <h1>We couldn't find that fragrance</h1>
        <p className="catalog-section-lead">
          It may have been removed or is not currently available.{' '}
          <a href="/catalog" onClick={handleInternalLinkClick('/catalog')}>
            Return to the catalog.
          </a>
        </p>
      </CatalogLayout>
    )
  }

  const productName = getDisplayProductName(fragrance)
  const hasProductName = hasUsableProductName(fragrance)
  const heroImage = fragrance.catalogImageUrl ?? DEFAULT_CATALOG_IMAGE
  const productUrl = getSafeProductUrl(fragrance.mistifyProductUrl)
  const primaryNotes = fragrance.allNotes.slice(0, 4)
  const description = buildDescription(fragrance)
  const inspiredBy = fragrance.originalFragranceName
    ? `Inspired by ${fragrance.originalFragranceName}`
    : fragrance.publicInspiredByLabel || null

  return (
    <CatalogLayout>
      {/* Hero split: dark image panel + info */}
      <section className="catalog-blueprint-frame catalog-detail-blueprint">
        <div className="catalog-detail-blueprint__art" aria-hidden="true">
          <div className="catalog-detail-glow" />
          <img src={heroImage} alt="" />
        </div>

        <div className="catalog-detail-blueprint__content">
          {inspiredBy ? (
            <p className="catalog-detail-inspo">{inspiredBy}</p>
          ) : null}

          <h1 className="catalog-detail__title">
            {hasProductName ? productName : productName}
          </h1>

          {description ? (
            <p className="catalog-detail-desc">{description}.</p>
          ) : null}

          {primaryNotes.length ? (
            <div className="catalog-detail-note-strip">
              {primaryNotes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </div>
          ) : null}

          <div className="catalog-detail__actions">
            {productUrl ? (
              <a
                className="catalog-button catalog-button--primary"
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Shop fragrance
              </a>
            ) : (
              <button
                type="button"
                className="catalog-button catalog-button--primary"
                onClick={() => contactMistifyToOrder(fragrance)}
              >
                Contact Mistify Team to Order
              </button>
            )}
            <button
              type="button"
              className="catalog-button"
              onClick={() => {
                window.open(
                  `https://mistify-chatbot.vercel.app/?prompt=Tell me about ${encodeURIComponent(productName)}`,
                  '_blank',
                )
              }}
            >
              Ask Mistify AI
            </button>
          </div>
        </div>
      </section>

      {/* Full note pyramid */}
      <section className="catalog-detail-extra catalog-blueprint-frame">
        <h2>Notes</h2>
        <NotePyramid
          topNotes={fragrance.topNotes}
          middleNotes={fragrance.middleNotes}
          baseNotes={fragrance.baseNotes}
          allNotes={fragrance.allNotes}
        />
      </section>

      {/* Similar fragrances */}
      {similar.length ? (
        <section className="catalog-detail-extra catalog-blueprint-frame">
          <h2>Similar Mistify Fragrances</h2>
          <div className="catalog-similar-grid">
            {similar.map((item) => (
              <SimilarFragranceCard key={item.id} fragrance={item} />
            ))}
          </div>
        </section>
      ) : null}
    </CatalogLayout>
  )
}

export default CatalogFragrancePage
