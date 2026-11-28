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
      "dubbed": false,
      "audioLanguages": ["Malayalam"],
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
- Adds `dubbed` and `audioLanguages` from the release title. A language named
  inside a bracketed group (`[HIN + MAL + KAN]`, `(TAM + TEL + HIN + MAL)`) marks
  a dubbed audio track, even when spelled `Malayalam`. A standalone language
  after the year (`Title (2026) Malayalam HD`) marks the original. Spot checks
  against Wikipedia agree, but this is a heuristic, not a database lookup.
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
It has a compact header, two-column poster cards, 44px touch targets, search,
movie/TV filters, episode labels, lazy-loaded posters, and explicit loading,
empty, stale-data, and error states. Weekly top picks lead a single combined
list, followed by recently added titles; entries in both sections appear only
once. Top picks retain their badges, and update timestamps sit in the footer
to keep the cards close to the top of the screen. Supported image hosts serve smaller
mobile-sized artwork; original poster URLs remain unchanged in the JSON.
Audio filters separate original from dubbed releases, and cards label both.
The layout is designed for 320-430px
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

[The GitHub Actions workflow](.github/workflows/publish.yml) runs twice a
day, at **02:17** and **13:17** UTC (07:47 and 18:47 IST). It checks **RECENTLY
ADDED** each run and refreshes **TOP RELEASES THIS WEEK** on the first
successful run of each new UTC date (normally the 02:17 UTC run). Change the
`cron` line in the workflow to run more or less often. GitHub may delay scheduled jobs.

```sh
npm run update
npm run update -- --refresh-top
```

The updater:

- Fetches the homepage, reuses detail data by topic ID, and fetches detail
  pages only for new entries or previously failed details. Known absent
  posters are cached too; episode/listing text still updates every run.
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

## Telegram notifications

After each update that changes `movies.json`, the workflow posts new releases
to Telegram: one message per new topic (poster, title, year, original/dubbed,
audio languages, top-pick badge, links), plus TV shows whose episode range
moved. Topics are matched by topic ID, so a domain change does not re-announce
everything. More than 10 updates in one run are sent as 9 messages plus a
summary list. A Telegram failure is reported in the job log but never blocks
the data commit or the Pages deploy.

Setup:

1. Message **@BotFather** in Telegram, send `/newbot`, and copy the token.
2. Add the bot to your channel or group as an admin (or send it a message for a
   private chat).
3. Find the chat ID: `@yourchannel` for a public channel, otherwise send the
   bot a message and read `chat.id` from
   `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. In **Settings → Secrets and variables → Actions**, add the secrets
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

Without both secrets the step is skipped. Optional repository **variables**
narrow what is posted:

- `TELEGRAM_AUDIO`: `all` (default), `original` or `dubbed`
- `TELEGRAM_TYPE`: `all` (default), `movie` or `tv_show`

To check the setup, run the workflow manually with **telegram_test** ticked.
It posts a test message to the chat; the **Send Telegram test message** step
log shows the Telegram error if it fails (for example, the bot is not a
channel admin or the chat ID is wrong).

Preview messages locally without sending anything:

```sh
git show HEAD~5:movies.json > /tmp/previous.json
node notify.js --dry-run --previous /tmp/previous.json
```
