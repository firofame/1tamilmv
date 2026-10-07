# Malayalam release scraper

**Website:** <https://firofame.github.io/1tamilmv/>  
**Repository:** <https://github.com/firofame/1tamilmv>

Node.js + Cheerio scraper for **TOP RELEASES THIS WEEK** and **RECENTLY
ADDED** at <https://www.1tamilmv.capital/>. Requires Node.js 20.19 or newer.

## Run

```sh
npm install
npm run scrape -- --output movies.json
```

For JSON on stdout (without npm's script banner):

```sh
node cli.js > movies.json
```

Optional arguments:

```sh
node cli.js --url https://www.1tamilmv.capital/ --concurrency 3 --output movies.json
npm test
npm run check
```

Only topic pages are fetched. The scraper does not download videos, torrents,
or poster image files; `poster` is an image URL from the detail page.

## Output

```json
{
  "source": "https://www.1tamilmv.capital/",
  "scrapedAt": "2026-10-07T14:00:00.000Z",
  "movies": [
    {
      "title": "Example Movie",
      "year": 2026,
      "type": "movie",
      "language": "Malayalam",
      "sections": ["RECENTLY ADDED"],
      "releaseTitle": "Example Movie (2026) Malayalam HD - [1080p]",
      "url": "https://www.1tamilmv.capital/index.php?/forums/topic/123-example/",
      "poster": "https://example.com/poster.jpg"
    }
  ],
  "tvShows": [],
  "errors": []
}
```

- Includes entries advertising **Malayalam audio**, including multilingual
  releases with `MAL`. This is not a filter for original production language:
  the homepage does not reliably provide that information.
- Reconstructs full rows across nested formatting and line breaks, including
  titles outside quality links. Reads only the two named section containers.
- Excludes `PreDVD`, `Pre-DVD`, and `Pre DVD` in row text, topic URLs, or
  detail-page titles.
- Deduplicates by topic ID, merging section membership. Different release
  topics for the same title remain separate.
- Uses season/episode and TV/web-series markers in listing/detail titles to
  classify TV shows; otherwise classifies as a movie. This is a heuristic,
  not an external movie database lookup. `year` is `null` when absent; for a
  year range (such as a movie collection), it is the first year.
- Looks for artwork in the **original post**, preferring known poster hosts,
  poster/cover labels, and portrait images. Ignores small images, known site
  graphics, screenshots, and reply images. Uses `og:image` as a fallback.
  Poster selection is heuristic; `poster` is `null` if no suitable image exists.
- Fetches up to three detail pages concurrently by default (maximum ten),
  with a 30-second timeout per request. Transient network errors are retried
  at most twice, with 0.5-second and 1-second backoff. HTTP/access-control
  failures are not retried.
- Homepage HTTP/structure errors fail the command. Detail-page failures retain
  the listing with `poster: null`, appear in `errors` and stderr, and produce
  exit code **1** after writing the partial JSON. Missing posters alone are
  not errors. Successful runs exit **0**.

The site may move domains, change markup, or block automated requests. Use
`--url` for a new domain; this tool does not bypass access controls. Respect
the site's terms, applicable laws, and request limits.

## JavaScript API

```js
import { scrape } from './scraper.js';

const result = await scrape();
console.log(JSON.stringify(result, null, 2));
```

## Mobile website

The GitHub Pages site is a lightweight static page: no framework, build step,
tracking, or external fonts. It reads `movies.json` from the same directory.
It has two-column poster cards, 44px touch targets, search, movie/TV filters,
weekly/recent tabs, episode labels, lazy-loaded posters, and explicit loading,
empty, stale-data, and error states. The layout is designed for 320-430px
mobile screens; wider screens retain a phone-width layout.

Serve locally (do not open the HTML directly as a file):

```sh
python3 -m http.server 4187 --bind 127.0.0.1
```

Open <http://127.0.0.1:4187/>. Stop the local server before running mobile browser tests:

```sh
npx playwright install chromium
npm run test:ui
```

## Automatic updates and deployment

[The GitHub Actions workflow](.github/workflows/publish.yml) runs every hour
at minute **17** (UTC). It checks **RECENTLY ADDED** each run and refreshes
**TOP RELEASES THIS WEEK** on the first successful run of each new UTC date
(normally 00:17 UTC / 05:47 IST). GitHub may delay scheduled jobs.

```sh
npm run update
npm run update -- --refresh-top
```

The updater:

- Fetches the homepage, reuses detail data by topic ID, and fetches detail
  pages only for new entries or previously failed details. Known absent
  posters are cached too; episode/listing text still updates hourly.
- Keeps yesterday's top membership between daily refreshes. Each refreshed
  section is a current snapshot, so vanished listings are removed rather
  than accumulated forever.
- Records `firstSeenAt` per entry and `topUpdatedAt` for the weekly section.
  A fresh full scrape resets these incremental metadata fields.
- Writes JSON atomically only when data changes or the daily top refresh
  occurs. Any fetch/parse failure preserves the last known good file and
  fails the workflow visibly instead of publishing partial data.
- Commits changed JSON and deploys Pages in the **same workflow**. This is
  necessary because commits made with `GITHUB_TOKEN` do not start another
  push-triggered workflow.

Pushes to `main` also deploy the site. To refresh immediately, run the
**Update releases and publish Pages** workflow manually in GitHub Actions;
the `refresh_top` option defaults to true.

No scraper secrets are required. In repository settings, Pages must use
**GitHub Actions** as its source, and Actions must be allowed to write
repository contents. GitHub disables scheduled workflows in public
repositories after 60 days without repository activity; re-enable the
workflow if that occurs. No-change checks intentionally create no commits.
