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
  ],
  tvShows: [entry(4, 'Sky Stories', 'tv_show', ['RECENTLY ADDED', 'TOP RELEASES THIS WEEK'])],
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
    await expect(page.locator('.card')).toHaveCount(4);
    const measurements = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      columns: getComputedStyle(document.getElementById('cards')).gridTemplateColumns.split(' ').length,
      controls: [...document.querySelectorAll('button, input, .card a, footer a')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      }).filter((rect) => rect.height > 0),
    }));
    expect(measurements.page).toBeLessThanOrEqual(measurements.viewport);
    expect(measurements.columns).toBe(2);
    expect(measurements.controls.every((rect) => rect.height >= 44 && rect.width >= 44)).toBe(true);
    await expect(page.locator('.card').first().locator('.poster-placeholder')).toBeVisible();
    await expect(page.locator('.card').nth(2).locator('h3')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('h3 img')).toHaveCount(0);
  });
}

test('section, type and search filters combine correctly on a touch viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(4);
  await page.getByRole('button', { name: 'TV shows' }).tap();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.episode')).toHaveText('Season 1 / Ep 01-08');
  await page.getByRole('button', { name: 'Top this week' }).tap();
  await expect(page.getByRole('heading', { name: 'Top releases this week' })).toBeVisible();
  await expect(page.locator('#top-updated')).toBeVisible();
  await page.getByRole('button', { name: /^All/ }).tap();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('searchbox').fill('valley');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('searchbox').fill('no such title');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.card')).toHaveCount(2);
});

test('load failures are explicit and retry recovers the list', async ({ page }) => {
  await page.route('**/movies.json', (route) => route.fulfill({ status: 503 }));
  await page.goto('/');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('HTTP 503');
  await page.getByRole('button', { name: 'Top this week' }).tap();
  await expect(page.locator('#empty')).toBeHidden();
  await page.route('**/movies.json', (route) => route.fulfill({ json: data() }));
  await page.getByRole('button', { name: 'Try again' }).tap();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(2);
});

test('invalid data does not create unsafe links', async ({ page }) => {
  const invalid = data();
  invalid.movies[0].url = 'javascript:alert(1)';
  await page.route('**/movies.json', (route) => route.fulfill({ json: invalid }));
  await page.goto('/');
  await expect(page.locator('#error-message')).toContainText('invalid entry');
  await expect(page.locator('.card')).toHaveCount(0);
});
