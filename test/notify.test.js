import assert from 'node:assert/strict';
import test from 'node:test';
import { findUpdates, formatCaption, sendUpdates, testMessage, topicId } from '../notify.js';

const url = (id, domain = 'capital') => `https://www.1tamilmv.${domain}/index.php?/forums/topic/${id}-example/`;
const movie = (id, extra = {}) => ({
  title: `Movie ${id}`, year: 2026, type: 'movie', dubbed: false, audioLanguages: ['Malayalam'],
  sections: ['RECENTLY ADDED'], releaseTitle: `Movie ${id} (2026) Malayalam HD`, url: url(id),
  poster: `https://images.example/${id}.jpg`, ...extra,
});
const show = (id, episodes, extra = {}) => movie(id, {
  title: `Show ${id}`, type: 'tv_show', releaseTitle: `Show ${id} (2026) S01 EP (${episodes}) Malayalam HD`, ...extra,
});
const catalog = (movies, tvShows = []) => ({ movies, tvShows, errors: [] });

test('topic IDs ignore domain changes', () => {
  assert.equal(topicId(url(42, 'capital')), topicId(url(42, 'ceo')));
});

test('finds new topics and new TV episodes, ignoring unchanged and moved entries', () => {
  const previous = catalog([movie(1)], [show(2, '01-04'), show(3, '01-02')]);
  const current = catalog([movie(1, { url: url(1, 'ceo') }), movie(4)], [show(2, '01-06'), show(3, '01-02')]);
  assert.deepEqual(findUpdates(previous, current).map(({ kind, entry }) => [kind, entry.title]),
    [['new', 'Movie 4'], ['episodes', 'Show 2']]);
});

test('filters by audio and type', () => {
  const current = catalog([movie(1), movie(2, { dubbed: true })], [show(3, '01')]);
  const titles = (options) => findUpdates(catalog([]), current, options).map(({ entry }) => entry.title);
  assert.deepEqual(titles({ audio: 'original' }), ['Movie 1', 'Show 3']);
  assert.deepEqual(titles({ audio: 'dubbed' }), ['Movie 2']);
  assert.deepEqual(titles({ type: 'tv_show' }), ['Show 3']);
});

test('captions escape HTML and stay within Telegram limits', () => {
  const caption = formatCaption({ kind: 'new', entry: movie(1, {
    title: '<b>A & B</b>', sections: ['TOP RELEASES THIS WEEK'], releaseTitle: 'x'.repeat(2000),
  }) });
  assert.match(caption, /&lt;b&gt;A &amp; B&lt;\/b&gt;/);
  assert.match(caption, /Top release this week/);
  assert.ok(caption.length <= 1024);
  assert.doesNotMatch(caption, /xxxx/);
});

test('sends photos, falls back to text, summarizes overflow and retries rate limits', async () => {
  const calls = [];
  let rateLimited = false;
  const fetchImpl = async (address, { body }) => {
    const method = address.split('/').pop();
    const payload = JSON.parse(body);
    calls.push([method, payload.photo ?? null]);
    if (method === 'sendPhoto' && payload.photo.includes('/2.jpg')) {
      return { status: 400, json: async () => ({ ok: false, description: 'wrong file' }) };
    }
    if (!rateLimited) {
      rateLimited = true;
      return { status: 429, json: async () => ({ ok: false, parameters: { retry_after: 1 } }) };
    }
    return { status: 200, json: async () => ({ ok: true, result: {} }) };
  };
  const updates = [1, 2, 3, 4].map((id) => ({ kind: 'new', entry: movie(id) }));
  const result = await sendUpdates(updates, { token: 't', chatId: 'c', fetchImpl, wait: async () => {}, max: 3 });
  assert.deepEqual(result, { sent: 2, summarized: 2 });
  assert.deepEqual(calls.map(([method]) => method),
    ['sendPhoto', 'sendPhoto', 'sendPhoto', 'sendMessage', 'sendMessage']);
});

test('errors never contain the bot token', async () => {
  const fetchImpl = async () => ({ status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) });
  await assert.rejects(
    sendUpdates([{ kind: 'new', entry: movie(1, { poster: null }) }], { token: 'SECRET123', chatId: 'c', fetchImpl, wait: async () => {} }),
    (error) => !error.message.includes('SECRET123') && /Unauthorized/.test(error.message));
});

test('test message links to the site', () => {
  assert.match(testMessage('https://example.com/?a=1&b=2'), /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
});
