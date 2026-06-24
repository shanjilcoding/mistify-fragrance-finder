import { normalizeBrandName } from './fragranceMatching'

// Maps the lowercase matching key produced by `normalizeBrandName` to a clean,
// public display-case brand name. Both raw spellings (e.g. "YSL" and
// "Yves Saint Laurent") normalize to the same key, so the catalog renders a
// single consolidated brand and brand slug.
const BRAND_DISPLAY_NAMES: Record<string, string> = {
  ysl: 'Yves Saint Laurent',
  'yves saint laurent': 'Yves Saint Laurent',
  'saint laurent': 'Yves Saint Laurent',
  dior: 'Dior',
  'christian dior': 'Dior',
  'tom ford': 'Tom Ford',
  tomford: 'Tom Ford',
  chanel: 'Chanel',
  creed: 'Creed',
  guerlain: 'Guerlain',
  gucci: 'Gucci',
  versace: 'Versace',
  armani: 'Giorgio Armani',
  'giorgio armani': 'Giorgio Armani',
  'parfums de marly': 'Parfums de Marly',
  'maison francis kurkdjian': 'Maison Francis Kurkdjian',
  'maison kurkdjian': 'Maison Francis Kurkdjian',
  mfk: 'Maison Francis Kurkdjian',
  'jean paul gaultier': 'Jean Paul Gaultier',
  'jean-paul gaultier': 'Jean Paul Gaultier',
  jpg: 'Jean Paul Gaultier',
  kilian: 'Kilian',
  initio: 'Initio',
  'initio parfums': 'Initio',
  rabanne: 'Rabanne',
  'paco rabanne': 'Rabanne',
  'maison margiela': 'Maison Margiela',
  'maison martin margiela': 'Maison Margiela',
  'stephane humbert lucas': 'Stephane Humbert Lucas',
}

function titleCaseBrand(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

// Returns the public display-case brand name for a raw brand/batch value.
// Falls back to a title-cased version of the trimmed input when no alias is
// known. Distinct from `normalizeBrandName`, which returns a lowercase key.
export function toBrandDisplayName(
  rawBrand: string | null | undefined,
): string {
  const key = normalizeBrandName(rawBrand)

  if (!key) {
    return ''
  }

  return BRAND_DISPLAY_NAMES[key] ?? titleCaseBrand(rawBrand?.trim() ?? key)
}

export function slugify(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildInspiredByLabel(
  brandName: string | null | undefined,
  originalName: string | null | undefined,
): string {
  const brand = brandName?.trim()
  const original = originalName?.trim()

  if (brand && original) return `Inspired by ${brand} ${original}`
  if (original) return `Inspired by ${original}`
  return 'Inspired fragrance'
}
