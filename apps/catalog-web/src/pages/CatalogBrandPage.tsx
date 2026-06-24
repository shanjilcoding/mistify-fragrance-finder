import { useEffect, useMemo, useState } from 'react'
import {
  fetchCatalogBrand,
  type CatalogBrand,
  type CatalogFragrance,
} from '../api/catalogApi'
import CatalogLayout from '../components/catalog/CatalogLayout'
import CatalogFragranceCard from '../components/catalog/CatalogFragranceCard'
import GalleryShelfRow from '../components/catalog/GalleryShelfRow'
import { handleInternalLinkClick } from '../utils/catalogNavigation'

const audienceFilters = ['All', 'Men', 'Women', 'Unisex'] as const

type AudienceFilter = (typeof audienceFilters)[number]

const audienceFilterValues: Record<AudienceFilter, string | null> = {
  All: null,
  Men: 'mens',
  Women: 'womens',
  Unisex: 'unisex',
}

function getBrandSlugFromPath(): string {
  const segments = window.location.pathname.split('/').filter(Boolean)

  return decodeURIComponent(segments[2] ?? '')
}

function matchesSearch(fragrance: CatalogFragrance, query: string): boolean {
  const haystack = [
    fragrance.publicInspiredByLabel,
    fragrance.originalFragranceName,
    fragrance.mistifyProductName,
    fragrance.classification,
    fragrance.audience,
    ...fragrance.allNotes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
}

function matchesAudience(fragrance: CatalogFragrance, audienceFilter: AudienceFilter): boolean {
  const audienceValue = audienceFilterValues[audienceFilter]

  if (!audienceValue) {
    return true
  }

  return fragrance.audience?.toLowerCase() === audienceValue
}

type GroupedFragrances = {
  label: string
  fragrances: CatalogFragrance[]
}

function groupByClassification(fragrances: CatalogFragrance[]): GroupedFragrances[] {
  const groups = new Map<string, CatalogFragrance[]>()

  const broadFamily = (fragrance: CatalogFragrance): string => {
    const c = (fragrance.classification || '').toLowerCase()

    if (c.includes('fresh') || c.includes('aromatic') || c.includes('citrus')) return 'Fresh & Clean'
    if (c.includes('woody')) return 'Woody & Earthy'
    if (c.includes('floral') || c.includes('chypre')) return 'Floral'
    if (c.includes('oriental') || c.includes('amber') || c.includes('spicy') || c.includes('gourmand') || c.includes('vanilla')) return 'Warm & Spicy'
    if (c.includes('musky') || c.includes('musk')) return 'Musky'

    return 'Other'
  }

  const order = ['Fresh & Clean', 'Woody & Earthy', 'Floral', 'Warm & Spicy', 'Musky', 'Other']

  for (const f of fragrances) {
    const key = broadFamily(f)

    groups.set(key, [...(groups.get(key) ?? []), f])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      const aIndex = order.indexOf(a)
      const bIndex = order.indexOf(b)

      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
    })
    .map(([label, fragrances]) => ({ label, fragrances }))
}

function CatalogBrandPage() {
  const brandSlug = getBrandSlugFromPath()
  const [brand, setBrand] = useState<CatalogBrand | null>(null)
  const [fragrances, setFragrances] = useState<CatalogFragrance[]>([])
  const [search, setSearch] = useState('')
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('All')
  const [notFoundSlug, setNotFoundSlug] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    fetchCatalogBrand(brandSlug)
      .then((response) => {
        if (!ignore) {
          setBrand(response.brand)
          setFragrances(response.fragrances)
          setNotFoundSlug(null)
        }
      })
      .catch(() => {
        if (!ignore) {
          setBrand(null)
          setFragrances([])
          setNotFoundSlug(brandSlug)
        }
      })

    return () => {
      ignore = true
    }
  }, [brandSlug])

  const visibleFragrances = useMemo(() => {
    const query = search.trim().toLowerCase()

    return fragrances.filter((fragrance) => {
      const passesSearch = query ? matchesSearch(fragrance, query) : true
      const passesAudience = matchesAudience(fragrance, audienceFilter)

      return passesSearch && passesAudience
    })
  }, [audienceFilter, fragrances, search])

  const isCurrentBrand = brand?.brandSlug === brandSlug
  const notFound = notFoundSlug === brandSlug
  const isLoading = !notFound && !isCurrentBrand

  const shelves = useMemo(
    () => groupByClassification(visibleFragrances),
    [visibleFragrances],
  )

  return (
    <CatalogLayout>
      {isLoading ? (
        <p className="catalog-status">Loading fragrances…</p>
      ) : notFound || !brand ? (
        <div>
          <p className="catalog-eyebrow">Brand not found</p>
          <h1>We couldn't find that brand</h1>
          <p className="catalog-section-lead">
            It may not have any catalog fragrances yet.{' '}
            <a href="/catalog/brands" onClick={handleInternalLinkClick('/catalog/brands')}>
              Back to Inspired By Directory.
            </a>
          </p>
        </div>
      ) : (
        <>
          <section className="catalog-page-panel catalog-bestsellers-hero catalog-bestsellers-hero--editorial catalog-inner-title-card catalog-brand-title-card">
            <div>
              <h1>{brand.brandName}-inspired fragrances</h1>
            </div>
          </section>

          <section className="catalog-blueprint-frame catalog-brand-blueprint catalog-brand-blueprint--after-title">
            <div className="catalog-brand-blueprint__body">
              <div className="catalog-gallery-filters">
                <label className="catalog-search catalog-brand-search">
                  <span className="sr-only">Search within {brand.brandName}</span>
                  <input
                    type="search"
                    value={search}
                    placeholder="Search this house"
                    aria-label={`Search within ${brand.brandName}`}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="catalog-audience-filter" aria-label="Filter by audience">
                  {audienceFilters.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`catalog-chip ${audienceFilter === filter ? 'is-active' : ''}`}
                      onClick={() => setAudienceFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {visibleFragrances.length ? (
                shelves.map((shelf) => (
                  <div className="catalog-gallery-shelf" key={shelf.label}>
                    <h2 className="catalog-gallery-shelf__label">
                      {shelf.label}
                      <small>{shelf.fragrances.length} {shelf.fragrances.length === 1 ? 'fragrance' : 'fragrances'}</small>
                    </h2>
                    <GalleryShelfRow>
                      {shelf.fragrances.map((fragrance) => (
                        <CatalogFragranceCard
                          key={fragrance.id}
                          fragrance={fragrance}
                          variant="gallery"
                        />
                      ))}
                    </GalleryShelfRow>
                  </div>
                ))
              ) : (
                <p className="catalog-status">No fragrances match your filters.</p>
              )}
            </div>
          </section>
        </>
      )}
    </CatalogLayout>
  )
}

export default CatalogBrandPage
