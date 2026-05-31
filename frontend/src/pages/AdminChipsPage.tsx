import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from 'react'
import type { DragEvent, FormEvent, ReactNode, SetStateAction } from 'react'
import {
  addAdminChipFragrance,
  bulkCreateAdminPromptChips,
  createAdminChip,
  createAdminPromptChip,
  deleteAdminChip,
  deleteAdminPromptChip,
  getAdminChipFragrances,
  getAdminChips,
  getAdminPromptChips,
  removeAdminChipFragrance,
  reorderAdminPromptChips,
  searchAdminFragrances,
  updateAdminChip,
  updateAdminChipFragrance,
  updateAdminPromptChip,
} from '../api/adminApi'
import type {
  AdminChip,
  AdminChipFragrance,
  AdminProduct,
  AdminPromptChip,
} from '../api/adminApi'

type AdminChipsPageProps = {
  token: string
  onLogout: () => void
}

type ChipDraft = {
  label: string
  description: string
  isActive: boolean
  sortOrder: number
}

type PromptChipDraft = {
  label: string
  prompt: string
  isActive: boolean
  sortOrder: number
}

type ChipMembership = {
  chipId: number
  label: string
}

type AdminSearchFragrance = AdminProduct & {
  chipMemberships?: ChipMembership[]
}

type ManagerTab = 'selected' | 'reorder' | 'add'

const maxActiveGenericPromptChips = 30
const maxCuratedChipFragrances = 25

type BulkPreviewRow = {
  rowNumber: number
  label: string
  prompt: string
  sortOrder: number
  status: 'valid' | 'skipped' | 'invalid'
  reason?: string
}

type PendingDelete =
  | {
      type: 'promptChip'
      id: number
      title: string
      message: string
      confirmLabel: string
    }
  | {
      type: 'curatedChip'
      id: number
      title: string
      message: string
      confirmLabel: string
    }
  | {
      type: 'chipFragrance'
      fragranceId: number
      title: string
      message: string
      confirmLabel: string
    }

const emptyCuratedDraft: ChipDraft = {
  label: '',
  description: '',
  isActive: true,
  sortOrder: 0,
}

const emptyPromptDraft: PromptChipDraft = {
  label: '',
  prompt: '',
  isActive: true,
  sortOrder: 0,
}

function toCuratedDraft(chip: AdminChip): ChipDraft {
  return {
    label: chip.label,
    description: chip.description ?? '',
    isActive: chip.isActive,
    sortOrder: chip.sortOrder,
  }
}

function toPromptDraft(chip: AdminPromptChip): PromptChipDraft {
  return {
    label: chip.label,
    prompt: chip.prompt,
    isActive: chip.isActive,
    sortOrder: chip.sortOrder,
  }
}

function fragranceName(fragrance: AdminProduct) {
  return fragrance.mistifyProductName?.trim() || fragrance.originalFragranceName || 'Untitled'
}

function notesPreview(fragrance: AdminProduct) {
  const notes = [
    ...fragrance.allNotes,
    ...fragrance.topNotes,
    ...fragrance.middleNotes,
    ...fragrance.baseNotes,
  ].filter(Boolean)
  const uniqueNotes = Array.from(new Set(notes))

  return uniqueNotes.slice(0, 6).join(', ') || 'No notes'
}

function FieldLabel({
  label,
  helper,
  children,
}: {
  label: string
  helper: string
  children: ReactNode
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
      <small>{helper}</small>
    </label>
  )
}

function ActiveToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`admin-toggle ${checked ? 'active' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-toggle-track" aria-hidden="true">
        <span className="admin-toggle-thumb" />
      </span>
      <span>{checked ? 'Active' : 'Inactive'}</span>
    </button>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`admin-status-pill ${active ? 'active' : ''}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
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

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"'
      index += 1
    } else if (character === '"') {
      inQuotes = !inQuotes
    } else if (character === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  values.push(current.trim())
  return values
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_]+/g, '')
}

function normalizeDuplicateValue(value: string) {
  return value.trim().toLowerCase()
}

type AdminChipsState = {
  chips: AdminChip[]
  promptChips: AdminPromptChip[]
  managedChipId: number | null
  createCuratedDraft: ChipDraft
  createPromptDraft: PromptChipDraft
  editCuratedDrafts: Record<number, ChipDraft>
  editPromptDrafts: Record<number, PromptChipDraft>
  editingCuratedChipId: number | null
  editingPromptChipId: number | null
  selectedFragrances: AdminChipFragrance[]
  searchQuery: string
  searchResults: AdminSearchFragrance[]
  chipMessage: { section: 'generic' | 'curated'; text: string } | null
  managerMessage: string
  error: string
  genericError: string
  curatedError: string
  managerError: string
  bulkModalOpen: boolean
  bulkCsvText: string
  bulkPreviewRows: BulkPreviewRow[]
  bulkError: string
  bulkSummary: string
  bulkPreviewReady: boolean
  pendingDelete: PendingDelete | null
  isDeleting: boolean
  managerTab: ManagerTab
  dirtySelectionIds: Set<number>
  isSavingSelections: boolean
  isAddingFragranceId: number | null
  selectionReorderDraft: AdminChipFragrance[]
  isSelectionReorderDirty: boolean
  isSelectionOrderSaved: boolean
  draggedSelectionFragranceId: number | null
  dragOverSelectionFragranceId: number | null
  isPromptReorderMode: boolean
  promptReorderDraft: AdminPromptChip[]
  isSavingPromptOrder: boolean
  draggedPromptChipId: number | null
  dragOverPromptChipId: number | null
  isCuratedReorderMode: boolean
  curatedReorderDraft: AdminChip[]
  isSavingCuratedOrder: boolean
  draggedCuratedChipId: number | null
  dragOverCuratedChipId: number | null
}

type AdminChipsAction<K extends keyof AdminChipsState = keyof AdminChipsState> =
  | {
      type: 'setField'
      field: K
      value: SetStateAction<AdminChipsState[K]>
    }
  | { type: 'clearManagedSelection' }

const initialAdminChipsState: AdminChipsState = {
  chips: [],
  promptChips: [],
  managedChipId: null,
  createCuratedDraft: emptyCuratedDraft,
  createPromptDraft: emptyPromptDraft,
  editCuratedDrafts: {},
  editPromptDrafts: {},
  editingCuratedChipId: null,
  editingPromptChipId: null,
  selectedFragrances: [],
  searchQuery: '',
  searchResults: [],
  chipMessage: null,
  managerMessage: '',
  error: '',
  genericError: '',
  curatedError: '',
  managerError: '',
  bulkModalOpen: false,
  bulkCsvText: '',
  bulkPreviewRows: [],
  bulkError: '',
  bulkSummary: '',
  bulkPreviewReady: false,
  pendingDelete: null,
  isDeleting: false,
  managerTab: 'selected',
  dirtySelectionIds: new Set(),
  isSavingSelections: false,
  isAddingFragranceId: null,
  selectionReorderDraft: [],
  isSelectionReorderDirty: false,
  isSelectionOrderSaved: false,
  draggedSelectionFragranceId: null,
  dragOverSelectionFragranceId: null,
  isPromptReorderMode: false,
  promptReorderDraft: [],
  isSavingPromptOrder: false,
  draggedPromptChipId: null,
  dragOverPromptChipId: null,
  isCuratedReorderMode: false,
  curatedReorderDraft: [],
  isSavingCuratedOrder: false,
  draggedCuratedChipId: null,
  dragOverCuratedChipId: null,
}

function adminChipsReducer(
  state: AdminChipsState,
  action: AdminChipsAction,
): AdminChipsState {
  if (action.type === 'clearManagedSelection') {
    return {
      ...state,
      selectedFragrances: [],
      searchResults: [],
      searchQuery: '',
      dirtySelectionIds: new Set(),
    }
  }

  const previousValue = state[action.field]
  const nextValue =
    typeof action.value === 'function'
      ? (action.value as (value: typeof previousValue) => typeof previousValue)(previousValue)
      : action.value

  return Object.is(previousValue, nextValue)
    ? state
    : { ...state, [action.field]: nextValue }
}

function useAdminChipsState() {
  const [state, dispatch] = useReducer(adminChipsReducer, initialAdminChipsState)
  const setAdminChipsField = useCallback(
    <K extends keyof AdminChipsState>(
      field: K,
      value: SetStateAction<AdminChipsState[K]>,
    ) => dispatch({ type: 'setField', field, value } as AdminChipsAction),
    [],
  )
  const setters = useMemo(
    () => ({
      setChips: (value: SetStateAction<AdminChipsState['chips']>) => setAdminChipsField('chips', value),
      setPromptChips: (value: SetStateAction<AdminChipsState['promptChips']>) => setAdminChipsField('promptChips', value),
      setManagedChipId: (value: SetStateAction<AdminChipsState['managedChipId']>) => setAdminChipsField('managedChipId', value),
      setCreateCuratedDraft: (value: SetStateAction<AdminChipsState['createCuratedDraft']>) => setAdminChipsField('createCuratedDraft', value),
      setCreatePromptDraft: (value: SetStateAction<AdminChipsState['createPromptDraft']>) => setAdminChipsField('createPromptDraft', value),
      setEditCuratedDrafts: (value: SetStateAction<AdminChipsState['editCuratedDrafts']>) => setAdminChipsField('editCuratedDrafts', value),
      setEditPromptDrafts: (value: SetStateAction<AdminChipsState['editPromptDrafts']>) => setAdminChipsField('editPromptDrafts', value),
      setEditingCuratedChipId: (value: SetStateAction<AdminChipsState['editingCuratedChipId']>) => setAdminChipsField('editingCuratedChipId', value),
      setEditingPromptChipId: (value: SetStateAction<AdminChipsState['editingPromptChipId']>) => setAdminChipsField('editingPromptChipId', value),
      setSelectedFragrances: (value: SetStateAction<AdminChipsState['selectedFragrances']>) => setAdminChipsField('selectedFragrances', value),
      setSearchQuery: (value: SetStateAction<AdminChipsState['searchQuery']>) => setAdminChipsField('searchQuery', value),
      setSearchResults: (value: SetStateAction<AdminChipsState['searchResults']>) => setAdminChipsField('searchResults', value),
      setChipMessage: (value: SetStateAction<AdminChipsState['chipMessage']>) => setAdminChipsField('chipMessage', value),
      setManagerMessage: (value: SetStateAction<AdminChipsState['managerMessage']>) => setAdminChipsField('managerMessage', value),
      setError: (value: SetStateAction<AdminChipsState['error']>) => setAdminChipsField('error', value),
      setGenericError: (value: SetStateAction<AdminChipsState['genericError']>) => setAdminChipsField('genericError', value),
      setCuratedError: (value: SetStateAction<AdminChipsState['curatedError']>) => setAdminChipsField('curatedError', value),
      setManagerError: (value: SetStateAction<AdminChipsState['managerError']>) => setAdminChipsField('managerError', value),
      setBulkModalOpen: (value: SetStateAction<AdminChipsState['bulkModalOpen']>) => setAdminChipsField('bulkModalOpen', value),
      setBulkCsvText: (value: SetStateAction<AdminChipsState['bulkCsvText']>) => setAdminChipsField('bulkCsvText', value),
      setBulkPreviewRows: (value: SetStateAction<AdminChipsState['bulkPreviewRows']>) => setAdminChipsField('bulkPreviewRows', value),
      setBulkError: (value: SetStateAction<AdminChipsState['bulkError']>) => setAdminChipsField('bulkError', value),
      setBulkSummary: (value: SetStateAction<AdminChipsState['bulkSummary']>) => setAdminChipsField('bulkSummary', value),
      setBulkPreviewReady: (value: SetStateAction<AdminChipsState['bulkPreviewReady']>) => setAdminChipsField('bulkPreviewReady', value),
      setPendingDelete: (value: SetStateAction<AdminChipsState['pendingDelete']>) => setAdminChipsField('pendingDelete', value),
      setIsDeleting: (value: SetStateAction<AdminChipsState['isDeleting']>) => setAdminChipsField('isDeleting', value),
      setManagerTab: (value: SetStateAction<AdminChipsState['managerTab']>) => setAdminChipsField('managerTab', value),
      setDirtySelectionIds: (value: SetStateAction<AdminChipsState['dirtySelectionIds']>) => setAdminChipsField('dirtySelectionIds', value),
      setIsSavingSelections: (value: SetStateAction<AdminChipsState['isSavingSelections']>) => setAdminChipsField('isSavingSelections', value),
      setIsAddingFragranceId: (value: SetStateAction<AdminChipsState['isAddingFragranceId']>) => setAdminChipsField('isAddingFragranceId', value),
      setSelectionReorderDraft: (value: SetStateAction<AdminChipsState['selectionReorderDraft']>) => setAdminChipsField('selectionReorderDraft', value),
      setIsSelectionReorderDirty: (value: SetStateAction<AdminChipsState['isSelectionReorderDirty']>) => setAdminChipsField('isSelectionReorderDirty', value),
      setIsSelectionOrderSaved: (value: SetStateAction<AdminChipsState['isSelectionOrderSaved']>) => setAdminChipsField('isSelectionOrderSaved', value),
      setDraggedSelectionFragranceId: (value: SetStateAction<AdminChipsState['draggedSelectionFragranceId']>) => setAdminChipsField('draggedSelectionFragranceId', value),
      setDragOverSelectionFragranceId: (value: SetStateAction<AdminChipsState['dragOverSelectionFragranceId']>) => setAdminChipsField('dragOverSelectionFragranceId', value),
      setIsPromptReorderMode: (value: SetStateAction<AdminChipsState['isPromptReorderMode']>) => setAdminChipsField('isPromptReorderMode', value),
      setPromptReorderDraft: (value: SetStateAction<AdminChipsState['promptReorderDraft']>) => setAdminChipsField('promptReorderDraft', value),
      setIsSavingPromptOrder: (value: SetStateAction<AdminChipsState['isSavingPromptOrder']>) => setAdminChipsField('isSavingPromptOrder', value),
      setDraggedPromptChipId: (value: SetStateAction<AdminChipsState['draggedPromptChipId']>) => setAdminChipsField('draggedPromptChipId', value),
      setDragOverPromptChipId: (value: SetStateAction<AdminChipsState['dragOverPromptChipId']>) => setAdminChipsField('dragOverPromptChipId', value),
      setIsCuratedReorderMode: (value: SetStateAction<AdminChipsState['isCuratedReorderMode']>) => setAdminChipsField('isCuratedReorderMode', value),
      setCuratedReorderDraft: (value: SetStateAction<AdminChipsState['curatedReorderDraft']>) => setAdminChipsField('curatedReorderDraft', value),
      setIsSavingCuratedOrder: (value: SetStateAction<AdminChipsState['isSavingCuratedOrder']>) => setAdminChipsField('isSavingCuratedOrder', value),
      setDraggedCuratedChipId: (value: SetStateAction<AdminChipsState['draggedCuratedChipId']>) => setAdminChipsField('draggedCuratedChipId', value),
      setDragOverCuratedChipId: (value: SetStateAction<AdminChipsState['dragOverCuratedChipId']>) => setAdminChipsField('dragOverCuratedChipId', value),
    }),
    [setAdminChipsField],
  )
  const clearManagedSelection = useCallback(
    () => dispatch({ type: 'clearManagedSelection' }),
    [],
  )

  return {
    ...state,
    ...setters,
    clearManagedSelection,
  }
}

function useAdminChipsPageContent({ token, onLogout }: AdminChipsPageProps) {
  const {
    chips,
    setChips,
    promptChips,
    setPromptChips,
    managedChipId,
    setManagedChipId,
    createCuratedDraft,
    setCreateCuratedDraft,
    createPromptDraft,
    setCreatePromptDraft,
    editCuratedDrafts,
    setEditCuratedDrafts,
    editPromptDrafts,
    setEditPromptDrafts,
    editingCuratedChipId,
    setEditingCuratedChipId,
    editingPromptChipId,
    setEditingPromptChipId,
    selectedFragrances,
    setSelectedFragrances,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    chipMessage,
    setChipMessage,
    managerMessage,
    setManagerMessage,
    error,
    setError,
    genericError,
    setGenericError,
    curatedError,
    setCuratedError,
    managerError,
    setManagerError,
    bulkModalOpen,
    setBulkModalOpen,
    bulkCsvText,
    setBulkCsvText,
    bulkPreviewRows,
    setBulkPreviewRows,
    bulkError,
    setBulkError,
    bulkSummary,
    setBulkSummary,
    bulkPreviewReady,
    setBulkPreviewReady,
    pendingDelete,
    setPendingDelete,
    isDeleting,
    setIsDeleting,
    managerTab,
    setManagerTab,
    dirtySelectionIds,
    setDirtySelectionIds,
    isSavingSelections,
    setIsSavingSelections,
    isAddingFragranceId,
    setIsAddingFragranceId,
    selectionReorderDraft,
    setSelectionReorderDraft,
    isSelectionReorderDirty,
    setIsSelectionReorderDirty,
    isSelectionOrderSaved,
    setIsSelectionOrderSaved,
    draggedSelectionFragranceId,
    setDraggedSelectionFragranceId,
    dragOverSelectionFragranceId,
    setDragOverSelectionFragranceId,
    isPromptReorderMode,
    setIsPromptReorderMode,
    promptReorderDraft,
    setPromptReorderDraft,
    isSavingPromptOrder,
    setIsSavingPromptOrder,
    draggedPromptChipId,
    setDraggedPromptChipId,
    dragOverPromptChipId,
    setDragOverPromptChipId,
    isCuratedReorderMode,
    setIsCuratedReorderMode,
    curatedReorderDraft,
    setCuratedReorderDraft,
    isSavingCuratedOrder,
    setIsSavingCuratedOrder,
    draggedCuratedChipId,
    setDraggedCuratedChipId,
    dragOverCuratedChipId,
    setDragOverCuratedChipId,
    clearManagedSelection,
  } = useAdminChipsState()

  const managedChip = chips.find((chip) => chip.id === managedChipId) ?? null
  const selectedFragranceIds = useMemo(
    () => new Set(selectedFragrances.map((selection) => selection.fragranceId)),
    [selectedFragrances],
  )
  const validBulkRows = bulkPreviewRows.filter((row) => row.status === 'valid')
  const hasUnsavedSelectionEdits = dirtySelectionIds.size > 0
  const hasManagerBlockingEdits = hasUnsavedSelectionEdits || isSelectionReorderDirty

  const loadChips = useCallback(async () => {
    const response = await getAdminChips(token)
    setChips(response.chips)
    setEditCuratedDrafts(
      Object.fromEntries(response.chips.map((chip) => [chip.id, toCuratedDraft(chip)])),
    )
    setManagedChipId((current) =>
      current && response.chips.some((chip) => chip.id === current) ? current : null,
    )
  }, [setChips, setEditCuratedDrafts, setManagedChipId, token])

  const loadPromptChips = useCallback(async () => {
    const response = await getAdminPromptChips(token)
    setPromptChips(response.chips)
    setEditPromptDrafts(
      Object.fromEntries(response.chips.map((chip) => [chip.id, toPromptDraft(chip)])),
    )
  }, [setEditPromptDrafts, setPromptChips, token])

  const loadSelectedFragrances = useCallback(async (chipId: number) => {
    const response = await getAdminChipFragrances(token, chipId)
    setSelectedFragrances(response.fragrances)
    setDirtySelectionIds(new Set())
    return response.fragrances
  }, [setDirtySelectionIds, setSelectedFragrances, token])

  useEffect(() => {
    let ignore = false

    Promise.resolve()
      .then(() => loadChips())
      .catch(() => {
        if (!ignore) {
          setCuratedError('Could not load curated chips. Try refreshing.')
        }
      })
    Promise.resolve()
      .then(() => loadPromptChips())
      .catch(() => {
        if (!ignore) {
          setGenericError('Could not load generic helper chips. Try refreshing.')
        }
      })

    return () => {
      ignore = true
    }
  }, [loadChips, loadPromptChips, setCuratedError, setGenericError])

  useEffect(() => {
    let ignore = false

    if (!managedChipId) {
      Promise.resolve().then(() => {
        if (ignore) return

        clearManagedSelection()
      })

      return () => {
        ignore = true
      }
    }

    Promise.resolve()
      .then(() => loadSelectedFragrances(managedChipId))
      .catch(() => {
        if (!ignore) {
          setManagerError('Could not load selected fragrances. Try refreshing.')
        }
      })

    return () => {
      ignore = true
    }
  }, [
    loadSelectedFragrances,
    managedChipId,
    clearManagedSelection,
    setManagerError,
  ])

  const closeManagerModal = useCallback(() => {
    setManagedChipId(null)
    setManagerMessage('')
    setManagerError('')
    setError('')
    setSearchQuery('')
    setSearchResults([])
    setDirtySelectionIds(new Set())
    setSelectionReorderDraft([])
    setIsSelectionReorderDirty(false)
    setIsSelectionOrderSaved(false)
    setDraggedSelectionFragranceId(null)
    setDragOverSelectionFragranceId(null)
  }, [
    setDirtySelectionIds,
    setDragOverSelectionFragranceId,
    setDraggedSelectionFragranceId,
    setError,
    setIsSelectionOrderSaved,
    setIsSelectionReorderDirty,
    setManagedChipId,
    setManagerError,
    setManagerMessage,
    setSearchQuery,
    setSearchResults,
    setSelectionReorderDraft,
  ])
  const closeManagerModalEffect = useEffectEvent(closeManagerModal)

  useEffect(() => {
    const hasOpenModal = Boolean(pendingDelete || bulkModalOpen || managedChip)

    if (!hasOpenModal) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isDeleting) {
        if (pendingDelete) {
          setPendingDelete(null)
        } else if (managedChip && !hasManagerBlockingEdits) {
          closeManagerModalEffect()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('modal-open')

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('modal-open')
    }
  }, [
    pendingDelete,
    bulkModalOpen,
    managedChip,
    isDeleting,
    hasManagerBlockingEdits,
    setPendingDelete,
  ])

  async function refreshManagedChip() {
    if (!managedChipId) return

    await Promise.all([loadChips(), loadSelectedFragrances(managedChipId)])
    if (searchQuery.trim()) {
      const response = await searchAdminFragrances(token, searchQuery.trim())
      setSearchResults(response.fragrances as AdminSearchFragrance[])
    }
  }

  function openManagerModal(chipId: number) {
    setManagedChipId(chipId)
    setManagerTab('selected')
    setManagerMessage('')
    setManagerError('')
    setError('')
    setDirtySelectionIds(new Set())
    setSelectionReorderDraft([])
    setIsSelectionReorderDirty(false)
    setIsSelectionOrderSaved(false)
    setDraggedSelectionFragranceId(null)
    setDragOverSelectionFragranceId(null)
  }

  function openManagerTab(tab: ManagerTab) {
    setManagerMessage('')
    setManagerError('')
    setError('')

    if (tab === 'reorder') {
      setSelectionReorderDraft([...selectedFragrances])
      setIsSelectionReorderDirty(false)
      setIsSelectionOrderSaved(false)
      setDraggedSelectionFragranceId(null)
      setDragOverSelectionFragranceId(null)
    }

    setManagerTab(tab)
  }

  function updateSelectedFragranceDraft(
    fragranceId: number,
    updates: Partial<Pick<AdminChipFragrance, 'sortOrder' | 'adminNote'>>,
  ) {
    setSelectedFragrances((current) =>
      current.map((item) =>
        item.fragranceId === fragranceId ? { ...item, ...updates } : item,
      ),
    )
    setDirtySelectionIds((current) => new Set(current).add(fragranceId))
  }

  async function handleCreatePromptChip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setChipMessage(null)

    try {
      await createAdminPromptChip(token, {
        ...createPromptDraft,
        sortOrder: promptChips.reduce((highest, chip) => Math.max(highest, chip.sortOrder), -1) + 1,
      })
      setCreatePromptDraft(emptyPromptDraft)
      await loadPromptChips()
      setChipMessage({ section: 'generic', text: 'Generic helper chip created at the end of the list.' })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create generic helper chip.')
    }
  }

  function handleEditPromptChip(chip: AdminPromptChip) {
    setEditingPromptChipId(chip.id)
    setEditPromptDrafts((current) => ({ ...current, [chip.id]: toPromptDraft(chip) }))
  }

  function handleCancelPromptChip(chip: AdminPromptChip) {
    setEditingPromptChipId(null)
    setEditPromptDrafts((current) => ({ ...current, [chip.id]: toPromptDraft(chip) }))
  }

  async function handleSavePromptChip(chipId: number) {
    const draft = editPromptDrafts[chipId]

    if (!draft) return

    setError('')
    setChipMessage(null)

    try {
      const response = await updateAdminPromptChip(token, chipId, draft)
      setPromptChips((current) => current.map((chip) => (chip.id === chipId ? response.chip : chip)))
      setEditPromptDrafts((current) => ({ ...current, [chipId]: toPromptDraft(response.chip) }))
      setEditingPromptChipId(null)
      setChipMessage({ section: 'generic', text: 'Generic helper chip saved.' })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save generic helper chip.')
    }
  }

  function handleDeletePromptChip(chipId: number) {
    const chip = promptChips.find((currentChip) => currentChip.id === chipId)

    setPendingDelete({
      type: 'promptChip',
      id: chipId,
      title: 'Delete Generic Helper Chip',
      message: `Delete "${chip?.label ?? chipId}"? This permanently removes the helper chip from the admin list.`,
      confirmLabel: 'Delete Chip',
    })
  }

  function startPromptReorderMode() {
    setError('')
    setChipMessage(null)
    setEditingPromptChipId(null)
    setDraggedPromptChipId(null)
    setDragOverPromptChipId(null)
    setPromptReorderDraft([...promptChips])
    setIsPromptReorderMode(true)
  }

  function cancelPromptReorderMode() {
    setPromptReorderDraft([])
    setIsPromptReorderMode(false)
    setDraggedPromptChipId(null)
    setDragOverPromptChipId(null)
    setError('')
  }

  function movePromptChip(fromIndex: number, toIndex: number) {
    setPromptReorderDraft((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current
      }

      const next = [...current]
      const [movedChip] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedChip)
      return next
    })
  }

  function movePromptChipById(draggedChipId: number, targetChipId: number) {
    setPromptReorderDraft((current) => {
      const fromIndex = current.findIndex((chip) => chip.id === draggedChipId)
      const toIndex = current.findIndex((chip) => chip.id === targetChipId)

      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex === toIndex
      ) {
        return current
      }

      const next = [...current]
      const [movedChip] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedChip)
      return next
    })
  }

  function handlePromptDragStart(event: DragEvent<HTMLElement>, chipId: number) {
    setDraggedPromptChipId(chipId)
    setDragOverPromptChipId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(chipId))
  }

  function handlePromptDragOver(event: DragEvent<HTMLElement>, chipId: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (draggedPromptChipId !== chipId) {
      setDragOverPromptChipId(chipId)
    }
  }

  function handlePromptDrop(event: DragEvent<HTMLElement>, chipId: number) {
    event.preventDefault()
    const draggedId = draggedPromptChipId ?? Number(event.dataTransfer.getData('text/plain'))

    if (Number.isFinite(draggedId)) {
      movePromptChipById(draggedId, chipId)
    }

    setDraggedPromptChipId(null)
    setDragOverPromptChipId(null)
  }

  function handlePromptDragEnd() {
    setDraggedPromptChipId(null)
    setDragOverPromptChipId(null)
  }

  async function savePromptOrder(chipsToOrder: AdminPromptChip[], successMessage: string) {
    setError('')
    setChipMessage(null)
    setIsSavingPromptOrder(true)

    try {
      const response = await reorderAdminPromptChips(
        token,
        chipsToOrder.map((chip, index) => ({
          id: chip.id,
          sortOrder: index,
        })),
      )
      setPromptChips(response.chips)
      setEditPromptDrafts(
        Object.fromEntries(response.chips.map((chip) => [chip.id, toPromptDraft(chip)])),
      )
      setPromptReorderDraft([])
      setIsPromptReorderMode(false)
      setDraggedPromptChipId(null)
      setDragOverPromptChipId(null)
      setChipMessage({ section: 'generic', text: successMessage })
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : 'Unable to save generic helper chip order.')
    } finally {
      setIsSavingPromptOrder(false)
    }
  }

  async function handleSavePromptOrder() {
    await savePromptOrder(promptReorderDraft, 'Generic helper chip order saved.')
  }

  function startCuratedReorderMode() {
    setCuratedError('')
    setChipMessage(null)
    setEditingCuratedChipId(null)
    setDraggedCuratedChipId(null)
    setDragOverCuratedChipId(null)
    setCuratedReorderDraft([...chips])
    setIsCuratedReorderMode(true)
  }

  function cancelCuratedReorderMode() {
    setCuratedReorderDraft([])
    setIsCuratedReorderMode(false)
    setDraggedCuratedChipId(null)
    setDragOverCuratedChipId(null)
    setCuratedError('')
  }

  function moveCuratedChip(fromIndex: number, toIndex: number) {
    setCuratedReorderDraft((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current
      }

      const next = [...current]
      const [movedChip] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedChip)
      return next
    })
  }

  function moveCuratedChipById(draggedChipId: number, targetChipId: number) {
    setCuratedReorderDraft((current) => {
      const fromIndex = current.findIndex((chip) => chip.id === draggedChipId)
      const toIndex = current.findIndex((chip) => chip.id === targetChipId)

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return current
      }

      const next = [...current]
      const [movedChip] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedChip)
      return next
    })
  }

  function handleCuratedDragStart(event: DragEvent<HTMLElement>, chipId: number) {
    setDraggedCuratedChipId(chipId)
    setDragOverCuratedChipId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(chipId))
  }

  function handleCuratedDragOver(event: DragEvent<HTMLElement>, chipId: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (draggedCuratedChipId !== chipId) {
      setDragOverCuratedChipId(chipId)
    }
  }

  function handleCuratedDrop(event: DragEvent<HTMLElement>, chipId: number) {
    event.preventDefault()
    const draggedId = draggedCuratedChipId ?? Number(event.dataTransfer.getData('text/plain'))

    if (Number.isFinite(draggedId)) {
      moveCuratedChipById(draggedId, chipId)
    }

    setDraggedCuratedChipId(null)
    setDragOverCuratedChipId(null)
  }

  function handleCuratedDragEnd() {
    setDraggedCuratedChipId(null)
    setDragOverCuratedChipId(null)
  }

  async function handleSaveCuratedOrder() {
    setCuratedError('')
    setChipMessage(null)
    setIsSavingCuratedOrder(true)

    try {
      const responses = await Promise.all(
        curatedReorderDraft.map((chip, index) =>
          updateAdminChip(token, chip.id, {
            label: chip.label,
            description: chip.description,
            isActive: chip.isActive,
            sortOrder: index,
          }),
        ),
      )
      const nextChips = responses.map((response) => {
        const previousChip = chips.find((chip) => chip.id === response.chip.id)
        return {
          ...response.chip,
          selectedFragranceCount: previousChip?.selectedFragranceCount ?? 0,
        }
      })
      setChips(nextChips)
      setEditCuratedDrafts(
        Object.fromEntries(nextChips.map((chip) => [chip.id, toCuratedDraft(chip)])),
      )
      setCuratedReorderDraft([])
      setIsCuratedReorderMode(false)
      setDraggedCuratedChipId(null)
      setDragOverCuratedChipId(null)
      setChipMessage({ section: 'curated', text: 'Curated chip order saved.' })
    } catch (orderError) {
      setCuratedError(orderError instanceof Error ? orderError.message : 'Unable to save curated chip order.')
    } finally {
      setIsSavingCuratedOrder(false)
    }
  }

  async function handleCreateCuratedChip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCuratedError('')
    setChipMessage(null)

    try {
      const response = await createAdminChip(token, {
        ...createCuratedDraft,
        description: createCuratedDraft.description || null,
        sortOrder: chips.reduce((highest, chip) => Math.max(highest, chip.sortOrder), -1) + 1,
      })
      setCreateCuratedDraft(emptyCuratedDraft)
      await loadChips()
      setManagedChipId(response.chip.id)
      setChipMessage({ section: 'curated', text: 'Curated chip created at the end of the list.' })
    } catch (createError) {
      setCuratedError(createError instanceof Error ? createError.message : 'Unable to create curated chip.')
    }
  }

  function handleEditCuratedChip(chip: AdminChip) {
    setEditingCuratedChipId(chip.id)
    setEditCuratedDrafts((current) => ({ ...current, [chip.id]: toCuratedDraft(chip) }))
  }

  function handleCancelCuratedChip(chip: AdminChip) {
    setEditingCuratedChipId(null)
    setEditCuratedDrafts((current) => ({ ...current, [chip.id]: toCuratedDraft(chip) }))
  }

  async function handleSaveCuratedChip(chipId: number) {
    const draft = editCuratedDrafts[chipId]

    if (!draft) return

    setError('')
    setCuratedError('')
    setChipMessage(null)

    try {
      const response = await updateAdminChip(token, chipId, {
        ...draft,
        description: draft.description || null,
      })
      setChips((current) =>
        current.map((chip) =>
          chip.id === chipId
            ? { ...response.chip, selectedFragranceCount: chip.selectedFragranceCount }
            : chip,
        ),
      )
      setEditCuratedDrafts((current) => ({
        ...current,
        [chipId]: toCuratedDraft({
          ...response.chip,
          selectedFragranceCount: chips.find((chip) => chip.id === chipId)?.selectedFragranceCount ?? 0,
        }),
      }))
      setEditingCuratedChipId(null)
      setChipMessage({ section: 'curated', text: 'Curated chip saved.' })
    } catch (saveError) {
      setCuratedError(saveError instanceof Error ? saveError.message : 'Unable to save curated chip.')
    }
  }

  function handleDeleteCuratedChip(chipId: number) {
    const chip = chips.find((currentChip) => currentChip.id === chipId)

    setPendingDelete({
      type: 'curatedChip',
      id: chipId,
      title: 'Delete Curated Chip',
      message: `Delete "${chip?.label ?? chipId}"? This also removes its attached fragrance selections.`,
      confirmLabel: 'Delete Chip',
    })
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = searchQuery.trim()

    if (!q || !managedChipId) return

    setManagerError('')

    try {
      const response = await searchAdminFragrances(token, q)
      setSearchResults(response.fragrances as AdminSearchFragrance[])
    } catch (searchError) {
      setManagerError(searchError instanceof Error ? searchError.message : 'Unable to search fragrances.')
    }
  }

  async function handleAddFragrance(fragranceId: number) {
    if (!managedChipId) return

    setError('')
    setManagerError('')
    setManagerMessage('')
    setIsAddingFragranceId(fragranceId)

    try {
      const nextSortOrder =
        selectedFragrances.reduce(
          (highest, selection) => Math.max(highest, selection.sortOrder),
          -1,
        ) + 1
      await addAdminChipFragrance(token, managedChipId, fragranceId, {
        sortOrder: nextSortOrder,
      })
      await refreshManagedChip()
      setManagerMessage('Fragrance added.')
    } catch (addError) {
      setManagerError(addError instanceof Error ? addError.message : 'Unable to add fragrance.')
    } finally {
      setIsAddingFragranceId(null)
    }
  }

  async function handleSaveSelectionChanges() {
    if (!managedChipId) return

    setError('')
    setManagerError('')
    setManagerMessage('')
    setIsSavingSelections(true)

    try {
      const changedSelections = selectedFragrances.filter((selection) =>
        dirtySelectionIds.has(selection.fragranceId),
      )

      await Promise.all(
        changedSelections.map((selection) =>
          updateAdminChipFragrance(token, managedChipId, selection.fragranceId, {
            sortOrder: selection.sortOrder,
            adminNote: selection.adminNote ?? '',
          }),
        ),
      )
      await loadSelectedFragrances(managedChipId)
      setSelectionReorderDraft([])
      setIsSelectionReorderDirty(false)
      setManagerMessage('Selected fragrance changes saved.')
    } catch (updateError) {
      setManagerError(updateError instanceof Error ? updateError.message : 'Unable to update selected fragrances.')
    } finally {
      setIsSavingSelections(false)
    }
  }

  function handleRemoveSelection(fragranceId: number) {
    if (!managedChipId) return
    const selection = selectedFragrances.find((item) => item.fragranceId === fragranceId)

    setPendingDelete({
      type: 'chipFragrance',
      fragranceId,
      title: 'Remove Fragrance',
      message: `Remove "${selection ? fragranceName(selection.fragrance) : fragranceId}" from this curated chip?`,
      confirmLabel: 'Remove Fragrance',
    })
  }

  function moveSelectedFragrance(fromIndex: number, toIndex: number) {
    setSelectionReorderDraft((current) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current
      }

      const next = [...current]
      const [movedSelection] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedSelection)
      setIsSelectionOrderSaved(false)
      setIsSelectionReorderDirty(true)
      return next
    })
  }

  function moveSelectedFragranceById(draggedFragranceId: number, targetFragranceId: number) {
    setSelectionReorderDraft((current) => {
      const fromIndex = current.findIndex((selection) => selection.fragranceId === draggedFragranceId)
      const toIndex = current.findIndex((selection) => selection.fragranceId === targetFragranceId)

      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex === toIndex
      ) {
        return current
      }

      const next = [...current]
      const [movedSelection] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, movedSelection)
      setIsSelectionOrderSaved(false)
      setIsSelectionReorderDirty(true)
      return next
    })
  }

  function handleSelectionDragStart(event: DragEvent<HTMLElement>, fragranceId: number) {
    setDraggedSelectionFragranceId(fragranceId)
    setDragOverSelectionFragranceId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(fragranceId))
  }

  function handleSelectionDragOver(event: DragEvent<HTMLElement>, fragranceId: number) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (draggedSelectionFragranceId !== fragranceId) {
      setDragOverSelectionFragranceId(fragranceId)
    }
  }

  function handleSelectionDrop(event: DragEvent<HTMLElement>, fragranceId: number) {
    event.preventDefault()
    const draggedId = draggedSelectionFragranceId ?? Number(event.dataTransfer.getData('text/plain'))

    if (Number.isFinite(draggedId)) {
      moveSelectedFragranceById(draggedId, fragranceId)
    }

    setDraggedSelectionFragranceId(null)
    setDragOverSelectionFragranceId(null)
  }

  function handleSelectionDragEnd() {
    setDraggedSelectionFragranceId(null)
    setDragOverSelectionFragranceId(null)
  }

  function resetSelectedFragranceReorder() {
    setSelectionReorderDraft([...selectedFragrances])
    setIsSelectionReorderDirty(false)
    setIsSelectionOrderSaved(false)
    setDraggedSelectionFragranceId(null)
    setDragOverSelectionFragranceId(null)
  }

  async function handleSaveSelectedFragranceOrder() {
    if (!managedChipId) return

    setError('')
    setManagerError('')
    setManagerMessage('')
    setIsSavingSelections(true)

    try {
      await Promise.all(
        selectionReorderDraft.map((selection, index) =>
          updateAdminChipFragrance(token, managedChipId, selection.fragranceId, {
            sortOrder: index,
            adminNote: selection.adminNote ?? '',
          }),
        ),
      )
      const refreshedSelections = await loadSelectedFragrances(managedChipId)
      setSelectionReorderDraft(refreshedSelections)
      setIsSelectionReorderDirty(false)
      setIsSelectionOrderSaved(true)
      setDraggedSelectionFragranceId(null)
      setDragOverSelectionFragranceId(null)
      setManagerMessage('Selected fragrance order saved.')
      window.setTimeout(() => setIsSelectionOrderSaved(false), 1800)
    } catch (updateError) {
      setManagerError(updateError instanceof Error ? updateError.message : 'Unable to save selected fragrance order.')
    } finally {
      setIsSavingSelections(false)
    }
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || isDeleting) return

    setError('')
    setManagerMessage('')
    setChipMessage(null)
    setIsDeleting(true)

    try {
      if (pendingDelete.type === 'promptChip') {
        await deleteAdminPromptChip(token, pendingDelete.id)
        setPromptChips((current) => current.filter((chip) => chip.id !== pendingDelete.id))
        setEditingPromptChipId(null)
        setChipMessage({ section: 'generic', text: 'Generic helper chip deleted.' })
      } else if (pendingDelete.type === 'curatedChip') {
        setCuratedError('')
        await deleteAdminChip(token, pendingDelete.id)
        setChips((current) => current.filter((chip) => chip.id !== pendingDelete.id))
        if (managedChipId === pendingDelete.id) {
          setManagedChipId(null)
          setSelectedFragrances([])
          setSearchResults([])
        }
        setEditingCuratedChipId(null)
        setChipMessage({ section: 'curated', text: 'Curated chip deleted.' })
      } else if (managedChipId) {
        setManagerError('')
        await removeAdminChipFragrance(token, managedChipId, pendingDelete.fragranceId)
        await refreshManagedChip()
        setManagerMessage('Fragrance removed.')
      }

      setPendingDelete(null)
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to complete delete.'

      if (pendingDelete.type === 'curatedChip') {
        setCuratedError(message)
      } else if (pendingDelete.type === 'chipFragrance') {
        setManagerError(message)
      } else {
        setError(message)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  function getChipStatus(fragrance: AdminSearchFragrance) {
    const memberships = fragrance.chipMemberships ?? []

    if (!memberships.length) {
      return 'Not in this chip'
    }

    if (memberships.some((membership) => membership.chipId === managedChipId)) {
      return memberships.length === 1
        ? 'Already in this chip'
        : `In: ${memberships.map((membership) => membership.label).join(', ')}`
    }

    return `In: ${memberships.map((membership) => membership.label).join(', ')}`
  }

  function resetBulkModal() {
    setBulkModalOpen(false)
    setBulkCsvText('')
    setBulkPreviewRows([])
    setBulkError('')
    setBulkSummary('')
    setBulkPreviewReady(false)
  }

  function handlePreviewBulkImport() {
    const csvText = bulkCsvText.trim()

    setBulkError('')
    setBulkSummary('')
    setBulkPreviewRows([])
    setBulkPreviewReady(false)

    if (!csvText) {
      setBulkError('Paste CSV rows before previewing.')
      return
    }

    if (bulkCsvText.length > 5000) {
      setBulkError('Bulk import text must be 5000 characters or fewer.')
      return
    }

    const nonBlankLines = bulkCsvText
      .split(/\r?\n/)
      .flatMap((line, index) => (
        line.trim() ? [{ line, rowNumber: index + 1 }] : []
      ))

    if (nonBlankLines.length < 2) {
      setBulkError('Include a header row and at least one data row.')
      return
    }

    const headers = parseCsvLine(nonBlankLines[0].line).map(normalizeHeader)
    const labelIndex = headers.indexOf('label')
    const promptIndex = headers.indexOf('prompt')
    const sortOrderIndex = headers.findIndex((header) => header === 'sortorder')

    if (labelIndex === -1 || promptIndex === -1) {
      setBulkError('CSV header must include label and prompt columns.')
      return
    }

    const dataRows = nonBlankLines.slice(1)

    if (dataRows.length > 25) {
      setBulkError('Bulk import supports up to 25 data rows at a time.')
      return
    }

    const existingLabels = new Set(promptChips.map((chip) => normalizeDuplicateValue(chip.label)))
    const existingPrompts = new Set(promptChips.map((chip) => normalizeDuplicateValue(chip.prompt)))
    const seenLabels = new Set<string>()
    const seenPrompts = new Set<string>()
    const activeCount = promptChips.filter((chip) => chip.isActive).length
    let remainingActiveSlots = Math.max(0, maxActiveGenericPromptChips - activeCount)
    let nextSortOrder =
      promptChips.reduce((highest, chip) => Math.max(highest, chip.sortOrder), -1) + 1
    const previewRows: BulkPreviewRow[] = []

    dataRows.forEach(({ line, rowNumber }) => {
      const columns = parseCsvLine(line)
      const label = columns[labelIndex]?.trim() ?? ''
      const prompt = columns[promptIndex]?.trim() ?? ''
      const sortOrderValue = sortOrderIndex >= 0 ? columns[sortOrderIndex]?.trim() ?? '' : ''
      const normalizedLabel = normalizeDuplicateValue(label)
      const normalizedPrompt = normalizeDuplicateValue(prompt)
      let sortOrder = nextSortOrder

      if (!label) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'invalid', reason: 'label is required.' })
        return
      }

      if (label.length > 80) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'invalid', reason: 'label must be 80 characters or fewer.' })
        return
      }

      if (!prompt) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'invalid', reason: 'prompt is required.' })
        return
      }

      if (prompt.length > 240) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'invalid', reason: 'prompt must be 240 characters or fewer.' })
        return
      }

      if (sortOrderValue) {
        const parsedSortOrder = Number(sortOrderValue)

        if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
          previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'invalid', reason: 'sortOrder must be a non-negative integer.' })
          return
        }

        sortOrder = parsedSortOrder
      } else {
        nextSortOrder += 1
      }

      if (existingLabels.has(normalizedLabel) || seenLabels.has(normalizedLabel)) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'skipped', reason: 'duplicate label.' })
        return
      }

      if (existingPrompts.has(normalizedPrompt) || seenPrompts.has(normalizedPrompt)) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'skipped', reason: 'duplicate prompt.' })
        return
      }

      if (remainingActiveSlots <= 0) {
        previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'skipped', reason: 'active generic helper chip limit reached.' })
        return
      }

      remainingActiveSlots -= 1
      seenLabels.add(normalizedLabel)
      seenPrompts.add(normalizedPrompt)
      previewRows.push({ rowNumber, label, prompt, sortOrder, status: 'valid' })
    })

    const validCount = previewRows.filter((row) => row.status === 'valid').length
    const skippedCount = previewRows.filter((row) => row.status === 'skipped').length
    const invalidCount = previewRows.filter((row) => row.status === 'invalid').length

    setBulkPreviewRows(previewRows)
    setBulkPreviewReady(true)
    setBulkSummary(
      `${validCount} ready to import. ${skippedCount} duplicate/limit rows skipped. ${invalidCount} rows failed validation.`,
    )
  }

  async function handleConfirmBulkImport() {
    if (!validBulkRows.length) {
      setBulkError('There are no valid rows to import.')
      return
    }

    setBulkError('')

    try {
      const response = await bulkCreateAdminPromptChips(
        token,
        validBulkRows.map((row) => ({
          label: row.label,
          prompt: row.prompt,
          sortOrder: row.sortOrder,
          isActive: true,
        })),
      )
      await loadPromptChips()
      setBulkSummary(
        `Imported ${response.created} chips. Skipped ${response.skipped} duplicates or limit rows. ${response.errors.length} rows failed validation.`,
      )
      setChipMessage({ section: 'generic', text: `Imported ${response.created} generic helper chips.` })
      setBulkModalOpen(false)
      setBulkCsvText('')
      setBulkPreviewReady(false)
      setBulkPreviewRows([])
    } catch (bulkImportError) {
      setBulkError(
        bulkImportError instanceof Error
          ? bulkImportError.message
          : 'Unable to import generic helper chips.',
      )
    }
  }

  const activePromptCount = promptChips.filter((chip) => chip.isActive).length
  const activeCuratedCount = chips.filter((chip) => chip.isActive).length
  const selectedFragranceTotal = chips.reduce((total, chip) => total + chip.selectedFragranceCount, 0)
  const nextPromptPosition = promptChips.length + 1
  const nextCuratedPosition = chips.length + 1

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Mistify Admin</p>
          <h1>Chips</h1>
          <p className="admin-header-subtitle">Manage quick-start helper chips and curated recommendation chips.</p>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <a href="/admin/products">Products</a>
          <a className="active" href="/admin/chips">Chips</a>
          <button type="button" onClick={onLogout}>Logout</button>
        </nav>
      </header>

      <section className="admin-overview-grid" aria-label="Chip workspace overview">
        <AdminMetricCard label="Generic Active" value={`${activePromptCount}/${maxActiveGenericPromptChips}`} helper={`${promptChips.length} helper chips configured`} tone={activePromptCount ? 'success' : 'warning'} />
        <AdminMetricCard label="Curated Active" value={`${activeCuratedCount}/8`} helper={`${chips.length} curated chips configured`} tone={activeCuratedCount ? 'success' : 'warning'} />
        <AdminMetricCard label="Attached Picks" value={selectedFragranceTotal} helper={`Across ${chips.length} curated lists`} />
        <AdminMetricCard label="Open Manager" value={managedChip ? 'Active' : 'Idle'} helper={managedChip ? managedChip.label : 'Select a curated chip to edit picks'} tone={managedChip ? 'success' : 'neutral'} />
      </section>

      <section className="admin-workflow-strip" aria-label="Chip workflow guide">
        <article>
          <span>1</span>
          <div>
            <strong>Create</strong>
            <p>Add the chip label/prompt. New chips append to the public order.</p>
          </div>
        </article>
        <article>
          <span>2</span>
          <div>
            <strong>Reorder</strong>
            <p>Use reorder mode only when you want to change display priority.</p>
          </div>
        </article>
        <article>
          <span>3</span>
          <div>
            <strong>Attach picks</strong>
            <p>For curated chips, manage fragrances from the dedicated modal.</p>
          </div>
        </article>
      </section>

      <section className="admin-dashboard-card admin-command-panel">
        <div className="admin-toolbar-heading">
          <div>
            <h2>Generic Helper Chips</h2>
            <p>Generic chips help users start a normal search. Clicking one only fills the search box. It does not submit automatically and does not attach fragrances.</p>
          </div>
          <div className="admin-toolbar-actions">
            {isPromptReorderMode ? (
              <>
                <button className="admin-inline-button success" type="button" disabled={isSavingPromptOrder} onClick={handleSavePromptOrder}>
                  {isSavingPromptOrder ? 'Saving...' : 'Save Order'}
                </button>
                <button className="admin-inline-button neutral" type="button" disabled={isSavingPromptOrder} onClick={cancelPromptReorderMode}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="admin-inline-button secondary" type="button" disabled={!promptChips.length || isSavingPromptOrder} onClick={startPromptReorderMode}>
                  Reorder Chips
                </button>
                <button className="admin-inline-button" type="button" onClick={() => setBulkModalOpen(true)}>
                  Bulk Add Generic Chips
                </button>
              </>
            )}
          </div>
        </div>
        {chipMessage?.section === 'generic' ? (
          <p className="admin-success section-error">{chipMessage.text}</p>
        ) : null}
        {genericError ? <p className="admin-error section-error">{genericError}</p> : null}

        <form className="admin-chip-create-form streamlined" onSubmit={handleCreatePromptChip}>
          <div className="admin-create-copy">
            <strong>Create helper chip</strong>
            <p>New chips go to position {nextPromptPosition}. Use Reorder Chips when you want to change the public display order.</p>
          </div>
          <FieldLabel label="Label" helper="This is the short text shown on the chip.">
            <input placeholder="I want vanilla." value={createPromptDraft.label} onChange={(event) => setCreatePromptDraft((draft) => ({ ...draft, label: event.target.value }))} />
          </FieldLabel>
          <FieldLabel label="Prompt" helper="This fills the public search box when clicked.">
            <input placeholder="I want a sweet vanilla fragrance." value={createPromptDraft.prompt} onChange={(event) => setCreatePromptDraft((draft) => ({ ...draft, prompt: event.target.value }))} />
          </FieldLabel>
          <button type="submit">Create</button>
        </form>

        {!promptChips.length ? (
          <p className="admin-empty-state">No generic helper chips yet. Create one to help users start faster.</p>
        ) : isPromptReorderMode ? (
          <div className="prompt-chip-reorder-panel" aria-label="Reorder generic helper chips">
            <div className="prompt-chip-reorder-list">
              {promptReorderDraft.map((chip, index) => (
                <article
                  className={[
                    'prompt-chip-reorder-card',
                    draggedPromptChipId === chip.id ? 'dragging' : '',
                    dragOverPromptChipId === chip.id ? 'drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={!isSavingPromptOrder}
                  key={chip.id}
                  onDragStart={(event) => handlePromptDragStart(event, chip.id)}
                  onDragOver={(event) => handlePromptDragOver(event, chip.id)}
                  onDrop={(event) => handlePromptDrop(event, chip.id)}
                  onDragEnd={handlePromptDragEnd}
                >
                  <div className="prompt-chip-reorder-position" aria-label={`Order ${index + 1}`}>
                    {index + 1}
                  </div>
                  <div className="prompt-chip-drag-handle" aria-hidden="true">
                    <span>..</span>
                    <span>..</span>
                  </div>
                  <div className="prompt-chip-reorder-copy">
                    <strong>{chip.label}</strong>
                    <p>{chip.prompt}</p>
                    <StatusPill active={chip.isActive} />
                  </div>
                  <div className="prompt-chip-reorder-actions">
                    <button
                      className="admin-inline-button neutral"
                      type="button"
                      disabled={index === 0 || isSavingPromptOrder}
                      onClick={() => movePromptChip(index, index - 1)}
                    >
                      Move Up
                    </button>
                    <button
                      className="admin-inline-button neutral"
                      type="button"
                      disabled={index === promptReorderDraft.length - 1 || isSavingPromptOrder}
                      onClick={() => movePromptChip(index, index + 1)}
                    >
                      Move Down
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="admin-chip-table generic-table">
            <div className="admin-chip-table-heading">
              <span>Label</span>
              <span>Prompt</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {promptChips.map((chip) => {
              const draft = editPromptDrafts[chip.id] ?? toPromptDraft(chip)
              const isEditing = editingPromptChipId === chip.id

              return (
                <article className="admin-chip-table-row generic-table" key={chip.id}>
                  <div data-label="Label">
                    {isEditing ? <input value={draft.label} onChange={(event) => setEditPromptDrafts((current) => ({ ...current, [chip.id]: { ...draft, label: event.target.value } }))} /> : chip.label}
                  </div>
                  <div data-label="Prompt">
                    {isEditing ? <input value={draft.prompt} onChange={(event) => setEditPromptDrafts((current) => ({ ...current, [chip.id]: { ...draft, prompt: event.target.value } }))} /> : chip.prompt}
                  </div>
                  <div data-label="Status">
                    {isEditing ? <ActiveToggle checked={draft.isActive} onChange={(checked) => setEditPromptDrafts((current) => ({ ...current, [chip.id]: { ...draft, isActive: checked } }))} /> : <StatusPill active={chip.isActive} />}
                  </div>
                  <div className="admin-row-actions" data-label="Actions">
                    {isEditing ? (
                      <>
                        <button className="success" type="button" onClick={() => handleSavePromptChip(chip.id)}>Save</button>
                        <button className="neutral" type="button" onClick={() => handleCancelPromptChip(chip)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="edit" type="button" onClick={() => handleEditPromptChip(chip)}>Edit</button>
                        <button className="danger" type="button" onClick={() => handleDeletePromptChip(chip.id)}>Delete</button>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="admin-dashboard-card">
        <div className="admin-toolbar-heading">
          <div>
            <h2>Curated Recommendation Chips</h2>
            <p>Curated chips are admin-picked recommendation lists. Clicking one submits immediately and returns only the fragrances attached to that chip.</p>
          </div>
          <div className="admin-toolbar-actions">
            {isCuratedReorderMode ? (
              <>
                <button className="admin-inline-button success" type="button" disabled={isSavingCuratedOrder} onClick={handleSaveCuratedOrder}>
                  {isSavingCuratedOrder ? 'Saving...' : 'Save Order'}
                </button>
                <button className="admin-inline-button neutral" type="button" disabled={isSavingCuratedOrder} onClick={cancelCuratedReorderMode}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="admin-inline-button secondary" type="button" disabled={!chips.length || isSavingCuratedOrder} onClick={startCuratedReorderMode}>
                Reorder Curated Chips
              </button>
            )}
          </div>
        </div>
        {chipMessage?.section === 'curated' ? (
          <p className="admin-success section-error">{chipMessage.text}</p>
        ) : null}
        {curatedError ? <p className="admin-error section-error">{curatedError}</p> : null}

        <form className="admin-chip-create-form streamlined curated-create-form" onSubmit={handleCreateCuratedChip}>
          <div className="admin-create-copy">
            <strong>Create curated chip</strong>
            <p>New curated chips go to position {nextCuratedPosition}. Reorder after creation, then manage fragrances.</p>
          </div>
          <FieldLabel label="Label" helper="This is the short chip text users see.">
            <input placeholder="Sweet Date Night Picks" value={createCuratedDraft.label} onChange={(event) => setCreateCuratedDraft((draft) => ({ ...draft, label: event.target.value }))} />
          </FieldLabel>
          <FieldLabel label="Description" helper="Optional internal/admin description for this list.">
            <input placeholder="Warm, sweet, romantic picks for evening wear." value={createCuratedDraft.description} onChange={(event) => setCreateCuratedDraft((draft) => ({ ...draft, description: event.target.value }))} />
          </FieldLabel>
          <button type="submit">Create</button>
        </form>

        {!chips.length ? (
          <p className="admin-empty-state">No curated chips yet. Create one, then attach fragrances.</p>
        ) : isCuratedReorderMode ? (
          <div className="prompt-chip-reorder-panel" aria-label="Reorder curated recommendation chips">
            <div className="prompt-chip-reorder-list">
              {curatedReorderDraft.map((chip, index) => (
                <article
                  className={[
                    'prompt-chip-reorder-card',
                    draggedCuratedChipId === chip.id ? 'dragging' : '',
                    dragOverCuratedChipId === chip.id ? 'drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={!isSavingCuratedOrder}
                  key={chip.id}
                  onDragStart={(event) => handleCuratedDragStart(event, chip.id)}
                  onDragOver={(event) => handleCuratedDragOver(event, chip.id)}
                  onDrop={(event) => handleCuratedDrop(event, chip.id)}
                  onDragEnd={handleCuratedDragEnd}
                >
                  <div className="prompt-chip-reorder-position" aria-label={`Order ${index + 1}`}>
                    {index + 1}
                  </div>
                  <div className="prompt-chip-drag-handle" aria-hidden="true">
                    <span>..</span>
                    <span>..</span>
                  </div>
                  <div className="prompt-chip-reorder-copy">
                    <strong>{chip.label}</strong>
                    <p>{chip.description || 'No description'}</p>
                    <p>{chip.selectedFragranceCount} selected fragrances</p>
                    <StatusPill active={chip.isActive} />
                  </div>
                  <div className="prompt-chip-reorder-actions">
                    <button
                      className="admin-inline-button neutral"
                      type="button"
                      disabled={index === 0 || isSavingCuratedOrder}
                      onClick={() => moveCuratedChip(index, index - 1)}
                    >
                      Move Up
                    </button>
                    <button
                      className="admin-inline-button neutral"
                      type="button"
                      disabled={index === curatedReorderDraft.length - 1 || isSavingCuratedOrder}
                      onClick={() => moveCuratedChip(index, index + 1)}
                    >
                      Move Down
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="admin-chip-table curated-table">
            <div className="admin-chip-table-heading">
              <span>Label</span>
              <span>Description</span>
              <span>Status</span>
              <span>Display Order</span>
              <span>Selected Fragrances</span>
              <span>Actions</span>
            </div>
            {chips.map((chip, index) => {
              const draft = editCuratedDrafts[chip.id] ?? toCuratedDraft(chip)
              const isEditing = editingCuratedChipId === chip.id

              return (
                <article className={`admin-chip-table-row curated-table ${managedChipId === chip.id ? 'selected' : ''}`} key={chip.id}>
                  <div data-label="Label">
                    {isEditing ? <input value={draft.label} onChange={(event) => setEditCuratedDrafts((current) => ({ ...current, [chip.id]: { ...draft, label: event.target.value } }))} /> : chip.label}
                  </div>
                  <div data-label="Description">
                    {isEditing ? <input value={draft.description} onChange={(event) => setEditCuratedDrafts((current) => ({ ...current, [chip.id]: { ...draft, description: event.target.value } }))} /> : chip.description || 'No description'}
                  </div>
                  <div data-label="Status">
                    {isEditing ? <ActiveToggle checked={draft.isActive} onChange={(checked) => setEditCuratedDrafts((current) => ({ ...current, [chip.id]: { ...draft, isActive: checked } }))} /> : <StatusPill active={chip.isActive} />}
                  </div>
                  <div data-label="Display Order">{index + 1}</div>
                  <div data-label="Selected Fragrances">{chip.selectedFragranceCount}</div>
                  <div className="admin-row-actions" data-label="Actions">
                    <button className="manage" type="button" onClick={() => openManagerModal(chip.id)}>Manage Fragrances</button>
                    {isEditing ? (
                      <>
                        <button className="success" type="button" onClick={() => handleSaveCuratedChip(chip.id)}>Save</button>
                        <button className="neutral" type="button" onClick={() => handleCancelCuratedChip(chip)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="edit" type="button" onClick={() => handleEditCuratedChip(chip)}>Edit</button>
                        <button className="danger" type="button" onClick={() => handleDeleteCuratedChip(chip.id)}>Delete</button>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {managedChip ? (
        <div className="admin-modal-overlay" role="presentation">
          <section className="admin-fragrance-manager-modal" role="dialog" aria-modal="true" aria-labelledby="fragrance-manager-title">
            <div className="admin-fragrance-manager-header">
              <div>
                <p className="admin-confirm-kicker">Curated Workspace</p>
                <h2 id="fragrance-manager-title">{managedChip.label}</h2>
                <div className="manager-modal-meta">
                  <StatusPill active={managedChip.isActive} />
                  <span>{selectedFragrances.length} / {maxCuratedChipFragrances} selected</span>
                  {hasUnsavedSelectionEdits || isSelectionReorderDirty ? <span className="manager-unsaved-pill">Unsaved changes</span> : null}
                  {managedChip.description ? <span>{managedChip.description}</span> : null}
                </div>
              </div>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeManagerModal}
                disabled={hasManagerBlockingEdits || isSavingSelections}
                aria-label="Close fragrance manager"
              >
                x
              </button>
            </div>

            <div className="manager-workflow-summary" aria-label="Curated fragrance workflow summary">
              <article>
                <span>Selected</span>
                <strong>{selectedFragrances.length}</strong>
                <p>Current fragrances in this chip</p>
              </article>
              <article>
                <span>Capacity</span>
                <strong>{maxCuratedChipFragrances - selectedFragrances.length}</strong>
                <p>Open slots remaining</p>
              </article>
              <article>
                <span>Workflow</span>
                <strong>{managerTab === 'add' ? 'Add' : managerTab === 'reorder' ? 'Reorder' : 'Review'}</strong>
                <p>Use tabs to add, review, then reorder</p>
              </article>
            </div>

            <div className="manager-modal-tabs" role="tablist" aria-label="Curated fragrance manager views">
              <button
                type="button"
                className={managerTab === 'selected' ? 'active' : ''}
                onClick={() => openManagerTab('selected')}
                disabled={isSelectionReorderDirty || isSavingSelections}
              >
                Selected Fragrances
              </button>
              <button
                type="button"
                className={managerTab === 'reorder' ? 'active' : ''}
                onClick={() => openManagerTab('reorder')}
                disabled={!selectedFragrances.length || hasUnsavedSelectionEdits || isSavingSelections}
              >
                Reorder Fragrances
              </button>
              <button
                type="button"
                className={managerTab === 'add' ? 'active' : ''}
                onClick={() => openManagerTab('add')}
                disabled={isSelectionReorderDirty || isSavingSelections}
              >
                Add Fragrances
              </button>
            </div>

            <div className="admin-fragrance-manager-body">
              {managerMessage ? <p className="admin-success section-error">{managerMessage}</p> : null}
              {error || managerError ? <p className="admin-error section-error">{error || managerError}</p> : null}

              {managerTab === 'selected' ? (
                <div className="manager-tab-panel">
                  <div className="manager-panel-heading">
                    <div>
                      <h3>Selected Fragrances</h3>
                      <p>Review attached picks and edit admin notes. Use Reorder Fragrances for ordering instead of typing numbers.</p>
                    </div>
                    <div className="manager-panel-actions">
                      <button
                        className="admin-inline-button secondary"
                        type="button"
                        disabled={!selectedFragrances.length || hasUnsavedSelectionEdits || isSavingSelections}
                        onClick={() => openManagerTab('reorder')}
                      >
                        Reorder Fragrances
                      </button>
                      <button
                        className="admin-inline-button success"
                        type="button"
                        disabled={!hasUnsavedSelectionEdits || isSavingSelections}
                        onClick={handleSaveSelectionChanges}
                      >
                        {isSavingSelections ? 'Saving...' : `Save Notes${dirtySelectionIds.size ? ` (${dirtySelectionIds.size})` : ''}`}
                      </button>
                    </div>
                  </div>

                  {!selectedFragrances.length ? (
                    <p className="admin-empty-state manager-empty-state">No fragrances selected yet. Use Add Fragrances to build this curated list.</p>
                  ) : (
                    <div className="admin-chip-table selected-fragrance-table manager-table">
                      <div className="admin-chip-table-heading">
                        <span>Display Order</span>
                        <span>Fragrance</span>
                        <span>Source Brand</span>
                        <span>Mistify Product</span>
                        <span>Classification</span>
                        <span>Notes Preview</span>
                        <span>Admin Note</span>
                        <span>Actions</span>
                      </div>
                      {selectedFragrances.map((selection) => {
                        const isDirty = dirtySelectionIds.has(selection.fragranceId)

                        return (
                          <article className={`admin-chip-table-row selected-fragrance-table ${isDirty ? 'dirty' : ''}`} key={selection.fragranceId}>
                            <div data-label="Display Order" className="manager-order-cell">
                              #{selectedFragrances.findIndex((item) => item.fragranceId === selection.fragranceId) + 1}
                            </div>
                            <div data-label="Fragrance">{fragranceName(selection.fragrance)}</div>
                            <div data-label="Source Brand">{selection.fragrance.sourceBrandBatch || 'Missing'}</div>
                            <div data-label="Mistify Product">{selection.fragrance.mistifyProductName || 'Missing'}</div>
                            <div data-label="Classification">{selection.fragrance.classification || 'Missing'}</div>
                            <div data-label="Notes Preview">{notesPreview(selection.fragrance)}</div>
                            <div data-label="Admin Note">
                              <input
                                value={selection.adminNote ?? ''}
                                maxLength={200}
                                onChange={(event) =>
                                  updateSelectedFragranceDraft(selection.fragranceId, {
                                    adminNote: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="admin-row-actions" data-label="Actions">
                              {isDirty ? <span className="manager-unsaved-pill">Unsaved</span> : null}
                              <button className="danger" type="button" onClick={() => handleRemoveSelection(selection.fragranceId)}>Remove</button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : managerTab === 'reorder' ? (
                <div className="manager-tab-panel">
                  <div className="manager-panel-heading">
                    <div>
                      <h3>Reorder Fragrances</h3>
                      <p>Drag selected fragrances into the order this curated chip should return, or use Move Up / Move Down, then save once.</p>
                    </div>
                    <div className="manager-panel-actions">
                      <button
                        className={`admin-inline-button success ${isSelectionOrderSaved ? 'saved-pulse' : ''}`}
                        type="button"
                        disabled={!isSelectionReorderDirty || isSavingSelections}
                        onClick={handleSaveSelectedFragranceOrder}
                      >
                        {isSavingSelections ? 'Saving...' : isSelectionOrderSaved ? 'Saved' : 'Save Order'}
                      </button>
                      <button
                        className="admin-inline-button neutral"
                        type="button"
                        disabled={isSavingSelections}
                        onClick={resetSelectedFragranceReorder}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  {!selectionReorderDraft.length ? (
                    <p className="admin-empty-state manager-empty-state">No fragrances selected yet. Use Add Fragrances to build this curated list.</p>
                  ) : (
                    <div className="selected-fragrance-reorder-panel" aria-label="Reorder selected fragrances">
                      <div className="selected-fragrance-reorder-list">
                        {selectionReorderDraft.map((selection, index) => (
                          <article
                            className={[
                              'selected-fragrance-reorder-card',
                              draggedSelectionFragranceId === selection.fragranceId ? 'dragging' : '',
                              dragOverSelectionFragranceId === selection.fragranceId ? 'drag-over' : '',
                            ].filter(Boolean).join(' ')}
                            draggable={!isSavingSelections}
                            key={selection.fragranceId}
                            onDragStart={(event) => handleSelectionDragStart(event, selection.fragranceId)}
                            onDragOver={(event) => handleSelectionDragOver(event, selection.fragranceId)}
                            onDrop={(event) => handleSelectionDrop(event, selection.fragranceId)}
                            onDragEnd={handleSelectionDragEnd}
                          >
                            <div className="selected-fragrance-reorder-position" aria-label={`Order ${index + 1}`}>
                              {index + 1}
                            </div>
                            <div className="selected-fragrance-drag-handle" aria-hidden="true">
                              <span>..</span>
                              <span>..</span>
                            </div>
                            <div className="selected-fragrance-reorder-copy">
                              <strong>{fragranceName(selection.fragrance)}</strong>
                              <p>{selection.fragrance.sourceBrandBatch || 'Missing source brand'}</p>
                              <p>{notesPreview(selection.fragrance)}</p>
                            </div>
                            <div className="selected-fragrance-reorder-actions">
                              <button
                                className="admin-inline-button neutral"
                                type="button"
                                disabled={index === 0 || isSavingSelections}
                                onClick={() => moveSelectedFragrance(index, index - 1)}
                              >
                                Move Up
                              </button>
                              <button
                                className="admin-inline-button neutral"
                                type="button"
                                disabled={index === selectionReorderDraft.length - 1 || isSavingSelections}
                                onClick={() => moveSelectedFragrance(index, index + 1)}
                              >
                                Move Down
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="manager-tab-panel">
                  <form className="admin-search manager-search" onSubmit={handleSearch}>
                    <label htmlFor="chip-fragrance-search">Search fragrances</label>
                    <input
                      id="chip-fragrance-search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search by fragrance, brand, classification, or Mistify product name"
                    />
                    <button type="submit">Search</button>
                  </form>

                  <div className="admin-chip-table fragrance-search-table manager-table">
                    <div className="admin-chip-table-heading">
                      <span>Fragrance</span>
                      <span>Source Brand</span>
                      <span>Mistify Product</span>
                      <span>Classification</span>
                      <span>Chip Status</span>
                      <span>Action</span>
                    </div>
                    {!searchResults.length ? (
                      <p className="admin-empty-state">Search for fragrances to add to this curated chip.</p>
                    ) : null}
                    {searchResults.map((fragrance) => {
                      const isInSelectedChip = selectedFragranceIds.has(fragrance.id)

                      return (
                        <article className="admin-chip-table-row fragrance-search-table" key={fragrance.id}>
                          <div data-label="Fragrance">{fragranceName(fragrance)}</div>
                          <div data-label="Source Brand">{fragrance.sourceBrandBatch || 'Missing'}</div>
                          <div data-label="Mistify Product">{fragrance.mistifyProductName || 'Missing'}</div>
                          <div data-label="Classification">{fragrance.classification || 'Missing'}</div>
                          <div data-label="Chip Status">{getChipStatus(fragrance)}</div>
                          <div className="admin-row-actions" data-label="Action">
                            <button
                              type="button"
                              disabled={isInSelectedChip || isAddingFragranceId === fragrance.id}
                              onClick={() => handleAddFragrance(fragrance.id)}
                            >
                              {isInSelectedChip
                                ? 'Already Added'
                                : isAddingFragranceId === fragrance.id
                                  ? 'Adding...'
                                  : 'Add'}
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-fragrance-manager-footer">
              {hasManagerBlockingEdits ? (
                <span className="manager-footer-warning">Save or cancel changes before closing.</span>
              ) : null}
              <button
                className="neutral"
                type="button"
                onClick={closeManagerModal}
                disabled={hasManagerBlockingEdits || isSavingSelections}
              >
                Close manager
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="admin-modal-overlay" role="presentation">
          <section className="admin-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
            <div className="admin-confirm-modal-header">
              <div>
                <p className="admin-confirm-kicker">Confirm Delete</p>
                <h2 id="delete-confirm-title">{pendingDelete.title}</h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={isDeleting}
                aria-label="Close delete confirmation"
              >
                x
              </button>
            </div>
            <div className="admin-confirm-modal-body">
              <p>{pendingDelete.message}</p>
              <p>This action cannot be undone.</p>
            </div>
            <div className="admin-confirm-modal-actions">
              <button
                className="neutral"
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={confirmPendingDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : pendingDelete.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {bulkModalOpen ? (
        <div className="admin-modal-overlay" role="presentation">
          <section className="admin-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-chip-title">
            <div className="admin-bulk-modal-header">
              <div>
                <h2 id="bulk-chip-title">Bulk Add Generic Helper Chips</h2>
                <p>Paste CSV rows using this format: label,prompt. Sort order is optional and chips append by default.</p>
              </div>
              <button className="modal-close-button" type="button" onClick={resetBulkModal} aria-label="Close bulk import">
                x
              </button>
            </div>
            <div className="admin-bulk-modal-body">
              <p className="admin-bulk-help">
                Generic helper chips only autofill the search box. They do not submit automatically and do not attach fragrances. Duplicate labels or prompts will be skipped.
              </p>
              <textarea
                value={bulkCsvText}
                maxLength={5000}
                onChange={(event) => {
                  setBulkCsvText(event.target.value)
                  setBulkPreviewReady(false)
                  setBulkPreviewRows([])
                  setBulkError('')
                }}
                placeholder={'label,prompt\n"I want vanilla.","I want a sweet vanilla fragrance."\n"I want fresh citrus.","I want a bright fresh citrus scent."\n"I want rose and musk.","I want a soft rose and musk fragrance."'}
              />
              <p className="character-count">{bulkCsvText.length}/5000 characters. Max 25 data rows.</p>
              {bulkError ? <p className="admin-error">{bulkError}</p> : null}
              {bulkSummary ? <p className="admin-success">{bulkSummary}</p> : null}
              {bulkPreviewRows.length ? (
                <div className="bulk-preview-list">
                  <h3>Preview Results</h3>
                  {bulkPreviewRows.map((row) => (
                    <article className={`bulk-preview-row ${row.status}`} key={`${row.rowNumber}-${row.label}-${row.prompt}`}>
                      <strong>Row {row.rowNumber}: {row.status}</strong>
                      <p>{row.reason ? `${row.reason} ` : ''}{row.label || 'No label'} / {row.prompt || 'No prompt'}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="admin-bulk-modal-actions">
              <button className="neutral" type="button" onClick={resetBulkModal}>Cancel</button>
              <button type="button" onClick={handlePreviewBulkImport}>Preview Import</button>
              <button className="success" type="button" disabled={!bulkPreviewReady || !validBulkRows.length} onClick={handleConfirmBulkImport}>
                Confirm Import
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function AdminChipsPage(props: AdminChipsPageProps) {
  return useAdminChipsPageContent(props)
}

export default AdminChipsPage
