const fs = require('fs');

const POSTER_CACHE_PATH = 'posters.json';
const SITE_BASE_URL = 'https://www.1tamilmv.ltd/';
// Max NEW poster fetches per run (to avoid spamming the site)
const MAX_NEW_FETCHES_PER_RUN = 5; // Increased to fix null posters
// Delay between detail-page requests (ms)
const FETCH_DELAY_MS = 2000;

// ─── Poster Cache ───────────────────────────────────────────────────────────

function normalizeThreadUrl(url) {
    if (!url) return url;

    try {
        const parsed = new URL(url, SITE_BASE_URL);
        if (/(^|\.)1tamilmv\.[a-z]+$/i.test(parsed.hostname)) {
            return `${parsed.pathname}${parsed.search}`;
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

function loadPosterCache() {
    try {
        if (fs.existsSync(POSTER_CACHE_PATH)) {
            const data = JSON.parse(fs.readFileSync(POSTER_CACHE_PATH, 'utf8'));
            const normalizedCache = {};

            for (const [key, value] of Object.entries(data)) {
                const normalizedKey = normalizeThreadUrl(key);
                const existingValue = normalizedCache[normalizedKey];

                // Prefer a real poster URL over a cached miss when duplicate keys collapse.
                if (existingValue === undefined || (existingValue == null && value != null)) {
                    normalizedCache[normalizedKey] = value;
                }
            }

            console.log(`Loaded poster cache with ${Object.keys(normalizedCache).length} entries.`);
            return normalizedCache;
        }
    } catch (err) {
        console.log(`Warning: could not read poster cache: ${err.message}`);
    }
    return {};
}

function savePosterCache(cache) {
    fs.writeFileSync(POSTER_CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log(`Saved poster cache with ${Object.keys(cache).length} entries.`);
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function fetchWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            if (response.ok) return response;
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            console.log(`Attempt ${i + 1} failed: ${err.message}. Retrying in 2 seconds...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return null;
}

// ─── Poster Extraction ─────────────────────────────────────────────────────

/**
 * Fetch the poster image URL from a movie's detail page.
 * Looks for the first pixelbb.com (or similar hosting) image with a portrait aspect ratio.
 */
async function fetchPosterImage(detailUrl) {
    try {
        console.log(`  Fetching poster from: ${detailUrl}`);
        const response = await fetchWithRetry(detailUrl);
        if (!response) return 'FETCH_FAILED';
        
        const html = await response.text();

        // Score all image candidates so cached forum uploads survive domain changes
        // and direct forum-hosted poster attachments remain eligible.
        const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
        const candidates = [];
        let match;

        while ((match = imgRegex.exec(html)) !== null) {
            const fullTag = match[0];
            const rawSrc = match[1].replace(/&amp;/g, '&');
            let imgUrl;
            let parsedUrl;

            try {
                imgUrl = new URL(rawSrc, detailUrl).toString();
                parsedUrl = new URL(imgUrl);
            } catch {
                continue;
            }

            const host = parsedUrl.hostname.toLowerCase();
            const path = parsedUrl.pathname.toLowerCase();
            const isForumHost = /(^|\.)1tamilmv\.[a-z]+$/.test(host);
            const isForumUpload = isForumHost && path.startsWith('/uploads/');
            const isPixelbb = host === 'www.pixelbb.com' && path.startsWith('/images/');
            const ratioMatch = fullTag.match(/data-ratio=["']([\d.]+)["']/i);
            const ratio = ratioMatch ? parseFloat(ratioMatch[1]) : 0;
            const isPortrait = ratio > 80;
            const isScreenshot = path.includes('vlcsnap') || (path.includes('.md.') && !isPortrait);
            const isKnownNonPoster = imgUrl.includes('googletagmanager') ||
                imgUrl.includes('i2symbol') ||
                imgUrl.includes('istockphoto') ||
                imgUrl.includes('pinimg.com') ||
                imgUrl.includes('freepik.com') ||
                imgUrl.includes('tenor.com') ||
                imgUrl.includes('giphy.com') ||
                imgUrl.includes('mikka-nandri') ||
                path.includes('/set_resources_') ||
                path.includes('/logo.png') ||
                path.includes('/emoticons/') ||
                path.includes('/reactions/') ||
                path.includes('.thumb.') ||
                path.endsWith('.svg') ||
                path.endsWith('.gif') ||
                path.includes('utorrent.png');

            if (isScreenshot || isKnownNonPoster) continue;
            if (isForumHost && !isForumUpload) continue;

            let score = 0;
            if (isPixelbb) score += 4;
            if (isForumUpload) score += 3;
            if (!isForumHost) score += 1;
            if (isPortrait) score += 2;

            if (score > 0) {
                // If it's a PixelBB thumbnail, try to get the full-size version
                let finalUrl = imgUrl;
                if (isPixelbb && finalUrl.includes('.md.')) {
                    finalUrl = finalUrl.replace('.md.', '.');
                }
                candidates.push({ url: finalUrl, score });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > 0) return candidates[0].url;

        return null;
    } catch (err) {
        console.log(`  Error fetching poster: ${err.message}`);
        return 'FETCH_FAILED';
    }
}

// ─── Main Scraper ───────────────────────────────────────────────────────────

async function scrapeMalayalamMovies() {
    try {
        console.log('Fetching https://www.1tamilmv.ltd/ ...');
        const response = await fetchWithRetry('https://www.1tamilmv.ltd/');
        
        if (!response) {
            throw new Error('Failed to fetch the main page after retries.');
        }
        
        const html = await response.text();
        
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);

        // Regex rules for filtering and deduping
        const malRegex = /(malayalam|\bmal\b)/i;
        const preDvdRegex = /pre[- ]?dvd/i;
        const yearRegex = /\(20\d{2}\)/;
        const movieKeyRegex = /^(.*?\(\d{4}\))/;

        // Quality rank: higher = better. Used to keep the best version per title.
        function qualityRank(text) {
            const l = text.toLowerCase();
            if (l.includes('bluray') || l.includes('blu-ray')) return 4;
            if (l.includes('uhd') || l.includes('4k')) return 3;
            if (l.includes(' hd ') || l.includes(' hd+') || l.includes('web-dl') || l.includes('web dl') || l.includes('webhd')) return 2;
            return 1;
        }

        // Map from dedup key -> best entry seen so far
        const movieMap = new Map();

        $('a').each((_, el) => {
            const $el = $(el);
            let text = $el.text().trim().replace(/\s+/g, ' ');
            let url = $el.attr('href');

            // Sometimes the link text is just "[4K, 1080p...]" and the title is in the preceding sibling nodes
            if (text.startsWith('[')) {
                let prev = el.prev;
                let prevText = '';
                while (prev && prev.name !== 'br') {
                    if (prev.type === 'text') prevText = prev.data + prevText;
                    else if (prev.type === 'tag') prevText = $(prev).text() + prevText;
                    prev = prev.prev;
                }
                text = prevText.trim().replace(/\s+/g, ' ') + ' ' + text;
            }

            if (!url || !text) return;

            // Only consider links pointing to a topic
            if (!url.includes('/topic/')) return;

            // Skip PreDVD entries entirely
            if (preDvdRegex.test(text)) return;

            if (malRegex.test(text) && text.length > 10 && yearRegex.test(text)) {
                const keyMatch = text.match(movieKeyRegex);
                if (!keyMatch) return;
                
                const key = keyMatch[1].toLowerCase().trim();

                const existing = movieMap.get(key);
                if (!existing || qualityRank(text) > existing.quality) {
                    movieMap.set(key, { text, url, quality: qualityRank(text) });
                }
            }
        });

        const movies = Array.from(movieMap.values());
        console.log(`Found ${movies.length} Malayalam titles.`);
        
        if (movies.length === 0) {
            console.error('No movies found — skipping write to avoid data loss.');
            process.exit(1);
        }
        
        movies.forEach(m => console.log(`- ${m.text}`));
        
        // Parse movie data
        const parsedMovies = movies.map(m => {
            let title = m.text;
            const url = m.url;
            
            const yearMatch = title.match(/^(.*?)\s*\((\d{4})\)/);
            
            if (yearMatch) {
                title = yearMatch[1].trim();
                // Remove common leading language tags
                title = title.replace(/^(Malayalam|Tamil|Telugu|Hindi)\s*[-:]?\s*/i, '').trim();
                title = title.replace(/^S\.Saraswathi\s*[-:]?\s*/i, '').trim();
            } else {
                title = title.split('-')[0].trim();
                title = title.replace(/^S\.Saraswathi\s*[-:]?\s*/i, '').trim();
            }
            
            // If title became empty because of stripping, or is still just the uploader name, try to extract from URL
            if ((!title || title.toLowerCase() === 's.saraswathi') && url) {
                const urlMatch = url.match(/\/topic\/\d+-([a-zA-Z0-9-]+)-\d{4}/);
                if (urlMatch) {
                    title = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                } else {
                    title = 'Unknown Title';
                }
            }
            
            // Truncate title if it's too long
            if (title.length > 50) title = title.substring(0, 47) + '...';
            
            return { title, url };
        });
        
        // ─── Poster fetching with cache ─────────────────────────────────
        const posterCache = loadPosterCache();
        let newFetchCount = 0;
        
        // Resolve posters for ALL movies: use cache first, fetch only if missing
        for (const movie of parsedMovies) {
            if (!movie.url) continue;
            const cacheKey = normalizeThreadUrl(movie.url);
            
            // Already cached — skip
            // Already cached — skip (unless it was null, in which case we retry once)
            if (posterCache[cacheKey]) continue;
            
            // Budget exhausted for this run — skip (will be fetched next run)
            if (newFetchCount >= MAX_NEW_FETCHES_PER_RUN) continue;
            
            const posterUrl = await fetchPosterImage(movie.url);
            
            if (posterUrl === 'FETCH_FAILED') {
                console.log(`  Skipping cache for ${movie.title} due to network error`);
                newFetchCount++;
                continue; // Don't cache, retry next run
            }
            
            // Store result (even null if page loaded but no poster found)
            posterCache[cacheKey] = posterUrl;
            newFetchCount++;
            console.log(`  ${movie.title}: ${posterUrl || 'No poster found'}`);
            
            // Be polite — wait between requests
            if (newFetchCount < MAX_NEW_FETCHES_PER_RUN) {
                await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
            }
        }
        
        console.log(`\nFetched ${newFetchCount} new poster(s) this run.`);
        savePosterCache(posterCache);
        
        // Build poster lookup for easy access
        const getPoster = (url) => posterCache[normalizeThreadUrl(url)] || null;
        


        // ─── Build data.json ─────────────────────────────────────────────
        const dataJson = {
            updated: new Date().toUTCString(),
            count: parsedMovies.length,
            movies: parsedMovies.map(movie => ({
                title: movie.title,
                url: movie.url || null,
                poster: getPoster(movie.url) || null,
            }))
        };
        fs.writeFileSync('data.json', JSON.stringify(dataJson, null, 2));
        console.log(`Saved data.json (${dataJson.count} movies)`);
        
    } catch (error) {
        console.error('Error scraping:', error.message);
    }
}

scrapeMalayalamMovies();
