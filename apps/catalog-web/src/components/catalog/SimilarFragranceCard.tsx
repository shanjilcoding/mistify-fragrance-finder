import type { CatalogFragrance } from '../../api/catalogApi'
import {
  fetchCatalogFragrance,
  fetchSimilarFragrances,
} from '../../api/catalogApi'
import AudienceBadge from './AudienceBadge'
import {
  formatNoteList,
  getDisplayProductName,
  getSafeProductUrl,
  hasUsableProductName,
} from '../../utils/catalogFormat'
import {
  contactMistifyToOrder,
  handleInternalLinkClick,
} from '../../utils/catalogNavigation'

type SimilarFragranceCardProps = {
  fragrance: CatalogFragrance
}

function SimilarFragranceCard({ fragrance }: SimilarFragranceCardProps) {
  const detailPath = `/catalog/fragrances/${fragrance.fragranceSlug}`
  const productName = getDisplayProductName(fragrance)
  const hasProductName = hasUsableProductName(fragrance)
  const sharedNotes = fragrance.sharedNotes ?? []
  const productUrl = getSafeProductUrl(fragrance.mistifyProductUrl)
  const prefetchDetail = () => {
    void fetchCatalogFragrance(fragrance.fragranceSlug).catch(() => undefined)
    void fetchSimilarFragrances(fragrance.fragranceSlug).catch(() => undefined)
  }

  return (
    <article className="catalog-similar-card">
      <div className="catalog-card__heading-row">
        <p className="catalog-card__eyebrow">
          {fragrance.publicInspiredByLabel || 'Inspired fragrance'}
        </p>
        <AudienceBadge audience={fragrance.audience} />
      </div>
      <h3 className="catalog-card__title">
        {hasProductName ? productName : fragrance.publicInspiredByLabel || productName}
      </h3>
      {sharedNotes.length ? (
        <p className="catalog-similar-card__shared">
          Shared notes: {formatNoteList(sharedNotes.slice(0, 4))}
        </p>
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
      </div>
    </article>
  )
}

export default SimilarFragranceCard
