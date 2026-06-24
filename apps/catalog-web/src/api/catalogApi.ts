export type CatalogFragrance = {
  id: number
  fragranceSlug: string
  brandName: string | null
  brandSlug: string | null
  originalFragranceName: string | null
  originalFragranceSlug: string | null
  mistifyProductName: string | null
  mistifyProductSlug: string | null
  mistifyProductUrl: string | null
  publicInspiredByLabel: string
  audience: string | null
  classification: string | null
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  catalogImageUrl: string | null
  searchableText?: string
  createdAt?: string | null
  sharedNotes?: string[]
}

export type CatalogBrand = {
  brandName: string
  brandSlug: string
  fragranceCount: number
  searchableText?: string
}

export type CatalogPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type CatalogFragrancesResponse = {
  fragrances: CatalogFragrance[]
  pagination: CatalogPagination
}

export type CatalogBrandsResponse = {
  brands: CatalogBrand[]
}

export type CatalogBrandResponse = {
  brand: CatalogBrand
  fragrances: CatalogFragrance[]
}

export type CatalogFragranceResponse = {
  fragrance: CatalogFragrance
}

export type CatalogSimilarResponse = {
  fragrances: CatalogFragrance[]
}

export type CatalogQueryParams = Record<string, string | number | undefined>

const DATA_BASE = '/data'
const DEFAULT_PAGE_SIZE = 24
const MAX_PAGE_SIZE = 60
const catalogRequestCache = new Map<string, Promise<unknown>>()

async function getJson<T>(path: string, errorMessage: string): Promise<T> {
  const cachedRequest = catalogRequestCache.get(path)

  if (cachedRequest) {
    return cachedRequest as Promise<T>
  }

  const request = fetch(`${DATA_BASE}${path}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(errorMessage)
      }

      return response.json() as Promise<T>
    })
    .catch((error) => {
      catalogRequestCache.delete(path)
      throw error
    })

  catalogRequestCache.set(path, request)

  return request
}

function firstParamValue(value: string | number | undefined): string {
  return value === undefined ? '' : String(value).trim()
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function searchableTextFor(fragrance: CatalogFragrance): string {
  return [
    fragrance.searchableText,
    fragrance.brandName,
    fragrance.originalFragranceName,
    fragrance.mistifyProductName,
    fragrance.publicInspiredByLabel,
    fragrance.classification,
    fragrance.audience,
    ...fragrance.topNotes,
    ...fragrance.middleNotes,
    ...fragrance.baseNotes,
    ...fragrance.allNotes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function matchesFilters(fragrance: CatalogFragrance, params: CatalogQueryParams): boolean {
  const q = normalize(firstParamValue(params.q))
  const brand = normalize(firstParamValue(params.brand))
  const note = normalize(firstParamValue(params.note))
  const audience = normalize(firstParamValue(params.audience))
  const classification = normalize(firstParamValue(params.classification))

  if (q && !searchableTextFor(fragrance).includes(q)) {
    return false
  }

  if (brand && normalize(fragrance.brandSlug) !== brand) {
    return false
  }

  if (note && !fragrance.allNotes.some((value) => normalize(value) === note)) {
    return false
  }

  if (audience && !normalize(fragrance.audience).includes(audience)) {
    return false
  }

  if (classification && !normalize(fragrance.classification).includes(classification)) {
    return false
  }

  return true
}

function sortFragrances(fragrances: CatalogFragrance[], sort: string) {
  const sorted = [...fragrances]

  if (sort === 'name') {
    return sorted.sort(
      (first, second) =>
        normalize(first.originalFragranceName).localeCompare(
          normalize(second.originalFragranceName),
        ) || first.id - second.id,
    )
  }

  if (sort === 'newest') {
    return sorted.sort(
      (first, second) =>
        Date.parse(second.createdAt ?? '') - Date.parse(first.createdAt ?? '') ||
        first.id - second.id,
    )
  }

  return sorted
}

export function clearCatalogRequestCache() {
  catalogRequestCache.clear()
}

export async function fetchCatalogFragrances(
  params: CatalogQueryParams = {},
): Promise<CatalogFragrancesResponse> {
  const response = await getJson<CatalogFragrancesResponse>(
    '/fragrances-index.json',
    'Failed to load catalog fragrances.',
  )
  const page = parsePositiveInt(firstParamValue(params.page), 1)
  const pageSize = Math.min(
    parsePositiveInt(firstParamValue(params.pageSize), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  )
  const filtered = sortFragrances(
    response.fragrances.filter((fragrance) => matchesFilters(fragrance, params)),
    firstParamValue(params.sort),
  )
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize

  return {
    fragrances: filtered.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  }
}

export async function fetchAllCatalogFragrances(): Promise<CatalogFragrance[]> {
  const response = await getJson<CatalogFragrancesResponse>(
    '/fragrances-index.json',
    'Failed to load catalog fragrances.',
  )

  return response.fragrances
}

export async function fetchCatalogBrands(): Promise<CatalogBrandsResponse> {
  return getJson<CatalogBrandsResponse>(
    '/brands-index.json',
    'Failed to load catalog brands.',
  )
}

export async function fetchCatalogBrand(
  brandSlug: string,
): Promise<CatalogBrandResponse> {
  return getJson<CatalogBrandResponse>(
    `/brands/${encodeURIComponent(brandSlug)}.json`,
    'Failed to load catalog brand.',
  )
}

export async function fetchCatalogFragrance(
  fragranceSlug: string,
): Promise<CatalogFragranceResponse> {
  return getJson<CatalogFragranceResponse>(
    `/fragrances/${encodeURIComponent(fragranceSlug)}.json`,
    'Failed to load catalog fragrance.',
  )
}

export async function fetchSimilarFragrances(
  fragranceSlug: string,
): Promise<CatalogSimilarResponse> {
  return getJson<CatalogSimilarResponse>(
    `/similar/${encodeURIComponent(fragranceSlug)}.json`,
    'Failed to load similar fragrances.',
  )
}
