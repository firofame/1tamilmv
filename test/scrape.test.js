const assert = require('node:assert/strict');
const { test } = require('node:test');
const cheerio = require('cheerio');
const { selectFeaturedMovies } = require('../scrape');

test('selects Malayalam releases from the uppercase weekly section in source order', () => {
    const $ = cheerio.load(`
        <div class="banger-container">
            <div class="banger-header"><span>TOP RELEASES THIS WEEK</span></div>
            <div class="banger-row">
                <a href="/index.php?/forums/topic/2-second-2026/">Second</a>
                <a href="/index.php?/forums/topic/1-first-2026/">First</a>
                <a href="/index.php?/forums/topic/2-second-2026/">Second again</a>
            </div>
        </div>
    `);
    const movies = [
        { title: 'First', url: 'https://www.1tamilmv.capital/index.php?/forums/topic/1-first-2026/' },
        { title: 'Second', url: 'https://www.1tamilmv.capital/index.php?/forums/topic/2-second-2026/' },
        { title: 'Not featured', url: 'https://www.1tamilmv.capital/index.php?/forums/topic/3-third-2026/' },
    ];

    assert.deepEqual(selectFeaturedMovies($, movies), [movies[1], movies[0]]);
});

test('falls back to the first six movies when the weekly section is missing', () => {
    const $ = cheerio.load('<div class="banger-container"><div class="banger-header">Other section</div></div>');
    const movies = Array.from({ length: 8 }, (_, index) => ({ title: `Movie ${index}` }));

    assert.deepEqual(selectFeaturedMovies($, movies), movies.slice(0, 6));
});
