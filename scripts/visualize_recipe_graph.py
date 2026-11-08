"""Compile a step-oriented recipe and render a self-contained, offline diagram."""

from __future__ import annotations

import argparse
import heapq
import json
from pathlib import Path
import sys
import webbrowser

from validate_recipe_graph import validate_graph
from compile_recipe import compile_recipe
from recipe_types import CompiledGraph


HERE = Path(__file__).resolve().parent


def render_recipe(recipe: object) -> str:
    return render_graph(compile_recipe(recipe))


def action_order(graph: CompiledGraph) -> list[str]:
    """A stable walkthrough of validated actions, respecting both edge types.

    Source order only breaks ties between independent actions. This does not
    schedule overlapping work or mark anything complete.
    """
    actions = [node for node in graph['nodes'] if node['type'] == 'action']
    priority = {node['id']: index for index, node in enumerate(actions)}
    producers = {edge['to']: edge['from'] for edge in graph['edges'] if edge['from'] in priority}
    prerequisites = {node['id']: set(node['dependsOn']) for node in actions}
    for edge in graph['edges']:
        if edge['to'] in prerequisites and edge['from'] in producers:
            prerequisites[edge['to']].add(producers[edge['from']])
    followers: dict[str, set[str]] = {id: set() for id in priority}
    for id, dependencies in prerequisites.items():
        for dependency in dependencies:
            followers[dependency].add(id)
    ready = [(priority[id], id) for id, dependencies in prerequisites.items() if not dependencies]
    heapq.heapify(ready)
    ordered = []
    while ready:
        _, id = heapq.heappop(ready)
        ordered.append(id)
        for follower in followers[id]:
            prerequisites[follower].remove(id)
            if not prerequisites[follower]:
                heapq.heappush(ready, (priority[follower], follower))
    if len(ordered) != len(actions):
        raise ValueError('Cannot build a walkthrough with cyclic action dependencies.')
    return ordered


def embedded_json(value: CompiledGraph | list[str]) -> str:
    # Data is embedded in a non-executable script, but HTML still recognizes
    # closing script tags there. Escape angle brackets before embedding.
    return json.dumps(value, ensure_ascii=True).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def render_graph(graph: CompiledGraph) -> str:
    errors = validate_graph(graph)
    if errors:
        raise ValueError('Invalid recipe graph:\n' + '\n'.join(errors))
    template = (HERE / 'recipe_graph_viewer.html').read_text(encoding='utf-8')
    library = (HERE / 'vendor/dagre-1.1.5.min.js').read_text(encoding='utf-8')
    license_text = (HERE / 'vendor/dagre-LICENSE').read_text(encoding='utf-8')
    library = library.replace('</script', '<\\/script')
    # Split placeholders once so recipe strings resembling placeholders remain data.
    before_library, rest = template.split('/* DAGRE_LIBRARY */', 1)
    before_data, after_data = rest.split('RECIPE_GRAPH_DATA', 1)
    before_steps, after_steps = after_data.split('RECIPE_STEP_DATA', 1)
    return (before_library + library + '\n/*\n' + license_text + '\n*/' + before_data + embedded_json(graph)
            + before_steps + embedded_json(action_order(graph)) + after_steps)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', type=Path, help='Step-oriented recipe JSON file')
    parser.add_argument('-o', '--output', type=Path, help='Output HTML (default: visualizations/<recipeId>.html)')
    parser.add_argument('--open', action='store_true', help='Open the generated file in your default browser')
    args = parser.parse_args()
    try:
        graph = compile_recipe(json.loads(args.recipe.read_text(encoding='utf-8')))
        document = render_graph(graph)
        output = args.output or Path('visualizations') / (graph['recipeId'] + '.html')
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
