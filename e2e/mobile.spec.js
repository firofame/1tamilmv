import { expect, test } from '@playwright/test';

const entry = (id, title, type, sections, poster = null) => ({
  title, type, sections, year: 2026, language: 'Malayalam',
  url: `https://example.com/${id}`, poster,
  releaseTitle: `${title} (2026) ${type === 'tv_show' ? 'S01 EP (01-08)' : ''} Malayalam`,
});
const data = () => ({
  source: 'https://example.com/',
  scrapedAt: new Date().toISOString(),
  topUpdatedAt: new Date().toISOString(),
  movies: [
    entry(1, 'River & Rain', 'movie', ['RECENTLY ADDED'], 'https://images.example/broken.jpg'),
    entry(2, 'Green Valley', 'movie', ['RECENTLY ADDED', 'TOP RELEASES THIS WEEK']),
    entry(3, '<img src=x onerror=alert(1)>', 'movie', ['RECENTLY ADDED']),
    entry(5, 'Weekly Favorite', 'movie', ['TOP RELEASES THIS WEEK']),
  ],
  tvShows: [
    entry(4, 'Sky Stories', 'tv_show', ['RECENTLY ADDED', 'TOP RELEASES THIS WEEK']),
    entry(6, 'New Stories', 'tv_show', ['RECENTLY ADDED']),
  ],
  errors: [],
});

test.beforeEach(async ({ page }) => {
  await page.route('https://images.example/**', (route) => route.fulfill({ status: 404 }));
  await page.route('**/movies.json', (route) => route.fulfill({ json: data() }));
});

for (const width of [320, 360, 390, 430]) {
  test(`mobile layout fits ${width}px with two columns and 44px touch targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.card')).toHaveCount(6);
    const measurements = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      columns: getComputedStyle(document.getElementById('cards')).gridTemplateColumns.split(' ').length,
      firstCardTop: document.querySelector('.card').getBoundingClientRect().top,
      controls: [...document.querySelectorAll('button, input, .card a, footer a')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      }).filter((rect) => rect.height > 0),
    }));
    expect(measurements.page).toBeLessThanOrEqual(measurements.viewport);
    expect(measurements.columns).toBe(2);
    expect(measurements.firstCardTop).toBeLessThanOrEqual(240);
    expect(measurements.controls.every((rect) => rect.height >= 44 && rect.width >= 44)).toBe(true);
    const brokenPoster = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'River & Rain' }) });
    await expect(brokenPoster.locator('.poster-placeholder')).toHaveText('RPoster unavailable');
    await expect(page.locator('.card h3')).toHaveText([
      'Green Valley', 'Weekly Favorite', 'Sky Stories', 'River & Rain',
      '<img src=x onerror=alert(1)>', 'New Stories',
    ]);
    await expect(page.locator('.card-badge.top')).toHaveCount(3);
    await expect(page.getByRole('group', { name: 'Release section' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Top this week' })).toHaveCount(0);
    await expect(page.locator('h3 img')).toHaveCount(0);
  });
}

test('type and search filters cover both sections on a touch viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'Releases', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All 6', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Movies 4', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TV shows 2', exact: true })).toBeVisible();
  await expect(page.locator('#result-count')).toHaveText('6 titles');
  await page.getByRole('button', { name: 'Movies' }).tap();
  await expect(page.locator('.card h3')).toHaveText([
    'Green Valley', 'Weekly Favorite', 'River & Rain', '<img src=x onerror=alert(1)>',
  ]);
  await page.getByRole('button', { name: 'TV shows' }).tap();
  await expect(page.locator('.card h3')).toHaveText(['Sky Stories', 'New Stories']);
  await expect(page.locator('.episode')).toHaveText(['Season 1 / Ep 01-08', 'Season 1 / Ep 01-08']);
  await expect(page.locator('footer #top-updated')).toContainText('Top picks refreshed');
  await expect(page.locator('footer #updated')).toContainText('List updated');
  await page.getByRole('button', { name: /^All/ }).tap();
  await expect(page.locator('.card')).toHaveCount(6);
  await page.getByRole('searchbox').fill('valley');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('#result-count')).toHaveText('1 title');
  await page.getByRole('searchbox').fill('river');
  await expect(page.locator('.card h3')).toHaveText(['River & Rain']);
  await page.getByRole('searchbox').fill('no such title');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.card')).toHaveCount(6);
});

test('load failures are explicit and retry recovers the list', async ({ page }) => {
  await page.route('**/movies.json', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('HTTP 503');
  await page.getByRole('button', { name: 'Movies' }).tap();
  await expect(page.locator('#empty')).toBeHidden();
  await page.route('**/movies.json', (route) => route.fulfill({ json: data() }));
  await page.getByRole('button', { name: 'Try again' }).tap();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(4);
});

test('invalid data does not create unsafe links', async ({ page }) => {
  const invalid = data();
  invalid.movies[0].url = 'javascript:alert(1)';
  await page.route('**/movies.json', (route) => route.fulfill({ json: invalid }));
  await page.goto('/');
  await expect(page.locator('#error-message')).toContainText('invalid entry');
  await expect(page.locator('.card')).toHaveCount(0);
});
