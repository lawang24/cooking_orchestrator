import copy
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import compile_recipe
from visualize_recipe_graph import action_order, render_graph


class ScriptParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.current = {'attrs': dict(attrs), 'data': ''}
            self.scripts.append(self.current)

    def handle_data(self, data):
        if self.current is not None:
            self.current['data'] += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.current = None


class ViewerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipe = json.loads((ROOT / 'schemas/recipe.example.json').read_text())
        cls.graph = compile_recipe(cls.recipe)

    def test_embeds_all_data_and_offline_scripts(self):
        parser = ScriptParser()
        parser.feed(render_graph(self.graph))
        self.assertEqual(len(parser.scripts), 4)
        self.assertFalse(any('src' in script['attrs'] for script in parser.scripts))
        data = next(s for s in parser.scripts if s['attrs'].get('id') == 'recipe-data')
        self.assertEqual(json.loads(data['data']), self.graph)
        step_data = next(s for s in parser.scripts if s['attrs'].get('id') == 'step-data')
        self.assertEqual(json.loads(step_data['data']), action_order(self.graph))

    def test_untrusted_text_cannot_close_data_script(self):
        graph = copy.deepcopy(self.graph)
        graph['name'] = '</script><script>alert(1)</script> & RECIPE_GRAPH_DATA'
        parser = ScriptParser()
        parser.feed(render_graph(graph))
        self.assertEqual(len(parser.scripts), 4)
        data = next(s for s in parser.scripts if s['attrs'].get('id') == 'recipe-data')
        self.assertEqual(json.loads(data['data'])['name'], graph['name'])

    def test_step_data_escapes_action_ids_from_a_compiled_meal(self):
        graph = copy.deepcopy(self.graph)
        # Direct callers may supply graphs with arbitrary action IDs.
        action_id = '</script><script>meal-slice_beef'
        next(n for n in graph['nodes'] if n['id'] == 'slice_beef')['id'] = action_id
        for edge in graph['edges']:
            for endpoint in ('from', 'to'):
                if edge[endpoint] == 'slice_beef':
                    edge[endpoint] = action_id
        parser = ScriptParser()
        parser.feed(render_graph(graph))
        self.assertEqual(len(parser.scripts), 4)
        steps = next(s for s in parser.scripts if s['attrs'].get('id') == 'step-data')
        self.assertIn(action_id, json.loads(steps['data']))

    def test_rejects_dependency_cycle(self):
        graph = copy.deepcopy(self.graph)
        next(n for n in graph['nodes'] if n['id'] == 'slice_beef')['dependsOn'] = ['finish_dish']
        with self.assertRaisesRegex(ValueError, 'Cycle detected'):
            render_graph(graph)

    def test_walkthrough_visits_every_action_once(self):
        for path in (ROOT / 'recipes').glob('*.recipe.json'):
            graph = compile_recipe(json.loads(path.read_text()))
            with self.subTest(recipe=graph['recipeId']):
                ordered = action_order(graph)
                expected = {n['id'] for n in graph['nodes'] if n['type'] == 'action'}
                self.assertEqual(set(ordered), expected)
                self.assertEqual(len(ordered), len(expected))
                self.assertEqual(ordered, action_order(graph))

    def test_dependencies_override_reverse_source_order(self):
        graph = copy.deepcopy(self.graph)
        graph['nodes'].reverse()
        ordered = action_order(graph)
        # These dependencies must survive deliberately adversarial array order.
        for prerequisite, action in [
            ('slice_beef', 'mix_marinade'),
            ('mix_marinade', 'marinate_beef'),
            ('marinate_beef', 'sear_beef'),
            ('prep_onions', 'sear_beef'),
            ('mix_sauce', 'sear_beef'),
            ('sear_beef', 'sear_onions'),
            ('sear_onions', 'simmer_sauce'),
            ('simmer_sauce', 'finish_dish'),
        ]:
            self.assertLess(ordered.index(prerequisite), ordered.index(action))
        self.assertEqual(ordered[-1], 'finish_dish')

    def test_all_three_gyudon_branches_precede_assembly(self):
        graph = compile_recipe(json.loads((ROOT / 'recipes/gyudon.recipe.json').read_text()))
        ordered = action_order(graph)
        for prerequisite in ['check_seasoning', 'fry_eggs', 'portion_rice', 'chop_scallion']:
            self.assertLess(ordered.index(prerequisite), ordered.index('assemble_bowls'))
        self.assertLess(ordered.index('measure_onion'), ordered.index('slice_onions'))

    def test_supports_another_recipe(self):
        graph = copy.deepcopy(self.graph)
        graph.update(recipeId='simple-onion', name='Simple onion', outputs=['wedges'])
        graph['nodes'] = [
            {'id': 'onion', 'type': 'ingredient', 'name': 'Onion', 'quantity': 1, 'unit': 'whole'},
            {'id': 'measure', 'type': 'action', 'operation': 'measure', 'instruction': 'Count one onion.',
             'scheduled_duration_seconds': 10,
             'scheduled_duration_source': 'estimate',
             'attention': 'active', 'cooksRequired': 1, 'equipment': [], 'dependsOn': []},
            {'id': 'measured_onion', 'type': 'food_state', 'name': 'Onion for wedges',
             'ingredient': 'onion', 'quantity': 1, 'unit': 'whole'},
            {'id': 'cut', 'type': 'action', 'operation': 'cut', 'instruction': 'Cut into wedges.',
             'scheduled_duration_seconds': 90,
             'scheduled_duration_source': 'estimate',
             'attention': 'active', 'cooksRequired': 1, 'equipment': ['knife'], 'dependsOn': []},
            {'id': 'wedges', 'type': 'food_state', 'name': 'Onion wedges'},
        ]
        graph['edges'] = [{'from': 'onion', 'to': 'measure'}, {'from': 'measure', 'to': 'measured_onion'},
                          {'from': 'measured_onion', 'to': 'cut'}, {'from': 'cut', 'to': 'wedges'}]
        document = render_graph(graph)
        self.assertIn('simple-onion', document)
        self.assertNotIn('slice_beef', document)

    def test_cli_writes_output_and_preserves_it_on_invalid_input(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / 'input.json', Path(folder) / 'nested' / 'output.html'
            source.write_text(json.dumps(self.recipe))
            command = [sys.executable, str(ROOT / 'scripts/visualize_recipe_graph.py'), str(source), '-o', str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            original = output.read_bytes()
            source.write_text('{}')
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), original)

    def test_cli_cannot_overwrite_input(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'input.json'
            source.write_text(json.dumps(self.recipe))
            original = source.read_bytes()
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/visualize_recipe_graph.py'), str(source), '-o', str(source)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
