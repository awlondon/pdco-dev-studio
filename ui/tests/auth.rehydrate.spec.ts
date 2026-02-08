import { test, expect } from '@playwright/test';

test('app rehydrates session and hides auth modal', async ({ page, context }) => {
  const sessionCookie = process.env.TEST_SESSION_COOKIE;
  if (!sessionCookie) {
    throw new Error('Missing TEST_SESSION_COOKIE');
  }

  await context.addCookies([
    {
      name: 'maya_session',
      value: sessionCookie,
      domain: 'dev.primarydesignco.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    }
  ]);

  await page.goto('https://dev.primarydesignco.com');

  await expect(page.locator('text=Welcome to Maya')).toHaveCount(0);
  await expect(page.locator('#workspace')).toBeVisible();
});
