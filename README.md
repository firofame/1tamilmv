# Latest Malayalam Movies

Automated scraper that tracks the latest Malayalam movie releases from 1TamilMV.

## How It Works

- **`scrape.js`** — Scrapes movie listings, extracts poster images from detail pages, and outputs structured data
- **`data.json`** — All movie data (title, URL, poster) updated automatically twice daily via GitHub Actions
- **`posters.json`** — Poster image cache that grows incrementally (5 new posters per run)
- **`index.html`** — Mobile-optimized dark-themed movie grid that loads `data.json` at runtime

## Live Page

Open `index.html` or deploy via GitHub Pages to browse the collection with search and poster images.
