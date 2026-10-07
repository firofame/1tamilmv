import assert from 'node:assert/strict';
import test from 'node:test';
import { episodeLabel, filterEntries, posterUrl, safeUrl, validateCatalog } from '../catalog.js';

const recent = { title: 'River', year: 2026, type: 'movie', sections: ['RECENTLY ADDED'], url: 'https://example.com/movie', poster: null };
const top = { title: 'Sky', year: 2025, type: 'tv_show', sections: ['TOP RELEASES THIS WEEK', 'RECENTLY ADDED'], url: 'https://example.com/show', poster: 'https://example.com/poster.jpg' };

test('filters by section, type, case-insensitive title and year', () => {
  const entries = [recent, top];
  assert.equal(filterEntries(entries).length, 2);
  assert.deepEqual(filterEntries(entries, { section: 'top' }), [top]);
  assert.deepEqual(filterEntries(entries, { type: 'movie', query: ' RIVER ' }), [recent]);
  assert.deepEqual(filterEntries(entries, { query: '2025' }), [top]);
  assert.deepEqual(filterEntries(entries, { section: 'top', type: 'movie' }), []);
});

test('validates data, rejecting invalid dates, unsupported URLs and malformed entries', () => {
  const data = { movies: [recent], tvShows: [top], errors: [], scrapedAt: new Date().toISOString() };
  assert.deepEqual(validateCatalog(data), [recent, top]);
  assert.throws(() => validateCatalog({ ...data, scrapedAt: 'invalid' }), /invalid/);
  assert.throws(() => validateCatalog({ ...data, topUpdatedAt: 'invalid' }), /invalid/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, url: 'javascript:alert(1)' }] }), /invalid entry/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, poster: '/relative.jpg' }] }), /invalid entry/);
  assert.equal(safeUrl('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');
  assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl(undefined), null);
});

test('extracts episode labels without assuming every entry is episodic', () => {
  assert.equal(episodeLabel('Show (2026) S010 EP31 HD'), 'Season 10 / Ep 31');
  assert.equal(episodeLabel('Show (2026) S01 EP (01-08)'), 'Season 1 / Ep 01-08');
  assert.equal(episodeLabel('Show (2026) S02E03'), 'Season 2 / Ep 03');
  assert.equal(episodeLabel('Movie (2026) HD'), '');
});

test('requests mobile-sized artwork only from supported hosts', () => {
  assert.equal(posterUrl('https://pbs.twimg.com/media/example?format=jpg&name=4096x4096'), 'https://pbs.twimg.com/media/example?format=jpg&name=small');
  assert.equal(posterUrl('https://image.tmdb.org/t/p/original/example.jpg'), 'https://image.tmdb.org/t/p/w500/example.jpg');
  assert.equal(posterUrl('https://m.media-amazon.com/images/M/example._V1_.jpg'), 'https://m.media-amazon.com/images/M/example._V1_SX500_.jpg');
  assert.equal(posterUrl('https://other.example/poster.jpg'), 'https://other.example/poster.jpg');
  assert.throws(() => posterUrl('javascript:alert(1)'), /Invalid poster URL/);
});
