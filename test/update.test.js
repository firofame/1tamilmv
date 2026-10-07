import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_URL, scrape } from '../scraper.js';
import { hasChanges, needsTopRefresh, updateFile } from '../update.js';

const url = (id) => `${DEFAULT_URL}index.php?/forums/topic/${id}-example/`;
const section = (name, rows) => `<div class="banger-container"><div class="banger-header">${name}</div>${rows}</div>`;
const home = (top, recent) => section('TOP RELEASES THIS WEEK', top) + section('RECENTLY ADDED', recent);
const row = (id, text = `Title ${id} (2026) Malayalam HD`) => `<a href="${url(id)}">${text}</a>`;
const response = (html, address = DEFAULT_URL, status = 200) => ({
  ok: status === 200, status, url: address, headers: new Headers({ 'content-type': 'text/html' }), text: async () => html,
});
const entry = (id, sections) => ({
  title: `Title ${id}`, year: 2026, type: 'movie', language: 'Malayalam', sections,
  releaseTitle: `Title ${id} (2026) Malayalam HD`, url: url(id), poster: `https://images.example/${id}.jpg`,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
});
const previous = () => ({
  source: DEFAULT_URL, scrapedAt: '2026-01-01T00:00:00.000Z', topUpdatedAt: new Date().toISOString(),
  movies: [entry(1, ['TOP RELEASES THIS WEEK']), entry(2, ['RECENTLY ADDED'])], tvShows: [], errors: [],
});

test('hourly checks preserve daily top picks, remove vanished recent entries, and fetch only new details', async () => {
  const saved = previous();
  const requests = [];
  const result = await scrape({
    previous: saved,
    refreshTop: false,
    fetchImpl: async (address) => {
      requests.push(address);
      if (address === DEFAULT_URL) return response(home(row(4), `${row(3)}<br>${row(1)}`));
      return response('<h1 class="ipsType_pageTitle">Title 3 (2026) S01 Malayalam</h1><article class="cPost"><div data-role="commentContent"><img src="/poster.jpg"></div></article>', address);
    },
  });
  assert.deepEqual(requests, [DEFAULT_URL, url(3)]);
  assert.equal(result.movies.length, 1);
  assert.equal(result.tvShows.length, 1);
  assert.equal(result.movies[0].title, 'Title 1');
  assert.deepEqual(result.movies[0].sections, ['TOP RELEASES THIS WEEK', 'RECENTLY ADDED']);
  assert.equal(result.movies[0].poster, saved.movies[0].poster);
  assert.equal(result.movies[0].firstSeenAt, saved.movies[0].firstSeenAt);
  assert.equal(result.topUpdatedAt, saved.topUpdatedAt);
  assert.equal(result.tvShows[0].title, 'Title 3');
  assert.equal(result.tvShows[0].firstSeenAt, result.scrapedAt);
});

test('daily checks replace top membership without refetching cached posters', async () => {
  const saved = previous();
  let requests = 0;
  const result = await scrape({
    previous: saved, refreshTop: true,
    fetchImpl: async () => {
      requests += 1;
      return response(home(row(2), row(1)));
    },
  });
  assert.equal(requests, 1);
  assert.deepEqual(result.movies[0].sections, ['TOP RELEASES THIS WEEK']);
  assert.deepEqual(result.movies[1].sections, ['RECENTLY ADDED']);
  assert.equal(result.topUpdatedAt, result.scrapedAt);
});

test('known missing posters are cached, while previously failed details are retried', async () => {
  const saved = previous();
  saved.movies[0].poster = null;
  saved.errors = [{ url: url(2), message: 'Previous failure' }];
  const requests = [];
  const result = await scrape({
    previous: saved, refreshTop: false,
    fetchImpl: async (address) => {
      requests.push(address);
      if (address === DEFAULT_URL) return response(home(row(1), row(2)));
      return response('<h1 class="ipsType_pageTitle">Title 2 (2026) Malayalam</h1><div data-role="commentContent"><img src="/cover.jpg"></div>', address);
    },
  });
  assert.deepEqual(requests, [DEFAULT_URL, url(2)]);
  assert.equal(result.movies[0].poster, null);
  assert.equal(result.movies[1].poster, `${DEFAULT_URL}cover.jpg`);
  assert.deepEqual(result.errors, []);
});

test('refreshes top once per UTC date, or when no top refresh has been recorded', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(needsTopRefresh({ topUpdatedAt: '2026-10-07T00:17:00Z' }, now), false);
  assert.equal(needsTopRefresh({ topUpdatedAt: '2026-10-06T23:59:00Z' }, now), true);
  assert.equal(needsTopRefresh({ scrapedAt: '2026-10-07T12:00:00Z' }, now), true);
  assert.equal(hasChanges({ scrapedAt: 'old', movies: [] }, { scrapedAt: 'new', movies: [] }), false);
  assert.equal(hasChanges({ movies: [] }, { movies: [entry(1, [])] }), true);
});

test('unchanged checks do not rewrite the JSON; failed updates preserve the original file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'release-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'movies.json');
  const saved = previous();
  const original = JSON.stringify(saved);
  await writeFile(output, original);
  const unchanged = await updateFile({
    output,
    fetchImpl: async () => response(home(row(1), row(2))),
  });
  assert.equal(unchanged.changed, false);
  assert.equal(await readFile(output, 'utf8'), original);
  await assert.rejects(updateFile({
    output,
    fetchImpl: async (address) => address === DEFAULT_URL
      ? response(home(row(1), `${row(2)}<br>${row(3)}`))
      : response('', address, 403),
  }), /previous JSON preserved/);
  assert.equal(await readFile(output, 'utf8'), original);
});

test('updates are persisted atomically and never overwrite an existing temporary file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'release-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'movies.json');
  await writeFile(output, JSON.stringify(previous()));
  const fetchImpl = async (address) => address === DEFAULT_URL
    ? response(home(row(1), `${row(2)}<br>${row(3)}`))
    : response('<h1 class="ipsType_pageTitle">Title 3 (2026) Malayalam</h1>', address);
  const update = await updateFile({ output, fetchImpl });
  assert.equal(update.changed, true);
  const persisted = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(persisted.movies.length, 3);
  assert.deepEqual(persisted.errors, []);
  await assert.rejects(readFile(`${output}.tmp`), { code: 'ENOENT' });
  await writeFile(`${output}.tmp`, 'another writer');
  await assert.rejects(updateFile({ output, refreshTop: true, fetchImpl }), { code: 'EEXIST' });
  assert.equal(await readFile(`${output}.tmp`, 'utf8'), 'another writer');
});
