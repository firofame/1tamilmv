import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { DEFAULT_URL, scrape } from './scraper.js';

export function needsTopRefresh(previous, now = new Date()) {
  const lastUpdate = previous.topUpdatedAt ?? previous.scrapedAt;
  return !previous.topUpdatedAt || lastUpdate.slice(0, 10) !== now.toISOString().slice(0, 10);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function hasChanges(previous, next) {
  const comparable = ({ scrapedAt, ...data }) => JSON.stringify(canonical(data));
  return comparable(previous) !== comparable(next);
}

export async function updateFile({
  output = 'movies.json',
  url = DEFAULT_URL,
  refreshTop = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const previous = JSON.parse(await readFile(output, 'utf8'));
  const result = await scrape({
    url,
    previous,
    refreshTop: refreshTop || needsTopRefresh(previous),
    fetchImpl,
  });
  if (result.errors.length) {
    throw new Error(`Update failed; previous JSON preserved:\n${result.errors.map((error) => `${error.url}: ${error.message}`).join('\n')}`);
  }
  if (!hasChanges(previous, result)) return { changed: false, result };
  const temporary = `${output}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, output);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') throw new AggregateError([error, cleanupError], 'Update and cleanup failed');
      }
    }
    throw error;
  }
  return { changed: true, result };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const { values } = parseArgs({
      options: {
        output: { type: 'string', default: 'movies.json' },
        url: { type: 'string', default: DEFAULT_URL },
        'refresh-top': { type: 'boolean', default: false },
      },
    });
    const { changed, result } = await updateFile({
      output: values.output,
      url: values.url,
      refreshTop: values['refresh-top'],
    });
    console.log(`${changed ? 'Updated' : 'No changes'}: ${result.movies.length} movies, ${result.tvShows.length} TV shows.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
