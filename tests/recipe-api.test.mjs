import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compileRecipe } from '../supabase/functions/recipes/validate.ts';
import { createHandler } from '../supabase/functions/recipes/handler.ts';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('recipes/beef-onion-stir-fry.recipe.json', root)));
const python = documents => JSON.parse(execFileSync(new URL('.venv/bin/python', root).pathname, ['-c', `
import json, sys
sys.path.insert(0, 'scripts')
from recipe_viewer_data import compile_recipe_json
print(json.dumps([json.loads(compile_recipe_json(json.dumps(doc))) for doc in json.load(sys.stdin)]))
`], { cwd: root, input: JSON.stringify(documents), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));

test('edge compilation matches Python graphs and ordering for every saved recipe and example', () => {
  const documents = readdirSync(new URL('recipes/', root)).filter(name => name.endsWith('.recipe.json'))
    .map(name => JSON.parse(readFileSync(new URL('recipes/' + name, root))));
  documents.push(JSON.parse(readFileSync(new URL('schemas/recipe.example.json', root))));
  // Source order is not execution order.
  const reversed = structuredClone(fixture); reversed.steps.reverse(); documents.push(reversed);
  const expected = python(documents);
  documents.forEach((doc, i) => {
    assert.equal(expected[i].ok, true);
    assert.deepEqual(compileRecipe(doc), expected[i].data);
  });
});

test('edge rejection agrees with Python on schema, flow, allocation, and dependency failures', () => {
  const cases = [];
  const change = fn => { const doc = structuredClone(fixture); fn(doc); cases.push(doc); };
  for (const key of ['schemaVersion', 'recipeId', 'name', 'servings', 'notes', 'outputs', 'ingredients', 'steps']) change(d => { delete d[key]; });
  for (const key of ['id', 'instruction', 'operation', 'inputs', 'outputs', 'equipment', 'attention', 'cooksRequired', 'scheduled_duration_seconds', 'scheduled_duration_source']) change(d => { delete d.steps[0][key]; });
  for (const value of [0, -1, true, '1', null]) change(d => { d.ingredients.flank_steak.quantity = value; });
  change(d => { d.extra = true; });
  change(d => { d.steps[0].inputs = ['missing']; });
  change(d => { d.steps[1].id = d.steps[0].id; });
  change(d => { d.steps[0].outputs[0].id = d.steps[0].id; });
  change(d => { d.steps[0].dependsOn = [d.steps[0].id]; });
  change(d => { d.steps[0].dependsOn = ['missing']; });
  change(d => { d.steps[0].dependsOn = [Object.keys(d.ingredients)[0]]; });
  change(d => { d.outputs = [d.steps[0].id]; });
  change(d => { d.outputs = ['missing']; });
  change(d => { d.ingredients.flank_steak.quantity += 1; });
  change(d => { d.steps.find(s => s.operation === 'measure').outputs[0].ingredient = 'wrong'; });
  change(d => { d.steps.find(s => s.operation === 'measure').outputs[0].unit = 'whole'; });
  change(d => { d.steps[0].operation = 'chop'; });
  change(d => { d.steps[0].attention = 'passive'; d.steps[0].cooksRequired = 0; });
  change(d => { d.steps[0].inputs = [d.steps[1].id]; });
  change(d => { d.steps[0].outputs[0].quantity = 0; });
  change(d => { d.steps[0].outputs.push({ ...d.steps[0].outputs[0], id: 'unused' }); });
  const expected = python(cases);
  cases.forEach((doc, i) => {
    assert.equal(expected[i].ok, false, `Python accepted case ${i}`);
    assert.throws(() => compileRecipe(doc), undefined, `Edge accepted case ${i}`);
  });
  assert.throws(() => compileRecipe({ ...fixture, servings: Infinity }));
});

const request = document => new Request('https://example.test/recipes', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document),
});

test('anonymous saves use validated JSON and never accept an update revision', async () => {
  let calls = 0;
  const handler = createHandler(async (path, payload) => {
    calls++; assert.equal(path, 'rpc/save_recipes');
    assert.deepEqual(payload, { p_recipes: [{ document: fixture, expected_revision: null }] });
    return Response.json([{ recipe_id: fixture.recipeId, document: fixture }]);
  });
  const valid = await handler(request(fixture));
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).recipe.id, 'saved-' + fixture.recipeId);
  for (const bad of [{}, { ...fixture, expected_revision: 1 }]) assert.equal((await handler(request(bad))).status, 400);
  const invalid = structuredClone(fixture); invalid.steps[0].inputs = ['missing'];
  assert.equal((await handler(request(invalid))).status, 400);
  assert.equal(calls, 1);
});

test('public requests enforce size, JSON, CORS, and allowed methods before database access', async () => {
  const handler = createHandler(async () => { throw new Error('Unexpected database call'); });
  assert.equal((await handler(request({ content: 'x'.repeat(256 * 1024) }))).status, 400);
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: 'not JSON' }))).status, 400);
  const options = await handler(new Request('https://example.test', { method: 'OPTIONS' }));
  assert.equal(options.status, 204); assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await handler(new Request('https://example.test', { method }))).status, 405);
});

test('conflicts retain existing recipes and produce an actionable error; outages do not claim a save', async () => {
  const conflict = createHandler(async () => Response.json({ code: 'PT409' }, { status: 409 }));
  const response = await conflict(request(fixture));
  assert.equal(response.status, 409); assert.match((await response.json()).error, /unique recipeId/);
  const failed = createHandler(async () => { throw new Error('secret connection information'); });
  const unavailable = await failed(request(fixture));
  assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /secret/);
});

test('shared reads compile stored JSON and paginate using the recipe ID', async () => {
  let path;
  const handler = createHandler(async value => { path = value; return Response.json([{ recipe_id: fixture.recipeId, document: fixture }]); });
  const response = await handler(new Request('https://example.test?after=abc'));
  assert.equal(response.status, 200); assert.match(path, /recipe_id=gt.abc/);
  const result = await response.json();
  assert.equal(result.next, null); assert.equal(result.recipes[0].graph.recipeId, fixture.recipeId);
  assert.equal((await handler(new Request('https://example.test?after=%22'))).status, 400);
});
