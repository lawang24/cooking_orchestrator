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
from visualize_recipe_graph import render_graph
from compile_recipe import compile_recipe


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
        self.assertEqual(len(parser.scripts), 3)
        self.assertFalse(any('src' in script['attrs'] for script in parser.scripts))
        data = next(s for s in parser.scripts if s['attrs'].get('id') == 'recipe-data')
        self.assertEqual(json.loads(data['data']), self.graph)

    def test_untrusted_text_cannot_close_data_script(self):
        graph = copy.deepcopy(self.graph)
        graph['name'] = '</script><script>alert(1)</script> & RECIPE_GRAPH_DATA'
        parser = ScriptParser()
        parser.feed(render_graph(graph))
        self.assertEqual(len(parser.scripts), 3)
        data = next(s for s in parser.scripts if s['attrs'].get('id') == 'recipe-data')
        self.assertEqual(json.loads(data['data'])['name'], graph['name'])

    def test_rejects_dependency_cycle(self):
        graph = copy.deepcopy(self.graph)
        next(n for n in graph['nodes'] if n['id'] == 'slice_beef')['dependsOn'] = ['finish_dish']
        with self.assertRaisesRegex(ValueError, 'Cycle detected'):
            render_graph(graph)

    def test_supports_another_recipe(self):
        graph = copy.deepcopy(self.graph)
        graph.update(recipeId='simple-onion', name='Simple onion', outputs=['wedges'])
        graph['nodes'] = [
            {'id': 'onion', 'type': 'ingredient', 'name': 'Onion', 'quantity': 1, 'unit': 'whole'},
            {'id': 'cut', 'type': 'action', 'instruction': 'Cut into wedges.',
             'duration': {'plannedSeconds': 90, 'basis': 'estimate', 'note': 'Prep estimate.'},
             'attention': 'active', 'cooksRequired': 1, 'equipment': ['knife'], 'dependsOn': []},
            {'id': 'wedges', 'type': 'food_state', 'name': 'Onion wedges'},
        ]
        graph['edges'] = [{'from': 'onion', 'to': 'cut'}, {'from': 'cut', 'to': 'wedges'}]
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
