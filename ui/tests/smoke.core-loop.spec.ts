import { test, expect, type Page } from '@playwright/test';

async function loginWithDevMagicLink(page: Page) {
  const requestRes = await page.request.post('/api/auth/email/request', {
    data: { email: 'smoke@example.com' }
  });
  expect(requestRes.ok()).toBeTruthy();

  const requestJson = await requestRes.json();
  const magicLink = requestJson?.debug_magic_link;
  expect(typeof magicLink).toBe('string');

  const token = new URL(magicLink).searchParams.get('token');
  expect(token).toBeTruthy();

  const verifyRes = await page.request.post('/api/auth/email/verify', {
    data: { token }
  });
  expect(verifyRes.ok()).toBeTruthy();
}

test('core smoke loop: app load -> editor -> preview -> agent -> artifact -> report issue', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('text=Welcome to PDCo Dev Studio')).toBeVisible();

  await loginWithDevMagicLink(page);
  await page.reload();

  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#code-editor')).toBeVisible();

  await expect(page.locator('#sandbox')).toBeVisible();
  await expect(page.locator('#previewErrorBanner')).toHaveClass(/hidden/);

  await page.fill('#agent-scenario-input', 'smoke core loop');
  await page.click('#agent-run-sim-btn');
  await expect(page.locator('#agent-sim-result')).toContainText('"status": "completed"');

  await page.click('#saveCodeBtn');
  await expect(page.locator('#artifactTitleInput')).toBeVisible();
  await page.fill('#artifactTitleInput', 'Smoke artifact');
  await page.click('#artifactConfirmButton');
  await expect(page.locator('#toast')).toContainText(/Artifact saved.|Saved locally/);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#reportIssueButton')
  ]);
  expect(download.suggestedFilename()).toContain('issue-report-');
  await expect(page.locator('#toast')).toContainText('Issue report captured.');
});
