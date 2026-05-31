function normalizeBaseText(value: string | null | undefined): string {
  if (!value?.trim()) {
    return ''
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeBrandName(value: string | null | undefined): string {
  const normalizedBrand = normalizeBaseText(value)

  if (
    normalizedBrand === 'by kilian' ||
    normalizedBrand === 'kilian paris' ||
    normalizedBrand === 'kilian'
  ) {
    return 'kilian'
  }

  return normalizedBrand
}

export function normalizeFragranceName(
  value: string | null | undefined,
): string {
  return normalizeBaseText(value)
}

export function buildRatingLookupKey(
  brand: string | null | undefined,
  name: string | null | undefined,
): string {
  return `${normalizeBrandName(brand)}::${normalizeFragranceName(name)}`
}
