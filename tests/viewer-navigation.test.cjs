// Isolated DOM tests: no browser session, filesystem page navigation or network.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {JSDOM, VirtualConsole} = require('jsdom');

const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || path.join(root, '.venv', 'bin', 'python');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => { await wait(0); await wait(0); };
const pages = new Map();
function generate(recipe = 'gyudon') {
  if (pages.has(recipe)) return pages.get(recipe);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-navigation-'));
  let html;
  try {
    const output = path.join(dir, 'viewer.html');
    execFileSync(python, [path.join(root, 'scripts/visualize_recipe_graph.py'), path.join(root, `recipes/${recipe}.recipe.json`), '-o', output]);
    html = fs.readFileSync(output, 'utf8');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  pages.set(recipe, html);
  return html;
}

async function viewer(recipe = 'gyudon', html = generate(recipe)) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  console.on('error', (...args) => errors.push(args));
  const dom = new JSDOM(html, {
    runScripts:'dangerously', virtualConsole:console,
    beforeParse(window) {
      // Layout measurement is outside these interaction tests.
      window.scrollTo = () => {};
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.HTMLElement.prototype.getBoundingClientRect = () => ({width:960,height:600,left:0,top:0});
      window.SVGElement.prototype.getBoundingClientRect = () => ({width:960,height:600,left:0,top:0});
      Object.defineProperty(window.SVGElement.prototype, 'clientWidth', {get:()=>960});
      Object.defineProperty(window.SVGElement.prototype, 'clientHeight', {get:()=>600});
    }
  });
  const prerenderedDocument = dom.window.document.getElementById('recipes-panel');
  for (let attempt = 0; attempt < 100 && dom.window.document.getElementById('viewer').dataset.hydrated !== 'true'; attempt++) await wait(20);
  await settle();
  assert.equal(dom.window.document.getElementById('viewer').dataset.hydrated, 'true', 'React should hydrate');
  assert.equal(dom.window.document.getElementById('recipes-panel'), prerenderedDocument, 'Hydration should reuse the prerendered DOM');
  assert.deepEqual(errors, [], 'Viewer should hydrate without script errors or mismatches');
  const document = dom.window.document;
  const get = id => document.getElementById(id);
  const sendKey = async (type, value, target=document.body, options={}) => {
    const event = new dom.window.KeyboardEvent(type, {key:value,bubbles:true,cancelable:true,...options});
    target.dispatchEvent(event);
    await settle();
    assert.deepEqual(errors, [], 'Keyboard navigation should not throw');
    return event;
  };
  const key = async (value, target, options) => {
    const down = await sendKey('keydown', value, target, options);
    await sendKey('keyup', value, target, options);
    return down;
  };
  const selected = () => [...document.querySelectorAll('.node.selected')].map(el=>el.dataset.id);
  const click = async element => { element.click(); await settle(); };
  const dispatch = async (element, event) => { element.dispatchEvent(event); await settle(); };
  const panel = id => click(document.querySelector(`.panel-nav button[aria-controls="${id}-panel"]`));
  const toggle = () => click(get('overview-toggle'));
  const instruction = () => get('step-instruction').textContent;
  return {dom, document, get, key, sendKey, selected, panel, toggle, instruction, click, dispatch, errors};
}

test('static exports contain visible semantic recipe content without executing JavaScript', t => {
  for (const recipe of ['gyudon', 'beef-onion-stir-fry', 'butter-paneer', 'scrambled-eggs']) {
    // JSDOM does not run scripts by default, matching a basic HTML-only bot.
    const dom = new JSDOM(generate(recipe));
    t.after(() => dom.window.close());
    const document = dom.window.document;
    const graph = JSON.parse(document.getElementById('recipe-data').textContent);
    const steps = JSON.parse(document.getElementById('step-data').textContent);
    const content = document.getElementById('recipes-panel');
    assert.equal(content.closest('[hidden]'), null);
    assert.equal(content.querySelector('h1').textContent, graph.name);
    assert.equal(document.title, `${graph.name} — recipe graph`);
    assert.equal(document.getElementById('viewer').dataset.hydrated, 'false');
    const ingredients = [...document.getElementById('ingredient-list').children];
    const expected = graph.nodes.filter(node => node.type === 'ingredient');
    assert.deepEqual(ingredients.map(item => item.textContent), expected.map(node => `${node.quantity} ${node.unit} ${node.name}`));
    const instructions = [...document.getElementById('recipe-instructions').children];
    assert.deepEqual(instructions.map(item => item.dataset.actionId), steps);
    for (const [i, id] of steps.entries()) {
      assert.ok(instructions[i].textContent.includes(graph.nodes.find(node => node.id === id).instruction));
    }
    for (const note of graph.notes) assert.ok(content.textContent.includes(note));
    for (const id of graph.outputs) assert.ok(content.textContent.includes(graph.nodes.find(node => node.id === id).name));
    assert.equal(document.querySelectorAll('script[src], link[rel="stylesheet"]').length, 0, 'No external runtime assets');
    assert.ok(document.getElementById('stepbar').hidden, 'Inert controls stay hidden until hydration');
  }
});

test('hydration reuses the prerendered recipe document and keeps it accessible in Recipes', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, []); });
  const content = v.get('recipes-panel');
  const instructions = content.querySelector('ol');
  await v.toggle();
  await v.panel('recipes');
  assert.equal(content.hidden, false);
  assert.equal(v.get('recipes-panel').querySelector('ol'), instructions);
  assert.equal(v.get('recipe-instructions').children.length, JSON.parse(v.get('step-data').textContent).length);
});

test('untrusted recipe text stays text in static HTML and after hydration', async t => {
  const original = new JSDOM(generate());
  const graph = JSON.parse(original.window.document.getElementById('recipe-data').textContent);
  const steps = JSON.parse(original.window.document.getElementById('step-data').textContent);
  original.window.close();
  const hostile = '</script><script>window.injected=true</script><img src=x onerror="window.injected=true"> & RECIPE_GRAPH_DATA 🥘';
  graph.name = hostile;
  graph.notes = [hostile];
  graph.nodes.find(node => node.type === 'ingredient').name = hostile;
  graph.nodes.find(node => node.id === steps[0]).instruction = hostile;
  const html = execFileSync('node', [path.join(root, 'frontend/dist/render.mjs')], {
    input: JSON.stringify({graph, steps}), encoding: 'utf8',
  });
  const plain = new JSDOM(html);
  t.after(() => plain.window.close());
  assert.equal(plain.window.document.title, `${hostile} — recipe graph`);
  assert.equal(plain.window.document.querySelectorAll('script').length, 3);
  assert.equal(plain.window.document.querySelectorAll('img').length, 0);
  assert.ok(plain.window.document.getElementById('recipe-instructions').textContent.includes(hostile));
  const v = await viewer('gyudon', html);
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, []); });
  assert.equal(v.dom.window.injected, undefined);
  assert.equal(v.instruction(), hostile);
});

test('merged meal exports hydrate with component servings and namespaced actions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-viewer-'));
  let html;
  try {
    execFileSync(python, [path.join(root, 'experiments/meal-merge/merge_recipes.py'),
      `beef=${path.join(root, 'recipes/beef-onion-stir-fry.recipe.json')}`,
      `gyudon=${path.join(root, 'recipes/gyudon.recipe.json')}`, '--output-dir', dir]);
    const file = fs.readdirSync(dir).find(file => file.endsWith('.html'));
    html = fs.readFileSync(path.join(dir, file), 'utf8');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  const v = await viewer('meal', html);
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, []); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  await v.toggle();
  await v.panel('recipes');
  assert.deepEqual([...v.get('recipe-list').children].map(item => item.textContent),
    graph.recipes.map(recipe => `${recipe.name} · ${recipe.servings} servings`));
  assert.deepEqual([...v.get('recipe-instructions').children].map(item => item.dataset.actionId), steps);
  await v.panel('graph');
  assert.equal(v.get('nodes').children.length, graph.nodes.length);
  assert.match(v.get('summary').textContent, /2 recipes/);
});

test('graph panning and wheel zoom preserve selection and suppress drag clicks', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, []); });
  await v.click(v.get('map-button'));
  const svg = v.get('diagram');
  const captured = new Set();
  svg.setPointerCapture = id => captured.add(id);
  svg.hasPointerCapture = id => captured.has(id);
  svg.releasePointerCapture = id => captured.delete(id);
  const pointer = (type, x, y) => {
    const event = new v.dom.window.MouseEvent(type, {bubbles:true, clientX:x, clientY:y, button:0});
    Object.defineProperty(event, 'pointerId', {value:1});
    return event;
  };
  const node = v.get('nodes').querySelector('[data-id="eggs"]');
  const initial = v.get('viewport').getAttribute('transform');
  await v.dispatch(svg, pointer('pointerdown', 100, 100));
  await v.dispatch(svg, pointer('pointermove', 180, 150));
  assert.equal(svg.classList.contains('dragging'), true);
  assert.notEqual(v.get('viewport').getAttribute('transform'), initial);
  await v.dispatch(svg, pointer('pointerup', 180, 150));
  assert.equal(captured.size, 0);
  await v.dispatch(node, new v.dom.window.MouseEvent('click', {bubbles:true}));
  assert.deepEqual(v.selected(), [], 'Dragging must not select an incidental node');
  await v.dispatch(node, pointer('pointerdown', 180, 150));
  await v.dispatch(node, pointer('pointerup', 180, 150));
  await v.dispatch(node, new v.dom.window.MouseEvent('click', {bubbles:true}));
  assert.deepEqual(v.selected(), ['eggs']);
  const zoom = v.get('zoom').textContent;
  const wheel = new v.dom.window.WheelEvent('wheel', {deltaY:-300, clientX:400, clientY:300, bubbles:true, cancelable:true});
  await v.dispatch(svg, wheel);
  assert.equal(wheel.defaultPrevented, true);
  assert.notEqual(v.get('zoom').textContent, zoom);
  assert.deepEqual(v.selected(), ['eggs']);
});

test('focus shows only the current action and navigation stops at both ends', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  assert.equal(v.get('stepbar').hidden, false);
  for (const id of ['canvas', 'progress-list', 'recipe-list']) {
    assert.ok(v.get(id).closest('[hidden]'));
  }
  assert.equal(v.get('nodes').children.length, 0);
  assert.equal(v.get('previous').disabled, true);
  await v.key('ArrowLeft');
  const instructions = steps.map(id => graph.nodes.find(n => n.id === id && n.type === 'action').instruction);
  for (const instruction of instructions) {
    assert.equal(v.instruction(), instruction);
    assert.equal((await v.key('ArrowRight')).defaultPrevented, true);
  }
  await v.key('ArrowRight');
  assert.equal(v.get('next').disabled, true);
  assert.equal(v.instruction(), instructions.at(-1));
  await v.key('ArrowLeft'); // Undo the final confirmation.
  assert.equal(v.instruction(), instructions.at(-1));
  for (let i = steps.length - 2; i >= 0; i--) {
    await v.key('ArrowLeft');
    assert.equal(v.instruction(), instructions[i]);
  }
  await v.key('ArrowLeft');
  assert.equal(v.instruction(), instructions[0]);
  assert.equal(v.get('previous').disabled, true);
});

test('a sustained arrow press updates the main minimap until released', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const map = v.get('map-button');
  const count = () => Number.parseInt(v.get('map-count').textContent);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  map.focus();
  await v.sendKey('keydown', 'ArrowRight', map);
  await v.sendKey('keydown', 'ArrowRight', map, {repeat:true});
  assert.equal(count(), 1, 'native repeats must not double-advance');
  await wait(700);
  await v.sendKey('keyup', 'ArrowRight', map);
  const afterRight = count();
  assert.ok(afterRight >= 3);
  await wait(400);
  assert.equal(count(), afterRight, 'release stops forward navigation');

  await v.sendKey('keydown', 'ArrowLeft', map);
  await wait(550);
  await v.sendKey('keyup', 'ArrowLeft', map);
  const afterLeft = count();
  assert.ok(afterLeft <= afterRight - 2);
  await wait(400);
  assert.equal(count(), afterLeft, 'release stops rewind');
});

test('progress tracks navigation and choosing a listed action returns to focus', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const first = v.instruction();
  await v.click(v.get('next'));
  assert.match(v.instruction(), /neutral oil/);
  await v.toggle();
  assert.equal(v.get('stepbar').hidden, true);
  assert.equal(v.get('overview-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(v.get('progress-panel').hidden, false);
  assert.match(v.get('step-count').textContent, /Step 2 of/);
  const buttons = v.get('progress-list').querySelectorAll('button');
  assert.equal(buttons[1].getAttribute('aria-current'), 'step');
  await v.click(buttons[0]);
  assert.equal(v.get('overview').hidden, true);
  assert.equal(v.instruction(), first);
  assert.equal(v.document.activeElement, v.get('overview-toggle'));
});

test('graph inspection, zoom, recipe details and Escape preserve the current action', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  await v.click(v.get('next'));
  const second = v.instruction();
  await v.toggle();
  await v.panel('graph');
  assert.equal(v.get('graph-panel').hidden, false);
  assert.equal(v.get('progress-panel').hidden, true);
  await v.dispatch(v.get('nodes').querySelector('[data-id="eggs"]'), new v.dom.window.MouseEvent('click', {bubbles:true}));
  assert.deepEqual(v.selected(), ['eggs']);
  assert.match(v.get('details').textContent, /Eggs/);
  const transform = v.get('viewport').getAttribute('transform');
  await v.click(v.get('plus'));
  assert.notEqual(v.get('viewport').getAttribute('transform'), transform);
  assert.equal((await v.key('ArrowRight', v.get('direction'))).defaultPrevented, false);
  await v.key('Escape', v.document.querySelector('.node.selected'));
  assert.deepEqual(v.selected(), []);
  assert.equal(v.get('overview').hidden, false);
  await v.panel('recipes');
  assert.match(v.get('recipe-list').textContent, /Gyudon.*4 servings/);
  assert.ok(v.get('recipe-notes').children.length);
  assert.equal(v.get('graph-panel').hidden, true);
  assert.equal((await v.key('ArrowRight')).defaultPrevented, false);
  await v.key('Escape');
  assert.equal(v.get('overview').hidden, true);
  assert.equal(v.instruction(), second);
  await v.click(v.get('previous'));
  assert.match(v.instruction(), /onion/);
});

test('timing shows only the scheduled duration, provenance and attention', async t => {
  const v = await viewer('beef-onion-stir-fry');
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const id of ['measure_water', 'marinate_beef', 'sear_beef']) {
    const action = graph.nodes.find(n => n.id === id);
    await v.toggle();
    await v.panel('progress');
    await v.click(v.get('progress-list').children[steps.indexOf(id)].querySelector('button'));
    const timing = v.get('step-timing').textContent;
    const expectedTiming = {
      measure_water: '45s planned (estimate) · Hands-on',
      marinate_beef: '15m planned · Hands-off',
      sear_beef: '2m 30s planned (estimate) · Hands-on',
    };
    assert.equal(timing, expectedTiming[id]);
    await v.click(v.get('map-button'));
    await v.dispatch(v.get('nodes').querySelector(`[data-id="${id}"]`), new v.dom.window.MouseEvent('click', {bubbles:true}));
    assert.ok(v.get('details').textContent.includes(action.instruction));
    assert.doesNotMatch(v.get('details').textContent, /Planning estimate:|undefined/);
    assert.match(v.get('details').textContent, action.scheduled_duration_source === 'estimate' ? /Estimated duration/ : /Recipe duration/);
    await v.toggle();
  }
});

test('inputs and modifier shortcuts keep native arrow behavior', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const first = v.instruction();
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) {
    assert.equal((await v.key('ArrowRight', v.document.body, {[modifier]:true})).defaultPrevented, false);
  }
  await v.toggle();
  await v.panel('graph');
  for (const control of ['direction', 'orders']) {
    assert.equal((await v.key('ArrowRight', v.get(control))).defaultPrevented, false);
  }
  assert.equal(v.instruction(), first);
});

test('layout and ordering visibility do not change action prerequisites', async t => {
  const v = await viewer('beef-onion-stir-fry');
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  await v.toggle();
  await v.panel('graph');
  await v.click(v.get('orders'));
  v.get('direction').value = 'LR';
  await v.dispatch(v.get('direction'), new v.dom.window.Event('change', {bubbles:true}));
  const arrows = [...v.document.querySelectorAll('.edge.order')];
  assert.ok(arrows.length);
  assert.ok(arrows.every(el => el.style.display === 'none'));
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const id of ['marinate_beef', 'prep_onions', 'mix_sauce']) {
    assert.ok(steps.indexOf(id) < steps.indexOf('sear_beef'));
  }
  assert.ok(steps.indexOf('sear_beef') < steps.indexOf('sear_onions'));
  await v.toggle();
  await v.key('ArrowRight');
  assert.match(v.instruction(), /baking soda/);
});

test('minimap shows only actions, connects producers to consumers, and tracks completion', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  const first = steps[0];
  const doneIds = () => [...v.get('map-nodes').querySelectorAll('.done')].map(n => n.dataset.id).sort();
  assert.deepEqual([...v.get('map-nodes').children].map(n => n.dataset.id).sort(), [...steps].sort());
  const links = [...v.get('map-links').children];
  assert.ok(links.every(link => steps.includes(link.dataset.from) && steps.includes(link.dataset.to)));
  assert.ok(links.some(link => link.dataset.from === first && link.dataset.to === 'slice_onions'));
  assert.deepEqual(doneIds(), []);
  const ring = () => ['cx','cy'].map(attr => v.get('map-current').getAttribute(attr));
  const start = ring();
  await v.click(v.get('next'));
  const firstBranch = [first, ...graph.edges.filter(e => e.to === first).map(e => e.from),
    ...graph.edges.filter(e => e.from === first).map(e => e.to)].sort();
  assert.deepEqual(doneIds(), [first]);
  assert.notDeepEqual(ring(), start);
  assert.match(v.get('map-count').textContent, /^1 \/ /);
  await v.click(v.get('previous'));
  assert.deepEqual(doneIds(), []);
  assert.match(v.get('map-count').textContent, /^0 \/ /);
  assert.deepEqual(ring(), start);
  await v.key('ArrowRight');
  assert.deepEqual(doneIds(), [first]);
  await v.click(v.get('map-button'));
  assert.equal(v.get('graph-panel').hidden, false);
  assert.equal(v.get('overview').hidden, false);
  assert.deepEqual([...v.get('nodes').querySelectorAll('.done')].map(n => n.dataset.id).sort(), firstBranch);
  const selected = v.get('nodes').querySelector(`[data-id="${first}"]`);
  assert.match(selected.textContent, /✓ DONE/);
  await v.panel('progress');
  assert.match(v.get('progress-list').children[0].textContent, /✓ Done/);
});

test('completing a jumped-to action includes transitive food and ordering prerequisites', async t => {
  const v = await viewer('beef-onion-stir-fry');
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const node of graph.nodes.filter(n => n.type === 'action')) {
    for (const parent of node.dependsOn) {
      assert.ok(v.get('map-links').querySelector(`[data-from="${parent}"][data-to="${node.id}"]`));
    }
  }
  await v.toggle();
  await v.click(v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('button'));
  assert.equal(v.get('map-nodes').querySelectorAll('.done').length, 0);
  await v.key('ArrowRight');
  const done = id => v.get('map-nodes').querySelector(`[data-id="${id}"]`).classList.contains('done');
  for (const id of ['sear_beef','marinate_beef','mix_sauce','prep_onions','slice_beef','measure_onion']) {
    assert.equal(done(id), true, id);
  }
  for (const id of ['sear_onions','simmer_sauce','finish_dish']) assert.equal(done(id), false, id);
  await v.key('ArrowLeft');
  assert.equal(v.get('map-nodes').querySelectorAll('.done').length, 0);
});

test('finishing the final action completes terminal food states', async t => {
  const v = await viewer('gyudon');
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const steps = JSON.parse(v.get('step-data').textContent);
  for (let i = 1; i < steps.length; i++) await v.click(v.get('next'));
  assert.equal(v.get('next').disabled, false);
  assert.equal(v.get('next').textContent, 'Finish step');
  await v.click(v.get('next'));
  assert.equal(v.get('next').disabled, true);
  assert.equal(v.get('map-nodes').querySelectorAll(':not(.done)').length, 0);
  assert.equal(v.get('map-links').querySelectorAll(':not(.done)').length, 0);
  await v.click(v.get('previous'));
  assert.equal(v.get('next').disabled, false);
  assert.equal(v.get('next').textContent, 'Finish step');
  assert.equal(v.get('map-count').textContent, `${steps.length-1} / ${steps.length} done`);
});

test('both graphs flow down from their starting nodes to their final outputs', async t => {
  const v = await viewer();
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const graph = JSON.parse(v.get('recipe-data').textContent);
  await v.click(v.get('map-button'));
  function assertRanks(y) {
    const positions = graph.nodes.map(n => y(n.id));
    const top = Math.min(...positions), bottom = Math.max(...positions);
    for (const n of graph.nodes) {
      if (n.type === 'ingredient') assert.equal(y(n.id), top, n.id);
      if (graph.outputs.includes(n.id)) assert.equal(y(n.id), bottom, n.id);
    }
    for (const {from,to} of graph.edges) assert.ok(y(from) < y(to), `${from} → ${to}`);
  }
  const mapY = id => Number(v.get('map-nodes').querySelector(`[data-id="${id}"]`).getAttribute('cy'));
  const actionIds = JSON.parse(v.get('step-data').textContent);
  const top = Math.min(...actionIds.map(mapY)), bottom = Math.max(...actionIds.map(mapY));
  for (const id of actionIds.filter(id => id.startsWith('measure_'))) assert.equal(mapY(id), top);
  assert.equal(mapY('assemble_bowls'), bottom);
  for (const {dataset} of v.get('map-links').children) assert.ok(mapY(dataset.from) < mapY(dataset.to));
  assertRanks(id => {
    const g = v.get('nodes').querySelector(`[data-id="${id}"]`);
    const y = Number(g.getAttribute('transform').match(/,([^)]*)/)[1]);
    return y + Number(g.querySelector('rect').getAttribute('height')) / 2;
  });
});

test('rewinding restores earlier confirmations and clears inferred progress in all views', async t => {
  const v = await viewer('beef-onion-stir-fry');
  t.after(() => { v.dom.window.close(); assert.deepEqual(v.errors, [], 'No script or hydration errors'); });
  const steps = JSON.parse(v.get('step-data').textContent);
  const marked = () => [...v.get('map-nodes').querySelectorAll('.done')].map(n => n.dataset.id);
  await v.click(v.get('next'));
  const firstBranch = marked();
  await v.toggle();
  await v.click(v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('button'));
  await v.click(v.get('next'));
  await v.click(v.get('map-button'));
  assert.ok(v.get('nodes').querySelector('[data-id="sear_beef"]').classList.contains('done'));
  await v.toggle();
  await v.click(v.get('previous'));
  assert.deepEqual(marked(), firstBranch);
  assert.deepEqual([...v.get('nodes').querySelectorAll('.done.action-node')].map(n => n.dataset.id), firstBranch);
  assert.equal(v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('.step-status').textContent, '');
  await v.toggle();
  await v.panel('progress');
  await v.click(v.get('progress-list').children[0].querySelector('button'));
  assert.deepEqual(marked(), []);
});
