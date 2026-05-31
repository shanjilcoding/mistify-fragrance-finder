export type ScentFamily =
  | 'fresh'
  | 'sweet'
  | 'warm'
  | 'woody'
  | 'dark'
  | 'floral'
  | 'clean'
  | 'creamy/tropical'

type ScentSubfamily =
  | 'citrus'
  | 'aquatic'
  | 'green'
  | 'aromatic'
  | 'vanilla'
  | 'gourmand'
  | 'fruity'
  | 'amber'
  | 'spicy'
  | 'resinous'
  | 'dry woods'
  | 'creamy woods'
  | 'earthy woods'
  | 'oud'
  | 'smoky'
  | 'leather'
  | 'tobacco'
  | 'rose'
  | 'white floral'
  | 'powdery floral'
  | 'soft floral'
  | 'musk'
  | 'aldehydic'
  | 'soapy/soft'
  | 'coconut'
  | 'creamy'
  | 'tropical'

type ScentOntologyEntry = {
  family: ScentFamily
  subfamily: ScentSubfamily
  terms: string[]
}

export const SCENT_ONTOLOGY: ScentOntologyEntry[] = [
  { family: 'fresh', subfamily: 'citrus', terms: ['bergamot', 'lemon', 'lime', 'grapefruit', 'citron', 'orange', 'mandarin', 'mandarin orange', 'neroli', 'petitgrain', 'yuzu'] },
  { family: 'fresh', subfamily: 'aquatic', terms: ['aquatic', 'marine', 'sea notes', 'sea salt', 'watery notes', 'calone', 'ozonic notes', 'ozonic'] },
  { family: 'fresh', subfamily: 'green', terms: ['green notes', 'mint', 'basil', 'tea', 'green tea', 'matcha tea', 'fig leaf', 'grass', 'galbanum', 'vervain'] },
  { family: 'fresh', subfamily: 'aromatic', terms: ['lavender', 'rosemary', 'thyme', 'clary sage', 'sage', 'juniper', 'geranium', 'basil'] },
  { family: 'sweet', subfamily: 'vanilla', terms: ['vanilla', 'bourbon vanilla', 'madagascar vanilla', 'vanilla absolute', 'vanilla pod', 'vanilla infusion', 'tonka bean', 'benzoin'] },
  { family: 'sweet', subfamily: 'gourmand', terms: ['caramel', 'praline', 'chocolate', 'cacao', 'cocoa', 'coffee', 'amaretto', 'ice cream', 'speculoos', 'sugar', 'brown sugar', 'honey', 'marshmallow', 'candy', 'creme brulee'] },
  { family: 'sweet', subfamily: 'fruity', terms: ['peach', 'cherry', 'raspberry', 'black currant', 'blackcurrant', 'pineapple', 'apple', 'pear', 'plum', 'fig', 'coconut'] },
  { family: 'warm', subfamily: 'amber', terms: ['amber', 'ambergris', 'amberwood', 'ambroxan', 'labdanum', 'benzoin', 'opoponax'] },
  { family: 'warm', subfamily: 'spicy', terms: ['cinnamon', 'cardamom', 'saffron', 'pink pepper', 'pepper', 'nutmeg', 'cloves', 'ginger', 'cumin'] },
  { family: 'warm', subfamily: 'resinous', terms: ['myrrh', 'olibanum', 'frankincense', 'incense', 'elemi', 'resin', 'resins'] },
  { family: 'woody', subfamily: 'dry woods', terms: ['cedar', 'cedarwood', 'vetiver', 'guaiac wood', 'cashmeran', 'akigalawood', 'clearwood'] },
  { family: 'woody', subfamily: 'creamy woods', terms: ['sandalwood', 'palo santo'] },
  { family: 'woody', subfamily: 'earthy woods', terms: ['patchouli', 'oakmoss', 'birch'] },
  { family: 'dark', subfamily: 'oud', terms: ['oud', 'agarwood', 'aoud', 'oudh'] },
  { family: 'dark', subfamily: 'smoky', terms: ['smoke', 'smoky', 'incense', 'birch tar'] },
  { family: 'dark', subfamily: 'leather', terms: ['leather', 'suede'] },
  { family: 'dark', subfamily: 'tobacco', terms: ['tobacco', 'tobacco leaf', 'white tobacco'] },
  { family: 'floral', subfamily: 'rose', terms: ['rose', 'may rose', 'turkish rose', 'bulgarian rose', 'damask rose', 'rose de mai'] },
  { family: 'floral', subfamily: 'white floral', terms: ['jasmine', 'orange blossom', 'tuberose', 'gardenia', 'ylang-ylang', 'lily-of-the-valley'] },
  { family: 'floral', subfamily: 'powdery floral', terms: ['iris', 'orris', 'orris root', 'violet', 'heliotrope'] },
  { family: 'floral', subfamily: 'soft floral', terms: ['peony', 'osmanthus', 'magnolia', 'orchid'] },
  { family: 'clean', subfamily: 'musk', terms: ['musk', 'white musk', 'sweet musk', 'ambrette', 'ambrette seeds'] },
  { family: 'clean', subfamily: 'aldehydic', terms: ['aldehydes'] },
  { family: 'clean', subfamily: 'soapy/soft', terms: ['powder', 'powdery', 'cotton flower', 'clean notes'] },
  { family: 'creamy/tropical', subfamily: 'coconut', terms: ['coconut', 'coconut milk', 'coconut powder'] },
  { family: 'creamy/tropical', subfamily: 'creamy', terms: ['lactones', 'milk', 'cream', 'almond', 'pistachio', 'hazelnut'] },
  { family: 'creamy/tropical', subfamily: 'tropical', terms: ['coconut', 'fig', 'pineapple', 'mango', 'tropical fruits'] },
]

const familyLookup = new Map<string, Set<ScentFamily>>()
const subfamilyLookup = new Map<string, Set<ScentSubfamily>>()
const subfamilyToFamily = new Map<ScentSubfamily, ScentFamily>()

for (const entry of SCENT_ONTOLOGY) {
  subfamilyToFamily.set(entry.subfamily, entry.family)

  for (const term of [entry.family, entry.subfamily, ...entry.terms]) {
    const normalizedTerm = normalizeScentTerm(term)

    if (!normalizedTerm) {
      continue
    }

    familyLookup.set(
      normalizedTerm,
      (familyLookup.get(normalizedTerm) ?? new Set()).add(entry.family),
    )
    subfamilyLookup.set(
      normalizedTerm,
      (subfamilyLookup.get(normalizedTerm) ?? new Set()).add(entry.subfamily),
    )
  }
}

export function normalizeScentTerm(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getScentFamiliesForNote(note: string) {
  return Array.from(familyLookup.get(normalizeScentTerm(note)) ?? [])
}

export function getScentFamiliesForNotes(notes: string[]) {
  return Array.from(
    new Set(notes.flatMap((note) => getScentFamiliesForNote(note))),
  )
}

export function getScentSubfamiliesForNote(note: string) {
  return Array.from(subfamilyLookup.get(normalizeScentTerm(note)) ?? [])
}

export function getScentSubfamiliesForNotes(notes: string[]) {
  return Array.from(
    new Set(notes.flatMap((note) => getScentSubfamiliesForNote(note))),
  )
}

export function hasFamily(notes: string[], family: string) {
  const normalizedFamily = normalizeScentTerm(family)

  return getScentFamiliesForNotes(notes).some(
    (candidateFamily) => candidateFamily === normalizedFamily,
  )
}

export function hasSubfamily(notes: string[], subfamily: string) {
  const normalizedSubfamily = normalizeScentTerm(subfamily)

  return getScentSubfamiliesForNotes(notes).some(
    (candidateSubfamily) => candidateSubfamily === normalizedSubfamily,
  )
}

export function calculateFamilyOverlap(
  requestedFamilies: string[],
  candidateFamilies: string[],
) {
  const candidateFamilySet = new Set(candidateFamilies.map(normalizeScentTerm))

  return requestedFamilies.filter((family) =>
    candidateFamilySet.has(normalizeScentTerm(family)),
  ).length
}

export function getConflictFamiliesForSoftCap(cap: string) {
  const normalizedCap = normalizeScentTerm(cap)

  if (normalizedCap === 'sweet') {
    return ['sweet', 'gourmand']
  }

  if (normalizedCap === 'smoky' || normalizedCap === 'smoke') {
    return ['dark', 'smoky']
  }

  if (normalizedCap === 'aquatic') {
    return ['fresh', 'aquatic']
  }

  return [normalizedCap]
}

export function getFamilyForSubfamily(subfamily: string) {
  return subfamilyToFamily.get(normalizeScentTerm(subfamily) as ScentSubfamily)
}
