import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { FormEvent } from 'react'
import {
  getAdminProducts,
  updateAdminProduct,
} from '../api/adminApi'
import type { AdminProduct, AdminProductsQuery } from '../api/adminApi'

type AdminProductsPageProps = {
  token: string
  onLogout: () => void
}

type Drafts = Record<number, { mistifyProductName: string; mistifyProductUrl: string }>
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type RowSaveState = Record<number, { status: SaveStatus; message?: string }>
type ProductFilters = {
  q: string
  debouncedQ: string
  missingProductName: boolean
  missingProductUrl: boolean
  sourceBrandBatch: string
  debouncedSourceBrandBatch: string
  classification: string
  debouncedClassification: string
  verifiedOnMistify: string
  sortBy: string
  sortDirection: string
  page: number
  pageSize: number
}
type ProductsState = {
  products: AdminProduct[]
  drafts: Drafts
  rowSaveState: RowSaveState
  editingProductId: number | null
  error: string
  isLoading: boolean
  filters: ProductFilters
  totalPages: number
  total: number
}
type ProductsAction =
  | { type: 'setSearchText'; value: string }
  | { type: 'applySearchText' }
  | { type: 'setSourceBrandBatch'; value: string }
  | { type: 'applySourceBrandBatch' }
  | { type: 'setClassification'; value: string }
  | { type: 'applyClassification' }
  | { type: 'setFilter'; field: 'missingProductName' | 'missingProductUrl'; value: boolean }
  | { type: 'setSelectFilter'; field: 'verifiedOnMistify' | 'sortBy' | 'sortDirection'; value: string }
  | { type: 'setPage'; page: number }
  | { type: 'setPageSize'; pageSize: number }
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; response: Awaited<ReturnType<typeof getAdminProducts>> }
  | { type: 'loadFailed'; message: string }
  | { type: 'editStarted'; product: AdminProduct }
  | { type: 'editCanceled'; product: AdminProduct }
  | { type: 'draftChanged'; productId: number; field: keyof Drafts[number]; value: string }
  | { type: 'rowStatusChanged'; productId: number; state: RowSaveState[number] }
  | { type: 'saveStarted'; productId: number }
  | { type: 'saveSucceeded'; productId: number; product: AdminProduct }
  | { type: 'saveFailed'; productId: number; message: string }

const initialProductsState: ProductsState = {
  products: [],
  drafts: {},
  rowSaveState: {},
  editingProductId: null,
  error: '',
  isLoading: false,
  filters: {
    q: '',
    debouncedQ: '',
    missingProductName: false,
    missingProductUrl: false,
    sourceBrandBatch: '',
    debouncedSourceBrandBatch: '',
    classification: '',
    debouncedClassification: '',
    verifiedOnMistify: '',
    sortBy: 'originalFragranceName',
    sortDirection: 'asc',
    page: 1,
    pageSize: 50,
  },
  totalPages: 1,
  total: 0,
}

const placeholderProductNames = new Set([
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
])

function hasValidProductName(productName: string | null) {
  const trimmedName = productName?.trim() ?? ''

  return trimmedName !== '' && !placeholderProductNames.has(trimmedName.toLowerCase())
}

function AdminMetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  helper: string
  tone?: 'neutral' | 'success' | 'warning'
}) {
  return (
    <article className={`admin-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  )
}

function toProductDraft(product: AdminProduct): Drafts[number] {
  return {
    mistifyProductName: hasValidProductName(product.mistifyProductName)
      ? product.mistifyProductName?.trim() ?? ''
      : '',
    mistifyProductUrl: product.mistifyProductUrl?.trim() ?? '',
  }
}

function productsReducer(state: ProductsState, action: ProductsAction): ProductsState {
  if (action.type === 'setSearchText') {
    return { ...state, filters: { ...state.filters, q: action.value } }
  }

  if (action.type === 'applySearchText') {
    return {
      ...state,
      filters: { ...state.filters, page: 1, debouncedQ: state.filters.q.trim() },
    }
  }

  if (action.type === 'setSourceBrandBatch') {
    return { ...state, filters: { ...state.filters, sourceBrandBatch: action.value } }
  }

  if (action.type === 'applySourceBrandBatch') {
    return {
      ...state,
      filters: {
        ...state.filters,
        page: 1,
        debouncedSourceBrandBatch: state.filters.sourceBrandBatch.trim(),
      },
    }
  }

  if (action.type === 'setClassification') {
    return { ...state, filters: { ...state.filters, classification: action.value } }
  }

  if (action.type === 'applyClassification') {
    return {
      ...state,
      filters: {
        ...state.filters,
        page: 1,
        debouncedClassification: state.filters.classification.trim(),
      },
    }
  }

  if (action.type === 'setFilter') {
    return {
      ...state,
      filters: { ...state.filters, page: 1, [action.field]: action.value },
    }
  }

  if (action.type === 'setSelectFilter') {
    return {
      ...state,
      filters: {
        ...state.filters,
        page: action.field === 'verifiedOnMistify' ? 1 : state.filters.page,
        [action.field]: action.value,
      },
    }
  }

  if (action.type === 'setPage') {
    return { ...state, filters: { ...state.filters, page: action.page } }
  }

  if (action.type === 'setPageSize') {
    return { ...state, filters: { ...state.filters, page: 1, pageSize: action.pageSize } }
  }

  if (action.type === 'loadStarted') {
    return { ...state, isLoading: true, error: '' }
  }

  if (action.type === 'loadSucceeded') {
    const nextDrafts: Drafts = {}

    action.response.products.forEach((product) => {
      nextDrafts[product.id] = state.drafts[product.id] ?? toProductDraft(product)
    })

    return {
      ...state,
      products: action.response.products,
      drafts: nextDrafts,
      totalPages: Math.max(1, action.response.pagination.totalPages),
      total: action.response.pagination.total,
      isLoading: false,
      error: '',
    }
  }

  if (action.type === 'loadFailed') {
    return { ...state, isLoading: false, error: action.message }
  }

  if (action.type === 'editStarted') {
    return {
      ...state,
      editingProductId: action.product.id,
      drafts: {
        ...state.drafts,
        [action.product.id]: toProductDraft(action.product),
      },
      rowSaveState: {
        ...state.rowSaveState,
        [action.product.id]: { status: 'idle' },
      },
    }
  }

  if (action.type === 'editCanceled') {
    return {
      ...state,
      editingProductId: null,
      drafts: {
        ...state.drafts,
        [action.product.id]: toProductDraft(action.product),
      },
      rowSaveState: {
        ...state.rowSaveState,
        [action.product.id]: { status: 'idle' },
      },
    }
  }

  if (action.type === 'draftChanged') {
    const draft = state.drafts[action.productId] ?? {
      mistifyProductName: '',
      mistifyProductUrl: '',
    }

    return {
      ...state,
      drafts: {
        ...state.drafts,
        [action.productId]: { ...draft, [action.field]: action.value },
      },
    }
  }

  if (action.type === 'rowStatusChanged') {
    return {
      ...state,
      rowSaveState: {
        ...state.rowSaveState,
        [action.productId]: action.state,
      },
    }
  }

  if (action.type === 'saveStarted') {
    return productsReducer(state, {
      type: 'rowStatusChanged',
      productId: action.productId,
      state: { status: 'saving' },
    })
  }

  if (action.type === 'saveSucceeded') {
    return {
      ...state,
      products: state.products.map((product) =>
        product.id === action.productId ? action.product : product,
      ),
      drafts: {
        ...state.drafts,
        [action.productId]: toProductDraft(action.product),
      },
      rowSaveState: {
        ...state.rowSaveState,
        [action.productId]: { status: 'saved' },
      },
      editingProductId: null,
    }
  }

  if (action.type === 'saveFailed') {
    return {
      ...state,
      rowSaveState: {
        ...state.rowSaveState,
        [action.productId]: {
          status: 'error',
          message: action.message,
        },
      },
    }
  }

  return state
}

function useAdminProductsPageContent({ token, onLogout }: AdminProductsPageProps) {
  const [state, dispatch] = useReducer(productsReducer, initialProductsState)
  const successTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const activeProductRequest = useRef<{
    key: string
    controller: AbortController
  } | null>(null)
  const latestProductRequestId = useRef(0)
  const {
    products,
    drafts,
    rowSaveState,
    editingProductId,
    error,
    isLoading,
    filters,
    totalPages,
    total,
  } = state
  const {
    q,
    debouncedQ,
    missingProductName,
    missingProductUrl,
    sourceBrandBatch,
    debouncedSourceBrandBatch,
    classification,
    debouncedClassification,
    verifiedOnMistify,
    sortBy,
    sortDirection,
    page,
    pageSize,
  } = filters

  const query = useMemo<AdminProductsQuery>(
    () => ({
      q: debouncedQ,
      missingProductName,
      missingProductUrl,
      sourceBrandBatch: debouncedSourceBrandBatch,
      classification: debouncedClassification,
      verifiedOnMistify,
      sortBy,
      sortDirection,
      page,
      pageSize,
    }),
    [
      debouncedQ,
      missingProductName,
      missingProductUrl,
      debouncedSourceBrandBatch,
      debouncedClassification,
      verifiedOnMistify,
      sortBy,
      sortDirection,
      page,
      pageSize,
    ],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'applySearchText' })
    }, 400)

    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'applySourceBrandBatch' })
    }, 400)

    return () => clearTimeout(timer)
  }, [sourceBrandBatch])

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'applyClassification' })
    }, 400)

    return () => clearTimeout(timer)
  }, [classification])

  useEffect(() => {
    const requestKey = JSON.stringify(query)

    if (
      activeProductRequest.current?.key === requestKey &&
      !activeProductRequest.current.controller.signal.aborted
    ) {
      return
    }

    const controller = new AbortController()
    const requestId = latestProductRequestId.current + 1

    latestProductRequestId.current = requestId
    activeProductRequest.current?.controller.abort()
    activeProductRequest.current = {
      key: requestKey,
      controller,
    }

    async function loadProducts() {
      dispatch({ type: 'loadStarted' })

      try {
        const response = await getAdminProducts(token, query, controller.signal)

        if (requestId === latestProductRequestId.current) {
          dispatch({ type: 'loadSucceeded', response })
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') {
          return
        }

        if (requestId === latestProductRequestId.current) {
          dispatch({
            type: 'loadFailed',
            message: loadError instanceof Error ? loadError.message : 'Unable to load products.',
          })
        }
      } finally {
        if (requestId === latestProductRequestId.current && !controller.signal.aborted) {
          activeProductRequest.current = null
        }
      }
    }

    loadProducts()

    return () => {
      controller.abort()
      if (activeProductRequest.current?.controller === controller) {
        activeProductRequest.current = null
      }
    }
  }, [query, token])

  useEffect(() => {
    const timers = successTimers.current

    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    dispatch({ type: 'applySearchText' })
  }

  function handleEdit(product: AdminProduct) {
    clearTimeout(successTimers.current[product.id])
    dispatch({ type: 'editStarted', product })
  }

  function handleCancel(product: AdminProduct) {
    dispatch({ type: 'editCanceled', product })
  }

  async function handleSave(productId: number) {
    const draft = drafts[productId]

    if (!draft) {
      return
    }

    clearTimeout(successTimers.current[productId])
    dispatch({ type: 'saveStarted', productId })

    try {
      const response = await updateAdminProduct(token, productId, draft)
      dispatch({ type: 'saveSucceeded', productId, product: response.product })
      successTimers.current[productId] = setTimeout(() => {
        dispatch({ type: 'rowStatusChanged', productId, state: { status: 'idle' } })
      }, 1800)
    } catch (saveError) {
      dispatch({
        type: 'saveFailed',
        productId,
        message: saveError instanceof Error ? saveError.message : 'Unable to save product.',
      })
    }
  }

  const currentPageNeedsName = products.filter((product) => !hasValidProductName(product.mistifyProductName)).length
  const currentPageNeedsUrl = products.filter((product) => !(product.mistifyProductUrl?.trim() ?? '')).length
  const activeFilterCount = [
    debouncedQ,
    missingProductName,
    missingProductUrl,
    debouncedSourceBrandBatch,
    debouncedClassification,
    verifiedOnMistify,
  ].filter(Boolean).length
  const activeFilterLabels = [
    debouncedQ ? `Search: ${debouncedQ}` : '',
    missingProductName ? 'Missing name' : '',
    missingProductUrl ? 'Missing URL' : '',
    debouncedSourceBrandBatch ? `Brand: ${debouncedSourceBrandBatch}` : '',
    debouncedClassification ? `Class: ${debouncedClassification}` : '',
    verifiedOnMistify ? `Verified: ${verifiedOnMistify === 'true' ? 'Yes' : 'No'}` : '',
  ].filter(Boolean)

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Mistify Admin</p>
          <h1>Products</h1>
          <p className="admin-header-subtitle">
            Edit Mistify product names and product URLs.
          </p>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <a className="active" href="/admin/products">Products</a>
          <a href="/admin/chips">Chips</a>
          <button type="button" onClick={onLogout}>
            Logout
          </button>
        </nav>
      </header>

      <section className="admin-overview-grid" aria-label="Product workspace overview">
        <AdminMetricCard label="Catalog" value={total.toLocaleString()} helper="Products matching the current view" />
        <AdminMetricCard label="Needs Name" value={currentPageNeedsName} helper="Visible rows missing a mapped product" tone={currentPageNeedsName ? 'warning' : 'success'} />
        <AdminMetricCard label="Needs URL" value={currentPageNeedsUrl} helper="Visible rows without product links" tone={currentPageNeedsUrl ? 'warning' : 'success'} />
        <AdminMetricCard label="Filters" value={activeFilterCount} helper={`Page ${page} of ${totalPages} · ${pageSize} rows`} />
      </section>

      <section className="admin-toolbar admin-command-panel" aria-label="Product filters">
        <div className="admin-toolbar-heading">
          <div>
            <h2>Find Products</h2>
            <p>Search, filter, and sort the current fragrance product metadata.</p>
          </div>
        </div>

        <form className="admin-search" onSubmit={handleSearch}>
          <label htmlFor="product-search">Search</label>
          <input
            id="product-search"
            value={q}
            onChange={(event) => dispatch({ type: 'setSearchText', value: event.target.value })}
            placeholder="Original fragrance, product, source brand, classification"
          />
          <button type="submit">Search</button>
        </form>

        <div className="admin-filter-grid">
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={missingProductName}
              onChange={(event) => {
                dispatch({
                  type: 'setFilter',
                  field: 'missingProductName',
                  value: event.target.checked,
                })
              }}
            />
            Missing product name
          </label>
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={missingProductUrl}
              onChange={(event) => {
                dispatch({
                  type: 'setFilter',
                  field: 'missingProductUrl',
                  value: event.target.checked,
                })
              }}
            />
            Missing product URL
          </label>
          <label>
            Source brand
            <input
              value={sourceBrandBatch}
              onChange={(event) =>
                dispatch({ type: 'setSourceBrandBatch', value: event.target.value })
              }
            />
          </label>
          <label>
            Classification
            <input
              value={classification}
              onChange={(event) =>
                dispatch({ type: 'setClassification', value: event.target.value })
              }
            />
          </label>
          <label>
            Verified
            <select
              value={verifiedOnMistify}
              onChange={(event) => {
                dispatch({
                  type: 'setSelectFilter',
                  field: 'verifiedOnMistify',
                  value: event.target.value,
                })
              }}
            >
              <option value="">Any</option>
              <option value="true">Verified</option>
              <option value="false">Not verified</option>
            </select>
          </label>
          <label>
            Sort
            <select
              value={sortBy}
              onChange={(event) =>
                dispatch({ type: 'setSelectFilter', field: 'sortBy', value: event.target.value })
              }
            >
              <option value="originalFragranceName">Original fragrance name</option>
              <option value="sourceBrandBatch">Source brand</option>
              <option value="mistifyProductName">Mistify product name</option>
              <option value="classification">Classification</option>
            </select>
          </label>
          <label>
            Direction
            <select
              value={sortDirection}
              onChange={(event) =>
                dispatch({
                  type: 'setSelectFilter',
                  field: 'sortDirection',
                  value: event.target.value,
                })
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <label>
            Page size
            <select
              value={pageSize}
              onChange={(event) => {
                dispatch({ type: 'setPageSize', pageSize: Number(event.target.value) })
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>
        {activeFilterLabels.length ? (
          <div className="admin-active-filter-row" aria-label="Active product filters">
            {activeFilterLabels.map((filter) => (
              <span key={filter}>{filter}</span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-results" aria-live="polite">
        <div className="admin-results-summary">
          <p>{isLoading ? 'Loading products...' : `${products.length} visible rows · ${total.toLocaleString()} total`}</p>
          {error ? <p className="admin-error">{error}</p> : null}
        </div>

        <div className="admin-product-table">
          <div className="admin-product-heading">
            <span>Original Fragrance</span>
            <span>Source Brand</span>
            <span>Classification</span>
            <span>Mistify Product Name</span>
            <span>Mistify Product URL</span>
            <span>Actions</span>
          </div>

          {!isLoading && !products.length ? (
            <p className="admin-empty-state admin-product-empty-state">
              No products match the current filters. Loosen the search or clear missing-data filters.
            </p>
          ) : null}

          {products.map((product) => {
            const draft = drafts[product.id] ?? {
              mistifyProductName: '',
              mistifyProductUrl: '',
            }
            const saveState = rowSaveState[product.id]?.status ?? 'idle'
            const saveMessage = rowSaveState[product.id]?.message
            const isEditing = editingProductId === product.id
            const hasProductName = hasValidProductName(product.mistifyProductName)
            const productUrl = product.mistifyProductUrl?.trim() ?? ''
            const currentDraft = toProductDraft(product)
            const isDraftDirty =
              draft.mistifyProductName !== currentDraft.mistifyProductName ||
              draft.mistifyProductUrl !== currentDraft.mistifyProductUrl

            return (
              <article className="admin-product-row" key={product.id}>
                <div className="admin-product-name" data-label="Original Fragrance">
                  {product.originalFragranceName || 'Untitled'}
                </div>
                <div data-label="Source Brand">{product.sourceBrandBatch || 'Missing'}</div>
                <div data-label="Classification">{product.classification || 'Missing'}</div>
                <div data-label="Mistify Product Name">
                  {hasProductName ? (
                    product.mistifyProductName
                  ) : (
                    <span className="admin-missing-value">Needs review</span>
                  )}
                </div>
                <div data-label="Mistify Product URL">
                  {productUrl ? (
                    <a
                      className="admin-product-link"
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View product
                      <span aria-hidden="true" className="admin-product-link-icon">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M14 5h5v5" />
                          <path d="M10 14 19 5" />
                          <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                        </svg>
                      </span>
                    </a>
                  ) : (
                    <span className="admin-missing-value">Needs URL</span>
                  )}
                </div>
                <div className="admin-row-actions" data-label="Actions">
                  {isEditing ? (
                    <>
                      {isDraftDirty ? <span className="manager-unsaved-pill">Unsaved</span> : null}
                      <button
                        className={saveState === 'saved' ? 'saved' : ''}
                        type="button"
                        disabled={saveState === 'saving' || !isDraftDirty}
                        onClick={() => handleSave(product.id)}
                      >
                        {saveState === 'saving'
                          ? 'Saving...'
                          : saveState === 'saved'
                            ? 'Saved \u2713'
                            : 'Save'}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={saveState === 'saving'}
                        onClick={() => handleCancel(product)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className={saveState === 'saved' ? 'saved' : 'secondary'}
                      type="button"
                      onClick={() => handleEdit(product)}
                    >
                      {saveState === 'saved' ? 'Saved \u2713' : 'Edit'}
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <div className="admin-edit-panel">
                    <label>
                      <span>Mistify Product Name</span>
                      <input
                        value={draft.mistifyProductName}
                        onChange={(event) =>
                          dispatch({
                            type: 'draftChanged',
                            productId: product.id,
                            field: 'mistifyProductName',
                            value: event.target.value,
                          })
                        }
                        onFocus={() =>
                          dispatch({
                            type: 'rowStatusChanged',
                            productId: product.id,
                            state: { status: 'idle' },
                          })
                        }
                        maxLength={100}
                        placeholder="Needs review"
                      />
                    </label>
                    <label>
                      <span>Mistify Product URL</span>
                      <input
                        value={draft.mistifyProductUrl}
                        onChange={(event) =>
                          dispatch({
                            type: 'draftChanged',
                            productId: product.id,
                            field: 'mistifyProductUrl',
                            value: event.target.value,
                          })
                        }
                        onFocus={() =>
                          dispatch({
                            type: 'rowStatusChanged',
                            productId: product.id,
                            state: { status: 'idle' },
                          })
                        }
                        placeholder="https://..."
                      />
                    </label>
                    {isDraftDirty ? <p className="admin-edit-hint">Unsaved edits. Save to update this row, or cancel to revert.</p> : null}
                    {saveState === 'error' && saveMessage ? (
                      <p className="admin-error">{saveMessage}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>

        <div className="admin-pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => dispatch({ type: 'setPage', page: page - 1 })}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => dispatch({ type: 'setPage', page: page + 1 })}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  )
}

function AdminProductsPage(props: AdminProductsPageProps) {
  return useAdminProductsPageContent(props)
}

export default AdminProductsPage
