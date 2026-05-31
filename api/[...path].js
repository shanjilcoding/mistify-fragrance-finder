const backendApiUrl = process.env.BACKEND_API_URL || process.env.VITE_API_URL

function buildBackendUrl(pathParts, query) {
  if (!backendApiUrl) {
    throw new Error('BACKEND_API_URL or VITE_API_URL is required for API proxying.')
  }

  const baseUrl = backendApiUrl.replace(/\/$/, '')
  const path = Array.isArray(pathParts) ? pathParts.join('/') : ''
  return `${baseUrl}/${path}${query ? `?${query}` : ''}`
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  try {
    const targetUrl = buildBackendUrl(request.query.path, request.url.split('?')[1] ?? '')
    const headers = {}

    for (const header of ['authorization', 'content-type', 'origin', 'referer']) {
      const value = request.headers[header]
      if (value) headers[header] = value
    }

    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : JSON.stringify(request.body ?? {}),
    })

    const contentType = backendResponse.headers.get('content-type')
    const body = await backendResponse.text()

    if (contentType) {
      response.setHeader('content-type', contentType)
    }

    response.status(backendResponse.status).send(body)
  } catch (error) {
    console.error('[vercel-api-proxy] request failed', error)
    response.status(502).json({ error: 'API proxy request failed.' })
  }
}
