export const SECTION_NAMES = {
  recent: 'RECENTLY ADDED',
  top: 'TOP RELEASES THIS WEEK',
};

const AUDIO_LANGUAGES = new Map([
  ['TAM', 'Tamil'], ['TAMIL', 'Tamil'],
  ['TEL', 'Telugu'], ['TELUGU', 'Telugu'],
  ['HIN', 'Hindi'], ['HINDI', 'Hindi'],
  ['MAL', 'Malayalam'], ['MALAYALAM', 'Malayalam'],
  ['KAN', 'Kannada'], ['KANNADA', 'Kannada'],
  ['ENG', 'English'], ['ENGLISH', 'English'],
  ['DUT', 'Dutch'], ['DUTCH', 'Dutch'],
]);
const LANGUAGE_TOKEN = /\b(TAM|TAMIL|TEL|TELUGU|HIN|HINDI|MAL|MALAYALAM|KAN|KANNADA|ENG|ENGLISH|DUT|DUTCH)\b/gi;
const AUDIO_GROUP = /\([^()]*\)|\[[^\[\]]*\]/g;

// The site never labels a release "dubbed". It puts the original language right
// after the year ("Title (2026) Malayalam HD"), but lists audio tracks inside a
// bracketed group ("[HIN + MAL + KAN]" / "(TAM + TEL + HIN + MAL)"). Only the
// latter means a Malayalam dub; "Malayalam" inside a list is a dub too.
export function classifyAudio(releaseTitle = '') {
  const year = /\((?:19|20)\d{2}(?:\s*[-\u2013\u2014]\s*(?:19|20)\d{2})?\)/.exec(releaseTitle);
  const description = year ? releaseTitle.slice(year.index + year[0].length) : releaseTitle;
  const audioLanguages = [];
  let dubbed = false;
  for (const group of description.matchAll(AUDIO_GROUP)) {
    for (const match of group[0].matchAll(LANGUAGE_TOKEN)) {
      dubbed = true;
      const language = AUDIO_LANGUAGES.get(match[1].toUpperCase());
      if (!audioLanguages.includes(language)) audioLanguages.push(language);
    }
  }
  if (!audioLanguages.length && /\bMalayalam\b/i.test(description)) audioLanguages.push('Malayalam');
  return { dubbed, audioLanguages };
}

export function validateCatalog(data) {
  if (!data || !Array.isArray(data.movies) || !Array.isArray(data.tvShows) || !Array.isArray(data.errors)
    || !Number.isFinite(Date.parse(data.scrapedAt))
    || (data.topUpdatedAt !== undefined && !Number.isFinite(Date.parse(data.topUpdatedAt)))) {
    throw new Error('The release data is invalid. Please try again later.');
  }
  const entries = [...data.movies, ...data.tvShows].map((entry) => {
    if (typeof entry.title !== 'string' || !entry.title.trim()
      || !['movie', 'tv_show'].includes(entry.type)
      || !Array.isArray(entry.sections) || !entry.sections.every((value) => Object.values(SECTION_NAMES).includes(value))
      || !safeUrl(entry.url) || (entry.poster !== null && !safeUrl(entry.poster))
      || (entry.dubbed !== undefined && typeof entry.dubbed !== 'boolean')
      || (entry.audioLanguages !== undefined && (!Array.isArray(entry.audioLanguages)
        || !entry.audioLanguages.every((value) => typeof value === 'string')))) {
      throw new Error('The release data contains an invalid entry.');
    }
    const audio = classifyAudio(entry.releaseTitle ?? '');
    return {
      ...entry,
      dubbed: entry.dubbed ?? audio.dubbed,
      audioLanguages: entry.audioLanguages ?? audio.audioLanguages,
    };
  });
  return entries;
}

export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function posterUrl(value) {
  const safe = safeUrl(value);
  if (!safe) throw new Error('Invalid poster URL.');
  const url = new URL(safe);
  if (url.hostname === 'pbs.twimg.com') {
    url.searchParams.set('name', 'small');
  } else if (url.hostname === 'image.tmdb.org') {
    url.pathname = url.pathname.replace(/\/t\/p\/(?:original|w\d+)\//, '/t/p/w500/');
  } else if (url.hostname === 'm.media-amazon.com') {
    url.pathname = url.pathname.replace(/\._V1_\./, '._V1_SX500_.');
  }
  return url.href;
}

export function filterEntries(entries, { type = 'all', query = '', audio = 'all' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => entry.sections.some((section) => Object.values(SECTION_NAMES).includes(section))
    && (type === 'all' || entry.type === type)
    && (audio === 'all' || Boolean(entry.dubbed) === (audio === 'dubbed'))
    && `${entry.title} ${entry.year ?? ''}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => Number(b.sections.includes(SECTION_NAMES.top)) - Number(a.sections.includes(SECTION_NAMES.top)));
}

export function episodeLabel(releaseTitle = '') {
  const match = /\bS(\d{1,3})(?:E(\d+)|\s+EP\s*[\s:(]*([\d-]+))?/i.exec(releaseTitle);
  if (!match) return '';
  const season = `Season ${Number(match[1])}`;
  const episodes = match[2] ?? match[3];
  return episodes ? `${season} / Ep ${episodes}` : season;
}
