import test from 'node:test'
import assert from 'node:assert/strict'
import { validAnime365SubtitleUrl } from '../src/index.js'

test('permits only direct Anime365 ASS URLs', () => {
  assert.equal(validAnime365SubtitleUrl('https://smotret-anime.app/translations/ass/42?download=1'), true)
  assert.equal(validAnime365SubtitleUrl('https://example.org/translations/ass/42'), false)
  assert.equal(validAnime365SubtitleUrl('https://smotret-anime.app/catalog/series'), false)
})
