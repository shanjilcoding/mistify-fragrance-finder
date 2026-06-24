import type { ReactNode } from 'react'
import { handleInternalLinkClick } from '../../utils/catalogNavigation'
import { NON_AFFILIATION_DISCLAIMER } from '../../utils/catalogFormat'
import '../../styles/catalog.css'

type CatalogLayoutProps = {
  children: ReactNode
}

function CatalogLayout({ children }: CatalogLayoutProps) {
  return (
    <div className="catalog-shell">
      <header className="catalog-topbar">
        <div className="catalog-container catalog-topbar__inner">
          <a
            className="catalog-brand-lockup"
            href="/catalog"
            onClick={handleInternalLinkClick('/catalog')}
          >
            <span className="catalog-brand-mark">mistify</span>
            <span className="catalog-brand-tagline">Fragrance Catalog</span>
          </a>
          <nav className="catalog-topbar-nav" aria-label="Catalog navigation">
            <a href="/catalog/best-sellers" onClick={handleInternalLinkClick('/catalog/best-sellers')}>
              Best Sellers
            </a>
            <a href="/catalog/brands" onClick={handleInternalLinkClick('/catalog/brands')}>
              All Inspired By Fragrances
            </a>
          </nav>
        </div>
      </header>

      <main className="catalog-main">
        <div className="catalog-container">{children}</div>
      </main>

      <footer className="catalog-footer">
        <div className="catalog-container">
          <p className="catalog-disclaimer">{NON_AFFILIATION_DISCLAIMER}</p>
        </div>
      </footer>
    </div>
  )
}

export default CatalogLayout
