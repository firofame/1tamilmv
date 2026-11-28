import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { episodeLabel, safeUrl } from './catalog.js';

export const SITE_URL = 'https://firofame.github.io/1tamilmv/';
const API = 'https://api.telegram.org';
const CAPTION_LIMIT = 1024;
export const MAX_MESSAGES = 10;

// Topic IDs survive domain moves (1tamilmv.capital -> .ceo), full URLs do not.
export function topicId(url = '') {
  return /\/topic\/(\d+)/.exec(url)?.[1] ?? url;
}

const entries = (data) => [...(data?.movies ?? []), ...(data?.tvShows ?? [])];

/** Releases that are new since `previous`, plus TV shows whose episode range moved. */
export function findUpdates(previous, current, { audio = 'all', type = 'all' } = {}) {
  const known = new Map(entries(previous).map((entry) => [topicId(entry.url), entry]));
  const updates = [];
  for (const entry of entries(current)) {
    if (type !== 'all' && entry.type !== type) continue;
    if (audio !== 'all' && Boolean(entry.dubbed) !== (audio === 'dubbed')) continue;
    const before = known.get(topicId(entry.url));
    if (!before) {
      updates.push({ kind: 'new', entry });
    } else if (entry.type === 'tv_show') {
      const episodes = episodeLabel(entry.releaseTitle);
      if (episodes && episodes !== episodeLabel(before.releaseTitle)) updates.push({ kind: 'episodes', entry });
    }
  }
  return updates;
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

export function formatCaption({ kind, entry }, siteUrl = SITE_URL) {
  const heading = kind === 'episodes' ? '📺 New episodes' : entry.type === 'tv_show' ? '📺 New show' : '🎬 New movie';
  const title = `${entry.title}${entry.year ? ` (${entry.year})` : ''}`;
  const audio = entry.audioLanguages?.length ? entry.audioLanguages.join(', ') : 'Malayalam';
  const lines = [
    `<b>${escapeHtml(heading)}: ${escapeHtml(title)}</b>`,
    episodeLabel(entry.releaseTitle) && escapeHtml(episodeLabel(entry.releaseTitle)),
    `${entry.dubbed ? 'Dubbed' : 'Original'} · ${escapeHtml(audio)}`,
    entry.sections?.includes('TOP RELEASES THIS WEEK') && '⭐ Top release this week',
  ].filter(Boolean);
  const links = [safeUrl(entry.url) && `<a href="${escapeHtml(safeUrl(entry.url))}">Release page</a>`,
    `<a href="${escapeHtml(siteUrl)}">All releases</a>`].filter(Boolean).join(' · ');
  const release = entry.releaseTitle ? `<i>${escapeHtml(entry.releaseTitle)}</i>` : '';
  const caption = [...lines, '', links].join('\n');
  // Release titles are long and optional; drop them rather than truncating HTML mid-tag.
  const withRelease = release ? [...lines, release, '', links].join('\n') : caption;
  return withRelease.length <= CAPTION_LIMIT ? withRelease : caption;
}

export function summaryMessage(updates, siteUrl = SITE_URL) {
  const names = updates.map(({ entry }) => `• ${escapeHtml(entry.title)}${entry.year ? ` (${entry.year})` : ''}`);
  return [`<b>…and ${updates.length} more</b>`, ...names.slice(0, 40), ...(names.length > 40 ? ['…'] : []),
    '', `<a href="${escapeHtml(siteUrl)}">All releases</a>`].join('\n');
}

export function testMessage(siteUrl = SITE_URL) {
  return `✅ <b>Test message</b>\nThe bot can post here. New releases will appear automatically.\n\n<a href="${escapeHtml(siteUrl)}">All releases</a>`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callTelegram(method, body, { token, fetchImpl = globalThis.fetch, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (data.ok) return data.result;
    const retryAfter = data.parameters?.retry_after;
    if (response.status === 429 && retryAfter && attempt < 3) {
      await wait((retryAfter + 1) * 1000);
      continue;
    }
    // Never include the token: the request URL is deliberately left out.
    throw new Error(`Telegram ${method} failed (${response.status}): ${data.description ?? 'unknown error'}`);
  }
}

export async function sendUpdates(updates, {
  token, chatId, siteUrl = SITE_URL, fetchImpl = globalThis.fetch, wait = sleep, max = MAX_MESSAGES,
}) {
  const options = { token, fetchImpl, wait };
  const shown = updates.length > max ? updates.slice(0, max - 1) : updates;
  const failures = [];
  for (const [index, update] of shown.entries()) {
    if (index) await wait(1100); // stay under Telegram's per-chat rate limit
    const caption = formatCaption(update, siteUrl);
    const poster = safeUrl(update.entry.poster);
    try {
      if (poster) {
        try {
          await callTelegram('sendPhoto', { chat_id: chatId, photo: poster, caption, parse_mode: 'HTML' }, options);
          continue;
        } catch {
          // Telegram could not fetch the poster; fall back to text.
        }
      }
      await callTelegram('sendMessage', {
        chat_id: chatId, text: caption, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      }, options);
    } catch (error) {
      failures.push(`${update.entry.title}: ${error.message}`);
    }
  }
  if (shown.length < updates.length) {
    await wait(1100);
    await callTelegram('sendMessage', {
      chat_id: chatId, text: summaryMessage(updates.slice(shown.length), siteUrl), parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }, options);
  }
  if (failures.length) throw new Error(`Some Telegram messages failed:\n${failures.join('\n')}`);
  return { sent: shown.length, summarized: updates.length - shown.length };
}

const choice = (value, allowed, name) => {
  const normalized = (value || 'all').trim().toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return normalized;
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const { values } = parseArgs({
      options: {
        previous: { type: 'string' },
        current: { type: 'string', default: 'movies.json' },
        'dry-run': { type: 'boolean', default: false },
        test: { type: 'boolean', default: false },
      },
    });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (values.test) {
      if (!token || !chatId) throw new Error('Test message not sent: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets are both required.');
      await callTelegram('sendMessage', { chat_id: chatId, text: testMessage(process.env.SITE_URL || SITE_URL), parse_mode: 'HTML' }, { token });
      console.log('Telegram test message sent.');
    } else if (!values['dry-run'] && (!token || !chatId)) {
      console.log('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set; skipping Telegram notifications.');
    } else {
      if (!values.previous) throw new Error('--previous <file> is required.');
      const [previous, current] = await Promise.all(
        [values.previous, values.current].map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
      const updates = findUpdates(previous, current, {
        audio: choice(process.env.TELEGRAM_AUDIO, ['all', 'original', 'dubbed'], 'TELEGRAM_AUDIO'),
        type: choice(process.env.TELEGRAM_TYPE, ['all', 'movie', 'tv_show'], 'TELEGRAM_TYPE'),
      });
      const siteUrl = process.env.SITE_URL || SITE_URL;
      if (!updates.length) {
        console.log('No new releases to announce.');
      } else if (values['dry-run']) {
        for (const update of updates) console.log(`${formatCaption(update, siteUrl)}\n---`);
      } else {
        const { sent, summarized } = await sendUpdates(updates, { token, chatId, siteUrl });
        console.log(`Sent ${sent} Telegram message(s)${summarized ? `, summarized ${summarized} more` : ''}.`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
