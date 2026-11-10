// Run after build:viewer with: node --test tests/viewer-layout.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

test('long cooking instructions stay centered while the desktop map stays visible', async t => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-layout-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const output = path.join(dir, 'recipe.html');
  execFileSync(path.join(root, '.venv/bin/python'), [
    path.join(root, 'scripts/visualize_recipe_graph.py'),
    path.join(root, 'recipes/scrambled-eggs.recipe.json'), '-o', output,
  ]);
  const browser = await chromium.launch({
    headless:true,
    executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(output).href);
  await page.waitForSelector('#viewer[data-hydrated="true"]');
  await page.locator('#start-recipe').click();
  await page.evaluate(() => {
    document.querySelector('#step-instruction').textContent += ' Keep stirring gently.'.repeat(100);
  });
  for (const viewport of [{width:1254,height:724}, {width:1024,height:600}]) {
    await page.setViewportSize(viewport);
    for (const scroll of [0, 350]) {
      await page.evaluate(y => window.scrollTo(0, y), scroll);
      const content = await page.locator('.action-focus').boundingBox();
      const map = await page.locator('#map-button').boundingBox();
      assert.ok(Math.abs(content.x + content.width / 2 - viewport.width / 2) < 1);
      assert.ok(map.y >= 0 && map.y + map.height <= viewport.height);
    }
  }
  await page.setViewportSize({width:390,height:844});
  const content = await page.locator('.action-focus').boundingBox();
  const map = await page.locator('#map-button').boundingBox();
  assert.ok(map.y >= content.y + content.height, 'Mobile map follows the content');
  assert.deepEqual(errors, []);
});
