"""Validate step-oriented recipe input and compile it into a dependency graph."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator, FormatChecker

from validate_recipe_graph import validate_graph


SCHEMA_PATH = Path(__file__).resolve().parents[1] / 'schemas/recipe.schema.json'
# Units of one kind convert to a common base so portions can be totaled.
UNIT_SCALES = (
    {'tsp': 1, 'tbsp': 3, 'cup': 48, 'ml': 1 / 4.92892159375, 'l': 1000 / 4.92892159375},
    {'g': 1, 'kg': 1000, 'oz': 28.349523125, 'lb': 453.59237},
    {'whole': 1},
)
MEASURING_EQUIPMENT = {
    'tsp': 'measuring_spoons', 'tbsp': 'measuring_spoons',
    'cup': 'measuring_cup', 'ml': 'measuring_cup', 'l': 'measuring_cup',
    'g': 'kitchen_scale', 'kg': 'kitchen_scale', 'oz': 'kitchen_scale', 'lb': 'kitchen_scale',
}


def compile_recipe(recipe):
    """Return a validated graph without mutating the input; raise on invalid input.

    IDs are local to one recipe. Array order carries no scheduling constraint.
    Each ingredient gets one generated measure action producing its portions;
    authored steps are never batched.
    """
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = [f'{error.json_path}: {error.message}' for error in validator.iter_errors(recipe)]
    if errors:
        raise ValueError('Invalid recipe:\n' + '\n'.join(errors))
    return build_graph(recipe)


def build_graph(recipe):
    """Build and validate the graph for schema-valid recipe input; raise on invalid graphs."""
    errors = []
    graph = {key: deepcopy(value) for key, value in recipe.items()
             if key not in ('$schema', 'ingredients', 'steps')}
    graph['nodes'] = []
    graph['edges'] = []
    for id, ingredient in recipe['ingredients'].items():
        portions = ingredient['portions']
        units = {portion['unit'] for portion in portions.values()}
        scale = next((scale for scale in UNIT_SCALES if units <= scale.keys()), None)
        if scale is None:
            errors.append(f'{id}: portions must all be volumes, weights, or whole counts.')
            continue
        unit = min(units, key=scale.get)
        total = round(sum(p['quantity'] * scale[p['unit']] for p in portions.values()) / scale[unit], 3)
        graph['nodes'].append({'id': id, 'type': 'ingredient', 'name': ingredient['name'],
                               'quantity': int(total) if total.is_integer() else total, 'unit': unit})

        amounts = [f"{portion['quantity']:g} {portion['unit']}" for portion in portions.values()]
        overrides = ingredient.get('measure', {})
        measure_id = 'measure_' + id
        graph['nodes'].append({
            'id': measure_id,
            'type': 'action',
            'operation': 'measure',
            'instruction': (f"Measure {amounts[0]} of {ingredient['name'].lower()}." if len(amounts) == 1 else
                            f"Measure {ingredient['name'].lower()} into separate portions: {', '.join(amounts)}."),
            'duration': deepcopy(overrides.get('duration', {
                'plannedSeconds': 30 + 15 * (len(portions) - 1),
                'basis': 'estimate',
                'note': 'Generated estimate: 30 seconds plus 15 per additional portion.',
            })),
            'attention': 'active',
            'cooksRequired': 1,
            'equipment': deepcopy(overrides.get('equipment', list(dict.fromkeys(
                MEASURING_EQUIPMENT[unit] for unit in (p['unit'] for p in portions.values())
                if unit in MEASURING_EQUIPMENT)))),
            'dependsOn': [],
        })
        graph['edges'].append({'from': id, 'to': measure_id})
        for (portion_id, portion), amount in zip(portions.items(), amounts):
            graph['nodes'].append({'id': portion_id, 'type': 'food_state',
                                   'name': portion.get('name', f"{ingredient['name']} ({amount})"),
                                   'ingredient': id, 'quantity': portion['quantity'], 'unit': portion['unit']})
            graph['edges'].append({'from': measure_id, 'to': portion_id})
    for step in recipe['steps']:
        action = {key: deepcopy(value) for key, value in step.items()
                  if key not in ('inputs', 'outputs')}
        action.update(type='action', dependsOn=deepcopy(step.get('dependsOn', [])))
        graph['nodes'].append(action)
        for input_id in step['inputs']:
            graph['edges'].append({'from': input_id, 'to': step['id']})
        for output in step['outputs']:
            graph['nodes'].append({'type': 'food_state', **deepcopy(output)})
            graph['edges'].append({'from': step['id'], 'to': output['id']})

    errors.extend(validate_graph(graph))
    if errors:
        raise ValueError('Invalid recipe:\n' + '\n'.join(errors))
    return graph


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', type=Path, help='Step-oriented recipe JSON file')
    parser.add_argument('-o', '--output', type=Path, help='Write compiled graph JSON (otherwise validate only)')
    args = parser.parse_args()
    try:
        graph = compile_recipe(json.loads(args.recipe.read_text(encoding='utf-8')))
        if args.output:
            if args.output.resolve() == args.recipe.resolve():
                raise ValueError('Output must differ from the input JSON file.')
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(graph, indent=2) + '\n', encoding='utf-8')
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Valid: {len(graph['nodes'])} nodes, {len(graph['edges'])} food-flow edges; acyclic and connected to outputs.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
