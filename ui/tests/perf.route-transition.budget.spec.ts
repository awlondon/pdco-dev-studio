import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type RouteBudgetConfig = {
  maxP95Ms: number;
  sampleCount: number;
  warmupSamples: number;
  fromRoute: string;
  toRoute: string;
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function getRouteBudget(): RouteBudgetConfig {
  const raw = readFileSync('config/performance-budgets.json', 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.runtime.routeTransition as RouteBudgetConfig;
}

test('route transition p95 stays within runtime budget', async ({ page }) => {
  const budget = getRouteBudget();
  const samples: number[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const match = text.match(/\[perf\] route_transition \(setRoute:pushstate\): ([0-9.]+)ms/);
    if (match) {
      samples.push(Number(match[1]));
    }
  });

  await page.goto(budget.fromRoute);

  const totalTransitions = budget.sampleCount + budget.warmupSamples;
  for (let i = 0; i < totalTransitions; i += 1) {
    await page.click('#publicGalleryButton');
    await expect(page).toHaveURL(/\/gallery\/public$/);
    await expect(page.locator('#public-gallery-page')).toBeVisible();

    await page.click('#publicGalleryBackButton');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#workspace')).toBeVisible();
  }

  const expectedTransitions = totalTransitions * 2;
  expect(samples.length).toBeGreaterThanOrEqual(expectedTransitions);

  const measured = samples.slice(samples.length - budget.sampleCount * 2);
  const p95 = percentile(measured, 95);

  expect(
    p95,
    `Route transition p95 ${p95.toFixed(1)}ms exceeded budget ${budget.maxP95Ms}ms from ${budget.sampleCount * 2} transitions`
  ).toBeLessThanOrEqual(budget.maxP95Ms);
});
