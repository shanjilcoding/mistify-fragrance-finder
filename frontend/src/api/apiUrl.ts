const configuredApiUrl = import.meta.env.VITE_API_URL

export const apiUrl = getApiUrl()

function getApiUrl() {
  if (import.meta.env.DEV) {
    return configuredApiUrl ?? '/api'
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && configuredApiUrl?.startsWith('http://')) {
    return '/api'
  }

  return configuredApiUrl ?? '/api'
}
