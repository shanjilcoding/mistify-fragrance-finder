import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  fetchCatalogBrand,
  fetchCatalogBrands,
  type CatalogBrand,
} from '../api/catalogApi'
import CatalogLayout from '../components/catalog/CatalogLayout'
import { handleInternalLinkClick } from '../utils/catalogNavigation'

function groupBrandsByLetter(brands: CatalogBrand[]) {
  const groups = new Map<string, CatalogBrand[]>()

  for (const brand of brands) {
    const letter = (brand.brandName.trim()[0] ?? '#').toUpperCase()
    const key = /[A-Z]/.test(letter) ? letter : '#'

    groups.set(key, [...(groups.get(key) ?? []), brand])
  }

  return Array.from(groups.entries()).sort(([first], [second]) =>
    first.localeCompare(second),
  )
}

function distributeBrandGroups(groups: Array<[string, CatalogBrand[]]>, columnCount = 3) {
  const columns: Array<Array<[string, CatalogBrand[]]>> = Array.from(
    { length: columnCount },
    () => [],
  )
  const columnWeights = Array.from({ length: columnCount }, () => 0)

  groups.forEach((group, index) => {
    const weight = group[1].length + 1

    if (index < columnCount) {
      columns[index].push(group)
      columnWeights[index] += weight
      return
    }

    const shortestColumnIndex = columnWeights.indexOf(Math.min(...columnWeights))

    columns[shortestColumnIndex].push(group)
    columnWeights[shortestColumnIndex] += weight
  })

  return columns.filter((column) => column.length > 0)
}

function getBrandFragranceCountLabel(count: number) {
  return `${count} ${count === 1 ? 'fragrance' : 'fragrances'}`
}

function getBrandCountLabel(count: number) {
  return `${count} ${count === 1 ? 'brand' : 'brands'}`
}

function scrollToBrandLetter(letter: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const targetId = window.matchMedia('(max-width: 940px)').matches
      ? `brand-letter-mobile-${letter}`
      : `brand-letter-${letter}`
    const target = document.getElementById(targetId)

    if (!target) {
      return
    }

    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${targetId}`)
  }
}

function CatalogBrandsPage() {
  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    fetchCatalogBrands()
      .then((brandResponse) => {
        if (!ignore) {
          setBrands(brandResponse.brands)
        }
      })
      .catch(() => {
        if (!ignore) {
          setError('We could not load brands right now. Please try again.')
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  const filteredBrands = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return brands
    }

    return brands.filter((brand) => {
      const searchableText = `${brand.brandName} ${brand.searchableText ?? ''}`.toLowerCase()

      return searchableText.includes(query)
    })
  }, [brands, search])

  const groupedBrands = useMemo(
    () => groupBrandsByLetter(filteredBrands),
    [filteredBrands],
  )
  const brandColumns = useMemo(
    () => distributeBrandGroups(groupedBrands),
    [groupedBrands],
  )
  const letters = groupedBrands.map(([letter]) => letter)

  return (
    <CatalogLayout>
      <section className="catalog-page-panel catalog-bestsellers-hero catalog-bestsellers-hero--editorial catalog-inner-title-card catalog-brands-title-card">
        <div className="catalog-blueprint-intro catalog-blueprint-intro--with-search">
          <h1>All Inspired By Fragrances.</h1>
          <label className="catalog-search catalog-blueprint-search catalog-blueprint-search--intro">
            <span className="catalog-search-label">Search all brands</span>
            <input
              type="search"
              value={search}
              placeholder="Search brands, fragrances, or notes..."
              aria-label="Search brands or fragrances"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="catalog-blueprint-frame catalog-blueprint-directory catalog-blueprint-directory--after-title">
        <div className="catalog-directory-blueprint-grid catalog-directory-blueprint-grid--single">
          <div className="catalog-directory-main">
            <div className="catalog-directory-main__heading">
              <div>
                <h2>All brands</h2>
              </div>
              <span>{filteredBrands.length} brands</span>
            </div>

            <nav className="catalog-letter-pills" aria-label="Brand letters">
              {letters.map((letter) => (
                <a key={letter} href={`#brand-letter-${letter}`} onClick={scrollToBrandLetter(letter)}>
                  {letter}
                </a>
              ))}
            </nav>

            {error ? <p className="catalog-status catalog-status--error">{error}</p> : null}

            {isLoading ? (
              <p className="catalog-status">Loading brands…</p>
            ) : groupedBrands.length ? (
              <>
                <div className="catalog-brand-index catalog-brand-index--blueprint catalog-brand-index--desktop">
                  {brandColumns.map((column, columnIndex) => (
                    <div className="catalog-brand-index__column" key={`brand-column-${columnIndex}`}>
                      {column.map(([letter, letterBrands]) => (
                        <section className="catalog-brand-group" key={letter} id={`brand-letter-${letter}`}>
                          <div className="catalog-brand-group__heading">
                            <h2>{letter}</h2>
                            <span>{getBrandCountLabel(letterBrands.length)}</span>
                          </div>
                          <div className="catalog-brand-list">
                            {letterBrands.map((brand) => {
                              const brandPath = `/catalog/brands/${brand.brandSlug}`
                              const prefetchBrand = () => {
                                void fetchCatalogBrand(brand.brandSlug).catch(() => undefined)
                              }

                              return (
                                <a
                                  key={brand.brandSlug}
                                  className="catalog-brand-link"
                                  href={brandPath}
                                  onClick={handleInternalLinkClick(brandPath)}
                                  onFocus={prefetchBrand}
                                  onMouseEnter={prefetchBrand}
                                >
                                  <span className="catalog-brand-link__monogram">
                                    {brand.brandName.charAt(0)}
                                  </span>
                                  <span>
                                    <strong>{brand.brandName}</strong>
                                    <small>{getBrandFragranceCountLabel(brand.fragranceCount)}</small>
                                  </span>
                                </a>
                              )
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="catalog-brand-index catalog-brand-index--blueprint catalog-brand-index--mobile">
                  {groupedBrands.map(([letter, letterBrands]) => (
                    <section className="catalog-brand-group" key={letter} id={`brand-letter-mobile-${letter}`}>
                      <div className="catalog-brand-group__heading">
                        <h2>{letter}</h2>
                        <span>{getBrandCountLabel(letterBrands.length)}</span>
                      </div>
                      <div className="catalog-brand-list">
                        {letterBrands.map((brand) => {
                          const brandPath = `/catalog/brands/${brand.brandSlug}`
                          const prefetchBrand = () => {
                            void fetchCatalogBrand(brand.brandSlug).catch(() => undefined)
                          }

                          return (
                            <a
                              key={brand.brandSlug}
                              className="catalog-brand-link"
                              href={brandPath}
                              onClick={handleInternalLinkClick(brandPath)}
                              onFocus={prefetchBrand}
                              onMouseEnter={prefetchBrand}
                            >
                              <span className="catalog-brand-link__monogram">
                                {brand.brandName.charAt(0)}
                              </span>
                              <span>
                                <strong>{brand.brandName}</strong>
                                <small>{getBrandFragranceCountLabel(brand.fragranceCount)}</small>
                              </span>
                            </a>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            ) : !error ? (
              <p className="catalog-status">No brands match your search.</p>
            ) : null}
          </div>
        </div>
      </section>
    </CatalogLayout>
  )
}

export default CatalogBrandsPage
