export const SECTION_NAMES = {
  recent: 'RECENTLY ADDED',
  top: 'TOP RELEASES THIS WEEK',
};

export function validateCatalog(data) {
  if (!data || !Array.isArray(data.movies) || !Array.isArray(data.tvShows) || !Array.isArray(data.errors)
    || !Number.isFinite(Date.parse(data.scrapedAt))
    || (data.topUpdatedAt !== undefined && !Number.isFinite(Date.parse(data.topUpdatedAt)))) {
    throw new Error('The release data is invalid. Please try again later.');
  }
  const entries = [...data.movies, ...data.tvShows];
  for (const entry of entries) {
    if (typeof entry.title !== 'string' || !entry.title.trim()
      || !['movie', 'tv_show'].includes(entry.type)
      || !Array.isArray(entry.sections) || !entry.sections.every((value) => Object.values(SECTION_NAMES).includes(value))
      || !safeUrl(entry.url) || (entry.poster !== null && !safeUrl(entry.poster))) {
      throw new Error('The release data contains an invalid entry.');
    }
  }
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

export function filterEntries(entries, { section = 'recent', type = 'all', query = '' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => entry.sections.includes(SECTION_NAMES[section])
    && (type === 'all' || entry.type === type)
    && `${entry.title} ${entry.year ?? ''}`.toLocaleLowerCase().includes(search));
}

export function episodeLabel(releaseTitle = '') {
  const match = /\bS(\d{1,3})(?:E(\d+)|\s+EP\s*[\s:(]*([\d-]+))?/i.exec(releaseTitle);
  if (!match) return '';
  const season = `Season ${Number(match[1])}`;
  const episodes = match[2] ?? match[3];
  return episodes ? `${season} / Ep ${episodes}` : season;
}
