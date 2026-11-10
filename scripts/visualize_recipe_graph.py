"""Compile a step-oriented recipe and render a self-contained, offline diagram."""

from __future__ import annotations

import argparse
import heapq
import json
from pathlib import Path
import sys
import subprocess
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


def render_graph(graph: CompiledGraph, *, has_recipe_index: bool = False) -> str:
    # Reject invalid graph data before handing it to the React static renderer.
    errors = validate_graph(graph)
    if errors:
        raise ValueError('Invalid recipe graph:\n' + '\n'.join(errors))
    renderer = HERE.parent / 'frontend/dist/render.mjs'
    if not renderer.is_file():
        raise ValueError('Viewer build missing. Run npm ci && npm run build:viewer first.')
    # Python owns compilation and action ordering. Node renders React at build
    # time and bundles the UI, styles, escaped JSON, and Dagre license into HTML.
    # No application server is needed to open or host the resulting snapshot.
    try:
        result = subprocess.run(
            ['node', str(renderer)],
            input=json.dumps({'graph': graph, 'steps': action_order(graph), 'hasRecipeIndex': has_recipe_index}),
            capture_output=True, text=True, encoding='utf-8', check=False,
        )
    except FileNotFoundError as error:
        raise ValueError('Node.js 22.12+ is required to generate the React viewer.') from error
    if result.returncode:
        raise ValueError('React static rendering failed:\n' + result.stderr.strip())
    return result.stdout


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
