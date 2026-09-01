const API_ORIGIN = 'https://smotret-anime.app'
const DEFAULT_SUBTITLE_PROXY_URL = 'https://hayase-russian-subs-proxy.arecvien.workers.dev/subtitle'
const OPENSUBTITLES_RESULT_LIMIT = 1
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

function safeFileLabel (value, fallback) {
  return String(value ?? fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback
}

export function openSubtitlesFileName (subtitle) {
  const uploader = safeFileLabel(subtitle?.attributes?.uploader?.name, 'Unknown uploader')
  return `RU - OpenSubtitles - ${uploader}.srt`
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

function workerUrl (proxyUrl, pathname, params = {}) {
  const url = new URL(proxyUrl || DEFAULT_SUBTITLE_PROXY_URL)
  url.pathname = pathname
  url.search = ''
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function rankOpenSubtitles (subtitles, titles, episode) {
  const requestedTitles = (titles ?? []).filter(Boolean)
  return [...(subtitles ?? [])]
    .filter(item => item?.attributes?.language === 'ru' && Array.isArray(item.attributes.files) && item.attributes.files.length)
    .map(item => {
      const attributes = item.attributes
      const feature = attributes.feature_details ?? {}
      const candidateTitles = [feature.parent_title, feature.title, feature.movie_name, attributes.release].filter(Boolean)
      const matchScore = Math.max(0, ...requestedTitles.flatMap(title => candidateTitles.map(candidate => titleScore(title, candidate))))
      const featureEpisode = Number(feature.episode_number ?? attributes.episode_number)
      return { item, matchScore, featureEpisode }
    })
    .filter(({ matchScore, featureEpisode }) => matchScore >= 0.45 && (!Number.isFinite(featureEpisode) || featureEpisode === Number(episode)))
    .sort((left, right) => {
      const a = left.item.attributes
      const b = right.item.attributes
      const trusted = Number(Boolean(b.from_trusted)) - Number(Boolean(a.from_trusted))
      if (trusted !== 0) return trusted
      const human = Number(Boolean(a.machine_translated || a.ai_translated)) - Number(Boolean(b.machine_translated || b.ai_translated))
      if (human !== 0) return human
      const byMatch = right.matchScore - left.matchScore
      if (byMatch !== 0) return byMatch
      const byRating = Number(b.ratings ?? 0) - Number(a.ratings ?? 0)
      if (byRating !== 0) return byRating
      return Number(b.download_count ?? 0) - Number(a.download_count ?? 0)
    })
    .map(({ item }) => item)
}

export function rankOpenSubtitlesFeatures (features, titles, year) {
  const requestedTitles = (titles ?? []).filter(Boolean)
  return [...(features ?? [])]
    .filter(item => Number.isInteger(Number(item?.id)))
    .map(item => {
      const attributes = item.attributes ?? {}
      const candidateTitles = [attributes.title, attributes.original_title, attributes.movie_name].filter(Boolean)
      const matchScore = Math.max(0, ...requestedTitles.flatMap(title => candidateTitles.map(candidate => titleScore(title, candidate))))
      const yearMatches = !Number.isInteger(Number(year)) || !Number.isInteger(Number(attributes.year)) || Number(attributes.year) === Number(year)
      return { item, matchScore, yearMatches }
    })
    .filter(({ matchScore, yearMatches }) => matchScore >= 0.6 && yearMatches)
    .sort((left, right) => right.matchScore - left.matchScore)
    .map(({ item }) => item)
}

async function resolveOpenSubtitlesFeature (fetcher, query, proxyUrl, year, lookupTitles) {
  const candidates = []
  for (const title of lookupTitles) {
    const response = await fetcher(workerUrl(proxyUrl, '/opensubtitles/features', { query: title, year }))
    if (!response.ok) continue
    const payload = await response.json()
    if (Array.isArray(payload?.data)) candidates.push(...payload.data)
  }
  const distinct = [...new Map(candidates.filter(item => item?.id).map(item => [item.id, item])).values()]
  return rankOpenSubtitlesFeatures(distinct, query.titles, year)[0]
}

async function openSubtitlesResults (fetcher, query, proxyUrl, year) {
  const lookupTitles = [...new Set((query.titles ?? []).filter(Boolean))]
    .sort((left, right) => normalizeTitle(right).length - normalizeTitle(left).length)
    .slice(0, 3)
  const candidates = []
  const feature = await resolveOpenSubtitlesFeature(fetcher, query, proxyUrl, year, lookupTitles)
  if (feature) {
    const response = await fetcher(workerUrl(proxyUrl, '/opensubtitles/search', { parent_feature_id: feature.id, episode: query.episode, year }))
    if (response.ok) {
      const payload = await response.json()
      if (Array.isArray(payload?.data)) candidates.push(...payload.data)
    }
  } else {
    for (const title of lookupTitles) {
      const response = await fetcher(workerUrl(proxyUrl, '/opensubtitles/search', { query: title, episode: query.episode, year }))
      if (!response.ok) continue
      const payload = await response.json()
      if (Array.isArray(payload?.data)) candidates.push(...payload.data)
    }
  }

  const distinct = [...new Map(candidates
    .filter(item => item?.attributes?.files?.[0]?.file_id)
    .map(item => [item.attributes.files[0].file_id, item])).values()]
  return rankOpenSubtitles(distinct, query.titles, query.episode)
    .slice(0, OPENSUBTITLES_RESULT_LIMIT)
    .map(item => ({
      url: workerUrl(proxyUrl, '/opensubtitles/subtitle', { file_id: item.attributes.files[0].file_id }),
      language: openSubtitlesFileName(item)
    }))
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

async function anime365Results (fetcher, query, proxyUrl, series) {
  const episodes = await getData(fetcher, '/episodes', { seriesId: series.id, episodeInt: query.episode, isActive: 1, limit: 20 }, proxyUrl)
  const episode = episodeForNumber(Array.isArray(episodes) ? episodes : [], query.episode)
  if (!episode) return []

  const translations = await getData(fetcher, '/translations', { episodeId: episode.id, type: 'subRu', isActive: 1, limit: 50 }, proxyUrl)
  return rankTranslations(Array.isArray(translations) ? translations : [])
    .map(item => ({
      url: subtitleUrl(`${API_ORIGIN}/translations/ass/${item.id}?download=1`, proxyUrl),
      language: translationFileName(item)
    }))
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
    const maxResults = clampMaxResults(options.maxResults)

    let anime365 = []
    let openSubtitles = []
    let series
    try {
      series = await resolveSeries(fetcher, query, subtitleProxyUrl)
      if (series) anime365 = await anime365Results(fetcher, query, subtitleProxyUrl, series)
    } catch {}
    try { openSubtitles = await openSubtitlesResults(fetcher, query, subtitleProxyUrl, series?.year) } catch {}

    if (!anime365.length) return openSubtitles.slice(0, maxResults)
    if (!openSubtitles.length || maxResults === 1) return anime365.slice(0, maxResults)
    return [...anime365.slice(0, maxResults - 1), openSubtitles[0]]
  }
}

export default new HayaseRussianSubsSource()
