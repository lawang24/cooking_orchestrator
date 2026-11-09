import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import build_graph, compile_recipe, validate_schema
from validate_recipe_graph import validate_graph


class CompilerTests(unittest.TestCase):
    def setUp(self):
        self.recipe = json.loads((ROOT / 'schemas/recipe.example.json').read_text())

    def step(self, id):
        return next(step for step in self.recipe['steps'] if step['id'] == id)

    def test_explicit_measurements_preserve_totals_portions_and_actions(self):
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
            self.assertEqual(by_id[id]['quantity'], ingredient['quantity'])
            self.assertEqual(by_id[id]['unit'], ingredient['unit'])
            for portion in self.step('measure_' + id)['outputs']:
                portion_id = portion['id']
                self.assertIn(('measure_' + id, portion_id), edges)
                self.assertEqual(by_id[portion_id]['ingredient'], id)
                self.assertEqual(by_id[portion_id]['quantity'], portion['quantity'])
                self.assertEqual(by_id[portion_id]['unit'], portion['unit'])
        measures = [node for node in graph['nodes'] if node.get('operation') == 'measure']
        self.assertEqual(len(measures), len(self.recipe['ingredients']))
        self.assertEqual(by_id['measure_water']['equipment'], ['measuring_spoons', 'measuring_cup'])
        self.assertEqual(by_id['measure_water']['scheduled_duration_seconds'], 45)
        self.assertEqual(by_id['measure_flank_steak']['equipment'], ['kitchen_scale'])
        self.assertEqual((by_id['water']['quantity'], by_id['water']['unit']), (5, 'tbsp'))
        self.assertEqual((by_id['neutral_oil']['quantity'], by_id['neutral_oil']['unit']), (7, 'tsp'))
        self.assertEqual(by_id['sauce_ketchup']['name'], 'Ketchup (2 tsp)')
        self.assertIn(('sauce_light_soy', 'mix_sauce'), edges)
        self.assertIn(('marinade_oyster_sauce', 'mix_marinade'), edges)
        self.assertEqual(by_id['sear_beef']['dependsOn'], ['prep_onions', 'mix_sauce'])
        self.assertEqual(by_id['sear_onions']['dependsOn'], ['sear_beef'])
        self.assertEqual(by_id['simmer_sauce']['dependsOn'], ['sear_onions'])
        self.assertEqual(by_id['marinate_beef']['instruction'], 'Marinate the coated beef for 15–30 minutes.')
        self.assertEqual(graph['outputs'], ['finished_stir_fry'])

    def test_step_order_does_not_define_dependencies(self):
        graph = compile_recipe(self.recipe)
        self.recipe['steps'].reverse()
        reordered = compile_recipe(self.recipe)
        self.assertEqual({n['id']: n for n in graph['nodes']},
                         {n['id']: n for n in reordered['nodes']})
        self.assertEqual({(e['from'], e['to']) for e in graph['edges']},
                         {(e['from'], e['to']) for e in reordered['edges']})

    def test_timing_preserves_scheduled_seconds_and_source(self):
        step = self.step('sear_beef')
        for source in ('source', 'estimate'):
            with self.subTest(source=source):
                step.update(scheduled_duration_seconds=120, scheduled_duration_source=source)
                graph = compile_recipe(self.recipe)
                action = next(n for n in graph['nodes'] if n['id'] == step['id'])
                self.assertEqual(action['scheduled_duration_seconds'], 120)
                self.assertNotIn('duration_text', action)
                self.assertEqual(action['scheduled_duration_source'], source)
                self.assertNotIn('duration', action)

    def test_requires_valid_flat_timing_fields(self):
        step = self.step('sear_beef')
        for key, invalid_values in {
            'scheduled_duration_seconds': [0, -1, 1.5, True, '120', None],
            'scheduled_duration_source': ['unknown', '', None],
        }.items():
            original = step[key]
            for value in invalid_values:
                with self.subTest(field=key, value=value):
                    step[key] = value
                    with self.assertRaisesRegex(ValueError, key):
                        compile_recipe(self.recipe)
            del step[key]
            with self.assertRaisesRegex(ValueError, key):
                compile_recipe(self.recipe)
            step[key] = original

    def test_rejects_removed_duration_text(self):
        self.step('sear_beef')['duration_text'] = 'Allow time to heat the wok.'
        with self.assertRaisesRegex(ValueError, 'Additional properties.*duration_text'):
            compile_recipe(self.recipe)

    def test_rejects_removed_nested_duration(self):
        self.step('sear_beef')['duration'] = {'plannedSeconds': 120, 'basis': 'source'}
        with self.assertRaisesRegex(ValueError, 'Additional properties.*duration'):
            compile_recipe(self.recipe)

    def test_recipe_compiles_without_source_metadata(self):
        self.assertNotIn('source', self.recipe)
        graph = compile_recipe(self.recipe)
        self.assertNotIn('source', graph)
        marination = next(node for node in graph['nodes'] if node['id'] == 'marinate_beef')
        self.assertEqual(marination['scheduled_duration_source'], 'source')

    def test_rejects_removed_source_metadata(self):
        self.recipe['source'] = {'url': 'https://example.com', 'publisher': 'Example', 'author': 'Cook'}
        with self.assertRaisesRegex(ValueError, 'Additional properties.*source'):
            compile_recipe(self.recipe)

    def test_rejects_invalid_input_types_through_schema_validation(self):
        for invalid in (None, [], 'recipe', 42, object()):
            with self.subTest(input=invalid):
                with self.assertRaisesRegex(ValueError, r'Invalid recipe:\n\$: .* is not of type'):
                    compile_recipe(invalid)

        self.recipe['servings'] = object()
        with self.assertRaisesRegex(ValueError, r'\$\.servings: .* is not of type'):
            compile_recipe(self.recipe)

    def test_rejects_removed_measure_overrides(self):
        duration = {'plannedSeconds': 60, 'basis': 'estimate', 'note': 'Weighing whole onions.'}
        for measure in ({}, {'duration': duration}, {'equipment': []},
                        {'duration': duration, 'equipment': []}):
            with self.subTest(measure=measure):
                self.recipe['ingredients']['onion']['measure'] = measure
                with self.assertRaisesRegex(ValueError, 'Additional properties.*measure'):
                    compile_recipe(self.recipe)

    def test_preserves_authored_measurement_details_and_arbitrary_id(self):
        measure = self.step('measure_flank_steak')
        measure.update(id='weigh_beef', instruction='Weigh beef for slicing.',
                       scheduled_duration_seconds=75,
                       scheduled_duration_source='source',
                       equipment=['custom_scale'], dependsOn=['measure_onion'])
        graph = compile_recipe(self.recipe)
        actions = {n['id']: n for n in graph['nodes'] if n['type'] == 'action'}
        self.assertEqual(set(actions), {s['id'] for s in self.recipe['steps']})
        for key in ('instruction', 'scheduled_duration_seconds',
                    'scheduled_duration_source', 'equipment', 'dependsOn'):
            self.assertEqual(actions['weigh_beef'][key], measure[key])
        self.assertNotIn('measure_flank_steak', actions)

    def test_rejects_legacy_ingredient_portions(self):
        self.recipe['ingredients']['onion'] = {
            'name': 'Onion', 'portions': {'onions': {'quantity': 10, 'unit': 'oz'}}}
        with self.assertRaisesRegex(ValueError, 'Additional properties.*portions'):
            compile_recipe(self.recipe)

    def test_rejects_missing_measurement_and_direct_prep(self):
        self.recipe['steps'].remove(self.step('measure_flank_steak'))
        self.step('slice_beef')['inputs'] = ['flank_steak']
        with self.assertRaisesRegex(ValueError, 'explicit measure action'):
            compile_recipe(self.recipe)

    def test_rejects_measurement_units_mixing_volume_and_weight(self):
        self.step('measure_water')['outputs'][1]['unit'] = 'g'
        with self.assertRaisesRegex(ValueError, 'compatible volumes, weights, or whole counts'):
            compile_recipe(self.recipe)

    def test_rejects_measurement_totals_that_do_not_balance(self):
        for quantity in (4, 6):
            with self.subTest(quantity=quantity):
                self.recipe['ingredients']['water']['quantity'] = quantity
                with self.assertRaisesRegex(ValueError, 'add up to the input quantity'):
                    compile_recipe(self.recipe)

    def test_accepts_compatible_unit_conversions_without_changing_declared_total(self):
        self.recipe['ingredients']['water'].update(quantity=0.3125, unit='cup')
        graph = compile_recipe(self.recipe)
        water = next(n for n in graph['nodes'] if n['id'] == 'water')
        self.assertEqual((water['quantity'], water['unit']), (0.3125, 'cup'))

    def test_rejects_measurement_identity_change(self):
        self.step('measure_water')['outputs'][1]['ingredient'] = 'neutral_oil'
        with self.assertRaisesRegex(ValueError, 'retain the input ingredient identity'):
            compile_recipe(self.recipe)

    def test_rejects_unquantified_measurement_output(self):
        output = self.step('measure_water')['outputs'][0]
        for key in ('ingredient', 'quantity', 'unit'):
            del output[key]
        with self.assertRaisesRegex(ValueError, 'required property'):
            compile_recipe(self.recipe)

    def test_rejects_missing_or_nonpositive_ingredient_total(self):
        ingredient = self.recipe['ingredients']['water']
        for value in (0, -1, None):
            with self.subTest(value=value):
                ingredient['quantity'] = value
                with self.assertRaisesRegex(ValueError, 'quantity'):
                    compile_recipe(self.recipe)
        del ingredient['quantity']
        with self.assertRaisesRegex(ValueError, 'quantity'):
            compile_recipe(self.recipe)

    def test_rejects_passive_measurement(self):
        self.step('measure_water').update(attention='passive', cooksRequired=0)
        with self.assertRaisesRegex(ValueError, 'active'):
            compile_recipe(self.recipe)

    def test_rejects_measurement_with_multiple_inputs(self):
        self.step('measure_water')['inputs'].append('neutral_oil')
        with self.assertRaises(ValueError):
            compile_recipe(self.recipe)

    def test_can_subdivide_a_quantified_food_state(self):
        measure = self.step('measure_water')
        split = copy.deepcopy(measure)
        split.update(id='divide_water', inputs=['measured_water'])
        measure['outputs'] = [{'id': 'measured_water', 'name': 'Measured water',
                               'ingredient': 'water', 'quantity': 5, 'unit': 'tbsp'}]
        self.recipe['steps'].append(split)
        graph = compile_recipe(self.recipe)
        self.assertIn({'from': 'measured_water', 'to': 'divide_water'}, graph['edges'])
        measure['outputs'][0]['quantity'] = 6
        with self.assertRaisesRegex(ValueError, 'add up to the input quantity'):
            compile_recipe(self.recipe)

    def test_rejects_duplicate_ids_across_steps_and_ingredients(self):
        self.step('slice_beef')['id'] = 'beef'
        with self.assertRaisesRegex(ValueError, 'IDs must be unique'):
            compile_recipe(self.recipe)

    def test_rejects_unknown_input(self):
        self.step('slice_beef')['inputs'] = ['missing_beef']
        with self.assertRaisesRegex(ValueError, 'Unknown edge endpoint'):
            compile_recipe(self.recipe)

    def test_graph_construction_leaves_semantic_checks_to_validation(self):
        self.step('slice_beef')['inputs'] = ['missing_beef']
        graph = build_graph(validate_schema(self.recipe))
        self.assertIn({'from': 'missing_beef', 'to': 'slice_beef'}, graph['edges'])
        self.assertIn('Unknown edge endpoint: missing_beef -> slice_beef.',
                      validate_graph(graph))

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
