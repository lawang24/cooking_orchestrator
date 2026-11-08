"""Compose independently compiled recipe graphs, then batch compatible measurements."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import re

from recipe_quantities import UNIT_SCALES
from recipe_types import CompiledGraph, FoodStateNode, IngredientNode, ActionNode, Portion, Unit
from validate_recipe_graph import validate_graph


MEASURING_EQUIPMENT: dict[Unit, str] = {
    'tsp': 'measuring_spoons', 'tbsp': 'measuring_spoons',
    'cup': 'measuring_cup', 'ml': 'measuring_cup', 'l': 'measuring_cup',
    'g': 'kitchen_scale', 'kg': 'kitchen_scale', 'oz': 'kitchen_scale', 'lb': 'kitchen_scale',
}


def make_measure_action(
    action_id: str, name: str, portions: list[Portion],
) -> ActionNode:
    """Build the conventional measurement template recognized by the meal optimizer."""
    amounts = [f"{portion['quantity']:g} {portion['unit']}" for portion in portions]
    return {
        'id': action_id,
        'type': 'action',
        'operation': 'measure',
        'instruction': (f"Measure {amounts[0]} of {name.lower()}." if len(amounts) == 1 else
                        f"Measure {name.lower()} into separate portions: {', '.join(amounts)}."),
        'scheduled_duration_seconds': 30 + 15 * (len(portions) - 1),
        'scheduled_duration_source': 'estimate',
        'attention': 'active',
        'cooksRequired': 1,
        'equipment': list(dict.fromkeys(
            MEASURING_EQUIPMENT[unit] for unit in (p['unit'] for p in portions)
            if unit in MEASURING_EQUIPMENT)),
        'dependsOn': [],
    }


def merge_recipe_graphs(tagged: list[tuple[str, CompiledGraph]]) -> CompiledGraph:
    """Merge compiler-produced single-recipe graphs without mutating them.

    Tags contain no hyphens, so '<tag>-<local ID>' namespaces cannot overlap.
    Ingredient IDs in the original graphs are canonical identities. Food-state
    ingredient fields retain those identities, not the namespaced node IDs.
    """
    tags = [tag for tag, _ in tagged]
    if not tags or len(tags) != len(set(tags)):
        raise ValueError('Provide at least one recipe with unique tags.')
    if any(re.fullmatch(r'[a-z][a-z0-9_]*', tag) is None for tag in tags):
        raise ValueError('Tags must start with a lowercase letter and contain only lowercase letters, digits, or underscores.')
    meal: CompiledGraph = {
        'schemaVersion': '1.0',
        'recipeId': 'meal-' + '-'.join(tags),
        'name': ' + '.join(graph['name'] for _, graph in tagged),
        'recipes': [],
        'notes': [
            'Recipes are compiled independently, then their graphs are combined. Measurements matching the conventional estimate share an ingredient and action; portions remain separate.',
            'Customized authored measurements and incompatible units remain separate. Prep and cooking actions are not batched; cooks and equipment are not scheduled.',
        ],
        'outputs': [], 'nodes': [], 'edges': [],
    }
    identities: dict[str, list[str]] = defaultdict(list)
    for tag, original in tagged:
        if 'recipes' in original or 'servings' not in original:
            raise ValueError(f'{tag}: expected a compiled single-recipe graph.')
        errors = validate_graph(original)
        if errors:
            raise ValueError(f'Invalid graph {tag}:\n' + '\n'.join(errors))
        graph = deepcopy(original)
        ids = {node['id']: f"{tag}-{node['id']}" for node in graph['nodes']}
        meal['recipes'].append({
            'tag': tag, 'recipeId': graph['recipeId'], 'name': graph['name'],
            'servings': graph['servings'],
        })
        meal['notes'].extend(f"{graph['name']}: {note}" for note in graph['notes'])
        meal['outputs'].extend(ids[id] for id in graph['outputs'])
        for node in graph['nodes']:
            if node['type'] == 'ingredient':
                identities[node['id']].append(ids[node['id']])
            elif node['type'] == 'action':
                node['dependsOn'] = [ids[id] for id in node['dependsOn']]
            else:
                node['name'] += f' [{tag}]'
            node['id'] = ids[node['id']]
            meal['nodes'].append(node)
        meal['edges'].extend({'from': ids[edge['from']], 'to': ids[edge['to']]} for edge in graph['edges'])

    # First validate the disjoint union; optimization is a separate graph pass.
    errors = validate_graph(meal)
    if errors:
        raise ValueError('Invalid combined graph:\n' + '\n'.join(errors))
    _merge_measurements(meal, identities)
    errors = validate_graph(meal)
    if errors:
        raise ValueError('Invalid merged graph:\n' + '\n'.join(errors))
    return meal


def _merge_measurements(meal: CompiledGraph, identities: dict[str, list[str]]) -> None:
    """Collapse compatible ingredient/measurement pairs and rewire their edges."""
    nodes = {node['id']: node for node in meal['nodes']}
    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming: dict[str, list[str]] = defaultdict(list)
    for edge in meal['edges']:
        outgoing[edge['from']].append(edge['to'])
        incoming[edge['to']].append(edge['from'])
    redirects: dict[str, str] = {}
    for ingredient_ids in identities.values():
        groups: dict[int, list[tuple[IngredientNode, ActionNode, list[Portion]]]] = defaultdict(list)
        for id in ingredient_ids:
            ingredient = nodes[id]
            if ingredient['type'] != 'ingredient' or len(outgoing[id]) != 1:
                continue
            action = nodes[outgoing[id][0]]
            if action['type'] != 'action' or incoming[action['id']] != [id]:
                continue
            states: list[FoodStateNode] = []
            for output in outgoing[action['id']]:
                state = nodes[output]
                if state['type'] == 'food_state' and 'quantity' in state and 'unit' in state:
                    states.append(state)
            if not states or len(states) != len(outgoing[action['id']]):
                continue
            portions: list[Portion] = [{'quantity': state['quantity'], 'unit': state['unit']} for state in states]
            # Only batch authored actions matching this conventional template; recipes may
            # introduce durations, equipment or prerequisites we must preserve.
            if action != make_measure_action(action['id'], ingredient['name'], portions):
                continue
            units = {portion['unit'] for portion in portions} | {ingredient['unit']}
            family = next((i for i, scale in enumerate(UNIT_SCALES) if units <= scale.keys()), None)
            if family is not None:
                groups[family].append((ingredient, action, portions))
        for family, group in groups.items():
            if len(group) < 2:
                continue
            ingredient, action, _ = group[0]
            portions = [portion for _, _, batch in group for portion in batch]
            scale = UNIT_SCALES[family]
            unit = min((portion['unit'] for portion in portions), key=scale.__getitem__)
            ingredient['unit'] = unit
            ingredient['quantity'] = sum(p['quantity'] * scale[p['unit']] for p in portions) / scale[unit]
            nodes[action['id']] = make_measure_action(action['id'], ingredient['name'], portions)
            for other_ingredient, other_action, _ in group[1:]:
                redirects[other_ingredient['id']] = ingredient['id']
                redirects[other_action['id']] = action['id']

    meal['nodes'] = [node for id, node in nodes.items() if id not in redirects]
    for node in meal['nodes']:
        if node['type'] == 'action':
            node['dependsOn'] = list(dict.fromkeys(redirects.get(id, id) for id in node['dependsOn']))
    meal['edges'] = [
        {'from': source, 'to': target}
        for source, target in dict.fromkeys(
            (redirects.get(edge['from'], edge['from']), redirects.get(edge['to'], edge['to']))
            for edge in meal['edges'])
    ]
