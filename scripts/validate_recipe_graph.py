"""Validate graph semantics of a compiled recipe graph.

Field structure is validated on recipe input by compile_recipe.py against
schemas/recipe.schema.json; this command checks the graph it exports.
Run: python3 scripts/validate_recipe_graph.py visualizations/beef-onion-stir-fry.graph.json

This validates dependencies, not cooking safety, recipe accuracy, quantity
conservation through transformations, or feasibility in a particular kitchen.
"""

import argparse
from collections import deque
import json
from pathlib import Path
import sys


def validate_graph(graph):
    errors = []
    nodes = {node['id']: node for node in graph['nodes']}
    if len(nodes) != len(graph['nodes']):
        return ['Node IDs must be unique.']
    incoming = {id: set() for id in nodes}
    outgoing = {id: set() for id in nodes}
    precedence = []

    for edge in graph['edges']:
        source, target = edge['from'], edge['to']
        if source not in nodes or target not in nodes:
            errors.append(f'Unknown edge endpoint: {source} -> {target}.')
            continue
        source_type, target_type = nodes[source]['type'], nodes[target]['type']
        allowed = (source_type in ('ingredient', 'food_state') and target_type == 'action') or (
            source_type == 'action' and target_type == 'food_state')
        if not allowed:
            errors.append(f'Invalid food-flow edge: {source} -> {target}.')
        incoming[target].add(source)
        outgoing[source].add(target)

    for id, node in nodes.items():
        kind = node['type']
        if kind == 'ingredient' and incoming[id]:
            errors.append(f'{id}: initial ingredients cannot have producers.')
        if kind == 'food_state' and len(incoming[id]) != 1:
            errors.append(f'{id}: a food state must have exactly one producing action.')
        if kind in ('ingredient', 'food_state'):
            expected_consumers = 0 if id in graph['outputs'] else 1
            if len(outgoing[id]) != expected_consumers:
                errors.append(f'{id}: expected {expected_consumers} consuming actions; split portions explicitly.')
        if kind == 'action':
            if not incoming[id] or not outgoing[id]:
                errors.append(f'{id}: actions require food inputs and outputs.')
            for dependency in node['dependsOn']:
                if dependency not in nodes or nodes[dependency]['type'] != 'action':
                    errors.append(f'{id}: dependsOn must reference an action: {dependency}.')
                else:
                    precedence.append((dependency, id))
            duration = node['duration']
            if 'minimumSeconds' in duration and not (
                duration['minimumSeconds'] <= duration['plannedSeconds'] <= duration['maximumSeconds']
            ):
                errors.append(f'{id}: planned duration must lie within the stated range.')

    for output in graph['outputs']:
        if output not in nodes or nodes[output]['type'] != 'food_state':
            errors.append(f'Output must reference a food state: {output}.')
    if errors:
        return errors

    # Scheduling dependencies include both food flow and explicit action order.
    adjacency = {id: set(targets) for id, targets in outgoing.items()}
    for source, target in precedence:
        adjacency[source].add(target)
    indegree = dict.fromkeys(nodes, 0)
    for targets in adjacency.values():
        for target in targets:
            indegree[target] += 1
    ready = deque(id for id, degree in indegree.items() if degree == 0)
    visited = 0
    while ready:
        id = ready.popleft()
        visited += 1
        for target in adjacency[id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if visited != len(nodes):
        errors.append('Cycle detected in food flow or action ordering.')

    # Every node must contribute food to a declared output, not just an order constraint.
    ancestors = set(graph['outputs'])
    pending = list(ancestors)
    while pending:
        for predecessor in incoming[pending.pop()]:
            if predecessor not in ancestors:
                ancestors.add(predecessor)
                pending.append(predecessor)
    unused = sorted(set(nodes) - ancestors)
    if unused:
        errors.append(f'Nodes do not contribute to a declared output: {", ".join(unused)}.')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', type=Path)
    args = parser.parse_args()
    try:
        graph = json.loads(args.graph.read_text())
        errors = validate_graph(graph)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    except (KeyError, TypeError) as error:
        print(f'Malformed graph; export it with compile_recipe.py: {error!r}', file=sys.stderr)
        return 1
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f"Valid: {len(graph['nodes'])} nodes, {len(graph['edges'])} food-flow edges; acyclic and connected to outputs.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
