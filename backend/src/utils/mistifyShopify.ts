import { stripHtml } from './textNormalization'

export type MistifyShopProduct = {
  title: string
  handle: string
  url: string
  imageUrl: string
  vendor: string
  inspirationText: string
  bodyText: string
}

type ShopifyProduct = {
  title?: unknown
  handle?: unknown
  vendor?: unknown
  body_html?: unknown
  images?: Array<{ src?: unknown }>
}

const MISTIFY_BASE_URL = 'https://www.mistifyparfums.com'
const PRODUCTS_PAGE_SIZE = 250
const MAX_PRODUCT_PAGES = 20

export function toMistifyProductUrl(handle: string) {
  return `${MISTIFY_BASE_URL}/products/${handle}`
}

export function getMistifyProductHandleFromUrl(value: string | null | undefined) {
  if (!value?.trim()) {
    return ''
  }

  try {
    const parsedUrl = new URL(value.trim(), MISTIFY_BASE_URL)
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)

    return pathParts[pathParts.length - 1] ?? ''
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop() ?? ''
  }
}

export function extractInspirationText(value: string | null | undefined) {
  const text = stripHtml(value ?? '')
  const match = text.match(/(?:inspiration|inspired\s+by|impression\s+of|our\s+version\s+of)\s*:?\s*(.{0,180})/i)

  return match ? match[0].trim() : ''
}

function normalizeShopifyProduct(product: ShopifyProduct): MistifyShopProduct | null {
  const title = typeof product.title === 'string' ? product.title.trim() : ''
  const handle = typeof product.handle === 'string' ? product.handle.trim() : ''
  const vendor = typeof product.vendor === 'string' ? product.vendor.trim() : ''
  const bodyHtml = typeof product.body_html === 'string' ? product.body_html : ''
  const imageUrl = product.images?.find((image) => typeof image.src === 'string')?.src

  if (!title || !handle) {
    return null
  }

  return {
    title,
    handle,
    url: toMistifyProductUrl(handle),
    imageUrl: typeof imageUrl === 'string' ? imageUrl : '',
    vendor,
    inspirationText: extractInspirationText(`${vendor} ${bodyHtml}`),
    bodyText: stripHtml(bodyHtml),
  }
}

export async function fetchAllMistifyShopProducts() {
  const products: MistifyShopProduct[] = []

  for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
    const url = `${MISTIFY_BASE_URL}/products.json?limit=${PRODUCTS_PAGE_SIZE}&page=${page}`
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mistify catalog sync (local admin)',
      },
    })

    if (!response.ok) {
      throw new Error(`Mistify Shopify products request failed with HTTP ${response.status}`)
    }

    const payload = await response.json() as { products?: ShopifyProduct[] }
    const pageProducts = payload.products ?? []

    if (!pageProducts.length) {
      break
    }

    for (const product of pageProducts) {
      const normalizedProduct = normalizeShopifyProduct(product)

      if (normalizedProduct) {
        products.push(normalizedProduct)
      }
    }
  }

  return products
}
