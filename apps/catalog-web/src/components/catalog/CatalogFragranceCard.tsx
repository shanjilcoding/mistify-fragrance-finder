import type { CatalogFragrance } from '../../api/catalogApi'
import {
  fetchCatalogFragrance,
  fetchSimilarFragrances,
} from '../../api/catalogApi'
import AudienceBadge from './AudienceBadge'
import {
  formatNoteList,
  getDisplayClassification,
  getDisplayProductName,
  getNotePreview,
  getSafeProductUrl,
  hasUsableProductName,
} from '../../utils/catalogFormat'
import {
  askChatbotAbout,
  contactMistifyToOrder,
  handleInternalLinkClick,
} from '../../utils/catalogNavigation'

type CatalogFragranceCardProps = {
  fragrance: CatalogFragrance
  variant?: 'default' | 'gallery'
}

const DEFAULT_CATALOG_IMAGE = '/assets/mistify/catalog/default-fragrance-bottle.jpeg'

function CatalogFallbackArt({ imageUrl }: { imageUrl: string | null }) {
  return (
    <div className="catalog-card__art">
      <img src={imageUrl ?? DEFAULT_CATALOG_IMAGE} alt="" aria-hidden="true" />
    </div>
  )
}

function CatalogFragranceCard({ fragrance, variant = 'default' }: CatalogFragranceCardProps) {
  const detailPath = `/catalog/fragrances/${fragrance.fragranceSlug}`
  const productName = getDisplayProductName(fragrance)
  const hasProductName = hasUsableProductName(fragrance)
  const classification = getDisplayClassification(fragrance.classification)
  const notePreview = getNotePreview(fragrance)
  const productUrl = getSafeProductUrl(fragrance.mistifyProductUrl)
  const meta = classification.filter(Boolean).join(' · ')
  const prefetchDetail = () => {
    void fetchCatalogFragrance(fragrance.fragranceSlug).catch(() => undefined)
    void fetchSimilarFragrances(fragrance.fragranceSlug).catch(() => undefined)
  }

  const isGallery = variant === 'gallery'
  const cardClass = isGallery ? 'catalog-card catalog-card--gallery' : 'catalog-card'

  return (
    <article className={cardClass}>
      <CatalogFallbackArt imageUrl={fragrance.catalogImageUrl} />

      <div className="catalog-card__content">
        <div className="catalog-card__heading-row">
          <p className="catalog-card__eyebrow">
            {fragrance.publicInspiredByLabel || 'Inspired fragrance'}
          </p>
          <AudienceBadge audience={fragrance.audience} />
        </div>
        <h3 className="catalog-card__title">
          <a
            href={detailPath}
            onClick={handleInternalLinkClick(detailPath)}
            onFocus={prefetchDetail}
            onMouseEnter={prefetchDetail}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {hasProductName ? `Mistify: ${productName}` : productName}
          </a>
        </h3>

        {meta ? <p className="catalog-card__meta">{meta}</p> : null}

        {notePreview.length ? (
          <p className="catalog-card__notes">{formatNoteList(notePreview)}</p>
        ) : null}

        {isGallery && classification[0] ? (
          <span
            className="catalog-gallery-tag"
            data-scent={classification[0].toLowerCase()}
          >
            {classification.join(' · ')}
          </span>
        ) : null}

        <div className="catalog-card__actions">
          <a
            className="catalog-button catalog-button--block"
            href={detailPath}
            onClick={handleInternalLinkClick(detailPath)}
            onFocus={prefetchDetail}
            onMouseEnter={prefetchDetail}
          >
            View Details
          </a>
          {productUrl ? (
            <a
              className="catalog-button catalog-button--primary catalog-button--block"
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Shop Mistify
            </a>
          ) : (
            <button
              type="button"
              className="catalog-button catalog-button--primary catalog-button--block"
              onClick={() => contactMistifyToOrder(fragrance)}
            >
              Contact Mistify Team to Order
            </button>
          )}
          <button
            type="button"
            className="catalog-button catalog-button--small"
            onClick={() => askChatbotAbout(fragrance)}
          >
            Ask
          </button>
        </div>
      </div>
    </article>
  )
}

export default CatalogFragranceCard
