import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_URL = 'https://www.1tamilmv.capital/';
export const SECTIONS = ['TOP RELEASES THIS WEEK', 'RECENTLY ADDED'];

const PRE_DVD = /\bpre[\s._-]*dvd\b/i;
const MALAYALAM = /\b(?:malayalam|mal)\b/i;
const TV_SHOW = /\b(?:s\d{1,3}(?:e\d+)?|season\s*\d+|ep(?:isodes?)?[\s.:(-]*\d+|tv\s*(?:show|series)|web\s*series)\b/i;
const BLOCKS = new Set(['p', 'div', 'li', 'section', 'article']);
const TRANSIENT_NETWORK_ERRORS = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
]);

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function metadata(releaseTitle) {
  const yearMatch = /\((19\d{2}|20\d{2})(?:\s*[-\u2013\u2014]\s*(?:19|20)\d{2})?\)/.exec(releaseTitle);
  const title = yearMatch
    ? releaseTitle.slice(0, yearMatch.index).trim()
    : releaseTitle.split(/\b(?:Malayalam|S\d{1,3}|Season\s+\d+|TV\s+Series|Web\s+Series)\b/i)[0].trim();
  const description = yearMatch
    ? releaseTitle.slice(yearMatch.index + yearMatch[0].length)
    : releaseTitle.slice(title.length);

  if (!title || !/[a-z0-9\u0d00-\u0d7f]/i.test(title)) {
    throw new Error(`Cannot identify a title in release: ${releaseTitle}`);
  }

  return {
    title,
    year: yearMatch ? Number(yearMatch[1]) : null,
    type: TV_SHOW.test(description) ? 'tv_show' : 'movie',
    description,
  };
}

function topicUrl(href, baseUrl) {
  const url = new URL(href, baseUrl);
  if (url.origin !== new URL(baseUrl).origin) return null;
  const match = /\/forums\/topic\/(\d+)(?:[-/]|$)/.exec(url.pathname + url.search);
  if (!match) return null;
  url.hash = '';
  return { id: match[1], url: url.href };
}

// A row can span several <strong> elements; titles are not always inside <a>.
function readRows($, container) {
  const rows = [];
  let text = '';
  let links = [];
  const flush = () => {
    if (links.length) {
      rows.push({
        text: normalize(text).replace(/\s*-\s*$/, ''),
        links,
      });
    }
    text = '';
    links = [];
  };
  const walk = (node) => {
    if (node.type === 'text') {
      text += node.data;
      return;
    }
    if (node.type !== 'tag') return;
    if ($(node).is('.banger-header')) return;
    if (node.name === 'br') {
      flush();
      return;
    }
    if (BLOCKS.has(node.name)) flush();
    if (node.name === 'a') {
      const href = $(node).attr('href');
      if (!href || !/\/forums\/topic\//.test(href)) return;
      links.push(href);
    }
    for (const child of node.children ?? []) walk(child);
    if (BLOCKS.has(node.name)) flush();
  };
  for (const node of $(container).contents().toArray()) walk(node);
  flush();
  return rows;
}

export function parseHomepage(html, baseUrl = DEFAULT_URL) {
  const $ = load(html);
  const releases = new Map();

  for (const section of SECTIONS) {
    const headers = $('.banger-header').filter((_, node) => normalize($(node).text()) === section);
    if (!headers.length) {
      throw new Error(`Homepage section not found: ${section}. The markup may have changed or access may be blocked.`);
    }
    let topicCount = 0;
    for (const header of headers.toArray()) {
      const container = $(header).closest('.banger-container');
      if (!container.length) throw new Error(`Missing release container for ${section}`);
      for (const row of readRows($, container[0])) {
        const topics = row.links.map((href) => topicUrl(href, baseUrl)).filter(Boolean);
        topicCount += topics.length;
        if (!topics.length || PRE_DVD.test(row.text)) continue;
        const info = metadata(row.text);
        if (!MALAYALAM.test(info.description)) continue;
        for (const topic of topics) {
          if (PRE_DVD.test(decodeURIComponent(topic.url))) continue;
          const existing = releases.get(topic.id);
          if (existing) {
            if (!existing.sections.includes(section)) existing.sections.push(section);
            continue;
          }
          releases.set(topic.id, {
            title: info.title,
            year: info.year,
            type: info.type,
            language: 'Malayalam',
            sections: [section],
            releaseTitle: row.text,
            url: topic.url,
            poster: null,
          });
        }
      }
    }
    if (!topicCount) throw new Error(`No topic links found in ${section}; check the homepage markup.`);
  }

  return [...releases.values()];
}

function imageUrl(value, baseUrl) {
  if (!value) return null;
  const url = new URL(value, baseUrl);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}

function isArtwork(url, alt = '') {
  return !/\b(?:logo|banner|avatar|emoji|emoticon|spacer|pixel|screenshot|screenshots|screen[\s_-]*shot|utorrent|torrborder)\b|\/screens?\/|\.gif(?:[.?]|$)/i.test(`${url} ${alt}`);
}

export function parseDetails(html, baseUrl) {
  const $ = load(html);
  const heading = $('h1.ipsType_pageTitle').first();
  if (!heading.length) {
    throw new Error('Topic heading not found; the detail page may be blocked or its markup changed.');
  }
  const detailTitle = normalize(heading.text());
  const firstPost = $('article.cPost').first();
  const content = firstPost.length
    ? firstPost.find('[data-role="commentContent"]').first()
    : $('[data-role="commentContent"]').first();
  const candidates = [];

  for (const node of content.find('img').toArray()) {
    const image = $(node);
    if (image.is('.ipsEmoji, .ipsEmoticon, .ipsUserPhoto')) continue;
    const source = image.attr('data-src') || image.attr('data-original') || image.attr('src');
    const url = imageUrl(source, baseUrl);
    if (!url || !isArtwork(url, image.attr('alt'))) continue;
    const width = Number.parseFloat(image.attr('width'));
    const height = Number.parseFloat(image.attr('height'));
    if ((width > 0 && width < 180) || (height > 0 && height < 240)) continue;
    let score = 0;
    if (/m\.media-amazon\.com\/images\/M\/|image\.tmdb\.org\/t\/p\//i.test(url)) score += 3;
    if (/\b(?:poster|cover)\b/i.test(`${url} ${image.attr('alt') ?? ''}`)) score += 2;
    if (height > width && width > 0) score += 1;
    candidates.push({ url, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  let poster = candidates[0]?.url ?? null;
  if (!poster) {
    const fallback = imageUrl($('meta[property="og:image"]').attr('content'), baseUrl);
    if (fallback && isArtwork(fallback)) poster = fallback;
  }

  return {
    poster,
    isPreDvd: PRE_DVD.test(detailTitle),
    type: metadata(detailTitle).type,
  };
}

async function fetchPage(url, fetchImpl, timeoutMs) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MalayalamReleaseScraper/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
      const contentType = response.headers.get('content-type');
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error(`Expected HTML from ${url}, received ${contentType}`);
      }
      return { html: await response.text(), url: response.url || url };
    } catch (error) {
      const code = error?.cause?.code ?? error?.code;
      if (attempt === 2 || !TRANSIENT_NETWORK_ERRORS.has(code)) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = error?.cause?.message;
        throw new Error(`Failed to fetch ${url}: ${message}${cause ? ` (${cause})` : ''}`, { cause: error });
      }
      await delay(500 * 2 ** attempt);
    }
  }
}

export async function scrape({
  url = DEFAULT_URL,
  concurrency = 3,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
  previous,
  refreshTop = true,
} = {}) {
  const source = new URL(url);
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('Concurrency must be an integer between 1 and 10.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Timeout must be a positive integer.');
  if (previous && (!Array.isArray(previous.movies) || !Array.isArray(previous.tvShows) || !Array.isArray(previous.errors))) {
    throw new Error('Previous data must contain movies, tvShows, and errors arrays.');
  }

  const homepage = await fetchPage(source.href, fetchImpl, timeoutMs);
  const current = parseHomepage(homepage.html, homepage.url);
  const now = new Date().toISOString();
  const cached = new Map((previous ? [...previous.movies, ...previous.tvShows] : [])
    .map((entry) => [topicUrl(entry.url, entry.url).id, entry]));
  const failed = new Set((previous?.errors ?? []).map((error) => topicUrl(error.url, error.url).id));
  const entriesById = new Map();
  if (previous && !refreshTop) {
    for (const [id, entry] of cached) {
      if (entry.sections.includes(SECTIONS[0])) entriesById.set(id, { ...entry, sections: [SECTIONS[0]] });
    }
  }
  for (const entry of current) {
    if (previous && !refreshTop) {
      entry.sections = entry.sections.filter((section) => section !== SECTIONS[0]);
      if (!entry.sections.length) continue;
    }
    const id = topicUrl(entry.url, entry.url).id;
    if (previous && !refreshTop && entriesById.has(id)) {
      entry.sections.unshift(SECTIONS[0]);
    }
    entriesById.set(id, entry);
  }
  const entries = [...entriesById.values()];
  for (const entry of entries) {
    const saved = cached.get(topicUrl(entry.url, entry.url).id);
    if (previous) entry.firstSeenAt = saved?.firstSeenAt ?? (saved ? previous.scrapedAt : now);
    if (saved) {
      entry.poster = saved.poster;
      if (saved.type === 'tv_show') entry.type = 'tv_show';
    }
  }
  const errors = [];
  const excluded = new Set();
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const entry = entries[next++];
      const id = topicUrl(entry.url, entry.url).id;
      if (cached.has(id) && !failed.has(id)) continue;
      try {
        const detail = await fetchPage(entry.url, fetchImpl, timeoutMs);
        const info = parseDetails(detail.html, detail.url);
        if (info.isPreDvd) {
          excluded.add(entry);
          continue;
        }
        entry.poster = info.poster;
        if (info.type === 'tv_show') entry.type = 'tv_show';
      } catch (error) {
        errors.push({
          url: entry.url,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  const included = entries.filter((entry) => !excluded.has(entry));

  return {
    source: homepage.url,
    scrapedAt: now,
    ...(previous ? { topUpdatedAt: refreshTop ? now : previous.topUpdatedAt ?? previous.scrapedAt } : {}),
    movies: included.filter((entry) => entry.type === 'movie'),
    tvShows: included.filter((entry) => entry.type === 'tv_show'),
    errors,
  };
}
