import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { DEFAULT_URL, parseDetails, parseHomepage, scrape } from '../scraper.js';

const topic = (id, slug = 'example') => `/index.php?/forums/topic/${id}-${slug}/`;
const link = (id, text, slug) => `<a href="${topic(id, slug)}">${text}</a>`;
const section = (title, rows) => `<div class="banger-container">
  <div class="banger-header"><span>${title}</span></div>${rows}</div>`;
const home = (top, recent) => section('TOP RELEASES THIS WEEK', top)
  + section('RECENTLY ADDED', recent);
const detail = (title, content = '') => `<h1 class="ipsType_pageTitle">${title}</h1>
  <article class="cPost"><div data-role="commentContent">${content}</div></article>`;

test('reads complete rows, only target sections, Malayalam audio, and merges duplicate topics', () => {
  const html = home(
    `<div class="banger-row"><strong>River &amp; Rain (2026) Malayalam HD -
    </strong><strong>${link(1, '[1080p]')} - <a href="https://watch.example/">[W]</a>
    <br>${link(2, 'Example Show (2026) S01 EP (01-08) [TAM + MAL + ENG]')}</strong></div>`,
    `<p>${link(1, 'River &amp; Rain (2026) Malayalam HD')}<br>
    ${link(3, 'Tamil Only (2026) Tamil HD', 'malayalam-stale-slug')}<br>
    ${link(4, 'Mal (2026) Tamil HD')}<br>
    ${link(5, 'English Movie (2026) [HIN + ENG]')}</p>`,
  ) + section('OTHER RELEASES', link(6, 'Outside (2026) Malayalam HD'));
  const entries = parseHomepage(html);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'River & Rain');
  assert.equal(entries[0].year, 2026);
  assert.equal(entries[0].type, 'movie');
  assert.equal(entries[0].releaseTitle, 'River & Rain (2026) Malayalam HD - [1080p]');
  assert.deepEqual(entries[0].sections, ['TOP RELEASES THIS WEEK', 'RECENTLY ADDED']);
  assert.equal(entries[0].url, new URL(topic(1), DEFAULT_URL).href);
  assert.equal(entries[1].type, 'tv_show');
  assert.equal(entries[1].poster, null);
});

test('skips PreDVD variants in row text and URLs but preserves legitimate HD releases', () => {
  const entries = parseHomepage(home(
    `<p>${link(1, 'Clean (2026) Malayalam HD')}<br>
    ${link(2, 'Skip A (2026) Malayalam HQ PreDVD')}<br>
    ${link(3, 'Skip B (2026) Malayalam Pre-DVD')}<br>
    ${link(4, 'Skip C (2026) Malayalam Pre DVD')}<br>
    ${link(5, 'Skip D (2026) Malayalam HD', 'malayalam-hq-predvd')}</p>`,
    link(6, 'Other (2026) Tamil HD'),
  ));
  assert.deepEqual(entries.map((entry) => entry.title), ['Clean']);
});

test('classifies season, episode, and series markers and supports missing year', () => {
  const titles = [
    'Show A (2026) S010 EP31 Malayalam',
    'Show B (2026) S01E02 Malayalam',
    'Show C (2026) Season 2 Malayalam',
    'Show D (2026) Episode 3 Malayalam',
    'Show E (2026) Web Series Malayalam',
    'Show F (2026) TV Series Malayalam',
    'Undated Show Malayalam Season 1 HD',
  ];
  const entries = parseHomepage(home(
    titles.map((title, index) => link(index + 1, title)).join('<br>'),
    link(99, 'Other (2026) Tamil'),
  ));
  assert.equal(entries.length, titles.length);
  assert.ok(entries.every((entry) => entry.type === 'tv_show'));
  assert.equal(entries.at(-1).title, 'Undated Show');
  assert.equal(entries.at(-1).year, null);
});

test('includes multilingual movie collections and shows with year ranges', () => {
  const entries = parseHomepage(home(
    `${link(1, 'Example Collection (2002 - 2023) BluRay [TAM + MAL (5) + ENG]')}<br>
    ${link(2, 'Example Series (2025 \u2013 2026) S01 [MAL + ENG]')}`,
    link(99, 'Other (2026) Tamil'),
  ));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'Example Collection');
  assert.equal(entries[0].year, 2002);
  assert.equal(entries[0].type, 'movie');
  assert.equal(entries[1].title, 'Example Series');
  assert.equal(entries[1].year, 2025);
  assert.equal(entries[1].type, 'tv_show');
});

test('rejects missing sections or changed topic markup instead of returning empty success', () => {
  assert.throws(() => parseHomepage('<html>Access denied</html>'), /section not found/);
  assert.throws(() => parseHomepage(section('TOP RELEASES THIS WEEK', link(1, 'A (2026) Malayalam'))), /RECENTLY ADDED/);
  assert.throws(() => parseHomepage(home('<p>No links</p>', link(2, 'B (2026) Malayalam'))), /No topic links/);
  assert.deepEqual(parseHomepage(home(link(1, 'A (2026) Tamil'), link(2, 'B (2026) Hindi'))), []);
});

test('uses topic IDs for deduplication, ignores watch/offsite links, and handles redirects', () => {
  const baseUrl = 'https://new.example/';
  const entries = parseHomepage(home(
    `${link(1, 'A (2026) Malayalam', 'old')}<br>
    <a href="https://unrelated.example/forums/topic/999-fake/">Fake (2026) Malayalam</a>`,
    link(1, 'A (2026) Malayalam', 'new'),
  ), baseUrl);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, new URL(topic(1, 'old'), baseUrl).href);
  assert.equal(entries[0].sections.length, 2);
});

test('selects lazy-loaded original-post artwork rather than graphics, screenshots, or replies', () => {
  const html = detail('A (2026) Malayalam HD', `
    <img src="/logo.png"><img class="ipsEmoji" src="/emoji.png">
    <img src="/torrborder.gif"><img src="/utorrent.png" width="128">
    <img src="/screenshot.jpg" width="1920" height="1080">
    <img class="ipsImage" src="data:image/gif;base64,x" data-src="//images.example/poster.jpg" width="600" height="900">
  `) + '<article class="cPost"><div data-role="commentContent"><img src="/reply-poster.jpg"></div></article>';
  assert.deepEqual(parseDetails(html, DEFAULT_URL), {
    poster: 'https://images.example/poster.jpg', isPreDvd: false, type: 'movie',
  });
});

test('prefers poster host, supports relative/data-original sources, and missing posters', () => {
  const hosted = 'https://m.media-amazon.com/images/M/example.jpg';
  assert.equal(parseDetails(detail('A (2026) Malayalam', `
    <img src="/random.jpg"><img src="${hosted}">
  `), DEFAULT_URL).poster, hosted);
  assert.equal(parseDetails(detail('A (2026) Malayalam', '<img data-original="/cover.jpg">'), DEFAULT_URL).poster, `${DEFAULT_URL}cover.jpg`);
  assert.equal(parseDetails(detail('A (2026) Malayalam') + `
    <article class="cPost"><div data-role="commentContent"><img src="/reply.jpg"></div></article>
  `, DEFAULT_URL).poster, null);
  assert.equal(parseDetails(detail('A (2026) Malayalam', '<img src="/logo.png">'), DEFAULT_URL).poster, null);
});

test('falls back to Open Graph artwork and rejects generic logo metadata', () => {
  const title = detail('A (2026) Malayalam');
  assert.equal(parseDetails(`${title}<meta property="og:image" content="/poster.jpg">`, DEFAULT_URL).poster, `${DEFAULT_URL}poster.jpg`);
  assert.equal(parseDetails(`${title}<meta property="og:image" content="/logo.png">`, DEFAULT_URL).poster, null);
  assert.throws(() => parseDetails('<h1>Access denied</h1>', DEFAULT_URL), /Topic heading not found/);
  assert.equal(parseDetails(detail('Show (2026) S01 Malayalam Pre-DVD'), DEFAULT_URL).isPreDvd, true);
});

function response(html, url = DEFAULT_URL, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => html,
  };
}

test('scrape groups entries, enriches posters, filters detail PreDVD, and limits concurrency', async () => {
  const html = home(
    [1, 2, 3, 4].map((id) => link(id, `Title ${id} (2026) Malayalam HD`)).join('<br>'),
    link(1, 'Title 1 (2026) Malayalam HD'),
  );
  let active = 0;
  let peak = 0;
  const requests = [];
  const result = await scrape({
    concurrency: 2,
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.ok(options.signal instanceof AbortSignal);
      if (url === DEFAULT_URL) return response(html);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (url.includes('/2-')) return response(detail('Title 2 (2026) S01 Malayalam', '<img src="/poster.jpg">'), url);
      if (url.includes('/3-')) return response(detail('Title 3 (2026) Malayalam PreDVD'), url);
      return response(detail('A (2026) Malayalam'), url);
    },
  });
  assert.equal(peak, 2);
  assert.equal(requests.length, 5);
  assert.equal(result.movies.length, 2);
  assert.equal(result.tvShows.length, 1);
  assert.equal(result.tvShows[0].title, 'Title 2');
  assert.equal(result.tvShows[0].poster, `${DEFAULT_URL}poster.jpg`);
  assert.deepEqual(result.errors, []);
  assert.ok(!Number.isNaN(Date.parse(result.scrapedAt)));
});

test('reports detail HTTP/network/markup failures while preserving partial listing JSON', async () => {
  const result = await scrape({
    fetchImpl: async (url) => {
      if (url === DEFAULT_URL) return response(home(
        [1, 2, 3].map((id) => link(id, `A ${id} (2026) Malayalam`)).join('<br>'),
        link(99, 'Other (2026) Tamil'),
      ));
      if (url.includes('/1-')) return response('', url, 403);
      if (url.includes('/2-')) throw new Error('Connection failed');
      return response('<h1>Access denied</h1>', url);
    },
  });
  assert.equal(result.movies.length, 3);
  assert.ok(result.movies.every((entry) => entry.poster === null));
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.map((error) => error.message).join(' '), /HTTP 403/);
  assert.match(result.errors.map((error) => error.message).join(' '), /Connection failed/);
  assert.match(result.errors.map((error) => error.message).join(' '), /Topic heading not found/);
});

test('homepage failures, unexpected content, and invalid inputs reject explicitly', async () => {
  await assert.rejects(scrape({ fetchImpl: async () => response('', DEFAULT_URL, 503) }), /HTTP 503/);
  await assert.rejects(scrape({ fetchImpl: async () => ({
    ...response(''), headers: new Headers({ 'content-type': 'application/json' }),
  }) }), /Expected HTML/);
  await assert.rejects(scrape({ concurrency: 0 }), /Concurrency/);
  await assert.rejects(scrape({ concurrency: 1.5 }), /Concurrency/);
  await assert.rejects(scrape({ timeoutMs: 0 }), /Timeout/);
  await assert.rejects(scrape({ url: 'file:///tmp/page.html' }), /HTTP or HTTPS/);
});

test('retries transient connection resets and surfaces the network cause after exhaustion', async () => {
  let attempts = 0;
  const failure = () => new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });
  const result = await scrape({
    fetchImpl: async (url) => {
      attempts += 1;
      if (attempts === 1) throw failure();
      return response(home(link(1, 'A (2026) Tamil'), link(2, 'B (2026) Hindi')), url);
    },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result.errors, []);
  attempts = 0;
  await assert.rejects(scrape({
    fetchImpl: async () => {
      attempts += 1;
      throw failure();
    },
  }), /fetch failed \(read ECONNRESET\)/);
  assert.equal(attempts, 3);
});

test('CLI exposes help and rejects unknown arguments with a nonzero exit', async () => {
  const exec = promisify(execFile);
  const help = await exec(process.execPath, ['cli.js', '--help']);
  assert.match(help.stdout, /Usage:/);
  assert.equal(help.stderr, '');
  await assert.rejects(exec(process.execPath, ['cli.js', '--unknown']), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Unknown option/);
    return true;
  });
});
