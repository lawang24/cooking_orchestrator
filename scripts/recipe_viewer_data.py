"""Browser-compatible action ordering and validated data for the React viewer."""

import heapq
import json

from compile_recipe import compile_recipe
from recipe_types import CompiledGraph


def action_order(graph: CompiledGraph) -> list[str]:
    """Order validated actions by dependencies; source order breaks ties only."""
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


def reject_constant(value: str) -> None:
    raise ValueError(f'{value} is not a finite JSON number.')


def compile_recipe_json(text: str) -> str:
    """JSON-only bridge for Pyodide. Input is data, never executable Python."""
    try:
        recipe = json.loads(text, parse_constant=reject_constant)
        # Reject overflow such as 1e999 as well as explicit NaN/Infinity.
        json.dumps(recipe, allow_nan=False)
        graph = compile_recipe(recipe)
        return json.dumps({'ok': True, 'data': {'graph': graph, 'steps': action_order(graph)}}, allow_nan=False)
    except ValueError as error:
        return json.dumps({'ok': False, 'error': str(error)})
