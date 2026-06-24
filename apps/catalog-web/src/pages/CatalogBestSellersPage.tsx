import { useEffect, useMemo, useState } from 'react'
import {
  fetchAllCatalogFragrances,
  type CatalogFragrance,
} from '../api/catalogApi'
import CatalogLayout from '../components/catalog/CatalogLayout'
import CatalogFragranceCard from '../components/catalog/CatalogFragranceCard'
import GalleryShelfRow from '../components/catalog/GalleryShelfRow'

const menBestSellerIds = [31, 124, 32, 17, 117, 27, 125, 33, 225, 242]
const womenBestSellerIds = [18, 37, 30, 145, 126, 100, 38, 100, 108, 61]

type Tab = 'All' | 'Men' | 'Women'

type GroupedFragrances = {
  label: string
  fragrances: CatalogFragrance[]
}

function broadFamily(fragrance: CatalogFragrance): string {
  const c = (fragrance.classification || '').toLowerCase()

  if (c.includes('fresh') || c.includes('aromatic') || c.includes('citrus')) return 'Fresh & Clean'
  if (c.includes('woody')) return 'Woody & Earthy'
  if (c.includes('floral') || c.includes('chypre')) return 'Floral'
  if (c.includes('oriental') || c.includes('amber') || c.includes('spicy') || c.includes('gourmand') || c.includes('vanilla')) return 'Warm & Spicy'
  if (c.includes('musky') || c.includes('musk')) return 'Musky'

  return 'Other'
}

function groupByScentFamily(fragrances: CatalogFragrance[]): GroupedFragrances[] {
  const groups = new Map<string, CatalogFragrance[]>()
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

function CatalogBestSellersPage() {
  const [allFragrances, setAllFragrances] = useState<CatalogFragrance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('All')

  useEffect(() => {
    let ignore = false

    fetchAllCatalogFragrances()
      .then((response) => {
        if (!ignore) {
          setAllFragrances(response)
        }
      })
      .catch(() => {
        if (!ignore) {
          setError('We could not load best sellers right now. Please try again.')
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

  const bestSellerSet = useMemo(() => {
    const menSet = new Set(menBestSellerIds)
    const womenSet = new Set(womenBestSellerIds)

    return { men: menSet, women: womenSet, all: new Set([...menSet, ...womenSet]) }
  }, [])

  const bestSellers = useMemo(() => {
    const all = allFragrances.filter((f) => bestSellerSet.all.has(f.id))

    return all.map((f) => {
      const isMen = bestSellerSet.men.has(f.id)
      const isWomen = bestSellerSet.women.has(f.id)

      return {
        ...f,
        audience: isMen && isWomen ? 'Unisex' : isMen ? 'mens' : 'womens',
      } as CatalogFragrance
    })
  }, [allFragrances, bestSellerSet])

  const filtered = useMemo(() => {
    if (activeTab === 'All') return bestSellers

    const audience = activeTab === 'Men' ? 'mens' : 'womens'

    return bestSellers.filter((f) => f.audience === audience)
  }, [bestSellers, activeTab])

  const shelves = useMemo(() => groupByScentFamily(filtered), [filtered])

  const tabs: Tab[] = ['All', 'Men', 'Women']

  return (
    <CatalogLayout>
      {error ? <p className="catalog-status catalog-status--error">{error}</p> : null}

      {isLoading ? (
        <p className="catalog-status">Loading best sellers…</p>
      ) : (
        <>
          <section className="catalog-page-panel catalog-bestsellers-hero catalog-bestsellers-hero--editorial">
            <div>
              <h1>Best Sellers</h1>
              <p className="catalog-section-lead">
                The most-requested fragrances across fresh, woody, floral, and warm profiles. Browse by shelf or filter by audience.
              </p>
              <div className="catalog-bestseller-tabs" role="tablist" aria-label="Filter by audience">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`catalog-bestseller-tab ${activeTab === tab ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'All' ? 'All Best Sellers' : tab}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {filtered.length ? (
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
            <p className="catalog-status">No best sellers match this filter.</p>
          )}
        </>
      )}
    </CatalogLayout>
  )
}

export default CatalogBestSellersPage
