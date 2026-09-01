const ALLOWED_HOSTS = new Set(['smotret-anime.app', 'smotret-anime.org', 'smotret-anime.online', 'anime365.ru', 'anime-365.ru'])
const ALLOWED_API_PATHS = new Set(['/series', '/episodes', '/translations'])
const OPENSUBTITLES_API_ORIGIN = 'https://api.opensubtitles.com/api/v1'
const OPENSUBTITLES_USER_AGENT = 'HayaseRussianSubs v0.3.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function jsonResponse (payload, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl }
  })
}

function openSubtitlesHeaders (env) {
  return {
    'Api-Key': env.OPENSUBTITLES_API_KEY,
    'User-Agent': OPENSUBTITLES_USER_AGENT,
    Accept: 'application/json'
  }
}

export function openSubtitlesSearchUrl (requestUrl) {
  const query = requestUrl.searchParams.get('query')?.trim()
  const episode = Number(requestUrl.searchParams.get('episode'))
  const parentFeatureId = Number(requestUrl.searchParams.get('parent_feature_id'))
  const validParentFeatureId = Number.isInteger(parentFeatureId) && parentFeatureId > 0
  if ((!validParentFeatureId && (!query || query.length > 200)) || !Number.isInteger(episode) || episode < 1 || episode > 10000) return undefined

  const upstream = new URL(`${OPENSUBTITLES_API_ORIGIN}/subtitles`)
  upstream.searchParams.set('languages', 'ru')
  if (validParentFeatureId) upstream.searchParams.set('parent_feature_id', String(parentFeatureId))
  else upstream.searchParams.set('query', query)
  upstream.searchParams.set('episode_number', String(episode))
  const year = Number(requestUrl.searchParams.get('year'))
  if (Number.isInteger(year) && year >= 1870 && year <= 2100) upstream.searchParams.set('year', String(year))
  upstream.searchParams.set('type', 'episode')
  upstream.searchParams.set('order_by', 'ratings')
  upstream.searchParams.set('order_direction', 'desc')
  return upstream
}

export function openSubtitlesFeaturesUrl (requestUrl) {
  const query = requestUrl.searchParams.get('query')?.trim()
  if (!query || query.length > 200) return undefined
  const upstream = new URL(`${OPENSUBTITLES_API_ORIGIN}/features`)
  upstream.searchParams.set('query', query)
  upstream.searchParams.set('type', 'tvshow')
  const year = Number(requestUrl.searchParams.get('year'))
  if (Number.isInteger(year) && year >= 1870 && year <= 2100) upstream.searchParams.set('year', String(year))
  return upstream
}

function openSubtitlesError (operation, upstream, payload) {
  const detail = payload?.message ?? payload?.error ?? `HTTP ${upstream.status}`
  return jsonResponse({ error: `OpenSubtitles ${operation} failed`, detail, status: upstream.status }, 502)
}

async function searchOpenSubtitles (requestUrl, env) {
  if (!env.OPENSUBTITLES_API_KEY) return jsonResponse({ error: 'OpenSubtitles is not configured' }, 503)
  const upstreamUrl = openSubtitlesSearchUrl(requestUrl)
  if (!upstreamUrl) return jsonResponse({ error: 'Invalid OpenSubtitles search parameters' }, 400)

  const upstream = await fetch(upstreamUrl, { headers: openSubtitlesHeaders(env) })
  const payload = await upstream.json().catch(() => undefined)
  if (!upstream.ok) return openSubtitlesError('search', upstream, payload)
  return jsonResponse(payload, 200, 'public, max-age=300')
}

async function searchOpenSubtitlesFeatures (requestUrl, env) {
  if (!env.OPENSUBTITLES_API_KEY) return jsonResponse({ error: 'OpenSubtitles is not configured' }, 503)
  const upstreamUrl = openSubtitlesFeaturesUrl(requestUrl)
  if (!upstreamUrl) return jsonResponse({ error: 'Invalid OpenSubtitles feature search parameters' }, 400)

  const upstream = await fetch(upstreamUrl, { headers: openSubtitlesHeaders(env) })
  const payload = await upstream.json().catch(() => undefined)
  if (!upstream.ok) return openSubtitlesError('feature search', upstream, payload)
  return jsonResponse(payload, 200, 'public, max-age=3600')
}

async function downloadOpenSubtitles (requestUrl, env) {
  if (!env.OPENSUBTITLES_API_KEY) return jsonResponse({ error: 'OpenSubtitles is not configured' }, 503)
  const fileId = Number(requestUrl.searchParams.get('file_id'))
  if (!Number.isInteger(fileId) || fileId < 1) return jsonResponse({ error: 'Invalid OpenSubtitles file_id' }, 400)

  const cache = globalThis.caches?.default
  const cacheKey = new Request(requestUrl.toString(), { method: 'GET' })
  const cached = await cache?.match(cacheKey)
  if (cached) return cached

  const upstream = await fetch(`${OPENSUBTITLES_API_ORIGIN}/download`, {
    method: 'POST',
    headers: { ...openSubtitlesHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, sub_format: 'srt' })
  })
  const payload = await upstream.json().catch(() => undefined)
  if (!upstream.ok || !payload?.link) return openSubtitlesError('download', upstream, payload)

  const subtitle = await fetch(payload.link, { redirect: 'follow' })
  if (!subtitle.ok) return jsonResponse({ error: 'OpenSubtitles file download failed', status: subtitle.status }, 502)
  const response = new Response(subtitle.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="subtitle.srt"',
      'Cache-Control': 'public, max-age=86400'
    }
  })
  if (cache) await cache.put(cacheKey, response.clone())
  return response
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
  async fetch (request, env = {}) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const requestUrl = new URL(request.url)
    if (request.method !== 'GET') return new Response('Not found', { status: 404, headers: corsHeaders })

    if (requestUrl.pathname === '/opensubtitles/search') return searchOpenSubtitles(requestUrl, env)
    if (requestUrl.pathname === '/opensubtitles/features') return searchOpenSubtitlesFeatures(requestUrl, env)
    if (requestUrl.pathname === '/opensubtitles/subtitle') return downloadOpenSubtitles(requestUrl, env)

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
