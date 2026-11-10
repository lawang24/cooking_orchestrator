import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const recipe = JSON.parse(readFileSync(new URL('recipes/butter-paneer.recipe.json', root), 'utf8'));
const simmer = recipe.steps.find(step => step.id === 'simmer_base');

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`butter paneer acknowledges every passive start at ${viewport.width}px`, async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto(new URL('visualizations/butter-paneer.html', root).href);
    await context.setOffline(true);
    await page.locator('#start-recipe').click();
    const next = page.locator('#next');
    for (let i = 0; i < recipe.steps.length && await page.locator('#step-instruction').textContent() !== simmer.instruction; i++) {
      await expect(next).toHaveText('Done');
      await next.click();
    }
    await expect(page.locator('#step-instruction')).toHaveText(simmer.instruction);
    await expect(page.locator('#step-timing')).toContainText('Ready to start');
    await expect(next).toHaveText('Started');
    const simmerDone = page.getByRole('button', { name: 'Done — Simmer base', exact: true });
    await expect(simmerDone).toHaveCount(0);
    await page.screenshot({ path: `tmp/butter-paneer-passive-${viewport.width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await next.click();
    await expect(simmerDone).toBeVisible();
    await page.locator('#previous').click();
    await expect(next).toHaveText('Started');
    await expect(page.locator('#step-instruction')).toHaveText(simmer.instruction);
    await expect(simmerDone).toHaveCount(0);

    const acknowledged = [];
    for (let i = 0; i < recipe.steps.length * 2; i++) {
      if (await page.locator('#step-instruction').textContent() === 'Recipe complete') break;
      if (await next.isEnabled()) {
        if (await next.textContent() === 'Started') acknowledged.push(await page.locator('#step-instruction').textContent());
        await next.click();
      } else {
        await page.getByRole('region', { name: 'Passive tasks in progress' }).getByRole('button', { name: /^Done —/ }).first().click();
      }
    }
    expect(acknowledged).toEqual(recipe.steps.filter(step => step.attention === 'passive').map(step => step.instruction));
    await expect(page.locator('#step-instruction')).toHaveText('Recipe complete');
    await expect(page.locator('#map-count')).toHaveText(`${recipe.steps.length} / ${recipe.steps.length} done`);
    expect(errors).toEqual([]);
  });
}
