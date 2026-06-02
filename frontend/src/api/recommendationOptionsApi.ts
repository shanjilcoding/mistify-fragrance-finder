import { apiUrl } from './apiUrl'

export type RecommendationOption = {
  label: string
  value: string
}

export type RecommendationOptionGroup = {
  label: string
  options: RecommendationOption[]
}

export type RecommendationOptions = {
  moods: RecommendationOptionGroup[]
  occasions: RecommendationOptionGroup[]
  notes: RecommendationOptionGroup[]
  avoids: RecommendationOptionGroup[]
}

export async function getRecommendationOptions() {
  const response = await fetch(`${apiUrl}/recommendation-options`)
  const data = (await response.json()) as RecommendationOptions | { error?: string }

  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : 'Unable to load recommendation options.')
  }

  return data as RecommendationOptions
}
