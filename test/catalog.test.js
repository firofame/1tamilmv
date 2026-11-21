import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAudio, episodeLabel, filterEntries, posterUrl, safeUrl, validateCatalog } from '../catalog.js';

const recent = { title: 'River', year: 2026, type: 'movie', sections: ['RECENTLY ADDED'], url: 'https://example.com/movie', poster: null };
const top = { title: 'Sky', year: 2025, type: 'tv_show', sections: ['TOP RELEASES THIS WEEK', 'RECENTLY ADDED'], url: 'https://example.com/show', poster: 'https://example.com/poster.jpg' };

test('combines both sections with top picks first, preserving order within each group', () => {
  const topOnly = { ...recent, title: 'Hill', sections: ['TOP RELEASES THIS WEEK'] };
  const recentShow = { ...top, title: 'Forest', sections: ['RECENTLY ADDED'] };
  const entries = [recent, topOnly, recentShow, top];
  assert.deepEqual(filterEntries(entries), [topOnly, top, recent, recentShow]);
  assert.deepEqual(entries, [recent, topOnly, recentShow, top]);
  assert.deepEqual(filterEntries([recent, recentShow]), [recent, recentShow]);
  assert.deepEqual(filterEntries([topOnly, top]), [topOnly, top]);
  assert.deepEqual(filterEntries([]), []);
});

test('filters the combined list by type, case-insensitive title and year', () => {
  const entries = [recent, top];
  assert.deepEqual(filterEntries(entries), [top, recent]);
  assert.deepEqual(filterEntries(entries, { type: 'movie', query: ' RIVER ' }), [recent]);
  assert.deepEqual(filterEntries(entries, { query: '2025' }), [top]);
  assert.deepEqual(filterEntries(entries, { type: 'tv_show' }), [top]);
  assert.deepEqual(filterEntries(entries, { type: 'movie', query: 'Sky' }), []);
});

test('validates data, rejecting invalid dates, unsupported URLs and malformed entries', () => {
  const data = { movies: [recent], tvShows: [top], errors: [], scrapedAt: new Date().toISOString() };
  assert.deepEqual(validateCatalog(data), [
    { ...recent, dubbed: false, audioLanguages: [] },
    { ...top, dubbed: false, audioLanguages: [] },
  ]);
  assert.throws(() => validateCatalog({ ...data, scrapedAt: 'invalid' }), /invalid/);
  assert.throws(() => validateCatalog({ ...data, topUpdatedAt: 'invalid' }), /invalid/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, url: 'javascript:alert(1)' }] }), /invalid entry/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, poster: '/relative.jpg' }] }), /invalid entry/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, dubbed: 'yes' }] }), /invalid entry/);
  assert.throws(() => validateCatalog({ ...data, movies: [{ ...recent, audioLanguages: 'Malayalam' }] }), /invalid entry/);
  assert.equal(safeUrl('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');
  assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl(undefined), null);
});

test('classifies dubbed audio only when languages appear inside a bracketed list', () => {
  assert.deepEqual(classifyAudio('Chiram (2026) Malayalam UHD + ESub - [4K - (DD+5.1) - 5.7GB]'), {
    dubbed: false, audioLanguages: ['Malayalam'],
  });
  assert.deepEqual(classifyAudio('418 (2026) UHD + ESub - [4K - [HIN + MAL + KAN] - 20GB]'), {
    dubbed: true, audioLanguages: ['Hindi', 'Malayalam', 'Kannada'],
  });
  assert.deepEqual(classifyAudio('Madden (2026) (HD + Org Auds) - [1080p - (TAM + TEL + HIN + MAL + KAN + ENG)]'), {
    dubbed: true, audioLanguages: ['Tamil', 'Telugu', 'Hindi', 'Malayalam', 'Kannada', 'English'],
  });
  assert.deepEqual(classifyAudio('Daayra (2026) UHD + ESub - [4K - [Hindi + Malayalam] - 6GB]'), {
    dubbed: true, audioLanguages: ['Hindi', 'Malayalam'],
  });
  assert.deepEqual(classifyAudio('Undated Malayalam HD'), { dubbed: false, audioLanguages: ['Malayalam'] });
});

test('filters by original versus dubbed audio', () => {
  const dubbed = { ...recent, title: 'Dub', dubbed: true, audioLanguages: ['Hindi', 'Malayalam'] };
  const entries = [dubbed, recent, top];
  assert.deepEqual(filterEntries(entries, { audio: 'dubbed' }), [dubbed]);
  assert.deepEqual(filterEntries(entries, { audio: 'original' }), [top, recent]);
  assert.deepEqual(filterEntries(entries, { audio: 'all' }), [top, dubbed, recent]);
  assert.deepEqual(filterEntries(entries, { type: 'movie', audio: 'original', query: 'river' }), [recent]);
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
