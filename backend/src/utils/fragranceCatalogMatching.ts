import { getMistifyProductHandleFromUrl, type MistifyShopProduct } from './mistifyShopify'
import { normalizeText, normalizeUrl, tokenOverlapScore } from './textNormalization'

export type CatalogMatchInput = {
  id: number
  originalFragranceName: string | null
  sourceBrandBatch: string | null
  mistifyProductName: string | null
  mistifyProductUrl: string | null
}

export type CatalogMatchResult = {
  fragrance: CatalogMatchInput
  product: MistifyShopProduct
  matchType: 'url_handle' | 'mistify_name' | 'inspiration_original_brand' | 'original_brand_fuzzy'
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

const brandAliasMap = new Map<string, string>([
  ['by kilian', 'kilian'],
  ['kilian', 'kilian'],
  ['initio parfums', 'initio'],
  ['initio', 'initio'],
  ['ysl', 'yves saint laurent'],
  ['yves saint laurent', 'yves saint laurent'],
  ['ysl yves saint laurent', 'yves saint laurent'],
  ['christian dior', 'dior'],
  ['dior', 'dior'],
  ['paco rabanne', 'rabanne'],
  ['rabanne', 'rabanne'],
  ['stephane h lucas', 'stephane humbert lucas'],
  ['stephane humbert lucas', 'stephane humbert lucas'],
  ['parfums de marly', 'parfums de marly'],
  ['maison martin margiela replica', 'maison margiela'],
  ['maison martin margiela', 'maison margiela'],
  ['maison margiela', 'maison margiela'],
])

export function normalizeBrandForMatch(value: string | null | undefined) {
  const normalizedBrand = normalizeText(value)

  return brandAliasMap.get(normalizedBrand) ?? normalizedBrand
}

export function isPlaceholderProductName(value: string | null | undefined) {
  const normalizedValue = normalizeText(value)

  return !normalizedValue || normalizedValue === 'not verified' || normalizedValue === 'not verified on mistify'
}

export function buildOriginalBrandKey(
  brandName: string | null | undefined,
  fragranceName: string | null | undefined,
) {
  return `${normalizeBrandForMatch(brandName)}::${normalizeText(fragranceName)}`
}

function buildProductText(product: MistifyShopProduct) {
  return [
    product.title,
    product.handle,
    product.vendor,
    product.inspirationText,
    product.bodyText,
  ].join(' ')
}

function includesNormalizedPhrase(text: string, phrase: string) {
  return phrase !== '' && ` ${text} `.includes(` ${phrase} `)
}

export function indexProductsByHandle(products: MistifyShopProduct[]) {
  return new Map(products.map((product) => [product.handle, product]))
}

export function matchFragranceToShopProduct(
  fragrance: CatalogMatchInput,
  products: MistifyShopProduct[],
  productsByHandle = indexProductsByHandle(products),
): CatalogMatchResult | null {
  const currentHandle = getMistifyProductHandleFromUrl(fragrance.mistifyProductUrl)
  const handleMatch = currentHandle ? productsByHandle.get(currentHandle) : null

  if (handleMatch) {
    return {
      fragrance,
      product: handleMatch,
      matchType: 'url_handle',
      confidence: 'high',
      reason: 'Existing DB Mistify product URL handle matched Shopify product handle.',
    }
  }

  const normalizedMistifyName = normalizeText(fragrance.mistifyProductName)
  if (normalizedMistifyName && !isPlaceholderProductName(fragrance.mistifyProductName)) {
    const nameMatch = products.find(
      (product) => normalizeText(product.title) === normalizedMistifyName,
    )

    if (nameMatch) {
      return {
        fragrance,
        product: nameMatch,
        matchType: 'mistify_name',
        confidence: 'high',
        reason: 'Existing DB Mistify product name matched Shopify product title exactly.',
      }
    }
  }

  const normalizedOriginal = normalizeText(fragrance.originalFragranceName)
  const normalizedBrand = normalizeBrandForMatch(fragrance.sourceBrandBatch)

  if (!normalizedOriginal) {
    return null
  }

  const scoredProducts = products
    .map((product) => {
      const productText = normalizeText(buildProductText(product))
      const hasOriginalPhrase = includesNormalizedPhrase(productText, normalizedOriginal)
      const hasBrand = normalizedBrand !== '' && productText.includes(normalizedBrand)
      const overlapScore = tokenOverlapScore(normalizedOriginal, productText)
      const score = (hasOriginalPhrase ? 70 : 0) + (hasBrand ? 20 : 0) + overlapScore * 10

      return { product, hasOriginalPhrase, hasBrand, overlapScore, score }
    })
    .sort((first, second) => second.score - first.score)

  const best = scoredProducts[0]

  if (!best || best.score < 35) {
    return null
  }

  if (best.hasOriginalPhrase && best.hasBrand) {
    return {
      fragrance,
      product: best.product,
      matchType: 'inspiration_original_brand',
      confidence: 'high',
      reason: 'Original fragrance name and brand appeared in Shopify product text.',
    }
  }

  if (best.hasOriginalPhrase || best.overlapScore >= 0.72) {
    return {
      fragrance,
      product: best.product,
      matchType: 'original_brand_fuzzy',
      confidence: best.hasOriginalPhrase ? 'medium' : 'low',
      reason: best.hasOriginalPhrase
        ? 'Original fragrance name appeared in Shopify product text, but brand support was unclear.'
        : `High token overlap with Shopify product text (${best.overlapScore.toFixed(2)}).`,
    }
  }

  return null
}

export function didUrlChange(currentUrl: string | null | undefined, nextUrl: string) {
  return normalizeUrl(currentUrl) !== normalizeUrl(nextUrl)
}
