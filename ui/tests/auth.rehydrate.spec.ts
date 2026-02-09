import { test, expect } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://dev.primarydesignco.com';
const shouldRunDevLogin =
  process.env.PLAYWRIGHT_DEV_LOGIN === 'true' || process.env.ENVIRONMENT === 'dev';

test('app rehydrates session and hides auth modal', async ({ page, context }) => {
  const sessionCookie = process.env.TEST_SESSION_COOKIE;
  if (!sessionCookie) {
    throw new Error('Missing TEST_SESSION_COOKIE');
  }

  const baseHostname = new URL(baseUrl).hostname;

  await context.addCookies([
    {
      name: 'maya_session',
      value: sessionCookie,
      domain: baseHostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    }
  ]);

  await page.goto(baseUrl);

  await expect(page.locator('text=Welcome to PDCo Dev Studio')).toHaveCount(0);
  await expect(page.locator('#workspace')).toBeVisible();
});

test('dev login issues session and renders app', async ({ page }) => {
  test.skip(!shouldRunDevLogin, 'Dev login only available in dev environments.');

  await page.goto(baseUrl);
  await page.request.post(`${baseUrl}/api/auth/dev_login`, { data: {} });

  await page.reload();

  const meRes = await page.request.get(`${baseUrl}/api/me`);
  expect(meRes.ok()).toBeTruthy();
  const meJson = await meRes.json();
  expect(meJson.user).toBeTruthy();

  await expect(page.locator('#userAvatar')).toBeVisible();
  await expect(page.locator('#userAvatar')).toHaveText('D');
});
