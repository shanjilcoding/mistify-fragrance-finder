import { and, isNotNull, ne } from 'drizzle-orm'
import { db } from '../db/connection'
import { fragranceRatings, fragrances } from '../db/schema'
import { buildRatingLookupKey } from '../utils/fragranceMatching'
import type {
  Audience,
  ConfidenceLabel,
  FragranceRecommendation,
  MatchTier,
  RecommendationRating,
  ReferenceFragrance,
  ReferenceRecommendationDebug,
  ScoreBreakdown,
} from './recommendationTypes'
export type {
  FragranceRecommendation,
  ReferenceFragrance,
  ReferenceRecommendationDebug,
} from './recommendationTypes'
import {
  calculateFamilyOverlap as calculateOntologyFamilyOverlap,
  getConflictFamiliesForSoftCap,
  getScentFamiliesForNote,
  getScentFamiliesForNotes as getOntologyFamiliesForNotes,
  getScentSubfamiliesForNote,
  getScentSubfamiliesForNotes as getOntologySubfamiliesForNotes,
} from '../utils/scentOntology'


type RecommendationEvidence = {
  reasons: string[]
  warnings: string[]
  missing: string[]
}

type RecommendableFragrance = Awaited<
  ReturnType<typeof fetchRecommendableFragrances>
>[number]
type RatingRecord = Awaited<ReturnType<typeof fetchFragranceRatings>>[number]

type CachedRecordNotes = {
  topNotes: string[]
  middleNotes: string[]
  baseNotes: string[]
  allNotes: string[]
  combinedNotes: string[]
}

type CachedFragranceProfile = {
  normalizedTopNotesSet: Set<string>
  normalizedMiddleNotesSet: Set<string>
  normalizedBaseNotesSet: Set<string>
  normalizedAllNotesSet: Set<string>
  computedAccordsSet: Set<string>
  topFamiliesSet: Set<string>
  middleFamiliesSet: Set<string>
  baseFamiliesSet: Set<string>
  allNoteFamiliesSet: Set<string>
  classificationFamiliesSet: Set<string>
  overallProfileFamiliesSet: Set<string>
  classificationTerms: string[]
  referenceNoteTerms: string[]
  referenceProfileTerms: string[]
  paddedReferenceNoteTerms: string[]
  paddedReferenceProfileTerms: string[]
  referenceAllTermsSet: Set<string>
}

type RecommendationSourceData = {
  recommendableFragrances: RecommendableFragrance[]
  ratingRows: RatingRecord[]
  ratingMap: Map<string, RatingRecord>
  ratingStats: RatingStats
  loadedAt: number
  expiresAt: number
}

const recordNotesCache = new WeakMap<RecommendableFragrance, CachedRecordNotes>()
const recordReferenceNamesCache = new WeakMap<RecommendableFragrance, string[]>()
const recordAllNotesCache = new WeakMap<RecommendableFragrance, string[]>()
const recordProfileCache = new WeakMap<RecommendableFragrance, CachedFragranceProfile>()
const recordNotesTermMatchCache = new WeakMap<
  RecommendableFragrance,
  Map<string, boolean>
>()
const recordClassificationTermMatchCache = new WeakMap<
  RecommendableFragrance,
  Map<string, boolean>
>()
const recordSearchableTextTermMatchCache = new WeakMap<
  RecommendableFragrance,
  Map<string, boolean>
>()
const recordComputedAccordTermMatchCache = new WeakMap<
  RecommendableFragrance,
  Map<string, boolean>
>()
const recordTermMatchCache = new WeakMap<RecommendableFragrance, Map<string, boolean>>()
const recordNormalizedTextCache = new WeakMap<
  RecommendableFragrance,
  {
    notes: string[]
    paddedNotes: string[]
    classification: string
    paddedClassification: string
    searchableText: string
    paddedSearchableText: string
  }
>()
const expandedVibeTermsCache = new Map<string, string[]>()
const uniqueExpandedVibeTermsCache = new Map<string, string[]>()
const requestedScentFamiliesCache = new WeakMap<RecommendationIntent, string[]>()
const phraseRegexCache = new Map<string, RegExp>()
const normalizedPhraseCache = new Map<string, string>()
const familyTermsForNoteCache = new Map<string, string[]>()
const bucketTermsFromNotesCache = new Map<string, string[]>()
const profileFamiliesFromTermsCache = new Map<string, string[]>()
const profileFamiliesForTermCache = new Map<string, string[]>()
const classificationTermsCache = new Map<string, string[]>()
const classificationFamiliesCache = new Map<string, Set<string>>()
const profileFamilyLookupCache = new Map<string, Set<string>>()
const referenceNoteCombosCache = new WeakMap<ReferenceProfile, string[][]>()
const referenceProfileDataCache = new WeakMap<ReferenceProfile, CachedFragranceProfile>()
let noteFamilySearchEntriesCache: Array<{
  noteToken: string
  family: NoteFamily
  searchableTerms: string[]
}> | null = null
const intentCompatibilityContextCache = new WeakMap<
  RecommendationIntent,
  IntentCompatibilityContext
>()
let recommendationSourceCache: RecommendationSourceData | null = null
let recommendationSourceLoadPromise: Promise<RecommendationSourceData> | null = null

const MIN_TOKEN_LENGTH = 3
const MAX_RAW_SCORE = 70
const RECOMMENDATION_LIMIT = 21
const DETERMINISTIC_EXPLANATION_MAX_LENGTH = 240
const RECOMMENDATION_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000
const PLACEHOLDER_PRODUCT_NAMES = new Set([
  'not verified',
  'not verified on mistify',
  'not fully verified from mistify page',
  'not verified from source',
])

const LOW_CONFIDENCE_REFERENCE_TERMS = new Set([
  'amber',
  'blue',
  'clean',
  'citrus',
  'fresh',
  'musk',
  'oud',
  'rose',
  'street',
  'sweet',
  'vanilla',
  'wood',
])

const QUERY_CORRECTION_ALIASES: Record<string, string> = {
  'angle share': 'angels share',
  'angels share': 'angels share',
  bakarat: 'baccarat',
  'bakarat rouge': 'baccarat rouge',
  bergamont: 'bergamot',
  carmel: 'caramel',
  cocunut: 'coconut',
  delena: 'delina',
  imaginaton: 'imagination',
  laffyette: 'lafayette',
  'lafayette streat': 'lafayette street',
  naxoes: 'naxos',
  'oud wud': 'oud wood',
  sandlewood: 'sandalwood',
  tabacco: 'tobacco',
  vanila: 'vanilla',
}

const FILLER_WORDS = new Set([
  'i',
  'want',
  'a',
  'an',
  'the',
  'for',
  'with',
  'me',
  'something',
  'fragrance',
  'perfume',
  'scent',
  'cologne',
  'please',
  'recommend',
  'find',
  'give',
  'looking',
])

const NOTE_ALLOWLIST = [
  'tonka bean',
  'orange blossom',
  'coconut',
  'vanilla',
  'oud',
  'agarwood',
  'rose',
  'amber',
  'musk',
  'citrus',
  'bergamot',
  'lavender',
  'neroli',
  'saffron',
  'leather',
  'cedar',
  'cedarwood',
  'sandalwood',
  'vetiver',
  'patchouli',
  'tobacco',
  'honey',
  'cherry',
  'raspberry',
  'peach',
  'pineapple',
  'mango',
  'apple',
  'pear',
  'violet',
  'coffee',
  'chocolate',
  'caramel',
  'cinnamon',
  'pepper',
  'nutmeg',
  'clove',
  'tonka',
  'praline',
  'cognac',
  'rum',
  'almond',
  'iris',
  'jasmine',
  'freesia',
  'incense',
  'smoke',
  'ambrette',
  'cardamom',
  'ginger',
  'lemon',
  'orange',
  'mint',
  'tea',
  'jasmine tea',
  'mate',
  'ambroxan',
  'ambergris',
  'cashmeran',
  'iso e super',
  'beeswax',
  'cigar',
  'suede',
  'birch',
  'castoreum',
  'labdanum',
  'marzipan',
  'heliotrope',
  'grapefruit',
  'lime',
  'yuzu',
  'petitgrain',
  'blood orange',
  'bitter orange',
  'mandarin',
  'mandarin orange',
  'peppermint',
  'spearmint',
  'lavandin',
  'jasmine sambac',
  'orris',
  'orris root',
  'santal',
  'haitian vetiver',
  'olibanum',
  'frankincense',
  'myrrh',
  'cacao',
  'cocoa',
  'espresso',
  'cappuccino',
  'black currant',
  'passion fruit',
  'apricot',
  'fig',
  'tuberose',
  'peony',
  'magnolia',
  'ylang-ylang',
  'gardenia',
  'osmanthus',
  'geranium',
  'pistachio',
  'hazelnut',
]

const COCONUT_STRONG_TERMS = [
  'coconut',
  'coconut milk',
  'coconut water',
  'coconut powder',
]
const COCONUT_MEDIUM_TERMS = [
  'tiare flower',
  'tropical',
  'solar notes',
  'beach',
  'lactonic',
]
const COCONUT_SOFT_TERMS = [
  'milk',
  'cream',
  'creamy',
  'almond',
  'almond milk',
  'sandalwood',
  'vanilla',
  'tonka',
  'heliotrope',
  'gourmand',
  'caramel',
  'praline',
]
const VANILLA_FAMILY_TERMS = [
  'vanilla',
  'vanilla pod',
  'vanilla absolute',
  'bourbon vanilla',
  'madagascar vanilla',
  'tahitian vanilla',
  'vanilla bean',
  'vanilla infusion',
  'vanillin',
]

type NoteFamily = {
  strong: string[]
  medium?: string[]
  soft?: string[]
  softRequires?: string[]
  fallback?: string[]
  classification?: string[]
}

type RequestedNoteMatchStrength =
  | 'exact'
  | 'strong'
  | 'medium'
  | 'soft'
  | 'none'

const NOTE_FAMILIES: Record<string, NoteFamily> = {
  vanilla: {
    strong: VANILLA_FAMILY_TERMS,
    soft: ['tonka', 'tonka bean', 'benzoin', 'caramel', 'cream', 'creamy', 'milk', 'praline', 'amber', 'gourmand'],
    fallback: ['tonka', 'tonka bean', 'benzoin', 'cream', 'creamy', 'gourmand', 'amber', 'lactonic'],
    classification: ['vanilla', 'amber vanilla', 'oriental vanilla'],
  },
  coconut: {
    strong: COCONUT_STRONG_TERMS,
    medium: [...COCONUT_MEDIUM_TERMS, 'tiare', 'solar', 'creamy', 'cream'],
    soft: COCONUT_SOFT_TERMS,
    softRequires: [...COCONUT_MEDIUM_TERMS, ...COCONUT_STRONG_TERMS],
    fallback: ['tiare', 'tiare flower', 'tropical', 'solar', 'solar notes', 'lactonic', 'creamy', 'cream'],
    classification: ['coconut'],
  },
  oud: {
    strong: ['oud', 'agarwood', 'agarwood/oud', 'oud wood'],
    medium: ['woody oud'],
    soft: ['woody', 'incense', 'resin', 'smoke', 'smoky', 'leather', 'amber'],
    fallback: ['woody', 'resinous', 'resin', 'amber', 'smoky', 'smoke', 'incense'],
    classification: ['oud'],
  },
  agarwood: {
    strong: ['agarwood', 'oud', 'agarwood/oud', 'oud wood'],
    classification: ['agarwood', 'oud'],
  },
  rose: {
    strong: [
      'rose',
      'turkish rose',
      'bulgarian rose',
      'damask rose',
      'rose de mai',
      'rose petals',
      'rose water',
      'moroccan rose',
    ],
    soft: ['floral', 'musk', 'oud', 'amber'],
    fallback: ['floral', 'jammy', 'peony', 'geranium'],
    classification: ['rose'],
  },
  musk: {
    strong: ['musk', 'white musk', 'skin musk', 'ambrette', 'musky notes'],
    medium: ['ambroxan', 'ambergris', 'cashmeran', 'iso e super'],
    soft: ['clean', 'powdery', 'skin scent', 'aldehydes'],
    fallback: ['musky', 'clean', 'powdery', 'skin', 'white musk'],
    classification: ['musk', 'musky', 'floral woody musk'],
  },
  amber: {
    strong: ['amber', 'ambergris', 'amberwood', 'white amber', 'labdanum', 'benzoin', 'resin', 'amber accord'],
    soft: ['vanilla', 'tonka', 'sandalwood', 'musk', 'warm', 'spicy'],
    fallback: ['warm', 'resin', 'resinous', 'spicy', 'benzoin', 'labdanum'],
    classification: ['amber', 'amber vanilla'],
  },
  tobacco: {
    strong: ['tobacco', 'tobacco leaf', 'white tobacco', 'pipe tobacco'],
    medium: ['cigar', 'smoky tobacco'],
    soft: ['honey', 'vanilla', 'amber', 'smoke', 'smoky', 'spicy', 'leather'],
    fallback: ['honey', 'amber', 'spice', 'spicy', 'smoky', 'smoke', 'resin', 'dried fruit'],
    classification: ['tobacco'],
  },
  honey: {
    strong: ['honey', 'honeycomb', 'beeswax'],
    soft: ['tobacco', 'amber', 'vanilla', 'gourmand'],
    fallback: ['sweet', 'amber', 'beeswax', 'syrup', 'gourmand'],
    classification: ['honey'],
  },
  leather: {
    strong: ['leather', 'suede'],
    medium: ['saffron', 'birch', 'castoreum', 'labdanum'],
    soft: ['smoke', 'smoky', 'tobacco'],
    fallback: ['smoky', 'smoke', 'amber', 'woody', 'animalic'],
    classification: ['leather', 'leathery'],
  },
  saffron: {
    strong: ['saffron', 'saffron flower'],
    medium: ['leather saffron', 'spicy saffron'],
    classification: ['saffron'],
  },
  cherry: {
    strong: ['cherry', 'sour cherry', 'black cherry', 'cherry liqueur'],
    soft: ['almond', 'vanilla', 'tonka', 'liqueur', 'sweet fruity'],
    fallback: ['almond', 'fruity', 'sweet', 'liqueur', 'tonka'],
    classification: ['cherry'],
  },
  almond: {
    strong: ['almond', 'bitter almond', 'almond milk', 'amaretto'],
    medium: ['marzipan', 'heliotrope'],
    fallback: ['nutty', 'tonka', 'marzipan', 'cherry', 'vanilla'],
    classification: ['almond'],
  },
  citrus: {
    strong: [
      'citron',
      'bergamot',
      'lemon',
      'orange',
      'mandarin',
      'mandarin orange',
      'grapefruit',
      'lime',
      'yuzu',
      'petitgrain',
      'neroli',
      'blood orange',
      'bitter orange',
      'orange blossom',
    ],
    classification: ['citrus', 'citrus aromatic', 'green citrus', 'citrus floral'],
  },
  bergamot: {
    strong: ['bergamot', 'calabrian bergamot'],
    classification: ['bergamot'],
  },
  lemon: {
    strong: ['lemon', 'sicilian lemon', 'lemon zest', 'lemon blossom'],
    classification: ['lemon'],
  },
  orange: {
    strong: ['orange', 'blood orange', 'bitter orange', 'mandarin', 'mandarin orange', 'orange blossom'],
    classification: ['orange'],
  },
  neroli: {
    strong: ['neroli'],
    classification: ['neroli'],
  },
  mint: {
    strong: ['mint', 'peppermint', 'spearmint'],
    classification: ['mint'],
  },
  lavender: {
    strong: ['lavender', 'lavandin'],
    classification: ['lavender'],
  },
  jasmine: {
    strong: ['jasmine', 'jasmine sambac', 'jasmine petals', 'jasmine tea'],
    classification: ['jasmine'],
  },
  iris: {
    strong: ['iris', 'orris', 'orris root'],
    classification: ['iris'],
  },
  violet: {
    strong: ['violet', 'violet leaf'],
    classification: ['violet'],
  },
  sandalwood: {
    strong: ['sandalwood', 'santal'],
    classification: ['sandalwood'],
  },
  cedar: {
    strong: ['cedar', 'cedarwood', 'virginian cedar'],
    classification: ['cedar', 'cedarwood'],
  },
  cedarwood: {
    strong: ['cedarwood', 'cedar', 'virginian cedar'],
    classification: ['cedarwood', 'cedar'],
  },
  vetiver: {
    strong: ['vetiver', 'haitian vetiver'],
    classification: ['vetiver'],
  },
  patchouli: {
    strong: ['patchouli'],
    classification: ['patchouli'],
  },
  incense: {
    strong: ['incense', 'olibanum', 'frankincense', 'myrrh', 'resin'],
    classification: ['incense'],
  },
  smoke: {
    strong: ['smoke', 'smoky', 'birch', 'cade', 'incense', 'guaiac wood'],
    classification: ['smoke', 'smoky'],
  },
  caramel: {
    strong: ['caramel', 'salted caramel', 'burnt caramel', 'dulce de leche', 'creme brulee'],
    classification: ['caramel'],
  },
  chocolate: {
    strong: ['chocolate', 'cacao', 'cocoa'],
    classification: ['chocolate'],
  },
  coffee: {
    strong: ['coffee', 'espresso', 'cappuccino'],
    classification: ['coffee'],
  },
  fruity: {
    strong: [
      'fruity notes',
      'peach',
      'pear',
      'apple',
      'pineapple',
      'mango',
      'lychee',
      'raspberry',
      'strawberry',
      'blueberry',
      'plum',
      'cassis',
      'black currant',
      'passion fruit',
      'apricot',
      'fig',
    ],
    classification: ['fruity', 'fruit'],
  },
  peach: {
    strong: ['peach', 'white peach'],
    classification: ['peach'],
  },
  pineapple: {
    strong: ['pineapple'],
    classification: ['pineapple'],
  },
  mango: {
    strong: ['mango'],
    classification: ['mango'],
  },
  apple: {
    strong: ['apple', 'green apple'],
    classification: ['apple'],
  },
  pear: {
    strong: ['pear'],
    classification: ['pear'],
  },
  tonka: {
    strong: ['tonka', 'tonka bean'],
    classification: ['tonka'],
  },
  cinnamon: {
    strong: ['cinnamon'],
    classification: ['cinnamon'],
  },
  cardamom: {
    strong: ['cardamom'],
    classification: ['cardamom'],
  },
  pepper: {
    strong: ['pepper', 'black pepper', 'pink pepper', 'white pepper'],
    classification: ['pepper'],
  },
  nutmeg: {
    strong: ['nutmeg'],
    classification: ['nutmeg'],
  },
  clove: {
    strong: ['clove'],
    classification: ['clove'],
  },
  ginger: {
    strong: ['ginger'],
    classification: ['ginger'],
  },
  tea: {
    strong: ['tea', 'black tea', 'green tea', 'matcha tea', 'mate', 'jasmine tea'],
    classification: ['tea'],
  },
  aquatic: {
    strong: [
      'aquatic',
      'aquatic notes',
      'marine',
      'sea salt',
      'salt',
      'water notes',
      'ocean',
      'ozonic',
      'calone',
    ],
    classification: ['aquatic', 'marine'],
  },
  green: {
    strong: [
      'green',
      'green notes',
      'basil',
      'mint',
      'violet leaf',
      'tea',
      'green tea',
      'matcha tea',
      'grass',
      'fig leaf',
      'tomato leaf',
      'vetiver',
      'galbanum',
      'rosemary',
      'thyme',
    ],
    classification: ['green'],
  },
  floral: {
    strong: [
      'rose',
      'jasmine',
      'orange blossom',
      'tuberose',
      'iris',
      'violet',
      'peony',
      'magnolia',
      'ylang-ylang',
      'lily',
      'lily of the valley',
      'gardenia',
      'freesia',
      'honeysuckle',
      'lavender',
      'waterlily',
      'lotus',
      'lotus wood',
      'osmanthus',
      'geranium',
    ],
    classification: ['floral'],
  },
  powdery: {
    strong: [
      'iris',
      'violet',
      'heliotrope',
      'musk',
      'white musk',
      'almond',
      'tonka',
      'vanilla',
      'aldehydes',
      'powder',
      'powdery notes',
      'orris',
      'ambrette',
    ],
    classification: ['powdery'],
  },
  gourmand: {
    strong: [
      'vanilla',
      'caramel',
      'honey',
      'praline',
      'cacao',
      'chocolate',
      'coffee',
      'almond',
      'pistachio',
      'milk',
      'tonka',
      'tonka bean',
      'sugar',
      'biscuit',
      'cake',
      'cream',
      'creamy',
      'lactonic',
      'marshmallow',
      'hazelnut',
      'creme brulee',
    ],
    classification: ['gourmand'],
  },
  tropical: {
    strong: [
      'coconut',
      'coconut milk',
      'tiare flower',
      'ylang-ylang',
      'pineapple',
      'mango',
      'passion fruit',
      'fruity notes',
      'solar notes',
      'beach',
      'salt',
      'sea salt',
      'frangipani',
      'banana',
      'lime',
    ],
    classification: ['tropical'],
  },
  woody: {
    strong: [
      'cedar',
      'cedarwood',
      'sandalwood',
      'guaiac wood',
      'oud',
      'agarwood',
      'vetiver',
      'patchouli',
      'woods',
      'woody notes',
      'dry wood accord',
      'oakmoss',
      'cypress',
      'birch',
      'cashmeran',
    ],
    classification: ['woody', 'woody oriental'],
  },
  spicy: {
    strong: [
      'cinnamon',
      'pepper',
      'black pepper',
      'pink pepper',
      'white pepper',
      'cardamom',
      'saffron',
      'nutmeg',
      'clove',
      'ginger',
      'anise',
      'coriander',
      'cumin',
      'spicy notes',
      'spices',
    ],
    classification: ['spicy', 'warm spicy', 'oriental spicy'],
  },
  warm: {
    strong: [
      'amber',
      'vanilla',
      'tonka',
      'tonka bean',
      'benzoin',
      'labdanum',
      'cinnamon',
      'tobacco',
      'honey',
      'resin',
      'myrrh',
      'olibanum',
      'sandalwood',
      'patchouli',
    ],
    classification: ['warm spicy', 'amber', 'oriental'],
  },
  clean: {
    strong: [
      'musk',
      'white musk',
      'aldehydes',
      'lavender',
      'neroli',
      'bergamot',
      'citrus',
      'soap',
      'soapy',
      'fresh',
      'linen',
      'cotton',
      'iris',
      'powder',
      'powdery',
      'tea',
      'green tea',
    ],
    classification: ['clean', 'fresh'],
  },
  sweet: {
    strong: [
      'sweet',
      'sugar',
      'sugary',
      'caramel',
      'honey',
      'vanilla',
      'tonka',
      'tonka bean',
      'benzoin',
      'praline',
      'chocolate',
      'cacao',
      'syrup',
      'fruity',
      'fruity notes',
      'gourmand',
    ],
    classification: ['sweet', 'gourmand', 'amber vanilla', 'oriental gourmand'],
  },
  creamy: {
    strong: [
      'creamy',
      'cream',
      'whipped cream',
      'lactonic',
      'milk',
      'coconut milk',
      'vanilla',
      'sandalwood',
      'tonka',
      'tonka bean',
      'benzoin',
    ],
    classification: ['creamy', 'gourmand', 'amber vanilla', 'oriental vanilla'],
  },
}

const VIBE_FAMILIES: Record<string, string[]> = {
  fresh: [
    'fresh',
    'citrus',
    'citrus aromatic',
    'green citrus',
    'aromatic fresh',
    'citrus floral',
    'citron',
    'bergamot',
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'lime',
    'neroli',
    'mint',
    'aquatic',
    'aquatic notes',
    'green',
    'green notes',
    'musk',
    'white musk',
    'lavender',
    'aromatic',
    'aromatic herbs',
    'aldehydes',
    'tea',
    'green tea',
    'matcha tea',
    'verbena',
    'basil',
    'rosemary',
  ],
  citrus: [
    'citrus',
    'citrus aromatic',
    'green citrus',
    'citrus floral',
    'citron',
    'bergamot',
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'lime',
    'petitgrain',
    'neroli',
    'blood orange',
    'orange blossom',
    'yuzu',
  ],
  aromatic: [
    'aromatic',
    'aromatic herbs',
    'lavender',
    'mint',
    'neroli',
    'bergamot',
    'green',
    'green notes',
    'cardamom',
    'ginger',
    'basil',
    'rosemary',
    'thyme',
    'verbena',
  ],
  green: [
    'green notes',
    'green',
    'basil',
    'mint',
    'violet leaf',
    'tea',
    'green tea',
    'matcha tea',
    'grass',
    'fig leaf',
    'tomato leaf',
    'vetiver',
    'galbanum',
    'rosemary',
    'thyme',
    'bergamot',
    'citron',
    'neroli',
  ],
  aquatic: [
    'aquatic',
    'aquatic notes',
    'marine',
    'sea salt',
    'salt',
    'water notes',
    'ocean',
    'ozonic',
    'calone',
    'ambergris',
  ],
  clean: [
    'clean',
    'floral woody musk',
    'musk',
    'white musk',
    'aldehydes',
    'lavender',
    'neroli',
    'bergamot',
    'citrus',
    'soap',
    'soapy',
    'fresh',
    'linen',
    'cotton',
    'iris',
    'powder',
    'powdery',
    'tea',
    'green tea',
  ],
  sweet: [
    'sweet',
    'gourmand',
    'oriental gourmand',
    'amber vanilla',
    'oriental vanilla',
    'vanilla',
    'caramel',
    'honey',
    'tonka',
    'tonka bean',
    'praline',
    'sugar',
    'cacao',
    'chocolate',
    'benzoin',
    'amber',
    'dates',
    'marshmallow',
    'cotton candy',
    'fruits',
    'fruity notes',
    'cherry',
    'peach',
  ],
  dark: [
    'dark',
    'oriental',
    'oriental spicy',
    'woody oriental',
    'amber vanilla',
    'warm spicy',
    'oud',
    'agarwood',
    'leather',
    'incense',
    'tobacco',
    'amber',
    'patchouli',
    'smoke',
    'smoky',
    'woods',
    'woody notes',
    'labdanum',
    'resin',
    'myrrh',
    'olibanum',
    'birch',
    'black truffle',
    'rum',
    'saffron',
    'cypriol',
    'nagarmotha',
  ],
  masculine: [
    'masculine',
    'woody',
    'aromatic',
    'spicy',
    'cedar',
    'cedarwood',
    'vetiver',
    'leather',
    'oud',
    'agarwood',
    'musk',
    'amber',
    'pepper',
    'cardamom',
    'woods',
    'sandalwood',
    'tobacco',
    'incense',
    'patchouli',
    'bergamot',
    'lavender',
  ],
  spicy: [
    'spicy',
    'warm spicy',
    'oriental spicy',
    'cinnamon',
    'pepper',
    'black pepper',
    'pink pepper',
    'white pepper',
    'cardamom',
    'saffron',
    'nutmeg',
    'clove',
    'ginger',
    'anise',
    'coriander',
    'cumin',
    'spicy notes',
    'spices',
  ],
  warm: [
    'amber',
    'vanilla',
    'tonka',
    'tonka bean',
    'benzoin',
    'labdanum',
    'cinnamon',
    'tobacco',
    'honey',
    'resin',
    'myrrh',
    'olibanum',
    'sandalwood',
    'patchouli',
  ],
  creamy: [
    'creamy',
    'creamy vanilla',
    'gourmand',
    'amber vanilla',
    'oriental vanilla',
    'vanilla',
    'tonka',
    'tonka bean',
    'benzoin',
    'milk',
    'almond milk',
    'coconut milk',
    'caramel',
    'praline',
    'almond',
    'sandalwood',
    'musk',
    'white musk',
    'heliotrope',
    'lactonic',
    'cream',
    'whipped cream',
  ],
  tropical: [
    'coconut',
    'coconut milk',
    'tiare flower',
    'ylang-ylang',
    'pineapple',
    'mango',
    'passion fruit',
    'fruity notes',
    'solar notes',
    'beach',
    'salt',
    'sea salt',
    'frangipani',
    'banana',
    'lime',
  ],
  woody: [
    'woody',
    'woody oriental',
    'cedar',
    'cedarwood',
    'sandalwood',
    'guaiac wood',
    'oud',
    'agarwood',
    'vetiver',
    'patchouli',
    'woods',
    'woody notes',
    'dry wood accord',
    'oakmoss',
    'cypress',
    'birch',
    'cashmeran',
  ],
  floral: [
    'floral',
    'citrus floral',
    'floral woody musk',
    'rose',
    'jasmine',
    'orange blossom',
    'tuberose',
    'iris',
    'violet',
    'peony',
    'magnolia',
    'ylang-ylang',
    'lily',
    'lily of the valley',
    'gardenia',
    'freesia',
    'honeysuckle',
    'lavender',
    'waterlily',
    'lotus',
    'lotus wood',
  ],
  gourmand: [
    'gourmand',
    'oriental gourmand',
    'amber vanilla',
    'oriental vanilla',
    'vanilla',
    'caramel',
    'honey',
    'praline',
    'cacao',
    'chocolate',
    'coffee',
    'almond',
    'pistachio',
    'milk',
    'tonka',
    'tonka bean',
    'sugar',
    'biscuit',
    'cake',
    'cream',
    'marshmallow',
    'hazelnut',
  ],
  feminine: [
    'rose',
    'jasmine',
    'orange blossom',
    'tuberose',
    'iris',
    'violet',
    'peony',
    'magnolia',
    'vanilla',
    'musk',
    'white musk',
    'peach',
    'lychee',
    'pear',
    'raspberry',
    'powdery',
    'floral',
  ],
  powdery: [
    'iris',
    'violet',
    'heliotrope',
    'musk',
    'white musk',
    'almond',
    'tonka',
    'vanilla',
    'aldehydes',
    'powder',
    'powdery notes',
    'orris',
    'ambrette',
  ],
  musky: [
    'musk',
    'white musk',
    'ambrette',
    'ambroxan',
    'ambergris',
    'cashmeran',
    'iso e super',
    'skin musk',
  ],
  smoky: [
    'smoke',
    'smoky',
    'incense',
    'birch',
    'tobacco',
    'leather',
    'oud',
    'agarwood',
    'cade',
    'guaiac wood',
    'olibanum',
  ],
  leathery: [
    'leather',
    'suede',
    'saffron',
    'birch',
    'tobacco',
    'oud',
    'labdanum',
    'smoke',
    'smoky',
    'castoreum',
  ],
  fruity: [
    'peach',
    'pear',
    'apple',
    'pineapple',
    'mango',
    'lychee',
    'raspberry',
    'cherry',
    'plum',
    'black currant',
    'cassis',
    'blueberry',
    'strawberry',
    'passion fruit',
    'fruity notes',
  ],
  romantic: [
    'rose',
    'jasmine',
    'vanilla',
    'musk',
    'amber',
    'orange blossom',
    'patchouli',
    'tonka',
    'sandalwood',
    'honey',
    'saffron',
  ],
  sexy: [
    'amber',
    'vanilla',
    'musk',
    'tonka',
    'tobacco',
    'leather',
    'oud',
    'saffron',
    'sandalwood',
    'patchouli',
    'honey',
    'incense',
    'labdanum',
    'cinnamon',
  ],
  expensive: [
    'saffron',
    'oud',
    'ambergris',
    'amber',
    'sandalwood',
    'iris',
    'rose',
    'jasmine',
    'leather',
    'musk',
    'cedarwood',
    'bergamot',
    'incense',
    'orris',
  ],
  luxury: [
    'saffron',
    'oud',
    'ambergris',
    'amber',
    'sandalwood',
    'iris',
    'rose',
    'jasmine',
    'leather',
    'musk',
    'cedarwood',
    'bergamot',
    'incense',
    'orris',
  ],
  office: [
    'fresh',
    'clean',
    'citrus',
    'bergamot',
    'lemon',
    'mandarin',
    'musk',
    'white musk',
    'lavender',
    'neroli',
    'tea',
    'green tea',
    'aromatic',
    'woody',
    'cedar',
    'vetiver',
  ],
  'date night': [
    'amber',
    'vanilla',
    'tobacco',
    'oud',
    'leather',
    'incense',
    'musk',
    'honey',
    'tonka',
    'tonka bean',
    'saffron',
    'cinnamon',
    'spicy',
    'woody',
    'oriental',
    'gourmand',
    'patchouli',
    'sandalwood',
    'labdanum',
  ],
  'summer profile': [
    'citrus',
    'fresh',
    'aquatic',
    'green',
    'tropical',
    'bergamot',
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'citron',
    'lime',
    'neroli',
    'coconut',
    'tea',
    'mint',
    'musk',
    'sea salt',
    'aquatic notes',
  ],
  'winter profile': [
    'amber',
    'vanilla',
    'oud',
    'tobacco',
    'leather',
    'incense',
    'cinnamon',
    'honey',
    'tonka',
    'tonka bean',
    'patchouli',
    'sandalwood',
    'benzoin',
    'labdanum',
    'myrrh',
    'resin',
    'spicy notes',
    'cacao',
    'chocolate',
  ],
  'fall profile': [
    'amber',
    'tobacco',
    'vanilla',
    'cinnamon',
    'cardamom',
    'nutmeg',
    'clove',
    'honey',
    'leather',
    'patchouli',
    'woods',
    'sandalwood',
    'tonka',
    'apple',
    'caramel',
  ],
  'spring profile': [
    'floral',
    'rose',
    'jasmine',
    'peony',
    'orange blossom',
    'neroli',
    'green notes',
    'tea',
    'bergamot',
    'mandarin',
    'musk',
    'fresh',
    'clean',
    'violet',
    'iris',
  ],
}

const FLAVOR_INTENT_FAMILIES: Record<string, string[]> = {
  sweet: [
    'sweet',
    'sugar',
    'sugary',
    'caramel',
    'honey',
    'tonka',
    'tonka bean',
    'benzoin',
    'praline',
    'chocolate',
    'cacao',
    'syrup',
    'fruity',
    'fruity notes',
    'gourmand',
    'cream',
    'creamy',
  ],
  gourmand: [
    'gourmand',
    'vanilla',
    'caramel',
    'praline',
    'chocolate',
    'cacao',
    'coffee',
    'almond',
    'tonka',
    'tonka bean',
    'honey',
    'sugar',
    'cream',
    'creamy',
    'lactonic',
  ],
  creamy: [
    'creamy',
    'cream',
    'whipped cream',
    'lactonic',
    'milk',
    'coconut milk',
    'sandalwood',
    'tonka',
    'tonka bean',
    'benzoin',
  ],
  fresh: [
    'fresh',
    'citrus',
    'bergamot',
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'neroli',
    'aquatic',
    'green',
    'clean',
    'aromatic',
  ],
  clean: [
    'clean',
    'musk',
    'white musk',
    'powdery',
    'soap',
    'soapy',
    'aldehydes',
    'iris',
    'lavender',
    'fresh',
    'cotton',
  ],
  citrus: [
    'citrus',
    'bergamot',
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'lime',
    'neroli',
    'petitgrain',
  ],
  tropical: [
    'coconut',
    'coconut milk',
    'coconut water',
    'tiare',
    'tiare flower',
    'tropical',
    'solar',
    'solar notes',
    'lactonic',
    'creamy',
    'pineapple',
    'mango',
  ],
  dark: [
    'dark',
    'oud',
    'agarwood',
    'incense',
    'leather',
    'smoke',
    'smoky',
    'tobacco',
    'patchouli',
    'amber',
    'resin',
    'spicy',
  ],
  spicy: [
    'spicy',
    'spice',
    'cinnamon',
    'cardamom',
    'pepper',
    'saffron',
    'clove',
    'nutmeg',
    'ginger',
  ],
  smoky: ['smoky', 'smoke', 'incense', 'tobacco', 'leather', 'oud', 'birch', 'cade', 'resin'],
  woody: ['woody', 'woods', 'cedar', 'sandalwood', 'vetiver', 'oud', 'guaiac', 'patchouli'],
  floral: ['floral', 'rose', 'jasmine', 'iris', 'violet', 'orange blossom', 'tuberose', 'peony', 'ylang'],
  powdery: ['powdery', 'powder', 'iris', 'violet', 'musk', 'vanilla', 'almond', 'heliotrope'],
  musky: ['musk', 'musky', 'white musk', 'skin', 'clean', 'powdery', 'ambrette'],
  amber: ['amber', 'benzoin', 'labdanum', 'resin', 'vanilla', 'tonka', 'warm', 'spicy'],
  masculine: ['masculine', 'woody', 'aromatic', 'spicy', 'cedar', 'vetiver', 'leather', 'oud', 'musk', 'amber'],
  feminine: ['feminine', 'floral', 'rose', 'jasmine', 'orange blossom', 'vanilla', 'musk', 'powdery', 'fruity'],
  aquatic: ['aquatic', 'marine', 'sea salt', 'water notes', 'ocean', 'ozonic', 'fresh'],
  green: ['green', 'green notes', 'basil', 'mint', 'tea', 'grass', 'fig leaf', 'vetiver', 'rosemary'],
  warm: ['warm', 'cozy', 'amber', 'vanilla', 'tonka', 'benzoin', 'labdanum', 'cinnamon', 'tobacco', 'honey'],
  cozy: ['cozy', 'warm', 'amber', 'vanilla', 'tonka', 'benzoin', 'cinnamon', 'sandalwood'],
}

const VIBE_ALIASES: Record<string, string[]> = {
  sexy: ['seductive', 'attractive'],
  luxury: ['classy', 'rich'],
  warm: ['cozy'],
  office: ['work', 'professional', 'school'],
  'date night': ['night', 'evening', 'going out'],
  'summer profile': ['summer', 'hot weather'],
  'winter profile': ['winter', 'cold weather'],
  'fall profile': ['fall', 'autumn'],
  'spring profile': ['spring'],
}

const SCENT_INTENT_NOTE_ALLOWLIST = [
  'aoud',
  'oudh',
  'white floral',
  'white musk',
  'skin musk',
  'soft musk',
  'lactonic',
  'coumarin',
  'oakmoss',
  'moss',
  'galbanum',
  'fig leaf',
  'tomato leaf',
  'ivy',
  'grass',
  'leaf',
  'leaves',
  'marine',
  'sea',
  'sea salt',
  'salt',
  'ozonic',
  'mineral',
  'rain',
  'cucumber',
  'water lily',
  'lotus',
  'calone',
  'soap',
  'soapy',
  'linen',
  'cotton',
  'lily of the valley',
  'lily',
  'carnation',
  'frangipani',
  'tiare',
  'tiaré',
  'tangerine',
  'pomelo',
  'verbena',
  'lemongrass',
  'sage',
  'clary sage',
  'thyme',
  'artemisia',
  'juniper',
  'eucalyptus',
  'fennel',
  'star anise',
  'lychee',
  'strawberry',
  'blueberry',
  'plum',
  'cassis',
  'blackcurrant',
  'berries',
  'grape',
  'melon',
  'guava',
  'banana',
  'papaya',
  'sugar',
  'marshmallow',
  'cotton candy',
  'biscuit',
  'cake',
  'whipped cream',
  'amaretto',
  'liqueur',
  'brandy',
  'whiskey',
  'whisky',
  'champagne',
  'opoponax',
  'pine',
  'fir',
  'oak',
  'dry woods',
  'cashmere wood',
  'animalic',
  'cade',
  'lapsang tea',
  'charcoal',
  'ash',
  'fireplace',
  'blonde tobacco',
  'dried fruit',
  'makeup',
  'lipstick',
  'soil',
  'roots',
  'truffle',
  'mushroom',
]

const SCENT_INTENT_NOTE_FAMILIES: Record<string, NoteFamily> = {
  aoud: NOTE_FAMILIES.oud,
  oudh: NOTE_FAMILIES.oud,
  lactonic: {
    strong: ['lactonic', 'milk', 'milky', 'cream', 'creamy', 'coconut milk'],
    soft: ['vanilla', 'tonka', 'sandalwood', 'almond', 'heliotrope', 'musk'],
    classification: ['lactonic', 'creamy', 'gourmand'],
  },
  'white floral': {
    strong: [
      'jasmine',
      'tuberose',
      'gardenia',
      'orange blossom',
      'neroli',
      'lily',
      'frangipani',
      'ylang-ylang',
      'honeysuckle',
      'magnolia',
      'tiare',
      'tiaré',
    ],
    classification: ['white floral', 'floral'],
  },
  earthy: {
    strong: ['earthy', 'soil', 'patchouli', 'vetiver', 'moss', 'oakmoss', 'roots', 'truffle', 'mushroom', 'mineral'],
    soft: ['green', 'woody', 'damp', 'galbanum'],
    classification: ['earthy', 'chypre'],
  },
  chypre: {
    strong: ['chypre', 'bergamot', 'rose', 'jasmine', 'patchouli', 'oakmoss', 'moss', 'labdanum'],
    soft: ['earthy', 'woody', 'green', 'elegant'],
    classification: ['chypre'],
  },
  fougere: {
    strong: ['fougere', 'lavender', 'coumarin', 'tonka', 'oakmoss', 'geranium', 'aromatic', 'herbs'],
    soft: ['woody', 'fresh spicy', 'barbershop'],
    classification: ['fougere', 'aromatic fougere'],
  },
  resinous: {
    strong: ['resinous', 'resin', 'benzoin', 'labdanum', 'myrrh', 'frankincense', 'olibanum', 'opoponax'],
    soft: ['amber', 'incense', 'pine resin', 'balsamic'],
    classification: ['resinous', 'amber', 'balsamic'],
  },
  balsamic: {
    strong: ['balsamic', 'benzoin', 'labdanum', 'myrrh', 'frankincense', 'olibanum', 'opoponax', 'amber'],
    soft: ['resin', 'resinous', 'incense'],
    classification: ['balsamic', 'amber', 'resinous'],
  },
  boozy: {
    strong: ['boozy', 'rum', 'cognac', 'whiskey', 'whisky', 'brandy', 'liqueur', 'wine', 'champagne', 'amaretto'],
    soft: ['cherry liqueur', 'vanilla', 'tobacco'],
    classification: ['boozy'],
  },
}

const SCENT_INTENT_VIBE_FAMILIES: Record<string, string[]> = {
  lactonic: ['lactonic', 'milk', 'milky', 'cream', 'creamy', 'coconut milk', 'vanilla', 'sandalwood', 'musk'],
  soft: ['soft', 'musk', 'white musk', 'skin', 'clean', 'powdery', 'floral', 'vanilla', 'soft musk'],
  bright: ['bright', 'fresh', 'citrus', 'sparkling', 'clean', 'green', 'fruity', 'bergamot', 'lemon', 'neroli'],
  dark: [...VIBE_FAMILIES.dark, 'black leather', 'dark tobacco', 'dark woody', 'charcoal', 'ash'],
  unisex: ['unisex', 'balanced', 'woody', 'musk', 'amber', 'citrus', 'aromatic', 'fresh', 'clean'],
  earthy: ['earthy', 'soil', 'patchouli', 'vetiver', 'moss', 'oakmoss', 'roots', 'mineral', 'green', 'woody'],
  resinous: ['resinous', 'resin', 'balsamic', 'benzoin', 'labdanum', 'myrrh', 'frankincense', 'olibanum', 'amber', 'incense'],
  balsamic: ['balsamic', 'benzoin', 'labdanum', 'myrrh', 'opoponax', 'amber', 'resin', 'incense'],
  chypre: ['chypre', 'bergamot', 'rose', 'jasmine', 'patchouli', 'oakmoss', 'moss', 'labdanum', 'green', 'woody'],
  fougere: ['fougere', 'lavender', 'coumarin', 'tonka', 'oakmoss', 'geranium', 'aromatic', 'fresh spicy', 'barbershop'],
  boozy: ['boozy', 'rum', 'cognac', 'whiskey', 'brandy', 'liqueur', 'amaretto', 'cherry liqueur', 'vanilla', 'tobacco'],
  tea: ['tea', 'black tea', 'green tea', 'matcha', 'mate', 'earl grey', 'bergamot', 'smoky tea', 'herbal', 'fresh', 'aromatic'],
  'white floral': ['white floral', 'jasmine', 'tuberose', 'gardenia', 'orange blossom', 'neroli', 'lily', 'frangipani', 'ylang-ylang', 'tiare'],
  barbershop: ['barbershop', 'fougere', 'lavender', 'oakmoss', 'aromatic', 'fresh spicy', 'geranium', 'tonka'],
  'blue fragrance': ['blue fragrance', 'fresh', 'aquatic', 'citrus', 'aromatic', 'woody', 'amber', 'clean'],
  'fresh spicy': ['fresh spicy', 'fresh', 'spicy', 'cardamom', 'ginger', 'pepper', 'citrus', 'aromatic'],
  'green citrus': ['green citrus', 'green', 'citrus', 'bergamot', 'lemon', 'lime', 'petitgrain', 'neroli', 'verbena'],
  'clean citrus': ['clean citrus', 'clean', 'citrus', 'musk', 'white musk', 'bergamot', 'lemon', 'neroli', 'soap'],
  'citrus aromatic': ['citrus aromatic', 'citrus', 'aromatic', 'bergamot', 'citron', 'orange', 'neroli', 'ginger', 'lavender', 'rosemary'],
  'fresh citrus': ['fresh citrus', 'fresh', 'citrus', 'bergamot', 'lemon', 'lime', 'grapefruit', 'mandarin', 'neroli'],
  'fresh aromatic': ['fresh aromatic', 'fresh', 'aromatic', 'lavender', 'rosemary', 'mint', 'basil', 'bergamot', 'green'],
  'clean musk': ['clean musk', 'clean', 'musk', 'white musk', 'skin musk', 'laundry', 'cotton', 'soapy', 'soft'],
  'fresh musk': ['fresh musk', 'fresh', 'musk', 'white musk', 'clean', 'citrus', 'green'],
  'sweet vanilla': ['sweet vanilla', 'sweet', 'vanilla', 'gourmand', 'tonka', 'benzoin', 'caramel', 'cream'],
  'creamy vanilla': ['creamy vanilla', 'creamy', 'vanilla', 'lactonic', 'tonka', 'benzoin', 'milk', 'sandalwood'],
  'vanilla gourmand': ['vanilla gourmand', 'vanilla', 'gourmand', 'caramel', 'praline', 'tonka', 'cream', 'sugar'],
  'vanilla amber': ['vanilla amber', 'vanilla', 'amber', 'benzoin', 'labdanum', 'tonka', 'warm'],
  'amber vanilla': ['amber vanilla', 'amber', 'vanilla', 'benzoin', 'labdanum', 'tonka', 'warm'],
  'sweet gourmand': ['sweet gourmand', 'sweet', 'gourmand', 'vanilla', 'caramel', 'praline', 'chocolate', 'honey'],
  'sweet cherry': ['sweet cherry', 'sweet', 'cherry', 'almond', 'tonka', 'vanilla', 'fruity', 'liqueur'],
  'cherry almond': ['cherry almond', 'cherry', 'almond', 'tonka', 'vanilla', 'amaretto', 'sweet'],
  'honey tobacco': ['honey tobacco', 'honey', 'tobacco', 'amber', 'vanilla', 'cinnamon', 'warm'],
  'tobacco honey': ['tobacco honey', 'tobacco', 'honey', 'amber', 'vanilla', 'cinnamon', 'warm'],
  'tropical coconut': ['tropical coconut', 'tropical', 'coconut', 'coconut milk', 'tiare', 'solar', 'beachy', 'pineapple'],
  'creamy coconut': ['creamy coconut', 'creamy', 'coconut', 'coconut milk', 'lactonic', 'vanilla', 'sandalwood'],
  'beachy coconut': ['beachy coconut', 'beachy', 'coconut', 'tropical', 'solar', 'aquatic', 'citrus', 'white floral'],
  'solar coconut': ['solar coconut', 'solar', 'coconut', 'tropical', 'tiare', 'white floral', 'beachy'],
  'dark oud': ['dark oud', 'dark', 'oud', 'agarwood', 'smoky', 'incense', 'resin', 'leather', 'amber'],
  'smoky oud': ['smoky oud', 'smoky', 'oud', 'incense', 'resin', 'leather', 'dark'],
  'rose oud': ['rose oud', 'rose', 'oud', 'saffron', 'amber', 'musk', 'dark'],
  'oud rose': ['oud rose', 'oud', 'rose', 'saffron', 'amber', 'musk', 'dark'],
  'oud leather': ['oud leather', 'oud', 'leather', 'smoky', 'saffron', 'amber', 'dark'],
  'woody masculine': ['woody masculine', 'woody', 'masculine', 'cedar', 'vetiver', 'sandalwood', 'leather', 'aromatic'],
  'sandalwood musk': ['sandalwood musk', 'sandalwood', 'musk', 'creamy', 'soft', 'woody'],
  'vetiver citrus': ['vetiver citrus', 'vetiver', 'citrus', 'green', 'bergamot', 'grapefruit', 'woody'],
  'smoky leather': ['smoky leather', 'smoky', 'leather', 'birch', 'tobacco', 'saffron', 'amber', 'woody'],
  'leather tobacco': ['leather tobacco', 'leather', 'tobacco', 'smoky', 'amber', 'spicy', 'woody'],
  'sweet tobacco': ['sweet tobacco', 'sweet', 'tobacco', 'honey', 'vanilla', 'tonka', 'cherry'],
  'vanilla tobacco': ['vanilla tobacco', 'vanilla', 'tobacco', 'tonka', 'amber', 'sweet', 'warm'],
  'rose musk': ['rose musk', 'rose', 'musk', 'floral', 'soft', 'clean'],
  'rose vanilla': ['rose vanilla', 'rose', 'vanilla', 'sweet', 'floral', 'musk'],
  'jasmine vanilla': ['jasmine vanilla', 'jasmine', 'vanilla', 'white floral', 'sweet', 'musk'],
  'powdery floral': ['powdery floral', 'powdery', 'floral', 'iris', 'violet', 'musk', 'heliotrope'],
  'fresh floral': ['fresh floral', 'fresh', 'floral', 'musk', 'citrus', 'green', 'peony', 'rose'],
  office: ['office', 'clean', 'fresh', 'subtle', 'polished', 'citrus', 'aromatic', 'green', 'musk', 'soft woods', 'tea'],
  everyday: ['everyday', 'daily', 'casual', 'versatile', 'clean', 'fresh', 'soft woody', 'soft musk', 'light sweet'],
  school: ['school', 'class', 'clean', 'fresh', 'soft', 'inoffensive', 'citrus', 'aquatic', 'green', 'white musk'],
  'clean office': ['clean office', 'office', 'clean', 'fresh', 'citrus', 'aromatic', 'musk', 'soft floral'],
  'date night': [...VIBE_FAMILIES['date night'], 'sensual', 'smooth', 'romantic', 'warm', 'slightly sweet'],
  'night out': ['night out', 'going out', 'bold', 'sweet', 'warm', 'dark', 'projecting', 'amber', 'vanilla', 'tobacco'],
  gym: ['gym', 'workout', 'fresh', 'clean', 'citrus', 'aquatic', 'green', 'clean musk', 'airy', 'soapy', 'ozonic'],
  vacation: ['vacation', 'beach', 'resort', 'tropical', 'coconut', 'solar', 'citrus', 'aquatic', 'fruity', 'white floral'],
  formal: ['formal', 'elegant', 'wedding', 'refined', 'polished', 'woody', 'amber', 'floral', 'chypre', 'musk', 'iris'],
  party: ['party', 'club', 'sweet', 'loud', 'amber', 'spicy', 'vanilla', 'fruity', 'woody', 'projection', 'night'],
  cozy: ['cozy', 'cold weather', 'warm', 'vanilla', 'amber', 'tonka', 'cinnamon', 'tobacco', 'resin', 'gourmand'],
  'hot weather': ['hot weather', 'summer', 'fresh', 'bright', 'citrus', 'aquatic', 'green', 'mint', 'tea', 'light floral'],
  subtle: ['subtle', 'skin scent', 'soft', 'clean', 'musky', 'powdery', 'airy', 'white musk', 'ambrette', 'iris'],
  performance: ['long lasting', 'performance', 'amber', 'vanilla', 'oud', 'woods', 'musk', 'patchouli', 'tobacco', 'resin'],
  'compliment friendly': [
    'compliment friendly',
    'mass appealing',
    'crowd pleasing',
    'easy to wear',
    'versatile',
    'fresh',
    'clean',
    'citrus',
    'vanilla',
    'amber',
    'musk',
    'woody aromatic',
    'light sweet',
    'everyday',
    'office safe',
  ],
  'beginner safe': [
    'beginner safe',
    'blind buy friendly',
    'safe pick',
    'easy to wear',
    'versatile',
    'inoffensive',
    'fresh',
    'clean',
    'citrus',
    'musk',
    'vanilla',
    'amber',
    'soft woods',
    'woody aromatic',
    'everyday',
    'office safe',
  ],
}

const SCENT_INTENT_ALIASES: Record<string, string[]> = {
  fresh: ['crisp', 'airy', 'light', 'sparkling', 'refreshing'],
  clean: ['shower fresh', 'laundry', 'soapy', 'soap', 'cotton', 'linen'],
  citrus: ['bright citrus', 'sparkling citrus', 'summer citrus'],
  aromatic: ['herbal', 'herbaceous'],
  coconut: ['beachy coconut', 'solar coconut'],
  tropical: ['beachy', 'vacation'],
  masculine: ['cologne style'],
  feminine: ['soft feminine'],
  unisex: ['balanced'],
  luxury: ['expensive', 'refined', 'smooth'],
  sexy: ['sensual', 'date night'],
  office: ['work', 'professional'],
  everyday: ['daily', 'casual'],
  school: ['class'],
  'date night': ['romantic'],
  'night out': ['going out'],
  'summer profile': ['hot weather'],
  'winter profile': ['cold weather', 'cozy'],
  'compliment friendly': [
    'compliments',
    'compliment getter',
    'gets compliments',
    'mass appealing',
    'crowd pleasing',
    'safe pick',
    'easy to wear',
  ],
  'beginner safe': [
    'beginner safe',
    'beginner friendly',
    'blind buy friendly',
    'safe pick',
    'safe choice',
    'easy to wear',
    'mass appealing',
  ],
}

type OccasionProfile = {
  aliases: string[]
  boost: string[]
  allow: string[]
  penalize: string[]
  penaltyCap: number
}

const REFERENCE_MODIFIERS: ReferenceModifier[] = [
  {
    key: 'sweeter',
    label: 'sweeter',
    aliases: ['sweeter', 'more sweet', 'more sweetness'],
    boost: ['sweet', 'vanilla', 'caramel', 'honey', 'tonka', 'benzoin', 'amber', 'gourmand', 'fruity', 'cherry', 'almond'],
    penalize: [],
  },
  {
    key: 'less-sweet',
    label: 'less sweet',
    aliases: ['less sweet', 'not as sweet', 'less sugary'],
    boost: ['fresh', 'clean', 'woody', 'aromatic', 'musk'],
    penalize: ['sweet', 'sugary', 'caramel', 'honey', 'vanilla', 'gourmand', 'syrup', 'candy'],
  },
  {
    key: 'fresher',
    label: 'fresher',
    aliases: ['fresher', 'more fresh', 'fresh version'],
    boost: ['citrus', 'bergamot', 'lemon', 'orange', 'mandarin', 'grapefruit', 'neroli', 'petitgrain', 'aquatic', 'green', 'aromatic', 'clean', 'mint', 'tea'],
    penalize: ['dense gourmand', 'heavy tobacco', 'thick vanilla', 'smoky'],
  },
  {
    key: 'less-fresh',
    label: 'less fresh',
    aliases: ['less fresh', 'not as fresh'],
    boost: ['amber', 'vanilla', 'woody', 'musk', 'warm'],
    penalize: ['citrus', 'aquatic', 'green', 'sharp fresh', 'watery'],
  },
  {
    key: 'creamier',
    label: 'creamier',
    aliases: ['creamier', 'more creamy', 'more lactonic'],
    boost: ['creamy', 'cream', 'lactonic', 'milk', 'coconut milk', 'vanilla', 'sandalwood', 'tonka', 'benzoin'],
    penalize: [],
  },
  {
    key: 'tropical',
    label: 'more tropical',
    aliases: ['more tropical', 'tropical', 'more beachy'],
    boost: ['coconut', 'coconut milk', 'coconut water', 'tiare', 'tropical fruit', 'pineapple', 'mango', 'passion fruit', 'solar', 'beachy', 'white floral'],
    penalize: ['dark oud', 'heavy tobacco', 'smoky incense'],
  },
  {
    key: 'masculine',
    label: 'more masculine',
    aliases: ['more masculine', 'masculine'],
    boost: ['woody', 'aromatic', 'spicy', 'amber', 'leather', 'tobacco', 'vetiver', 'cedar', 'sandalwood', 'clean fresh'],
    penalize: [],
  },
  {
    key: 'feminine',
    label: 'more feminine',
    aliases: ['more feminine', 'feminine'],
    boost: ['floral', 'rose', 'jasmine', 'orange blossom', 'iris', 'violet', 'fruity', 'vanilla', 'musk', 'powdery', 'soft amber'],
    penalize: [],
  },
  {
    key: 'unisex',
    label: 'more unisex',
    aliases: ['more unisex', 'unisex'],
    boost: ['balanced', 'citrus', 'aromatic', 'tea', 'musk', 'soft woods', 'amber', 'clean', 'green'],
    penalize: ['animalic', 'candy sweet'],
  },
  {
    key: 'office-safe',
    label: 'more office safe',
    aliases: ['more office safe', 'office safe', 'more work safe', 'more professional'],
    boost: ['clean', 'fresh', 'subtle', 'citrus', 'aquatic', 'green', 'soft woods', 'tea', 'lavender', 'soft musk', 'light floral'],
    penalize: ['oud', 'smoke', 'smoky', 'leather', 'tobacco', 'loud sweet', 'dense gourmand'],
  },
  {
    key: 'date-night',
    label: 'more date night',
    aliases: ['more date night', 'more romantic', 'sexier'],
    boost: ['warm', 'amber', 'vanilla', 'tonka', 'musk', 'rose', 'jasmine', 'sandalwood', 'sweet', 'spicy'],
    penalize: ['gym', 'watery fresh', 'laundry'],
  },
  {
    key: 'summer',
    label: 'more summer',
    aliases: ['more summer', 'summer', 'for summer'],
    boost: ['citrus', 'aquatic', 'green', 'fresh', 'tropical', 'coconut', 'neroli', 'mint', 'tea', 'light floral'],
    penalize: ['heavy amber', 'tobacco', 'leather', 'oud', 'smoky'],
  },
  {
    key: 'winter',
    label: 'more winter',
    aliases: ['more winter', 'winter', 'for winter'],
    boost: ['amber', 'vanilla', 'tobacco', 'honey', 'oud', 'leather', 'smoke', 'spice', 'gourmand', 'resin', 'woody'],
    penalize: ['thin aquatic', 'sharp citrus'],
  },
  {
    key: 'smoky',
    label: 'more smoky',
    aliases: ['more smoky', 'smokier'],
    boost: ['smoke', 'smoky', 'incense', 'tobacco', 'leather', 'oud', 'birch', 'cade', 'resin'],
    penalize: [],
  },
  {
    key: 'less-smoky',
    label: 'less smoky',
    aliases: ['less smoky', 'less smoke', 'not as smoky'],
    boost: ['clean', 'fresh', 'musk', 'floral', 'citrus'],
    penalize: ['smoke', 'smoky', 'incense', 'tobacco', 'burnt', 'leather', 'birch', 'cade'],
  },
  {
    key: 'woody',
    label: 'more woody',
    aliases: ['more woody', 'woodier'],
    boost: ['cedar', 'sandalwood', 'vetiver', 'oud', 'patchouli', 'guaiac', 'cypress', 'woods', 'woody'],
    penalize: [],
  },
  {
    key: 'less-woody',
    label: 'less woody',
    aliases: ['less woody', 'not as woody'],
    boost: ['fresh', 'floral', 'citrus', 'musk'],
    penalize: ['heavy woods', 'cedar', 'vetiver', 'oud', 'dry woods'],
  },
  {
    key: 'floral',
    label: 'more floral',
    aliases: ['more floral', 'floral'],
    boost: ['rose', 'jasmine', 'iris', 'violet', 'peony', 'orange blossom', 'tuberose', 'white floral', 'floral'],
    penalize: [],
  },
  {
    key: 'less-floral',
    label: 'less floral',
    aliases: ['less floral', 'not as floral'],
    boost: ['woody', 'musk', 'amber', 'citrus'],
    penalize: ['rose', 'jasmine', 'tuberose', 'white floral', 'floral'],
  },
  {
    key: 'powdery',
    label: 'more powdery',
    aliases: ['more powdery', 'powderier'],
    boost: ['iris', 'violet', 'heliotrope', 'musk', 'almond', 'powder', 'powdery', 'makeup', 'lipstick'],
    penalize: [],
  },
  {
    key: 'less-powdery',
    label: 'less powdery',
    aliases: ['less powdery', 'not as powdery'],
    boost: ['fresh', 'clean', 'woody', 'citrus'],
    penalize: ['powder', 'powdery', 'iris', 'violet', 'makeup'],
  },
  {
    key: 'clean',
    label: 'cleaner',
    aliases: ['cleaner', 'more clean'],
    boost: ['clean', 'musk', 'white musk', 'soapy', 'aldehydes', 'cotton', 'linen', 'fresh', 'soft floral'],
    penalize: ['animalic', 'smoke', 'heavy oud'],
  },
  {
    key: 'less-clean',
    label: 'less clean',
    aliases: ['less clean', 'not as clean'],
    boost: ['warm', 'amber', 'vanilla', 'woody'],
    penalize: ['laundry', 'soapy', 'aldehydes'],
  },
  {
    key: 'oud',
    label: 'more oud',
    aliases: ['more oud', 'oudier'],
    boost: ['oud', 'agarwood', 'resin', 'rose oud', 'smoky oud', 'woody oud', 'amber oud'],
    penalize: [],
  },
  {
    key: 'less-oud',
    label: 'less oud',
    aliases: ['less oud', 'not as oud'],
    boost: ['fresh', 'musk', 'amber', 'woods'],
    penalize: ['oud', 'agarwood', 'aoud', 'oudh', 'dark oud'],
  },
  {
    key: 'spicy',
    label: 'more spicy',
    aliases: ['more spicy', 'spicier'],
    boost: ['cinnamon', 'cardamom', 'pepper', 'saffron', 'clove', 'nutmeg', 'ginger', 'spice', 'spicy'],
    penalize: [],
  },
  {
    key: 'less-spicy',
    label: 'less spicy',
    aliases: ['less spicy', 'not as spicy'],
    boost: ['smooth', 'musk', 'vanilla', 'soft woods'],
    penalize: ['spice', 'spicy', 'cinnamon', 'pepper', 'saffron', 'clove'],
  },
]

const REFERENCE_NAME_ALIASES: Record<string, string[]> = {
  'lafayette street': ['lafayette avenue'],
  'afternoon swim': ['afterdawn swim'],
  imagination: ['imaginique'],
  tygar: ['tygara', 'le gemme tygar'],
  'oud wood': ['woody oud'],
  'blonde amber': ['amber luxe'],
  'baccarat rouge 540': ['baccarata 440'],
  'baccarat rouge 540 extrait': ['baccarata intense 440'],
  naxos: ['naxian gold'],
}

const REFERENCE_FAMILY_CONFLICTS: Record<string, string[]> = {
  fresh: [
    'heavy amber',
    'oriental',
    'rum',
    'olibanum',
    'incense',
    'smoky',
    'smoke',
    'tobacco',
    'leather',
    'heavy vanilla',
    'dense gourmand',
    'gourmand',
    'oud',
    'agarwood',
    'dark',
    'warm spicy',
  ],
  citrus: [
    'heavy amber',
    'oriental',
    'rum',
    'olibanum',
    'incense',
    'smoky',
    'tobacco',
    'leather',
    'dense gourmand',
    'dark',
  ],
  aromatic: [
    'heavy amber',
    'dense gourmand',
    'rum',
    'smoky',
    'tobacco',
    'dark',
  ],
  clean: [
    'smoky',
    'smoke',
    'tobacco',
    'leather',
    'loud sweet',
    'dense gourmand',
    'heavy oud',
    'oud',
    'animalic',
    'dark',
  ],
  aquatic: ['heavy amber', 'tobacco', 'leather', 'smoky', 'dense gourmand', 'oud'],
  green: ['heavy amber', 'tobacco', 'leather', 'dense gourmand', 'dark oud'],
  sweet: ['sharp citrus-only', 'thin aquatic'],
  gourmand: ['sharp citrus-only', 'thin aquatic', 'green'],
  vanilla: ['sharp citrus-only', 'thin aquatic'],
  oud: ['fresh citrus-only', 'watery', 'thin aquatic'],
  woody: ['candy sweet', 'thin aquatic'],
  tobacco: ['watery fresh', 'thin aquatic', 'clean laundry'],
}

const PROFILE_COMPATIBILITY_FAMILIES: Record<string, string[]> = {
  fresh: ['fresh', 'citrus', 'clean', 'airy', 'bright', 'tea', 'green', 'aquatic', 'aromatic', 'musk'],
  citrus: ['citrus', 'bergamot', 'lemon', 'lime', 'orange', 'mandarin', 'grapefruit', 'yuzu', 'citron', 'neroli', 'petitgrain'],
  clean: ['clean', 'soapy', 'soap', 'white musk', 'musk', 'aldehydes', 'cotton', 'linen', 'fresh', 'soft floral'],
  aquatic: ['aquatic', 'marine', 'water', 'watery', 'ozonic', 'rain', 'cucumber', 'calone'],
  aromatic: ['aromatic', 'lavender', 'rosemary', 'sage', 'thyme', 'basil', 'mint', 'ginger', 'tea', 'fougere'],
  green: ['green', 'green notes', 'grass', 'galbanum', 'violet leaf', 'fig leaf', 'tea', 'vetiver', 'petitgrain'],
  fruity: ['fruity', 'fruit', 'apple', 'pear', 'peach', 'cherry', 'raspberry', 'pineapple', 'mango', 'black currant', 'lychee'],
  sweet: ['sweet', 'sugar', 'caramel', 'honey', 'vanilla', 'tonka', 'benzoin', 'praline', 'chocolate', 'fruity'],
  vanilla: ['vanilla', 'vanilla pod', 'vanilla bean', 'bourbon vanilla', 'tonka', 'benzoin', 'cream', 'amber'],
  creamy: ['creamy', 'cream', 'milk', 'lactonic', 'vanilla', 'tonka', 'sandalwood', 'coconut milk'],
  gourmand: ['gourmand', 'vanilla', 'caramel', 'honey', 'chocolate', 'coffee', 'almond', 'pistachio', 'cream', 'milk'],
  amber: ['amber', 'benzoin', 'labdanum', 'resin', 'vanilla', 'tonka', 'warm', 'oriental'],
  oriental: ['oriental', 'amber', 'warm', 'spicy', 'resin', 'vanilla', 'benzoin', 'labdanum'],
  spicy: ['spicy', 'spice', 'cinnamon', 'cardamom', 'pepper', 'saffron', 'clove', 'nutmeg', 'ginger'],
  woody: ['woody', 'woods', 'cedar', 'cedarwood', 'sandalwood', 'vetiver', 'patchouli', 'oud', 'guaiac', 'cypress'],
  oud: ['oud', 'agarwood', 'aoud', 'oudh', 'resin', 'saffron', 'rose', 'leather', 'smoky'],
  smoky: ['smoky', 'smoke', 'incense', 'tobacco', 'leather', 'oud', 'birch', 'cade', 'resin'],
  leather: ['leather', 'suede', 'saffron', 'birch', 'tobacco', 'smoky', 'amber', 'oud'],
  tobacco: ['tobacco', 'tobacco leaf', 'honey', 'vanilla', 'tonka', 'amber', 'cinnamon', 'smoky', 'rum'],
  floral: ['floral', 'rose', 'jasmine', 'iris', 'violet', 'orange blossom', 'tuberose', 'peony', 'musk'],
  rose: ['rose', 'damask rose', 'turkish rose', 'geranium', 'peony', 'lychee', 'musk', 'oud'],
  'white floral': ['white floral', 'jasmine', 'tuberose', 'gardenia', 'orange blossom', 'neroli', 'ylang-ylang'],
  musk: ['musk', 'white musk', 'skin musk', 'ambrette', 'clean', 'powdery', 'soft', 'cotton'],
  powdery: ['powdery', 'powder', 'iris', 'violet', 'heliotrope', 'musk', 'almond', 'vanilla'],
  chypre: ['chypre', 'oakmoss', 'moss', 'patchouli', 'bergamot', 'rose', 'jasmine', 'labdanum', 'woody'],
  fougere: ['fougere', 'lavender', 'oakmoss', 'tonka', 'coumarin', 'geranium', 'aromatic', 'fresh spicy'],
  resinous: ['resinous', 'resin', 'benzoin', 'labdanum', 'myrrh', 'olibanum', 'frankincense', 'amber', 'incense'],
  tropical: ['tropical', 'coconut', 'coconut milk', 'tiare', 'pineapple', 'mango', 'solar', 'beachy', 'white floral'],
  coconut: ['coconut', 'coconut milk', 'coconut water', 'tiare', 'tropical', 'solar', 'vanilla', 'sandalwood'],
  dark: ['dark', 'oud', 'leather', 'smoke', 'tobacco', 'incense', 'patchouli', 'amber', 'resin'],
  'compliment friendly': ['fresh', 'clean', 'citrus', 'vanilla', 'amber', 'musk', 'woody', 'aromatic', 'sweet', 'everyday', 'office'],
  'beginner safe': ['fresh', 'clean', 'citrus', 'musk', 'vanilla', 'amber', 'woody', 'aromatic', 'soft', 'everyday', 'office'],
}

type AccordRule = {
  accord: string
  terms: string[]
  minMatches: number
}

const NOTE_ACCORD_RULES: AccordRule[] = [
  {
    accord: 'citrus',
    terms: ['bergamot', 'lemon', 'lime', 'orange', 'mandarin', 'grapefruit', 'citron', 'yuzu', 'neroli', 'petitgrain'],
    minMatches: 1,
  },
  {
    accord: 'fresh',
    terms: ['bergamot', 'lemon', 'lime', 'grapefruit', 'neroli', 'mint', 'tea', 'green tea', 'lavender', 'ginger', 'aquatic notes', 'aldehydes'],
    minMatches: 1,
  },
  {
    accord: 'aromatic',
    terms: ['lavender', 'rosemary', 'sage', 'thyme', 'basil', 'mint', 'tea', 'ginger', 'cardamom', 'coriander'],
    minMatches: 1,
  },
  {
    accord: 'green',
    terms: ['green notes', 'grass', 'galbanum', 'violet leaf', 'fig leaf', 'tea', 'vetiver', 'basil', 'mint', 'petitgrain'],
    minMatches: 1,
  },
  {
    accord: 'aquatic',
    terms: ['aquatic notes', 'marine', 'sea salt', 'salt', 'water notes', 'ozonic', 'calone', 'ambergris'],
    minMatches: 1,
  },
  {
    accord: 'clean',
    terms: ['white musk', 'musk', 'aldehydes', 'soap', 'soapy', 'cotton', 'linen', 'iris', 'violet', 'tea', 'lavender'],
    minMatches: 1,
  },
  {
    accord: 'sweet',
    terms: ['vanilla', 'tonka', 'benzoin', 'caramel', 'honey', 'praline', 'chocolate', 'cacao', 'sugar', 'marshmallow', 'cherry', 'almond'],
    minMatches: 1,
  },
  {
    accord: 'gourmand',
    terms: ['vanilla', 'caramel', 'praline', 'chocolate', 'cacao', 'coffee', 'almond', 'pistachio', 'honey', 'tonka', 'sugar', 'marshmallow'],
    minMatches: 2,
  },
  {
    accord: 'vanilla',
    terms: ['vanilla', 'vanilla pod', 'vanilla bean', 'bourbon vanilla', 'tonka', 'benzoin'],
    minMatches: 1,
  },
  {
    accord: 'creamy',
    terms: ['cream', 'creamy', 'milk', 'coconut milk', 'vanilla', 'tonka', 'sandalwood', 'musk', 'heliotrope'],
    minMatches: 2,
  },
  {
    accord: 'lactonic',
    terms: ['milk', 'cream', 'creamy', 'coconut milk', 'almond milk', 'lactonic'],
    minMatches: 1,
  },
  {
    accord: 'tropical',
    terms: ['coconut', 'coconut milk', 'coconut water', 'tiare', 'pineapple', 'mango', 'passion fruit', 'banana', 'frangipani', 'ylang-ylang', 'solar notes'],
    minMatches: 1,
  },
  {
    accord: 'woody',
    terms: ['cedar', 'cedarwood', 'sandalwood', 'vetiver', 'patchouli', 'oud', 'agarwood', 'guaiac wood', 'cypress', 'woods', 'dry wood accord', 'oakmoss'],
    minMatches: 1,
  },
  {
    accord: 'amber',
    terms: ['amber', 'benzoin', 'labdanum', 'resin', 'vanilla', 'tonka', 'myrrh', 'olibanum'],
    minMatches: 1,
  },
  {
    accord: 'resinous',
    terms: ['resin', 'benzoin', 'labdanum', 'myrrh', 'olibanum', 'frankincense', 'incense', 'amber'],
    minMatches: 1,
  },
  {
    accord: 'spicy',
    terms: ['cinnamon', 'cardamom', 'pepper', 'saffron', 'clove', 'nutmeg', 'ginger', 'coriander', 'cumin'],
    minMatches: 1,
  },
  {
    accord: 'warm',
    terms: ['amber', 'vanilla', 'tonka', 'benzoin', 'cinnamon', 'tobacco', 'honey', 'resin', 'sandalwood', 'patchouli'],
    minMatches: 1,
  },
  {
    accord: 'smoky',
    terms: ['smoke', 'smoky', 'incense', 'tobacco', 'leather', 'birch', 'cade', 'oud', 'agarwood'],
    minMatches: 1,
  },
  {
    accord: 'dark',
    terms: ['oud', 'agarwood', 'leather', 'smoke', 'smoky', 'tobacco', 'incense', 'patchouli', 'amber', 'resin', 'rum'],
    minMatches: 2,
  },
  {
    accord: 'leather',
    terms: ['leather', 'suede', 'birch', 'saffron', 'tobacco', 'smoke', 'smoky'],
    minMatches: 1,
  },
  {
    accord: 'tobacco',
    terms: ['tobacco', 'tobacco leaf', 'honey', 'vanilla', 'tonka', 'amber', 'cinnamon', 'rum'],
    minMatches: 1,
  },
  {
    accord: 'floral',
    terms: ['rose', 'jasmine', 'iris', 'violet', 'peony', 'orange blossom', 'tuberose', 'gardenia', 'ylang-ylang', 'geranium'],
    minMatches: 1,
  },
  {
    accord: 'white floral',
    terms: ['jasmine', 'tuberose', 'gardenia', 'orange blossom', 'neroli', 'ylang-ylang', 'frangipani', 'tiare'],
    minMatches: 1,
  },
  {
    accord: 'powdery',
    terms: ['iris', 'violet', 'heliotrope', 'musk', 'almond', 'powder', 'powdery'],
    minMatches: 1,
  },
  {
    accord: 'musk',
    terms: ['musk', 'white musk', 'skin musk', 'ambrette', 'ambrettolide'],
    minMatches: 1,
  },
  {
    accord: 'fruity',
    terms: ['apple', 'pear', 'peach', 'cherry', 'raspberry', 'pineapple', 'mango', 'black currant', 'lychee', 'plum'],
    minMatches: 1,
  },
  {
    accord: 'chypre',
    terms: ['oakmoss', 'moss', 'patchouli', 'bergamot', 'rose', 'jasmine', 'labdanum'],
    minMatches: 2,
  },
  {
    accord: 'fougere',
    terms: ['lavender', 'oakmoss', 'tonka', 'coumarin', 'geranium', 'aromatic herbs'],
    minMatches: 2,
  },
  {
    accord: 'tea',
    terms: ['tea', 'black tea', 'green tea', 'matcha', 'mate', 'earl grey'],
    minMatches: 1,
  },
  {
    accord: 'boozy',
    terms: ['rum', 'cognac', 'whiskey', 'whisky', 'brandy', 'liqueur', 'amaretto', 'wine'],
    minMatches: 1,
  },
]

const GLOBAL_PROFILE_CONFLICTS: Record<string, string[]> = {
  fresh: ['heavy amber', 'oriental', 'smoky', 'tobacco', 'leather', 'dense gourmand', 'heavy oud', 'thick vanilla', 'boozy', 'dark'],
  citrus: ['heavy amber', 'oriental', 'smoky', 'tobacco', 'leather', 'dense gourmand', 'heavy oud', 'thick vanilla', 'boozy', 'dark'],
  clean: ['smoky', 'tobacco', 'leather', 'loud sweet', 'dense gourmand', 'heavy oud', 'boozy', 'animalic', 'dark'],
  aquatic: ['heavy amber', 'dense gourmand', 'tobacco', 'leather', 'smoky', 'heavy oud'],
  aromatic: ['dense gourmand', 'heavy amber', 'boozy', 'smoky', 'dark'],
  green: ['dense gourmand', 'heavy amber', 'heavy tobacco', 'dark oud'],
  sweet: ['sharp citrus-only', 'watery aquatic', 'dry aromatic-only', 'harsh smoke', 'animalic'],
  vanilla: ['sharp citrus-only', 'watery aquatic', 'dry aromatic-only', 'harsh smoke', 'animalic'],
  gourmand: ['sharp citrus-only', 'watery aquatic', 'dry aromatic-only', 'harsh smoke', 'animalic'],
  oud: ['light citrus-only', 'watery aquatic', 'playful fruity-only', 'clean laundry', 'delicate soft floral'],
  woody: ['light citrus-only', 'watery aquatic', 'playful fruity-only', 'clean laundry'],
  dark: ['light citrus-only', 'watery aquatic', 'clean laundry', 'delicate soft floral'],
  floral: ['heavy smoke', 'harsh leather', 'dense tobacco', 'dark oud', 'dry woods-only'],
  rose: ['heavy smoke', 'harsh leather', 'dense tobacco', 'dark oud', 'dry woods-only'],
  'white floral': ['heavy smoke', 'harsh leather', 'dense tobacco', 'dark oud', 'dry woods-only'],
  musk: ['heavy oud', 'smoky tobacco', 'strong leather', 'dense gourmand', 'boozy', 'animalic'],
  powdery: ['heavy oud', 'smoky tobacco', 'strong leather', 'dense gourmand', 'boozy', 'animalic'],
  tropical: ['heavy tobacco', 'dark oud', 'harsh leather', 'smoky incense', 'dense winter amber'],
  coconut: ['heavy tobacco', 'dark oud', 'harsh leather', 'smoky incense', 'dense winter amber'],
  leather: ['light aquatic-only', 'delicate clean floral', 'gym fresh', 'watery citrus-only'],
  tobacco: ['light aquatic-only', 'delicate clean floral', 'gym fresh', 'watery citrus-only'],
  smoky: ['light aquatic-only', 'delicate clean floral', 'gym fresh', 'watery citrus-only'],
}

const COMMON_REFERENCE_NOTES = new Set([
  'bergamot',
  'lemon',
  'orange',
  'musk',
  'amber',
  'vanilla',
  'rose',
  'cedar',
  'cedarwood',
  'sandalwood',
  'patchouli',
  'jasmine',
  'pepper',
  'cardamom',
])

const OCCASION_PROFILES: Record<string, OccasionProfile> = {
  office: {
    aliases: ['office', 'work', 'professional'],
    boost: ['clean', 'fresh', 'subtle', 'polished', 'light', 'inoffensive', 'professional', 'close-to-skin', 'soft projection', 'citrus', 'bergamot', 'lemon', 'mandarin', 'neroli', 'petitgrain', 'green', 'aquatic', 'aromatic', 'lavender', 'rosemary', 'sage', 'soft musk', 'white musk', 'cedar', 'sandalwood', 'vetiver', 'light floral', 'iris', 'tea'],
    allow: ['powdery', 'soapy', 'clean musk', 'soft amber', 'airy spice', 'musk', 'soft woods'],
    penalize: ['loud', 'sweet gourmand', 'heavy gourmand', 'smoky', 'smoke', 'oud', 'aoud', 'oudh', 'agarwood', 'leather', 'tobacco', 'animalic', 'dark', 'boozy', 'syrup', 'club', 'party', 'projection'],
    penaltyCap: 50,
  },
  everyday: {
    aliases: ['everyday', 'daily', 'casual'],
    boost: ['versatile', 'easy wearing', 'balanced', 'clean', 'fresh', 'light sweet', 'soft woody', 'soft musk', 'citrus', 'aromatic', 'green', 'musk', 'light woods', 'soft floral', 'tea', 'pear', 'apple', 'lavender', 'bergamot', 'sandalwood', 'cedar'],
    allow: ['vanilla', 'powdery', 'amber', 'fruity', 'floral'],
    penalize: ['very smoky', 'smoky', 'animalic', 'boozy', 'heavy oud', 'oud', 'loud', 'club', 'party'],
    penaltyCap: 80,
  },
  school: {
    aliases: ['school', 'class'],
    boost: ['clean', 'fresh', 'youthful', 'soft', 'inoffensive', 'light projection', 'citrus', 'aquatic', 'green', 'clean musk', 'soft floral', 'light fruity', 'lavender', 'tea', 'white musk'],
    allow: ['musk', 'powdery', 'pear', 'apple'],
    penalize: ['tobacco', 'oud', 'leather', 'smoky', 'smoke', 'very sweet', 'boozy', 'animalic', 'loud', 'dark'],
    penaltyCap: 74,
  },
  gym: {
    aliases: ['gym', 'workout'],
    boost: ['fresh', 'clean', 'airy', 'light', 'shower fresh', 'non-cloying', 'citrus', 'aquatic', 'marine', 'green', 'mint', 'cucumber', 'clean musk', 'white musk', 'lavender', 'neroli', 'light aromatic', 'soapy', 'ozonic'],
    allow: ['musk', 'bergamot', 'lemon', 'tea'],
    penalize: ['sweet gourmand', 'gourmand', 'heavy vanilla', 'amber', 'oud', 'tobacco', 'leather', 'smoky', 'smoke', 'strong spice', 'heavy woods', 'loud', 'projection'],
    penaltyCap: 68,
  },
  'date night': {
    aliases: ['date night', 'romantic'],
    boost: ['warm', 'inviting', 'sensual', 'memorable', 'smooth', 'slightly sweet', 'vanilla', 'amber', 'musk', 'tonka', 'sandalwood', 'rose', 'jasmine', 'orange blossom', 'soft woods', 'warm spice', 'cardamom', 'cinnamon', 'gourmand', 'caramel', 'chocolate', 'honey'],
    allow: ['oud', 'tobacco', 'leather', 'suede', 'woody', 'spicy'],
    penalize: ['gym', 'sharp green', 'harsh smoke', 'laundry', 'office', 'watery', 'thin aquatic'],
    penaltyCap: 78,
  },
  'night out': {
    aliases: ['night out', 'going out'],
    boost: ['bold', 'memorable', 'warm', 'sweet', 'dark', 'projecting', 'attention-getting', 'vanilla', 'amber', 'tonka', 'spice', 'fruity', 'cherry', 'tobacco', 'leather', 'oud', 'woods', 'musk', 'gourmand', 'boozy', 'rum', 'saffron'],
    allow: ['rose', 'jasmine', 'patchouli'],
    penalize: ['soft skin', 'skin scent', 'weak clean', 'subtle office', 'watery fresh', 'aquatic'],
    penaltyCap: 78,
  },
  party: {
    aliases: ['party', 'club'],
    boost: ['loud', 'sweet', 'energetic', 'projecting', 'memorable', 'amber', 'vanilla', 'tonka', 'fruity', 'cherry', 'pineapple', 'spicy', 'saffron', 'woody', 'oud', 'leather', 'tobacco', 'boozy', 'gourmand'],
    allow: ['musk', 'patchouli', 'cinnamon'],
    penalize: ['very subtle', 'soft office', 'light tea', 'weak clean musk', 'delicate floral'],
    penaltyCap: 76,
  },
  formal: {
    aliases: ['formal', 'elegant', 'wedding'],
    boost: ['refined', 'polished', 'smooth', 'balanced', 'elegant', 'iris', 'musk', 'soft woods', 'sandalwood', 'cedar', 'amber', 'rose', 'jasmine', 'white floral', 'chypre', 'vetiver', 'patchouli', 'smooth leather', 'bergamot'],
    allow: ['leather', 'citrus', 'floral', 'woody', 'clean'],
    penalize: ['candy sweet', 'loud club', 'harsh smoke', 'animalic', 'beachy', 'playful fruity'],
    penaltyCap: 82,
  },
  cozy: {
    aliases: ['cozy', 'cold weather'],
    boost: ['warm', 'comforting', 'rich', 'enveloping', 'sweet', 'spicy', 'vanilla', 'amber', 'tonka', 'cinnamon', 'cardamom', 'clove', 'honey', 'tobacco', 'resin', 'benzoin', 'labdanum', 'leather', 'oud', 'woods', 'gourmand', 'coffee', 'chocolate', 'caramel'],
    allow: ['musk', 'patchouli', 'sandalwood'],
    penalize: ['watery aquatic', 'aquatic', 'sharp citrus', 'citrus-only', 'light green', 'thin summer fresh'],
    penaltyCap: 78,
  },
  'hot weather': {
    aliases: ['hot weather', 'summer'],
    boost: ['fresh', 'bright', 'refreshing', 'light', 'airy', 'non-cloying', 'citrus', 'bergamot', 'lemon', 'lime', 'mandarin', 'grapefruit', 'neroli', 'petitgrain', 'aquatic', 'marine', 'green', 'mint', 'tea', 'light floral', 'coconut', 'tropical fruit'],
    allow: ['musk', 'white floral', 'solar'],
    penalize: ['heavy amber', 'thick vanilla', 'dense gourmand', 'tobacco', 'leather', 'oud', 'smoky', 'heavy spice'],
    penaltyCap: 76,
  },
  vacation: {
    aliases: ['beach', 'vacation', 'resort'],
    boost: ['tropical', 'sunny', 'relaxed', 'fresh', 'beachy', 'solar', 'coconut', 'coconut milk', 'tiare', 'ylang', 'frangipani', 'white floral', 'tropical fruit', 'pineapple', 'mango', 'citrus', 'aquatic', 'marine', 'salt', 'vanilla', 'musk'],
    allow: ['cream', 'creamy', 'lime', 'orange blossom'],
    penalize: ['heavy tobacco', 'leather', 'dark oud', 'smoky incense', 'dense winter gourmand'],
    penaltyCap: 78,
  },
  spring: {
    aliases: ['spring'],
    boost: ['fresh', 'floral', 'green', 'soft', 'bright', 'rose', 'peony', 'jasmine', 'lily of the valley', 'orange blossom', 'green notes', 'tea', 'citrus', 'pear', 'apple', 'soft musk', 'iris', 'violet'],
    allow: ['musk', 'bergamot', 'neroli'],
    penalize: ['heavy smoke', 'heavy oud', 'thick tobacco', 'dark amber', 'dense winter gourmand'],
    penaltyCap: 80,
  },
  fall: {
    aliases: ['fall', 'autumn'],
    boost: ['warm', 'woody', 'spicy', 'slightly sweet', 'cozy', 'earthy', 'amber', 'vanilla', 'cinnamon', 'cardamom', 'apple', 'tobacco', 'leather', 'patchouli', 'vetiver', 'cedar', 'sandalwood', 'resin', 'honey', 'tea', 'fig'],
    allow: ['musk', 'iris', 'plum'],
    penalize: ['thin aquatic', 'sharp citrus-only', 'tropical beach'],
    penaltyCap: 80,
  },
  masculine: {
    aliases: ['masculine'],
    boost: ['woody', 'aromatic', 'spicy', 'fresh', 'amber', 'leather', 'tobacco', 'vetiver', 'clean', 'cedar', 'sandalwood', 'lavender', 'rosemary', 'sage', 'bergamot', 'pepper', 'cardamom', 'oud', 'musk'],
    allow: ['citrus', 'aquatic', 'green'],
    penalize: [],
    penaltyCap: 92,
  },
  feminine: {
    aliases: ['feminine'],
    boost: ['floral', 'fruity', 'sweet', 'vanilla', 'musk', 'powdery', 'soft amber', 'rose', 'jasmine', 'orange blossom', 'iris', 'violet', 'peony', 'pear', 'peach', 'berries', 'lychee', 'gourmand'],
    allow: ['clean floral', 'fresh fruity', 'amber'],
    penalize: [],
    penaltyCap: 92,
  },
  unisex: {
    aliases: ['unisex'],
    boost: ['balanced', 'fresh', 'woody', 'musky', 'amber', 'aromatic', 'citrus', 'tea', 'green', 'bergamot', 'musk', 'sandalwood', 'cedar', 'vetiver', 'clean', 'soft woods'],
    allow: ['vanilla', 'iris', 'fig'],
    penalize: ['extremely candy sweet', 'animalic'],
    penaltyCap: 88,
  },
  luxury: {
    aliases: ['expensive', 'luxury', 'refined'],
    boost: ['smooth', 'blended', 'polished', 'balanced', 'refined', 'elegant', 'iris', 'sandalwood', 'amber', 'musk', 'soft woods', 'saffron', 'rose', 'oud', 'leather', 'tea', 'bergamot', 'chypre', 'vetiver'],
    allow: ['jasmine', 'cedar', 'patchouli'],
    penalize: ['harsh smoke', 'screechy citrus', 'synthetic candy', 'messy'],
    penaltyCap: 84,
  },
  performance: {
    aliases: ['long lasting', 'performance'],
    boost: ['amber', 'vanilla', 'oud', 'woods', 'musk', 'patchouli', 'tobacco', 'leather', 'resin', 'incense', 'tonka', 'sandalwood', 'gourmand', 'spice'],
    allow: ['benzoin', 'labdanum', 'cedar'],
    penalize: ['thin aquatic', 'light citrus-only'],
    penaltyCap: 86,
  },
  subtle: {
    aliases: ['subtle', 'skin scent'],
    boost: ['soft', 'clean', 'musky', 'powdery', 'airy', 'close-to-skin', 'musk', 'white musk', 'ambrette', 'iris', 'powder', 'clean notes', 'soft woods', 'light floral', 'tea', 'aldehydes'],
    allow: ['vanilla', 'sandalwood', 'violet'],
    penalize: ['oud', 'tobacco', 'heavy amber', 'loud sweet', 'smoke', 'leather', 'dense gourmand'],
    penaltyCap: 74,
  },
}

for (const noteToken of SCENT_INTENT_NOTE_ALLOWLIST) {
  if (!NOTE_ALLOWLIST.includes(noteToken)) {
    NOTE_ALLOWLIST.push(noteToken)
  }
}

Object.assign(NOTE_FAMILIES, SCENT_INTENT_NOTE_FAMILIES)
Object.assign(VIBE_FAMILIES, SCENT_INTENT_VIBE_FAMILIES)
Object.assign(FLAVOR_INTENT_FAMILIES, SCENT_INTENT_VIBE_FAMILIES)

for (const [vibe, aliases] of Object.entries(SCENT_INTENT_ALIASES)) {
  VIBE_ALIASES[vibe] = Array.from(
    new Set([...(VIBE_ALIASES[vibe] ?? []), ...aliases]),
  )
}

Object.assign(VIBE_ALIASES, {
  office: ['work', 'professional'],
  everyday: ['daily', 'casual'],
  school: ['class'],
  'date night': ['romantic'],
  'night out': ['going out'],
})

const SUMMER_TERMS = ['summer', 'hot', 'heat', 'warm weather']
const WINTER_TERMS = ['winter', 'cold', 'cold weather']
const SPRING_TERMS = ['spring']
const FALL_TERMS = ['fall', 'autumn']
const DAY_TERMS = ['day', 'daytime', 'office', 'work']
const NIGHT_TERMS = [
  'date night',
  'night out',
  'going out',
  'night',
  'nighttime',
  'evening',
]
const EXPLICIT_SEASON_WEIGHT = 25
const EXPLICIT_DAY_NIGHT_WEIGHT = 12
const LOW_SEASON_SHARE_THRESHOLD = 0.2
const LOW_SEASON_SHARE_PENALTY = 9
const TIME_CONTEXT_PROFILE_TERMS = [
  'amber',
  'vanilla',
  'tobacco',
  'oud',
  'leather',
  'incense',
  'musk',
  'honey',
  'tonka',
  'saffron',
  'cinnamon',
  'spicy',
  'woody',
  'oriental',
  'gourmand',
]

function getNoteFamilyTerms(family: NoteFamily) {
  return [
    ...family.strong,
    ...(family.medium ?? []),
    ...(family.soft ?? []),
    ...(family.softRequires ?? []),
    ...(family.fallback ?? []),
    ...(family.classification ?? []),
  ]
}

export function getRecommendationIntentGuardTerms() {
  return Array.from(
    new Set(
      [
        ...NOTE_ALLOWLIST,
        ...Object.keys(NOTE_FAMILIES),
        ...Object.values(NOTE_FAMILIES).flatMap(getNoteFamilyTerms),
        ...Object.keys(VIBE_FAMILIES),
        ...Object.values(VIBE_FAMILIES).flat(),
        ...Object.keys(FLAVOR_INTENT_FAMILIES),
        ...Object.values(FLAVOR_INTENT_FAMILIES).flat(),
        ...Object.keys(VIBE_ALIASES),
        ...Object.values(VIBE_ALIASES).flat(),
        ...Object.keys(OCCASION_PROFILES),
        ...Object.values(OCCASION_PROFILES).flatMap((profile) => profile.aliases),
        ...NOTE_ACCORD_RULES.flatMap((rule) => [rule.accord, ...rule.terms]),
        ...Object.keys(PROFILE_COMPATIBILITY_FAMILIES),
        ...Object.values(PROFILE_COMPATIBILITY_FAMILIES).flat(),
        ...SUMMER_TERMS,
        ...WINTER_TERMS,
        ...SPRING_TERMS,
        ...FALL_TERMS,
        ...DAY_TERMS,
        ...NIGHT_TERMS,
        ...TIME_CONTEXT_PROFILE_TERMS,
      ].filter((term) => term.trim().length >= 2),
    ),
  )
}

type RatingScoreBreakdown = {
  legacyRatingScore: number
  seasonTimeScore: number
  ratingQualityScore: number
  sentimentScore: number
  popularityScore: number
  crowdScore: number
  crowdPower: number
  loveShare: number
  trustedLoveShareScore: number
  voteConfidence: number
  ratingTierScore: number
  bayesianRatingValue: number | null
  reactionConfidence: number
  requestedSeasonShare: number | null
  seasonConfidence: number
  seasonFitCap: number | null
  timeScore: number
  requestedTimeShare: number | null
  dayNightConfidence: number
  timeFitCap: number | null
}

type RatingStats = {
  globalAverageRating: number
  bayesianPriorVotes: number
}

type RecommendationPromptType =
  | 'reference'
  | 'single_note'
  | 'note_plus_vibe'
  | 'strict_multi_note_combo'
  | 'broad_vibe'
  | 'occasion'
  | 'season'
  | 'time_of_day'
  | 'general'

type IntentBuckets = {
  requiredNotes: string[]
  preferredNotes: string[]
  desiredVibes: string[]
  constraints: string[]
  negativeTerms: string[]
  hardNegativeTerms: string[]
  constraintBoostTerms: string[]
}

type IntentModeScoringPolicy = {
  maxScore: number
  missingRequiredNoteCap: number | null
  partialRequiredNoteCap: number | null
}

type RecommendationIntent = {
  normalizedMessage: string
  tokens: string[]
  requestedNoteTokens: string[]
  requestedVibes: string[]
  requestedOccasions: string[]
  intentBuckets: IntentBuckets
  ratingIntents: ReturnType<typeof getRatingIntents>
  promptType: RecommendationPromptType
  hasSeasonIntent: boolean
  hasTimeIntent: boolean
  hasBroadContext: boolean
  requestedAudience: Audience | null
}

type IntentCompatibilityContext = {
  requestedFamilies: string[]
  requestedFamilySet: Set<string>
  conflictTerms: string[]
  hasFreshCleanFamily: boolean
  hasFreshCitrusCleanTropicalFamily: boolean
}

type ScentRelevanceLayer = {
  noteRelevanceScore: number
  noteFamilyScore: number
  layerAwareScore: number
  flavorOrVibeScore: number
  classificationScore: number
  seasonScore: number
  timeOfDayScore: number
  occasionScore: number
  combinedIntentScore: number
  profileScore: number
  scentRelevanceScore: number
  compatibilityLevel: ProfileCompatibilityLevel
  compatibilityScore: number
  conflictScore: number
  scoreCap: number | null
  referenceBucketCoverageScore?: number
  referencePreservedBucketCount?: number
  referenceStrongBucketCount?: number
  referenceModifierSupportScore?: number
  referenceDNAFit?: number
  referenceLayerFit?: number
  referenceFamilyFit?: number
  referenceConflictAvoidance?: number
  referenceDifferenceControl?: number
  referenceDebug?: ReferenceRecommendationDebug
}

type ProfileCompatibilityLevel =
  | 'strong'
  | 'moderate'
  | 'weak'
  | 'conflicting'
  | 'unrelated'

type PopularityQualityLayer = {
  ratingScoreBreakdown: RatingScoreBreakdown
  lovedByScore: number
  ratingReliabilityScore: number
  qualityScore: number
  popularityScore: number
  popularityQualityScore: number
  crowdRelevanceMultiplier: number
  relevanceGatedPopularityBoost: number
}

type WearabilityLayer = {
  scentFitScore: number
  wearabilityScore: number
  occasionFitScore: number
  broadAppealScore: number
  conflictPenalty: number
  scoreAdjustment: number
  scoreCap: number | null
}

type RecommendationSearchResult = {
  reply: string
  recommendations: FragranceRecommendation[]
  referenceFragrance?: ReferenceFragrance
  searchMode?: 'normal' | 'reference' | 'refinement' | 'comparison'
}

type RecommendationResultOptions = {
  includeReferenceDebug?: boolean
}

type ReferenceIntent = {
  referenceName: string
  modifiers: ReferenceModifier[]
}

type ReferenceMatch = {
  record: RecommendableFragrance
  confidence: number
  possibleMatches: RecommendableFragrance[]
}

type ReferenceProfile = {
  exactNotes: string[]
  exactNoteSet: Set<string>
  noteFamilyTerms: string[]
  classificationTerms: string[]
  vibeTerms: string[]
  dominantFamilies: string[]
  conflictTerms: string[]
  buckets: ReferenceBucket[]
}

type ReferenceBucket = {
  key: 'opening' | 'heart' | 'base' | 'profile' | 'seasonTime'
  terms: string[]
  exactTerms: string[]
  familyTerms: string[]
  weight: number
}

type ReferenceBucketSimilarity = {
  matchedBucketCount: number
  strongBucketCount: number
  bucketScore: number
  bucketCoverageScore: number
  modifierSupportScore: number
  preservedReferenceBucketCount: number
  scoreCap: number | null
}

type LayeredReferenceSimilarity = {
  layeredScore: number
  meaningfulLayerCount: number
  strongLayerCount: number
  exactSharedNoteCount: number
  exactSharedHeartBaseCount: number
  sameLayerHeartBaseExactCount: number
  sameLayerHeartBaseFamilyCount: number
  allNotesDnaScore: number
  scoreCap: number | null
}

type ReferenceScoringComponents = {
  referenceDNAFit: number
  referenceLayerFit: number
  referenceFamilyFit: number
  modifierFit: number
  conflictAvoidance: number
  differenceControl: number
  accordPairScore: number
  distinctiveNoteScore: number
  scoreCap: number | null
  capReason: string | null
}

type LayerWeights = {
  top: number
  middle: number
  base: number
  profile: number
}

type ReferenceNoteLayer = 'opening' | 'heart' | 'base'
type ReferenceModifier = {
  key: string
  label: string
  aliases: string[]
  boost: string[]
  penalize: string[]
}

const REFERENCE_NOTE_LAYERS: ReferenceNoteLayer[] = ['opening', 'heart', 'base']

async function fetchRecommendableFragrances() {
  const startedAt = Date.now()

  const rows = await db
    .select({
      id: fragrances.id,
      mistifyProductName: fragrances.mistifyProductName,
      mistifyProductUrl: fragrances.mistifyProductUrl,
      audience: fragrances.audience,
      originalFragranceName: fragrances.originalFragranceName,
      sourceBrandBatch: fragrances.sourceBrandBatch,
      classification: fragrances.classification,
      topNotes: fragrances.topNotes,
      middleNotes: fragrances.middleNotes,
      baseNotes: fragrances.baseNotes,
      allNotes: fragrances.allNotes,
      sourceConfidence: fragrances.sourceConfidence,
      sourceUsed: fragrances.sourceUsed,
      sourceStatus: fragrances.sourceStatus,
      verifiedOnMistify: fragrances.verifiedOnMistify,
      searchableText: fragrances.searchableText,
    })
    .from(fragrances)
    .where(
      and(
        isNotNull(fragrances.originalFragranceName),
        ne(fragrances.originalFragranceName, ''),
      ),
    )

  console.log(
    `[recommendation] db fragrances loaded count=${rows.length} elapsedMs=${Date.now() - startedAt}`,
  )

  return rows
}

async function fetchFragranceRatings() {
  const startedAt = Date.now()

  const rows = await db
    .select({
      normalizedBrand: fragranceRatings.normalizedBrand,
      normalizedName: fragranceRatings.normalizedName,
      ratingValue: fragranceRatings.ratingValue,
      ratingVoteCount: fragranceRatings.ratingVoteCount,
      reviewCount: fragranceRatings.reviewCount,
      loveCount: fragranceRatings.loveCount,
      likeCount: fragranceRatings.likeCount,
      okCount: fragranceRatings.okCount,
      dislikeCount: fragranceRatings.dislikeCount,
      hateCount: fragranceRatings.hateCount,
      winterShare: fragranceRatings.winterShare,
      springShare: fragranceRatings.springShare,
      summerShare: fragranceRatings.summerShare,
      fallShare: fragranceRatings.fallShare,
      dayShare: fragranceRatings.dayShare,
      nightShare: fragranceRatings.nightShare,
      seasonTotalCount: fragranceRatings.seasonTotalCount,
      dayNightTotalCount: fragranceRatings.dayNightTotalCount,
    })
    .from(fragranceRatings)

  console.log(
    `[recommendation] db ratings loaded count=${rows.length} elapsedMs=${Date.now() - startedAt}`,
  )

  return rows
}

function normalizeText(value: string) {
  return value.toLowerCase()
}

function normalizeReferenceText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(perfume|fragrance|cologne|parfum|eau de parfum|edp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCompactText(value: string) {
  return normalizeReferenceText(value).replace(/\s+/g, '')
}

function getCachedNormalizedPhrase(value: string) {
  const cachedValue = normalizedPhraseCache.get(value)

  if (cachedValue !== undefined) {
    return cachedValue
  }

  const normalizedValue = normalizeReferenceText(value)

  normalizedPhraseCache.set(value, normalizedValue)

  return normalizedValue
}

function normalizedIncludesPhrase(value: string, phrase: string) {
  const normalizedValue = getCachedNormalizedPhrase(value)
  const normalizedPhrase = getCachedNormalizedPhrase(phrase)

  if (!normalizedValue || !normalizedPhrase) {
    return false
  }

  return ` ${normalizedValue} `.includes(` ${normalizedPhrase} `)
}

function padNormalizedPhrase(value: string) {
  return value ? ` ${value} ` : ''
}

function paddedIncludesNormalizedPhrase(
  paddedNormalizedValue: string,
  normalizedPhrase: string,
) {
  return Boolean(
    paddedNormalizedValue &&
      normalizedPhrase &&
      paddedNormalizedValue.includes(` ${normalizedPhrase} `),
  )
}

function getEditDistance(firstValue: string, secondValue: string) {
  const first = normalizeCompactText(firstValue)
  const second = normalizeCompactText(secondValue)

  if (first === second) {
    return 0
  }

  if (!first.length) {
    return second.length
  }

  if (!second.length) {
    return first.length
  }

  const previousRow = Array.from({ length: second.length + 1 }, (_, index) => index)
  const currentRow = new Array<number>(second.length + 1)

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    currentRow[0] = firstIndex

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost =
        first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1

      currentRow[secondIndex] = Math.min(
        previousRow[secondIndex] + 1,
        currentRow[secondIndex - 1] + 1,
        previousRow[secondIndex - 1] + substitutionCost,
      )
    }

    for (let index = 0; index <= second.length; index += 1) {
      previousRow[index] = currentRow[index]
    }
  }

  return previousRow[second.length]
}

function getStringSimilarity(firstValue: string, secondValue: string) {
  const first = normalizeCompactText(firstValue)
  const second = normalizeCompactText(secondValue)
  const longestLength = Math.max(first.length, second.length)

  if (longestLength === 0) {
    return 1
  }

  return 1 - getEditDistance(first, second) / longestLength
}

function getTokenSimilarity(referenceTokens: string[], nameTokens: string[]) {
  if (!referenceTokens.length || !nameTokens.length) {
    return 0
  }

  const matchedScores = referenceTokens.map((referenceToken) =>
    nameTokens.reduce(
      (bestScore, nameToken) =>
        Math.max(bestScore, getStringSimilarity(referenceToken, nameToken)),
      0,
    ),
  )

  return (
    matchedScores.reduce((total, score) => total + score, 0) /
    referenceTokens.length
  )
}

function isLowConfidenceReferenceQuery(value: string) {
  const normalizedValue = normalizeReferenceText(value)
  const tokens = normalizedValue.split(/\s+/).filter(Boolean)

  return (
    normalizedValue.length < 5 ||
    (tokens.length === 1 && LOW_CONFIDENCE_REFERENCE_TERMS.has(tokens[0]))
  )
}

function tokenizeMessage(message: string) {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (word) =>
        word.length >= MIN_TOKEN_LENGTH && !FILLER_WORDS.has(word),
    )
}

function includesToken(value: string | null, token: string) {
  return value?.toLowerCase().includes(token) ?? false
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function includesPhrase(value: string | null, phrase: string) {
  if (!value) {
    return false
  }

  const normalizedPhrase = phrase.trim().toLowerCase().replace(/\s+/g, ' ')

  if (!normalizedPhrase) {
    return false
  }

  let phraseRegex = phraseRegexCache.get(normalizedPhrase)

  if (!phraseRegex) {
    const phrasePattern = normalizedPhrase
      .split(/\s+/)
      .map(escapeRegExp)
      .join('\\s+')

    phraseRegex = new RegExp(`\\b${phrasePattern}\\b`, 'i')
    phraseRegexCache.set(normalizedPhrase, phraseRegex)
  }

  return phraseRegex.test(value)
}

function hasAnyIntent(message: string, terms: string[]) {
  return terms.some((term) =>
    term.includes(' ')
      ? includesPhrase(message, term)
      : includesPhrase(message, term),
  )
}

const AUDIENCE_INTENT_TERMS: Record<Audience, string[]> = {
  mens: [
    'mens',
    "men's",
    'men s',
    'men',
    'male',
    'masculine',
    'for men',
    'for him',
    'guy',
    'guys',
    'man',
    'manly',
    'masculine leaning',
  ],
  womens: [
    'womens',
    "women's",
    'women s',
    'women',
    'woman',
    'female',
    'feminine',
    'for women',
    'for her',
    'girl',
    'ladies',
    'feminine leaning',
  ],
  unisex: [
    'unisex',
    'gender neutral',
    'gender-neutral',
    'for anyone',
    'anyone can wear',
    'shared fragrance',
  ],
}

function includesNormalizedAudienceTerm(
  normalizedMessage: string,
  term: string,
) {
  return includesPhrase(normalizedMessage, normalizeReferenceText(term))
}

function isNegatedAudienceTerm(normalizedMessage: string, term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  const termPattern = normalizedTerm.split(/\s+/).map(escapeRegExp).join('\\s+')
  const negatedBeforeTermRegex = new RegExp(
    `\\b(?:not|no|avoid|without|less|not\\s+too|less\\s+than)\\s+(?:\\w+\\s+){0,3}${termPattern}\\b`,
    'i',
  )

  return negatedBeforeTermRegex.test(normalizedMessage)
}

function hasPositiveAudienceIntent(
  normalizedMessage: string,
  audience: Audience,
) {
  return AUDIENCE_INTENT_TERMS[audience].some(
    (term) =>
      includesNormalizedAudienceTerm(normalizedMessage, term) &&
      !isNegatedAudienceTerm(normalizedMessage, term),
  )
}

function parseAudienceIntent(message: string): Audience | null {
  const normalizedMessage = normalizeReferenceText(message)
  const hasUnisexIntent = hasPositiveAudienceIntent(normalizedMessage, 'unisex')
  const hasMensIntent = hasPositiveAudienceIntent(normalizedMessage, 'mens')
  const hasWomensIntent = hasPositiveAudienceIntent(normalizedMessage, 'womens')

  if (hasUnisexIntent) {
    return 'unisex'
  }

  if (hasMensIntent && !hasWomensIntent) {
    return 'mens'
  }

  if (hasWomensIntent && !hasMensIntent) {
    return 'womens'
  }

  return null
}

function replaceNormalizedPhrase(message: string, from: string, to: string) {
  const normalizedFrom = normalizeReferenceText(from)
  const fromPattern = normalizedFrom.split(/\s+/).map(escapeRegExp).join('\\s+')
  const phraseRegex = new RegExp(`\\b${fromPattern}\\b`, 'gi')

  return message.replace(phraseRegex, to)
}

type KnownCorrectionTerms = {
  all: string[]
  allSet: Set<string>
  singleWord: string[]
}

let knownCorrectionTermsCache: KnownCorrectionTerms | null = null

function getKnownCorrectionTerms() {
  if (!knownCorrectionTermsCache) {
    const all = Array.from(
      new Set([
        ...NOTE_ALLOWLIST,
        ...Object.keys(NOTE_FAMILIES),
        ...Object.keys(VIBE_FAMILIES),
        ...Object.values(VIBE_ALIASES).flat(),
        ...Object.keys(OCCASION_PROFILES),
        ...Object.values(OCCASION_PROFILES).flatMap((profile) => profile.aliases),
      ]),
    )
      .map(normalizeReferenceText)
      .filter((term) => term.length >= 4 && !LOW_CONFIDENCE_REFERENCE_TERMS.has(term))

    knownCorrectionTermsCache = {
      all,
      allSet: new Set(all),
      singleWord: all.filter((term) => !term.includes(' ')),
    }
  }

  return knownCorrectionTermsCache
}

function getBestKnownTermCorrection(token: string, knownTerms: string[]) {
  let bestTerm: string | null = null
  let bestSimilarity = 0

  for (const term of knownTerms) {
    const similarity = getStringSimilarity(token, term)

    if (similarity > bestSimilarity) {
      bestTerm = term
      bestSimilarity = similarity
    }
  }

  return bestTerm && bestSimilarity >= 0.82 ? bestTerm : token
}

function correctKnownTermTypos(message: string) {
  let correctedMessage = normalizeReferenceText(message)

  for (const [typo, correction] of Object.entries(QUERY_CORRECTION_ALIASES)) {
    correctedMessage = replaceNormalizedPhrase(correctedMessage, typo, correction)
  }

  const knownTerms = getKnownCorrectionTerms()
  const correctedTokens = correctedMessage.split(/\s+/).map((token) => {
    if (
      token.length < 5 ||
      FILLER_WORDS.has(token) ||
      knownTerms.allSet.has(token)
    ) {
      return token
    }

    return getBestKnownTermCorrection(token, knownTerms.singleWord)
  })

  return correctedTokens.join(' ').replace(/\s+/g, ' ').trim()
}

function parseNullableNumber(value: string | number | null) {
  if (value === null) {
    return null
  }

  const parsedValue = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isPlaceholderProductName(value: string | null | undefined) {
  return PLACEHOLDER_PRODUCT_NAMES.has(value?.trim().toLowerCase() ?? '')
}

function getDisplayProductName(record: RecommendableFragrance) {
  const mistifyProductName = record.mistifyProductName?.trim()

  if (mistifyProductName && !isPlaceholderProductName(mistifyProductName)) {
    return mistifyProductName
  }

  return record.originalFragranceName?.trim() ?? ''
}

function confidenceFromCount(count: number | null, denominator: number) {
  return Math.min(1, Math.log10((count ?? 0) + 1) / denominator)
}

function getRatingTierScore(ratingValue: number | null | undefined) {
  if (ratingValue === null || ratingValue === undefined) {
    return 0
  }

  if (ratingValue >= 4.5) {
    return 1
  }

  if (ratingValue >= 4.3) {
    return 0.85
  }

  if (ratingValue >= 4.2) {
    return 0.7
  }

  if (ratingValue >= 4) {
    return 0.45
  }

  if (ratingValue >= 3.75) {
    return 0.2
  }

  return 0
}

function getBayesianRatingValue(params: {
  ratingValue: number | null
  ratingVoteCount: number
  ratingStats: RatingStats
}) {
  const { ratingValue, ratingVoteCount, ratingStats } = params

  if (ratingValue === null) {
    return null
  }

  const voteWeight =
    ratingVoteCount / (ratingVoteCount + ratingStats.bayesianPriorVotes)
  const baselineWeight = 1 - voteWeight

  return ratingValue * voteWeight + ratingStats.globalAverageRating * baselineWeight
}

function getRatingLookupKey(record: RecommendableFragrance) {
  return buildRatingLookupKey(
    record.sourceBrandBatch,
    record.originalFragranceName,
  )
}

function buildRatingMap(ratings: RatingRecord[]) {
  return new Map(
    ratings.map((rating) => [
      `${rating.normalizedBrand}::${rating.normalizedName}`,
      rating,
    ]),
  )
}

function buildRatingStats(ratings: RatingRecord[]): RatingStats {
  const ratingValues = ratings
    .map((rating) => parseNullableNumber(rating.ratingValue))
    .filter((ratingValue): ratingValue is number => ratingValue !== null)
  const globalAverageRating = ratingValues.length
    ? ratingValues.reduce((total, ratingValue) => total + ratingValue, 0) /
      ratingValues.length
    : 4

  return {
    globalAverageRating,
    bayesianPriorVotes: 80,
  }
}

function normalizeNotes(notes: string[] | null) {
  return Array.isArray(notes) ? notes : []
}

function getCachedRecordNotes(record: RecommendableFragrance) {
  const cachedNotes = recordNotesCache.get(record)

  if (cachedNotes) {
    return cachedNotes
  }

  const topNotes = normalizeNotes(record.topNotes)
  const middleNotes = normalizeNotes(record.middleNotes)
  const baseNotes = normalizeNotes(record.baseNotes)
  const allNotes = normalizeNotes(record.allNotes)
  const combinedNotes = [...topNotes, ...middleNotes, ...baseNotes, ...allNotes]
  const notes = {
    topNotes,
    middleNotes,
    baseNotes,
    allNotes,
    combinedNotes,
  }

  recordNotesCache.set(record, notes)

  return notes
}

function getCachedNormalizedRecordText(record: RecommendableFragrance) {
  const cachedText = recordNormalizedTextCache.get(record)

  if (cachedText) {
    return cachedText
  }

  const notes = getCachedRecordNotes(record).combinedNotes.map(normalizeReferenceText)
  const classification = normalizeReferenceText(record.classification ?? '')
  const searchableText = normalizeReferenceText(record.searchableText ?? '')
  const normalizedText = {
    notes,
    paddedNotes: notes.map(padNormalizedPhrase),
    classification,
    paddedClassification: padNormalizedPhrase(classification),
    searchableText,
    paddedSearchableText: padNormalizedPhrase(searchableText),
  }

  recordNormalizedTextCache.set(record, normalizedText)

  return normalizedText
}

function getRatingIntents(message: string) {
  const normalizedMessage = normalizeText(message)

  return {
    summer: hasAnyIntent(normalizedMessage, SUMMER_TERMS),
    winter: hasAnyIntent(normalizedMessage, WINTER_TERMS),
    spring: hasAnyIntent(normalizedMessage, SPRING_TERMS),
    fall: hasAnyIntent(normalizedMessage, FALL_TERMS),
    day: hasAnyIntent(normalizedMessage, DAY_TERMS),
    night: hasAnyIntent(normalizedMessage, NIGHT_TERMS),
  }
}

function cleanReferenceName(value: string) {
  return value
    .replace(/\s+but\s+.+$/i, '')
    .replace(/\s+for\s+(summer|winter|spring|fall|autumn|office|work|date night|night|day)\b.*$/i, '')
    .replace(/\b(what should i try|recommendations?|please|from the database)\b.*$/i, '')
    .replace(/^[\s"'`]+|[\s"'`.?!,]+$/g, '')
    .trim()
}

function detectReferenceModifiers(message: string) {
  const normalizedMessage = normalizeReferenceText(message)

  return REFERENCE_MODIFIERS.filter((modifier) =>
    modifier.aliases.some((alias) =>
      includesPhrase(normalizedMessage, normalizeReferenceText(alias)),
    ),
  )
}

function detectReferenceIntent(message: string): ReferenceIntent | null {
  const normalizedMessage = normalizeText(message)
  const patterns = [
    /\b(?:i like|i love)\s+(.+?)(?:[.?!,]|\s+but\s+|\s+for\s+|$)/i,
    /\b(?:something like|similar to|smells like|reminds me of|alternative to|dupe of|inspired by)\s+(.+?)(?:[.?!,]|\s+but\s+|\s+for\s+|$)/i,
    /\b(?:same opening as|opens like|same heart as|same drydown as|dries down like|same base as)\s+(.+?)(?:[.?!,]|\s+but\s+|\s+for\s+|$)/i,
    /\b(?:recommend something similar to|what smells similar to)\s+(.+?)(?:[.?!,]|\s+but\s+|\s+for\s+|$)/i,
  ]
  const explicitMatch = patterns
    .map((pattern) => normalizedMessage.match(pattern)?.[1])
    .find((match): match is string => Boolean(match?.trim()))
  const referenceName = cleanReferenceName(explicitMatch ?? '')

  if (!referenceName) {
    return null
  }

  const normalizedReferenceName = normalizeReferenceText(referenceName)
  const referenceWordCount = normalizedReferenceName.split(/\s+/).filter(Boolean).length
  const hasExplicitReferencePhrase = Boolean(explicitMatch)

  if (
    !hasExplicitReferencePhrase &&
    (referenceWordCount > 5 ||
      referenceWordCount === 0 ||
      ['sweet', 'fresh', 'clean', 'vanilla', 'citrus', 'office'].includes(
        normalizedReferenceName,
      ))
  ) {
    return null
  }

  return {
    referenceName,
    modifiers: detectReferenceModifiers(message),
  }
}

function hasExplicitSeasonIntent(intents: ReturnType<typeof getRatingIntents>) {
  return intents.summer || intents.winter || intents.spring || intents.fall
}

function hasExplicitTimeIntent(intents: ReturnType<typeof getRatingIntents>) {
  return intents.day || intents.night
}

function getPromptType(params: {
  requestedNoteTokens: string[]
  requestedVibes: string[]
  requestedOccasions: string[]
  hasSeasonIntent: boolean
  hasTimeIntent: boolean
}): RecommendationPromptType {
  const {
    requestedNoteTokens,
    requestedVibes,
    requestedOccasions,
    hasSeasonIntent,
    hasTimeIntent,
  } = params

  if (hasSeasonIntent) {
    return 'season'
  }

  if (requestedOccasions.length > 0) {
    return 'occasion'
  }

  if (hasTimeIntent) {
    return 'time_of_day'
  }

  if (requestedNoteTokens.length >= 2) {
    return 'strict_multi_note_combo'
  }

  if (requestedNoteTokens.length === 1 && requestedVibes.length > 0) {
    return 'note_plus_vibe'
  }

  if (requestedNoteTokens.length === 1) {
    return 'single_note'
  }

  if (requestedVibes.length > 0) {
    return 'broad_vibe'
  }

  return 'general'
}

function uniqueNormalizedTerms(terms: string[]) {
  return Array.from(new Set(terms.map(normalizeReferenceText).filter(Boolean)))
}

const NEGATIVE_INTENT_TERM_ALIASES: Record<string, string[]> = {
  cloying: [
    'cloying',
    'syrup',
    'syrupy',
    'sugary',
    'candy sweet',
    'loud sweet',
    'dense gourmand',
    'heavy vanilla',
  ],
  sunscreen: [
    'sunscreen',
    'solar',
    'beachy',
    'tiare',
    'coconut',
    'coconut milk',
    'white floral',
  ],
  animalic: [
    'animalic',
    'civet',
    'castoreum',
    'oud',
    'agarwood',
    'leather',
    'heavy musk',
  ],
  loud: [
    'loud',
    'projection',
    'projecting',
    'strong projection',
    'heavy amber',
    'dense gourmand',
    'tobacco',
    'oud',
    'smoky',
  ],
  powdery: ['powdery', 'powder', 'iris', 'violet', 'heliotrope'],
  smoky: ['smoky', 'smoke', 'incense', 'birch', 'cade', 'tobacco', 'leather'],
  aquatic: ['aquatic', 'marine', 'water notes', 'watery', 'ozonic', 'calone'],
  sweet: ['sweet', 'sugary', 'caramel', 'honey', 'gourmand', 'syrup'],
}

const HARD_NEGATIVE_INTENT_TERM_ALIASES: Record<string, string[]> = {
  oud: [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'dark oud',
    'smoky oud',
    'rose oud',
    'oud rose',
    'oud leather',
    'woody oud',
  ],
  agarwood: [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'dark oud',
    'smoky oud',
    'rose oud',
    'oud rose',
    'oud leather',
    'woody oud',
  ],
  aoud: ['oud', 'agarwood', 'aoud', 'oudh'],
  oudh: ['oud', 'agarwood', 'aoud', 'oudh'],
  leather: ['leather', 'suede', 'harsh leather'],
  tobacco: ['tobacco', 'heavy tobacco', 'dark tobacco'],
  rose: ['rose'],
  smoky: ['smoky', 'smoke', 'incense'],
  smoke: ['smoky', 'smoke', 'incense'],
}

function hasNegativeIntentForTerm(normalizedMessage: string, term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  return [
    `no ${normalizedTerm}`,
    `avoid ${normalizedTerm}`,
    `without ${normalizedTerm}`,
    `but not ${normalizedTerm}`,
    `less ${normalizedTerm}`,
    `not as ${normalizedTerm}`,
    `not too ${normalizedTerm}`,
    `not ${normalizedTerm}`,
  ].some((phrase) => includesPhrase(normalizedMessage, phrase))
}

function hasHardNegativeIntentForTerm(normalizedMessage: string, term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  return [
    `no ${normalizedTerm}`,
    `without ${normalizedTerm}`,
    `avoid ${normalizedTerm}`,
    `i hate ${normalizedTerm}`,
    ...(normalizedTerm === 'oud' ? [`not ${normalizedTerm}`] : []),
  ].some((phrase) => includesPhrase(normalizedMessage, phrase))
}

function getDirectNegativeIntentTerms(message: string) {
  const normalizedMessage = normalizeText(message)
  const candidateTerms = uniqueNormalizedTerms([
    ...NOTE_ALLOWLIST,
    ...Object.keys(VIBE_FAMILIES),
    ...Object.keys(PROFILE_COMPATIBILITY_FAMILIES),
    ...Object.keys(NEGATIVE_INTENT_TERM_ALIASES),
  ])

  return uniqueNormalizedTerms(
    candidateTerms.flatMap((term) =>
      hasNegativeIntentForTerm(normalizedMessage, term)
        ? [term, ...(NEGATIVE_INTENT_TERM_ALIASES[term] ?? [])]
        : [],
    ),
  )
}

function getHardNegativeIntentTerms(message: string) {
  const normalizedMessage = normalizeText(message)
  const candidateTerms = uniqueNormalizedTerms([
    ...NOTE_ALLOWLIST,
    ...Object.keys(VIBE_FAMILIES),
    ...Object.keys(PROFILE_COMPATIBILITY_FAMILIES),
    ...Object.keys(HARD_NEGATIVE_INTENT_TERM_ALIASES),
  ])

  return uniqueNormalizedTerms(
    candidateTerms.flatMap((term) =>
      hasHardNegativeIntentForTerm(normalizedMessage, term)
        ? [term, ...(HARD_NEGATIVE_INTENT_TERM_ALIASES[term] ?? [])]
        : [],
    ),
  )
}

function getPreferredNoteTokens(message: string, requestedNoteTokens: string[]) {
  const normalizedMessage = normalizeText(message)
  const candidateNotes = uniqueNormalizedTerms([
    ...requestedNoteTokens,
    ...NOTE_ALLOWLIST,
  ])

  return candidateNotes.filter((noteToken) =>
    [
      `hint of ${noteToken}`,
      `touch of ${noteToken}`,
      `some ${noteToken}`,
      `maybe ${noteToken}`,
      `maybe some ${noteToken}`,
      `maybe a little ${noteToken}`,
      `preferably ${noteToken}`,
      `ideally ${noteToken}`,
      `nice to have ${noteToken}`,
      `a little ${noteToken}`,
      `slight ${noteToken}`,
      `light ${noteToken}`,
    ].some((phrase) => includesPhrase(normalizedMessage, phrase)),
  )
}

function buildIntentBuckets(params: {
  message: string
  requestedNoteTokens: string[]
  requestedVibes: string[]
  requestedOccasions: string[]
  directNegativeTerms: string[]
  hardNegativeTerms: string[]
}): IntentBuckets {
  const {
    message,
    requestedNoteTokens,
    requestedVibes,
    requestedOccasions,
    directNegativeTerms,
    hardNegativeTerms,
  } = params
  const preferredNotes = getPreferredNoteTokens(message, requestedNoteTokens)
  const preferredNoteSet = new Set(preferredNotes)
  const modifiers = detectReferenceModifiers(message)
  const modifierConstraintLabels = modifiers.map((modifier) => modifier.key)
  const negativeTerms = uniqueNormalizedTerms([
    ...directNegativeTerms,
    ...hardNegativeTerms,
    ...modifiers.flatMap((modifier) => modifier.penalize),
  ])
  const constraintBoostTerms = uniqueNormalizedTerms(
    modifiers.flatMap((modifier) => modifier.boost),
  )

  return {
    requiredNotes: requestedNoteTokens.filter(
      (noteToken) => !preferredNoteSet.has(noteToken),
    ),
    preferredNotes,
    desiredVibes: requestedVibes.filter(
      (vibe) => !negativeTerms.includes(normalizeReferenceText(vibe)),
    ),
    constraints: Array.from(
      new Set([...requestedOccasions, ...modifierConstraintLabels]),
    ),
    negativeTerms,
    hardNegativeTerms,
    constraintBoostTerms,
  }
}

function parseRecommendationIntent(message: string): RecommendationIntent {
  const normalizedMessage = normalizeText(message)
  const tokens = tokenizeMessage(message)
  const directNegativeTerms = getDirectNegativeIntentTerms(message)
  const hardNegativeTerms = getHardNegativeIntentTerms(message)
  const parsedRequestedNoteTokens = getRequestedNoteTokens(
    message,
    tokens,
    directNegativeTerms,
  )
  const preferredNoteTokens = getPreferredNoteTokens(
    message,
    parsedRequestedNoteTokens,
  )
  const preferredNoteSet = new Set(preferredNoteTokens)
  const requestedNoteTokens = parsedRequestedNoteTokens.filter(
    (noteToken) => !preferredNoteSet.has(noteToken),
  )
  let requestedVibes = getRequestedVibes(message, directNegativeTerms)
  const requestedOccasions = getRequestedOccasions(message)
  const hasOnlyNegativeIntent =
    requestedNoteTokens.length === 0 &&
    requestedVibes.length === 0 &&
    requestedOccasions.length === 0 &&
    hardNegativeTerms.length > 0

  if (hasOnlyNegativeIntent) {
    requestedVibes = ['beginner safe']
  }

  const intentBuckets = buildIntentBuckets({
    message,
    requestedNoteTokens,
    requestedVibes,
    requestedOccasions,
    directNegativeTerms,
    hardNegativeTerms,
  })
  const ratingIntents = getRatingIntents(message)
  const requestedAudience = parseAudienceIntent(message)
  const hasSeasonIntent = hasExplicitSeasonIntent(ratingIntents)
  const hasTimeIntent =
    hasExplicitTimeIntent(ratingIntents) && !hasSeasonIntent
  const promptType = getPromptType({
    requestedNoteTokens,
    requestedVibes,
    requestedOccasions,
    hasSeasonIntent,
    hasTimeIntent,
  })

  return {
    normalizedMessage,
    tokens,
    requestedNoteTokens,
    requestedVibes,
    requestedOccasions,
    intentBuckets,
    ratingIntents,
    promptType,
    hasSeasonIntent,
    hasTimeIntent,
    requestedAudience,
    hasBroadContext:
      requestedVibes.length > 0 ||
      requestedOccasions.length > 0 ||
      hasSeasonIntent ||
      hasTimeIntent,
  }
}

function getRequestedNoteTokens(
  message: string,
  tokens: string[],
  negativeTerms: string[] = [],
) {
  const normalizedMessage = normalizeText(message)
  const negativeTermSet = new Set(negativeTerms.map(normalizeReferenceText))
  const requestedNotes = NOTE_ALLOWLIST.filter((note) =>
    !negativeTermSet.has(normalizeReferenceText(note)) &&
    (note.includes(' ')
      ? includesPhrase(normalizedMessage, note)
      : tokens.includes(note)),
  )
  const multiWordNotes = requestedNotes.filter((note) => note.includes(' '))

  return requestedNotes.filter(
    (note) =>
      note.includes(' ') ||
      !multiWordNotes.some((multiWordNote) =>
        multiWordNote.split(/\s+/).includes(note),
      ),
  )
}

function getRequestedVibes(message: string, negativeTerms: string[] = []) {
  const normalizedMessage = normalizeText(message)
  const negativeTermSet = new Set(negativeTerms.map(normalizeReferenceText))

  return Object.keys(VIBE_FAMILIES).filter((vibe) => {
    if (negativeTermSet.has(normalizeReferenceText(vibe))) {
      return false
    }

    const aliases = VIBE_ALIASES[vibe] ?? []

    return [vibe, ...aliases].some((term) =>
      includesPhrase(normalizedMessage, term),
    )
  })
}

function getRequestedOccasions(message: string) {
  const normalizedMessage = normalizeText(message)

  return Object.entries(OCCASION_PROFILES)
    .filter(([, profile]) =>
      profile.aliases.some((term) => includesPhrase(normalizedMessage, term)),
    )
    .map(([occasion]) => occasion)
}

function getReferenceSearchNames(record: RecommendableFragrance) {
  const cachedNames = recordReferenceNamesCache.get(record)

  if (cachedNames) {
    return cachedNames
  }

  const names = [
    record.originalFragranceName,
    record.mistifyProductName,
    record.sourceBrandBatch && record.originalFragranceName
      ? `${record.sourceBrandBatch} ${record.originalFragranceName}`
      : null,
  ]
    .filter((name): name is string => Boolean(name?.trim()))
    .map((name) => normalizeReferenceText(name))
    .filter(Boolean)

  recordReferenceNamesCache.set(record, names)

  return names
}

function getReferenceNameCandidates(referenceName: string) {
  const normalizedReferenceName = normalizeReferenceText(referenceName)

  return Array.from(
    new Set([
      normalizedReferenceName,
      ...(REFERENCE_NAME_ALIASES[normalizedReferenceName] ?? []),
    ]),
  ).filter(Boolean)
}

function stripReferenceLeadIn(value: string) {
  return normalizeReferenceText(value).replace(
    /^(?:i want|i need|i am looking for|i'm looking for|looking for|find me|give me|recommend|recommend me)\s+/,
    '',
  )
}

function scoreReferenceNameMatch(
  referenceName: string,
  record: RecommendableFragrance,
) {
  const originalName = normalizeReferenceText(record.originalFragranceName ?? '')
  const mistifyName = normalizeReferenceText(record.mistifyProductName ?? '')
  const searchableNames = getReferenceSearchNames(record)

  return getReferenceNameCandidates(referenceName).reduce((bestCandidateScore, normalizedReferenceName) => {
    const referenceTokens = normalizedReferenceName.split(/\s+/).filter(Boolean)

    if (
      !normalizedReferenceName ||
      referenceTokens.length === 0 ||
      isLowConfidenceReferenceQuery(normalizedReferenceName)
    ) {
      return bestCandidateScore
    }

    if (originalName === normalizedReferenceName) {
      return Math.max(bestCandidateScore, 120)
    }

    if (mistifyName && mistifyName === normalizedReferenceName) {
      return Math.max(bestCandidateScore, 112)
    }

    const sortedReferenceTokens = referenceTokens.slice().sort().join(' ')
    const bestNameScore = searchableNames.reduce((bestScore, name) => {
      const nameTokens = name.split(/\s+/).filter(Boolean)
      const matchedTokenCount = referenceTokens.filter((token) =>
        nameTokens.includes(token),
      ).length
      const tokenCoverage = matchedTokenCount / referenceTokens.length
      const tokenSimilarity = getTokenSimilarity(referenceTokens, nameTokens)
      const compactSimilarity = Math.max(
        getStringSimilarity(normalizedReferenceName, name),
        getStringSimilarity(
          sortedReferenceTokens,
          nameTokens.slice().sort().join(' '),
        ),
      )
      const containsReferencePhrase =
        normalizedReferenceName.length >= 5 &&
        includesPhrase(name, normalizedReferenceName)
      const referenceContainsName =
        name.length >= 5 && includesPhrase(normalizedReferenceName, name)
      const partialScore =
        tokenCoverage >= 1
          ? 88
          : tokenCoverage >= 0.75 && referenceTokens.length >= 2
            ? 78
            : tokenCoverage >= 0.6 && referenceTokens.length >= 3
              ? 68
              : 0
      const phraseScore = containsReferencePhrase
        ? 96
        : referenceContainsName
          ? 92
          : 0
      const fuzzyScore =
        normalizedReferenceName.length >= 5 &&
        name.length >= 5 &&
        compactSimilarity >= 0.93
          ? 106
          : normalizedReferenceName.length >= 8 &&
              (compactSimilarity >= 0.88 || tokenSimilarity >= 0.9)
            ? 98
            : normalizedReferenceName.length >= 10 &&
                (compactSimilarity >= 0.82 || tokenSimilarity >= 0.86)
              ? 84
              : 0

      return Math.max(bestScore, partialScore, phraseScore, fuzzyScore)
    }, 0)

    if (bestNameScore > 0) {
      return Math.max(bestCandidateScore, bestNameScore)
    }

    if (record.searchableText && normalizedReferenceName.length >= 8) {
      const normalizedSearchableText = normalizeReferenceText(record.searchableText)

      return includesPhrase(normalizedSearchableText, normalizedReferenceName)
        ? Math.max(bestCandidateScore, 66)
        : bestCandidateScore
    }

    return bestCandidateScore
  }, 0)
}

function findReferenceFragrance(
  referenceIntent: ReferenceIntent,
  records: RecommendableFragrance[],
): ReferenceMatch | null {
  const topMatches: { record: RecommendableFragrance; confidence: number }[] = []

  for (const record of records) {
    const confidence = scoreReferenceNameMatch(referenceIntent.referenceName, record)

    if (confidence < 66) {
      continue
    }

    const match = { record, confidence }
    let insertIndex = topMatches.length

    while (insertIndex > 0 && topMatches[insertIndex - 1].confidence < confidence) {
      insertIndex -= 1
    }

    topMatches.splice(insertIndex, 0, match)

    if (topMatches.length > 4) {
      topMatches.pop()
    }
  }

  const bestMatch = topMatches[0]

  if (!bestMatch) {
    return null
  }

  const possibleMatches = topMatches.map((match) => match.record)
  const secondBestMatch = topMatches[1]

  if (bestMatch.confidence < 75) {
    return {
      record: bestMatch.record,
      confidence: bestMatch.confidence,
      possibleMatches,
    }
  }

  if (
    secondBestMatch &&
    bestMatch.confidence < 105 &&
    bestMatch.confidence - secondBestMatch.confidence <= 8
  ) {
    return {
      record: bestMatch.record,
      confidence: bestMatch.confidence - 20,
      possibleMatches,
    }
  }

  return {
    record: bestMatch.record,
    confidence: bestMatch.confidence,
    possibleMatches,
  }
}

function getRecordAllNotes(record: RecommendableFragrance) {
  const cachedNotes = recordAllNotesCache.get(record)

  if (cachedNotes) {
    return cachedNotes
  }

  const notes = Array.from(
    new Set(
      getCachedRecordNotes(record).combinedNotes
        .map((note) => note.trim())
        .filter(Boolean),
    ),
  )

  recordAllNotesCache.set(record, notes)

  return notes
}

function getNoteFamilySearchEntries() {
  if (noteFamilySearchEntriesCache) {
    return noteFamilySearchEntriesCache
  }

  noteFamilySearchEntriesCache = Object.entries(NOTE_FAMILIES).map(
    ([noteToken, family]) => ({
      noteToken,
      family,
      searchableTerms: [
        noteToken,
        ...family.strong,
        ...(family.medium ?? []),
        ...(family.soft ?? []),
      ].map(normalizeReferenceText),
    }),
  )

  return noteFamilySearchEntriesCache
}

function getFamilyTermsForNote(note: string) {
  const noteTerm = normalizeReferenceText(note)

  if (!noteTerm) {
    return []
  }

  const cachedTerms = familyTermsForNoteCache.get(noteTerm)

  if (cachedTerms) {
    return cachedTerms
  }

  const familyTerms = getNoteFamilySearchEntries()
    .filter(({ searchableTerms }) =>
      searchableTerms.some(
        (term) =>
          normalizedIncludesPhrase(noteTerm, term) ||
          normalizedIncludesPhrase(term, noteTerm),
      ),
    )
    .flatMap(({ noteToken, family }) => [
      noteToken,
      ...family.strong,
      ...(family.medium ?? []),
      ...(family.soft ?? []),
      ...(family.classification ?? []),
    ])

  const uniqueTerms = Array.from(new Set(familyTerms))

  familyTermsForNoteCache.set(noteTerm, uniqueTerms)

  return uniqueTerms
}

function getBucketTermsFromNotes(notes: string[]) {
  const noteTerms = notes.map((note) => note.trim().toLowerCase()).filter(Boolean)
  const notesKey = noteTerms.slice().sort().join('|')

  if (!notesKey) {
    return []
  }

  const cachedTerms = bucketTermsFromNotesCache.get(notesKey)

  if (cachedTerms) {
    return cachedTerms
  }

  const terms = Array.from(
    new Set([
      ...noteTerms,
      ...noteTerms.flatMap((note) => getFamilyTermsForNote(note)),
    ]),
  )

  bucketTermsFromNotesCache.set(notesKey, terms)

  return terms
}

function getExactBucketTermsFromNotes(notes: string[]) {
  return Array.from(
    new Set(notes.map((note) => normalizeReferenceText(note)).filter(Boolean)),
  )
}

function buildNoteReferenceBucket(params: {
  key: ReferenceBucket['key']
  exactTerms: string[]
  weight: number
}) {
  const { key, exactTerms, weight } = params
  const familyTerms = Array.from(
    new Set(exactTerms.flatMap((note) => getFamilyTermsForNote(note))),
  ).filter((term) => !exactTerms.includes(normalizeReferenceText(term)))

  return {
    key,
    exactTerms,
    familyTerms,
    terms: Array.from(new Set([...exactTerms, ...familyTerms])),
    weight,
  }
}

function getFamilySetFromNotes(notes: string[]) {
  return new Set(getProfileFamiliesFromTerms(getBucketTermsFromNotes(notes)))
}

function countMatchingNoteTerms(paddedNormalizedNotes: string[], terms: string[]) {
  return terms.filter((term) =>
    paddedNotesContainToken(paddedNormalizedNotes, normalizeReferenceText(term)),
  ).length
}

function getComputedAccordSetFromNotes(notes: string[]) {
  const normalizedNotes = notes.map(normalizeReferenceText).filter(Boolean)

  if (!normalizedNotes.length) {
    return new Set<string>()
  }

  const paddedNormalizedNotes = normalizedNotes.map(padNormalizedPhrase)

  return new Set(
    NOTE_ACCORD_RULES.filter(
      (rule) =>
        countMatchingNoteTerms(paddedNormalizedNotes, rule.terms) >=
        rule.minMatches,
    ).map((rule) => rule.accord),
  )
}

function normalizeClassificationTerms(classification: string | null) {
  const normalizedClassification = (classification ?? '').trim().toLowerCase()

  if (
    !normalizedClassification ||
    [
      'not verified',
      'not verified from source',
      'not verified on mistify',
      'not fully verified from mistify page',
      'not listed clearly',
    ].some((placeholder) => normalizedClassification.includes(placeholder))
  ) {
    return []
  }

  const cachedTerms = classificationTermsCache.get(normalizedClassification)

  if (cachedTerms) {
    return cachedTerms
  }

  const terms = Array.from(
    new Set(
      normalizedClassification
        .replace(/&/g, ' and ')
        .split(/[\/,|;:-]+|\s+(?:and|with)\s+/)
        .flatMap((part) => {
          const trimmedPart = part.trim()

          return trimmedPart
            ? [
                trimmedPart,
                ...trimmedPart.split(/\s+/).filter((word) => word.length >= 3),
              ]
            : []
        }),
    ),
  )

  classificationTermsCache.set(normalizedClassification, terms)

  return terms
}

function getClassificationFamilies(classification: string | null) {
  const normalizedClassification = (classification ?? '').trim().toLowerCase()

  if (!normalizedClassification) {
    return new Set<string>()
  }

  const cachedFamilies = classificationFamiliesCache.get(normalizedClassification)

  if (cachedFamilies) {
    return cachedFamilies
  }

  const classificationTerms = normalizeClassificationTerms(classification)
  const directFamilies = getProfileFamiliesFromTerms(classificationTerms)
  const fullClassification = normalizedClassification
  const phraseFamilies = Object.entries(PROFILE_COMPATIBILITY_FAMILIES)
    .filter(([family, terms]) =>
      normalizedIncludesPhrase(fullClassification, family) ||
      terms.some((term) => normalizedIncludesPhrase(fullClassification, term)),
    )
    .map(([family]) => family)

  const families = new Set([...directFamilies, ...phraseFamilies])

  classificationFamiliesCache.set(normalizedClassification, families)

  return families
}

function getFragranceProfile(record: RecommendableFragrance) {
  const cachedProfile = recordProfileCache.get(record)

  if (cachedProfile) {
    return cachedProfile
  }

  const notes = getCachedRecordNotes(record)
  const normalizedTopNotesSet = new Set(notes.topNotes.map(normalizeReferenceText))
  const normalizedMiddleNotesSet = new Set(notes.middleNotes.map(normalizeReferenceText))
  const normalizedBaseNotesSet = new Set(notes.baseNotes.map(normalizeReferenceText))
  const normalizedAllNotesSet = new Set(
    (notes.allNotes.length ? notes.allNotes : notes.combinedNotes).map(
      normalizeReferenceText,
    ),
  )
  const topFamiliesSet = getFamilySetFromNotes(notes.topNotes)
  const middleFamiliesSet = getFamilySetFromNotes(notes.middleNotes)
  const baseFamiliesSet = getFamilySetFromNotes(notes.baseNotes)
  const allNoteFamiliesSet = getFamilySetFromNotes(
    notes.allNotes.length ? notes.allNotes : notes.combinedNotes,
  )
  const computedAccordsSet = getComputedAccordSetFromNotes(
    notes.allNotes.length ? notes.allNotes : notes.combinedNotes,
  )
  const classificationFamiliesSet = getClassificationFamilies(record.classification)
  const classificationTerms = normalizeClassificationTerms(record.classification)
  const overallProfileFamiliesSet = new Set([
    ...allNoteFamiliesSet,
    ...topFamiliesSet,
    ...middleFamiliesSet,
    ...baseFamiliesSet,
    ...computedAccordsSet,
    ...classificationFamiliesSet,
  ])
  const referenceNoteTerms = Array.from(
    new Set([
      ...normalizedAllNotesSet,
      ...allNoteFamiliesSet,
    ]),
  )
  const referenceProfileTerms = Array.from(
    new Set([
      ...referenceNoteTerms,
      ...classificationTerms,
      ...classificationFamiliesSet,
      ...overallProfileFamiliesSet,
    ]),
  )
  const profile = {
    normalizedTopNotesSet,
    normalizedMiddleNotesSet,
    normalizedBaseNotesSet,
    normalizedAllNotesSet,
    computedAccordsSet,
    topFamiliesSet,
    middleFamiliesSet,
    baseFamiliesSet,
    allNoteFamiliesSet,
    classificationFamiliesSet,
    overallProfileFamiliesSet,
    classificationTerms,
    referenceNoteTerms,
    referenceProfileTerms,
    paddedReferenceNoteTerms: referenceNoteTerms.map(padNormalizedPhrase),
    paddedReferenceProfileTerms: referenceProfileTerms.map(padNormalizedPhrase),
    referenceAllTermsSet: new Set([
      ...normalizedAllNotesSet,
      ...allNoteFamiliesSet,
      ...classificationTerms,
      ...classificationFamiliesSet,
      ...overallProfileFamiliesSet,
    ]),
  }

  recordProfileCache.set(record, profile)

  return profile
}

function buildReferenceBuckets(
  record: RecommendableFragrance,
  rating: RatingRecord | undefined,
) {
  const cachedNotes = getCachedRecordNotes(record)
  const profile = getFragranceProfile(record)
  const allDnaExactTerms = getExactBucketTermsFromNotes(
    cachedNotes.allNotes.length ? cachedNotes.allNotes : cachedNotes.combinedNotes,
  )
  const hasLayeredNotes =
    cachedNotes.topNotes.length ||
    cachedNotes.middleNotes.length ||
    cachedNotes.baseNotes.length
  const openingExactTerms = hasLayeredNotes
    ? getExactBucketTermsFromNotes(cachedNotes.topNotes)
    : allDnaExactTerms
  const heartExactTerms = hasLayeredNotes
    ? getExactBucketTermsFromNotes(cachedNotes.middleNotes)
    : allDnaExactTerms
  const baseExactTerms = hasLayeredNotes
    ? getExactBucketTermsFromNotes(cachedNotes.baseNotes)
    : allDnaExactTerms
  const profileTerms = Array.from(
    new Set([
      ...profile.classificationTerms,
      ...profile.classificationFamiliesSet,
      ...profile.overallProfileFamiliesSet,
    ]),
  )
  const seasonTerms = [
    (parseNullableNumber(rating?.summerShare ?? null) ?? 0) >= 0.25
      ? 'summer profile'
      : null,
    (parseNullableNumber(rating?.winterShare ?? null) ?? 0) >= 0.28
      ? 'winter profile'
      : null,
    (parseNullableNumber(rating?.springShare ?? null) ?? 0) >= 0.25
      ? 'spring profile'
      : null,
    (parseNullableNumber(rating?.fallShare ?? null) ?? 0) >= 0.25
      ? 'fall profile'
      : null,
    (parseNullableNumber(rating?.dayShare ?? null) ?? 0) >= 0.55
      ? 'day profile'
      : null,
    (parseNullableNumber(rating?.nightShare ?? null) ?? 0) >= 0.55
      ? 'night profile'
      : null,
  ].filter((term): term is string => Boolean(term))
  const buckets: ReferenceBucket[] = [
    buildNoteReferenceBucket({
      key: 'opening',
      exactTerms: openingExactTerms,
      weight: 1.08,
    }),
    buildNoteReferenceBucket({
      key: 'heart',
      exactTerms: heartExactTerms,
      weight: 1.04,
    }),
    buildNoteReferenceBucket({
      key: 'base',
      exactTerms: baseExactTerms,
      weight: 1.12,
    }),
    {
      key: 'profile',
      terms: profileTerms,
      exactTerms: profile.classificationTerms,
      familyTerms: Array.from(
        new Set([
          ...profile.classificationFamiliesSet,
          ...profile.overallProfileFamiliesSet,
        ]),
      ),
      weight: 1,
    },
    {
      key: 'seasonTime',
      terms: seasonTerms,
      exactTerms: seasonTerms,
      familyTerms: [],
      weight: 0.72,
    },
  ]

  return buckets.filter((bucket) => bucket.terms.length > 0)
}

function buildReferenceProfileWithRating(
  record: RecommendableFragrance,
  rating?: RatingRecord,
): ReferenceProfile {
  const profile = getFragranceProfile(record)
  const exactNotes = getRecordAllNotes(record).map(normalizeReferenceText)
  const matchedFamilies = Object.entries(NOTE_FAMILIES).filter(([noteToken]) =>
    profile.overallProfileFamiliesSet.has(noteToken),
  )
  const noteFamilyTerms = matchedFamilies.flatMap(([noteToken, family]) => [
      noteToken,
      ...family.strong,
      ...(family.medium ?? []),
      ...(family.soft ?? []),
      ...(family.classification ?? []),
    ])
  const classificationTerms = profile.classificationTerms
  const vibeTerms = Object.keys(VIBE_FAMILIES).filter((vibe) => {
    const vibeFamilies = getProfileFamiliesFromTerms([vibe, ...getExpandedVibeTerms(vibe)])

    return vibeFamilies.some((family) => profile.overallProfileFamiliesSet.has(family))
  })
  const dominantFamilies = Array.from(
    new Set(
      [...matchedFamilies.map(([noteToken]) => noteToken), ...vibeTerms].filter(
        (term) => REFERENCE_FAMILY_CONFLICTS[term],
      ),
    ),
  )
  const conflictTerms = Array.from(
    new Set(
      dominantFamilies.flatMap(
        (family) => REFERENCE_FAMILY_CONFLICTS[family] ?? [],
      ),
    ),
  )

  return {
    exactNotes: Array.from(new Set(exactNotes)),
    exactNoteSet: new Set(exactNotes),
    noteFamilyTerms: Array.from(new Set(noteFamilyTerms)),
    classificationTerms: Array.from(new Set(classificationTerms)),
    vibeTerms: Array.from(new Set(vibeTerms)),
    dominantFamilies,
    conflictTerms,
    buckets: buildReferenceBuckets(record, rating),
  }
}

function precomputedTermsMatchTerm(
  term: string,
  terms: string[],
  paddedTerms: string[],
) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  if (terms.includes(normalizedTerm)) {
    return true
  }

  const paddedNormalizedTerm = padNormalizedPhrase(normalizedTerm)

  return terms.some((candidateTerm, index) => {
    const paddedCandidateTerm = paddedTerms[index]

    return (
      paddedIncludesNormalizedPhrase(paddedCandidateTerm, normalizedTerm) ||
      paddedIncludesNormalizedPhrase(paddedNormalizedTerm, candidateTerm)
    )
  })
}

function paddedNotesContainToken(paddedNotes: string[], normalizedToken: string) {
  return paddedNotes.some((note) =>
    paddedIncludesNormalizedPhrase(note, normalizedToken),
  )
}

function getCachedTermMatch(
  cache: WeakMap<RecommendableFragrance, Map<string, boolean>>,
  record: RecommendableFragrance,
  term: string,
  matcher: () => boolean,
) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  let termCache = cache.get(record)

  if (!termCache) {
    termCache = new Map<string, boolean>()
    cache.set(record, termCache)
  }

  const cachedMatch = termCache.get(normalizedTerm)

  if (cachedMatch !== undefined) {
    return cachedMatch
  }

  const match = matcher()

  termCache.set(normalizedTerm, match)

  return match
}

function recordNotesMatchTerm(record: RecommendableFragrance, term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  return getCachedTermMatch(
    recordNotesTermMatchCache,
    record,
    normalizedTerm,
    () =>
      paddedNotesContainToken(
        getCachedNormalizedRecordText(record).paddedNotes,
        normalizedTerm,
      ),
  )
}

function recordClassificationMatchesTerm(
  record: RecommendableFragrance,
  term: string,
) {
  const normalizedTerm = normalizeReferenceText(term)

  return getCachedTermMatch(
    recordClassificationTermMatchCache,
    record,
    normalizedTerm,
    () =>
      paddedIncludesNormalizedPhrase(
        getCachedNormalizedRecordText(record).paddedClassification,
        normalizedTerm,
      ),
  )
}

function recordSearchableTextMatchesTerm(
  record: RecommendableFragrance,
  term: string,
) {
  const normalizedTerm = normalizeReferenceText(term)

  return getCachedTermMatch(
    recordSearchableTextTermMatchCache,
    record,
    normalizedTerm,
    () =>
      paddedIncludesNormalizedPhrase(
        getCachedNormalizedRecordText(record).paddedSearchableText,
        normalizedTerm,
      ),
  )
}

function recordNotesOrSearchableTextMatchesTerm(
  record: RecommendableFragrance,
  term: string,
) {
  return (
    recordNotesMatchTerm(record, term) ||
    recordSearchableTextMatchesTerm(record, term)
  )
}

function recordMatchesTerm(record: RecommendableFragrance, term: string) {
  return getCachedTermMatch(
    recordTermMatchCache,
    record,
    term,
    () =>
      recordNotesMatchTerm(record, term) ||
      recordClassificationMatchesTerm(record, term) ||
      recordSearchableTextMatchesTerm(record, term),
  )
}

function recordNotesOrSearchableTextMatchesAnyTerm(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms.some((term) =>
    recordNotesOrSearchableTextMatchesTerm(record, term),
  )
}

function recordNotesMatchAnyTerm(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms.some((term) => recordNotesMatchTerm(record, term))
}

function getRecordOntologyNotes(record: RecommendableFragrance) {
  return [
    ...normalizeNotes(record.topNotes),
    ...normalizeNotes(record.middleNotes),
    ...normalizeNotes(record.baseNotes),
    ...normalizeNotes(record.allNotes),
    record.classification ?? '',
  ].filter(Boolean)
}

function getRecordOntologyFamilies(record: RecommendableFragrance) {
  return getOntologyFamiliesForNotes(getRecordOntologyNotes(record))
}

function getRecordOntologySubfamilies(record: RecommendableFragrance) {
  return getOntologySubfamiliesForNotes(getRecordOntologyNotes(record))
}

function recordHasOntologyFamilySupport(
  record: RecommendableFragrance,
  term: string,
) {
  const requestedFamilies = getScentFamiliesForNote(term)

  if (!requestedFamilies.length) {
    return false
  }

  return (
    calculateOntologyFamilyOverlap(
      requestedFamilies,
      getRecordOntologyFamilies(record),
    ) > 0
  )
}

function recordHasOntologySubfamilySupport(
  record: RecommendableFragrance,
  term: string,
) {
  const requestedSubfamilies = getScentSubfamiliesForNote(term)

  if (!requestedSubfamilies.length) {
    return false
  }

  const candidateSubfamilies = new Set(getRecordOntologySubfamilies(record))

  return requestedSubfamilies.some((subfamily) =>
    candidateSubfamilies.has(subfamily),
  )
}

function notesHaveOntologyOrDirectSupport(notes: string[], term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return false
  }

  if (
    notes.some((note) =>
      normalizedIncludesPhrase(note, normalizedTerm),
    )
  ) {
    return true
  }

  const requestedSubfamilies = getScentSubfamiliesForNote(term)

  if (requestedSubfamilies.length) {
    const noteSubfamilies = new Set(getOntologySubfamiliesForNotes(notes))

    if (requestedSubfamilies.some((subfamily) => noteSubfamilies.has(subfamily))) {
      return true
    }
  }

  const requestedFamilies = getScentFamiliesForNote(term)

  if (requestedFamilies.length) {
    return (
      calculateOntologyFamilyOverlap(
        requestedFamilies,
        getOntologyFamiliesForNotes(notes),
      ) > 0
    )
  }

  return false
}

function getLayerScoringTerms(intent: RecommendationIntent) {
  return uniqueNormalizedTerms([
    ...intent.requestedNoteTokens,
    ...intent.requestedVibes,
    ...intent.intentBuckets.requiredNotes,
    ...intent.intentBuckets.preferredNotes,
    ...intent.intentBuckets.desiredVibes,
    ...intent.intentBuckets.constraintBoostTerms,
  ])
}

function getLayerWeightsForIntent(intent: RecommendationIntent): LayerWeights {
  const normalizedMessage = intent.normalizedMessage
  const terms = getLayerScoringTerms(intent)
  const families = getOntologyFamiliesForNotes(terms)
  const subfamilies = getOntologySubfamiliesForNotes(terms)
  const termSet = new Set([...terms, ...families, ...subfamilies])

  if (
    includesPhrase(normalizedMessage, 'opening') ||
    includesPhrase(normalizedMessage, 'top note')
  ) {
    return { top: 0.5, middle: 0.25, base: 0.1, profile: 0.15 }
  }

  if (
    includesPhrase(normalizedMessage, 'drydown') ||
    includesPhrase(normalizedMessage, 'dry down') ||
    includesPhrase(normalizedMessage, 'in the base') ||
    includesPhrase(normalizedMessage, 'base note') ||
    includesPhrase(normalizedMessage, 'musky base')
  ) {
    return { top: 0.08, middle: 0.22, base: 0.55, profile: 0.15 }
  }

  if (
    includesPhrase(normalizedMessage, 'heart') ||
    includesPhrase(normalizedMessage, 'middle note')
  ) {
    return { top: 0.1, middle: 0.55, base: 0.2, profile: 0.15 }
  }

  if (
    ['fresh', 'citrus', 'aquatic', 'green', 'aromatic'].some((term) =>
      termSet.has(term),
    )
  ) {
    return { top: 0.4, middle: 0.3, base: 0.15, profile: 0.15 }
  }

  if (
    ['vanilla', 'amber', 'musk', 'woody', 'oud', 'tobacco', 'leather', 'resinous', 'warm'].some((term) =>
      termSet.has(term),
    )
  ) {
    return { top: 0.1, middle: 0.3, base: 0.45, profile: 0.15 }
  }

  if (
    ['floral', 'powdery', 'clean', 'musky', 'musk', 'powdery floral'].some((term) =>
      termSet.has(term),
    )
  ) {
    return { top: 0.15, middle: 0.4, base: 0.3, profile: 0.15 }
  }

  if (
    ['gourmand', 'creamy', 'tropical', 'coconut'].some((term) =>
      termSet.has(term),
    )
  ) {
    return { top: 0.2, middle: 0.35, base: 0.35, profile: 0.1 }
  }

  return { top: 0.25, middle: 0.3, base: 0.3, profile: 0.15 }
}

function getLayerAwareIntentScore(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
  classificationScore: number
}) {
  const { record, intent, classificationScore } = params
  const terms = getLayerScoringTerms(intent)

  if (!terms.length) {
    return 0
  }

  const topNotes = normalizeNotes(record.topNotes)
  const middleNotes = normalizeNotes(record.middleNotes)
  const baseNotes = normalizeNotes(record.baseNotes)
  const topMatches = terms.filter((term) =>
    notesHaveOntologyOrDirectSupport(topNotes, term),
  ).length
  const middleMatches = terms.filter((term) =>
    notesHaveOntologyOrDirectSupport(middleNotes, term),
  ).length
  const baseMatches = terms.filter((term) =>
    notesHaveOntologyOrDirectSupport(baseNotes, term),
  ).length
  const divisor = Math.max(1, terms.length)
  const weights = getLayerWeightsForIntent(intent)

  return clamp(
    (topMatches / divisor) * 100 * weights.top +
      (middleMatches / divisor) * 100 * weights.middle +
      (baseMatches / divisor) * 100 * weights.base +
      classificationScore * weights.profile,
    0,
    100,
  )
}

function getLayerAwareScoreCap(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
  score: number
  layerAwareScore: number
  matchedRequestedNoteCount: number
}) {
  const { record, intent, score, layerAwareScore, matchedRequestedNoteCount } =
    params

  if (score < 90 || matchedRequestedNoteCount > 0) {
    return null
  }

  const weights = getLayerWeightsForIntent(intent)
  const baseFocused = weights.base >= 0.45
  const topFocused = weights.top >= 0.4
  const middleFocused = weights.middle >= 0.4

  if (baseFocused && layerAwareScore < 45) {
    return 88
  }

  if (topFocused && layerAwareScore < 45) {
    return 88
  }

  if (middleFocused && layerAwareScore < 45) {
    return 88
  }

  const hasHeavyConflict =
    recordHasOntologySubfamilySupport(record, 'oud') ||
    recordHasOntologySubfamilySupport(record, 'tobacco') ||
    recordHasOntologySubfamilySupport(record, 'gourmand')
  const asksFreshLight =
    intent.requestedVibes.some((vibe) =>
      ['fresh', 'citrus', 'clean', 'aquatic', 'green'].includes(
        normalizeReferenceText(vibe),
      ),
    ) || includesPhrase(intent.normalizedMessage, 'not heavy')

  if (asksFreshLight && hasHeavyConflict && layerAwareScore < 65) {
    return 86
  }

  return null
}

function recordClassificationMatchesAnyTerm(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms.some((term) => recordClassificationMatchesTerm(record, term))
}

function getRequestedNoteMatchStrength(
  record: RecommendableFragrance,
  noteToken: string,
  options: {
    allowLooseSoftSupport?: boolean
    allowFamilyFallback?: boolean
  } = {},
) {
  const family = NOTE_FAMILIES[noteToken]

  if (recordNotesOrSearchableTextMatchesTerm(record, noteToken)) {
    return 'exact'
  }

  if (!family) {
    return 'none'
  }

  if (
    recordNotesOrSearchableTextMatchesAnyTerm(record, family.strong) ||
    recordClassificationMatchesAnyTerm(record, family.classification ?? [])
  ) {
    return 'strong'
  }

  if (
    family.medium &&
    recordNotesOrSearchableTextMatchesAnyTerm(record, family.medium)
  ) {
    return 'medium'
  }

  if (recordHasOntologySubfamilySupport(record, noteToken)) {
    return 'medium'
  }

  if (
    options.allowFamilyFallback &&
    family.fallback &&
    recordMatchesAnyFallbackTerm(record, family.fallback)
  ) {
    return 'soft'
  }

  if (options.allowFamilyFallback && recordHasOntologyFamilySupport(record, noteToken)) {
    return 'soft'
  }

  if (
    family.soft &&
    recordNotesOrSearchableTextMatchesAnyTerm(record, family.soft) &&
    (options.allowLooseSoftSupport ||
      !family.softRequires ||
      recordNotesOrSearchableTextMatchesAnyTerm(record, family.softRequires))
  ) {
    return 'soft'
  }

  return 'none'
}

function getRequestedNoteFieldEvidenceStrength(
  record: RecommendableFragrance,
  noteToken: string,
) {
  const family = NOTE_FAMILIES[noteToken]

  if (recordNotesMatchTerm(record, noteToken)) {
    return 'exact'
  }

  if (!family) {
    return 'none'
  }

  if (recordNotesMatchAnyTerm(record, family.strong)) {
    return 'strong'
  }

  if (family.medium && recordNotesMatchAnyTerm(record, family.medium)) {
    return 'medium'
  }

  if (recordHasOntologySubfamilySupport(record, noteToken)) {
    return 'medium'
  }

  if (
    family.soft &&
    recordNotesMatchAnyTerm(record, family.soft) &&
    (!family.softRequires || recordNotesMatchAnyTerm(record, family.softRequires))
  ) {
    return 'soft'
  }

  if (family.fallback && recordNotesMatchAnyTerm(record, family.fallback)) {
    return 'soft'
  }

  if (recordHasOntologyFamilySupport(record, noteToken)) {
    return 'soft'
  }

  return 'none'
}

function isCloseRequestedNoteEvidence(strength: RequestedNoteMatchStrength) {
  return strength === 'exact' || strength === 'strong' || strength === 'medium'
}

function isAnyRequestedNoteEvidence(strength: RequestedNoteMatchStrength) {
  return isCloseRequestedNoteEvidence(strength) || strength === 'soft'
}

function getRequestedNoteFieldEvidenceSummary(
  record: RecommendableFragrance,
  requestedNoteTokens: string[],
) {
  const strengths = requestedNoteTokens.map((noteToken) =>
    getRequestedNoteFieldEvidenceStrength(record, noteToken),
  )

  return {
    closeEvidenceCount: strengths.filter(isCloseRequestedNoteEvidence).length,
    anyEvidenceCount: strengths.filter(isAnyRequestedNoteEvidence).length,
  }
}

function getRequestedNoteEvidenceScoreCap(params: {
  record: RecommendableFragrance
  requestedNoteTokens: string[]
}) {
  const { record, requestedNoteTokens } = params
  const requestedNoteCount = requestedNoteTokens.length

  if (requestedNoteCount === 0) {
    return null
  }

  const { closeEvidenceCount, anyEvidenceCount } =
    getRequestedNoteFieldEvidenceSummary(record, requestedNoteTokens)

  if (requestedNoteCount === 1) {
    return closeEvidenceCount === 1 ? null : 64
  }

  if (closeEvidenceCount === requestedNoteCount) {
    return null
  }

  if (closeEvidenceCount === 0) {
    return 45
  }

  if (anyEvidenceCount < requestedNoteCount) {
    return 55
  }

  return 64
}

function recordMatchesAnyFallbackTerm(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms.some((term) => recordMatchesTerm(record, term))
}

function getProfileFamilyLookup() {
  if (profileFamilyLookupCache.size > 0) {
    return profileFamilyLookupCache
  }

  for (const [family, familyTerms] of Object.entries(PROFILE_COMPATIBILITY_FAMILIES)) {
    for (const term of [family, ...familyTerms]) {
      const normalizedTerm = normalizeReferenceText(term)

      if (!normalizedTerm) {
        continue
      }

      const existingFamilies = profileFamilyLookupCache.get(normalizedTerm)

      if (existingFamilies) {
        existingFamilies.add(family)
      } else {
        profileFamilyLookupCache.set(normalizedTerm, new Set([family]))
      }
    }
  }

  return profileFamilyLookupCache
}

function getProfileFamiliesForTerm(term: string) {
  const normalizedTerm = normalizeReferenceText(term)

  if (!normalizedTerm) {
    return []
  }

  const cachedFamilies = profileFamiliesForTermCache.get(normalizedTerm)

  if (cachedFamilies) {
    return cachedFamilies
  }

  const lookup = getProfileFamilyLookup()
  const families = new Set<string>()
  const exactFamilies = lookup.get(normalizedTerm)

  if (exactFamilies) {
    for (const family of exactFamilies) {
      families.add(family)
    }
  }

  for (const token of normalizedTerm.split(/\s+/)) {
    const tokenFamilies = lookup.get(token)

    if (tokenFamilies) {
      for (const family of tokenFamilies) {
        families.add(family)
      }
    }
  }

  for (const [lookupTerm, lookupFamilies] of lookup.entries()) {
    if (
      lookupTerm.includes(' ') &&
      lookupTerm !== normalizedTerm &&
      normalizedIncludesPhrase(normalizedTerm, lookupTerm)
    ) {
      for (const family of lookupFamilies) {
        families.add(family)
      }
    }
  }

  const familyList = Array.from(families)

  profileFamiliesForTermCache.set(normalizedTerm, familyList)

  return familyList
}

function getProfileFamiliesFromTerms(terms: string[]) {
  const normalizedTerms = terms.map(normalizeReferenceText).filter(Boolean)
  const termsKey = normalizedTerms.slice().sort().join('|')

  if (!termsKey) {
    return []
  }

  const cachedFamilies = profileFamiliesFromTermsCache.get(termsKey)

  if (cachedFamilies) {
    return cachedFamilies
  }

  const families = Array.from(
    new Set(normalizedTerms.flatMap((term) => getProfileFamiliesForTerm(term))),
  )

  profileFamiliesFromTermsCache.set(termsKey, families)

  return families
}

function getRequestedScentFamilies(intent: RecommendationIntent) {
  const cachedFamilies = requestedScentFamiliesCache.get(intent)

  if (cachedFamilies) {
    return cachedFamilies
  }

  const noteFamilies = intent.requestedNoteTokens.flatMap((noteToken) => [
    noteToken,
    ...(NOTE_FAMILIES[noteToken]?.classification ?? []),
    ...(NOTE_FAMILIES[noteToken]?.strong ?? []),
  ])
  const vibeFamilies = intent.requestedVibes.flatMap((vibe) => [
    vibe,
    ...getExpandedVibeTerms(vibe),
  ])
  const occasionFamilies = intent.requestedOccasions.flatMap((occasion) => {
    const profile = OCCASION_PROFILES[occasion]

    return profile ? [occasion, ...profile.boost, ...profile.allow] : []
  })
  const constraintFamilies = intent.intentBuckets.constraintBoostTerms

  const families = Array.from(
    new Set(
      getProfileFamiliesFromTerms([
        ...noteFamilies,
        ...vibeFamilies,
        ...occasionFamilies,
        ...constraintFamilies,
      ]),
    ),
  )

  requestedScentFamiliesCache.set(intent, families)

  return families
}

function getIntentCompatibilityContext(intent: RecommendationIntent) {
  const cachedContext = intentCompatibilityContextCache.get(intent)

  if (cachedContext) {
    return cachedContext
  }

  const requestedFamilies = getRequestedScentFamilies(intent)
  const requestedFamilySet = new Set(requestedFamilies)
  const conflictTerms = Array.from(
    new Set(
      requestedFamilies.flatMap(
        (family) => GLOBAL_PROFILE_CONFLICTS[family] ?? [],
      ),
    ),
  )
  const context = {
    requestedFamilies,
    requestedFamilySet,
    conflictTerms,
    hasFreshCleanFamily:
      requestedFamilySet.has('fresh') ||
      requestedFamilySet.has('citrus') ||
      requestedFamilySet.has('clean') ||
      requestedFamilySet.has('aquatic'),
    hasFreshCitrusCleanTropicalFamily:
      requestedFamilySet.has('fresh') ||
      requestedFamilySet.has('citrus') ||
      requestedFamilySet.has('clean') ||
      requestedFamilySet.has('tropical'),
  }

  intentCompatibilityContextCache.set(intent, context)

  return context
}

function getProfileConflictScore(params: {
  record: RecommendableFragrance
  compatibilityContext: IntentCompatibilityContext
  rating: RatingRecord | undefined
  intent: RecommendationIntent
  timing?: ScoringTiming
}) {
  const { record, compatibilityContext, rating, intent, timing } = params
  const textFallbackStartedAt = Date.now()
  const directConflictCount = compatibilityContext.conflictTerms.filter((term) =>
    recordMatchesTerm(record, term),
  ).length
  if (timing) {
    timing.compatibilityTextFallbackMs += Date.now() - textFallbackStartedAt
  }
  const nightShare = parseNullableNumber(rating?.nightShare ?? null)
  const winterShare = parseNullableNumber(rating?.winterShare ?? null)
  const nightHeavyConflict =
    compatibilityContext.hasFreshCleanFamily &&
    !intent.hasTimeIntent &&
    nightShare !== null &&
    nightShare >= 0.62
      ? 1
      : 0
  const winterHeavyConflict =
    compatibilityContext.hasFreshCitrusCleanTropicalFamily &&
    !intent.hasSeasonIntent &&
    winterShare !== null &&
    winterShare >= 0.34
      ? 1
      : 0

  return clamp(
    directConflictCount * 12 + nightHeavyConflict * 8 + winterHeavyConflict * 7,
    0,
    45,
  )
}

function getProfileCompatibility(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  intent: RecommendationIntent
  compatibilityContext: IntentCompatibilityContext
  timing?: ScoringTiming
  scentRelevanceLayer: Omit<
    ScentRelevanceLayer,
    'compatibilityLevel' | 'compatibilityScore' | 'conflictScore' | 'scoreCap'
  >
  matchedRequestedNoteCount: number
  partiallyMatchedRequestedNoteCount: number
}) {
  const {
    record,
    rating,
    intent,
    compatibilityContext,
    timing,
    scentRelevanceLayer,
    matchedRequestedNoteCount,
    partiallyMatchedRequestedNoteCount,
  } = params
  const { requestedFamilies } = compatibilityContext

  if (
    intent.promptType === 'general' &&
    requestedFamilies.length === 0 &&
    intent.requestedNoteTokens.length === 0
  ) {
    return {
      compatibilityLevel: 'strong' as const,
      compatibilityScore: 100,
      conflictScore: 0,
      scoreCap: null,
    }
  }

  const familyOverlapStartedAt = Date.now()
  const candidateProfile = getFragranceProfile(record)
  const sharedFamilyCount = requestedFamilies.filter((family) =>
    candidateProfile.overallProfileFamiliesSet.has(family),
  ).length
  if (timing) {
    timing.compatibilityFamilyOverlapMs += Date.now() - familyOverlapStartedAt
  }
  const sharedFamilyRatio =
    requestedFamilies.length > 0
      ? sharedFamilyCount / requestedFamilies.length
      : 0
  const normalizedNoteScore = normalizeMatchScore(
    scentRelevanceLayer.noteRelevanceScore,
  )
  const conflictStartedAt = Date.now()
  const conflictScore = getProfileConflictScore({
    record,
    compatibilityContext,
    rating,
    intent,
    timing,
  })
  if (timing) {
    timing.compatibilityConflictMs += Date.now() - conflictStartedAt
  }
  const capStartedAt = Date.now()
  const hasStrictCombo = intent.requestedNoteTokens.length >= 2
  const hasFullStrictCoverage =
    !hasStrictCombo ||
    matchedRequestedNoteCount === intent.requestedNoteTokens.length ||
    partiallyMatchedRequestedNoteCount === intent.requestedNoteTokens.length
  const baseCompatibilityScore = clamp(
    normalizedNoteScore * 0.36 +
      scentRelevanceLayer.noteFamilyScore * 0.18 +
      scentRelevanceLayer.profileScore * 0.28 +
      scentRelevanceLayer.combinedIntentScore * 0.18 +
      sharedFamilyRatio * 24 -
      conflictScore,
    0,
    100,
  )
  const hasStrongPath =
    (matchedRequestedNoteCount > 0 && normalizedNoteScore >= 55) ||
    scentRelevanceLayer.combinedIntentScore >= 72 ||
    (sharedFamilyCount >= 2 && scentRelevanceLayer.profileScore >= 55) ||
    (intent.requestedOccasions.length > 0 && scentRelevanceLayer.occasionScore >= 62)
  const hasModeratePath =
    partiallyMatchedRequestedNoteCount > 0 ||
    sharedFamilyCount > 0 ||
    scentRelevanceLayer.profileScore >= 38 ||
    scentRelevanceLayer.combinedIntentScore >= 45

  if (hasStrictCombo && !hasFullStrictCoverage) {
    if (timing) {
      timing.compatibilityCapMs += Date.now() - capStartedAt
    }
    return {
      compatibilityLevel: 'weak' as const,
      compatibilityScore: Math.min(baseCompatibilityScore, 45),
      conflictScore,
      scoreCap: 52,
    }
  }

  if (conflictScore >= 30 && !hasStrongPath) {
    if (timing) {
      timing.compatibilityCapMs += Date.now() - capStartedAt
    }
    return {
      compatibilityLevel: 'conflicting' as const,
      compatibilityScore: Math.min(baseCompatibilityScore, 35),
      conflictScore,
      scoreCap: 48,
    }
  }

  if (!hasModeratePath) {
    if (timing) {
      timing.compatibilityCapMs += Date.now() - capStartedAt
    }
    return {
      compatibilityLevel: 'unrelated' as const,
      compatibilityScore: Math.min(baseCompatibilityScore, 30),
      conflictScore,
      scoreCap: 42,
    }
  }

  if (hasStrongPath && conflictScore < 18) {
    if (timing) {
      timing.compatibilityCapMs += Date.now() - capStartedAt
    }
    return {
      compatibilityLevel: 'strong' as const,
      compatibilityScore: Math.max(baseCompatibilityScore, 78),
      conflictScore,
      scoreCap: null,
    }
  }

  if (baseCompatibilityScore >= 52 && conflictScore < 24) {
    if (timing) {
      timing.compatibilityCapMs += Date.now() - capStartedAt
    }
    return {
      compatibilityLevel: 'moderate' as const,
      compatibilityScore: baseCompatibilityScore,
      conflictScore,
      scoreCap: 88,
    }
  }

  if (timing) {
    timing.compatibilityCapMs += Date.now() - capStartedAt
  }
  return {
    compatibilityLevel: 'weak' as const,
    compatibilityScore: baseCompatibilityScore,
    conflictScore,
    scoreCap: 66,
  }
}

function getMatchedRequestedNoteTokens(
  record: RecommendableFragrance,
  requestedNoteTokens: string[],
) {
  return requestedNoteTokens.filter(
    (noteToken) => {
      const matchStrength = getRequestedNoteMatchStrength(record, noteToken)

      return matchStrength === 'exact' || matchStrength === 'strong'
    },
  )
}

function getPartiallyMatchedRequestedNoteTokens(
  record: RecommendableFragrance,
  requestedNoteTokens: string[],
) {
  const allowLooseSoftSupport = requestedNoteTokens.length === 1
  const allowFamilyFallback = requestedNoteTokens.length >= 1

  return requestedNoteTokens.filter((noteToken) =>
    ['exact', 'strong', 'medium', 'soft'].includes(
      getRequestedNoteMatchStrength(record, noteToken, {
        allowLooseSoftSupport,
        allowFamilyFallback,
      }),
    ),
  )
}

function getTimeContextProfileScore(record: RecommendableFragrance) {
  const profileMatches = TIME_CONTEXT_PROFILE_TERMS.filter(
    (term) => recordMatchesTerm(record, term),
  )

  return clamp(profileMatches.length * 18, 0, 100)
}

function getExpandedVibeTerms(
  vibe: string,
  seenVibes = new Set<string>(),
): string[] {
  const isRootCall = seenVibes.size === 0

  if (isRootCall) {
    const cachedTerms = expandedVibeTermsCache.get(vibe)

    if (cachedTerms) {
      return cachedTerms
    }
  }

  if (seenVibes.has(vibe)) {
    return []
  }

  seenVibes.add(vibe)

  const terms = (VIBE_FAMILIES[vibe] ?? []).flatMap((term): string[] =>
    VIBE_FAMILIES[term]
      ? getExpandedVibeTerms(term, seenVibes)
      : [term],
  )

  if (isRootCall) {
    expandedVibeTermsCache.set(vibe, terms)
  }

  return terms
}

function countAccordMatches(record: RecommendableFragrance, terms: string[]) {
  const accordSet = getFragranceProfile(record).computedAccordsSet
  const profileFamilies = getProfileFamiliesFromTerms(terms)
  const directAccordMatches = terms.filter((term) =>
    accordSet.has(normalizeReferenceText(term)),
  ).length
  const profileAccordMatches = profileFamilies.filter((family) =>
    accordSet.has(family),
  ).length

  return Math.max(directAccordMatches, profileAccordMatches)
}

function recordComputedAccordsMatchTerm(
  record: RecommendableFragrance,
  term: string,
) {
  const normalizedTerm = normalizeReferenceText(term)

  return getCachedTermMatch(
    recordComputedAccordTermMatchCache,
    record,
    normalizedTerm,
    () => {
      const accordSet = getFragranceProfile(record).computedAccordsSet

      return (
        accordSet.has(normalizedTerm) ||
        getProfileFamiliesForTerm(normalizedTerm).some((family) =>
          accordSet.has(family),
        )
      )
    },
  )
}

function scoreVibeFamilies(
  record: RecommendableFragrance,
  requestedVibes: string[],
) {
  if (!requestedVibes.length) {
    return 0
  }

  const vibeScores = requestedVibes.map((vibe) => {
    const familyTerms = getUniqueExpandedVibeTerms(vibe)
    const accordMatchCount = countAccordMatches(record, familyTerms)
    const ontologySubfamilyMatchCount = familyTerms.filter((term) =>
      recordHasOntologySubfamilySupport(record, term),
    ).length
    const ontologyFamilyMatchCount = familyTerms.filter(
      (term) =>
        !recordHasOntologySubfamilySupport(record, term) &&
        recordHasOntologyFamilySupport(record, term),
    ).length
    let noteMatchCount = 0
    let classificationMatchCount = 0
    let searchableOnlyMatchCount = 0

    for (const term of familyTerms) {
      const notesMatch = recordNotesMatchTerm(record, term)
      const classificationMatch = recordClassificationMatchesTerm(record, term)

      if (notesMatch) {
        noteMatchCount += 1
      }

      if (classificationMatch) {
        classificationMatchCount += 1
      }

      if (
        !notesMatch &&
        !classificationMatch &&
        !recordComputedAccordsMatchTerm(record, term) &&
        recordSearchableTextMatchesTerm(record, term)
      ) {
        searchableOnlyMatchCount += 1
      }
    }

    const noteScore = Math.min(noteMatchCount * 14, 70)
    const accordScore = Math.min(accordMatchCount * 12, 36)
    const classificationScore = Math.min(classificationMatchCount * 18, 48)
    const searchableScore = Math.min(searchableOnlyMatchCount * 6, 18)
    const ontologyScore = Math.min(
      ontologySubfamilyMatchCount * 9 + ontologyFamilyMatchCount * 4,
      24,
    )

    return clamp(
      noteScore + accordScore + classificationScore + searchableScore + ontologyScore,
      0,
      100,
    )
  })
  const matchedVibeCount = vibeScores.filter((score) => score > 0).length

  if (!matchedVibeCount) {
    return 0
  }

  const averageScore =
    vibeScores.reduce((total, score) => total + score, 0) /
    requestedVibes.length

  return clamp(averageScore + Math.max(0, matchedVibeCount - 1) * 6, 0, 100)
}

function getUniqueExpandedVibeTerms(vibe: string) {
  const normalizedVibe = normalizeReferenceText(vibe)

  if (!normalizedVibe) {
    return []
  }

  const cachedTerms = uniqueExpandedVibeTermsCache.get(normalizedVibe)

  if (cachedTerms) {
    return cachedTerms
  }

  const terms = Array.from(new Set(getExpandedVibeTerms(normalizedVibe)))

  uniqueExpandedVibeTermsCache.set(normalizedVibe, terms)

  return terms
}

function scoreClassificationIntent(
  record: RecommendableFragrance,
  requestedNoteTokens: string[],
  requestedVibes: string[],
) {
  const noteClassificationTerms = requestedNoteTokens.flatMap(
    (noteToken) => NOTE_FAMILIES[noteToken]?.classification ?? [],
  )
  const vibeClassificationTerms = requestedVibes.flatMap((vibe) =>
    getUniqueExpandedVibeTerms(vibe),
  )
  const classificationTerms = Array.from(
    new Set([...noteClassificationTerms, ...vibeClassificationTerms]),
  )
  const classificationMatchCount = classificationTerms.filter((term) =>
    recordClassificationMatchesTerm(record, term),
  ).length

  return clamp(classificationMatchCount * 22, 0, 100)
}

function scoreOccasionProfile(
  record: RecommendableFragrance,
  profile: OccasionProfile,
) {
  const boostMatchCount = profile.boost.filter((term) =>
    recordMatchesTerm(record, term),
  ).length
  const allowMatchCount = profile.allow.filter((term) =>
    recordMatchesTerm(record, term),
  ).length

  return clamp(
    Math.min(boostMatchCount * 14, 82) + Math.min(allowMatchCount * 5, 18),
    0,
    100,
  )
}

function getOccasionPenalty(
  record: RecommendableFragrance,
  requestedOccasions: string[],
) {
  if (!requestedOccasions.length) {
    return 0
  }

  return Math.max(
    ...requestedOccasions.map((occasion) => {
      const profile = OCCASION_PROFILES[occasion]

      if (!profile) {
        return 0
      }

      const positiveScore = scoreOccasionProfile(record, profile)
      const penaltyMatchCount = profile.penalize.filter((term) =>
        recordMatchesTerm(record, term),
      ).length
      const rawPenalty = Math.min(26, penaltyMatchCount * 9)

      return positiveScore >= 60 ? Math.min(rawPenalty, 10) : rawPenalty
    }),
  )
}

function getOccasionScoreCap(
  record: RecommendableFragrance,
  requestedOccasions: string[],
) {
  const caps = requestedOccasions
    .map((occasion) => {
      const profile = OCCASION_PROFILES[occasion]

      if (!profile) {
        return null
      }

      const positiveScore = scoreOccasionProfile(record, profile)
      const penaltyMatchCount = profile.penalize.filter((term) =>
        recordMatchesTerm(record, term),
      ).length

      return penaltyMatchCount > 0 && positiveScore < 45
        ? profile.penaltyCap
        : null
    })
    .filter((cap): cap is number => cap !== null)

  return caps.length ? Math.min(...caps) : null
}

function getWearabilityContextKeys(intent: RecommendationIntent) {
  const contexts = new Set<string>(intent.requestedOccasions)
  const normalizedMessage = intent.normalizedMessage

  if (intent.hasSeasonIntent) {
    if (intent.ratingIntents.summer) {
      contexts.add('hot weather')
    }

    if (intent.ratingIntents.winter) {
      contexts.add('cozy')
    }
  }

  for (const vibe of intent.requestedVibes) {
    const normalizedVibe = normalizeReferenceText(vibe)

    if (normalizedVibe === 'beginner safe') {
      contexts.add('beginner safe')
    }

    if (normalizedVibe === 'compliment friendly') {
      contexts.add('compliment friendly')
    }

    if (normalizedVibe === 'office') {
      contexts.add('office')
    }

    if (normalizedVibe === 'everyday') {
      contexts.add('everyday')
    }
  }

  if (includesPhrase(normalizedMessage, 'blind buy')) {
    contexts.add('beginner safe')
  }

  return Array.from(contexts)
}

function getBroadAppealScore(rating: RatingRecord | undefined) {
  if (!rating) {
    return 50
  }

  const loveCount = parseNullableNumber(rating.loveCount) ?? 0
  const likeCount = parseNullableNumber(rating.likeCount) ?? 0
  const okCount = parseNullableNumber(rating.okCount) ?? 0
  const dislikeCount = parseNullableNumber(rating.dislikeCount) ?? 0
  const hateCount = parseNullableNumber(rating.hateCount) ?? 0
  const totalReactionCount =
    loveCount + likeCount + okCount + dislikeCount + hateCount
  const positiveShare =
    totalReactionCount > 0
      ? (loveCount + likeCount) / totalReactionCount
      : 0.55
  const negativeShare =
    totalReactionCount > 0
      ? (dislikeCount + hateCount) / totalReactionCount
      : 0.12
  const ratingValue = parseNullableNumber(rating.ratingValue) ?? 3.8
  const voteCount = parseNullableNumber(rating.ratingVoteCount) ?? 0
  const voteConfidence = Math.min(16, Math.log10(voteCount + 1) * 5)

  return clamp(
    positiveShare * 62 -
      negativeShare * 45 +
      (ratingValue - 3.4) * 18 +
      voteConfidence,
    0,
    100,
  )
}

function getWearabilityConflictPenalty(
  record: RecommendableFragrance,
  contextKey: string,
) {
  const profile = OCCASION_PROFILES[contextKey]

  if (profile) {
    const penaltyMatchCount = profile.penalize.filter((term) =>
      recordMatchesTerm(record, term),
    ).length

    return Math.min(36, penaltyMatchCount * 10)
  }

  if (contextKey === 'beginner safe' || contextKey === 'compliment friendly') {
    const conflictTerms = [
      'oud',
      'animalic',
      'cumin',
      'leather',
      'smoke',
      'smoky',
      'incense',
      'tobacco',
      'resin',
      'dark',
    ]
    const conflictCount = conflictTerms.filter((term) =>
      recordMatchesTerm(record, term),
    ).length

    return Math.min(38, conflictCount * 9)
  }

  return 0
}

function scoreWearabilityContext(
  record: RecommendableFragrance,
  contextKey: string,
  rating: RatingRecord | undefined,
) {
  const profile = OCCASION_PROFILES[contextKey]

  if (profile) {
    return scoreOccasionProfile(record, profile)
  }

  if (contextKey === 'beginner safe' || contextKey === 'compliment friendly') {
    const safeTerms = [
      'fresh',
      'clean',
      'citrus',
      'musk',
      'white musk',
      'woody aromatic',
      'aromatic',
      'soft woods',
      'soft amber',
      'vanilla',
      'easy to wear',
    ]
    const safeMatchCount = safeTerms.filter((term) =>
      recordMatchesTerm(record, term),
    ).length

    return clamp(Math.min(72, safeMatchCount * 12) + getBroadAppealScore(rating) * 0.28, 0, 100)
  }

  return 0
}

function hasExactWearabilityConflict(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms.some(
    (term) =>
      recordNotesMatchTerm(record, term) ||
      recordClassificationMatchesTerm(record, term) ||
      normalizedIncludesPhrase(record.mistifyProductName ?? '', term) ||
      normalizedIncludesPhrase(record.originalFragranceName ?? '', term),
  )
}

function getWearabilityScoreCap(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
  contextKeys: string[]
  conflictPenalty: number
  occasionFitScore: number
}) {
  const { record, intent, contextKeys, conflictPenalty, occasionFitScore } =
    params
  const explicitlyRequestedDark =
    intent.requestedVibes.some((vibe) =>
      ['dark', 'oud', 'tobacco', 'leather', 'smoky'].includes(
        normalizeReferenceText(vibe),
      ),
    ) ||
    intent.requestedNoteTokens.some((note) =>
      ['oud', 'tobacco', 'leather'].includes(normalizeReferenceText(note)),
    )

  if (explicitlyRequestedDark) {
    return null
  }

  const hasOfficeOrGym =
    contextKeys.includes('office') || contextKeys.includes('gym')
  const hasSafeBroad =
    contextKeys.includes('beginner safe') ||
    contextKeys.includes('compliment friendly') ||
    contextKeys.includes('everyday')
  const hasSummer = contextKeys.includes('hot weather')
  const hasWinter = contextKeys.includes('cozy')
  const hasExactDarkConflict = hasExactWearabilityConflict(record, [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'tobacco',
    'leather',
    'smoke',
    'smoky',
    'animalic',
    'cumin',
  ])

  if ((hasOfficeOrGym || hasSafeBroad) && hasExactDarkConflict) {
    return 64
  }

  if (hasSummer && hasExactDarkConflict) {
    return 70
  }

  if ((hasOfficeOrGym || hasSafeBroad) && conflictPenalty >= 18) {
    return occasionFitScore >= 62 ? 84 : 76
  }

  if (hasSummer && conflictPenalty >= 18) {
    return occasionFitScore >= 62 ? 86 : 78
  }

  if (
    hasWinter &&
    occasionFitScore < 42 &&
    (recordHasOntologySubfamilySupport(record, 'citrus') ||
      recordHasOntologySubfamilySupport(record, 'aquatic'))
  ) {
    return 82
  }

  return null
}

function scoreWearabilityLayer(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
}) {
  const { record, rating, intent, scentRelevanceLayer } = params
  const contextKeys = getWearabilityContextKeys(intent)

  if (!contextKeys.length) {
    return {
      scentFitScore: scentRelevanceLayer.scentRelevanceScore,
      wearabilityScore: 50,
      occasionFitScore: 0,
      broadAppealScore: getBroadAppealScore(rating),
      conflictPenalty: 0,
      scoreAdjustment: 0,
      scoreCap: null,
    }
  }

  const occasionFitScores = contextKeys.map((contextKey) =>
    scoreWearabilityContext(record, contextKey, rating),
  )
  const occasionFitScore =
    occasionFitScores.reduce((total, score) => total + score, 0) /
    occasionFitScores.length
  const broadAppealScore = getBroadAppealScore(rating)
  const conflictPenalty = Math.max(
    ...contextKeys.map((contextKey) =>
      getWearabilityConflictPenalty(record, contextKey),
    ),
  )
  const wearabilityScore = clamp(
    occasionFitScore * 0.68 + broadAppealScore * 0.2 - conflictPenalty * 0.65,
    0,
    100,
  )
  const scoreAdjustment = clamp((wearabilityScore - 50) * 0.1, -8, 6)
  const scoreCap = getWearabilityScoreCap({
    record,
    intent,
    contextKeys,
    conflictPenalty,
    occasionFitScore,
  })

  return {
    scentFitScore: scentRelevanceLayer.scentRelevanceScore,
    wearabilityScore,
    occasionFitScore,
    broadAppealScore,
    conflictPenalty,
    scoreAdjustment,
    scoreCap,
  }
}

function scoreOccasionIntent(
  record: RecommendableFragrance,
  requestedOccasions: string[],
) {
  if (!requestedOccasions.length) {
    return 0
  }

  return Math.max(
    ...requestedOccasions.map((occasion) => {
      const profile = OCCASION_PROFILES[occasion]

      return profile ? scoreOccasionProfile(record, profile) : 0
    }),
  )
}

function scoreConstraintIntent(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  const terms = intent.intentBuckets.constraintBoostTerms

  if (!terms.length) {
    return 0
  }

  const noteMatchCount = terms.filter((term) =>
    recordNotesMatchTerm(record, term),
  ).length
  const classificationMatchCount = terms.filter((term) =>
    recordClassificationMatchesTerm(record, term),
  ).length
  const searchableOnlyMatchCount = terms.filter(
    (term) =>
      !recordNotesMatchTerm(record, term) &&
      !recordClassificationMatchesTerm(record, term) &&
      recordSearchableTextMatchesTerm(record, term),
  ).length

  return clamp(
    noteMatchCount * 14 +
      classificationMatchCount * 10 +
      searchableOnlyMatchCount * 4,
    0,
    100,
  )
}

function getNegativeIntentPenalty(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  const terms = intent.intentBuckets.negativeTerms

  if (!terms.length) {
    return 0
  }

  const directNoteMatches = terms.filter((term) =>
    recordNotesMatchTerm(record, term),
  ).length
  const broaderMatches = terms.filter(
    (term) =>
      !recordNotesMatchTerm(record, term) &&
      (recordClassificationMatchesTerm(record, term) ||
        recordSearchableTextMatchesTerm(record, term)),
  ).length

  return clamp(directNoteMatches * 10 + broaderMatches * 5, 0, 34)
}

function getNegativeIntentScoreCap(negativeIntentPenalty: number) {
  if (negativeIntentPenalty >= 24) {
    return 72
  }

  if (negativeIntentPenalty >= 14) {
    return 82
  }

  if (negativeIntentPenalty > 0) {
    return 90
  }

  return null
}

function hasHardNegativeIntentConflict(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  const terms = intent.intentBuckets.hardNegativeTerms

  if (!terms.length) {
    return false
  }

  return terms.some(
    (term) =>
      recordNotesMatchTerm(record, term) ||
      recordClassificationMatchesTerm(record, term) ||
      recordHasOntologySubfamilySupport(record, term) ||
      normalizedIncludesPhrase(record.mistifyProductName ?? '', term) ||
      normalizedIncludesPhrase(record.originalFragranceName ?? '', term),
  )
}

function hasContextualOfficeSafetyConflict(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  const hasOfficeSafetyContext = [
    ...intent.requestedOccasions,
    ...intent.requestedVibes,
    ...intent.intentBuckets.desiredVibes,
    ...intent.intentBuckets.constraints,
  ].some((term) => ['office', 'work', 'professional', 'office safe', 'office-safe'].includes(normalizeReferenceText(term)))

  if (!hasOfficeSafetyContext) {
    return false
  }

  const conflictTerms = ['oud', 'aoud', 'oudh', 'agarwood', 'tobacco', 'leather', 'smoke', 'smoky']

  return conflictTerms.some(
    (term) =>
      recordNotesMatchTerm(record, term) ||
      recordClassificationMatchesTerm(record, term) ||
      recordHasOntologySubfamilySupport(record, term) ||
      normalizedIncludesPhrase(record.mistifyProductName ?? '', term) ||
      normalizedIncludesPhrase(record.originalFragranceName ?? '', term),
  )
}

function hasSoftNegativeRequiredNotePadding(
  recommendation: ScoredRecommendation,
  intent: RecommendationIntent,
) {
  const hasSoftSweetNegative = intent.intentBuckets.negativeTerms.some((term) =>
    ['sweet', 'sugary', 'gourmand', 'syrup', 'candy sweet'].includes(
      normalizeReferenceText(term),
    ),
  )

  if (
    !hasSoftSweetNegative ||
    intent.intentBuckets.requiredNotes.length === 0 ||
    recommendation.matchScore >= 66
  ) {
    return false
  }

  const hasCloseRequiredNoteEvidence = intent.intentBuckets.requiredNotes.some(
    (noteToken) =>
      isCloseRequestedNoteEvidence(
        getRequestedNoteFieldEvidenceStrength(recommendation.record, noteToken),
      ),
  )

  return !hasCloseRequiredNoteEvidence
}

function getDenseSweetDessertMatchCount(record: RecommendableFragrance) {
  const denseSweetTerms = [
    'sugar',
    'brown sugar',
    'caramel',
    'praline',
    'chocolate',
    'cacao',
    'cocoa',
    'syrup',
    'ice cream',
    'speculoos',
    'creme brulee',
    'marshmallow',
    'candy',
    'cotton candy',
    'amaretto',
    'coffee',
    'gourmand',
  ]

  return denseSweetTerms.filter((term) => recordMatchesTerm(record, term)).length
}

function getLightVanillaSupportCount(record: RecommendableFragrance) {
  const lightVanillaTerms = [
    'musk',
    'white musk',
    'skin musk',
    'cedar',
    'cedarwood',
    'sandalwood',
    'woods',
    'woody',
    'lavender',
    'aromatic',
    'bergamot',
    'citrus',
    'amber',
    'floral',
    'clean',
  ]

  return lightVanillaTerms.filter((term) => recordMatchesTerm(record, term)).length
}

function getSoftSweetNegativeScoreCap(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
}) {
  const { record, intent } = params
  const hasSoftSweetNegative = intent.intentBuckets.negativeTerms.some((term) =>
    ['sweet', 'sugary', 'gourmand', 'syrup', 'candy sweet'].includes(
      normalizeReferenceText(term),
    ),
  )

  if (!hasSoftSweetNegative) {
    return null
  }

  const denseSweetCount = getDenseSweetDessertMatchCount(record)
  const lightSupportCount = getLightVanillaSupportCount(record)
  const sweetConflictFamilies = getConflictFamiliesForSoftCap('sweet')
  const ontologySweetConflictCount = sweetConflictFamilies.filter((term) =>
    term === 'gourmand'
      ? recordHasOntologySubfamilySupport(record, term)
      : recordHasOntologyFamilySupport(record, term),
  ).length
  const effectiveDenseSweetCount =
    denseSweetCount + ontologySweetConflictCount

  if (effectiveDenseSweetCount >= 5) {
    return lightSupportCount >= 3 ? 84 : 78
  }

  if (effectiveDenseSweetCount >= 3) {
    return lightSupportCount >= 3 ? 88 : 82
  }

  if (effectiveDenseSweetCount >= 2 && lightSupportCount < 2) {
    return 86
  }

  return null
}

function isFreshCitrusLightIntent(intent: RecommendationIntent) {
  const requestedTerms = [
    ...intent.requestedNoteTokens,
    ...intent.requestedVibes,
    ...intent.intentBuckets.preferredNotes,
    ...intent.intentBuckets.desiredVibes,
  ].map(normalizeReferenceText)
  const asksFreshLight =
    requestedTerms.some((term) =>
      ['fresh', 'citrus', 'clean', 'aquatic', 'green', 'aromatic'].includes(
        term,
      ),
    ) ||
    includesPhrase(intent.normalizedMessage, 'fresh') ||
    includesPhrase(intent.normalizedMessage, 'citrus')

  if (!asksFreshLight) {
    return false
  }

  return !requestedTerms.some((term) =>
    ['oud', 'tobacco', 'leather', 'smoky', 'smoke', 'gourmand', 'dark'].includes(
      term,
    ),
  )
}

function isExactFreshCitrusIntent(intent: RecommendationIntent) {
  const hasFresh =
    intent.requestedVibes.some((vibe) => normalizeReferenceText(vibe) === 'fresh') ||
    includesPhrase(intent.normalizedMessage, 'fresh')
  const hasCitrus =
    intent.requestedNoteTokens.some((note) => normalizeReferenceText(note) === 'citrus') ||
    intent.requestedVibes.some((vibe) => normalizeReferenceText(vibe) === 'citrus') ||
    includesPhrase(intent.normalizedMessage, 'citrus')
  const isExploratory =
    includesPhrase(intent.normalizedMessage, 'maybe') ||
    includesPhrase(intent.normalizedMessage, 'something fresh')

  return hasFresh && hasCitrus && !isExploratory
}

function getFreshCitrusOffProfileScoreCap(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
}) {
  const { record, intent } = params

  if (!isFreshCitrusLightIntent(intent)) {
    return null
  }

  const explicitlyRequestedHeavyTerm = [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'tobacco',
    'leather',
    'smoke',
    'smoky',
    'incense',
    'gourmand',
  ].some((term) =>
    intent.requestedNoteTokens.some((note) => normalizeReferenceText(note) === term) ||
    intent.requestedVibes.some((vibe) => normalizeReferenceText(vibe) === term),
  )

  if (explicitlyRequestedHeavyTerm) {
    return null
  }

  const denseDessertCount = getDenseSweetDessertMatchCount(record)
  const hasGourmandClassification = recordClassificationMatchesAnyTerm(record, [
    'gourmand',
    'floral gourmand',
    'citrus gourmand',
  ])
  const darkConflictCount = [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'tobacco',
    'tobacco leaf',
    'leather',
    'smoke',
    'smoky',
    'incense',
  ].filter((term) => recordMatchesTerm(record, term)).length
  const dessertConflictCount =
    denseDessertCount + (hasGourmandClassification ? 1 : 0)
  const resinAmberConflictCount = [
    'dark amber',
    'resin',
    'resins',
    'labdanum',
    'myrrh',
    'olibanum',
    'frankincense',
  ].filter((term) => recordMatchesTerm(record, term)).length
  const hasFreshCitrusProfile = recordClassificationMatchesAnyTerm(record, [
    'citrus',
    'citrus aromatic',
    'green citrus',
    'fresh',
    'fresh aromatic',
    'aquatic',
    'clean',
  ])
  const isExactFreshCitrus = isExactFreshCitrusIntent(intent)
  const hasFloralSweetProfile =
    !hasFreshCitrusProfile &&
    recordClassificationMatchesAnyTerm(record, [
      'floral woody musk',
      'floral',
      'fruity floral',
      'floral sweet',
    ]) &&
    [
      'caramel',
      'milk',
      'cream',
      'vanilla',
      'amber',
      'peach',
      'cherry',
      'fruity',
    ].some((term) => recordMatchesTerm(record, term))

  if (darkConflictCount >= 2 || dessertConflictCount >= 3) {
    return 76
  }

  if (darkConflictCount >= 1) {
    return 78
  }

  if (dessertConflictCount >= 2) {
    return 84
  }

  if (isExactFreshCitrus && hasFloralSweetProfile) {
    return 84
  }

  if (!hasFreshCitrusProfile && resinAmberConflictCount >= 2) {
    return 88
  }

  if (hasGourmandClassification) {
    return 88
  }

  return null
}

function getSafeBroadProfileConflictScoreCap(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
}) {
  const { record, intent } = params
  const safeBroadProfiles = ['beginner safe', 'compliment friendly']
  const hasSafeBroadIntent = intent.requestedVibes.some((vibe) =>
    safeBroadProfiles.includes(normalizeReferenceText(vibe)),
  )

  if (!hasSafeBroadIntent) {
    return null
  }

  const explicitlyRequestedOud =
    intent.requestedNoteTokens.some(
      (note) => normalizeReferenceText(note) === 'oud',
    ) ||
    intent.requestedVibes.some(
      (vibe) => normalizeReferenceText(vibe) === 'oud',
    )

  if (explicitlyRequestedOud) {
    return null
  }

  const advancedProfileTerms = [
    'oud',
    'agarwood',
    'aoud',
    'oudh',
    'animalic',
    'cumin',
    'smoke',
    'smoky',
    'leather',
    'tobacco',
    'incense',
    'resin',
  ]
  const strongConflictCount = advancedProfileTerms.filter((term) =>
    recordMatchesTerm(record, term),
  ).length

  if (strongConflictCount >= 2) {
    return 52
  }

  if (strongConflictCount === 1) {
    return 58
  }

  return null
}

function getBroadProfileDisplayScoreCap(params: {
  score: number
  intent: RecommendationIntent
  requestedNoteCount: number
  profileScore: number
  qualityScore: number
  ratingReliabilityScore: number
  dataConfidenceScore: number
}) {
  const {
    score,
    intent,
    requestedNoteCount,
    profileScore,
    qualityScore,
    ratingReliabilityScore,
    dataConfidenceScore,
  } = params

  if (score < 88) {
    return null
  }

  const supportScore =
    qualityScore * 0.45 +
    ratingReliabilityScore * 0.35 +
    dataConfidenceScore * 0.2

  if (intent.promptType === 'broad_vibe' && requestedNoteCount === 0) {
    return clamp(
      Math.round(82 + profileScore * 0.05 + supportScore * 0.03),
      86,
      90,
    )
  }

  if (
    intent.promptType === 'note_plus_vibe' &&
    intent.requestedVibes.length >= 2
  ) {
    return supportScore >= 90
      ? 96
      : supportScore >= 75
        ? 94
        : supportScore >= 60
          ? 93
          : 92
  }

  if (intent.promptType === 'occasion' && requestedNoteCount === 0) {
    return supportScore >= 82
      ? 90
      : supportScore >= 68
        ? 89
        : supportScore >= 52
          ? 88
          : 87
  }

  return null
}

function scoreScentRelevanceLayer(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
  rating?: RatingRecord
  timing?: ScoringTiming
  compatibilityContext: IntentCompatibilityContext
}) {
  const { record, intent, rating, timing, compatibilityContext } = params
  let sectionStartedAt = Date.now()
  const noteRelevanceScore = scoreFragrance(
    record,
    intent.tokens,
    intent.requestedNoteTokens,
  )
  const noteFamilyScores = intent.requestedNoteTokens.map((noteToken) =>
    getNoteMatchStrengthScore(
      getRequestedNoteMatchStrength(record, noteToken, {
        allowLooseSoftSupport: intent.requestedNoteTokens.length === 1,
        allowFamilyFallback: true,
      }),
    ) * 100,
  )
  const noteFamilyScore = noteFamilyScores.length
    ? noteFamilyScores.reduce((total, score) => total + score, 0) /
      noteFamilyScores.length
    : 0
  if (timing) {
    timing.noteMs += Date.now() - sectionStartedAt
  }
  sectionStartedAt = Date.now()
  const flavorOrVibeScore = scoreVibeFamilies(record, intent.requestedVibes)
  if (timing) {
    timing.vibeMs += Date.now() - sectionStartedAt
  }
  sectionStartedAt = Date.now()
  const classificationScore = scoreClassificationIntent(
    record,
    intent.requestedNoteTokens,
    intent.requestedVibes,
  )
  const layerAwareScore = getLayerAwareIntentScore({
    record,
    intent,
    classificationScore,
  })
  if (timing) {
    timing.classificationMs += Date.now() - sectionStartedAt
  }
  sectionStartedAt = Date.now()
  const timeOfDayScore = intent.hasTimeIntent
    ? getTimeContextProfileScore(record)
    : 0
  const occasionScore = scoreOccasionIntent(record, intent.requestedOccasions)
  const occasionPenalty = getOccasionPenalty(
    record,
    intent.requestedOccasions,
  )
  const occasionScoreCap = getOccasionScoreCap(
    record,
    intent.requestedOccasions,
  )
  const constraintScore = scoreConstraintIntent(record, intent)
  const negativeIntentPenalty = getNegativeIntentPenalty(record, intent)
  const negativeIntentScoreCap = getNegativeIntentScoreCap(
    negativeIntentPenalty,
  )
  if (timing) {
    timing.occasionMs += Date.now() - sectionStartedAt
  }
  sectionStartedAt = Date.now()
  const combinedIntentScore = scoreCombinedIntent({
    record,
    requestedNoteTokens: intent.requestedNoteTokens,
    requestedVibes: intent.requestedVibes,
  })
  if (timing) {
    timing.combinedMs += Date.now() - sectionStartedAt
  }
  const uncappedProfileScore = Math.max(
    flavorOrVibeScore,
    classificationScore,
    timeOfDayScore,
    occasionScore,
    constraintScore,
  )
  const profileScoreCap = Math.min(
    occasionScoreCap ?? 100,
    negativeIntentScoreCap ?? 100,
  )
  const profileScore = clamp(
    uncappedProfileScore - occasionPenalty - negativeIntentPenalty,
    0,
    profileScoreCap,
  )
  const uncappedScentRelevanceScore = Math.max(
    normalizeMatchScore(noteRelevanceScore),
    layerAwareScore,
    profileScore,
    combinedIntentScore,
  )
  const matchedRequestedNoteTokens = getMatchedRequestedNoteTokens(
    record,
    intent.requestedNoteTokens,
  )
  const partiallyMatchedRequestedNoteTokens =
    getPartiallyMatchedRequestedNoteTokens(record, intent.requestedNoteTokens)
  sectionStartedAt = Date.now()
  const compatibility = getProfileCompatibility({
    record,
    rating,
    intent,
    compatibilityContext,
    timing,
    scentRelevanceLayer: {
      noteRelevanceScore,
      noteFamilyScore,
      layerAwareScore,
      flavorOrVibeScore,
      classificationScore,
      seasonScore: 0,
      timeOfDayScore,
      occasionScore,
      combinedIntentScore,
      profileScore,
      scentRelevanceScore: uncappedScentRelevanceScore,
    },
    matchedRequestedNoteCount: matchedRequestedNoteTokens.length,
    partiallyMatchedRequestedNoteCount:
      partiallyMatchedRequestedNoteTokens.length,
  })
  if (timing) {
    timing.compatibilityMs += Date.now() - sectionStartedAt
  }
  const scentRelevanceScore = clamp(
    uncappedScentRelevanceScore -
      compatibility.conflictScore * 0.45 -
      negativeIntentPenalty * 0.5,
    0,
    Math.min(compatibility.scoreCap ?? 100, negativeIntentScoreCap ?? 100),
  )
  const compatibilityCappedProfileScore = clamp(
    profileScore - compatibility.conflictScore * 0.35,
    0,
    Math.min(compatibility.scoreCap ?? 100, negativeIntentScoreCap ?? 100),
  )

  return {
    noteRelevanceScore,
    noteFamilyScore,
    layerAwareScore,
    flavorOrVibeScore,
    classificationScore,
    seasonScore: 0,
    timeOfDayScore,
    occasionScore,
    combinedIntentScore,
    profileScore: compatibilityCappedProfileScore,
    scentRelevanceScore,
    compatibilityLevel: compatibility.compatibilityLevel,
    compatibilityScore: compatibility.compatibilityScore,
    conflictScore: compatibility.conflictScore,
    scoreCap:
      compatibility.scoreCap === null && negativeIntentScoreCap === null
        ? null
        : Math.min(compatibility.scoreCap ?? 100, negativeIntentScoreCap ?? 100),
  }
}

function getReferenceModifierAdjustment(params: {
  record: RecommendableFragrance
  modifiers: ReferenceModifier[]
  rating: RatingRecord | undefined
}) {
  const { record, modifiers, rating } = params

  return modifiers.reduce(
    (result, modifier) => {
      const boostMatchCount = modifier.boost.filter((term) =>
        recordMatchesTerm(record, term),
      ).length
      const penaltyMatchCount = modifier.penalize.filter((term) =>
        recordMatchesTerm(record, term),
      ).length
      const seasonBoost =
        modifier.key === 'summer'
          ? (parseNullableNumber(rating?.summerShare ?? null) ?? 0) * 18
          : modifier.key === 'winter'
            ? (parseNullableNumber(rating?.winterShare ?? null) ?? 0) * 18
            : 0
      const timeBoost =
        modifier.key === 'date-night'
          ? (parseNullableNumber(rating?.nightShare ?? null) ?? 0) * 12
          : modifier.key === 'office-safe'
            ? (parseNullableNumber(rating?.dayShare ?? null) ?? 0) * 10
            : 0

      return {
        boost:
          result.boost +
          Math.min(28, boostMatchCount * 6 + seasonBoost + timeBoost),
        penalty: result.penalty + Math.min(26, penaltyMatchCount * 7),
      }
    },
    { boost: 0, penalty: 0 },
  )
}

function getReferenceConflictScore(params: {
  record: RecommendableFragrance
  referenceProfile: ReferenceProfile
  rating: RatingRecord | undefined
  referenceRating: RatingRecord | undefined
}) {
  const { record, referenceProfile, rating, referenceRating } = params
  const directConflictCount = referenceProfile.conflictTerms.filter((term) =>
    recordMatchesTerm(record, term),
  ).length
  const referenceDayShare = parseNullableNumber(referenceRating?.dayShare ?? null)
  const candidateNightShare = parseNullableNumber(rating?.nightShare ?? null)
  const referenceSummerShare = parseNullableNumber(
    referenceRating?.summerShare ?? null,
  )
  const candidateWinterShare = parseNullableNumber(rating?.winterShare ?? null)
  const nightConflict =
    referenceDayShare !== null &&
    referenceDayShare >= 0.55 &&
    candidateNightShare !== null &&
    candidateNightShare >= 0.55
      ? 1
      : 0
  const winterConflict =
    referenceSummerShare !== null &&
    referenceSummerShare >= 0.25 &&
    candidateWinterShare !== null &&
    candidateWinterShare >= 0.32
      ? 1
      : 0

  return clamp(directConflictCount * 12 + nightConflict * 10 + winterConflict * 8, 0, 42)
}

function getReferenceGate(params: {
  exactSharedNoteCount: number
  exactNoteCoverage: number
  familyMatchCount: number
  classificationMatchCount: number
  vibeMatchCount: number
  preservedReferenceBucketCount: number
  strongBucketCount: number
  conflictScore: number
  hasModifiers: boolean
}) {
  const {
    exactSharedNoteCount,
    exactNoteCoverage,
    familyMatchCount,
    classificationMatchCount,
    vibeMatchCount,
    preservedReferenceBucketCount,
    strongBucketCount,
    conflictScore,
    hasModifiers,
  } = params
  const hasExactSharedNotes =
    exactSharedNoteCount >= 2 ||
    (exactSharedNoteCount >= 1 && exactNoteCoverage >= 0.18)
  const hasStrongFamilyOverlap = familyMatchCount >= 5
  const hasProfileSupport =
    classificationMatchCount >= 1 || vibeMatchCount >= 3
  const hasStrongProfilePath =
    (classificationMatchCount >= 1 && familyMatchCount >= 2) ||
    (vibeMatchCount >= 3 && familyMatchCount >= 2)
  const hasMultiBucketDna =
    preservedReferenceBucketCount >= 2 || strongBucketCount >= 2
  const hasStrongReferenceDna =
    preservedReferenceBucketCount >= 3 || strongBucketCount >= 2
  const passesSimilarityGate =
    (hasExactSharedNotes && hasMultiBucketDna) ||
    (hasStrongFamilyOverlap && hasMultiBucketDna) ||
    (hasStrongProfilePath && hasMultiBucketDna) ||
    (hasModifiers && hasProfileSupport && familyMatchCount >= 1 && hasMultiBucketDna)
  const conflictCap =
    conflictScore >= 30
      ? 42
      : conflictScore >= 18 && !hasExactSharedNotes
        ? 55
        : conflictScore >= 12 && !hasProfileSupport
          ? 60
          : null
  const gateCap = passesSimilarityGate
    ? hasStrongReferenceDna
      ? null
      : hasModifiers
        ? 78
        : 72
    : hasModifiers
      ? 58
      : 48

  return {
    passesSimilarityGate,
    scoreCap:
      conflictCap === null && gateCap === null
        ? null
        : Math.min(conflictCap ?? 100, gateCap ?? 100),
  }
}

function scoreSeasonTimeBucketTerm(
  term: string,
  rating: RatingRecord | undefined,
) {
  if (term === 'summer profile') {
    return (parseNullableNumber(rating?.summerShare ?? null) ?? 0) >= 0.22 ? 1 : 0
  }

  if (term === 'winter profile') {
    return (parseNullableNumber(rating?.winterShare ?? null) ?? 0) >= 0.25 ? 1 : 0
  }

  if (term === 'spring profile') {
    return (parseNullableNumber(rating?.springShare ?? null) ?? 0) >= 0.22 ? 1 : 0
  }

  if (term === 'fall profile') {
    return (parseNullableNumber(rating?.fallShare ?? null) ?? 0) >= 0.22 ? 1 : 0
  }

  if (term === 'day profile') {
    return (parseNullableNumber(rating?.dayShare ?? null) ?? 0) >= 0.5 ? 1 : 0
  }

  if (term === 'night profile') {
    return (parseNullableNumber(rating?.nightShare ?? null) ?? 0) >= 0.5 ? 1 : 0
  }

  return 0
}

function scoreReferenceBucketOverlap(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  bucket: ReferenceBucket
}) {
  const { record, rating, bucket } = params
  const profile = getFragranceProfile(record)
  const isNoteBucket =
    bucket.key === 'opening' || bucket.key === 'heart' || bucket.key === 'base'
  const candidateExactTerms =
    bucket.key === 'opening'
      ? profile.normalizedTopNotesSet.size
        ? profile.normalizedTopNotesSet
        : profile.normalizedAllNotesSet
      : bucket.key === 'heart'
        ? profile.normalizedMiddleNotesSet.size
          ? profile.normalizedMiddleNotesSet
          : profile.normalizedAllNotesSet
        : bucket.key === 'base'
          ? profile.normalizedBaseNotesSet.size
            ? profile.normalizedBaseNotesSet
            : profile.normalizedAllNotesSet
          : new Set([
              ...profile.classificationTerms,
              ...profile.classificationFamiliesSet,
            ])
  const candidateFamilyTerms =
    bucket.key === 'opening'
      ? profile.topFamiliesSet.size
        ? profile.topFamiliesSet
        : profile.allNoteFamiliesSet
      : bucket.key === 'heart'
        ? profile.middleFamiliesSet.size
          ? profile.middleFamiliesSet
          : profile.allNoteFamiliesSet
        : bucket.key === 'base'
          ? profile.baseFamiliesSet.size
            ? profile.baseFamiliesSet
            : profile.allNoteFamiliesSet
          : profile.overallProfileFamiliesSet
  let exactMatchedTermCount = 0
  let familyMatchedTermCount = 0

  for (const term of bucket.exactTerms) {
    if (
      bucket.key === 'seasonTime'
        ? scoreSeasonTimeBucketTerm(term, rating) > 0
        : candidateSetHasReferenceTerm(normalizeReferenceText(term), candidateExactTerms)
    ) {
      exactMatchedTermCount += 1
    }
  }

  if (bucket.key !== 'seasonTime') {
    for (const term of bucket.familyTerms) {
      if (candidateSetHasReferenceTerm(normalizeReferenceText(term), candidateFamilyTerms)) {
        familyMatchedTermCount += 1
      }
    }
  }
  const matchedTermCount = exactMatchedTermCount + familyMatchedTermCount
  const exactCoverage =
    bucket.exactTerms.length > 0
      ? exactMatchedTermCount / bucket.exactTerms.length
      : 0
  const familyCoverage =
    bucket.familyTerms.length > 0
      ? familyMatchedTermCount / bucket.familyTerms.length
      : 0
  const score = isNoteBucket
    ? clamp(
        exactMatchedTermCount * 34 +
          familyMatchedTermCount * 9 +
          exactCoverage * 42 +
          familyCoverage * 14,
        0,
        100,
      )
    : clamp(
        exactMatchedTermCount * 24 +
          familyMatchedTermCount * 12 +
          exactCoverage * 34 +
          familyCoverage * 22,
        0,
        100,
      )

  return {
    matchedTermCount,
    exactMatchedTermCount,
    familyMatchedTermCount,
    score,
    isMatched: isNoteBucket
      ? exactMatchedTermCount >= 1 || familyMatchedTermCount >= 2
      : score >= 28 || matchedTermCount >= 2,
    isStrong: isNoteBucket
      ? exactMatchedTermCount >= 2 ||
        (exactMatchedTermCount >= 1 && familyMatchedTermCount >= 2) ||
        familyMatchedTermCount >= 4
      : score >= 56 || matchedTermCount >= 4,
  }
}

function getReferenceBucketSimilarity(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  referenceProfile: ReferenceProfile
  modifiers: ReferenceModifier[]
}) {
  const { record, rating, referenceProfile, modifiers } = params
  let matchedBucketCount = 0
  let strongBucketCount = 0
  let preservedReferenceBucketCount = 0
  let totalWeight = 0
  let weightedScore = 0

  for (const bucket of referenceProfile.buckets) {
    const bucketScore = scoreReferenceBucketOverlap({ record, rating, bucket })

    if (bucketScore.isMatched) {
      matchedBucketCount += 1

      if (bucket.key !== 'seasonTime') {
        preservedReferenceBucketCount += 1
      }
    }

    if (bucketScore.isStrong) {
      strongBucketCount += 1
    }

    totalWeight += bucket.weight
    weightedScore += bucketScore.score * bucket.weight
  }

  const bucketScore = totalWeight > 0 ? weightedScore / totalWeight : 0
  const bucketCoverageScore =
    referenceProfile.buckets.length > 0
      ? (matchedBucketCount / referenceProfile.buckets.length) * 100
      : 0
  const modifierAdjustment = getReferenceModifierAdjustment({
    record,
    modifiers,
    rating,
  })
  const modifierSupportScore = modifiers.length
    ? clamp(50 + modifierAdjustment.boost - modifierAdjustment.penalty, 0, 100)
    : 100
  const hasEnoughBucketDna =
    preservedReferenceBucketCount >= 2 || strongBucketCount >= 2
  const modifierCap =
    modifiers.length && modifierSupportScore < 45
      ? 58
      : modifiers.length && !hasEnoughBucketDna
        ? 58
        : null
  const bucketCap =
    strongBucketCount >= 2 || preservedReferenceBucketCount >= 3
      ? null
      : preservedReferenceBucketCount >= 2
        ? modifiers.length
          ? 78
          : 82
        : preservedReferenceBucketCount === 1
          ? modifiers.length
            ? 58
            : 55
          : 45

  return {
    matchedBucketCount,
    strongBucketCount,
    bucketScore,
    bucketCoverageScore,
    modifierSupportScore,
    preservedReferenceBucketCount,
    scoreCap:
      bucketCap === null && modifierCap === null
        ? null
        : Math.min(bucketCap ?? 100, modifierCap ?? 100),
  }
}

function candidateSetHasReferenceTerm(
  normalizedReferenceTerm: string,
  candidateTerms: Set<string>,
) {
  if (candidateTerms.has(normalizedReferenceTerm)) {
    return true
  }

  for (const candidateTerm of candidateTerms) {
    if (
      candidateTerm === normalizedReferenceTerm ||
      normalizedIncludesPhrase(candidateTerm, normalizedReferenceTerm) ||
      normalizedIncludesPhrase(normalizedReferenceTerm, candidateTerm)
    ) {
      return true
    }
  }

  return false
}

function countReferenceSetOverlap(referenceTerms: string[], candidateTerms: Set<string>) {
  let overlapCount = 0

  for (const term of referenceTerms) {
    if (candidateSetHasReferenceTerm(normalizeReferenceText(term), candidateTerms)) {
      overlapCount += 1
    }
  }

  return overlapCount
}

function referenceTermsMatchCandidateSet(
  referenceTerm: string,
  candidateTerms: Set<string>,
) {
  return candidateSetHasReferenceTerm(
    normalizeReferenceText(referenceTerm),
    candidateTerms,
  )
}

function getReferenceLayerDistance(
  referenceLayer: ReferenceNoteLayer,
  candidateLayer: ReferenceNoteLayer,
) {
  if (referenceLayer === candidateLayer) {
    return 0
  }

  if (
    (referenceLayer === 'opening' && candidateLayer === 'heart') ||
    (referenceLayer === 'heart' &&
      (candidateLayer === 'opening' || candidateLayer === 'base')) ||
    (referenceLayer === 'base' && candidateLayer === 'heart')
  ) {
    return 1
  }

  return 2
}

function getLayerPositionWeight(
  referenceLayer: ReferenceNoteLayer,
  candidateLayer: ReferenceNoteLayer,
  matchType: 'exact' | 'family',
) {
  const distance = getReferenceLayerDistance(referenceLayer, candidateLayer)

  if (matchType === 'exact') {
    return distance === 0 ? 1 : distance === 1 ? 0.7 : 0.45
  }

  return distance === 0 ? 0.55 : distance === 1 ? 0.35 : 0.2
}

function isReferenceNoteLayer(
  layer: ReferenceBucket['key'],
): layer is ReferenceNoteLayer {
  return layer === 'opening' || layer === 'heart' || layer === 'base'
}

function getReferenceNoteLayerCandidateSets(
  profile: CachedFragranceProfile,
): Record<ReferenceNoteLayer, { exactTerms: Set<string>; familyTerms: Set<string> }> {
  return {
    opening: {
      exactTerms: profile.normalizedTopNotesSet.size
        ? profile.normalizedTopNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.topFamiliesSet.size
        ? profile.topFamiliesSet
        : profile.allNoteFamiliesSet,
    },
    heart: {
      exactTerms: profile.normalizedMiddleNotesSet.size
        ? profile.normalizedMiddleNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.middleFamiliesSet.size
        ? profile.middleFamiliesSet
        : profile.allNoteFamiliesSet,
    },
    base: {
      exactTerms: profile.normalizedBaseNotesSet.size
        ? profile.normalizedBaseNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.baseFamiliesSet.size
        ? profile.baseFamiliesSet
        : profile.allNoteFamiliesSet,
    },
  }
}

function getWeightedReferenceLayerOverlap(params: {
  referenceTerms: string[]
  referenceLayer: ReferenceNoteLayer
  candidateLayerSets: Record<
    ReferenceNoteLayer,
    { exactTerms: Set<string>; familyTerms: Set<string> }
  >
  matchType: 'exact' | 'family'
}) {
  const {
    referenceTerms,
    referenceLayer,
    candidateLayerSets,
    matchType,
  } = params
  let weightedMatchCount = 0
  let sameLayerMatchCount = 0
  let matchedTermCount = 0

  for (const term of referenceTerms) {
    let bestWeight = 0
    let hasSameLayerMatch = false

    for (const candidateLayer of REFERENCE_NOTE_LAYERS) {
      const candidateTerms =
        matchType === 'exact'
          ? candidateLayerSets[candidateLayer].exactTerms
          : candidateLayerSets[candidateLayer].familyTerms

      if (referenceTermsMatchCandidateSet(term, candidateTerms)) {
        const weight = getLayerPositionWeight(referenceLayer, candidateLayer, matchType)
        bestWeight = Math.max(bestWeight, weight)
        hasSameLayerMatch = hasSameLayerMatch || candidateLayer === referenceLayer
      }
    }

    if (bestWeight > 0) {
      matchedTermCount += 1
      weightedMatchCount += bestWeight
    }

    if (hasSameLayerMatch) {
      sameLayerMatchCount += 1
    }
  }

  return {
    weightedMatchCount,
    sameLayerMatchCount,
    matchedTermCount,
    weightedCoverage: referenceTerms.length
      ? weightedMatchCount / referenceTerms.length
      : 0,
  }
}

function getReferenceLayerCandidateSets(
  profile: CachedFragranceProfile,
  layer: ReferenceBucket['key'],
) {
  if (layer === 'opening') {
    return {
      exactTerms: profile.normalizedTopNotesSet.size
        ? profile.normalizedTopNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.topFamiliesSet.size
        ? profile.topFamiliesSet
        : profile.allNoteFamiliesSet,
    }
  }

  if (layer === 'heart') {
    return {
      exactTerms: profile.normalizedMiddleNotesSet.size
        ? profile.normalizedMiddleNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.middleFamiliesSet.size
        ? profile.middleFamiliesSet
        : profile.allNoteFamiliesSet,
    }
  }

  if (layer === 'base') {
    return {
      exactTerms: profile.normalizedBaseNotesSet.size
        ? profile.normalizedBaseNotesSet
        : profile.normalizedAllNotesSet,
      familyTerms: profile.baseFamiliesSet.size
        ? profile.baseFamiliesSet
        : profile.allNoteFamiliesSet,
    }
  }

  return {
    exactTerms: new Set([
      ...profile.classificationTerms,
      ...profile.classificationFamiliesSet,
    ]),
    familyTerms: profile.overallProfileFamiliesSet,
  }
}

function scoreLayeredReferenceBucket(
  bucket: ReferenceBucket | undefined,
  candidateProfile: CachedFragranceProfile,
) {
  if (!bucket || !bucket.terms.length) {
    return {
      score: 0,
      exactMatchCount: 0,
      familyMatchCount: 0,
      sameLayerExactMatchCount: 0,
      sameLayerFamilyMatchCount: 0,
      isMatched: false,
      isStrong: false,
    }
  }

  const isNoteLayer = isReferenceNoteLayer(bucket.key)
  const candidateSets = getReferenceLayerCandidateSets(candidateProfile, bucket.key)
  const candidateLayerSets = getReferenceNoteLayerCandidateSets(candidateProfile)
  let exactLayerOverlap: ReturnType<typeof getWeightedReferenceLayerOverlap> | null = null
  let familyLayerOverlap: ReturnType<typeof getWeightedReferenceLayerOverlap> | null = null

  if (isReferenceNoteLayer(bucket.key)) {
    exactLayerOverlap = getWeightedReferenceLayerOverlap({
        referenceTerms: bucket.exactTerms,
        referenceLayer: bucket.key,
        candidateLayerSets,
        matchType: 'exact',
      })
    familyLayerOverlap = getWeightedReferenceLayerOverlap({
        referenceTerms: bucket.familyTerms,
        referenceLayer: bucket.key,
        candidateLayerSets,
        matchType: 'family',
      })
  }
  const exactMatchCount = exactLayerOverlap
    ? exactLayerOverlap.matchedTermCount
    : countReferenceSetOverlap(bucket.exactTerms, candidateSets.exactTerms)
  const familyMatchCount = familyLayerOverlap
    ? familyLayerOverlap.matchedTermCount
    : countReferenceSetOverlap(bucket.familyTerms, candidateSets.familyTerms)
  const sameLayerExactMatchCount = exactLayerOverlap?.sameLayerMatchCount ?? exactMatchCount
  const sameLayerFamilyMatchCount = familyLayerOverlap?.sameLayerMatchCount ?? familyMatchCount
  const exactCoverage = exactLayerOverlap
    ? exactLayerOverlap.weightedCoverage
    : bucket.exactTerms.length
      ? exactMatchCount / bucket.exactTerms.length
      : 0
  const familyCoverage = familyLayerOverlap
    ? familyLayerOverlap.weightedCoverage
    : bucket.familyTerms.length
      ? familyMatchCount / bucket.familyTerms.length
      : 0
  const score = isNoteLayer
    ? clamp(
        exactCoverage * 72 +
          familyCoverage * 24 +
          Math.min(10, sameLayerExactMatchCount * 3 + exactMatchCount) +
          Math.min(6, sameLayerFamilyMatchCount + familyMatchCount * 0.5),
        0,
        100,
      )
    : clamp(exactCoverage * 58 + familyCoverage * 38, 0, 100)

  return {
    score,
    exactMatchCount,
    familyMatchCount,
    sameLayerExactMatchCount,
    sameLayerFamilyMatchCount,
    isMatched: isNoteLayer
      ? sameLayerExactMatchCount >= 1 ||
        exactCoverage >= 0.45 ||
        sameLayerFamilyMatchCount >= 2 ||
        (familyCoverage >= 0.45 && exactMatchCount >= 1)
      : score >= 28,
    isStrong: isNoteLayer
      ? sameLayerExactMatchCount >= 2 ||
        (sameLayerExactMatchCount >= 1 && sameLayerFamilyMatchCount >= 2) ||
        (exactCoverage >= 0.7 && familyCoverage >= 0.35) ||
        score >= 62
      : score >= 56,
  }
}

function calculateLayeredReferenceSimilarity(params: {
  record: RecommendableFragrance
  referenceProfile: ReferenceProfile
}) : LayeredReferenceSimilarity {
  const { record, referenceProfile } = params
  const candidateProfile = getFragranceProfile(record)
  const openingBucket = referenceProfile.buckets.find((bucket) => bucket.key === 'opening')
  const heartBucket = referenceProfile.buckets.find((bucket) => bucket.key === 'heart')
  const baseBucket = referenceProfile.buckets.find((bucket) => bucket.key === 'base')
  const profileBucket = referenceProfile.buckets.find((bucket) => bucket.key === 'profile')
  const openingScore = scoreLayeredReferenceBucket(openingBucket, candidateProfile)
  const heartScore = scoreLayeredReferenceBucket(heartBucket, candidateProfile)
  const baseScore = scoreLayeredReferenceBucket(baseBucket, candidateProfile)
  const profileScore = scoreLayeredReferenceBucket(profileBucket, candidateProfile)
  const allExactOverlap = countReferenceSetOverlap(
    referenceProfile.exactNotes,
    candidateProfile.normalizedAllNotesSet,
  )
  const allFamilyOverlap = countReferenceSetOverlap(
    referenceProfile.noteFamilyTerms,
    candidateProfile.referenceAllTermsSet,
  )
  const allNotesDnaScore = clamp(
    (referenceProfile.exactNotes.length
      ? (allExactOverlap / referenceProfile.exactNotes.length) * 74
      : 0) + Math.min(26, allFamilyOverlap * 2),
    0,
    100,
  )
  const layeredScore = clamp(
    baseScore.score * 0.4 +
      heartScore.score * 0.35 +
      openingScore.score * 0.15 +
      profileScore.score * 0.1 +
      allNotesDnaScore * 0.08,
    0,
    100,
  )
  const meaningfulLayerCount = [openingScore, heartScore, baseScore, profileScore].filter(
    (score) => score.isMatched,
  ).length
  const strongLayerCount = [openingScore, heartScore, baseScore, profileScore].filter(
    (score) => score.isStrong,
  ).length
  const exactSharedHeartBaseCount =
    heartScore.exactMatchCount + baseScore.exactMatchCount
  const heartBaseMatchedCount = [heartScore, baseScore].filter(
    (score) => score.isMatched,
  ).length
  const sameLayerHeartBaseExactCount =
    heartScore.sameLayerExactMatchCount + baseScore.sameLayerExactMatchCount
  const sameLayerHeartBaseFamilyCount =
    heartScore.sameLayerFamilyMatchCount + baseScore.sameLayerFamilyMatchCount
  const hasMeaningfulHeartBaseIdentity =
    heartBaseMatchedCount === 2 ||
    sameLayerHeartBaseExactCount >= 2 ||
    (sameLayerHeartBaseExactCount >= 1 && sameLayerHeartBaseFamilyCount >= 2)
  const hasHighMatchHeartBaseIdentity =
    (heartScore.isMatched &&
      baseScore.isMatched &&
      (sameLayerHeartBaseExactCount >= 6 || exactSharedHeartBaseCount >= 6)) ||
    sameLayerHeartBaseExactCount >= 6
  const hasStrongThreeLayerStructure =
    openingScore.isMatched &&
    heartScore.isMatched &&
    baseScore.isMatched &&
    (strongLayerCount >= 2 || exactSharedHeartBaseCount >= 2)
  const hasStrongBaseProfileIdentity =
    baseScore.isStrong &&
    profileScore.isMatched &&
    (baseScore.sameLayerExactMatchCount >= 1 ||
      baseScore.sameLayerFamilyMatchCount >= 2)
  const preservesReferenceIdentity =
    hasMeaningfulHeartBaseIdentity ||
    hasStrongThreeLayerStructure ||
    hasStrongBaseProfileIdentity
  const topOnlyCap =
    openingScore.isMatched &&
    heartBaseMatchedCount === 0 &&
    !profileScore.isMatched
      ? 54
      : null
  const weakHeartBaseCap =
    meaningfulLayerCount < 2 || heartBaseMatchedCount === 0
      ? 62
      : heartBaseMatchedCount === 1 && strongLayerCount < 2
        ? 82
        : null
  const identityCap = preservesReferenceIdentity
    ? null
    : profileScore.isMatched && meaningfulLayerCount >= 2
      ? 84
      : meaningfulLayerCount >= 2
        ? 78
        : null
  const highMatchIdentityCap = hasHighMatchHeartBaseIdentity ? null : 88

  return {
    layeredScore,
    meaningfulLayerCount,
    strongLayerCount,
    exactSharedNoteCount: allExactOverlap,
    exactSharedHeartBaseCount,
    sameLayerHeartBaseExactCount,
    sameLayerHeartBaseFamilyCount,
    allNotesDnaScore,
    scoreCap:
      topOnlyCap === null &&
      weakHeartBaseCap === null &&
      identityCap === null &&
      highMatchIdentityCap === null
        ? null
        : Math.min(
            topOnlyCap ?? 100,
            weakHeartBaseCap ?? 100,
            identityCap ?? 100,
            highMatchIdentityCap ?? 100,
          ),
  }
}

function getReferenceBucketByLayer(
  referenceProfile: ReferenceProfile,
  layer: ReferenceNoteLayer,
) {
  return referenceProfile.buckets.find((bucket) => bucket.key === layer)
}

function getLayerTermSets(profile: CachedFragranceProfile, layer: ReferenceNoteLayer) {
  const layerSets = getReferenceNoteLayerCandidateSets(profile)

  return layerSets[layer]
}

function collectReferenceLayerMatches(params: {
  referenceProfile: ReferenceProfile
  candidateProfile: CachedFragranceProfile
}) {
  const { referenceProfile, candidateProfile } = params
  const sameLayerMatches = new Set<string>()
  const nearLayerMatches = new Set<string>()
  const farLayerMatches = new Set<string>()

  for (const referenceLayer of REFERENCE_NOTE_LAYERS) {
    const bucket = getReferenceBucketByLayer(referenceProfile, referenceLayer)

    if (!bucket) {
      continue
    }

    for (const term of bucket.exactTerms) {
      for (const candidateLayer of REFERENCE_NOTE_LAYERS) {
        const candidateSets = getLayerTermSets(candidateProfile, candidateLayer)

        if (!referenceTermsMatchCandidateSet(term, candidateSets.exactTerms)) {
          continue
        }

        const distance = getReferenceLayerDistance(referenceLayer, candidateLayer)

        if (distance === 0) {
          sameLayerMatches.add(term)
        } else if (distance === 1) {
          nearLayerMatches.add(term)
        } else {
          farLayerMatches.add(term)
        }
      }
    }
  }

  return {
    sameLayerMatches: Array.from(sameLayerMatches),
    nearLayerMatches: Array.from(nearLayerMatches),
    farLayerMatches: Array.from(farLayerMatches),
  }
}

function getReferenceNoteCombos(referenceProfile: ReferenceProfile) {
  const cachedCombos = referenceNoteCombosCache.get(referenceProfile)

  if (cachedCombos) {
    return cachedCombos
  }

  const combos: string[][] = []

  for (const bucket of referenceProfile.buckets) {
    if (!isReferenceNoteLayer(bucket.key)) {
      continue
    }

    const terms = bucket.exactTerms.slice(0, 5)

    for (let first = 0; first < terms.length; first += 1) {
      for (let second = first + 1; second < terms.length; second += 1) {
        combos.push([terms[first], terms[second]])
      }
    }
  }

  const opening = getReferenceBucketByLayer(referenceProfile, 'opening')?.exactTerms ?? []
  const heart = getReferenceBucketByLayer(referenceProfile, 'heart')?.exactTerms ?? []
  const base = getReferenceBucketByLayer(referenceProfile, 'base')?.exactTerms ?? []

  for (const topTerm of opening.slice(0, 3)) {
    for (const heartTerm of heart.slice(0, 3)) {
      for (const baseTerm of base.slice(0, 3)) {
        combos.push([topTerm, heartTerm, baseTerm])
      }
    }
  }

  for (const heartTerm of heart.slice(0, 4)) {
    for (const baseTerm of base.slice(0, 4)) {
      combos.push([heartTerm, baseTerm])
    }
  }

  referenceNoteCombosCache.set(referenceProfile, combos)

  return combos
}

function getAccordComboMatches(params: {
  referenceProfile: ReferenceProfile
  candidateProfile: CachedFragranceProfile
}) {
  const { referenceProfile, candidateProfile } = params
  const candidateTerms = candidateProfile.referenceAllTermsSet

  const matches: string[] = []

  for (const combo of getReferenceNoteCombos(referenceProfile)) {
    if (!combo.every((term) => referenceTermsMatchCandidateSet(term, candidateTerms))) {
      continue
    }

    matches.push(combo.join(' + '))

    if (matches.length >= 12) {
      break
    }
  }

  return matches
}

function getReferenceDirectionScore(
  profile: CachedFragranceProfile,
  terms: string[],
) {
  const profileTerms = new Set([
    ...profile.normalizedAllNotesSet,
    ...profile.allNoteFamiliesSet,
    ...profile.classificationTerms,
    ...profile.classificationFamiliesSet,
    ...profile.overallProfileFamiliesSet,
  ])

  let score = 0

  for (const term of terms) {
    if (referenceTermsMatchCandidateSet(term, profileTerms)) {
      score += 1
    }
  }

  return score
}

const REFERENCE_DIRECTION_TERMS: Array<[string, string[]]> = [
  ['fresh', ['fresh', 'citrus', 'aquatic', 'green', 'aromatic']],
  ['sweet', ['sweet', 'vanilla', 'gourmand', 'caramel', 'honey', 'fruity']],
  ['woody', ['woody', 'cedar', 'sandalwood', 'vetiver', 'patchouli']],
  ['resinous', ['resinous', 'resin', 'incense', 'olibanum', 'myrrh', 'amber']],
  ['smoky', ['smoky', 'smoke', 'incense', 'birch']],
  ['floral', ['floral', 'rose', 'jasmine', 'iris', 'violet']],
  ['clean', ['clean', 'musk', 'white musk', 'soapy', 'aldehydic']],
  ['dark', ['dark', 'oud', 'leather', 'tobacco', 'smoky']],
  ['spicy', ['spicy', 'pepper', 'cardamom', 'saffron', 'cinnamon']],
]

function getReferenceDifferenceDirections(params: {
  referenceProfileData: CachedFragranceProfile
  candidateProfile: CachedFragranceProfile
}) {
  const { referenceProfileData, candidateProfile } = params
  const directions: string[] = []

  for (const [direction, terms] of REFERENCE_DIRECTION_TERMS) {
    const referenceScore = getReferenceDirectionScore(referenceProfileData, terms)
    const candidateScore = getReferenceDirectionScore(candidateProfile, terms)

    if (candidateScore >= referenceScore + 2) {
      directions.push(`more ${direction}`)
    } else if (referenceScore >= candidateScore + 2) {
      directions.push(`less ${direction}`)
    }
  }

  return directions
}

function getReferenceSimilarityAngles(params: {
  layeredSimilarity: LayeredReferenceSimilarity
  modifierScore: number
  modifiers: ReferenceModifier[]
  sameLayerMatches: string[]
  nearLayerMatches: string[]
  differenceDirections: string[]
}) {
  const {
    layeredSimilarity,
    modifierScore,
    modifiers,
    sameLayerMatches,
    nearLayerMatches,
    differenceDirections,
  } = params
  const angles: string[] = []

  if (layeredSimilarity.strongLayerCount >= 2 || layeredSimilarity.meaningfulLayerCount >= 3) {
    angles.push('closest overall')
  }

  if (sameLayerMatches.length >= 1 || nearLayerMatches.length >= 2) {
    if (layeredSimilarity.sameLayerHeartBaseExactCount > 0) {
      angles.push('same drydown')
      angles.push('same heart')
    } else {
      angles.push('same opening')
    }
  }

  if (modifierScore >= 62) {
    for (const modifier of modifiers) {
      if (modifier.key === 'fresher') angles.push('fresher direction')
      if (modifier.key === 'sweeter') angles.push('sweeter direction')
      if (modifier.key === 'less-sweet') angles.push('cleaner direction')
      if (modifier.key === 'woody') angles.push('woodier direction')
      if (modifier.key === 'winter') angles.push('warmer direction')
    }
  }

  for (const direction of differenceDirections) {
    if (direction === 'more fresh') angles.push('fresher direction')
    if (direction === 'more sweet') angles.push('sweeter direction')
    if (direction === 'more dark') angles.push('darker direction')
    if (direction === 'more clean') angles.push('cleaner direction')
    if (direction === 'more woody') angles.push('woodier direction')
    if (direction === 'more spicy') angles.push('spicier direction')
    if (direction === 'more resinous') angles.push('more resinous direction')
  }

  const uniqueAngles = Array.from(new Set(angles))

  return {
    similarityAngle: uniqueAngles[0] ?? null,
    secondarySimilarityAngles: uniqueAngles.slice(1, 4),
  }
}

function getReferenceScoringComponents(params: {
  exactNoteScore: number
  noteFamilyScore: number
  classificationScore: number
  flavorOrVibeScore: number
  bucketSimilarity: ReferenceBucketSimilarity
  layeredSimilarity: LayeredReferenceSimilarity
  modifierScore: number
  conflictScore: number
  hasModifiers: boolean
  accordPairMatches: string[]
  distinctiveNoteMatches: string[]
}) : ReferenceScoringComponents {
  const {
    exactNoteScore,
    noteFamilyScore,
    classificationScore,
    flavorOrVibeScore,
    bucketSimilarity,
    layeredSimilarity,
    modifierScore,
    conflictScore,
    hasModifiers,
    accordPairMatches,
    distinctiveNoteMatches,
  } = params
  const accordPairScore = clamp(accordPairMatches.length * 8, 0, 24)
  const distinctiveNoteScore = clamp(distinctiveNoteMatches.length * 9, 0, 27)
  const referenceLayerFit = layeredSimilarity.layeredScore
  const referenceFamilyFit = clamp(
    noteFamilyScore * 0.52 +
      Math.max(classificationScore, flavorOrVibeScore) * 0.34 +
      bucketSimilarity.bucketScore * 0.14,
    0,
    100,
  )
  const referenceDNAFit = clamp(
    referenceLayerFit * 0.5 +
      bucketSimilarity.bucketScore * 0.22 +
      layeredSimilarity.allNotesDnaScore * 0.16 +
      exactNoteScore * 0.08 +
      referenceFamilyFit * 0.04 +
      accordPairScore * 0.08 +
      distinctiveNoteScore * 0.1,
    0,
    100,
  )
  const conflictAvoidance = clamp(100 - conflictScore * 2.1, 0, 100)
  const differenceControl = hasModifiers
    ? clamp(
        referenceDNAFit * 0.62 +
          modifierScore * 0.28 +
          conflictAvoidance * 0.1,
        0,
        100,
      )
    : referenceDNAFit
  const weakDnaCap =
    referenceDNAFit < 38
      ? 58
      : referenceDNAFit < 48
        ? 68
        : referenceDNAFit < 58
          ? hasModifiers
            ? 78
            : 82
          : null
  const modifierDominanceCap =
    hasModifiers && modifierScore >= 72 && referenceDNAFit < 62 ? 84 : null
  const broadOnlyCap =
    layeredSimilarity.exactSharedNoteCount === 0 &&
    layeredSimilarity.sameLayerHeartBaseExactCount === 0 &&
    layeredSimilarity.strongLayerCount < 2 &&
    referenceFamilyFit >= referenceDNAFit
      ? 80
      : null
  const weakHeartBaseCap =
    layeredSimilarity.exactSharedHeartBaseCount === 0 &&
    layeredSimilarity.sameLayerHeartBaseFamilyCount < 2 &&
    layeredSimilarity.strongLayerCount < 2
      ? hasModifiers
        ? 84
        : 86
      : null
  let strongestCap: { value: number; reason: string } | null = null

  for (const capEntry of [
    weakDnaCap === null ? null : { value: weakDnaCap, reason: 'weak reference DNA' },
    modifierDominanceCap === null
      ? null
      : { value: modifierDominanceCap, reason: 'modifier stronger than reference DNA' },
    broadOnlyCap === null
      ? null
      : { value: broadOnlyCap, reason: 'broad family-only reference support' },
    weakHeartBaseCap === null
      ? null
      : { value: weakHeartBaseCap, reason: 'missing middle/base reference DNA' },
  ]) {
    if (!capEntry) {
      continue
    }

    if (!strongestCap || capEntry.value < strongestCap.value) {
      strongestCap = capEntry
    }
  }

  return {
    referenceDNAFit,
    referenceLayerFit,
    referenceFamilyFit,
    modifierFit: modifierScore,
    conflictAvoidance,
    differenceControl,
    accordPairScore,
    distinctiveNoteScore,
    scoreCap:
      strongestCap?.value ?? null,
    capReason: strongestCap?.reason ?? null,
  }
}

function getCachedReferenceProfileData(referenceProfile: ReferenceProfile) {
  const cachedProfileData = referenceProfileDataCache.get(referenceProfile)

  if (cachedProfileData) {
    return cachedProfileData
  }

  const referenceProfileTerms = [
    ...referenceProfile.exactNotes,
    ...referenceProfile.noteFamilyTerms,
    ...referenceProfile.classificationTerms,
    ...referenceProfile.vibeTerms,
  ]
  const profileData: CachedFragranceProfile = {
    normalizedTopNotesSet: new Set<string>(),
    normalizedMiddleNotesSet: new Set<string>(),
    normalizedBaseNotesSet: new Set<string>(),
    normalizedAllNotesSet: new Set(referenceProfile.exactNotes),
    computedAccordsSet: new Set<string>(),
    topFamiliesSet: new Set<string>(),
    middleFamiliesSet: new Set<string>(),
    baseFamiliesSet: new Set<string>(),
    allNoteFamiliesSet: new Set(referenceProfile.noteFamilyTerms),
    classificationFamiliesSet: new Set<string>(),
    overallProfileFamiliesSet: new Set([
      ...referenceProfile.noteFamilyTerms,
      ...referenceProfile.classificationTerms,
      ...referenceProfile.vibeTerms,
    ]),
    classificationTerms: referenceProfile.classificationTerms,
    referenceNoteTerms: referenceProfile.exactNotes,
    referenceProfileTerms,
    paddedReferenceNoteTerms: referenceProfile.exactNotes.map(padNormalizedPhrase),
    paddedReferenceProfileTerms: referenceProfileTerms.map(padNormalizedPhrase),
    referenceAllTermsSet: new Set(referenceProfileTerms),
  }

  referenceProfileDataCache.set(referenceProfile, profileData)

  return profileData
}

function scoreReferenceSimilarity(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  referenceProfile: ReferenceProfile
  referenceRating: RatingRecord | undefined
  modifiers: ReferenceModifier[]
}): ScentRelevanceLayer {
  const {
    record,
    rating,
    referenceProfile,
    referenceRating,
    modifiers,
  } = params
  const candidateProfile = getFragranceProfile(record)
  const candidateProfileMatchesTerm = (term: string) =>
    precomputedTermsMatchTerm(
      term,
      candidateProfile.referenceProfileTerms,
      candidateProfile.paddedReferenceProfileTerms,
    )
  const candidateNoteMatchesTerm = (term: string) =>
    precomputedTermsMatchTerm(
      term,
      candidateProfile.referenceNoteTerms,
      candidateProfile.paddedReferenceNoteTerms,
    )
  const candidateNotes = getRecordAllNotes(record).map(normalizeReferenceText)
  const sharedExactNotes: string[] = []

  for (const note of candidateNotes) {
    if (referenceProfile.exactNoteSet.has(note)) {
      sharedExactNotes.push(note)
    }
  }

  const exactSharedNoteCount = sharedExactNotes.length
  const hasOnlyCommonOneNoteOverlap =
    sharedExactNotes.length === 1 && COMMON_REFERENCE_NOTES.has(sharedExactNotes[0])
  const exactNoteCoverage =
    referenceProfile.exactNotes.length > 0
      ? exactSharedNoteCount / referenceProfile.exactNotes.length
      : 0
  const exactNoteScore = clamp(
    exactSharedNoteCount * 12 + exactNoteCoverage * 32,
    0,
    100,
  )
  const sharedReferenceFamilies: string[] = []

  for (const term of referenceProfile.noteFamilyTerms) {
    if (candidateNoteMatchesTerm(term)) {
      sharedReferenceFamilies.push(term)
    }
  }

  const familyMatchCount = sharedReferenceFamilies.length
  const noteFamilyScore = clamp(familyMatchCount * 5, 0, 100)
  const classificationMatchCount = referenceProfile.classificationTerms.filter(
    (term) => recordClassificationMatchesTerm(record, term),
  ).length
  const classificationScore = clamp(classificationMatchCount * 28, 0, 100)
  const vibeMatchCount = referenceProfile.vibeTerms.filter((vibe) =>
    [vibe, ...getExpandedVibeTerms(vibe)].some((term) =>
      candidateProfileMatchesTerm(term),
    ),
  ).length
  const flavorOrVibeScore = clamp(vibeMatchCount * 10, 0, 100)
  const referenceSummerShare = parseNullableNumber(
    referenceRating?.summerShare ?? null,
  )
  const candidateSummerShare = parseNullableNumber(rating?.summerShare ?? null)
  const referenceWinterShare = parseNullableNumber(
    referenceRating?.winterShare ?? null,
  )
  const candidateWinterShare = parseNullableNumber(rating?.winterShare ?? null)
  const seasonScore = Math.max(
    referenceSummerShare !== null && candidateSummerShare !== null
      ? (1 - Math.abs(referenceSummerShare - candidateSummerShare)) * 100
      : 0,
    referenceWinterShare !== null && candidateWinterShare !== null
      ? (1 - Math.abs(referenceWinterShare - candidateWinterShare)) * 100
      : 0,
  )
  const referenceDayShare = parseNullableNumber(referenceRating?.dayShare ?? null)
  const candidateDayShare = parseNullableNumber(rating?.dayShare ?? null)
  const timeOfDayScore =
    referenceDayShare !== null && candidateDayShare !== null
      ? (1 - Math.abs(referenceDayShare - candidateDayShare)) * 100
      : 0
  const modifierAdjustment = getReferenceModifierAdjustment({
    record,
    modifiers,
    rating,
  })
  const conflictScore = getReferenceConflictScore({
    record,
    referenceProfile,
    rating,
    referenceRating,
  })
  const bucketSimilarity = getReferenceBucketSimilarity({
    record,
    rating,
    referenceProfile,
    modifiers,
  })
  const layeredSimilarity = calculateLayeredReferenceSimilarity({
    record,
    referenceProfile,
  })
  const referenceProfileData = getCachedReferenceProfileData(referenceProfile)
  const referenceLayerMatches = collectReferenceLayerMatches({
    referenceProfile,
    candidateProfile,
  })
  const accordPairMatches = getAccordComboMatches({
    referenceProfile,
    candidateProfile,
  })
  const sharedReferenceNotes = sharedExactNotes
  const sharedReferenceNoteSet = new Set(sharedReferenceNotes)
  const missingReferenceNotes = referenceProfile.exactNotes.filter(
    (note) => !sharedReferenceNoteSet.has(note),
  )
  const distinctiveNoteMatches = sharedReferenceNotes.filter(
    (note) => !COMMON_REFERENCE_NOTES.has(note),
  )
  const differenceDirections = getReferenceDifferenceDirections({
    referenceProfileData,
    candidateProfile,
  })
  const referenceGate = getReferenceGate({
    exactSharedNoteCount,
    exactNoteCoverage,
    familyMatchCount,
    classificationMatchCount,
    vibeMatchCount,
    preservedReferenceBucketCount:
      bucketSimilarity.preservedReferenceBucketCount,
    strongBucketCount: bucketSimilarity.strongBucketCount,
    conflictScore,
    hasModifiers: modifiers.length > 0,
  })
  const modifierScore = bucketSimilarity.modifierSupportScore
  const similarityAngles = getReferenceSimilarityAngles({
    layeredSimilarity,
    modifierScore,
    modifiers,
    sameLayerMatches: referenceLayerMatches.sameLayerMatches,
    nearLayerMatches: referenceLayerMatches.nearLayerMatches,
    differenceDirections,
  })
  const referenceComponents = getReferenceScoringComponents({
    exactNoteScore,
    noteFamilyScore,
    classificationScore,
    flavorOrVibeScore,
    bucketSimilarity,
    layeredSimilarity,
    modifierScore,
    conflictScore,
    hasModifiers: modifiers.length > 0,
    accordPairMatches,
    distinctiveNoteMatches,
  })
  const structuredReferenceScore = modifiers.length
    ? clamp(
        referenceComponents.referenceDNAFit * 0.55 +
          referenceComponents.modifierFit * 0.3 +
          referenceComponents.differenceControl * 0.08 +
          referenceComponents.conflictAvoidance * 0.07,
        0,
        100,
      )
    : clamp(
        referenceComponents.referenceDNAFit * 0.72 +
          referenceComponents.referenceFamilyFit * 0.14 +
          referenceComponents.conflictAvoidance * 0.1 +
          bucketSimilarity.bucketCoverageScore * 0.04,
        0,
        100,
      )
  const uncappedProfileScore = clamp(
    Math.max(classificationScore, flavorOrVibeScore) * 0.72 +
      seasonScore * 0.08 +
      timeOfDayScore * 0.06 +
      bucketSimilarity.bucketScore * 0.12 +
      layeredSimilarity.layeredScore * 0.18 +
      (modifiers.length ? modifierScore * 0.12 : 0),
    0,
    100,
  )
  const uncappedScentRelevanceScore = clamp(
    exactNoteScore * 0.16 +
      noteFamilyScore * 0.1 +
      Math.max(classificationScore, flavorOrVibeScore) * 0.1 +
      bucketSimilarity.bucketScore * 0.14 +
      layeredSimilarity.layeredScore * 0.42 +
      layeredSimilarity.allNotesDnaScore * 0.08 +
      bucketSimilarity.bucketCoverageScore * 0.05 +
      seasonScore * 0.04 +
      timeOfDayScore * 0.03 +
      (modifiers.length
        ? modifierAdjustment.boost * 0.14 - modifierAdjustment.penalty * 0.28
        : 0),
    0,
    100,
  )
  const blendedScentRelevanceScore = clamp(
    uncappedScentRelevanceScore * 0.42 + structuredReferenceScore * 0.58,
    0,
    100,
  )
  const referenceScoreCap =
    referenceGate.scoreCap === null && bucketSimilarity.scoreCap === null
      ? null
      : Math.min(referenceGate.scoreCap ?? 100, bucketSimilarity.scoreCap ?? 100)
  const layeredScoreCap =
    referenceScoreCap === null && layeredSimilarity.scoreCap === null
      ? null
      : Math.min(referenceScoreCap ?? 100, layeredSimilarity.scoreCap ?? 100)
  const oneNoteScoreCap =
    hasOnlyCommonOneNoteOverlap &&
    layeredSimilarity.meaningfulLayerCount < 2 &&
    classificationMatchCount === 0
      ? 54
      : null
  const componentScoreCap = referenceComponents.scoreCap
  const finalReferenceScoreCap =
    layeredScoreCap === null && oneNoteScoreCap === null && componentScoreCap === null
      ? null
      : Math.min(
          layeredScoreCap ?? 100,
          oneNoteScoreCap ?? 100,
          componentScoreCap ?? 100,
        )
  const conflictAdjustedScentRelevanceScore = clamp(
    blendedScentRelevanceScore - conflictScore,
    0,
    finalReferenceScoreCap ?? 100,
  )
  const profileScore = clamp(
    uncappedProfileScore - conflictScore * 0.5,
    0,
    finalReferenceScoreCap ?? 100,
  )
  const scentRelevanceScore = conflictAdjustedScentRelevanceScore
  const compatibilityLevel: ProfileCompatibilityLevel =
    !referenceGate.passesSimilarityGate ||
    layeredSimilarity.meaningfulLayerCount === 0
      ? 'unrelated'
      : conflictScore >= 30
        ? 'conflicting'
        : scentRelevanceScore >= 72 &&
            (layeredSimilarity.strongLayerCount >= 2 ||
              layeredSimilarity.meaningfulLayerCount >= 3)
          ? 'strong'
          : scentRelevanceScore >= 55 &&
              layeredSimilarity.meaningfulLayerCount >= 2
            ? 'moderate'
            : 'weak'

  return {
    noteRelevanceScore: (exactNoteScore / 100) * MAX_RAW_SCORE,
    noteFamilyScore,
    layerAwareScore: layeredSimilarity.layeredScore,
    flavorOrVibeScore,
    classificationScore,
    seasonScore,
    timeOfDayScore,
    occasionScore: modifiers.length ? modifierScore : 0,
    combinedIntentScore: modifiers.length ? modifierScore : 0,
    profileScore,
    scentRelevanceScore,
    compatibilityLevel,
    compatibilityScore: scentRelevanceScore,
    conflictScore,
    scoreCap: finalReferenceScoreCap,
    referenceBucketCoverageScore: Math.max(
      bucketSimilarity.bucketCoverageScore,
      layeredSimilarity.meaningfulLayerCount * 25,
    ),
    referencePreservedBucketCount:
      layeredSimilarity.meaningfulLayerCount,
    referenceStrongBucketCount: layeredSimilarity.strongLayerCount,
    referenceModifierSupportScore: bucketSimilarity.modifierSupportScore,
    referenceDNAFit: referenceComponents.referenceDNAFit,
    referenceLayerFit: referenceComponents.referenceLayerFit,
    referenceFamilyFit: referenceComponents.referenceFamilyFit,
    referenceConflictAvoidance: referenceComponents.conflictAvoidance,
    referenceDifferenceControl: referenceComponents.differenceControl,
    referenceDebug: {
      referenceDNAFit: Math.round(referenceComponents.referenceDNAFit),
      referenceLayerFit: Math.round(referenceComponents.referenceLayerFit),
      referenceFamilyFit: Math.round(referenceComponents.referenceFamilyFit),
      modifierFit: Math.round(referenceComponents.modifierFit),
      conflictAvoidance: Math.round(referenceComponents.conflictAvoidance),
      differenceControl: Math.round(referenceComponents.differenceControl),
      similarityAngle: similarityAngles.similarityAngle,
      secondarySimilarityAngles: similarityAngles.secondarySimilarityAngles,
      sameLayerMatches: referenceLayerMatches.sameLayerMatches,
      nearLayerMatches: referenceLayerMatches.nearLayerMatches,
      farLayerMatches: referenceLayerMatches.farLayerMatches,
      sharedReferenceNotes,
      missingReferenceNotes,
      sharedReferenceFamilies: sharedReferenceFamilies.slice(0, 20),
      accordPairMatches,
      distinctiveNoteMatches,
      differenceDirections,
      capReason: referenceComponents.capReason,
    },
  }
}

function getNoteMatchStrengthScore(strength: RequestedNoteMatchStrength) {
  if (strength === 'exact') {
    return 1
  }

  if (strength === 'strong') {
    return 0.9
  }

  if (strength === 'medium') {
    return 0.55
  }

  if (strength === 'soft') {
    return 0.35
  }

  return 0
}

function getFlavorIntentTerms(vibe: string) {
  return FLAVOR_INTENT_FAMILIES[vibe] ?? VIBE_FAMILIES[vibe] ?? []
}

function scoreFlavorIntentSupport(
  record: RecommendableFragrance,
  requestedVibes: string[],
  requestedNoteTokens: string[],
) {
  if (!requestedVibes.length) {
    return 0
  }

  const requestedNoteTermSet = new Set(
    requestedNoteTokens.flatMap((noteToken) => [
      noteToken,
      ...(NOTE_FAMILIES[noteToken]?.strong ?? []),
    ]),
  )
  const vibeScores = requestedVibes.map((vibe) => {
    const familyTerms = Array.from(new Set(getFlavorIntentTerms(vibe)))
    const independentFamilyTerms = familyTerms.filter(
      (term) => !requestedNoteTermSet.has(term),
    )
    const termsToScore = independentFamilyTerms.length
      ? independentFamilyTerms
      : familyTerms
    const noteMatchCount = termsToScore.filter((term) =>
      recordNotesMatchTerm(record, term),
    ).length
    const classificationMatchCount = termsToScore.filter((term) =>
      recordClassificationMatchesTerm(record, term),
    ).length
    const accordMatchCount = countAccordMatches(record, termsToScore)
    const searchableOnlyMatchCount = termsToScore.filter(
      (term) =>
        !recordNotesMatchTerm(record, term) &&
        !recordClassificationMatchesTerm(record, term) &&
        !recordComputedAccordsMatchTerm(record, term) &&
        recordSearchableTextMatchesTerm(record, term),
    ).length

    return clamp(
      noteMatchCount * 20 +
        accordMatchCount * 14 +
        classificationMatchCount * 16 +
        searchableOnlyMatchCount * 6,
      0,
      100,
    )
  })

  return clamp(
    vibeScores.reduce((total, score) => total + score, 0) /
      requestedVibes.length,
    0,
    100,
  )
}

function scoreCombinedIntent(params: {
  record: RecommendableFragrance
  requestedNoteTokens: string[]
  requestedVibes: string[]
}) {
  const { record, requestedNoteTokens, requestedVibes } = params

  if (!requestedNoteTokens.length || !requestedVibes.length) {
    return 0
  }

  const noteCoverageScore =
    requestedNoteTokens.reduce((total, noteToken) => {
      const strength = getRequestedNoteMatchStrength(record, noteToken, {
        allowLooseSoftSupport: requestedNoteTokens.length === 1,
        allowFamilyFallback: true,
      })

      return total + getNoteMatchStrengthScore(strength)
    }, 0) / requestedNoteTokens.length
  const flavorSupportScore =
    scoreFlavorIntentSupport(record, requestedVibes, requestedNoteTokens) / 100

  if (noteCoverageScore === 0 && flavorSupportScore === 0) {
    return 0
  }

  const synergyBonus =
    noteCoverageScore >= 0.9 && flavorSupportScore >= 0.45
      ? 12
      : noteCoverageScore >= 0.55 && flavorSupportScore >= 0.35
        ? 7
        : 0

  return clamp(
    noteCoverageScore * 62 + flavorSupportScore * 38 + synergyBonus,
    0,
    100,
  )
}

function capCombinedIntentMatchScore(params: {
  matchScore: number
  combinedIntentScore: number
  requestedNoteCount: number
  requestedVibeCount: number
  matchedRequestedNoteCount: number
}) {
  if (params.requestedNoteCount === 0 || params.requestedVibeCount === 0) {
    return params.matchScore
  }

  if (params.combinedIntentScore >= 72) {
    return params.matchScore
  }

  if (params.matchedRequestedNoteCount === 0) {
    return Math.min(params.matchScore, 62)
  }

  if (params.combinedIntentScore >= 55) {
    return Math.min(params.matchScore, 86)
  }

  if (params.combinedIntentScore >= 38) {
    return Math.min(params.matchScore, 78)
  }

  return Math.min(params.matchScore, 68)
}

function capMultiNoteMatchScore(
  matchScore: number,
  requestedNoteCount: number,
  matchedRequestedNoteCount: number,
) {
  if (requestedNoteCount < 2) {
    return matchScore
  }

  if (matchedRequestedNoteCount === requestedNoteCount) {
    return matchScore
  }

  const missingRequestedNoteCount =
    requestedNoteCount - matchedRequestedNoteCount
  const noteCoverage = matchedRequestedNoteCount / requestedNoteCount

  if (requestedNoteCount >= 3 && missingRequestedNoteCount >= 2) {
    return Math.min(matchScore, 45)
  }

  if (noteCoverage <= 0.5) {
    return Math.min(matchScore, 50)
  }

  if (missingRequestedNoteCount >= 2) {
    return Math.min(matchScore, 45)
  }

  return Math.min(matchScore, 55)
}

function capBroadContextMatchScore(params: {
  matchScore: number
  profileScore: number
  requestedNoteCount: number
  requestedVibeCount: number
  requestedOccasionCount: number
  ratingReliabilityScore: number
  qualityScore: number
  promptType: RecommendationPromptType
  hasBroadContext: boolean
}) {
  if (!params.hasBroadContext || params.requestedNoteCount > 0) {
    return params.matchScore
  }

  const isBroadProfileOnly =
    params.requestedVibeCount > 0 &&
    params.requestedOccasionCount === 0 &&
    params.promptType === 'broad_vibe'
  const hasStrongCrowdSupport =
    params.ratingReliabilityScore >= 55 || params.qualityScore >= 60
  const maxBroadScore = isBroadProfileOnly
    ? 90
    : params.promptType === 'occasion'
      ? hasStrongCrowdSupport
        ? 90
        : 88
      : params.promptType === 'season' || params.promptType === 'time_of_day'
        ? 86
        : 88

  if (params.profileScore >= 90) {
    return Math.min(params.matchScore, maxBroadScore)
  }

  if (params.profileScore >= 75) {
    return Math.min(params.matchScore, Math.min(maxBroadScore, 84))
  }

  if (params.profileScore >= 55) {
    return Math.min(params.matchScore, Math.min(maxBroadScore, 78))
  }

  if (params.profileScore >= 35) {
    return Math.min(params.matchScore, 70)
  }

  return Math.min(params.matchScore, 60)
}

function getIntentModeScoringPolicy(
  intent: RecommendationIntent,
): IntentModeScoringPolicy {
  if (intent.promptType === 'reference') {
    return {
      maxScore: 100,
      missingRequiredNoteCap: null,
      partialRequiredNoteCap: null,
    }
  }

  if (intent.promptType === 'strict_multi_note_combo') {
    return {
      maxScore: 98,
      missingRequiredNoteCap: 50,
      partialRequiredNoteCap: 72,
    }
  }

  if (intent.promptType === 'note_plus_vibe') {
    return {
      maxScore: 96,
      missingRequiredNoteCap: 62,
      partialRequiredNoteCap: 82,
    }
  }

  if (intent.promptType === 'single_note') {
    return {
      maxScore: 94,
      missingRequiredNoteCap: 64,
      partialRequiredNoteCap: 78,
    }
  }

  if (intent.promptType === 'occasion') {
    return {
      maxScore: 90,
      missingRequiredNoteCap: 62,
      partialRequiredNoteCap: 80,
    }
  }

  if (intent.promptType === 'season' || intent.promptType === 'time_of_day') {
    return {
      maxScore: 86,
      missingRequiredNoteCap: 62,
      partialRequiredNoteCap: 78,
    }
  }

  if (intent.promptType === 'broad_vibe') {
    return {
      maxScore: 88,
      missingRequiredNoteCap: null,
      partialRequiredNoteCap: null,
    }
  }

  return {
    maxScore: 90,
    missingRequiredNoteCap: 62,
    partialRequiredNoteCap: 78,
  }
}

function calculateIntentModeMatchScore(params: {
  score: number
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  requiredNoteCount: number
  matchedRequiredNoteCount: number
}) {
  const {
    score,
    intent,
    scentRelevanceLayer,
    requiredNoteCount,
    matchedRequiredNoteCount,
  } = params
  const normalizedNoteScore = normalizeMatchScore(
    scentRelevanceLayer.noteRelevanceScore,
  )
  const requiredCoverage =
    requiredNoteCount === 0
      ? 1
      : matchedRequiredNoteCount / requiredNoteCount
  const strongestNoteScore = Math.max(
    normalizedNoteScore,
    scentRelevanceLayer.noteFamilyScore,
    requiredCoverage * 100,
  )

  if (intent.promptType === 'reference') {
    const bucketCoverageScore =
      scentRelevanceLayer.referenceBucketCoverageScore ?? 0
    const preservedBucketScore = Math.min(
      100,
      (scentRelevanceLayer.referencePreservedBucketCount ?? 0) * 28,
    )
    const strongBucketScore = Math.min(
      100,
      (scentRelevanceLayer.referenceStrongBucketCount ?? 0) * 34,
    )
    const modifierSupportScore =
      scentRelevanceLayer.referenceModifierSupportScore ?? 100

    return clamp(
      scentRelevanceLayer.scentRelevanceScore * 0.34 +
        bucketCoverageScore * 0.24 +
        preservedBucketScore * 0.18 +
        strongBucketScore * 0.14 +
        scentRelevanceLayer.profileScore * 0.06 +
        modifierSupportScore * 0.04,
      0,
      100,
    )
  }

  if (intent.promptType === 'single_note') {
    return clamp(
      strongestNoteScore * 0.74 +
        scentRelevanceLayer.profileScore * 0.12 +
        score * 0.14,
      0,
      100,
    )
  }

  if (intent.promptType === 'strict_multi_note_combo') {
    return clamp(
      requiredCoverage * 100 * 0.45 +
        scentRelevanceLayer.noteFamilyScore * 0.25 +
        scentRelevanceLayer.combinedIntentScore * 0.2 +
        scentRelevanceLayer.profileScore * 0.1,
      0,
      100,
    )
  }

  if (intent.promptType === 'note_plus_vibe') {
    return clamp(
      strongestNoteScore * 0.52 +
        scentRelevanceLayer.combinedIntentScore * 0.28 +
        scentRelevanceLayer.profileScore * 0.14 +
        score * 0.06,
      0,
      100,
    )
  }

  if (intent.promptType === 'broad_vibe') {
    return clamp(
      scentRelevanceLayer.profileScore * 0.72 +
        score * 0.2 +
        scentRelevanceLayer.combinedIntentScore * 0.08,
      0,
      100,
    )
  }

  if (intent.promptType === 'occasion') {
    return clamp(
      scentRelevanceLayer.occasionScore * 0.58 +
        scentRelevanceLayer.profileScore * 0.24 +
        score * 0.18,
      0,
      100,
    )
  }

  if (intent.promptType === 'season' || intent.promptType === 'time_of_day') {
    return clamp(score * 0.7 + scentRelevanceLayer.profileScore * 0.3, 0, 100)
  }

  return score
}

function applyIntentModeScoringPolicy(params: {
  score: number
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  requiredNoteCount: number
  matchedRequiredNoteCount: number
  partiallyMatchedRequiredNoteCount: number
}) {
  const {
    score,
    intent,
    scentRelevanceLayer,
    requiredNoteCount,
    matchedRequiredNoteCount,
    partiallyMatchedRequiredNoteCount,
  } = params
  const policy = getIntentModeScoringPolicy(intent)
  const modeScore = calculateIntentModeMatchScore({
    score,
    intent,
    scentRelevanceLayer,
    requiredNoteCount,
    matchedRequiredNoteCount,
  })
  let scoreCap = policy.maxScore

  if (requiredNoteCount > 0 && matchedRequiredNoteCount < requiredNoteCount) {
    scoreCap =
      partiallyMatchedRequiredNoteCount >= requiredNoteCount
        ? Math.min(scoreCap, policy.partialRequiredNoteCap ?? scoreCap)
        : Math.min(scoreCap, policy.missingRequiredNoteCap ?? scoreCap)
  }

  if (
    intent.promptType === 'broad_vibe' &&
    scentRelevanceLayer.profileScore < 55
  ) {
    scoreCap = Math.min(scoreCap, 70)
  }

  if (
    intent.promptType === 'occasion' &&
    scentRelevanceLayer.occasionScore < 45
  ) {
    scoreCap = Math.min(scoreCap, 76)
  }

  if (intent.promptType === 'reference') {
    const preservedBucketCount =
      scentRelevanceLayer.referencePreservedBucketCount ?? 0
    const strongBucketCount = scentRelevanceLayer.referenceStrongBucketCount ?? 0
    const modifierSupportScore =
      scentRelevanceLayer.referenceModifierSupportScore ?? 100

    if (preservedBucketCount <= 0) {
      scoreCap = Math.min(scoreCap, 45)
    } else if (preservedBucketCount === 1 && strongBucketCount === 0) {
      scoreCap = Math.min(scoreCap, 55)
    } else if (preservedBucketCount < 2 && strongBucketCount < 2) {
      scoreCap = Math.min(scoreCap, 64)
    } else if (preservedBucketCount === 2 && strongBucketCount < 2) {
      scoreCap = Math.min(scoreCap, 82)
    }

    if (modifierSupportScore < 45) {
      scoreCap = Math.min(scoreCap, 58)
    }
  }

  return Math.round(clamp(modeScore, 0, scoreCap))
}

function getMatchTier(score: number): MatchTier {
  if (score >= 98) {
    return 'top'
  }

  if (score >= 92) {
    return 'high'
  }

  if (score >= 80) {
    return 'strong'
  }

  if (score >= 66) {
    return 'good'
  }

  return 'possible'
}

function hasExactOrNearExactNameMatch(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  const namesToCheck = [
    record.originalFragranceName,
    record.mistifyProductName,
  ]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name && name.length >= 4))

  return namesToCheck.some((name) =>
    includesPhrase(intent.normalizedMessage, normalizeText(name)),
  )
}

function getDisplayedScoreCap(params: {
  intent: RecommendationIntent
  hasExactNameMatch: boolean
  matchedRequestedNoteCount: number
}) {
  const { intent, hasExactNameMatch, matchedRequestedNoteCount } = params

  if (hasExactNameMatch) {
    return 100
  }

  if (
    intent.promptType === 'strict_multi_note_combo' &&
    matchedRequestedNoteCount === intent.requestedNoteTokens.length
  ) {
    return 98
  }

  if (
    intent.promptType === 'note_plus_vibe'
  ) {
    return 96
  }

  if (intent.promptType === 'reference') {
    return 100
  }

  return getIntentModeScoringPolicy(intent).maxScore
}

function calibrateDisplayedMatchScore(params: {
  score: number
  record: RecommendableFragrance
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  matchedRequestedNoteCount: number
}) {
  const {
    score,
    record,
    intent,
    scentRelevanceLayer,
    matchedRequestedNoteCount,
  } = params
  const scoreCap = getDisplayedScoreCap({
    intent,
    hasExactNameMatch: hasExactOrNearExactNameMatch(record, intent),
    matchedRequestedNoteCount,
  })
  const relevanceFloor =
    scentRelevanceLayer.scentRelevanceScore >= 85
      ? 78
      : scentRelevanceLayer.scentRelevanceScore >= 70
        ? 70
        : 0

  return Math.round(clamp(Math.max(score, relevanceFloor), 0, scoreCap))
}

function describeScoreStrength(
  score: number,
  labels: {
    exceptional: string
    strong: string
    good: string
    possible: string
  },
) {
  if (score >= 86) {
    return labels.exceptional
  }

  if (score >= 70) {
    return labels.strong
  }

  if (score >= 50) {
    return labels.good
  }

  return labels.possible
}

function buildScoreBreakdown(params: {
  scentRelevanceLayer: ScentRelevanceLayer
  popularityQualityLayer: PopularityQualityLayer
}): ScoreBreakdown {
  const { scentRelevanceLayer, popularityQualityLayer } = params

  return {
    profileFit: describeScoreStrength(
      scentRelevanceLayer.scentRelevanceScore,
      {
        exceptional: 'Exceptional',
        strong: 'Very strong',
        good: 'Good',
        possible: 'Possible',
      },
    ),
    popularity: describeScoreStrength(
      popularityQualityLayer.popularityQualityScore,
      {
        exceptional: 'Very high',
        strong: 'High',
        good: 'Moderate',
        possible: 'Limited',
      },
    ),
    ratingConfidence: describeScoreStrength(
      popularityQualityLayer.ratingReliabilityScore,
      {
        exceptional: 'Very strong',
        strong: 'Strong',
        good: 'Moderate',
        possible: 'Limited',
      },
    ),
  }
}

function formatEvidenceTerm(term: string) {
  return term
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function formatEvidenceList(terms: string[]) {
  const safeTerms = terms.map(formatEvidenceTerm).filter(Boolean)

  if (safeTerms.length <= 1) {
    return safeTerms.join('')
  }

  if (safeTerms.length === 2) {
    return `${safeTerms[0]} and ${safeTerms[1]}`
  }

  return `${safeTerms.slice(0, -1).join(', ')}, and ${safeTerms[safeTerms.length - 1]}`
}

function formatDirectionPhrase(direction: string) {
  const formattedDirection = formatEvidenceTerm(direction)
  const article = /^[aeiou]/i.test(formattedDirection) ? 'an' : 'a'

  return `${article} ${formattedDirection} direction`
}

function addUniqueEvidenceItem(items: string[], item: string) {
  const trimmedItem = item.trim()

  if (trimmedItem && !items.includes(trimmedItem)) {
    items.push(trimmedItem)
  }
}

function getMatchedNegativeTerms(
  record: RecommendableFragrance,
  terms: string[],
) {
  return terms
    .filter((term) => recordMatchesTerm(record, term))
    .slice(0, 3)
}

function buildRecommendationEvidence(params: {
  record: RecommendableFragrance
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  matchTier: MatchTier
  missingRequestedNotes: string[]
}) {
  const {
    record,
    intent,
    scentRelevanceLayer,
    matchTier,
    missingRequestedNotes,
  } = params
  const reasons: string[] = []
  const warnings: string[] = []
  const missing: string[] = []
  const requiredNotes = intent.intentBuckets.requiredNotes
  const preferredNotes = intent.intentBuckets.preferredNotes

  for (const noteToken of requiredNotes) {
    const strength = getRequestedNoteFieldEvidenceStrength(record, noteToken)

    if (strength === 'exact') {
      addUniqueEvidenceItem(
        reasons,
        `matches ${formatEvidenceTerm(noteToken)} directly in the listed notes`,
      )
    } else if (strength === 'strong' || strength === 'medium') {
      addUniqueEvidenceItem(
        reasons,
        `has close ${formatEvidenceTerm(noteToken)} family support in the listed notes`,
      )
    } else if (strength === 'soft') {
      addUniqueEvidenceItem(
        reasons,
        `has softer ${formatEvidenceTerm(noteToken)} adjacent note support`,
      )
    } else {
      addUniqueEvidenceItem(
        missing,
        `No clear ${formatEvidenceTerm(noteToken)} note support found`,
      )
    }
  }

  for (const noteToken of preferredNotes) {
    const strength = getRequestedNoteFieldEvidenceStrength(record, noteToken)

    if (strength !== 'none') {
      addUniqueEvidenceItem(
        reasons,
        `adds some ${formatEvidenceTerm(noteToken)} support`,
      )
    }
  }

  for (const vibe of intent.intentBuckets.desiredVibes.slice(0, 2)) {
    if (scoreVibeFamilies(record, [vibe]) >= 35) {
      addUniqueEvidenceItem(
        reasons,
        `listed notes and classification support ${formatDirectionPhrase(vibe)}`,
      )
    }
  }

  if (
    intent.intentBuckets.constraints.length > 0 &&
    scoreConstraintIntent(record, intent) >= 35
  ) {
    addUniqueEvidenceItem(
      reasons,
      `fits the ${formatEvidenceList(intent.intentBuckets.constraints.slice(0, 2))} direction`,
    )
  }

  if (
    !requiredNotes.length &&
    scentRelevanceLayer.profileScore >= 70 &&
    intent.hasBroadContext
  ) {
    const classification = record.classification?.trim()
    addUniqueEvidenceItem(
      reasons,
      classification
        ? `${classification} classification supports the broader scent direction`
        : 'listed notes support the broader scent direction',
    )
  }

  for (const noteToken of missingRequestedNotes) {
    if (!missing.some((item) => item.includes(noteToken))) {
      addUniqueEvidenceItem(
        missing,
        `No clear ${formatEvidenceTerm(noteToken)} note support found`,
      )
    }
  }

  const matchedNegativeTerms = getMatchedNegativeTerms(
    record,
    intent.intentBuckets.negativeTerms,
  )

  if (matchedNegativeTerms.length > 0) {
    addUniqueEvidenceItem(
      warnings,
      `includes some ${formatEvidenceList(matchedNegativeTerms)} signals you asked to avoid`,
    )
  }

  if (scentRelevanceLayer.conflictScore >= 20) {
    addUniqueEvidenceItem(
      warnings,
      'profile conflicts keep it from ranking higher',
    )
  }

  if (matchTier === 'possible') {
    addUniqueEvidenceItem(
      warnings,
      'this is an adjacent fit, so treat it as lower confidence',
    )
  }

  if (!reasons.length && !missing.length) {
    addUniqueEvidenceItem(
      reasons,
      'uses the available scent profile as a broad fit',
    )
  }

  return {
    reasons: reasons.slice(0, 4),
    warnings: warnings.slice(0, 3),
    missing: missing.slice(0, 3),
  }
}

function sentenceFromEvidenceItems(items: string[]) {
  const text = formatEvidenceList(items)

  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : ''
}

function trimExplanationToLimit(value: string) {
  if (value.length <= DETERMINISTIC_EXPLANATION_MAX_LENGTH) {
    return value
  }

  const trimmedValue = value.slice(0, DETERMINISTIC_EXPLANATION_MAX_LENGTH - 1)
  const lastSpaceIndex = trimmedValue.lastIndexOf(' ')

  return `${trimmedValue.slice(0, Math.max(0, lastSpaceIndex)).trim()}.`
}

function buildDeterministicExplanation(
  evidence: RecommendationEvidence,
  matchTier: MatchTier,
) {
  const primaryEvidence = evidence.reasons.length
    ? evidence.reasons.slice(0, 2)
    : evidence.missing.slice(0, 1)
  const prefix = matchTier === 'possible' ? 'Possible fit: ' : ''
  const primarySentence = sentenceFromEvidenceItems(primaryEvidence)
  const secondaryItem =
    matchTier === 'possible'
      ? evidence.warnings[0] ?? evidence.missing[0]
      : evidence.missing[0] ?? evidence.warnings[0]
  const explanationParts = [
    `${prefix}${primarySentence}`,
    secondaryItem ? sentenceFromEvidenceItems([secondaryItem]) : '',
  ].filter(Boolean)

  return trimExplanationToLimit(explanationParts.join(' ').trim())
}

function getNoteLayerLabels(record: RecommendableFragrance, noteToken: string) {
  const layers: string[] = []

  if (normalizeNotes(record.topNotes).some((note) => normalizeReferenceText(note) === normalizeReferenceText(noteToken))) {
    layers.push('top')
  }

  if (normalizeNotes(record.middleNotes).some((note) => normalizeReferenceText(note) === normalizeReferenceText(noteToken))) {
    layers.push('heart')
  }

  if (normalizeNotes(record.baseNotes).some((note) => normalizeReferenceText(note) === normalizeReferenceText(noteToken))) {
    layers.push('base')
  }

  return layers
}

function getMatchedExplanationNotes(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  return Array.from(
    new Set([
      ...intent.intentBuckets.requiredNotes,
      ...intent.intentBuckets.preferredNotes,
      ...intent.requestedNoteTokens,
    ]),
  )
    .filter((noteToken) => {
      const strength = getRequestedNoteFieldEvidenceStrength(record, noteToken)

      return strength !== 'none'
    })
    .slice(0, 6)
}

function getMatchedExplanationVibes(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  return Array.from(
    new Set([
      ...intent.intentBuckets.desiredVibes,
      ...intent.requestedVibes,
    ]),
  )
    .filter((vibe) => scoreVibeFamilies(record, [vibe]) >= 35)
    .slice(0, 5)
}

function getMatchedExplanationOccasions(
  record: RecommendableFragrance,
  intent: RecommendationIntent,
) {
  return intent.requestedOccasions
    .filter((occasion) => {
      const profile = OCCASION_PROFILES[occasion]

      if (!profile) {
        return false
      }

      return scoreOccasionProfile(record, profile) >= 35
    })
    .slice(0, 4)
}

function getMatchedExplanationSeasons(
  recommendation: ScoredRecommendation,
  intent: RecommendationIntent,
) {
  if (!intent.hasSeasonIntent) {
    return []
  }

  return recommendation.rating?.bestSeasons.slice(0, 2) ?? []
}

function getScentProfileLabels(record: RecommendableFragrance) {
  const classification = normalizeClassificationTerms(record.classification).length
    ? record.classification?.trim()
    : null
  const notes = getCachedRecordNotes(record)
  const listedNotes = notes.allNotes.length ? notes.allNotes : notes.combinedNotes
  const allowedFamilies = new Set([
    'fresh',
    'citrus',
    'aquatic',
    'green',
    'aromatic',
    'sweet',
    'vanilla',
    'gourmand',
    'fruity',
    'amber',
    'spicy',
    'resinous',
    'woody',
    'oud',
    'smoky',
    'leather',
    'tobacco',
    'floral',
    'rose',
    'white floral',
    'powdery floral',
    'soft floral',
    'clean',
    'musk',
    'aldehydic',
    'soapy/soft',
    'coconut',
    'creamy',
    'tropical',
  ])
  const directNoteFamilies = Array.from(
    new Set(listedNotes.flatMap((note) => getScentFamiliesForNote(note))),
  ).filter((family) => allowedFamilies.has(family))
  const classificationFamilies = normalizeClassificationTerms(record.classification)
    .filter((term) => allowedFamilies.has(term))
    .slice(0, 2)
  const families = Array.from(
    new Set([...classificationFamilies, ...directNoteFamilies]),
  )
    .map(formatEvidenceTerm)
    .filter(Boolean)

  return Array.from(
    new Set([
      ...(classification ? [classification] : []),
      ...families,
    ]),
  ).slice(0, 5)
}

function getConfidenceLabel(params: {
  recommendation: ScoredRecommendation
  intent: RecommendationIntent
}): ConfidenceLabel {
  const { recommendation, intent } = params
  const hasMissingRequired =
    intent.intentBuckets.requiredNotes.length > 0 &&
    recommendation.missingRequestedNotes.length > 0
  const hasConflict =
    recommendation.scentRelevanceLayer.conflictScore >= 20 ||
    recommendation.wearabilityLayer.conflictPenalty >= 18

  if (
    recommendation.referenceDebug &&
    recommendation.referenceDebug.referenceDNAFit < 45
  ) {
    return 'Exploratory pick'
  }

  if (
    isExactFreshCitrusIntent(intent) &&
    hasFreshCitrusWarmSweetContrast(recommendation.record)
  ) {
    return recommendation.matchScore >= 88 ? 'Strong fit' : 'Good fit'
  }

  if (
    isExploratoryFreshIntent(intent) &&
    hasFloralSweetFreshContrast(recommendation.record)
  ) {
    return 'Exploratory pick'
  }

  if (recommendation.matchTier === 'possible' || hasMissingRequired) {
    return hasConflict ? 'Exploratory pick' : 'Possible fit'
  }

  if (recommendation.matchScore >= 92 && !hasConflict) {
    return 'Excellent fit'
  }

  if (recommendation.matchScore >= 82 && !hasMissingRequired) {
    return hasConflict ? 'Good fit' : 'Strong fit'
  }

  if (recommendation.matchScore >= 68) {
    return 'Good fit'
  }

  return 'Exploratory pick'
}

function getConfidenceReason(params: {
  recommendation: ScoredRecommendation
  intent: RecommendationIntent
  matchedNotes: string[]
  matchedVibes: string[]
}) {
  const { recommendation, intent, matchedNotes, matchedVibes } = params

  if (recommendation.referenceDebug) {
    const dna = recommendation.referenceDebug.referenceDNAFit

    return dna >= 70
      ? 'Strong reference DNA with useful similarity evidence.'
      : dna >= 50
        ? 'Moderate reference DNA with a related direction.'
        : 'Looser reference relationship, included as an exploratory angle.'
  }

  if (
    intent.intentBuckets.requiredNotes.length > 0 &&
    recommendation.missingRequestedNotes.length === 0
  ) {
    return `Covers the requested ${formatEvidenceList(matchedNotes)} note direction.`
  }

  if (intent.hasBroadContext && recommendation.wearabilityLayer.conflictPenalty < 12) {
    return 'Profile and wearability signals line up with the request.'
  }

  if (matchedVibes.length > 0) {
    return `Matches the ${formatEvidenceList(matchedVibes)} profile direction.`
  }

  return 'Relevant scent-profile evidence supports this placement.'
}

function isExploratoryFreshIntent(intent: RecommendationIntent) {
  return (
    includesPhrase(intent.normalizedMessage, 'something fresh') ||
    includesPhrase(intent.normalizedMessage, 'maybe citrus') ||
    (intent.promptType === 'broad_vibe' &&
      intent.requestedVibes.some((vibe) => normalizeReferenceText(vibe) === 'fresh'))
  )
}

function hasFreshCitrusWarmSweetContrast(record: RecommendableFragrance) {
  if (
    recordClassificationMatchesAnyTerm(record, [
      'citrus',
      'citrus aromatic',
      'green citrus',
      'fresh aromatic',
      'aquatic citrus',
    ])
  ) {
    return false
  }

  return [
    'vanilla',
    'rum',
    'cacao',
    'cocoa',
    'caramel',
    'tobacco',
    'patchouli',
    'amber',
    'gourmand',
    'oriental vanilla',
  ].filter((term) => recordMatchesTerm(record, term)).length >= 2
}

function hasFloralSweetFreshContrast(record: RecommendableFragrance) {
  const hasFloralProfile = recordClassificationMatchesAnyTerm(record, [
    'floral',
    'floral woody musk',
    'floral fruity',
    'fruity floral',
  ])
  const sweetWarmCount = [
    'vanilla',
    'caramel',
    'milk',
    'cream',
    'amber',
    'peach',
    'cherry',
    'gourmand',
  ].filter((term) => recordMatchesTerm(record, term)).length

  return hasFloralProfile && sweetWarmCount >= 2
}

function getBestFor(params: {
  recommendation: ScoredRecommendation
  intent: RecommendationIntent
  matchedOccasions: string[]
  matchedVibes: string[]
}) {
  const { recommendation, intent, matchedOccasions, matchedVibes } = params

  if (matchedOccasions.length > 0) {
    return `${formatEvidenceTerm(matchedOccasions[0])} wear`
  }

  if (intent.hasSeasonIntent && recommendation.rating?.bestSeasons.length) {
    return `${recommendation.rating.bestSeasons[0]} wear`
  }

  if (matchedVibes.some((vibe) => ['beginner safe', 'compliment friendly', 'everyday'].includes(normalizeReferenceText(vibe)))) {
    return 'easy everyday wear'
  }

  if (matchedVibes.length > 0) {
    return `${formatEvidenceTerm(matchedVibes[0])} scent profile`
  }

  return null
}

function getWatchOut(params: {
  recommendation: ScoredRecommendation
  evidence: RecommendationEvidence
  intent: RecommendationIntent
}) {
  const { recommendation, evidence, intent } = params

  if (evidence.warnings.length > 0) {
    return sentenceFromEvidenceItems([evidence.warnings[0]]).replace(/\.$/, '')
  }

  if (evidence.missing.length > 0) {
    return sentenceFromEvidenceItems([evidence.missing[0]]).replace(/\.$/, '')
  }

  if (
    isExactFreshCitrusIntent(intent) &&
    hasFreshCitrusWarmSweetContrast(recommendation.record)
  ) {
    return 'opens citrusy, but the drydown is warmer and sweeter'
  }

  if (
    isExploratoryFreshIntent(intent) &&
    hasFloralSweetFreshContrast(recommendation.record)
  ) {
    return 'more of a floral/musky variation than a pure fresh citrus scent'
  }

  if (
    intent.intentBuckets.negativeTerms.length > 0 &&
    recommendation.scentRelevanceLayer.conflictScore < 12
  ) {
    return `keeps clear of strong ${formatEvidenceList(intent.intentBuckets.negativeTerms.slice(0, 2))} signals`
  }

  if (includesPhrase(intent.normalizedMessage, 'not heavy')) {
    return 'keeps the fresh direction away from heavy dark or dense sweet profiles'
  }

  if (includesPhrase(intent.normalizedMessage, 'not too sharp')) {
    return 'keeps the aquatic direction away from overly sharp edges'
  }

  if (includesPhrase(intent.normalizedMessage, 'not aquatic')) {
    return 'keeps the fresh direction away from a strongly aquatic profile'
  }

  if (recommendation.wearabilityLayer.conflictPenalty >= 12) {
    return 'may feel heavier or more polarizing than the request suggests'
  }

  return null
}

function buildMatchSummary(params: {
  recommendation: ScoredRecommendation
  intent: RecommendationIntent
  matchedNotes: string[]
  matchedVibes: string[]
  confidenceLabel: ConfidenceLabel
}) {
  const { recommendation, intent, matchedNotes, matchedVibes, confidenceLabel } =
    params
  const noteText = matchedNotes.length
    ? `matches ${formatEvidenceList(matchedNotes)}`
    : ''
  const vibeText = matchedVibes.length
    ? `leans ${formatEvidenceList(matchedVibes.slice(0, 2))}`
    : ''

  if (recommendation.referenceDebug) {
    const angle = recommendation.referenceDebug.similarityAngle ?? 'related direction'

    return `If you like the reference, this is a ${angle} with ${formatEvidenceList(recommendation.referenceDebug.sharedReferenceNotes.slice(0, 3)) || 'shared scent DNA'}.`
  }

  if (intent.intentBuckets.negativeTerms.length > 0 && noteText) {
    return `${confidenceLabel}: ${noteText} while managing the avoided ${formatEvidenceList(intent.intentBuckets.negativeTerms.slice(0, 2))} direction.`
  }

  if (noteText && vibeText) {
    return `${confidenceLabel}: ${noteText} and ${vibeText}.`
  }

  if (noteText) {
    return `${confidenceLabel}: ${noteText} in the listed scent profile.`
  }

  if (vibeText) {
    return `${confidenceLabel}: ${vibeText} with supporting wearability signals.`
  }

  return `${confidenceLabel}: relevant scent-profile support for this request.`
}

function buildWhyItMatches(params: {
  recommendation: ScoredRecommendation
  evidence: RecommendationEvidence
  matchedNotes: string[]
  matchedVibes: string[]
  matchedOccasions: string[]
}) {
  const {
    recommendation,
    evidence,
    matchedNotes,
    matchedVibes,
    matchedOccasions,
  } = params
  const reasons = [...evidence.reasons]

  for (const note of matchedNotes.slice(0, 3)) {
    const layers = getNoteLayerLabels(recommendation.record, note)

    if (layers.length > 0) {
      addUniqueEvidenceItem(
        reasons,
        `${formatEvidenceTerm(note)} appears in the ${formatEvidenceList(layers)} notes`,
      )
    }
  }

  if (matchedOccasions.length > 0) {
    addUniqueEvidenceItem(
      reasons,
      `fits ${formatEvidenceList(matchedOccasions)} context cues`,
    )
  }

  if (matchedVibes.length > 0) {
      addUniqueEvidenceItem(
        reasons,
        `listed notes and classification support ${formatDirectionPhrase(formatEvidenceList(matchedVibes.slice(0, 2)))}`,
      )
  }

  if (recommendation.referenceDebug) {
    const debug = recommendation.referenceDebug
    const shared = debug.sharedReferenceNotes.slice(0, 3)

    if (shared.length > 0) {
      addUniqueEvidenceItem(
        reasons,
        `shares ${formatEvidenceList(shared)} with the reference`,
      )
    }

    if (debug.accordPairMatches.length > 0) {
      addUniqueEvidenceItem(
        reasons,
        `echoes the ${formatEvidenceList(debug.accordPairMatches.slice(0, 2))} accord structure`,
      )
    }

    if (debug.differenceDirections.length > 0) {
      addUniqueEvidenceItem(
        reasons,
        `moves ${formatEvidenceList(debug.differenceDirections.slice(0, 2))} than the reference`,
      )
    }
  }

  return reasons.slice(0, 4)
}

function buildReferenceExplanationFields(
  recommendation: ScoredRecommendation,
) {
  const debug = recommendation.referenceDebug

  if (!debug) {
    return {}
  }

  const sharedNotes = debug.sharedReferenceNotes.slice(0, 6)
  const differences = debug.differenceDirections.slice(0, 4)
  const missing = debug.missingReferenceNotes.slice(0, 5)
  const angle = debug.similarityAngle ?? 'related direction'

  return {
    referenceSimilarityAngle: debug.similarityAngle,
    sharedWithReference: [
      ...sharedNotes,
      ...debug.accordPairMatches.slice(0, 2),
    ].slice(0, 7),
    differentFromReference: differences,
    missingFromReference: missing,
    bestIfYouLiked:
      sharedNotes.length > 0
        ? `${formatEvidenceList(sharedNotes.slice(0, 3))} in the reference`
        : angle,
    referenceConfidenceReason:
      debug.referenceDNAFit >= 70
        ? `Strong ${angle} evidence with shared notes and layer support.`
        : debug.referenceDNAFit >= 50
          ? `Moderate ${angle} evidence with some shared DNA.`
          : `Looser ${angle}; useful as a discovery pick rather than a clone.`,
  }
}

function buildStructuredExplanationFields(params: {
  recommendation: ScoredRecommendation
  intent: RecommendationIntent
  evidence: RecommendationEvidence
}) {
  const { recommendation, intent, evidence } = params
  const matchedNotes = getMatchedExplanationNotes(recommendation.record, intent)
  const matchedVibes = getMatchedExplanationVibes(recommendation.record, intent)
  const matchedOccasions = getMatchedExplanationOccasions(recommendation.record, intent)
  const matchedSeasons = getMatchedExplanationSeasons(recommendation, intent)
  const confidenceLabel = getConfidenceLabel({ recommendation, intent })
  const whyItMatches = buildWhyItMatches({
    recommendation,
    evidence,
    matchedNotes,
    matchedVibes,
    matchedOccasions,
  })

  return {
    matchSummary: trimExplanationToLimit(
      buildMatchSummary({
        recommendation,
        intent,
        matchedNotes,
        matchedVibes,
        confidenceLabel,
      }),
    ),
    whyItMatches,
    bestFor: getBestFor({
      recommendation,
      intent,
      matchedOccasions,
      matchedVibes,
    }),
    watchOut: getWatchOut({ recommendation, evidence, intent }),
    matchedNotes: matchedNotes.map(formatEvidenceTerm),
    matchedVibes: matchedVibes.map(formatEvidenceTerm),
    matchedOccasions: matchedOccasions.map(formatEvidenceTerm),
    matchedSeasons,
    scentProfile: getScentProfileLabels(recommendation.record),
    confidenceLabel,
    confidenceReason: getConfidenceReason({
      recommendation,
      intent,
      matchedNotes,
      matchedVibes,
    }),
    ...buildReferenceExplanationFields(recommendation),
  }
}

function scoreFragrance(
  record: RecommendableFragrance,
  tokens: string[],
  requestedNoteTokens: string[],
) {
  let score = 0
  const matchedNoteTokens = new Set<string>()
  const partiallyMatchedNoteTokens = new Set<string>()
  const isSingleNoteRequest = requestedNoteTokens.length === 1
  const allowFamilyFallback = requestedNoteTokens.length >= 1

  for (const noteToken of requestedNoteTokens) {
    const matchStrength = getRequestedNoteMatchStrength(record, noteToken, {
      allowLooseSoftSupport: isSingleNoteRequest,
      allowFamilyFallback,
    })

    if (matchStrength === 'exact') {
      score += isSingleNoteRequest ? 34 : 24
      matchedNoteTokens.add(noteToken)
      partiallyMatchedNoteTokens.add(noteToken)
      continue
    }

    if (matchStrength === 'strong') {
      score += isSingleNoteRequest ? 26 : 20
      matchedNoteTokens.add(noteToken)
      partiallyMatchedNoteTokens.add(noteToken)
      continue
    }

    if (matchStrength === 'medium') {
      score += isSingleNoteRequest ? 16 : 8
      partiallyMatchedNoteTokens.add(noteToken)
      continue
    }

    if (matchStrength === 'soft') {
      score += isSingleNoteRequest ? 10 : 4
      partiallyMatchedNoteTokens.add(noteToken)
    }
  }

  for (const token of tokens) {
    if (includesToken(record.classification, token)) {
      score += 10
    }

    if (
      includesToken(record.mistifyProductName, token) ||
      includesToken(record.originalFragranceName, token)
    ) {
      score += 12
    }

    if (includesToken(record.searchableText, token)) {
      score += 4
    }
  }

  if (requestedNoteTokens.length >= 2) {
    if (matchedNoteTokens.size === requestedNoteTokens.length) {
      score += 30
    } else if (matchedNoteTokens.size >= 2) {
      score += 18
    }
  }

  if (isSingleNoteRequest) {
    if (matchedNoteTokens.size === 1) {
      score += 10
    } else if (partiallyMatchedNoteTokens.size === 1) {
      score += 5
    }
  }

  return score
}

function scoreRating(
  rating: RatingRecord | undefined,
  intents: ReturnType<typeof getRatingIntents>,
  ratingStats: RatingStats,
): RatingScoreBreakdown {
  if (!rating) {
    return {
      legacyRatingScore: 0,
      seasonTimeScore: 0,
      ratingQualityScore: 0,
      sentimentScore: 0,
      popularityScore: 0,
      crowdScore: 0,
      crowdPower: 0,
      loveShare: 0,
      trustedLoveShareScore: 0,
      voteConfidence: 0,
      ratingTierScore: 0,
      bayesianRatingValue: null,
      reactionConfidence: 0,
      requestedSeasonShare: null,
      seasonConfidence: 0,
      seasonFitCap: null,
      timeScore: 0,
      requestedTimeShare: null,
      dayNightConfidence: 0,
      timeFitCap: null,
    }
  }

  let legacyRatingScore = 0
  let ratingQualityScore = 0
  let sentimentScore = 0
  let seasonTimeScore = 0
  const ratingValue = parseNullableNumber(rating.ratingValue)
  const ratingVoteCount = rating.ratingVoteCount ?? 0
  const reviewCount = rating.reviewCount ?? 0
  const loveCount = rating.loveCount ?? 0
  const likeCount = rating.likeCount ?? 0
  const okCount = rating.okCount ?? 0
  const dislikeCount = rating.dislikeCount ?? 0
  const hateCount = rating.hateCount ?? 0
  const voteConfidence = confidenceFromCount(ratingVoteCount, 4)
  const votePopularity = confidenceFromCount(ratingVoteCount, 4)
  const lovePopularity = confidenceFromCount(loveCount, 4)
  const reviewConfidence = confidenceFromCount(reviewCount, 3)
  const popularityScore = clamp(
    votePopularity * 85 + reviewConfidence * 15,
    0,
    100,
  )
  const bayesianRatingValue = getBayesianRatingValue({
    ratingValue,
    ratingVoteCount,
    ratingStats,
  })
  const ratingTierScore = getRatingTierScore(bayesianRatingValue)
  const ratingVoteScore = ratingTierScore * voteConfidence
  if (ratingValue !== null) {
    ratingQualityScore += ratingVoteScore * 100
    legacyRatingScore += ratingVoteScore * 10
  }

  ratingQualityScore +=
    lovePopularity * 3 + reviewConfidence * 1
  legacyRatingScore +=
    lovePopularity * 3 + reviewConfidence * 0.75

  const sentimentTotal =
    loveCount + likeCount + okCount + dislikeCount + hateCount
  const reactionConfidence = confidenceFromCount(sentimentTotal, 4)
  const loveShare = sentimentTotal > 0 ? loveCount / sentimentTotal : 0
  const likeShare = sentimentTotal > 0 ? likeCount / sentimentTotal : 0
  const okShare = sentimentTotal > 0 ? okCount / sentimentTotal : 0
  const dislikeShare =
    sentimentTotal > 0 ? dislikeCount / sentimentTotal : 0
  const hateShare = sentimentTotal > 0 ? hateCount / sentimentTotal : 0
  const approvalScore =
    loveShare * 1.0 +
    likeShare * 0.65 +
    okShare * 0.15 -
    dislikeShare * 0.6 -
    hateShare * 1.0
  const normalizedApprovalScore =
    sentimentTotal > 0 ? clamp((approvalScore + 1) / 2, 0, 1) : 0
  const loveShareConfidence = Math.min(reactionConfidence, lovePopularity)
  const trustedLoveShareScore = loveShare * loveShareConfidence
  const crowdQuality = clamp(
    trustedLoveShareScore * 0.48 +
      loveShare * reactionConfidence * 0.16 +
      ratingVoteScore * 0.16 +
      lovePopularity * 0.12 +
      normalizedApprovalScore * reactionConfidence * 0.08,
    0,
    1,
  )
  const crowdPower = crowdQuality * 100
  const sentimentRaw =
    sentimentTotal > 0
      ? (loveCount * 1.2 +
          likeCount * 0.7 +
          okCount * 0.15 -
          dislikeCount * 0.7 -
          hateCount * 1.2) /
        sentimentTotal
      : 0
  const normalizedSentiment = clamp((sentimentRaw + 1) / 2, 0, 1)
  const crowdScore = clamp(
    (normalizedSentiment * 0.35 + (crowdPower / 100) * 0.65) *
      100,
    0,
    100,
  )

  sentimentScore = normalizedSentiment * 100
  legacyRatingScore +=
    crowdQuality * 20 + trustedLoveShareScore * 9 + (crowdScore / 100) * 2

  const seasonConfidence = confidenceFromCount(rating.seasonTotalCount, 2)
  const dayNightConfidence = confidenceFromCount(rating.dayNightTotalCount, 2)
  const requestedTimeShares = [
    intents.day ? parseNullableNumber(rating.dayShare) : null,
    intents.night ? parseNullableNumber(rating.nightShare) : null,
  ].filter((share): share is number => share !== null)
  const requestedTimeShare = requestedTimeShares.length
    ? Math.max(...requestedTimeShares)
    : null
  const requestedSeasonShares = [
    intents.summer ? parseNullableNumber(rating.summerShare) : null,
    intents.winter ? parseNullableNumber(rating.winterShare) : null,
    intents.spring ? parseNullableNumber(rating.springShare) : null,
    intents.fall ? parseNullableNumber(rating.fallShare) : null,
  ].filter((share): share is number => share !== null)
  const requestedSeasonShare = requestedSeasonShares.length
    ? Math.max(...requestedSeasonShares)
    : null

  for (const seasonShare of requestedSeasonShares) {
    const seasonBoost = seasonShare * seasonConfidence

    seasonTimeScore = Math.max(seasonTimeScore, seasonBoost * 100)
    legacyRatingScore += seasonBoost * EXPLICIT_SEASON_WEIGHT

    if (seasonShare < LOW_SEASON_SHARE_THRESHOLD) {
      legacyRatingScore -=
        ((LOW_SEASON_SHARE_THRESHOLD - seasonShare) /
          LOW_SEASON_SHARE_THRESHOLD) *
        seasonConfidence *
        LOW_SEASON_SHARE_PENALTY
    }
  }

  if (intents.day) {
    const dayTimeScore =
      (parseNullableNumber(rating.dayShare) ?? 0) * dayNightConfidence

    seasonTimeScore = Math.max(seasonTimeScore, dayTimeScore * 100)
    legacyRatingScore += dayTimeScore * EXPLICIT_DAY_NIGHT_WEIGHT
  }

  if (intents.night) {
    const nightTimeScore =
      (parseNullableNumber(rating.nightShare) ?? 0) * dayNightConfidence

    seasonTimeScore = Math.max(seasonTimeScore, nightTimeScore * 100)
    legacyRatingScore += nightTimeScore * EXPLICIT_DAY_NIGHT_WEIGHT
  }

  return {
    legacyRatingScore,
    seasonTimeScore,
    ratingQualityScore: clamp(ratingQualityScore, 0, 100),
    sentimentScore,
    popularityScore,
    crowdScore,
    crowdPower,
    loveShare,
    trustedLoveShareScore,
    voteConfidence,
    ratingTierScore,
    bayesianRatingValue,
    reactionConfidence,
    requestedSeasonShare,
    seasonConfidence,
    seasonFitCap: getSeasonFitCap(requestedSeasonShare, seasonConfidence),
    timeScore: (requestedTimeShare ?? 0) * dayNightConfidence * 100,
    requestedTimeShare,
    dayNightConfidence,
    timeFitCap: getTimeFitCap(requestedTimeShare, dayNightConfidence),
  }
}

function getSeasonFitCap(
  requestedSeasonShare: number | null,
  seasonConfidence: number,
) {
  if (requestedSeasonShare === null || seasonConfidence < 0.5) {
    return null
  }

  if (requestedSeasonShare >= 0.3) {
    return null
  }

  if (requestedSeasonShare >= 0.2) {
    return 85
  }

  if (requestedSeasonShare >= 0.1) {
    return 78
  }

  return 70
}

function getTimeFitCap(
  requestedTimeShare: number | null,
  dayNightConfidence: number,
) {
  if (requestedTimeShare === null || dayNightConfidence < 0.5) {
    return null
  }

  if (requestedTimeShare >= 0.65) {
    return null
  }

  if (requestedTimeShare >= 0.55) {
    return 85
  }

  if (requestedTimeShare >= 0.45) {
    return 75
  }

  return 65
}

function scoreExplicitSeasonIntent(params: {
  noteScore: number
  profileScore: number
  ratingScoreBreakdown: RatingScoreBreakdown
  requestedNoteCount: number
  matchedRequestedNoteCount: number
}) {
  const noteScore = capMultiNoteMatchScore(
    normalizeMatchScore(params.noteScore),
    params.requestedNoteCount,
    params.matchedRequestedNoteCount,
  )
  const relevanceScore = Math.max(noteScore, params.profileScore)
  const crowdRelevanceMultiplier = getCrowdRelevanceMultiplier({
    noteScore: params.noteScore,
    profileScore: params.profileScore,
    requestedNoteCount: params.requestedNoteCount,
    matchedRequestedNoteCount: params.matchedRequestedNoteCount,
    hasContextIntent: true,
  })
  const finalScore =
    relevanceScore * 0.38 +
    params.ratingScoreBreakdown.seasonTimeScore * 0.35 +
    params.ratingScoreBreakdown.seasonTimeScore *
      crowdRelevanceMultiplier *
      0.17 +
    params.profileScore * 0.1
  const cappedScore =
    params.ratingScoreBreakdown.seasonFitCap === null
      ? finalScore
      : Math.min(finalScore, params.ratingScoreBreakdown.seasonFitCap)

  return Math.round(clamp(cappedScore, 0, 100))
}

function scoreExplicitTimeIntent(params: {
  noteScore: number
  profileScore: number
  ratingScoreBreakdown: RatingScoreBreakdown
  requestedNoteCount: number
  matchedRequestedNoteCount: number
}) {
  const generalRelevanceScore = capMultiNoteMatchScore(
    normalizeMatchScore(params.noteScore),
    params.requestedNoteCount,
    params.matchedRequestedNoteCount,
  )
  const hasRequestedNotes = params.requestedNoteCount > 0
  const crowdRelevanceMultiplier = getCrowdRelevanceMultiplier({
    noteScore: params.noteScore,
    profileScore: params.profileScore,
    requestedNoteCount: params.requestedNoteCount,
    matchedRequestedNoteCount: params.matchedRequestedNoteCount,
    hasContextIntent: true,
  })
  const finalScore = hasRequestedNotes
    ? params.ratingScoreBreakdown.timeScore * 0.38 +
      generalRelevanceScore * 0.28 +
      params.ratingScoreBreakdown.timeScore *
        crowdRelevanceMultiplier *
        0.12 +
      params.profileScore * 0.07 +
      generalRelevanceScore * 0.15
    : params.ratingScoreBreakdown.timeScore * 0.4 +
      params.profileScore * 0.18 +
      params.ratingScoreBreakdown.timeScore *
        crowdRelevanceMultiplier *
        0.2 +
      generalRelevanceScore * 0.22
  const cappedScore =
    params.ratingScoreBreakdown.timeFitCap === null
      ? finalScore
      : Math.min(finalScore, params.ratingScoreBreakdown.timeFitCap)

  return Math.round(clamp(cappedScore, 0, 100))
}

function calibrateExplicitSeasonDisplayScore(params: {
  rankingScore: number
  profileScore: number
  ratingScoreBreakdown: RatingScoreBreakdown
  requestedNoteCount: number
  matchedRequestedNoteCount: number
}) {
  const {
    rankingScore,
    profileScore,
    ratingScoreBreakdown,
    requestedNoteCount,
    matchedRequestedNoteCount,
  } = params
  const requestedSeasonShare = ratingScoreBreakdown.requestedSeasonShare
  const hasRequestedNoteMatch = matchedRequestedNoteCount > 0
  const hasProfileMatch = profileScore >= 36
  let displayScore = rankingScore

  if (
    (hasRequestedNoteMatch || hasProfileMatch) &&
    requestedSeasonShare !== null &&
    ratingScoreBreakdown.seasonConfidence >= 0.5
  ) {
    const noteCoverage =
      requestedNoteCount === 0
        ? 1
        : matchedRequestedNoteCount / requestedNoteCount
    const strongMultiNoteMatch =
      requestedNoteCount < 2 || matchedRequestedNoteCount === requestedNoteCount
    const crowdRelevanceMultiplier = getCrowdRelevanceMultiplier({
      noteScore: 0,
      profileScore,
      requestedNoteCount,
      matchedRequestedNoteCount,
      hasContextIntent: true,
    })
    const supportBoost =
      ratingScoreBreakdown.seasonTimeScore * 0.08 * crowdRelevanceMultiplier

    if (requestedSeasonShare >= 0.3 && strongMultiNoteMatch) {
      const profileBoost = hasProfileMatch ? Math.min(10, profileScore * 0.1) : 0

      displayScore = Math.max(
        displayScore,
        78 +
          Math.min(14, (requestedSeasonShare - 0.3) * 70) +
          profileBoost +
          supportBoost,
      )
    } else if (requestedSeasonShare >= 0.2 && noteCoverage >= 0.75) {
      const profileBoost = hasProfileMatch ? Math.min(7, profileScore * 0.07) : 0

      displayScore = Math.max(
        displayScore,
        68 +
          Math.min(17, (requestedSeasonShare - 0.2) * 170) +
          profileBoost +
          supportBoost,
      )
    }
  }

  const multiNoteCappedScore = capMultiNoteMatchScore(
    displayScore,
    requestedNoteCount,
    matchedRequestedNoteCount,
  )
  const seasonCappedScore =
    ratingScoreBreakdown.seasonFitCap === null
      ? multiNoteCappedScore
      : Math.min(multiNoteCappedScore, ratingScoreBreakdown.seasonFitCap)

  return Math.round(clamp(seasonCappedScore, 0, 100))
}

function calibrateExplicitTimeDisplayScore(params: {
  rankingScore: number
  profileScore: number
  ratingScoreBreakdown: RatingScoreBreakdown
  requestedNoteCount: number
  matchedRequestedNoteCount: number
}) {
  const {
    rankingScore,
    profileScore,
    ratingScoreBreakdown,
    requestedNoteCount,
    matchedRequestedNoteCount,
  } = params
  const requestedTimeShare = ratingScoreBreakdown.requestedTimeShare
  const hasRequestedNotes = requestedNoteCount > 0
  const hasRequiredNoteCoverage =
    requestedNoteCount === 0 ||
    matchedRequestedNoteCount === requestedNoteCount
  let displayScore = rankingScore

  if (
    requestedTimeShare !== null &&
    ratingScoreBreakdown.dayNightConfidence >= 0.5 &&
    hasRequiredNoteCoverage
  ) {
    const supportBoost =
      ratingScoreBreakdown.timeScore * 0.08 +
      profileScore * 0.04

    if (requestedTimeShare >= 0.65) {
      displayScore = Math.max(
        displayScore,
        78 + Math.min(14, (requestedTimeShare - 0.65) * 70) + supportBoost,
      )
    } else if (requestedTimeShare >= 0.55) {
      displayScore = Math.max(
        displayScore,
        70 + Math.min(15, (requestedTimeShare - 0.55) * 150) + supportBoost,
      )
    } else if (!hasRequestedNotes && requestedTimeShare >= 0.45) {
      displayScore = Math.max(
        displayScore,
        62 + Math.min(13, (requestedTimeShare - 0.45) * 130),
      )
    }
  }

  const multiNoteCappedScore = capMultiNoteMatchScore(
    displayScore,
    requestedNoteCount,
    matchedRequestedNoteCount,
  )
  const timeCappedScore =
    ratingScoreBreakdown.timeFitCap === null
      ? multiNoteCappedScore
      : Math.min(multiNoteCappedScore, ratingScoreBreakdown.timeFitCap)

  return Math.round(clamp(timeCappedScore, 0, 100))
}

function getBestSeasons(rating: RatingRecord) {
  const seasons = [
    { label: 'Winter', share: parseNullableNumber(rating.winterShare) },
    { label: 'Spring', share: parseNullableNumber(rating.springShare) },
    { label: 'Summer', share: parseNullableNumber(rating.summerShare) },
    { label: 'Fall', share: parseNullableNumber(rating.fallShare) },
  ]

  return seasons
    .filter((season): season is { label: string; share: number } => season.share !== null)
    .sort((first, second) => second.share - first.share)
    .slice(0, 2)
    .map((season) => season.label)
}

function buildRecommendationRating(
  rating: RatingRecord | undefined,
): RecommendationRating | undefined {
  if (!rating) {
    return undefined
  }

  const dayShare = parseNullableNumber(rating.dayShare)
  const nightShare = parseNullableNumber(rating.nightShare)
  const bestTime =
    dayShare === null && nightShare === null
      ? null
      : Math.abs((dayShare ?? 0) - (nightShare ?? 0)) <= 0.1
        ? 'Day or Night'
        : (dayShare ?? 0) > (nightShare ?? 0)
          ? 'Day'
          : 'Night'

  return {
    ratingValue: parseNullableNumber(rating.ratingValue),
    ratingVoteCount: rating.ratingVoteCount,
    reviewCount: rating.reviewCount,
    loveCount: rating.loveCount,
    likeCount: rating.likeCount,
    okCount: rating.okCount,
    dislikeCount: rating.dislikeCount,
    hateCount: rating.hateCount,
    bestSeasons: getBestSeasons(rating),
    bestTime,
    seasonShares: {
      winter: parseNullableNumber(rating.winterShare),
      spring: parseNullableNumber(rating.springShare),
      summer: parseNullableNumber(rating.summerShare),
      fall: parseNullableNumber(rating.fallShare),
    },
    dayShare,
    nightShare,
  }
}

function buildReferenceFragrance(
  record: RecommendableFragrance,
  rating: RatingRecord | undefined,
): ReferenceFragrance {
  const displayProductName = getDisplayProductName(record)
  const originalFragranceName = record.originalFragranceName?.trim() ?? ''

  return {
    mistifyProductName:
      displayProductName && displayProductName !== originalFragranceName
        ? displayProductName
        : undefined,
    mistifyProductUrl: record.mistifyProductUrl?.trim() || undefined,
    audience: record.audience?.trim() || undefined,
    originalFragranceName,
    sourceBrandBatch: record.sourceBrandBatch?.trim() || undefined,
    classification: record.classification?.trim() || undefined,
    topNotes: normalizeNotes(record.topNotes),
    middleNotes: normalizeNotes(record.middleNotes),
    baseNotes: normalizeNotes(record.baseNotes),
    allNotes: normalizeNotes(record.allNotes),
    rating: buildRecommendationRating(rating),
  }
}

function normalizeMatchScore(rawScore: number) {
  return Math.min(100, Math.round((rawScore / MAX_RAW_SCORE) * 100))
}

function getCrowdQualityBoost(params: {
  noteScore: number
  profileScore: number
  combinedIntentScore: number
  requestedNoteCount: number
  requestedVibeCount: number
  matchedRequestedNoteCount: number
  ratingScoreBreakdown: RatingScoreBreakdown
}) {
  const {
    noteScore,
    profileScore,
    combinedIntentScore,
    requestedNoteCount,
    requestedVibeCount,
    matchedRequestedNoteCount,
    ratingScoreBreakdown,
  } = params
  const normalizedNoteScore = normalizeMatchScore(noteScore)
  const relevanceScore = Math.max(
    normalizedNoteScore,
    profileScore,
    combinedIntentScore,
  )
  const hasStrongStrictCoverage =
    requestedNoteCount === 0 ||
    matchedRequestedNoteCount === requestedNoteCount
  const hasCombinedIntent = requestedNoteCount > 0 && requestedVibeCount > 0
  const relevanceMultiplier = hasCombinedIntent
    ? combinedIntentScore >= 72
      ? 1
      : combinedIntentScore >= 55
        ? 0.62
        : combinedIntentScore >= 38
          ? 0.25
          : 0.08
    : relevanceScore >= 78 && hasStrongStrictCoverage
      ? 1
    : relevanceScore >= 62
        ? 0.65
        : relevanceScore >= 45
          ? 0.28
          : 0.08

  if (requestedNoteCount >= 2 && !hasStrongStrictCoverage) {
    return 0
  }

  const crowdQuality = clamp(
    ratingScoreBreakdown.crowdPower * 0.62 +
      ratingScoreBreakdown.ratingQualityScore * 0.16 +
      ratingScoreBreakdown.crowdScore * 0.14 +
      ratingScoreBreakdown.popularityScore * 0.08,
    0,
    100,
  )
  const hasHugeLovedBy =
    relevanceMultiplier >= 1 &&
    ratingScoreBreakdown.loveShare >= 0.75 &&
    ratingScoreBreakdown.reactionConfidence >= 0.67 &&
    ratingScoreBreakdown.voteConfidence >= 0.67
  const hasMajorLovedBy =
    relevanceMultiplier >= 1 &&
    ratingScoreBreakdown.loveShare >= 0.7 &&
    ratingScoreBreakdown.ratingTierScore >= 0.85 &&
    ratingScoreBreakdown.reactionConfidence >= 0.67 &&
    ratingScoreBreakdown.voteConfidence >= 0.67
  const hasMajorReliabilityLovedBy =
    relevanceMultiplier >= 1 &&
    ratingScoreBreakdown.loveShare >= 0.65 &&
    ratingScoreBreakdown.ratingTierScore >= 0.7 &&
    ratingScoreBreakdown.reactionConfidence >= 0.85 &&
    ratingScoreBreakdown.voteConfidence >= 0.9
  const hasExceptionalLovedBy =
    hasHugeLovedBy || hasMajorLovedBy || hasMajorReliabilityLovedBy
  const maxBoost = relevanceMultiplier >= 1
    ? hasExceptionalLovedBy
      ? 25
      : crowdQuality >= 86
        ? 20
        : crowdQuality >= 76
          ? 17
          : 12
    : relevanceMultiplier >= 0.6
      ? crowdQuality >= 76
        ? 14
        : crowdQuality >= 64
          ? 11
          : 9
      : 4
  const topRankNudge = hasExceptionalLovedBy
    ? hasHugeLovedBy
      ? 10
      : hasMajorLovedBy
        ? 8
        : 6
    : 0
  const displayPointBoost = Math.min(
    maxBoost,
    (crowdQuality / 100) * maxBoost * relevanceMultiplier + topRankNudge,
  )

  return (displayPointBoost / 100) * MAX_RAW_SCORE
}

function getCrowdRelevanceMultiplier(params: {
  noteScore: number
  profileScore: number
  combinedIntentScore?: number
  requestedNoteCount: number
  requestedVibeCount?: number
  matchedRequestedNoteCount: number
  hasContextIntent: boolean
}) {
  if (
    params.requestedNoteCount > 0 &&
    (params.requestedVibeCount ?? 0) > 0
  ) {
    if ((params.combinedIntentScore ?? 0) >= 72) {
      return 1
    }

    if ((params.combinedIntentScore ?? 0) >= 55) {
      return 0.75
    }

    return 0.45
  }

  if (params.requestedNoteCount >= 2) {
    return params.matchedRequestedNoteCount === params.requestedNoteCount
      ? 1
      : 0.35
  }

  if (params.requestedNoteCount === 1) {
    return params.matchedRequestedNoteCount === 1 ? 1 : 0.5
  }

  if (params.hasContextIntent) {
    return 1
  }

  if (params.profileScore >= 45) {
    return 1
  }

  if (params.profileScore >= 18) {
    return 0.75
  }

  if (params.noteScore >= 25) {
    return 1
  }

  if (params.noteScore >= 12) {
    return 0.75
  }

  return 0.45
}

function getCompatibilityQualityMultiplier(level: ProfileCompatibilityLevel) {
  if (level === 'strong') {
    return 1
  }

  if (level === 'moderate') {
    return 0.55
  }

  if (level === 'weak') {
    return 0.18
  }

  return 0
}

function scorePopularityQualityLayer(params: {
  rating: RatingRecord | undefined
  ratingStats: RatingStats
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  requestedNoteCount: number
  requestedVibeCount: number
  matchedRequestedNoteCount: number
}) {
  const {
    rating,
    ratingStats,
    intent,
    scentRelevanceLayer,
    requestedNoteCount,
    requestedVibeCount,
    matchedRequestedNoteCount,
  } = params
  const ratingScoreBreakdown = scoreRating(
    rating,
    intent.ratingIntents,
    ratingStats,
  )
  const compatibilityQualityMultiplier = getCompatibilityQualityMultiplier(
    scentRelevanceLayer.compatibilityLevel,
  )
  const crowdRelevanceMultiplier = getCrowdRelevanceMultiplier({
    noteScore: scentRelevanceLayer.noteRelevanceScore,
    profileScore: scentRelevanceLayer.profileScore,
    combinedIntentScore: scentRelevanceLayer.combinedIntentScore,
    requestedNoteCount,
    requestedVibeCount,
    matchedRequestedNoteCount,
    hasContextIntent:
      intent.hasSeasonIntent ||
      intent.hasTimeIntent ||
      intent.requestedOccasions.length > 0,
  }) * compatibilityQualityMultiplier
  const relevanceGatedPopularityBoost = getCrowdQualityBoost({
    noteScore: scentRelevanceLayer.noteRelevanceScore,
    profileScore: scentRelevanceLayer.profileScore,
    combinedIntentScore: scentRelevanceLayer.combinedIntentScore,
    requestedNoteCount,
    requestedVibeCount,
    matchedRequestedNoteCount,
    ratingScoreBreakdown,
  }) * compatibilityQualityMultiplier
  const lovedByScore =
    ratingScoreBreakdown.loveShare *
    ratingScoreBreakdown.reactionConfidence *
    100
  const ratingReliabilityScore =
    ratingScoreBreakdown.ratingTierScore *
    ratingScoreBreakdown.voteConfidence *
    100
  const qualityScore = clamp(
    ratingScoreBreakdown.crowdPower * 0.38 +
      ratingReliabilityScore * 0.26 +
      lovedByScore * 0.24 +
      ratingScoreBreakdown.sentimentScore * 0.12,
    0,
    100,
  )
  const popularityScore = ratingScoreBreakdown.popularityScore
  const popularityQualityScore = clamp(
    qualityScore * 0.84 + popularityScore * 0.16,
    0,
    100,
  )

  return {
    ratingScoreBreakdown,
    lovedByScore,
    ratingReliabilityScore,
    qualityScore,
    popularityScore,
    popularityQualityScore,
    crowdRelevanceMultiplier,
    relevanceGatedPopularityBoost,
  }
}

function calculateRelevanceRawScore(params: {
  scentRelevanceLayer: ScentRelevanceLayer
}) {
  const { scentRelevanceLayer } = params

  return (
    scentRelevanceLayer.noteRelevanceScore * 1.22 +
    scentRelevanceLayer.noteFamilyScore * 0.18 +
    scentRelevanceLayer.layerAwareScore * 0.18 +
    scentRelevanceLayer.profileScore * 0.66 +
    scentRelevanceLayer.combinedIntentScore * 0.32
  )
}

function calculateFinalScore(params: {
  relevanceScore: number
  qualityScore: number
  popularityScore: number
  dataConfidenceScore: number
}) {
  return Math.round(
    clamp(
      params.relevanceScore * 0.78 +
        params.qualityScore * 0.12 +
        params.popularityScore * 0.04 +
        params.dataConfidenceScore * 0.06,
      0,
      100,
    ),
  )
}

function calculateDataConfidenceScore(record: RecommendableFragrance) {
  const sourceConfidence = record.sourceConfidence?.toLowerCase().trim()
  const topNotes = normalizeNotes(record.topNotes)
  const middleNotes = normalizeNotes(record.middleNotes)
  const baseNotes = normalizeNotes(record.baseNotes)
  const allNotes = normalizeNotes(record.allNotes)
  const populatedNoteLayers = [topNotes, middleNotes, baseNotes].filter(
    (notes) => notes.length > 0,
  ).length

  let score = 0

  if (record.verifiedOnMistify) {
    score += 30
  }

  if (sourceConfidence === 'high') {
    score += 28
  } else if (sourceConfidence === 'medium') {
    score += 18
  } else if (sourceConfidence === 'low') {
    score += 8
  }

  if (populatedNoteLayers === 3) {
    score += 24
  } else if (populatedNoteLayers === 2) {
    score += 16
  } else if (populatedNoteLayers === 1) {
    score += 8
  }

  if (allNotes.length >= 5) {
    score += 18
  } else if (allNotes.length > 0) {
    score += 10
  }

  return clamp(score, 0, 100)
}

function getRatingTiebreakers(
  rating: RecommendationRating | undefined,
) {
  return {
    ratingValue: rating?.ratingValue ?? 0,
    ratingVoteCount: rating?.ratingVoteCount ?? 0,
  }
}

type ScoredRecommendation = FragranceRecommendation & {
  record: RecommendableFragrance
  scentRelevanceLayer: ScentRelevanceLayer
  popularityQualityLayer: PopularityQualityLayer
  wearabilityLayer: WearabilityLayer
  rawScore: number
  noteScore: number
  profileScore: number
  wearabilityScore: number
  occasionFitScore: number
  broadAppealScore: number
  wearabilityConflictPenalty: number
  requestedNoteCount: number
  matchedRequestedNoteCount: number
  partiallyMatchedRequestedNoteCount: number
  missingRequestedNotes: string[]
  rankingScore: number
  combinedIntentScore: number
  scentRelevanceScore: number
  qualityScore: number
  popularityScore: number
  popularityQualityScore: number
  dataConfidenceScore: number
  finalScore: number
  recommendationEvidence?: RecommendationEvidence
  referenceDebug?: ReferenceRecommendationDebug
}

type ScoringTiming = {
  noteMs: number
  vibeMs: number
  classificationMs: number
  occasionMs: number
  combinedMs: number
  compatibilityMs: number
  compatibilityFamilyOverlapMs: number
  compatibilityConflictMs: number
  compatibilityTextFallbackMs: number
  compatibilityCapMs: number
  qualityMs: number
  finalMappingMs: number
}

function normalizeAudienceValue(value: string | null | undefined): Audience | null {
  if (value === 'unisex' || value === 'mens' || value === 'womens') {
    return value
  }

  return null
}

function applyAudienceIntentFilter(
  recommendations: ScoredRecommendation[],
  requestedAudience: Audience | null,
) {
  if (!requestedAudience) {
    return recommendations
  }

  const matchingAudience = recommendations.filter(
    (recommendation) =>
      normalizeAudienceValue(recommendation.audience) === requestedAudience,
  )

  if (matchingAudience.length >= 5) {
    return matchingAudience
  }

  const unknownAudience = recommendations.filter(
    (recommendation) => normalizeAudienceValue(recommendation.audience) === null,
  )

  if (matchingAudience.length || unknownAudience.length) {
    return [...matchingAudience, ...unknownAudience]
  }

  return recommendations
}

function isMeaningfullyRelevantRecommendation(params: {
  recommendation: ScoredRecommendation
  hasBroadContext: boolean
}) {
  const { recommendation, hasBroadContext } = params

  if (recommendation.mistifyProductName.trim() === '') {
    return false
  }

  if (recommendation.rawScore <= 0) {
    return false
  }

  if (recommendation.requestedNoteCount >= 2) {
    if (recommendation.partiallyMatchedRequestedNoteCount === 0) {
      return false
    }

    if (
      recommendation.matchedRequestedNoteCount ===
      recommendation.requestedNoteCount
    ) {
      return recommendation.matchScore >= 50
    }

    if (
      recommendation.missingRequestedNotes.length >= 2 &&
      recommendation.partiallyMatchedRequestedNoteCount <
        recommendation.requestedNoteCount
    ) {
      return false
    }

    return (
      recommendation.partiallyMatchedRequestedNoteCount ===
        recommendation.requestedNoteCount && recommendation.matchScore >= 45
    )
  }

  if (recommendation.requestedNoteCount === 1) {
    if (recommendation.partiallyMatchedRequestedNoteCount === 0) {
      return false
    }

    return recommendation.matchedRequestedNoteCount === 1
      ? recommendation.matchScore >= 45
      : recommendation.matchScore >= 35
  }

  if (hasBroadContext) {
    return recommendation.matchScore >= 60
  }

  return recommendation.matchScore >= 45
}

function keepBestRelevantFallbacks(params: {
  recommendations: ScoredRecommendation[]
  filteredRecommendations: ScoredRecommendation[]
  hasBroadContext: boolean
}) {
  const {
    recommendations,
    filteredRecommendations,
    hasBroadContext,
  } = params
  const hasStrictMultiNoteRequest = recommendations.some(
    (recommendation) => recommendation.requestedNoteCount >= 2,
  )

  if (hasStrictMultiNoteRequest) {
    return filteredRecommendations
  }

  if (filteredRecommendations.length >= 3) {
    return filteredRecommendations
  }

  const fallbackMinimumScore = hasBroadContext ? 50 : 45
  const fallbackRecommendations = recommendations
    .filter(
      (recommendation) =>
        recommendation.matchScore >= fallbackMinimumScore &&
        (recommendation.requestedNoteCount < 2 ||
          (recommendation.partiallyMatchedRequestedNoteCount ===
            recommendation.requestedNoteCount &&
            recommendation.missingRequestedNotes.length < 2)) &&
        !filteredRecommendations.includes(recommendation),
    )
    .sort(compareScoredRecommendations)

  return [...filteredRecommendations, ...fallbackRecommendations].slice(0, 3)
}

function compareScoredRecommendations(
  first: ScoredRecommendation,
  second: ScoredRecommendation,
) {
  const firstRating = getRatingTiebreakers(first.rating)
  const secondRating = getRatingTiebreakers(second.rating)

  return (
    getMatchTierPriority(second.matchTier) - getMatchTierPriority(first.matchTier) ||
    second.matchScore - first.matchScore ||
    second.scentRelevanceScore - first.scentRelevanceScore ||
    second.wearabilityScore - first.wearabilityScore ||
    second.combinedIntentScore - first.combinedIntentScore ||
    second.rankingScore - first.rankingScore ||
    second.finalScore - first.finalScore ||
    second.qualityScore - first.qualityScore ||
    second.popularityScore - first.popularityScore ||
    second.popularityQualityScore - first.popularityQualityScore ||
    second.dataConfidenceScore - first.dataConfidenceScore ||
    secondRating.ratingValue - firstRating.ratingValue ||
    secondRating.ratingVoteCount - firstRating.ratingVoteCount ||
    second.rawScore - first.rawScore
  )
}

function getMatchTierPriority(matchTier: MatchTier) {
  if (matchTier === 'top') {
    return 5
  }

  if (matchTier === 'high') {
    return 4
  }

  if (matchTier === 'strong') {
    return 3
  }

  if (matchTier === 'good') {
    return 2
  }

  return 1
}

function getRecommendationLoveShare(rating: RecommendationRating | undefined) {
  if (!rating) {
    return null
  }

  const reactionCounts = [
    rating.loveCount,
    rating.likeCount,
    rating.okCount,
    rating.dislikeCount,
    rating.hateCount,
  ]

  if (!reactionCounts.every((count) => typeof count === 'number')) {
    return null
  }

  const total = reactionCounts.reduce((sum, count) => sum + (count ?? 0), 0)

  return total > 0 && typeof rating.loveCount === 'number'
    ? rating.loveCount / total
    : null
}

function getLovedQualityTier(recommendation: ScoredRecommendation) {
  const rating = recommendation.rating
  const loveShare = getRecommendationLoveShare(rating)
  const ratingValue = rating?.ratingValue ?? 0
  const voteCount = rating?.ratingVoteCount ?? 0

  if (loveShare === null) {
    return 0
  }

  if (loveShare >= 0.7 && ratingValue >= 4.3 && voteCount >= 500) {
    return 2
  }

  if (loveShare >= 0.65 && ratingValue >= 4.2 && voteCount >= 5000) {
    return 2
  }

  return 0
}

function hasStrongPromotionRelevance(params: {
  recommendation: ScoredRecommendation
  requestedVibeCount: number
  hasBroadContext: boolean
}) {
  const { recommendation, requestedVibeCount, hasBroadContext } = params
  const strongestRelevanceScore = Math.max(
    recommendation.scentRelevanceScore,
    recommendation.profileScore,
    recommendation.combinedIntentScore,
    recommendation.matchScore,
  )

  if (recommendation.requestedNoteCount >= 2) {
    return (
      recommendation.partiallyMatchedRequestedNoteCount ===
        recommendation.requestedNoteCount &&
      recommendation.matchScore >= 45
    )
  }

  if (recommendation.requestedNoteCount === 1 && requestedVibeCount > 0) {
    return (
      recommendation.partiallyMatchedRequestedNoteCount >= 1 &&
      recommendation.combinedIntentScore >= 55
    )
  }

  if (recommendation.requestedNoteCount === 1) {
    return (
      recommendation.partiallyMatchedRequestedNoteCount >= 1 &&
      strongestRelevanceScore >= 55
    )
  }

  if (hasBroadContext) {
    return recommendation.profileScore >= 55 || recommendation.matchScore >= 70
  }

  return strongestRelevanceScore >= 70
}

function getLovedPromotionScore(recommendation: ScoredRecommendation) {
  const rating = recommendation.rating
  const loveShare = getRecommendationLoveShare(rating) ?? 0
  const ratingValue = rating?.ratingValue ?? 0
  const voteCount = rating?.ratingVoteCount ?? 0
  const relevanceScore = Math.max(
    recommendation.scentRelevanceScore,
    recommendation.profileScore,
    recommendation.combinedIntentScore,
    recommendation.matchScore,
  )

  return (
    getLovedQualityTier(recommendation) * 1000 +
    relevanceScore * 3 +
    loveShare * 240 +
    ratingValue * 25 +
    Math.min(80, Math.log10(voteCount + 1) * 20)
  )
}

function promoteExceptionalLovedMatches(params: {
  recommendations: ScoredRecommendation[]
  requestedVibeCount: number
  hasBroadContext: boolean
}) {
  const { recommendations, requestedVibeCount, hasBroadContext } = params
  const promotedRecommendations = recommendations
    .filter(
      (recommendation) =>
        getLovedQualityTier(recommendation) > 0 &&
        hasStrongPromotionRelevance({
          recommendation,
          requestedVibeCount,
          hasBroadContext,
        }),
    )
    .sort(
      (first, second) =>
        getLovedPromotionScore(second) - getLovedPromotionScore(first) ||
        compareScoredRecommendations(first, second),
    )
    .slice(0, 2)

  if (!promotedRecommendations.length) {
    return recommendations
  }

  const promotedSet = new Set(promotedRecommendations)
  const tierPriorities = Array.from(
    new Set(
      recommendations
        .map((recommendation) => getMatchTierPriority(recommendation.matchTier))
        .sort((first, second) => second - first),
    ),
  )

  return tierPriorities.flatMap((tierPriority) => {
    const tierRecommendations = recommendations.filter(
      (recommendation) =>
        getMatchTierPriority(recommendation.matchTier) === tierPriority,
    )
    const promotedTierRecommendations = tierRecommendations
      .filter((recommendation) => promotedSet.has(recommendation))
      .sort(
        (first, second) =>
          getLovedPromotionScore(second) - getLovedPromotionScore(first) ||
          compareScoredRecommendations(first, second),
      )
    const remainingTierRecommendations = tierRecommendations.filter(
      (recommendation) => !promotedSet.has(recommendation),
    )
    const firstRemaining = remainingTierRecommendations[0]
    const bestPromoted = promotedTierRecommendations[0]
    const shouldPreserveTopResult =
      firstRemaining &&
      bestPromoted &&
      firstRemaining.matchScore >= bestPromoted.matchScore + 12 &&
      firstRemaining.matchedRequestedNoteCount >
        bestPromoted.matchedRequestedNoteCount

    if (shouldPreserveTopResult) {
      return [
        firstRemaining,
        ...promotedTierRecommendations,
        ...remainingTierRecommendations.slice(1),
      ]
    }

    return [...promotedTierRecommendations, ...remainingTierRecommendations]
  })
}

function getDiversityBrandKey(recommendation: ScoredRecommendation) {
  return normalizeReferenceText(recommendation.sourceBrandBatch ?? '') || null
}

function getDiversityProfileKey(recommendation: ScoredRecommendation) {
  const classificationTerms = normalizeClassificationTerms(
    recommendation.classification,
  )
  const classificationProfile =
    getProfileFamiliesFromTerms(classificationTerms)[0] ??
    classificationTerms.find((term) => term.length >= 4)

  if (classificationProfile) {
    return normalizeReferenceText(classificationProfile)
  }

  const noteFamilies = getProfileFamiliesFromTerms(recommendation.allNotes)

  return noteFamilies[0] ? normalizeReferenceText(noteFamilies[0]) : null
}

function getDiversityBroadProfileKey(recommendation: ScoredRecommendation) {
  const directText = normalizeReferenceText(
    [
      recommendation.classification,
      ...recommendation.topNotes,
      ...recommendation.middleNotes,
      ...recommendation.baseNotes,
      ...recommendation.allNotes,
    ].join(' '),
  )
  const profile = getFragranceProfile(recommendation.record)

  if (
    ['oud', 'leather', 'tobacco', 'smoky'].some((term) =>
      directText.includes(term),
    )
  ) {
    return 'dark-oud-leather-tobacco'
  }

  if (
    ['gourmand', 'caramel', 'praline', 'chocolate', 'cacao', 'coffee', 'sugar'].some(
      (term) => directText.includes(term),
    )
  ) {
    return 'dense-sweet-gourmand'
  }

  if (
    profile.overallProfileFamiliesSet.has('fresh') &&
    profile.overallProfileFamiliesSet.has('citrus')
  ) {
    return 'fresh-citrus-aromatic'
  }

  if (
    profile.overallProfileFamiliesSet.has('clean') ||
    profile.overallProfileFamiliesSet.has('musk')
  ) {
    return 'clean-musk'
  }

  if (
    profile.overallProfileFamiliesSet.has('rose') &&
    profile.overallProfileFamiliesSet.has('musk')
  ) {
    return 'rose-musk'
  }

  if (profile.overallProfileFamiliesSet.has('aquatic')) {
    return 'fresh-aquatic'
  }

  if (
    profile.overallProfileFamiliesSet.has('vanilla') &&
    profile.overallProfileFamiliesSet.has('amber')
  ) {
    return 'warm-amber-vanilla'
  }

  return getDiversityProfileKey(recommendation)
}

function getDiversityNoteClusterKey(recommendation: ScoredRecommendation) {
  const profile = getFragranceProfile(recommendation.record)
  const families = Array.from(profile.overallProfileFamiliesSet)
    .map(normalizeReferenceText)
    .filter(Boolean)
    .sort()
    .slice(0, 3)

  return families.length ? families.join('|') : null
}

function getDiversityReferenceAngleKey(recommendation: ScoredRecommendation) {
  return recommendation.referenceDebug?.similarityAngle
    ? normalizeReferenceText(recommendation.referenceDebug.similarityAngle)
    : null
}

function getDiversityReferenceBucketKey(recommendation: ScoredRecommendation) {
  const debug = recommendation.referenceDebug

  if (!debug) {
    return null
  }

  if (debug.sameLayerMatches.length >= 2) {
    return 'same-layer'
  }

  if (debug.nearLayerMatches.length >= 2) {
    return 'near-layer'
  }

  if (debug.accordPairMatches.length > 0) {
    return 'accord-pair'
  }

  return debug.similarityAngle
    ? normalizeReferenceText(debug.similarityAngle)
    : null
}

function getAdaptiveDiversityProtectedCount(
  recommendations: ScoredRecommendation[],
  intent?: RecommendationIntent,
) {
  if (!intent || recommendations.length <= 3) {
    return Math.min(recommendations.length, 3)
  }

  const topScores = recommendations.slice(0, 8).map((recommendation) => recommendation.matchScore)
  const nearTieCount = topScores.filter(
    (score) => Math.abs(score - (topScores[0] ?? 0)) <= 2,
  ).length

  if (intent.promptType === 'reference') {
    return Math.min(recommendations.length, nearTieCount >= 8 ? 6 : 7)
  }

  if (intent.promptType === 'strict_multi_note_combo') {
    return Math.min(recommendations.length, 7)
  }

  if (intent.promptType === 'single_note') {
    return Math.min(recommendations.length, 5)
  }

  if (
    intent.promptType === 'occasion' ||
    intent.promptType === 'season' ||
    intent.promptType === 'time_of_day' ||
    intent.promptType === 'note_plus_vibe'
  ) {
    if (
      intent.promptType === 'note_plus_vibe' &&
      includesPhrase(intent.normalizedMessage, 'not heavy')
    ) {
      return 1
    }

    return Math.min(recommendations.length, nearTieCount >= 6 ? 3 : 4)
  }

  if (intent.promptType === 'broad_vibe') {
    return Math.min(recommendations.length, nearTieCount >= 5 ? 3 : 4)
  }

  return Math.min(recommendations.length, 3)
}

function getDiversityAdjustmentCap(intent?: RecommendationIntent) {
  if (intent?.promptType === 'reference') {
    return 3.5
  }

  if (
    intent?.promptType === 'strict_multi_note_combo' ||
    intent?.promptType === 'single_note'
  ) {
    return 4
  }

  if (
    intent?.promptType === 'broad_vibe' ||
    intent?.promptType === 'occasion' ||
    intent?.promptType === 'season' ||
    intent?.hasBroadContext
  ) {
    return 8
  }

  return 5
}

function incrementDiversityCounts(
  counts: Map<string, number>,
  recommendation: ScoredRecommendation,
) {
  const keys = [
    `brand:${getDiversityBrandKey(recommendation) ?? ''}`,
    `profile:${getDiversityProfileKey(recommendation) ?? ''}`,
    `broad:${getDiversityBroadProfileKey(recommendation) ?? ''}`,
    `cluster:${getDiversityNoteClusterKey(recommendation) ?? ''}`,
    `angle:${getDiversityReferenceAngleKey(recommendation) ?? ''}`,
    `reference:${getDiversityReferenceBucketKey(recommendation) ?? ''}`,
  ].filter((key) => !key.endsWith(':'))

  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

function getDiversityPenalty(params: {
  recommendation: ScoredRecommendation
  counts: Map<string, number>
  intent?: RecommendationIntent
}) {
  const { recommendation, counts, intent } = params
  const broadMultiplier =
    intent?.promptType === 'reference'
      ? 0.45
      : intent?.promptType === 'strict_multi_note_combo'
        ? 0.35
        : intent?.hasBroadContext || intent?.promptType === 'broad_vibe'
          ? 1
          : 0.65
  const penaltyParts = [
    ['brand', getDiversityBrandKey(recommendation), 1.8],
    ['profile', getDiversityProfileKey(recommendation), 1.5],
    ['broad', getDiversityBroadProfileKey(recommendation), 2.2],
    ['cluster', getDiversityNoteClusterKey(recommendation), 1.4],
    ['angle', getDiversityReferenceAngleKey(recommendation), 1.8],
    ['reference', getDiversityReferenceBucketKey(recommendation), 1.3],
  ] as const
  const penalty = penaltyParts.reduce((total, [prefix, key, weight]) => {
    if (!key) {
      return total
    }

    return total + (counts.get(`${prefix}:${key}`) ?? 0) * weight
  }, 0)
  const broadProfileKey = getDiversityBroadProfileKey(recommendation)
  const lightConflictPenalty =
    intent && includesPhrase(intent.normalizedMessage, 'not heavy') &&
    ['dark-oud-leather-tobacco', 'dense-sweet-gourmand', 'warm-amber-vanilla'].includes(
      broadProfileKey ?? '',
    )
      ? 9
      : 0

  return penalty * broadMultiplier + lightConflictPenalty
}

function pickDiverseComparableCandidate(params: {
  candidates: ScoredRecommendation[]
  counts: Map<string, number>
  intent?: RecommendationIntent
}) {
  const { candidates, counts, intent } = params
  const bestCandidate = candidates[0]
  const adjustmentCap = getDiversityAdjustmentCap(intent)
  const comparableCandidates = candidates.filter(
    (candidate) => candidate.matchScore >= bestCandidate.matchScore - adjustmentCap - 1,
  )

  return comparableCandidates
    .map((candidate) => {
      const penalty = Math.min(
        adjustmentCap,
        getDiversityPenalty({ recommendation: candidate, counts, intent }),
      )

      return {
        candidate,
        adjustedScore:
          candidate.matchScore +
          candidate.scentRelevanceScore * 0.02 -
          penalty,
      }
    })
    .sort(
      (first, second) =>
        second.adjustedScore - first.adjustedScore ||
        compareScoredRecommendations(first.candidate, second.candidate),
    )[0]?.candidate ?? bestCandidate
}

function diversifyVisibleRecommendations(
  recommendations: ScoredRecommendation[],
  intent?: RecommendationIntent,
) {
  if (recommendations.length <= 3) {
    return recommendations
  }

  const protectedCount = getAdaptiveDiversityProtectedCount(
    recommendations,
    intent,
  )
  const selected = recommendations.slice(0, protectedCount)
  const selectedSet = new Set(selected)
  const counts = new Map<string, number>()
  const remaining = recommendations
    .slice(protectedCount)
    .filter((recommendation) => !selectedSet.has(recommendation))

  for (const recommendation of selected) {
    incrementDiversityCounts(counts, recommendation)
  }

  while (remaining.length > 0 && selected.length < RECOMMENDATION_LIMIT) {
    const nextRecommendation = pickDiverseComparableCandidate({
      candidates: remaining,
      counts,
      intent,
    })
    const nextIndex = remaining.indexOf(nextRecommendation)

    remaining.splice(nextIndex, 1)
    selected.push(nextRecommendation)
    selectedSet.add(nextRecommendation)
    incrementDiversityCounts(counts, nextRecommendation)
  }

  return selected
}

function withRecommendationEvidence(
  recommendations: ScoredRecommendation[],
  intent: RecommendationIntent,
) {
  const startedAt = Date.now()
  const hydratedRecommendations = recommendations.map((recommendation) => {
    if (
      recommendation.recommendationEvidence &&
      recommendation.aiExplanation &&
      recommendation.matchSummary
    ) {
      return recommendation
    }

    const recommendationEvidence = buildRecommendationEvidence({
      record: recommendation.record,
      intent,
      scentRelevanceLayer: recommendation.scentRelevanceLayer,
      matchTier: recommendation.matchTier,
      missingRequestedNotes: recommendation.missingRequestedNotes,
    })
    const explanationFields = buildStructuredExplanationFields({
      recommendation,
      intent,
      evidence: recommendationEvidence,
    })

    return {
      ...recommendation,
      recommendationEvidence,
      aiExplanation: buildDeterministicExplanation(
        recommendationEvidence,
        recommendation.matchTier,
      ),
      ...explanationFields,
    }
  })

  console.log(
    `[recommendation] evidence hydrated recommendations=${hydratedRecommendations.length} elapsedMs=${Date.now() - startedAt}`,
  )

  return hydratedRecommendations
}

function toPublicRecommendations(
  recommendations: ScoredRecommendation[],
  intent?: RecommendationIntent,
  options: RecommendationResultOptions = {},
) {
  const visibleRecommendations = diversifyVisibleRecommendations(
    recommendations,
    intent,
  )
  const recommendationsWithEvidence = intent
    ? withRecommendationEvidence(visibleRecommendations, intent)
    : visibleRecommendations
  const originalRankByRecord = new Map(
    recommendations.map((recommendation, index) => [recommendation.record, index + 1]),
  )

  return recommendationsWithEvidence
    .map(
      ({
        record,
        scentRelevanceLayer: _scentRelevanceLayer,
        popularityQualityLayer: _popularityQualityLayer,
        wearabilityLayer: _wearabilityLayer,
        rawScore: _rawScore,
        noteScore: _noteScore,
        profileScore: _profileScore,
        wearabilityScore: _wearabilityScore,
        occasionFitScore: _occasionFitScore,
        broadAppealScore: _broadAppealScore,
        wearabilityConflictPenalty: _wearabilityConflictPenalty,
        requestedNoteCount: _requestedNoteCount,
        matchedRequestedNoteCount: _matchedRequestedNoteCount,
        partiallyMatchedRequestedNoteCount:
          _partiallyMatchedRequestedNoteCount,
        missingRequestedNotes: _missingRequestedNotes,
        rankingScore: _rankingScore,
        combinedIntentScore: _combinedIntentScore,
        scentRelevanceScore: _scentRelevanceScore,
        qualityScore: _qualityScore,
        popularityScore: _popularityScore,
        popularityQualityScore: _popularityQualityScore,
        dataConfidenceScore: _dataConfidenceScore,
        finalScore: _finalScore,
        recommendationEvidence: _recommendationEvidence,
        referenceDebug,
        ...recommendation
      }, index) => {
        const originalRank = originalRankByRecord.get(record)
        const diversityReason =
          originalRank &&
          index + 1 >= 4 &&
          originalRank > index + 1 &&
          intent?.promptType !== 'strict_multi_note_combo'
            ? 'Included as a different direction after strong core matches.'
            : null
        const whyItMatches =
          diversityReason && recommendation.whyItMatches
            ? [...recommendation.whyItMatches, diversityReason].slice(0, 4)
            : recommendation.whyItMatches

        return {
          ...recommendation,
          ...(whyItMatches ? { whyItMatches } : {}),
          ...(options.includeReferenceDebug && referenceDebug
            ? { referenceDebug }
            : {}),
        }
      },
    )
}

function precomputeCandidateScoringData(records: RecommendableFragrance[]) {
  const startedAt = Date.now()

  for (const record of records) {
    getCachedRecordNotes(record)
    getCachedNormalizedRecordText(record)
    getRecordAllNotes(record)
    getReferenceSearchNames(record)
    getFragranceProfile(record)
  }

  console.log(
    `[recommendation] normalized candidate precompute complete candidates=${records.length} elapsedMs=${Date.now() - startedAt}`,
  )
}

async function loadFreshRecommendationSourceData(): Promise<RecommendationSourceData> {
  const startedAt = Date.now()
  const [recommendableFragrances, ratingRows] = await Promise.all([
    fetchRecommendableFragrances(),
    fetchFragranceRatings(),
  ])

  const ratingStartedAt = Date.now()
  const ratingMap = buildRatingMap(ratingRows)
  const ratingStats = buildRatingStats(ratingRows)

  console.log(
    `[recommendation] rating data prepared ratings=${ratingRows.length} lookup=${ratingMap.size} elapsedMs=${Date.now() - ratingStartedAt}`,
  )

  const candidateStartedAt = Date.now()
  precomputeCandidateScoringData(recommendableFragrances)

  console.log(
    `[recommendation] candidate preparation ready candidates=${recommendableFragrances.length} elapsedMs=${Date.now() - candidateStartedAt}`,
  )

  const now = Date.now()

  console.log(
    `[recommendation] source cache refreshed fragrances=${recommendableFragrances.length} ratings=${ratingRows.length} elapsedMs=${now - startedAt}`,
  )

  return {
    recommendableFragrances,
    ratingRows,
    ratingMap,
    ratingStats,
    loadedAt: now,
    expiresAt: now + RECOMMENDATION_SOURCE_CACHE_TTL_MS,
  }
}

export function invalidateRecommendationSourceCache() {
  recommendationSourceCache = null
  recommendationSourceLoadPromise = null
  console.log('[recommendation] source cache invalidated')
}

async function getRecommendationSourceData(): Promise<RecommendationSourceData> {
  const startedAt = Date.now()
  const now = Date.now()

  if (recommendationSourceCache && recommendationSourceCache.expiresAt > now) {
    console.log(
      `[recommendation] cache hit fragrances=${recommendationSourceCache.recommendableFragrances.length} ratings=${recommendationSourceCache.ratingRows.length} elapsedMs=${Date.now() - startedAt}`,
    )

    return recommendationSourceCache
  }

  if (recommendationSourceLoadPromise) {
    console.log(
      `[recommendation] cache refresh inFlight stale=${recommendationSourceCache ? 'yes' : 'no'}`,
    )

    try {
      const data = await recommendationSourceLoadPromise

      console.log(
        `[recommendation] cache inFlight ready fragrances=${data.recommendableFragrances.length} ratings=${data.ratingRows.length} elapsedMs=${Date.now() - startedAt}`,
      )

      return data
    } catch (error) {
      if (recommendationSourceCache) {
        console.warn(
          `[recommendation] cache refresh failed serving stale fragrances=${recommendationSourceCache.recommendableFragrances.length} ratings=${recommendationSourceCache.ratingRows.length} elapsedMs=${Date.now() - startedAt}`,
        )

        return recommendationSourceCache
      }

      throw error
    }
  }

  console.log(
    `[recommendation] cache miss loading source data stale=${recommendationSourceCache ? 'yes' : 'no'}`,
  )

  recommendationSourceLoadPromise = loadFreshRecommendationSourceData()

  try {
    const data = await recommendationSourceLoadPromise
    recommendationSourceCache = data
    return data
  } catch (error) {
    if (recommendationSourceCache) {
      console.warn(
        `[recommendation] cache refresh failed serving stale fragrances=${recommendationSourceCache.recommendableFragrances.length} ratings=${recommendationSourceCache.ratingRows.length} elapsedMs=${Date.now() - startedAt}`,
      )

      return recommendationSourceCache
    }

    throw error
  } finally {
    recommendationSourceLoadPromise = null
  }
}

function precomputeIntentScoringData(intent: RecommendationIntent) {
  const startedAt = Date.now()

  for (const vibe of intent.requestedVibes) {
    getExpandedVibeTerms(vibe)
  }

  getRequestedScentFamilies(intent)
  getIntentCompatibilityContext(intent)

  console.log(
    `[recommendation] intent-specific precompute complete notes=${intent.requestedNoteTokens.length} vibes=${intent.requestedVibes.length} occasions=${intent.requestedOccasions.length} elapsedMs=${Date.now() - startedAt}`,
  )
}

function buildScoredRecommendation(params: {
  record: RecommendableFragrance
  rating: RatingRecord | undefined
  ratingStats: RatingStats
  intent: RecommendationIntent
  scentRelevanceLayer: ScentRelevanceLayer
  timing?: ScoringTiming
}) {
  const { record, rating, ratingStats, intent, scentRelevanceLayer, timing } = params
      let sectionStartedAt = Date.now()
      const displayProductName = getDisplayProductName(record)
      const matchedRequestedNoteTokens = getMatchedRequestedNoteTokens(
        record,
        intent.requestedNoteTokens,
      )
      const partiallyMatchedRequestedNoteTokens =
        getPartiallyMatchedRequestedNoteTokens(
          record,
          intent.requestedNoteTokens,
        )
      const requestedNoteCount = intent.requestedNoteTokens.length
      const matchedRequestedNoteCount = matchedRequestedNoteTokens.length
      const requiredNoteCount = intent.intentBuckets.requiredNotes.length
      const matchedRequiredNoteCount = intent.intentBuckets.requiredNotes.filter(
        (noteToken) => matchedRequestedNoteTokens.includes(noteToken),
      ).length
      const partiallyMatchedRequiredNoteCount =
        intent.intentBuckets.requiredNotes.filter((noteToken) =>
          partiallyMatchedRequestedNoteTokens.includes(noteToken),
        ).length
      const partiallyMatchedRequestedNoteCount =
        partiallyMatchedRequestedNoteTokens.length
      const missingRequestedNotes = intent.requestedNoteTokens.filter(
        (noteToken) => !matchedRequestedNoteTokens.includes(noteToken),
      )
      if (timing) {
        timing.finalMappingMs += Date.now() - sectionStartedAt
      }
      sectionStartedAt = Date.now()
      const popularityQualityLayer = scorePopularityQualityLayer({
        rating,
        ratingStats,
        intent,
        scentRelevanceLayer,
        requestedNoteCount,
        requestedVibeCount: intent.requestedVibes.length,
        matchedRequestedNoteCount,
      })
      if (timing) {
        timing.qualityMs += Date.now() - sectionStartedAt
      }
      sectionStartedAt = Date.now()
      const baseRelevanceRawScore = calculateRelevanceRawScore({
        scentRelevanceLayer,
      })
      const rankingScore = intent.hasSeasonIntent
        ? scoreExplicitSeasonIntent({
            noteScore: scentRelevanceLayer.noteRelevanceScore,
            profileScore: scentRelevanceLayer.profileScore,
            ratingScoreBreakdown:
              popularityQualityLayer.ratingScoreBreakdown,
            requestedNoteCount,
            matchedRequestedNoteCount,
          })
        : intent.hasTimeIntent
          ? scoreExplicitTimeIntent({
              noteScore: scentRelevanceLayer.noteRelevanceScore,
              profileScore: scentRelevanceLayer.profileScore,
              ratingScoreBreakdown:
                popularityQualityLayer.ratingScoreBreakdown,
              requestedNoteCount,
              matchedRequestedNoteCount,
            })
        : capMultiNoteMatchScore(
            normalizeMatchScore(baseRelevanceRawScore),
            requiredNoteCount || requestedNoteCount,
            requiredNoteCount ? matchedRequiredNoteCount : matchedRequestedNoteCount,
          )
      const rawScore =
        intent.hasSeasonIntent || intent.hasTimeIntent
          ? Math.max(
              baseRelevanceRawScore,
              (rankingScore / 100) * MAX_RAW_SCORE,
            )
          : baseRelevanceRawScore
      const uncappedMatchScore = intent.hasSeasonIntent
        ? calibrateExplicitSeasonDisplayScore({
            rankingScore,
            profileScore: scentRelevanceLayer.profileScore,
            ratingScoreBreakdown:
              popularityQualityLayer.ratingScoreBreakdown,
            requestedNoteCount,
            matchedRequestedNoteCount,
          })
        : intent.hasTimeIntent
          ? calibrateExplicitTimeDisplayScore({
              rankingScore,
              profileScore: scentRelevanceLayer.profileScore,
              ratingScoreBreakdown:
                popularityQualityLayer.ratingScoreBreakdown,
              requestedNoteCount,
              matchedRequestedNoteCount,
            })
        : rankingScore
      const matchScore = capBroadContextMatchScore({
        matchScore: uncappedMatchScore,
        profileScore: scentRelevanceLayer.profileScore,
        requestedNoteCount,
        requestedVibeCount: intent.requestedVibes.length,
        requestedOccasionCount: intent.requestedOccasions.length,
        ratingReliabilityScore: popularityQualityLayer.ratingReliabilityScore,
        qualityScore: popularityQualityLayer.qualityScore,
        promptType: intent.promptType,
        hasBroadContext: intent.hasBroadContext,
      })
      const combinedIntentCappedMatchScore = capCombinedIntentMatchScore({
        matchScore,
        combinedIntentScore: scentRelevanceLayer.combinedIntentScore,
        requestedNoteCount,
        requestedVibeCount: intent.requestedVibes.length,
        matchedRequestedNoteCount,
      })
      const finalMatchScore = calibrateDisplayedMatchScore({
        score: combinedIntentCappedMatchScore,
        record,
        intent,
        scentRelevanceLayer,
        matchedRequestedNoteCount,
      })
      const requestedNoteEvidenceScoreCap = getRequestedNoteEvidenceScoreCap({
        record,
        requestedNoteTokens: intent.intentBuckets.requiredNotes,
      })
      const noteEvidenceCappedMatchScore =
        requestedNoteEvidenceScoreCap === null
          ? finalMatchScore
          : Math.min(finalMatchScore, requestedNoteEvidenceScoreCap)
      const softSweetNegativeScoreCap = getSoftSweetNegativeScoreCap({
        record,
        intent,
      })
      const freshCitrusOffProfileScoreCap = getFreshCitrusOffProfileScoreCap({
        record,
        intent,
      })
      const safeBroadProfileConflictScoreCap =
        getSafeBroadProfileConflictScoreCap({
          record,
          intent,
        })
      const intentModeCappedMatchScore = applyIntentModeScoringPolicy({
        score: noteEvidenceCappedMatchScore,
        intent,
        scentRelevanceLayer,
        requiredNoteCount,
        matchedRequiredNoteCount,
        partiallyMatchedRequiredNoteCount,
      })
      const layerAwareScoreCap = getLayerAwareScoreCap({
        record,
        intent,
        score: intentModeCappedMatchScore,
        layerAwareScore: scentRelevanceLayer.layerAwareScore,
        matchedRequestedNoteCount,
      })
      const layerAwareCappedMatchScore =
        layerAwareScoreCap === null
          ? intentModeCappedMatchScore
          : Math.min(intentModeCappedMatchScore, layerAwareScoreCap)
      const softSweetCappedMatchScore =
        softSweetNegativeScoreCap === null
          ? layerAwareCappedMatchScore
          : Math.min(layerAwareCappedMatchScore, softSweetNegativeScoreCap)
      const freshCitrusCappedMatchScore =
        freshCitrusOffProfileScoreCap === null
          ? softSweetCappedMatchScore
          : Math.min(softSweetCappedMatchScore, freshCitrusOffProfileScoreCap)
      const safeBroadCappedMatchScore =
        safeBroadProfileConflictScoreCap === null
          ? freshCitrusCappedMatchScore
          : Math.min(
              freshCitrusCappedMatchScore,
              safeBroadProfileConflictScoreCap,
            )
      const compatibilityCappedMatchScore = Math.round(
        clamp(safeBroadCappedMatchScore, 0, scentRelevanceLayer.scoreCap ?? 100),
      )
      const wearabilityLayer = scoreWearabilityLayer({
        record,
        rating,
        intent,
        scentRelevanceLayer,
      })
      const wearabilityAdjustedMatchScore = Math.round(
        clamp(
          compatibilityCappedMatchScore + wearabilityLayer.scoreAdjustment,
          0,
          wearabilityLayer.scoreCap ?? 100,
        ),
      )
      const dataConfidenceScore = calculateDataConfidenceScore(record)
      const broadProfileDisplayScoreCap = getBroadProfileDisplayScoreCap({
        score: wearabilityAdjustedMatchScore,
        intent,
        requestedNoteCount,
        profileScore: scentRelevanceLayer.profileScore,
        qualityScore: popularityQualityLayer.qualityScore,
        ratingReliabilityScore: popularityQualityLayer.ratingReliabilityScore,
        dataConfidenceScore,
      })
      const calibratedMatchScore =
        broadProfileDisplayScoreCap === null
          ? wearabilityAdjustedMatchScore
          : Math.min(
              wearabilityAdjustedMatchScore,
              broadProfileDisplayScoreCap,
            )
      const finalScore = calculateFinalScore({
        relevanceScore: calibratedMatchScore,
        qualityScore: popularityQualityLayer.qualityScore,
        popularityScore: popularityQualityLayer.popularityScore,
        dataConfidenceScore,
      })
      const matchTier = getMatchTier(calibratedMatchScore)
      const scoreBreakdown = buildScoreBreakdown({
        scentRelevanceLayer,
        popularityQualityLayer,
      })
      if (timing) {
        timing.finalMappingMs += Date.now() - sectionStartedAt
      }

      return {
        record,
        scentRelevanceLayer,
        popularityQualityLayer,
        wearabilityLayer,
        mistifyProductName: displayProductName,
        mistifyProductUrl: record.mistifyProductUrl,
        audience: record.audience,
        originalFragranceName: record.originalFragranceName,
        sourceBrandBatch: record.sourceBrandBatch,
        classification: record.classification,
        topNotes: normalizeNotes(record.topNotes),
        middleNotes: normalizeNotes(record.middleNotes),
        baseNotes: normalizeNotes(record.baseNotes),
        allNotes: normalizeNotes(record.allNotes),
        sourceConfidence: record.sourceConfidence,
        sourceUsed: record.sourceUsed,
        sourceStatus: record.sourceStatus,
        rating: buildRecommendationRating(rating),
        rawScore,
        noteScore: scentRelevanceLayer.noteRelevanceScore,
        profileScore: scentRelevanceLayer.profileScore,
        wearabilityScore: wearabilityLayer.wearabilityScore,
        occasionFitScore: wearabilityLayer.occasionFitScore,
        broadAppealScore: wearabilityLayer.broadAppealScore,
        wearabilityConflictPenalty: wearabilityLayer.conflictPenalty,
        requestedNoteCount,
        matchedRequestedNoteCount,
        partiallyMatchedRequestedNoteCount,
        missingRequestedNotes,
        rankingScore,
        combinedIntentScore: scentRelevanceLayer.combinedIntentScore,
        scentRelevanceScore: scentRelevanceLayer.scentRelevanceScore,
        qualityScore: popularityQualityLayer.qualityScore,
        popularityScore: popularityQualityLayer.popularityScore,
        popularityQualityScore:
          popularityQualityLayer.popularityQualityScore,
        dataConfidenceScore,
        finalScore,
        matchScore: calibratedMatchScore,
        matchTier,
        scoreBreakdown,
        referenceDebug: scentRelevanceLayer.referenceDebug,
      }
}

function getScoredRecommendations(params: {
  records: RecommendableFragrance[]
  ratingMap: Map<string, RatingRecord>
  ratingStats: RatingStats
  intent: RecommendationIntent
}) {
  const { records, ratingMap, ratingStats, intent } = params
  const loopStartedAt = Date.now()
  const scoringStartedAt = Date.now()
  const scoringTiming: ScoringTiming = {
    noteMs: 0,
    vibeMs: 0,
    classificationMs: 0,
    occasionMs: 0,
    combinedMs: 0,
    compatibilityMs: 0,
    compatibilityFamilyOverlapMs: 0,
    compatibilityConflictMs: 0,
    compatibilityTextFallbackMs: 0,
    compatibilityCapMs: 0,
    qualityMs: 0,
    finalMappingMs: 0,
  }
  const compatibilityContext = getIntentCompatibilityContext(intent)
  const scoredCandidates = records
    .map((record) => {
      const rating = ratingMap.get(getRatingLookupKey(record))
      const scentRelevanceLayer = scoreScentRelevanceLayer({
        record,
        intent,
        rating,
        timing: scoringTiming,
        compatibilityContext,
      })

      return buildScoredRecommendation({
        record,
        rating,
        ratingStats,
        intent,
        scentRelevanceLayer,
        timing: scoringTiming,
      })
    })
    .filter(
      (recommendation) =>
        recommendation.originalFragranceName?.trim() !== '' &&
        recommendation.rawScore > 0 &&
        !hasHardNegativeIntentConflict(recommendation.record, intent) &&
        !hasContextualOfficeSafetyConflict(recommendation.record, intent) &&
        !hasSoftNegativeRequiredNotePadding(recommendation, intent),
    )
  const scoringElapsedMs = Date.now() - scoringStartedAt
  const relevanceFilterStartedAt = Date.now()
  const filteredRecommendations = scoredCandidates.filter((candidate) =>
    isMeaningfullyRelevantRecommendation({
      recommendation: candidate,
      hasBroadContext: intent.hasBroadContext,
    }),
  )
  const keptRecommendationSet = new Set(
    keepBestRelevantFallbacks({
      recommendations: scoredCandidates,
      filteredRecommendations,
      hasBroadContext: intent.hasBroadContext,
    }),
  )
  const scoredRecommendations = scoredCandidates
    .filter((recommendation) => keptRecommendationSet.has(recommendation))
    .sort(compareScoredRecommendations)
  const relevanceFilterElapsedMs = Date.now() - relevanceFilterStartedAt

  console.log(
    `[recommendation] scoring loop complete scored=${scoredRecommendations.length} scoringElapsedMs=${scoringElapsedMs} relevanceFilterElapsedMs=${relevanceFilterElapsedMs} elapsedMs=${Date.now() - loopStartedAt}`,
  )
  console.log(
    `[recommendation] scoring sections noteMs=${scoringTiming.noteMs} vibeMs=${scoringTiming.vibeMs} classificationMs=${scoringTiming.classificationMs} occasionMs=${scoringTiming.occasionMs} combinedMs=${scoringTiming.combinedMs} compatibilityMs=${scoringTiming.compatibilityMs} qualityMs=${scoringTiming.qualityMs} finalMappingMs=${scoringTiming.finalMappingMs}`,
  )
  console.log(
    `[recommendation] compatibility sections familyOverlapMs=${scoringTiming.compatibilityFamilyOverlapMs} conflictMs=${scoringTiming.compatibilityConflictMs} textFallbackMs=${scoringTiming.compatibilityTextFallbackMs} capMs=${scoringTiming.compatibilityCapMs}`,
  )

  return scoredRecommendations
}

function isSameReferenceRecord(
  first: RecommendableFragrance,
  second: RecommendableFragrance,
) {
  return (
    normalizeReferenceText(first.originalFragranceName ?? '') ===
      normalizeReferenceText(second.originalFragranceName ?? '') &&
    normalizeReferenceText(first.sourceBrandBatch ?? '') ===
      normalizeReferenceText(second.sourceBrandBatch ?? '')
  )
}

function getReferenceRecommendations(params: {
  records: RecommendableFragrance[]
  ratingMap: Map<string, RatingRecord>
  ratingStats: RatingStats
  message: string
  referenceRecord: RecommendableFragrance
  modifiers: ReferenceModifier[]
}) {
  const { records, ratingMap, ratingStats, message, referenceRecord, modifiers } = params
  const loopStartedAt = Date.now()
  const baseIntent = parseRecommendationIntent(message)
  const intent: RecommendationIntent = {
    ...baseIntent,
    promptType: 'reference',
    hasBroadContext: true,
  }
  const referenceRating = ratingMap.get(getRatingLookupKey(referenceRecord))
  const referenceProfile = buildReferenceProfileWithRating(
    referenceRecord,
    referenceRating,
  )
  const bucketStartedAt = Date.now()
  const scoredRecommendations: ScoredRecommendation[] = []
  for (const record of records) {
    if (isSameReferenceRecord(record, referenceRecord)) {
      continue
    }

    const rating = ratingMap.get(getRatingLookupKey(record))

    const scentRelevanceLayer = scoreReferenceSimilarity({
      record,
      rating,
      referenceProfile,
      referenceRating,
      modifiers,
    })
    const recommendation = buildScoredRecommendation({
      record,
      rating,
      ratingStats,
      intent,
      scentRelevanceLayer,
    })

    if (
      recommendation.originalFragranceName?.trim() !== '' &&
      recommendation.rawScore > 0 &&
      recommendation.scentRelevanceScore >= (modifiers.length ? 48 : 58) &&
      recommendation.matchScore >= (modifiers.length ? 52 : 60)
    ) {
      scoredRecommendations.push(recommendation)
    }
  }

  scoredRecommendations.sort(compareScoredRecommendations)

  console.log(
    `[recommendation] reference scoring loop complete scored=${scoredRecommendations.length} elapsedMs=${Date.now() - loopStartedAt}`,
  )
  console.log(
    `[recommendation] reference bucket scoring complete buckets=${referenceProfile.buckets.length} scored=${scoredRecommendations.length} elapsedMs=${Date.now() - bucketStartedAt}`,
  )

  return promoteExceptionalLovedMatches({
    recommendations: scoredRecommendations,
    requestedVibeCount: modifiers.length || intent.requestedVibes.length,
    hasBroadContext: true,
  })
}

function formatReferenceName(record: RecommendableFragrance) {
  return record.originalFragranceName?.trim() || getDisplayProductName(record)
}

function buildReferenceReply(
  referenceRecord: RecommendableFragrance,
  modifiers: ReferenceModifier[],
) {
  const referenceName = formatReferenceName(referenceRecord)
  const modifierLabels = modifiers.map((modifier) => modifier.label)

  if (modifierLabels.length) {
    return `Since you like ${referenceName} but want it ${modifierLabels.join(' and ')}, I looked for similar options with that adjustment.`
  }

  return `Since you like ${referenceName}, here are similar fragrances from the database that keep the same general profile.`
}

function buildMissingReferenceReply() {
  return 'I could not find that fragrance in the database yet. Tell me what you like about it, such as vanilla, fresh citrus, woody, sweet, smoky, or office-safe, and I can recommend from there.'
}

function buildAmbiguousReferenceReply(possibleMatches: RecommendableFragrance[]) {
  const matchNames = possibleMatches
    .slice(0, 3)
    .map(formatReferenceName)
    .filter(Boolean)

  if (!matchNames.length) {
    return buildMissingReferenceReply()
  }

  return `I found a few possible matches: ${matchNames.join(', ')}. Which one did you mean?`
}

function detectBareReferenceIntent(
  message: string,
  records: RecommendableFragrance[],
): ReferenceIntent | null {
  const correctedMessage = correctKnownTermTypos(message)
  const intent = parseRecommendationIntent(correctedMessage)
  const normalizedMessage = stripReferenceLeadIn(correctedMessage)

  if (
    !normalizedMessage ||
    intent.requestedNoteTokens.length > 0 ||
    intent.requestedVibes.length > 0 ||
    intent.requestedOccasions.length > 0 ||
    intent.hasSeasonIntent ||
    intent.hasTimeIntent ||
    isLowConfidenceReferenceQuery(normalizedMessage)
  ) {
    return null
  }

  const referenceMatch = findReferenceFragrance(
    { referenceName: normalizedMessage, modifiers: [] },
    records,
  )

  return referenceMatch && referenceMatch.confidence >= 90
    ? {
        referenceName: normalizedMessage,
        modifiers: [],
      }
    : null
}

function detectLeadingReferenceIntent(
  message: string,
  records: RecommendableFragrance[],
): ReferenceIntent | null {
  const correctedMessage = correctKnownTermTypos(message)
  const tokens = stripReferenceLeadIn(correctedMessage).split(/\s+/).filter(Boolean)

  if (tokens.length < 2) {
    return null
  }

  for (let tokenCount = Math.min(5, tokens.length - 1); tokenCount >= 2; tokenCount -= 1) {
    const referenceName = tokens.slice(0, tokenCount).join(' ')
    const remainingMessage = tokens.slice(tokenCount).join(' ')
    const modifiers = detectReferenceModifiers(remainingMessage)

    if (!modifiers.length) {
      continue
    }

    const referenceMatch = findReferenceFragrance(
      { referenceName, modifiers },
      records,
    )

    if (referenceMatch && referenceMatch.confidence >= 90) {
      return {
        referenceName,
        modifiers,
      }
    }
  }

  return null
}

function buildCorrectionPrefix(originalMessage: string, correctedMessage: string) {
  const normalizedOriginal = normalizeReferenceText(originalMessage)
  const normalizedCorrected = normalizeReferenceText(correctedMessage)

  if (!normalizedCorrected || normalizedOriginal === normalizedCorrected) {
    return ''
  }

  return `I read your request as "${normalizedCorrected}". `
}

function getFragranceRecommendationsFromData(params: {
  message: string
  records: RecommendableFragrance[]
  ratingMap: Map<string, RatingRecord>
  ratingStats: RatingStats
}) {
  const { message, records, ratingMap, ratingStats } = params
  const startedAt = Date.now()

  const intentStartedAt = Date.now()
  const correctedMessage = correctKnownTermTypos(message)
  const intent = parseRecommendationIntent(correctedMessage)

  console.log(
    `[recommendation] intent parsed promptType=${intent.promptType} notes=${intent.requestedNoteTokens.length} vibes=${intent.requestedVibes.length} occasions=${intent.requestedOccasions.length} corrected=${normalizeReferenceText(message) === normalizeReferenceText(correctedMessage) ? 'no' : 'yes'} elapsedMs=${Date.now() - intentStartedAt}`,
  )

  precomputeIntentScoringData(intent)

  const scoringStartedAt = Date.now()
  const scoredRecommendations = getScoredRecommendations({
    records,
    ratingMap,
    ratingStats,
    intent,
  })

  console.log(
    `[recommendation] scoring complete scored=${scoredRecommendations.length} elapsedMs=${Date.now() - scoringStartedAt}`,
  )

  const promotionStartedAt = Date.now()
  const promotedRecommendations = promoteExceptionalLovedMatches({
    recommendations: scoredRecommendations,
    requestedVibeCount: intent.requestedVibes.length,
    hasBroadContext: intent.hasBroadContext,
  })

  console.log(
    `[recommendation] promotion complete promoted=${promotedRecommendations.length} elapsedMs=${Date.now() - promotionStartedAt}`,
  )

  const audienceFilteredRecommendations = applyAudienceIntentFilter(
    promotedRecommendations,
    intent.requestedAudience,
  )

  if (intent.requestedAudience) {
    console.log(
      `[recommendation] audience filter requested=${intent.requestedAudience} before=${promotedRecommendations.length} after=${audienceFilteredRecommendations.length}`,
    )
  }

  const publicStartedAt = Date.now()
  const publicRecommendations = toPublicRecommendations(
    audienceFilteredRecommendations,
    intent,
  )

  console.log(
    `[recommendation] public recommendations=${publicRecommendations.length} elapsedMs=${Date.now() - publicStartedAt} totalElapsedMs=${Date.now() - startedAt}`,
  )

  return {
    correctedMessage,
    recommendations: publicRecommendations,
    searchMode: 'normal' as const,
  }
}

function getReferenceSearchResult(params: {
  startedAt: number
  message: string
  referenceIntent: ReferenceIntent
  recommendableFragrances: RecommendableFragrance[]
  ratingMap: Map<string, RatingRecord>
  ratingStats: RatingStats
  options?: RecommendationResultOptions
}): RecommendationSearchResult {
  const {
    startedAt,
    message,
    referenceIntent,
    recommendableFragrances,
    ratingMap,
    ratingStats,
    options = {},
  } = params

    const referenceMatchStartedAt = Date.now()
    const referenceMatch = findReferenceFragrance(
      referenceIntent,
      recommendableFragrances,
    )

    console.log(
      `[recommendation] reference match checked found=${referenceMatch ? 'yes' : 'no'} elapsedMs=${Date.now() - referenceMatchStartedAt}`,
    )

    if (!referenceMatch) {
      console.log(
        `[recommendation] reference complete recommendations=0 totalElapsedMs=${Date.now() - startedAt}`,
      )

      return {
        reply: buildMissingReferenceReply(),
        recommendations: [],
        searchMode: 'reference',
      }
    }

    if (referenceMatch.confidence < 75) {
      console.log(
        `[recommendation] reference ambiguous confidence=${referenceMatch.confidence} possibleMatches=${referenceMatch.possibleMatches.length} totalElapsedMs=${Date.now() - startedAt}`,
      )

      return {
        reply: buildAmbiguousReferenceReply(referenceMatch.possibleMatches),
        recommendations: [],
        searchMode: 'reference',
      }
    }

    const scoringStartedAt = Date.now()
    const scoredRecommendations = getReferenceRecommendations({
      records: recommendableFragrances,
      ratingMap,
      ratingStats,
      message,
      referenceRecord: referenceMatch.record,
      modifiers: referenceIntent.modifiers,
    })

    console.log(
      `[recommendation] reference scoring complete scored=${scoredRecommendations.length} elapsedMs=${Date.now() - scoringStartedAt}`,
    )

    const referencePublicIntent: RecommendationIntent = {
      ...parseRecommendationIntent(message),
      promptType: 'reference',
      hasBroadContext: true,
    }
    const audienceFilteredRecommendations = applyAudienceIntentFilter(
      scoredRecommendations,
      referencePublicIntent.requestedAudience,
    )

    if (referencePublicIntent.requestedAudience) {
      console.log(
        `[recommendation] reference audience filter requested=${referencePublicIntent.requestedAudience} before=${scoredRecommendations.length} after=${audienceFilteredRecommendations.length}`,
      )
    }

    const publicStartedAt = Date.now()
    const recommendations = toPublicRecommendations(
      audienceFilteredRecommendations,
      referencePublicIntent,
      options,
    )

    console.log(
      `[recommendation] reference public recommendations=${recommendations.length} elapsedMs=${Date.now() - publicStartedAt}`,
    )

    console.log(
      `[recommendation] reference complete recommendations=${recommendations.length} totalElapsedMs=${Date.now() - startedAt}`,
    )

    return {
      reply: recommendations.length
        ? `${buildCorrectionPrefix(message, referenceIntent.referenceName)}${buildReferenceReply(referenceMatch.record, referenceIntent.modifiers)}`
        : 'I found the reference fragrance, but I could not find close alternatives in the current database. Tell me which notes or vibe you want to emphasize and I can search from there.',
      recommendations,
      referenceFragrance: buildReferenceFragrance(
        referenceMatch.record,
        ratingMap.get(getRatingLookupKey(referenceMatch.record)),
      ),
      searchMode: 'reference',
    }
}

function toOptionLabel(value: string) {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\w/g, (letter) => letter.toUpperCase())
}

function uniqueOptionValues(values: string[]) {
  const seen = new Set<string>()

  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase()

      if (!key || seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
}

function buildOptionGroup(label: string, values: string[]) {
  return {
    label,
    options: uniqueOptionValues(values).map((value) => ({
      label: toOptionLabel(value),
      value,
    })),
  }
}

export function getRecommendationOptions() {
  return {
    moods: [
      buildOptionGroup('Popular moods', ['clean', 'warm', 'sexy', 'fresh', 'expensive', 'cozy']),
      buildOptionGroup('Fresh / clean', ['fresh', 'clean', 'bright', 'aromatic', 'green', 'aquatic', 'soft', 'subtle']),
      buildOptionGroup('Warm / rich', ['warm', 'cozy', 'sweet', 'creamy', 'gourmand', 'amber', 'dark', 'smoky', 'boozy']),
      buildOptionGroup('Style direction', ['luxury', 'expensive', 'romantic', 'sexy', 'masculine', 'feminine', 'unisex', 'compliment friendly', 'beginner safe']),
      buildOptionGroup('Scent families', Object.keys(SCENT_INTENT_VIBE_FAMILIES)),
    ],
    occasions: [
      buildOptionGroup('Popular occasions', ['everyday', 'office', 'date night', 'night out', 'gym', 'vacation']),
      buildOptionGroup('Season / weather', ['hot weather', 'summer profile', 'winter profile', 'fall profile', 'spring profile', 'cozy']),
      buildOptionGroup('Setting', ['school', 'formal', 'party', 'clean office', 'performance']),
    ],
    notes: [
      buildOptionGroup('Popular notes', ['citrus', 'vanilla', 'amber', 'musk', 'oud', 'aquatic', 'rose', 'tobacco']),
      buildOptionGroup('All recognized notes', [...NOTE_ALLOWLIST, ...SCENT_INTENT_NOTE_ALLOWLIST]),
      buildOptionGroup('Engine note families', Object.keys({ ...NOTE_FAMILIES, ...SCENT_INTENT_NOTE_FAMILIES })),
    ],
    avoids: [
      buildOptionGroup('Common avoids', ['too sweet', 'too powdery', 'too smoky', 'too loud', 'too mature', 'too sharp']),
      buildOptionGroup('Freshness / weight', ['too fresh', 'too aquatic', 'too green', 'too heavy', 'too dark', 'too dense']),
      buildOptionGroup('Sweet / gourmand', ['too sweet', 'too sugary', 'too gourmand', 'too vanilla', 'too fruity', 'too synthetic']),
      buildOptionGroup('Dark notes', ['too smoky', 'too leathery', 'too much oud', 'too much tobacco', 'too spicy', 'too animalic']),
    ],
  }
}

export async function getFragranceRecommendationResult(
  message: string,
  options: RecommendationResultOptions = {},
): Promise<RecommendationSearchResult> {
  const startedAt = Date.now()
  const dataStartedAt = Date.now()
  const {
    recommendableFragrances,
    ratingMap,
    ratingStats,
    ratingRows,
  } = await getRecommendationSourceData()

  console.log(
    `[recommendation] data ready fragrances=${recommendableFragrances.length} ratings=${ratingRows.length} elapsedMs=${Date.now() - dataStartedAt}`,
  )

  const correctedMessage = correctKnownTermTypos(message)
  const referenceIntent =
    detectReferenceIntent(correctedMessage) ??
    detectLeadingReferenceIntent(correctedMessage, recommendableFragrances) ??
    detectBareReferenceIntent(correctedMessage, recommendableFragrances)

  if (referenceIntent) {
    return getReferenceSearchResult({
      startedAt,
      message,
      referenceIntent,
      recommendableFragrances,
      ratingMap,
      ratingStats,
      options,
    })
  }

  const normalStartedAt = Date.now()
  const { correctedMessage: correctedNormalMessage, recommendations } =
    getFragranceRecommendationsFromData({
      message,
      records: recommendableFragrances,
      ratingMap,
      ratingStats,
    })

  console.log(
    `[recommendation] normal complete recommendations=${recommendations.length} elapsedMs=${Date.now() - normalStartedAt} totalElapsedMs=${Date.now() - startedAt}`,
  )

  return {
    reply: recommendations.length
      ? `${buildCorrectionPrefix(message, correctedNormalMessage)}I found a few Mistify fragrances that may fit your request.`
      : 'I could not find a close Mistify match from the current fragrance data. Try asking for a specific note like vanilla, oud, rose, amber, musk, or citrus.',
    recommendations,
  }
}

export async function getFragranceRecommendations(
  message: string,
): Promise<FragranceRecommendation[]> {
  const startedAt = Date.now()
  const dataStartedAt = Date.now()
  const {
    recommendableFragrances,
    ratingMap,
    ratingStats,
    ratingRows,
  } = await getRecommendationSourceData()

  console.log(
    `[recommendation] data ready fragrances=${recommendableFragrances.length} ratings=${ratingRows.length} elapsedMs=${Date.now() - dataStartedAt}`,
  )

  const { recommendations } = getFragranceRecommendationsFromData({
    message,
    records: recommendableFragrances,
    ratingMap,
    ratingStats,
  })

  console.log(
    `[recommendation] recommendations complete recommendations=${recommendations.length} totalElapsedMs=${Date.now() - startedAt}`,
  )

  return recommendations
}
