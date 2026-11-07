import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import compile_recipe


class CompilerTests(unittest.TestCase):
    def setUp(self):
        self.recipe = json.loads((ROOT / 'schemas/recipe.example.json').read_text())

    def step(self, id):
        return next(step for step in self.recipe['steps'] if step['id'] == id)

    def test_one_measure_action_per_ingredient_produces_its_portions(self):
        original = copy.deepcopy(self.recipe)
        graph = compile_recipe(self.recipe)
        self.assertEqual(self.recipe, original)
        self.assertEqual(len(graph['nodes']), 58)
        self.assertEqual(len(graph['edges']), 61)
        by_id = {node['id']: node for node in graph['nodes']}
        edges = {(edge['from'], edge['to']) for edge in graph['edges']}
        for id, ingredient in self.recipe['ingredients'].items():
            self.assertEqual(by_id[id]['type'], 'ingredient')
            self.assertIn((id, 'measure_' + id), edges)
            for portion_id, portion in ingredient['portions'].items():
                self.assertIn(('measure_' + id, portion_id), edges)
                self.assertEqual(by_id[portion_id]['ingredient'], id)
                self.assertEqual(by_id[portion_id]['quantity'], portion['quantity'])
                self.assertEqual(by_id[portion_id]['unit'], portion['unit'])
        measures = [node for node in graph['nodes'] if node.get('operation') == 'measure']
        self.assertEqual(len(measures), len(self.recipe['ingredients']))
        self.assertEqual(by_id['measure_water']['equipment'], ['measuring_spoons', 'measuring_cup'])
        self.assertEqual(by_id['measure_water']['duration']['plannedSeconds'], 45)
        self.assertEqual(by_id['measure_flank_steak']['equipment'], ['kitchen_scale'])
        self.assertEqual((by_id['water']['quantity'], by_id['water']['unit']), (5, 'tbsp'))
        self.assertEqual((by_id['neutral_oil']['quantity'], by_id['neutral_oil']['unit']), (7, 'tsp'))
        self.assertEqual(by_id['sauce_ketchup']['name'], 'Ketchup (2 tsp)')
        self.assertIn(('sauce_light_soy', 'mix_sauce'), edges)
        self.assertIn(('marinade_oyster_sauce', 'mix_marinade'), edges)
        self.assertEqual(by_id['sear_beef']['dependsOn'], ['prep_onions', 'mix_sauce'])
        self.assertEqual(by_id['sear_onions']['dependsOn'], ['sear_beef'])
        self.assertEqual(by_id['simmer_sauce']['dependsOn'], ['sear_onions'])
        self.assertEqual(by_id['marinate_beef']['duration']['maximumSeconds'], 1800)
        self.assertEqual(graph['outputs'], ['finished_stir_fry'])

    def test_step_order_does_not_define_dependencies(self):
        graph = compile_recipe(self.recipe)
        self.recipe['steps'].reverse()
        reordered = compile_recipe(self.recipe)
        self.assertEqual({n['id']: n for n in graph['nodes']},
                         {n['id']: n for n in reordered['nodes']})
        self.assertEqual({(e['from'], e['to']) for e in graph['edges']},
                         {(e['from'], e['to']) for e in reordered['edges']})

    def test_measure_overrides_replace_generated_defaults(self):
        duration = {'plannedSeconds': 60, 'basis': 'estimate', 'note': 'Weighing whole onions.'}
        self.recipe['ingredients']['onion']['measure'] = {'duration': duration, 'equipment': []}
        by_id = {node['id']: node for node in compile_recipe(self.recipe)['nodes']}
        self.assertEqual(by_id['measure_onion']['duration'], duration)
        self.assertEqual(by_id['measure_onion']['equipment'], [])

    def test_rejects_portions_mixing_volume_and_weight(self):
        self.recipe['ingredients']['water']['portions']['sauce_water']['unit'] = 'g'
        with self.assertRaisesRegex(ValueError, 'volumes, weights, or whole counts'):
            compile_recipe(self.recipe)

    def test_rejects_authored_measure_step(self):
        self.step('slice_beef')['operation'] = 'measure'
        with self.assertRaisesRegex(ValueError, 'operation'):
            compile_recipe(self.recipe)

    def test_rejects_portion_without_quantity(self):
        del self.recipe['ingredients']['flank_steak']['portions']['beef']['quantity']
        with self.assertRaisesRegex(ValueError, 'quantity'):
            compile_recipe(self.recipe)

    def test_rejects_duplicate_ids_across_steps_and_ingredients(self):
        self.step('slice_beef')['id'] = 'beef'
        with self.assertRaisesRegex(ValueError, 'IDs must be unique'):
            compile_recipe(self.recipe)

    def test_rejects_unknown_input(self):
        self.step('slice_beef')['inputs'] = ['missing_beef']
        with self.assertRaisesRegex(ValueError, 'Unknown edge endpoint'):
            compile_recipe(self.recipe)

    def test_rejects_cycles(self):
        self.step('slice_beef')['dependsOn'] = ['finish_dish']
        with self.assertRaisesRegex(ValueError, 'Cycle detected'):
            compile_recipe(self.recipe)

    def test_rejects_reusing_one_portion_twice(self):
        self.step('mix_sauce')['inputs'].append('marinade_oyster_sauce')
        with self.assertRaisesRegex(ValueError, 'split portions explicitly'):
            compile_recipe(self.recipe)

    def test_supports_multiple_outputs_from_a_step(self):
        self.step('finish_dish')['outputs'].append({'id': 'leftovers', 'name': 'Leftover portion'})
        self.recipe['outputs'].append('leftovers')
        graph = compile_recipe(self.recipe)
        self.assertIn({'from': 'finish_dish', 'to': 'leftovers'}, graph['edges'])

    def test_cli_writes_graph_and_preserves_files_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / 'recipe.json', Path(folder) / 'graph.json'
            source.write_text(json.dumps(self.recipe))
            command = [sys.executable, str(ROOT / 'scripts/compile_recipe.py'), str(source), '-o']
            result = subprocess.run(command + [str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text()), compile_recipe(self.recipe))
            original_source = source.read_bytes()
            result = subprocess.run(command + [str(source)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_bytes(), original_source)
            original_output = output.read_bytes()
            source.write_text('{}')
            result = subprocess.run(command + [str(output)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), original_output)


if __name__ == '__main__':
    unittest.main()
