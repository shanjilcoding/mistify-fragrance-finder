export type ScentDnaInput = {
  classification?: string | null
  topNotes?: string[] | null
  middleNotes?: string[] | null
  baseNotes?: string[] | null
  allNotes?: string[] | null
  matchedNotes?: string[] | null
  matchedVibes?: string[] | null
  matchedOccasions?: string[] | null
  matchedSeasons?: string[] | null
  scentProfile?: string[] | null
  rating?: {
    bestSeasons?: string[] | null
    bestTime?: string | null
  } | null
}

export type ScentDnaBar = {
  label: 'Fresh' | 'Sweet' | 'Warm' | 'Woody' | 'Loud'
  value: number
}

type WeightedTerms = Record<string, number>

type NoteLayer = {
  notes: string[]
  weight: number
}

const TRAIT_TERMS: Record<ScentDnaBar['label'], WeightedTerms> = {
  Fresh: {
    aldehydes: 8,
    aquatic: 15,
    bergamot: 13,
    calone: 13,
    citrus: 13,
    cucumber: 11,
    eucalyptus: 9,
    grapefruit: 13,
    green: 10,
    'green tea': 11,
    lavender: 7,
    lemon: 13,
    lime: 13,
    marine: 15,
    mint: 12,
    neroli: 12,
    orange: 9,
    petitgrain: 10,
    rosemary: 7,
    sage: 7,
    tea: 8,
    verbena: 12,
    violet: 5,
    water: 12,
    watery: 12,
  },
  Sweet: {
    almond: 9,
    benzoin: 11,
    caramel: 16,
    chocolate: 15,
    coconut: 10,
    gourmand: 16,
    honey: 14,
    marshmallow: 16,
    praline: 16,
    sugar: 15,
    syrup: 14,
    'tonka bean': 14,
    tonka: 14,
    vanilla: 16,
  },
  Warm: {
    amber: 15,
    benzoin: 13,
    cardamom: 10,
    cinnamon: 14,
    clove: 12,
    incense: 13,
    labdanum: 13,
    leather: 12,
    myrrh: 12,
    nutmeg: 11,
    oud: 14,
    pepper: 9,
    resin: 12,
    saffron: 13,
    spice: 13,
    spicy: 13,
    tobacco: 15,
    tonka: 10,
    vanilla: 10,
  },
  Woody: {
    cedar: 16,
    cedarwood: 16,
    cypress: 11,
    drywood: 14,
    ebony: 13,
    moss: 10,
    oak: 12,
    oakmoss: 13,
    oud: 14,
    patchouli: 13,
    pine: 12,
    sandalwood: 16,
    vetiver: 15,
    wood: 16,
    woody: 16,
  },
  Loud: {
    amber: 9,
    animalic: 15,
    castoreum: 15,
    civet: 15,
    incense: 13,
    leather: 13,
    musk: 7,
    oud: 16,
    patchouli: 12,
    resin: 11,
    saffron: 12,
    smoke: 13,
    smoky: 13,
    spice: 9,
    tobacco: 15,
    tuberose: 12,
  },
}

const PROFILE_TERMS: Record<ScentDnaBar['label'], WeightedTerms> = {
  Fresh: {
    aromatic: 8,
    aquatic: 16,
    breezy: 12,
    clean: 15,
    citrus: 15,
    fresh: 18,
    green: 12,
    marine: 16,
    shower: 12,
    soapy: 12,
    sparkling: 10,
  },
  Sweet: {
    candy: 14,
    creamy: 8,
    dessert: 15,
    gourmand: 18,
    rich: 6,
    sweet: 18,
    syrupy: 14,
    vanilla: 14,
  },
  Warm: {
    amber: 15,
    ambery: 15,
    cozy: 10,
    dark: 8,
    oriental: 12,
    resinous: 14,
    spicy: 14,
    warm: 18,
    winter: 8,
  },
  Woody: {
    dry: 8,
    earthy: 12,
    forest: 10,
    mossy: 10,
    woody: 18,
    woods: 18,
  },
  Loud: {
    beast: 18,
    bold: 14,
    club: 12,
    dense: 10,
    intense: 16,
    loud: 18,
    nightlife: 12,
    projecting: 16,
    projection: 16,
    strong: 10,
  },
}

const BASE_SCORES: Record<ScentDnaBar['label'], number> = {
  Fresh: 20,
  Sweet: 22,
  Warm: 24,
  Woody: 20,
  Loud: 22,
}

const OPPOSING_TERMS: Record<ScentDnaBar['label'], string[]> = {
  Fresh: ['amber', 'tobacco', 'oud', 'leather', 'incense', 'smoke', 'smoky', 'gourmand', 'vanilla', 'caramel', 'praline'],
  Sweet: ['dry', 'green', 'aquatic', 'marine', 'citrus', 'vetiver', 'cedar', 'moss'],
  Warm: ['aquatic', 'marine', 'watery', 'cool', 'fresh', 'cucumber'],
  Woody: ['gourmand', 'sugar', 'caramel', 'candy', 'aquatic'],
  Loud: ['clean', 'office', 'soft', 'skin', 'subtle', 'fresh', 'soapy', 'shower'],
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function safeList(values: string[] | null | undefined) {
  return Array.isArray(values) ? values.filter(Boolean) : []
}

function includesTerm(text: string, term: string) {
  return new RegExp(`(^|\\s)${normalizeText(term).replace(/ /g, '\\s+')}($|\\s)`, 'i').test(text)
}

function scoreWeightedTerms(text: string, terms: WeightedTerms, cap: number) {
  const score = Object.entries(terms).reduce(
    (sum, [term, weight]) => sum + (includesTerm(text, term) ? weight : 0),
    0,
  )

  return Math.min(cap, score)
}

function scoreNoteLayers(layers: NoteLayer[], terms: WeightedTerms) {
  const seen = new Set<string>()
  let score = 0

  for (const layer of layers) {
    for (const note of layer.notes) {
      const normalizedNote = normalizeText(note)

      if (!normalizedNote || seen.has(`${layer.weight}:${normalizedNote}`)) {
        continue
      }

      seen.add(`${layer.weight}:${normalizedNote}`)
      score += layer.weight * scoreWeightedTerms(normalizedNote, terms, 18)
    }
  }

  return Math.min(56, score)
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => includesTerm(text, term))
}

function clampProfileScore(value: number) {
  return Math.round(Math.max(18, Math.min(96, value)))
}

export function buildScentDna(recommendation: ScentDnaInput): ScentDnaBar[] {
  const bestSeasons = safeList(recommendation.rating?.bestSeasons)
    .map(normalizeText)
    .join(' ')
  const bestTime = normalizeText(recommendation.rating?.bestTime ?? '')
  const profileText = [
    recommendation.classification,
    ...safeList(recommendation.scentProfile),
    ...safeList(recommendation.matchedVibes),
    ...safeList(recommendation.matchedOccasions),
    ...safeList(recommendation.matchedSeasons),
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value ?? ''))
    .join(' ')
  const groupedNoteLayers: NoteLayer[] = [
    { notes: safeList(recommendation.topNotes), weight: 0.85 },
    { notes: safeList(recommendation.middleNotes), weight: 1 },
    { notes: safeList(recommendation.baseNotes), weight: 1.25 },
  ]
  const hasGroupedNotes = groupedNoteLayers.some((layer) => layer.notes.length > 0)
  const layers: NoteLayer[] = [
    ...groupedNoteLayers,
    { notes: hasGroupedNotes ? [] : safeList(recommendation.allNotes), weight: 0.8 },
    { notes: safeList(recommendation.matchedNotes), weight: 1 },
  ]
  const allNotesText = layers
    .flatMap((layer) => layer.notes)
    .map(normalizeText)
    .join(' ')
  const corpus = `${profileText} ${allNotesText}`

  return (Object.keys(BASE_SCORES) as ScentDnaBar['label'][]).map((label) => {
    const noteScore = scoreNoteLayers(layers, TRAIT_TERMS[label])
    const profileScore = scoreWeightedTerms(profileText, PROFILE_TERMS[label], 28)
    const opposingPenalty = hasAnyTerm(corpus, OPPOSING_TERMS[label]) ? 10 : 0
    const seasonTimeBoost =
      label === 'Fresh'
        ? (bestSeasons.includes('summer') || bestSeasons.includes('spring') ? 6 : 0) +
          (bestTime === 'day' ? 4 : 0)
        : label === 'Warm'
          ? (bestSeasons.includes('winter') || bestSeasons.includes('fall') ? 8 : 0) +
            (bestTime.includes('night') ? 6 : 0)
          : label === 'Loud'
            ? (bestTime.includes('night') ? 8 : 0)
            : 0

    return {
      label,
      value: clampProfileScore(
        BASE_SCORES[label] + noteScore + profileScore + seasonTimeBoost - opposingPenalty,
      ),
    }
  })
}
