import { apiUrl } from './apiUrl'

export type AdminProduct = {
  id: number
  originalFragranceName: string | null
  sourceBrandBatch: string | null
  classification: string | null
  mistifyProductName: string | null
  mistifyProductUrl: string | null
  verifiedOnMistify: boolean | null
  sourceStatus: string | null
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
}

export type AdminFragranceSearchProduct = AdminProduct & {
  chipMemberships: Array<{
    chipId: number
    label: string
  }>
}

export type AdminProductsQuery = {
  q?: string
  missingProductName?: boolean
  missingProductUrl?: boolean
  sourceBrandBatch?: string
  classification?: string
  verifiedOnMistify?: string
  sourceStatus?: string
  sortBy?: string
  sortDirection?: string
  page?: number
  pageSize?: number
}

export type AdminProductsResponse = {
  products: AdminProduct[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type AdminChip = {
  id: number
  label: string
  description: string | null
  isActive: boolean
  sortOrder: number
  selectedFragranceCount: number
}

export type AdminPromptChip = {
  id: number
  label: string
  prompt: string
  isActive: boolean
  sortOrder: number
}

export type AdminChipFragrance = {
  id: number
  chipId: number
  fragranceId: number
  sortOrder: number
  adminNote: string | null
  fragrance: AdminProduct
}

async function readJson<T extends object>(response: Response): Promise<T> {
  const data = (await response.json()) as T | { error?: string }

  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : 'Request failed.')
  }

  return data as T
}

export async function loginAdmin(username: string, password: string) {
  const response = await fetch(`${apiUrl}/admin/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  return readJson<{ token: string; expiresInSeconds: number }>(response)
}

export async function logoutAdmin(token: string) {
  const response = await fetch(`${apiUrl}/admin/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return readJson<{ success: boolean }>(response)
}

export async function getAdminProducts(
  token: string,
  query: AdminProductsQuery,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value))
    }
  })

  const response = await fetch(`${apiUrl}/admin/products?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })

  return readJson<AdminProductsResponse>(response)
}

export async function updateAdminProduct(
  token: string,
  id: number,
  product: {
    mistifyProductName?: string
    mistifyProductUrl?: string
  },
) {
  const response = await fetch(`${apiUrl}/admin/products/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(product),
  })

  return readJson<{ product: AdminProduct }>(response)
}

export async function getAdminChips(token: string) {
  const response = await fetch(`${apiUrl}/admin/chips`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ chips: AdminChip[] }>(response)
}

export async function getAdminPromptChips(token: string) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ chips: AdminPromptChip[] }>(response)
}

export async function createAdminPromptChip(
  token: string,
  chip: Omit<AdminPromptChip, 'id'>,
) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chip),
  })

  return readJson<{ chip: AdminPromptChip }>(response)
}

export async function updateAdminPromptChip(
  token: string,
  id: number,
  chip: Partial<Omit<AdminPromptChip, 'id'>>,
) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chip),
  })

  return readJson<{ chip: AdminPromptChip }>(response)
}

export async function deleteAdminPromptChip(token: string, id: number) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ success: boolean }>(response)
}

export async function bulkCreateAdminPromptChips(
  token: string,
  chips: Array<{
    label: string
    prompt: string
    sortOrder?: number
    isActive?: boolean
  }>,
) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips/bulk`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chips }),
  })

  return readJson<{
    created: number
    skipped: number
    errors: string[]
    skippedRows?: string[]
    chips: AdminPromptChip[]
  }>(response)
}

export async function reorderAdminPromptChips(
  token: string,
  items: Array<{ id: number; sortOrder: number }>,
) {
  const response = await fetch(`${apiUrl}/admin/prompt-chips/reorder`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  })

  return readJson<{ chips: AdminPromptChip[] }>(response)
}

export async function createAdminChip(
  token: string,
  chip: Omit<AdminChip, 'id' | 'selectedFragranceCount'>,
) {
  const response = await fetch(`${apiUrl}/admin/chips`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chip),
  })

  return readJson<{ chip: AdminChip }>(response)
}

export async function updateAdminChip(
  token: string,
  id: number,
  chip: Partial<Omit<AdminChip, 'id' | 'selectedFragranceCount'>>,
) {
  const response = await fetch(`${apiUrl}/admin/chips/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chip),
  })

  return readJson<{ chip: AdminChip }>(response)
}

export async function deleteAdminChip(token: string, id: number) {
  const response = await fetch(`${apiUrl}/admin/chips/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ success: boolean }>(response)
}

export async function getAdminChipFragrances(token: string, chipId: number) {
  const response = await fetch(`${apiUrl}/admin/chips/${chipId}/fragrances`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ fragrances: AdminChipFragrance[] }>(response)
}

export async function searchAdminFragrances(token: string, q: string) {
  const params = new URLSearchParams({ q })
  const response = await fetch(`${apiUrl}/admin/fragrances/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ fragrances: AdminFragranceSearchProduct[] }>(response)
}

export async function addAdminChipFragrance(
  token: string,
  chipId: number,
  fragranceId: number,
  data?: { sortOrder?: number; adminNote?: string },
) {
  const response = await fetch(`${apiUrl}/admin/chips/${chipId}/fragrances`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fragranceId, ...data }),
  })

  return readJson<{ fragrance: AdminChipFragrance }>(response)
}

export async function updateAdminChipFragrance(
  token: string,
  chipId: number,
  fragranceId: number,
  data: { sortOrder?: number; adminNote?: string },
) {
  const response = await fetch(`${apiUrl}/admin/chips/${chipId}/fragrances/${fragranceId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  return readJson<{ fragrance: AdminChipFragrance }>(response)
}

export async function removeAdminChipFragrance(
  token: string,
  chipId: number,
  fragranceId: number,
) {
  const response = await fetch(`${apiUrl}/admin/chips/${chipId}/fragrances/${fragranceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  return readJson<{ success: boolean }>(response)
}

// ── Mistify Catalog Sync ──────────────────────────────────────

export type SyncMatchRow = {
  fragranceId: number
  sourceBrandBatch: string
  originalFragranceName: string
  oldMistifyProductName: string
  oldMistifyProductUrl: string
  oldCatalogImageUrl: string
  newMistifyProductName: string
  newMistifyProductUrl: string
  newCatalogImageUrl: string
  shopHandle: string
  matchType: string
  matchConfidence: 'high' | 'medium' | 'low'
  fieldsToUpdate: string[]
  reason: string
}

export type SyncManualReviewRow = SyncMatchRow & {
  reviewReason: string
}

export type SyncSkippedRow = {
  fragranceId: number
  sourceBrandBatch: string
  originalFragranceName: string
  mistifyProductName: string
  mistifyProductUrl: string
  reason: string
}

export type AnalyzeResult = {
  shopProductsFetched: number
  dbFragrancesRead: number
  highConfidenceMatches: SyncMatchRow[]
  manualReviewRows: SyncManualReviewRow[]
  skippedRows: SyncSkippedRow[]
  newProductCandidates: NewProductCandidate[]
  staleDbProductUrls: Array<{
    fragranceId: number
    originalFragranceName: string
    mistifyProductUrl: string
  }>
}

export type NewProductCandidate = {
  shopTitle: string
  shopHandle: string
  shopUrl: string
  imageUrl: string
  vendor: string
  inspirationText: string
  originalFragranceName: string
  sourceBrandBatch: string
  classification: string
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  brandName: string | null
  brandSlug: string | null
  originalFragranceSlug: string | null
  mistifyProductSlug: string | null
  publicInspiredByLabel: string | null
  searchableText: string
  isCatalogVisible: boolean
  duplicateReasons: string[]
  missingFields: string[]
}

export type ApplyInput = {
  fragranceId: number
  mistifyProductName?: string
  mistifyProductUrl?: string
  catalogImageUrl?: string
}

export type ApplyResult = {
  updatedCount: number
  importedCount: number
  catalogFieldsRecomputed: number
}

export async function analyzeMistifySync(token: string, scope: string = 'all') {
  const response = await fetch(`${apiUrl}/admin/sync-catalog/analyze`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scope }),
  })

  return readJson<AnalyzeResult>(response)
}

export async function applyMistifySync(
  token: string,
  updates: ApplyInput[],
  imports: NewProductCandidate[] = [],
) {
  const response = await fetch(`${apiUrl}/admin/sync-catalog/apply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates, imports }),
  })

  return readJson<ApplyResult>(response)
}
