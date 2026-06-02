import { apiUrl } from './apiUrl'

export type PublicChip = {
  id: number
  label: string
  description: string | null
  sortOrder: number
}

export type PublicPromptChip = {
  id: number
  label: string
  prompt: string
  sortOrder: number
}

export async function getPublicChips() {
  const response = await fetch(`${apiUrl}/chips`)
  const data = (await response.json()) as { chips?: PublicChip[]; error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? 'Unable to load chips.')
  }

  return Array.isArray(data.chips) ? data.chips : []
}

export async function getPublicPromptChips() {
  const response = await fetch(`${apiUrl}/prompt-chips`)
  const data = (await response.json()) as { chips?: PublicPromptChip[]; error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? 'Unable to load prompt chips.')
  }

  return Array.isArray(data.chips) ? data.chips : []
}
