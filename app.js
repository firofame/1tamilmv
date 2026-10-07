import { episodeLabel, filterEntries, posterUrl, safeUrl, validateCatalog } from './catalog.js';

const get = (id) => document.getElementById(id);
const state = { section: 'recent', type: 'all', query: '', entries: [] };
let catalog;

function formattedDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function makeCard(entry, index) {
  const card = document.createElement('article');
  card.className = 'card';
  const poster = document.createElement('a');
  poster.className = 'poster';
  poster.href = safeUrl(entry.url);
  poster.target = '_blank';
  poster.rel = 'noopener noreferrer';
  poster.setAttribute('aria-label', `View ${entry.title} details (opens a new tab)`);
  const placeholder = document.createElement('span');
  placeholder.className = 'poster-placeholder';
  const initial = document.createElement('strong');
  initial.textContent = entry.title.charAt(0).toLocaleUpperCase();
  const posterStatus = document.createTextNode(entry.poster ? 'Loading poster...' : 'Poster unavailable');
  placeholder.append(initial, posterStatus);
  poster.append(placeholder);
  if (entry.poster) {
    const image = document.createElement('img');
    image.alt = '';
    image.width = 300;
    image.height = 450;
    image.loading = index < 4 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => { placeholder.hidden = true; });
    image.addEventListener('error', () => {
      image.remove();
      posterStatus.textContent = 'Poster unavailable';
      placeholder.hidden = false;
    }, { once: true });
    image.src = posterUrl(entry.poster);
    poster.append(image);
  }
  const badge = document.createElement('span');
  const top = entry.sections.includes('TOP RELEASES THIS WEEK');
  badge.className = `card-badge${top ? ' top' : ''}`;
  badge.textContent = top ? 'TOP PICK' : entry.type === 'tv_show' ? 'TV SHOW' : 'MOVIE';
  poster.append(badge);
  const title = document.createElement('h3');
  const link = document.createElement('a');
  link.href = poster.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = entry.title;
  title.append(link);
  const meta = document.createElement('p');
  meta.className = 'card-meta';
  meta.textContent = `${entry.year ?? 'Year unknown'} / ${entry.type === 'tv_show' ? 'TV show' : 'Movie'} / MAL`;
  card.append(poster, title, meta);
  const episode = episodeLabel(entry.releaseTitle);
  if (episode) {
    const label = document.createElement('p');
    label.className = 'episode';
    label.textContent = episode;
    card.append(label);
  }
  return card;
}

function render() {
  if (!catalog) return;
  const filtered = filterEntries(state.entries, state);
  const sectionEntries = filterEntries(state.entries, { section: state.section });
  get('all-count').textContent = sectionEntries.length;
  get('movie-count').textContent = sectionEntries.filter((entry) => entry.type === 'movie').length;
  get('tv-count').textContent = sectionEntries.filter((entry) => entry.type === 'tv_show').length;
  get('results-heading').textContent = state.section === 'top' ? 'Top releases this week' : 'Recently added';
  get('result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'title' : 'titles'}`;
  const fragment = document.createDocumentFragment();
  filtered.forEach((entry, index) => fragment.append(makeCard(entry, index)));
  get('cards').replaceChildren(fragment);
  get('empty').hidden = filtered.length > 0;
  get('top-updated').hidden = state.section !== 'top';
  if (catalog) get('top-updated').textContent = `Top picks refreshed ${formattedDate(catalog.topUpdatedAt ?? catalog.scrapedAt)}`;
}

async function loadCatalog() {
  get('loading').hidden = false;
  get('error').hidden = true;
  get('empty').hidden = true;
  try {
    const response = await fetch('./movies.json', { cache: 'no-cache', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Could not load releases (HTTP ${response.status}).`);
    const data = await response.json();
    state.entries = validateCatalog(data);
    catalog = data;
    get('updated').textContent = `List updated ${formattedDate(data.scrapedAt)}`;
    const age = Date.now() - Date.parse(data.scrapedAt);
    const topAge = Date.now() - Date.parse(data.topUpdatedAt ?? data.scrapedAt);
    const warnings = [];
    if (data.errors.length) warnings.push('Some details could not be fetched. Showing the available listings.');
    if (topAge > 48 * 60 * 60 * 1000) warnings.push('Top picks have not refreshed for over two days; scheduled updates may be delayed.');
    if (age > 7 * 24 * 60 * 60 * 1000) warnings.push('The list has not changed for over a week.');
    get('warning').hidden = warnings.length === 0;
    get('warning').textContent = warnings.join(' ');
    render();
  } catch (error) {
    catalog = undefined;
    state.entries = [];
    get('cards').replaceChildren();
    get('top-updated').hidden = true;
    get('warning').hidden = true;
    get('result-count').textContent = '';
    get('updated').textContent = 'Release list unavailable';
    get('error-message').textContent = error instanceof Error ? error.message : String(error);
    get('error').hidden = false;
    console.error('Failed to load release list:', error);
  } finally {
    get('loading').hidden = true;
  }
}

for (const button of document.querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => {
    state.section = button.dataset.section;
    for (const tab of document.querySelectorAll('[data-section]')) tab.setAttribute('aria-pressed', String(tab === button));
    render();
  });
}
for (const button of document.querySelectorAll('[data-type]')) {
  button.addEventListener('click', () => {
    state.type = button.dataset.type;
    for (const filter of document.querySelectorAll('[data-type]')) filter.setAttribute('aria-pressed', String(filter === button));
    render();
  });
}
get('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  render();
});
get('retry').addEventListener('click', loadCatalog);
loadCatalog();
