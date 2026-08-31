const ALLOWED_HOSTS = new Set(['smotret-anime.app', 'smotret-anime.org', 'smotret-anime.online', 'anime365.ru', 'anime-365.ru'])
const ALLOWED_API_PATHS = new Set(['/series', '/episodes', '/translations'])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export function validAnime365SubtitleUrl (rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && /^\/translations\/ass\/\d+$/.test(url.pathname)
  } catch {
    return false
  }
}

function anime365ApiUrl (requestUrl) {
  const path = requestUrl.searchParams.get('path')
  if (!path || !ALLOWED_API_PATHS.has(path)) return undefined

  const upstream = new URL(`https://smotret-anime.app/api${path}`)
  for (const [key, value] of requestUrl.searchParams) {
    if (key !== 'path') upstream.searchParams.set(key, value)
  }
  return upstream
}

export default {
  async fetch (request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const requestUrl = new URL(request.url)
    if (request.method !== 'GET') return new Response('Not found', { status: 404, headers: corsHeaders })

    if (requestUrl.pathname === '/api') {
      const upstreamUrl = anime365ApiUrl(requestUrl)
      if (!upstreamUrl) return new Response('Unsupported Anime365 API path', { status: 400, headers: corsHeaders })

      const upstream = await fetch(upstreamUrl)
      if (!upstream.ok) return new Response(`Anime365 API returned HTTP ${upstream.status}`, { status: 502, headers: corsHeaders })
      return new Response(upstream.body, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
      })
    }

    if (requestUrl.pathname !== '/subtitle') return new Response('Not found', { status: 404, headers: corsHeaders })

    const upstreamUrl = requestUrl.searchParams.get('url')
    if (!upstreamUrl || !validAnime365SubtitleUrl(upstreamUrl)) return new Response('Invalid Anime365 subtitle URL', { status: 400, headers: corsHeaders })

    const upstream = await fetch(upstreamUrl, { redirect: 'follow' })
    if (!upstream.ok) return new Response('Anime365 subtitle download failed', { status: 502, headers: corsHeaders })
    return new Response(upstream.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.ass"',
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
}
