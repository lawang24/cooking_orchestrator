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

function viewer(recipe = 'gyudon') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipe-navigation-'));
  let html;
  try {
    const output = path.join(dir, 'viewer.html');
    execFileSync(python, [path.join(root, 'scripts/visualize_recipe_graph.py'), path.join(root, `recipes/${recipe}.recipe.json`), '-o', output]);
    html = fs.readFileSync(output, 'utf8');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
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
  assert.deepEqual(errors, [], 'Viewer should start without script errors');
  const document = dom.window.document;
  const get = id => document.getElementById(id);
  const sendKey = (type, value, target=document.body, options={}) => {
    const event = new dom.window.KeyboardEvent(type, {key:value,bubbles:true,cancelable:true,...options});
    target.dispatchEvent(event);
    assert.deepEqual(errors, [], 'Keyboard navigation should not throw');
    return event;
  };
  const key = (value, target, options) => {
    const down = sendKey('keydown', value, target, options);
    sendKey('keyup', value, target, options);
    return down;
  };
  const selected = () => [...document.querySelectorAll('.node.selected')].map(el=>el.dataset.id);
  const panel = id => document.querySelector(`button[aria-controls="${id}-panel"]`).click();
  const toggle = () => get('overview-toggle').click();
  const instruction = () => get('step-instruction').textContent;
  return {dom, document, get, key, sendKey, selected, panel, toggle, instruction};
}

test('focus shows only the current action and navigation stops at both ends', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  assert.equal(v.get('stepbar').hidden, false);
  for (const id of ['canvas', 'progress-list', 'recipe-list']) {
    assert.ok(v.get(id).closest('[hidden]'));
  }
  assert.equal(v.get('nodes').children.length, 0);
  assert.equal(v.get('previous').disabled, true);
  v.key('ArrowLeft');
  const instructions = steps.map(id => graph.nodes.find(n => n.id === id && n.type === 'action').instruction);
  for (const instruction of instructions) {
    assert.equal(v.instruction(), instruction);
    assert.equal(v.key('ArrowRight').defaultPrevented, true);
  }
  v.key('ArrowRight');
  assert.equal(v.get('next').disabled, true);
  assert.equal(v.instruction(), instructions.at(-1));
  v.key('ArrowLeft'); // Undo the final confirmation.
  assert.equal(v.instruction(), instructions.at(-1));
  for (let i = steps.length - 2; i >= 0; i--) {
    v.key('ArrowLeft');
    assert.equal(v.instruction(), instructions[i]);
  }
  v.key('ArrowLeft');
  assert.equal(v.instruction(), instructions[0]);
  assert.equal(v.get('previous').disabled, true);
});

test('a sustained arrow press updates the main minimap until released', async t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  const map = v.get('map-button');
  const count = () => Number.parseInt(v.get('map-count').textContent);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  map.focus();
  v.sendKey('keydown', 'ArrowRight', map);
  v.sendKey('keydown', 'ArrowRight', map, {repeat:true});
  assert.equal(count(), 1, 'native repeats must not double-advance');
  await wait(700);
  v.sendKey('keyup', 'ArrowRight', map);
  const afterRight = count();
  assert.ok(afterRight >= 3);
  await wait(400);
  assert.equal(count(), afterRight, 'release stops forward navigation');

  v.sendKey('keydown', 'ArrowLeft', map);
  await wait(550);
  v.sendKey('keyup', 'ArrowLeft', map);
  const afterLeft = count();
  assert.ok(afterLeft <= afterRight - 2);
  await wait(400);
  assert.equal(count(), afterLeft, 'release stops rewind');
});

test('progress tracks navigation and choosing a listed action returns to focus', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  const first = v.instruction();
  v.get('next').click();
  assert.match(v.instruction(), /neutral oil/);
  v.toggle();
  assert.equal(v.get('stepbar').hidden, true);
  assert.equal(v.get('overview-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(v.get('progress-panel').hidden, false);
  assert.match(v.get('step-count').textContent, /Step 2 of/);
  const buttons = v.get('progress-list').querySelectorAll('button');
  assert.equal(buttons[1].getAttribute('aria-current'), 'step');
  buttons[0].click();
  assert.equal(v.get('overview').hidden, true);
  assert.equal(v.instruction(), first);
  assert.equal(v.document.activeElement, v.get('overview-toggle'));
});

test('graph inspection, zoom, recipe details and Escape preserve the current action', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  v.get('next').click();
  const second = v.instruction();
  v.toggle();
  v.panel('graph');
  assert.equal(v.get('graph-panel').hidden, false);
  assert.equal(v.get('progress-panel').hidden, true);
  v.get('nodes').querySelector('[data-id="eggs"]').dispatchEvent(new v.dom.window.MouseEvent('click', {bubbles:true}));
  assert.deepEqual(v.selected(), ['eggs']);
  assert.match(v.get('details').textContent, /Eggs/);
  const transform = v.get('viewport').getAttribute('transform');
  v.get('plus').click();
  assert.notEqual(v.get('viewport').getAttribute('transform'), transform);
  assert.equal(v.key('ArrowRight', v.get('direction')).defaultPrevented, false);
  v.key('Escape', v.document.querySelector('.node.selected'));
  assert.deepEqual(v.selected(), []);
  assert.equal(v.get('overview').hidden, false);
  v.panel('recipes');
  assert.match(v.get('recipe-list').textContent, /Gyudon.*4 servings/);
  assert.ok(v.get('recipe-notes').children.length);
  assert.equal(v.get('graph-panel').hidden, true);
  assert.equal(v.key('ArrowRight').defaultPrevented, false);
  v.key('Escape');
  assert.equal(v.get('overview').hidden, true);
  assert.equal(v.instruction(), second);
  v.get('previous').click();
  assert.match(v.instruction(), /onion/);
});

test('timing shows only the scheduled duration, provenance and attention', t => {
  const v = viewer('beef-onion-stir-fry');
  t.after(() => v.dom.window.close());
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const id of ['measure_water', 'marinate_beef', 'sear_beef']) {
    const action = graph.nodes.find(n => n.id === id);
    v.toggle();
    v.panel('progress');
    v.get('progress-list').children[steps.indexOf(id)].querySelector('button').click();
    const timing = v.get('step-timing').textContent;
    const expectedTiming = {
      measure_water: '45s planned (estimate) · Hands-on',
      marinate_beef: '15m planned · Hands-off',
      sear_beef: '2m 30s planned (estimate) · Hands-on',
    };
    assert.equal(timing, expectedTiming[id]);
    v.get('map-button').click();
    v.get('nodes').querySelector(`[data-id="${id}"]`).dispatchEvent(new v.dom.window.MouseEvent('click', {bubbles:true}));
    assert.ok(v.get('details').textContent.includes(action.instruction));
    assert.doesNotMatch(v.get('details').textContent, /Planning estimate:|undefined/);
    assert.match(v.get('details').textContent, action.scheduled_duration_source === 'estimate' ? /Estimated duration/ : /Recipe duration/);
    v.toggle();
  }
});

test('inputs and modifier shortcuts keep native arrow behavior', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  const first = v.instruction();
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) {
    assert.equal(v.key('ArrowRight', v.document.body, {[modifier]:true}).defaultPrevented, false);
  }
  v.toggle();
  v.panel('graph');
  for (const control of ['direction', 'orders']) {
    assert.equal(v.key('ArrowRight', v.get(control)).defaultPrevented, false);
  }
  assert.equal(v.instruction(), first);
});

test('layout and ordering visibility do not change action prerequisites', t => {
  const v = viewer('beef-onion-stir-fry');
  t.after(() => v.dom.window.close());
  v.toggle();
  v.panel('graph');
  v.get('orders').checked = false;
  v.get('orders').dispatchEvent(new v.dom.window.Event('change'));
  v.get('direction').value = 'LR';
  v.get('direction').dispatchEvent(new v.dom.window.Event('change'));
  const arrows = [...v.document.querySelectorAll('.edge.order')];
  assert.ok(arrows.length);
  assert.ok(arrows.every(el => el.style.display === 'none'));
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const id of ['marinate_beef', 'prep_onions', 'mix_sauce']) {
    assert.ok(steps.indexOf(id) < steps.indexOf('sear_beef'));
  }
  assert.ok(steps.indexOf('sear_beef') < steps.indexOf('sear_onions'));
  v.toggle();
  v.key('ArrowRight');
  assert.match(v.instruction(), /baking soda/);
});

test('minimap shows only actions, connects producers to consumers, and tracks completion', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
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
  v.get('next').click();
  const firstBranch = [first, ...graph.edges.filter(e => e.to === first).map(e => e.from),
    ...graph.edges.filter(e => e.from === first).map(e => e.to)].sort();
  assert.deepEqual(doneIds(), [first]);
  assert.notDeepEqual(ring(), start);
  assert.match(v.get('map-count').textContent, /^1 \/ /);
  v.get('previous').click();
  assert.deepEqual(doneIds(), []);
  assert.match(v.get('map-count').textContent, /^0 \/ /);
  assert.deepEqual(ring(), start);
  v.key('ArrowRight');
  assert.deepEqual(doneIds(), [first]);
  v.get('map-button').click();
  assert.equal(v.get('graph-panel').hidden, false);
  assert.equal(v.get('overview').hidden, false);
  assert.deepEqual([...v.get('nodes').querySelectorAll('.done')].map(n => n.dataset.id).sort(), firstBranch);
  const selected = v.get('nodes').querySelector(`[data-id="${first}"]`);
  assert.match(selected.textContent, /✓ DONE/);
  v.panel('progress');
  assert.match(v.get('progress-list').children[0].textContent, /✓ Done/);
});

test('completing a jumped-to action includes transitive food and ordering prerequisites', t => {
  const v = viewer('beef-onion-stir-fry');
  t.after(() => v.dom.window.close());
  const graph = JSON.parse(v.get('recipe-data').textContent);
  const steps = JSON.parse(v.get('step-data').textContent);
  for (const node of graph.nodes.filter(n => n.type === 'action')) {
    for (const parent of node.dependsOn) {
      assert.ok(v.get('map-links').querySelector(`[data-from="${parent}"][data-to="${node.id}"]`));
    }
  }
  v.toggle();
  v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('button').click();
  assert.equal(v.get('map-nodes').querySelectorAll('.done').length, 0);
  v.key('ArrowRight');
  const done = id => v.get('map-nodes').querySelector(`[data-id="${id}"]`).classList.contains('done');
  for (const id of ['sear_beef','marinate_beef','mix_sauce','prep_onions','slice_beef','measure_onion']) {
    assert.equal(done(id), true, id);
  }
  for (const id of ['sear_onions','simmer_sauce','finish_dish']) assert.equal(done(id), false, id);
  v.key('ArrowLeft');
  assert.equal(v.get('map-nodes').querySelectorAll('.done').length, 0);
});

test('finishing the final action completes terminal food states', t => {
  const v = viewer('gyudon');
  t.after(() => v.dom.window.close());
  const steps = JSON.parse(v.get('step-data').textContent);
  for (let i = 1; i < steps.length; i++) v.get('next').click();
  assert.equal(v.get('next').disabled, false);
  assert.equal(v.get('next').textContent, 'Finish step');
  v.get('next').click();
  assert.equal(v.get('next').disabled, true);
  assert.equal(v.get('map-nodes').querySelectorAll(':not(.done)').length, 0);
  assert.equal(v.get('map-links').querySelectorAll(':not(.done)').length, 0);
  v.get('previous').click();
  assert.equal(v.get('next').disabled, false);
  assert.equal(v.get('next').textContent, 'Finish step');
  assert.equal(v.get('map-count').textContent, `${steps.length-1} / ${steps.length} done`);
});

test('both graphs flow down from their starting nodes to their final outputs', t => {
  const v = viewer();
  t.after(() => v.dom.window.close());
  const graph = JSON.parse(v.get('recipe-data').textContent);
  v.get('map-button').click();
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

test('rewinding restores earlier confirmations and clears inferred progress in all views', t => {
  const v = viewer('beef-onion-stir-fry');
  t.after(() => v.dom.window.close());
  const steps = JSON.parse(v.get('step-data').textContent);
  const marked = () => [...v.get('map-nodes').querySelectorAll('.done')].map(n => n.dataset.id);
  v.get('next').click();
  const firstBranch = marked();
  v.toggle();
  v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('button').click();
  v.get('next').click();
  v.get('map-button').click();
  assert.ok(v.get('nodes').querySelector('[data-id="sear_beef"]').classList.contains('done'));
  v.toggle();
  v.get('previous').click();
  assert.deepEqual(marked(), firstBranch);
  assert.deepEqual([...v.get('nodes').querySelectorAll('.done.action-node')].map(n => n.dataset.id), firstBranch);
  assert.equal(v.get('progress-list').children[steps.indexOf('sear_beef')].querySelector('.step-status').textContent, '');
  v.toggle();
  v.panel('progress');
  v.get('progress-list').children[0].querySelector('button').click();
  assert.deepEqual(marked(), []);
});
