"""Proof of concept: merge several recipes into one meal graph.

Each recipe is compiled and validated independently. The resulting graphs are
namespaced and combined before compatible ingredient/measurement pairs merge.
Portions and authored actions remain separate; no scheduling is performed.

Run from the project directory:
  .venv/bin/python experiments/meal-merge/merge_recipes.py \\
      beef=recipes/beef-onion-stir-fry.recipe.json mapo=experiments/meal-merge/ma-po-tofu.recipe.json
"""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from compile_recipe import compile_recipe
from merge_recipe_graphs import merge_recipe_graphs
from visualize_recipe_graph import render_graph


def merge_recipes(tagged):
    """Compile recipes independently, then compose their graphs."""
    return merge_recipe_graphs([(tag, compile_recipe(recipe)) for tag, recipe in tagged])


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
