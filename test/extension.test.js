import test from 'node:test'
import assert from 'node:assert/strict'
import { HayaseRussianSubsSource, normalizeTitle, rankTranslations, selectSeries, subtitleUrl, titleScore } from '../src/extension.js'

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
    const endpoint = url.searchParams.get('path') ?? url.pathname.replace('/api', '')
    seen.push(endpoint)
    const data = endpoint === '/series'
      ? [{ id: 30414, anilistId: 154587 }]
      : endpoint === '/episodes'
        ? [{ id: 314104, episodeInt: 8, episodeType: 'tv', isActive: 1 }]
        : [
            { id: 10, type: 'subRu', isActive: 1, authorsSummary: 'Unknown', priority: 100 },
            { id: 20, type: 'subRu', isActive: 1, authorsSummary: 'AniLibria', priority: 1 }
          ]
    return { ok: true, json: async () => ({ data }) }
  }
  const result = await new HayaseRussianSubsSource().single(
    { anilistId: 154587, episode: 8, titles: ['Frieren: Beyond Journey’s End'], fetch },
    { subtitleProxyUrl: 'https://subs.example.workers.dev/subtitle' }
  )
  assert.deepEqual(seen, ['/series', '/episodes', '/translations'])
  assert.deepEqual(result, [
    { url: 'https://subs.example.workers.dev/subtitle?url=https%3A%2F%2Fsmotret-anime.app%2Ftranslations%2Fass%2F20%3Fdownload%3D1', language: 'RU' },
    { url: 'https://subs.example.workers.dev/subtitle?url=https%3A%2F%2Fsmotret-anime.app%2Ftranslations%2Fass%2F10%3Fdownload%3D1', language: 'RU' }
  ])
})

test('wraps the direct subtitle in a configured HTTPS proxy URL', () => {
  assert.equal(
    subtitleUrl('https://smotret-anime.app/translations/ass/42?download=1', 'https://subs.example.workers.dev/subtitle'),
    'https://subs.example.workers.dev/subtitle?url=https%3A%2F%2Fsmotret-anime.app%2Ftranslations%2Fass%2F42%3Fdownload%3D1'
  )
})
