import test from 'node:test'
import assert from 'node:assert/strict'
import { HayaseRussianSubsSource, normalizeTitle, rankTranslations, selectSeries, titleScore } from '../src/extension.js'

test('normalizes punctuation, diacritics and season markers', () => {
  assert.equal(normalizeTitle('Frieren: Beyond Journey’s End - Season 2'), 'frieren beyond journeys end')
  assert.equal(normalizeTitle('Sōsō no Frieren (TV-1)'), 'soso no frieren 1')
})

test('scores equivalent title tokens and rejects unrelated titles', () => {
  assert.ok(titleScore('Frieren Beyond Journey End', 'Frieren: Beyond Journey’s End') > 0.7)
  assert.equal(titleScore('Frieren', 'Fullmetal Alchemist'), 0)
})

test('selects an unambiguous title fallback only', () => {
  const chosen = selectSeries([
    { id: 1, title: 'Frieren: Beyond Journey’s End', allTitles: ['Sousou no Frieren'] },
    { id: 2, title: 'Fullmetal Alchemist Brotherhood', allTitles: [] }
  ], ['Sousou no Frieren'])
  assert.equal(chosen.id, 1)
  assert.equal(selectSeries([{ id: 1, title: 'Naruto' }], ['Bleach']), undefined)
})

test('ranks active Russian subtitle translations deterministically', () => {
  const ranked = rankTranslations([
    { id: 1, isActive: 1, type: 'subRu', authorsSummary: 'Unknown', priority: 100 },
    { id: 2, isActive: 1, type: 'subRu', authorsSummary: 'AniLibria', priority: 1 },
    { id: 3, isActive: 0, type: 'subRu', authorsSummary: 'Crunchyroll', priority: 999 },
    { id: 4, isActive: 1, type: 'voiceRu', authorsSummary: 'Crunchyroll', priority: 999 }
  ])
  assert.deepEqual(ranked.map(item => item.id), [2, 1])
})

test('single follows AniList ID, episode and direct ASS download route', async () => {
  const seen = []
  const fetch = async rawUrl => {
    const url = new URL(rawUrl)
    seen.push(url.pathname)
    const data = url.pathname.endsWith('/series')
      ? [{ id: 30414, anilistId: 154587 }]
      : url.pathname.endsWith('/episodes')
        ? [{ id: 314104, episodeInt: 8, episodeType: 'tv', isActive: 1 }]
        : [
            { id: 10, type: 'subRu', isActive: 1, authorsSummary: 'Unknown', priority: 100 },
            { id: 20, type: 'subRu', isActive: 1, authorsSummary: 'AniLibria', priority: 1 }
          ]
    return { ok: true, json: async () => ({ data }) }
  }
  const result = await new HayaseRussianSubsSource().single({ anilistId: 154587, episode: 8, titles: [], fetch })
  assert.deepEqual(seen, ['/api/series', '/api/episodes', '/api/translations'])
  assert.deepEqual(result, [
    { url: 'https://smotret-anime.app/translations/ass/20?download=1', language: 'RU' },
    { url: 'https://smotret-anime.app/translations/ass/10?download=1', language: 'RU' }
  ])
})
