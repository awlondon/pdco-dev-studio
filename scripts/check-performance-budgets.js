#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, 'config', 'performance-budgets.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function formatBytes(bytes) {
  return `${bytes.toLocaleString()} B`;
}

function assertBudget(name, actual, budget) {
  const pass = actual <= budget;
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${name}: ${formatBytes(actual)} (budget ${formatBytes(budget)})`);
  return pass;
}

function runBundleBudgetCheck() {
  const bundleBudget = config?.bundle?.pdcoFrontend;
  if (!bundleBudget) {
    throw new Error('Missing bundle.pdcoFrontend budget config.');
  }

  const distDir = path.join(repoRoot, bundleBudget.distDir);
  const files = readdirSync(distDir);

  const jsFiles = files.filter((file) => file.endsWith('.js'));
  const cssFiles = files.filter((file) => file.endsWith('.css'));

  if (!jsFiles.length && !cssFiles.length) {
    throw new Error(`No bundle assets found in ${distDir}. Run frontend build first.`);
  }

  const jsSizes = jsFiles.map((file) => ({
    file,
    size: statSync(path.join(distDir, file)).size
  }));
  const cssSizes = cssFiles.map((file) => ({
    file,
    size: statSync(path.join(distDir, file)).size
  }));

  const totalJsBytes = jsSizes.reduce((sum, item) => sum + item.size, 0);
  const totalCssBytes = cssSizes.reduce((sum, item) => sum + item.size, 0);
  const entryJsBytes = jsSizes.length ? Math.max(...jsSizes.map((item) => item.size)) : 0;

  console.log('Performance budget check: bundle sizes');
  const checks = [
    assertBudget('Largest JS asset', entryJsBytes, bundleBudget.maxEntryJsBytes),
    assertBudget('Total JS assets', totalJsBytes, bundleBudget.maxTotalJsBytes),
    assertBudget('Total CSS assets', totalCssBytes, bundleBudget.maxTotalCssBytes)
  ];

  if (checks.every(Boolean)) {
    return;
  }

  console.error('\nLargest JS files:');
  for (const item of jsSizes.sort((a, b) => b.size - a.size).slice(0, 5)) {
    console.error(` - ${item.file}: ${formatBytes(item.size)}`);
  }

  process.exit(1);
}

runBundleBudgetCheck();
