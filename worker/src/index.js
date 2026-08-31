const ALLOWED_HOSTS = new Set(['smotret-anime.app', 'smotret-anime.org', 'smotret-anime.online', 'anime365.ru', 'anime-365.ru'])

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

export default {
  async fetch (request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const requestUrl = new URL(request.url)
    if (request.method !== 'GET' || requestUrl.pathname !== '/subtitle') return new Response('Not found', { status: 404, headers: corsHeaders })

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
