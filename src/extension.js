const API_ORIGIN = 'https://smotret-anime.app'
const DEFAULT_SUBTITLE_PROXY_URL = 'https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle'
const PREFERRED_AUTHORS = [
  'sovetromantica',
  'crunchyroll',
  'anilibria',
  'anibreeze',
  'kazoku project'
]

const BaseSubtitleSource = globalThis.SubtitleSource ?? class {}

export function normalizeTitle (value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\b(?:tv|ova|ona|movie|film|season|cour|part|special|episode|серия|сезон|часть)\b\s*\d*/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function titleTokens (value) {
  return new Set(normalizeTitle(value)
    .split(' ')
    .filter(token => token.length > 1)
    // Covers common English title variants such as "Journey" / "Journey's".
    .map(token => token.replace(/([a-z]{4,})s$/i, '$1')))
}

export function titleScore (left, right) {
  const a = titleTokens(left)
  const b = titleTokens(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / new Set([...a, ...b]).size
}

export function selectSeries (series, titles) {
  const requested = (titles ?? []).filter(Boolean)
  const scored = series.map(item => {
    const candidates = [item.title, ...(item.allTitles ?? []), ...Object.values(item.titles ?? {})]
    const score = Math.max(0, ...requested.flatMap(requestedTitle => candidates.map(candidate => titleScore(requestedTitle, candidate))))
    return { item, score }
  }).sort((a, b) => b.score - a.score)

  if (!scored.length || scored[0].score < 0.6) return undefined
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.08) return undefined
  return scored[0].item
}

export function rankTranslations (translations) {
  return [...translations]
    .filter(item => item?.isActive && item.type === 'subRu' && Number.isFinite(Number(item.id)))
    .sort((left, right) => {
      const authorRank = value => {
        const author = String(value.authorsSummary ?? value.authorsList?.join(' ') ?? '').toLowerCase()
        const index = PREFERRED_AUTHORS.findIndex(name => author.includes(name))
        return index === -1 ? PREFERRED_AUTHORS.length : index
      }
      const byAuthor = authorRank(left) - authorRank(right)
      if (byAuthor !== 0) return byAuthor
      return Number(right.priority ?? 0) - Number(left.priority ?? 0)
    })
}

export function translationFileName (translation) {
  const authors = translation?.authorsSummary ?? translation?.authorsList?.join(', ') ?? `Translation ${translation?.id ?? 'unknown'}`
  const safeAuthors = String(authors)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `RU - ${safeAuthors || `Translation ${translation?.id ?? 'unknown'}`}.ass`
}

export function subtitleUrl (directUrl, proxyUrl) {
  if (!proxyUrl) return directUrl
  const proxy = new URL(proxyUrl)
  proxy.searchParams.set('url', directUrl)
  return proxy.toString()
}

function apiUrl (path, params = {}, proxyUrl) {
  if (proxyUrl) {
    const proxy = new URL(proxyUrl)
    proxy.pathname = '/api'
    proxy.search = ''
    proxy.searchParams.set('path', path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') proxy.searchParams.set(key, String(value))
    }
    return proxy.toString()
  }
  const url = new URL(`${API_ORIGIN}/api${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function getData (fetcher, path, params, proxyUrl) {
  const response = await fetcher(apiUrl(path, params, proxyUrl))
  if (!response.ok) throw new Error(`Anime365 API returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (payload?.error) throw new Error(`Anime365 API error: ${payload.error.message ?? payload.error.code ?? 'unknown error'}.`)
  if (!('data' in (payload ?? {}))) throw new Error('Anime365 API returned an unexpected response.')
  return payload.data
}

function episodeForNumber (episodes, episode) {
  const matching = episodes.filter(item => Number(item.episodeInt) === Number(episode) && item.isActive)
  const typeRank = { tv: 0, ona: 1, ova: 2, special: 3, movie: 4, preview: 5 }
  return matching.sort((a, b) => (typeRank[a.episodeType] ?? 99) - (typeRank[b.episodeType] ?? 99))[0]
}

function clampMaxResults (value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 10) : 5
}

async function adapterResults (fetcher, adapterUrl, query) {
  const url = new URL(adapterUrl)
  url.searchParams.set('anilistId', String(query.anilistId))
  url.searchParams.set('episode', String(query.episode))
  const response = await fetcher(url.toString())
  if (!response.ok) throw new Error(`Subtitle fallback adapter returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error('Subtitle fallback adapter must return a JSON array.')
  return payload.filter(item => item && typeof item.url === 'string' && item.language === 'RU')
}

async function resolveSeries (fetcher, query, proxyUrl) {
  // Anime365 currently returns its default catalog page for anilistId=.
  // Search by Hayase's title variants, then use AniList ID only to select a result.
  const lookupTitles = [...new Set((query.titles ?? []).filter(Boolean))]
    .sort((left, right) => normalizeTitle(right).length - normalizeTitle(left).length)
    .slice(0, 3)
  const candidates = []
  for (const title of lookupTitles) {
    const results = await getData(fetcher, '/series', { query: title, limit: 10 }, proxyUrl)
    if (Array.isArray(results)) candidates.push(...results)
  }
  const distinct = [...new Map(candidates.filter(item => item?.id).map(item => [item.id, item])).values()]
  return distinct.find(item => Number(item.anilistId) === Number(query.anilistId)) ?? selectSeries(distinct, query.titles)
}

export class HayaseRussianSubsSource extends BaseSubtitleSource {
  async test () {
    try {
      const response = await fetch(apiUrl('/series', { query: 'Frieren', limit: 1 }, DEFAULT_SUBTITLE_PROXY_URL))
      if (!response.ok) throw new Error(`Anime365 returned HTTP ${response.status}.`)
      const payload = await response.json()
      if (!Array.isArray(payload?.data)) throw new Error('Anime365 returned an unexpected response.')
      return true
    } catch (error) {
      throw new Error(`Anime365 is unavailable: ${error.message ?? String(error)}`)
    }
  }

  async single (query, options = {}) {
    const fetcher = query.fetch ?? fetch
    if (options.adapterUrl) return adapterResults(fetcher, options.adapterUrl, query)
    const subtitleProxyUrl = options.subtitleProxyUrl || DEFAULT_SUBTITLE_PROXY_URL

    const series = await resolveSeries(fetcher, query, subtitleProxyUrl)
    if (!series) return []

    const episodes = await getData(fetcher, '/episodes', { seriesId: series.id, episodeInt: query.episode, isActive: 1, limit: 20 }, subtitleProxyUrl)
    const episode = episodeForNumber(Array.isArray(episodes) ? episodes : [], query.episode)
    if (!episode) return []

    const translations = await getData(fetcher, '/translations', { episodeId: episode.id, type: 'subRu', isActive: 1, limit: 50 }, subtitleProxyUrl)
    return rankTranslations(Array.isArray(translations) ? translations : [])
      .slice(0, clampMaxResults(options.maxResults))
      .map(item => ({
        url: subtitleUrl(`${API_ORIGIN}/translations/ass/${item.id}?download=1`, subtitleProxyUrl),
        // Hayase uses `language` as the fetched file name and rejects names
        // without a supported subtitle extension before parsing the payload.
        language: translationFileName(item)
      }))
  }
}

export default new HayaseRussianSubsSource()
