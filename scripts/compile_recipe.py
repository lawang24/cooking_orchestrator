"""Validate step-oriented recipe input and compile it into a dependency graph."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
from typing import Any, cast

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.protocols import Validator

from recipe_types import CompiledGraph, Recipe
from validate_recipe_graph import validate_graph


SCHEMA_PATH = Path(__file__).resolve().parents[1] / 'schemas/recipe.schema.json'


def compile_recipe(recipe: object) -> CompiledGraph:
    """Return a validated graph without mutating the input; raise on invalid input.

    IDs are local to one recipe. Array order carries no scheduling constraint.
    Ingredient totals and all actions, including measurements, are authored.
    Compilation never invents or batches steps.
    """
    validated_recipe = validate_schema(recipe)
    graph = build_graph(validated_recipe)
    errors = validate_graph(graph)
    if errors:
        raise ValueError('Invalid recipe:\n' + '\n'.join(errors))
    return graph


def validate_schema(recipe: object) -> Recipe:
    """Validate the input contract and return the typed recipe; raise on errors."""
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    validator = cast(Validator, Draft202012Validator(schema, format_checker=FormatChecker()))
    errors = [f'{error.json_path}: {error.message}' for error in validator.iter_errors(cast(Any, recipe))]
    if errors:
        raise ValueError('Invalid recipe:\n' + '\n'.join(errors))

    return cast(Recipe, recipe)


def build_graph(recipe: Recipe) -> CompiledGraph:
    """Build a graph from a schema-validated recipe without checking graph semantics.

    Meal composition operates on graphs.

    Example (required metadata and action details omitted for brevity):

        Recipe:
        {
            "ingredients": {
                "onion": {
                    "name": "Onion", "quantity": 1, "unit": "whole"
                }
            },
            "steps": [{
                "id": "measure_onion",
                "operation": "measure",
                "inputs": ["onion"],
                "outputs": [{"id": "onion_portion", "name": "Onion for chopping",
                             "ingredient": "onion", "quantity": 1, "unit": "whole"}]
            }, {
                "id": "chop_onion",
                "operation": "cut",
                "inputs": ["onion_portion"],
                "outputs": [{"id": "chopped_onion", "name": "Chopped onion"}]
            }],
            "outputs": ["chopped_onion"]
        }

        Compiled graph:
        {
            "nodes": [
                {"id": "onion", "type": "ingredient",
                 "quantity": 1, "unit": "whole"},
                {"id": "measure_onion", "type": "action", "operation": "measure"},
                {"id": "onion_portion", "type": "food_state",
                 "ingredient": "onion", "quantity": 1, "unit": "whole"},
                {"id": "chop_onion", "type": "action", "operation": "cut"},
                {"id": "chopped_onion", "type": "food_state"}
            ],
            "edges": [
                {"from": "onion", "to": "measure_onion"},
                {"from": "measure_onion", "to": "onion_portion"},
                {"from": "onion_portion", "to": "chop_onion"},
                {"from": "chop_onion", "to": "chopped_onion"}
            ],
            "outputs": ["chopped_onion"]
        }

    Each ingredient becomes a total-quantity node. Each authored step, including
    measurement, becomes an action; its inputs and outputs become incoming and
    outgoing food-flow edges.
    Explicit dependsOn prerequisites remain on action nodes, separate from edges.
    """

    # Carry over recipe metadata and the IDs of the finished food states.
    # Copy mutable values so editing the graph does not alter the recipe input.
    graph: CompiledGraph = {
        'schemaVersion': recipe['schemaVersion'],
        'recipeId': recipe['recipeId'],
        'name': recipe['name'],
        'notes': recipe['notes'].copy(),
        'outputs': recipe['outputs'].copy(),
        'nodes': [],
        'edges': [],
    }

    graph['servings'] = recipe['servings']

    # Starting ingredients are the explicitly declared totals for this recipe.
    for id, ingredient in recipe['ingredients'].items():
        graph['nodes'].append({'id': id, 'type': 'ingredient', **deepcopy(ingredient)})

    # Authored steps become individual actions. Their position in the list does
    # not impose execution order; food references and dependsOn determine it.
    for step in recipe['steps']:
        graph['nodes'].append({
            'type': 'action',
            'id': step['id'],
            'operation': step['operation'],
            'instruction': step['instruction'],
            'scheduled_duration_seconds': step['scheduled_duration_seconds'],
            'scheduled_duration_source': step['scheduled_duration_source'],
            'attention': step['attention'],
            'cooksRequired': step['cooksRequired'],
            'equipment': step['equipment'].copy(),
            # Extra action prerequisites stay separate from food-flow edges.
            'dependsOn': step.get('dependsOn', []).copy(),
        })
        # Inputs refer to ingredient totals or existing food-state IDs. An edge into the
        # action means that food must be available before the action can run.
        for input_id in step['inputs']:
            graph['edges'].append({'from': input_id, 'to': step['id']})
        # Outputs define new food states. Edges out of the action identify it
        # as their producer; later steps may reference these states as inputs.
        for output in step['outputs']:
            graph['nodes'].append({'type': 'food_state', **deepcopy(output)})
            graph['edges'].append({'from': step['id'], 'to': output['id']})

    return graph


def main() -> int:
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
