import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import compile_recipe
from recipe_viewer_data import action_order, compile_recipe_json


class BrowserBridgeTests(unittest.TestCase):
    def test_browser_bridge_matches_cli_for_every_recipe(self):
        for path in (ROOT / 'recipes').glob('*.recipe.json'):
            with self.subTest(recipe=path.name):
                text = path.read_text()
                graph = compile_recipe(json.loads(text))
                result = json.loads(compile_recipe_json(text))
                self.assertEqual(result, {'ok': True, 'data': {'graph': graph, 'steps': action_order(graph)}})

    def test_syntax_schema_and_nonfinite_errors_are_returned_as_data(self):
        for text in ['not JSON', '{}', '[]', 'null', '{"quantity": NaN}', '{"quantity": 1e999}']:
            with self.subTest(text=text):
                result = json.loads(compile_recipe_json(text))
                self.assertFalse(result['ok'])
                self.assertTrue(result['error'])
                self.assertNotIn('Traceback', result['error'])

    def test_rejects_bad_allocations_and_cycles(self):
        recipe = json.loads((ROOT / 'schemas/recipe.example.json').read_text())
        incorrect = copy.deepcopy(recipe)
        incorrect['ingredients']['water']['quantity'] += 1
        result = json.loads(compile_recipe_json(json.dumps(incorrect)))
        self.assertFalse(result['ok'])
        self.assertIn('add up', result['error'])
        incorrect = copy.deepcopy(recipe)
        next(step for step in incorrect['steps'] if step['id'] == 'slice_beef')['dependsOn'] = ['finish_dish']
        result = json.loads(compile_recipe_json(json.dumps(incorrect)))
        self.assertFalse(result['ok'])
        self.assertIn('Cycle detected', result['error'])

    def test_recipe_text_is_never_executed(self):
        recipe = json.loads((ROOT / 'schemas/recipe.example.json').read_text())
        recipe['name'] = '\"); __import__("sys").exit(42) # </script> 🍳'
        result = json.loads(compile_recipe_json(json.dumps(recipe)))
        self.assertTrue(result['ok'])
        self.assertEqual(result['data']['graph']['name'], recipe['name'])


if __name__ == '__main__':
    unittest.main()
