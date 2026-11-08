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
from merge_recipe_graphs import merge_recipe_graphs, make_measure_action
from validate_recipe_graph import validate_graph
from visualize_recipe_graph import action_order, render_graph


def recipe(quantity=1, unit='tbsp', identity='neutral_oil'):
    return {
        'schemaVersion': '1.0', 'recipeId': 'dish', 'name': 'Dish', 'servings': 2,
        'notes': [], 'outputs': ['finished'],
        'ingredients': {identity: {'name': 'Oil', 'quantity': quantity, 'unit': unit}},
        'steps': [{
            **{k: v for k, v in make_measure_action(
                'measure_' + identity, 'Oil', [{'quantity': quantity, 'unit': unit}]
            ).items() if k != 'type'},
            'inputs': [identity],
            'outputs': [{'id': 'portion', 'name': 'Oil for cooking',
                         'ingredient': identity, 'quantity': quantity, 'unit': unit}],
        }, {
            'id': 'cook', 'operation': 'fry', 'instruction': 'Cook the portion.',
            'scheduled_duration_seconds': 60,
            'scheduled_duration_source': 'source',
            'attention': 'active', 'cooksRequired': 1, 'equipment': ['pan'],
            'inputs': ['portion'], 'outputs': [{'id': 'finished', 'name': 'Finished dish'}],
        }],
    }


class MealGraphTests(unittest.TestCase):
    def test_merges_compiled_measurements_preserving_portions_and_inputs(self):
        first, second = compile_recipe(recipe()), compile_recipe(recipe(3, 'tsp'))
        original = copy.deepcopy([first, second])
        meal = merge_recipe_graphs([('a', first), ('b', second)])
        self.assertEqual([first, second], original)
        self.assertEqual(validate_graph(meal), [])
        nodes = {node['id']: node for node in meal['nodes']}
        ingredients = [node for node in nodes.values() if node['type'] == 'ingredient']
        self.assertEqual(len(ingredients), 1)
        self.assertEqual((ingredients[0]['quantity'], ingredients[0]['unit']), (6, 'tsp'))
        measures = [node for node in nodes.values() if node.get('operation') == 'measure']
        self.assertEqual(len(measures), 1)
        self.assertEqual(measures[0]['scheduled_duration_seconds'], 45)
        for tag in ('a', 'b'):
            self.assertIn({'from': measures[0]['id'], 'to': f'{tag}-portion'}, meal['edges'])
            self.assertIn({'from': f'{tag}-portion', 'to': f'{tag}-cook'}, meal['edges'])
            self.assertEqual(nodes[f'{tag}-portion']['ingredient'], 'neutral_oil')
        self.assertEqual(nodes['a-portion']['quantity'], 1)
        self.assertEqual(nodes['b-portion']['quantity'], 3)
        self.assertEqual(meal['outputs'], ['a-finished', 'b-finished'])
        self.assertNotIn('servings', meal)
        self.assertEqual([component['servings'] for component in meal['recipes']], [2, 2])
        self.assertEqual(len(action_order(meal)), 3)
        self.assertIn('a-finished', render_graph(meal))

    def test_preserves_incompatible_units_and_distinct_identities(self):
        for other in (recipe(1, 'g'), recipe(identity='sesame_oil')):
            with self.subTest(other=other['ingredients']):
                meal = merge_recipe_graphs([('a', compile_recipe(recipe())), ('b', compile_recipe(other))])
                self.assertEqual(len([n for n in meal['nodes'] if n['type'] == 'ingredient']), 2)
                self.assertEqual(len([n for n in meal['nodes'] if n.get('operation') == 'measure']), 2)
                self.assertEqual(validate_graph(meal), [])

    def test_merged_measurements_preserve_precision_across_weight_units(self):
        meal = merge_recipe_graphs([
            ('a', compile_recipe(recipe(1, 'oz'))),
            ('b', compile_recipe(recipe(1, 'g'))),
        ])
        ingredient = next(n for n in meal['nodes'] if n['type'] == 'ingredient')
        self.assertAlmostEqual(ingredient['quantity'], 29.349523125)
        self.assertEqual(ingredient['unit'], 'g')
        self.assertEqual(validate_graph(meal), [])

    def test_measurements_edited_after_compilation_remain_separate(self):
        for override in ({'scheduled_duration_seconds': 99},
                         {'instruction': 'Measure carefully until the scale stabilizes.'},
                         {'scheduled_duration_source': 'source'},
                         {'equipment': ['special_scale']}):
            with self.subTest(override=override):
                compiled = compile_recipe(recipe())
                next(n for n in compiled['nodes'] if n['id'] == 'measure_neutral_oil').update(override)
                meal = merge_recipe_graphs([('a', compile_recipe(recipe())), ('b', compiled)])
                actions = [n for n in meal['nodes'] if n.get('operation') == 'measure']
                self.assertEqual(len(actions), 2)
                custom_action = next(n for n in actions if n['id'] == 'b-measure_neutral_oil')
                for key, value in override.items():
                    self.assertEqual(custom_action[key], value)
                self.assertEqual(validate_graph(meal), [])

    def test_authored_custom_measurements_are_not_overwritten_by_batching(self):
        custom = recipe()
        custom['steps'][0].update(instruction='Measure oil for the pan carefully.',
                                  scheduled_duration_seconds=90,
                                  scheduled_duration_source='source')
        meal = merge_recipe_graphs([('a', compile_recipe(recipe())), ('b', compile_recipe(custom))])
        measures = [n for n in meal['nodes'] if n.get('operation') == 'measure']
        self.assertEqual(len(measures), 2)
        authored = next(n for n in measures if n['id'] == 'b-measure_neutral_oil')
        self.assertEqual(authored['instruction'], custom['steps'][0]['instruction'])
        for key in ('scheduled_duration_seconds', 'scheduled_duration_source'):
            self.assertEqual(authored[key], custom['steps'][0][key])

    def test_namespaces_all_food_and_ordering_references(self):
        compiled = compile_recipe(json.loads((ROOT / 'schemas/recipe.example.json').read_text()))
        meal = merge_recipe_graphs([('a', compiled), ('b', compiled)])
        nodes = {node['id']: node for node in meal['nodes']}
        for tag in ('a', 'b'):
            self.assertEqual(nodes[f'{tag}-sear_onions']['dependsOn'], [f'{tag}-sear_beef'])
            self.assertIn({'from': f'{tag}-marinated_beef', 'to': f'{tag}-sear_beef'}, meal['edges'])
        original_cooking = [n for n in compiled['nodes'] if n['type'] == 'action' and n['operation'] != 'measure']
        meal_cooking = [n for n in nodes.values() if n['type'] == 'action' and n['operation'] != 'measure']
        self.assertEqual(len(meal_cooking), 2 * len(original_cooking))
        self.assertEqual(validate_graph(meal), [])

    def test_redirects_prerequisites_that_reference_merged_measurements(self):
        compiled = compile_recipe(recipe())
        next(n for n in compiled['nodes'] if n['id'] == 'cook')['dependsOn'] = ['measure_neutral_oil']
        meal = merge_recipe_graphs([('a', compiled), ('b', compiled)])
        action = next(n for n in meal['nodes'] if n['id'] == 'b-cook')
        self.assertEqual(action['dependsOn'], ['a-measure_neutral_oil'])
        self.assertEqual(validate_graph(meal), [])

    def test_rejects_invalid_graphs_and_ambiguous_tags(self):
        compiled = compile_recipe(recipe())
        for tagged in ([], [('a', compiled), ('a', compiled)], [('a-b', compiled)], [('../x', compiled)]):
            with self.subTest(tags=[tag for tag, _ in tagged]):
                with self.assertRaises(ValueError):
                    merge_recipe_graphs(tagged)
        broken = copy.deepcopy(compiled)
        broken['edges'][0]['to'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Invalid graph b'):
            merge_recipe_graphs([('a', compiled), ('b', broken)])
        meal = merge_recipe_graphs([('a', compiled)])
        with self.assertRaisesRegex(ValueError, 'single-recipe'):
            merge_recipe_graphs([('meal', meal)])

    def test_cli_combines_beef_and_gyudon_despite_incompatible_onion_units(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([
                sys.executable, str(ROOT / 'experiments/meal-merge/merge_recipes.py'),
                f'beef={ROOT / "recipes/beef-onion-stir-fry.recipe.json"}',
                f'gyudon={ROOT / "recipes/gyudon.recipe.json"}', '-o', folder,
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            graph = json.loads((Path(folder) / 'meal-beef-gyudon.graph.json').read_text())
            self.assertEqual(validate_graph(graph), [])
            onions = [n for n in graph['nodes'] if n['type'] == 'ingredient' and n['id'].endswith('-onion')]
            self.assertEqual({n['unit'] for n in onions}, {'oz', 'whole'})
            self.assertTrue((Path(folder) / 'meal-beef-gyudon.html').exists())


if __name__ == '__main__':
    unittest.main()
