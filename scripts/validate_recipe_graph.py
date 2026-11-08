"""Validate graph semantics of a compiled recipe graph.

Field structure is validated on recipe input by compile_recipe.py against
schemas/recipe.schema.json; this command checks the graph it exports.
Run: python3 scripts/validate_recipe_graph.py visualizations/beef-onion-stir-fry.graph.json

This validates dependencies and measurement allocations, not cooking safety,
recipe accuracy, quantity conservation through other transformations, or
feasibility in a particular kitchen.
"""

from __future__ import annotations

import argparse
from collections import deque
import json
from math import isclose
from pathlib import Path
import sys

from recipe_quantities import UNIT_SCALES
from recipe_types import ActionNode, CompiledGraph, Node


def validate_measurement(
    action: ActionNode, inputs: list[Node], outputs: list[Node], graph: CompiledGraph,
) -> list[str]:
    """Measurement partitions one ingredient without changing identity or amount."""
    id = action['id']
    if action['attention'] != 'active' or action['cooksRequired'] < 1:
        return [f'{id}: measurement requires active work and at least one cook.']
    if len(inputs) != 1 or not outputs:
        return [f'{id}: measurement requires exactly one food input and quantified outputs.']
    source = inputs[0]
    if source['type'] == 'action':
        return [f'{id}: measurement input must be food.']
    if 'quantity' not in source or 'unit' not in source:
        return [f'{id}: measurement input must have ingredient identity, quantity, and unit.']
    if source['type'] == 'ingredient':
        identity = source['id']
        # Meal graphs namespace node IDs, but food states retain canonical identities.
        for component in graph.get('recipes', []):
            prefix = component['tag'] + '-'
            if identity.startswith(prefix):
                identity = identity[len(prefix):]
                break
    else:
        identity = source.get('ingredient')
    if not identity or any(
        output['type'] != 'food_state' or output.get('ingredient') != identity
        or 'quantity' not in output or 'unit' not in output for output in outputs
    ):
        return [f'{id}: measured outputs must retain the input ingredient identity and declare quantity and unit.']
    # Narrow the validated output types for the unit and quantity calculations.
    portions = [output for output in outputs if output['type'] == 'food_state']
    units = {source['unit']} | {portion['unit'] for portion in portions}
    scale = next((scale for scale in UNIT_SCALES if units <= scale.keys()), None)
    if scale is None:
        return [f'{id}: measurement units must be compatible volumes, weights, or whole counts.']
    if source['quantity'] <= 0 or any(portion['quantity'] <= 0 for portion in portions):
        return [f'{id}: measured quantities must be positive.']
    total = sum(portion['quantity'] * scale[portion['unit']] for portion in portions)
    if not isclose(total, source['quantity'] * scale[source['unit']], rel_tol=1e-9, abs_tol=1e-9):
        return [f'{id}: measured outputs must add up to the input quantity.']
    return []


def validate_graph(graph: CompiledGraph) -> list[str]:
    errors = []
    nodes = {node['id']: node for node in graph['nodes']}
    if len(nodes) != len(graph['nodes']):
        return ['Node IDs must be unique.']
    incoming: dict[str, set[str]] = {id: set() for id in nodes}
    outgoing: dict[str, set[str]] = {id: set() for id in nodes}
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
        if kind == 'ingredient' and any(
            nodes[target].get('operation') != 'measure' for target in outgoing[id]
        ):
            errors.append(f'{id}: initial ingredient totals must be consumed by an explicit measure action.')
        if kind == 'food_state' and len(incoming[id]) != 1:
            errors.append(f'{id}: a food state must have exactly one producing action.')
        if kind in ('ingredient', 'food_state'):
            expected_consumers = 0 if id in graph['outputs'] else 1
            if len(outgoing[id]) != expected_consumers:
                errors.append(f'{id}: expected {expected_consumers} consuming actions; split portions explicitly.')
        if node['type'] == 'action':
            if not incoming[id] or not outgoing[id]:
                errors.append(f'{id}: actions require food inputs and outputs.')
            if node.get('operation') == 'measure':
                errors.extend(validate_measurement(
                    node, [nodes[source] for source in incoming[id]],
                    [nodes[target] for target in outgoing[id]], graph,
                ))
            for dependency in node['dependsOn']:
                if dependency not in nodes or nodes[dependency]['type'] != 'action':
                    errors.append(f'{id}: dependsOn must reference an action: {dependency}.')
                else:
                    precedence.append((dependency, id))

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('graph', type=Path)
    args = parser.parse_args()
    try:
        graph: CompiledGraph = json.loads(args.graph.read_text())
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
