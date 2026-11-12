import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('recipes/scrambled-eggs.recipe.json', root), 'utf8'));
const endpoint = 'https://mrwzofomwdzmxnjgapdw.supabase.co/functions/v1/recipes';
const compile = source => JSON.parse(execFileSync(new URL('.venv/bin/python', root).pathname,
  ['-c', 'import sys; sys.path.insert(0, "scripts"); from recipe_viewer_data import compile_recipe_json; print(compile_recipe_json(sys.stdin.read()))'],
  { cwd: root, input: source, encoding: 'utf8' }));
const catalogs = new WeakMap();

async function routeCatalog(context, catalog) {
  await context.route(endpoint + '**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { recipes: [...catalog.values()].map(item => item.recipe), next: null } });
    }
    const source = route.request().postData();
    const result = compile(source);
    if (!result.ok) return route.fulfill({ status: 400, json: { error: result.error } });
    const id = 'saved-' + result.data.graph.recipeId;
    if (catalog.has(id) && catalog.get(id).source !== source) return route.fulfill({ status: 409, json: { error: 'Choose a unique recipeId.' } });
    const recipe = { id, ...result.data };
    catalog.set(id, { source, recipe });
    return route.fulfill({ status: 201, json: { recipe } });
  });
}

test.beforeEach(async ({ context }) => {
  // No test writes to the live public library. This store survives reloads and
  // can be shared between isolated browser contexts to test persistence.
  const source = JSON.stringify(fixture);
  const recipe = { id: 'saved-' + fixture.recipeId, ...compile(source).data };
  const catalog = new Map([[recipe.id, { source, recipe }]]);
  catalogs.set(context, catalog);
  await routeCatalog(context, catalog);
});

test('copy instructions, validate with real Python, save, cook, and persist for another visitor', async ({ page, context, browser }) => {
  const errors = [];
  const runtimeRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('cdn.jsdelivr.net/pyodide/')) runtimeRequests.push(request.url()); });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('#recipe-library')).toHaveAttribute('data-hydrated', 'true');
  expect(runtimeRequests).toEqual([]);
  await page.getByRole('link', { name: 'New recipe' }).click();
  await page.getByRole('button', { name: 'Copy agent instructions' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied.' })).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  for (const file of ['AGENTS.md', 'DECISIONS.md', 'schemas/recipe.schema.json', 'schemas/LLM_RECIPE_GUIDE.md', 'scripts/compile_recipe.py', 'scripts/validate_recipe_graph.py', 'recipes/beef-onion-stir-fry.recipe.json']) {
    expect(prompt).toContain(readFileSync(new URL(file, root), 'utf8').trim());
  }
  await page.locator('#recipe-json').fill('not JSON');
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t valid JSON');
  expect(runtimeRequests).toEqual([]);
  await page.locator('#recipe-json').fill('{}');
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('alert')).toContainText('required property', { timeout: 90_000 });
  expect(runtimeRequests.length).toBeGreaterThan(0);

  const invalid = structuredClone(fixture);
  const ingredient = Object.keys(invalid.ingredients)[0];
  invalid.ingredients[ingredient].quantity += 1;
  await page.locator('#recipe-json').fill(JSON.stringify(invalid));
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('alert')).toContainText('add up to the input quantity');

  const recipe = { ...fixture, recipeId: 'my-shared-eggs', name: 'My shared eggs' };
  await page.locator('#recipe-json').fill(JSON.stringify(recipe));
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for your kitchen?' })).toBeVisible();
  await expect(page.locator('#recipes-panel')).toContainText('My shared eggs');
  const expected = JSON.parse(execFileSync(new URL('.venv/bin/python', root).pathname,
    ['-c', 'import sys; sys.path.insert(0, "scripts"); from recipe_viewer_data import compile_recipe_json; print(compile_recipe_json(sys.stdin.read()))'],
    { cwd: root, input: JSON.stringify(recipe), encoding: 'utf8' }));
  expect(await page.locator('#recipe-instructions > li').evaluateAll(items => items.map(item => item.dataset.actionId))).toEqual(expected.data.steps);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('#nodes .node').first()).toBeVisible();
  expect(await page.locator('#nodes .node').count()).toEqual(expected.data.steps.length);
  await page.locator('#nodes .node').first().click();
  await expect(page.locator('#details')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Edit JSON' }).click();
  await expect(page.locator('#recipe-json')).toHaveValue(JSON.stringify(recipe));
  await page.getByRole('button', { name: 'Check & review' }).click();
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.locator('#recipe-title')).toHaveText('My shared eggs');
  await page.getByRole('button', { name: 'Start recipe' }).click();
  await expect(page.locator('#step-instruction')).toBeVisible();
  await page.locator('#next').click();
  await expect(page.locator('#previous')).toBeEnabled();
  await page.getByRole('link', { name: 'Cooking Orchestrator home' }).click();
  await expect(page.locator('.library-recipes a').filter({ hasText: 'My shared eggs' })).toBeVisible();
  await expect(page.locator('.library-recipes a').filter({ hasText: fixture.name })).toBeVisible();
  await page.locator('.library-recipes a').filter({ hasText: fixture.name }).click();
  await page.getByRole('link', { name: 'Cooking Orchestrator home' }).click();
  await page.locator('.library-recipes a').filter({ hasText: 'My shared eggs' }).click();
  await page.reload();
  await expect(page.locator('#recipe-title')).toHaveText('My shared eggs');
  const visitor = await browser.newContext();
  try {
    await routeCatalog(visitor, catalogs.get(context));
    const other = await visitor.newPage();
    await other.goto(new URL('/', page.url()).href);
    await other.locator('.library-recipes a').filter({ hasText: 'My shared eggs' }).click();
    await expect(other.locator('#recipe-title')).toHaveText('My shared eggs');
  } finally { await visitor.close(); }
  expect(errors).toEqual([]);
});

test('file upload, clipboard fallback, failed runtime load, and retry preserve the JSON', async ({ page, context }) => {
  await context.route('https://cdn.jsdelivr.net/pyodide/**', route => route.abort());
  await page.goto('/#new');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.getByRole('button', { name: 'Copy agent instructions' }).click();
  await expect(page.getByRole('textbox', { name: 'Agent instructions' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Agent instructions' })).toBeFocused();
  const source = JSON.stringify({ ...fixture, name: 'Uploaded eggs' });
  await page.locator('#recipe-file').setInputFiles({ name: 'eggs.recipe.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  await expect(page.locator('#recipe-json')).toHaveValue(source);
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('alert')).toContainText('could not run');
  await expect(page.locator('#recipe-json')).toHaveValue(source);
  await context.unroute('https://cdn.jsdelivr.net/pyodide/**');
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.getByRole('button', { name: 'Save recipe' })).toBeVisible({ timeout: 90_000 });
});

test('failed saves retain the review and JSON; conflicts cannot replace an existing recipe', async ({ page, context }) => {
  await page.goto('/#new');
  const source = JSON.stringify({ ...fixture, name: 'An attempted replacement' });
  await page.locator('#recipe-json').fill(source);
  await page.getByRole('button', { name: 'Check & review' }).click();
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click({ timeout: 90_000 });
  await expect(page.getByRole('alert')).toContainText('unique recipeId');
  expect(catalogs.get(context).get('saved-' + fixture.recipeId).recipe.graph.name).toBe(fixture.name);
  await page.getByRole('button', { name: 'Edit JSON' }).click();
  await expect(page.locator('#recipe-json')).toHaveValue(source);
  const revised = JSON.stringify({ ...fixture, recipeId: 'retry-eggs', name: 'Retry eggs' });
  await page.locator('#recipe-json').fill(revised);
  await page.getByRole('button', { name: 'Check & review' }).click();
  let requests = 0;
  await context.route(endpoint, async route => {
    if (route.request().method() === 'POST' && requests++ === 0) return route.fulfill({ status: 503, json: { error: 'Could not save. Please retry.' } });
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please retry');
  await expect(page.getByRole('heading', { name: 'Ready for your kitchen?' })).toBeVisible();
  await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await expect(page.locator('#recipe-title')).toHaveText('Retry eggs');
});

test('loading errors preserve bundled recipes and retry fetches the shared library', async ({ page, context }) => {
  let attempts = 0;
  await context.route(endpoint, async route => {
    if (attempts++ === 0) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load');
  await expect(page.locator('.library-recipes')).toContainText(fixture.name);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.library-recipes a')).toHaveCount(1);
});

test('creation shows loading and blocks edits until main-thread validation finishes', async ({ page, context }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await context.route('https://cdn.jsdelivr.net/pyodide/**', async route => { await held; await route.continue(); });
  await page.goto('/#new');
  const source = JSON.stringify(fixture);
  await page.locator('#recipe-json').fill(source);
  await page.getByRole('button', { name: 'Check & review' }).click();
  try {
    await expect(page.locator('.loading-spinner')).toBeVisible();
    await expect(page.locator('.checker-status')).toContainText('Loading recipe checker');
    await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#recipe-json')).toBeDisabled();
    await expect(page.locator('#recipe-file')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'All recipes' })).toHaveAttribute('aria-disabled', 'true');
    expect(page.workers()).toEqual([]);
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Save recipe' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.loading-spinner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit JSON' }).click();
  await expect(page.locator('#recipe-json')).toHaveValue(source);
  await expect(page.getByRole('button', { name: 'Check & review' })).toBeEnabled();
});

test('the exported front page works from a file URL and fits a phone viewport', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('visualizations/index.html', root).href);
  await expect(page.locator('#recipe-library')).toHaveAttribute('data-hydrated', 'true');
  await page.screenshot({ path: new URL('tmp/recipe-library-desktop.png', root).pathname, fullPage: true });
  await page.getByRole('link', { name: 'New recipe' }).click();
  await page.screenshot({ path: new URL('tmp/new-recipe-desktop.png', root).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('tmp/new-recipe-mobile.png', root).pathname, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#recipe-json').fill(JSON.stringify({ ...fixture, recipeId: 'file-import-eggs', name: 'File import eggs' }));
  await page.getByRole('button', { name: 'Check & review' }).click();
  await expect(page.locator('.validation-success, #recipe-error')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#recipe-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save recipe' })).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Cooking Orchestrator home' }).click();
  await page.locator('.library-recipes a').filter({ hasText: 'File import eggs' }).click();
  await expect(page.locator('#recipe-title')).toHaveText('File import eggs');
  expect(errors).toEqual([]);
});
