"""Proof of concept: merge several recipes into one meal graph.

Each recipe's portion, step, and food-state IDs get a '<tag>-' prefix so they
cannot collide. Ingredients stay keyed by canonical identity, so the same
ingredient across recipes shares one ingredient node and one measure action.
No cross-recipe ordering or equipment assignment is added.

Run from the project directory:
  .venv/bin/python experiments/meal-merge/merge_recipes.py \\
      beef=recipes/beef-onion-stir-fry.recipe.json mapo=experiments/meal-merge/ma-po-tofu.recipe.json
"""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import build_graph, compile_recipe
from visualize_recipe_graph import render_graph


def merge_recipes(tagged):
    """Return one meal graph from (tag, recipe) pairs; each recipe must compile on its own."""
    recipes = [recipe for _, recipe in tagged]
    meal = {
        'schemaVersion': '1.0',
        'recipeId': 'meal-' + '-'.join(tag for tag, _ in tagged),
        'name': ' + '.join(recipe['name'] for recipe in recipes),
        # The viewer links one source; every recipe's source is kept in 'recipes'.
        'source': {
            'url': recipes[0]['source']['url'],
            'publisher': ' + '.join(dict.fromkeys(recipe['source']['publisher'] for recipe in recipes)),
            'author': ' + '.join(dict.fromkeys(recipe['source']['author'] for recipe in recipes)),
        },
        'recipes': [],
        'notes': [
            'Proof-of-concept meal graph. Each canonical ingredient has one measure action producing every portion across recipes.',
            'Equipment such as wok and burner appears in several recipes; no cross-recipe ordering or resource assignment is modeled.',
        ],
        'outputs': [],
        'ingredients': {},
        'steps': [],
    }
    for tag, recipe in tagged:
        compile_recipe(recipe)

        def local(id):
            return f'{tag}-{id}'

        meal['recipes'].append({'tag': tag, **{key: deepcopy(recipe[key])
                                               for key in ('recipeId', 'name', 'servings', 'source')}})
        meal['notes'] += [f"{recipe['name']}: {note}" for note in recipe['notes']]
        meal['outputs'] += [local(id) for id in recipe['outputs']]
        for identity, ingredient in recipe['ingredients'].items():
            merged = meal['ingredients'].setdefault(identity, {'name': ingredient['name'], 'portions': {}})
            if 'measure' in ingredient:
                if 'measure' in merged:
                    raise ValueError(f'{identity}: measure overrides from several recipes cannot be combined yet.')
                merged['measure'] = deepcopy(ingredient['measure'])
            for id, portion in ingredient['portions'].items():
                label = portion.get('name', f"{ingredient['name']} ({portion['quantity']:g} {portion['unit']})")
                merged['portions'][local(id)] = {**portion, 'name': f'{label} [{tag}]'}
        for step in recipe['steps']:
            step = deepcopy(step)
            step['id'] = local(step['id'])
            step['inputs'] = [local(id) for id in step['inputs']]
            if 'dependsOn' in step:
                step['dependsOn'] = [local(id) for id in step['dependsOn']]
            for output in step['outputs']:
                output['id'] = local(output['id'])
            meal['steps'].append(step)
    return build_graph(meal)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('recipes', nargs='+', metavar='TAG=PATH', help='Short ID prefix and recipe JSON file')
    parser.add_argument('-o', '--output-dir', type=Path, default=ROOT / 'tmp/compiled',
                        help='Directory for <recipeId>.graph.json and .html (default: tmp/compiled)')
    args = parser.parse_args()
    try:
        tagged = []
        for argument in args.recipes:
            tag, separator, path = argument.partition('=')
            if not separator or not tag:
                raise ValueError(f'Expected TAG=PATH, got {argument!r}.')
            tagged.append((tag, json.loads(Path(path).read_text(encoding='utf-8'))))
        graph = merge_recipes(tagged)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        stem = args.output_dir / graph['recipeId']
        stem.with_suffix('.graph.json').write_text(json.dumps(graph, indent=2) + '\n', encoding='utf-8')
        stem.with_suffix('.html').write_text(render_graph(graph), encoding='utf-8')
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Valid: {len(graph['nodes'])} nodes, {len(graph['edges'])} food-flow edges. Wrote {stem}.graph.json and .html")
    return 0


if __name__ == '__main__':
    sys.exit(main())
