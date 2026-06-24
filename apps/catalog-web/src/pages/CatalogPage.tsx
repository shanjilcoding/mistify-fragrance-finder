import { useEffect } from 'react'
import { fetchCatalogBrands } from '../api/catalogApi'
import { handleInternalLinkClick } from '../utils/catalogNavigation'
import { NON_AFFILIATION_DISCLAIMER } from '../utils/catalogFormat'
import '../styles/catalogLanding.css'

const LOGO_URL = '/assets/mistify/catalog-landing/mistify-logo-white.png'

// Catalog landing page — a cinematic, image-led entry point into the Mistify
// fragrance catalog. The product scene is a CSS background; all logo text, nav,
// headline, copy, and buttons are real HTML/CSS for sharpness and a11y.
function CatalogPage() {
  useEffect(() => {
    document.body.classList.add('mistify-catalog-page')
    void fetchCatalogBrands().catch(() => undefined)

    return () => {
      document.body.classList.remove('mistify-catalog-page')
    }
  }, [])

  return (
    <section className="mistify-catalog-hero" aria-labelledby="mistify-hero-title">
      <header className="mistify-catalog-header">
        <a
          className="mistify-brand"
          href="/catalog"
          aria-label="Mistify Fragrance Catalog"
          onClick={handleInternalLinkClick('/catalog')}
        >
          <img className="mistify-brand-logo" src={LOGO_URL} alt="Mistify" />
        </a>
      </header>

      <div className="mistify-hero-content">
        <p className="mistify-eyebrow">MISTIFY PARFUMS</p>

        <h1 id="mistify-hero-title">
          Fragrance
          <br />
          Catalog
        </h1>

        <p className="mistify-hero-copy">
          Explore designer-inspired fragrances by scent profile, brand, product
          name, and notes.
        </p>

        <div className="mistify-hero-actions">
          <a
            className="mistify-btn mistify-btn-primary"
            href="/catalog/best-sellers"
            onClick={handleInternalLinkClick('/catalog/best-sellers')}
          >
            View Best Sellers
          </a>
          <a
            className="mistify-btn mistify-btn-primary"
            href="/catalog/brands"
            onClick={handleInternalLinkClick('/catalog/brands')}
          >
            View All Inspired By Fragrances
          </a>
        </div>
      </div>

      <p className="mistify-hero-disclaimer">{NON_AFFILIATION_DISCLAIMER}</p>
    </section>
  )
}

export default CatalogPage
