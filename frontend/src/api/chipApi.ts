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

const apiUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')

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
