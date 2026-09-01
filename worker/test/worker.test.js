import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { openSubtitlesFeaturesUrl, openSubtitlesSearchUrl, validAnime365SubtitleUrl } from '../src/index.js'

test('permits only direct Anime365 ASS URLs', () => {
  assert.equal(validAnime365SubtitleUrl('https://smotret-anime.app/translations/ass/42?download=1'), true)
  assert.equal(validAnime365SubtitleUrl('https://example.org/translations/ass/42'), false)
  assert.equal(validAnime365SubtitleUrl('https://smotret-anime.app/catalog/series'), false)
})

test('builds a constrained Russian episode search for OpenSubtitles', () => {
  const request = new URL('https://worker.example/opensubtitles/search?query=Ghost%20in%20the%20Shell&episode=5&year=2026')
  const upstream = openSubtitlesSearchUrl(request)
  assert.equal(upstream.origin, 'https://api.opensubtitles.com')
  assert.equal(upstream.pathname, '/api/v1/subtitles')
  assert.equal(upstream.searchParams.get('languages'), 'ru')
  assert.equal(upstream.searchParams.get('episode_number'), '5')
  assert.equal(upstream.searchParams.get('year'), '2026')
  assert.equal(upstream.searchParams.get('type'), 'episode')
})

test('builds OpenSubtitles feature and parent-feature searches', () => {
  const features = openSubtitlesFeaturesUrl(new URL('https://worker.example/opensubtitles/features?query=Ghost%20in%20the%20Shell&year=2026'))
  assert.equal(features.pathname, '/api/v1/features')
  assert.equal(features.searchParams.get('type'), 'tvshow')
  assert.equal(features.searchParams.get('year'), '2026')

  const subtitles = openSubtitlesSearchUrl(new URL('https://worker.example/opensubtitles/search?parent_feature_id=12345&episode=5'))
  assert.equal(subtitles.searchParams.get('parent_feature_id'), '12345')
  assert.equal(subtitles.searchParams.has('query'), false)
})

test('rejects malformed OpenSubtitles search and download parameters', async () => {
  assert.equal(openSubtitlesSearchUrl(new URL('https://worker.example/opensubtitles/search?query=Test&episode=0')), undefined)

  const response = await worker.fetch(
    new Request('https://worker.example/opensubtitles/subtitle?file_id=not-a-number'),
    { OPENSUBTITLES_API_KEY: 'test-key' }
  )
  assert.equal(response.status, 400)
})

test('does not expose OpenSubtitles endpoints without a configured secret', async () => {
  const response = await worker.fetch(new Request('https://worker.example/opensubtitles/search?query=Test&episode=1'), {})
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'OpenSubtitles is not configured' })
})
