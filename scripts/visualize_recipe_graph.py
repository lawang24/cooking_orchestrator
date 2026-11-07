"""Compile a step-oriented recipe and render a self-contained, offline diagram."""

import argparse
import json
from pathlib import Path
import sys
import webbrowser

from validate_recipe_graph import validate_graph
from compile_recipe import compile_recipe


HERE = Path(__file__).resolve().parent


def render_recipe(recipe):
    return render_graph(compile_recipe(recipe))


def render_graph(graph):
    errors = validate_graph(graph)
    if errors:
        raise ValueError('Invalid recipe graph:\n' + '\n'.join(errors))
    # Data is embedded in a non-executable script, but HTML still recognizes
    # closing script tags there. Escape angle brackets before embedding.
    payload = json.dumps(graph, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = (HERE / 'recipe_graph_viewer.html').read_text(encoding='utf-8')
    library = (HERE / 'vendor/dagre-1.1.5.min.js').read_text(encoding='utf-8')
    license_text = (HERE / 'vendor/dagre-LICENSE').read_text(encoding='utf-8')
    library = library.replace('</script', '<\\/script')
    # Split placeholders once so recipe strings resembling placeholders remain data.
    before_library, rest = template.split('/* DAGRE_LIBRARY */', 1)
    before_data, after_data = rest.split('RECIPE_GRAPH_DATA', 1)
    return before_library + library + '\n/*\n' + license_text + '\n*/' + before_data + payload + after_data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', type=Path, help='Step-oriented recipe JSON file')
    parser.add_argument('-o', '--output', type=Path, help='Output HTML (default: visualizations/<recipeId>.html)')
    parser.add_argument('--open', action='store_true', help='Open the generated file in your default browser')
    args = parser.parse_args()
    try:
        recipe = json.loads(args.recipe.read_text(encoding='utf-8'))
        document = render_recipe(recipe)
        output = args.output or Path('visualizations') / (recipe['recipeId'] + '.html')
        if output.resolve() == args.recipe.resolve():
            raise ValueError('Output must differ from the input JSON file.')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(document, encoding='utf-8')
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f'Created {output.resolve()}')
    if args.open:
        webbrowser.open(output.resolve().as_uri())
    return 0


if __name__ == '__main__':
    sys.exit(main())
