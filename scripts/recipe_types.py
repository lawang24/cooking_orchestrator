"""Dictionary shapes used after recipe validation and during graph compilation."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


Recipe = TypedDict('Recipe', {
    '$schema': NotRequired[str],
    'schemaVersion': Literal['1.0'],
    'recipeId': str,
    'name': str,
    'notes': list[str],
    'outputs': list[str],
    'servings': int,
    'ingredients': 'dict[str, Ingredient]',
    'steps': 'list[Step]',
})


class Ingredient(TypedDict):
    name: str
    quantity: float
    unit: Unit


class Portion(TypedDict):
    quantity: float
    unit: Unit
    name: NotRequired[str]


Unit = Literal['g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'whole']


class Step(TypedDict):
    id: str
    operation: str
    instruction: str
    scheduled_duration_seconds: int
    scheduled_duration_source: Literal['source', 'estimate']
    attention: Literal['active', 'passive']
    cooksRequired: int
    equipment: list[str]
    inputs: list[str]
    outputs: list[FoodState]
    dependsOn: NotRequired[list[str]]


class FoodState(TypedDict):
    id: str
    name: str
    ingredient: NotRequired[str]
    quantity: NotRequired[float]
    unit: NotRequired[Unit]


class CompiledGraph(TypedDict):
    schemaVersion: Literal['1.0']
    recipeId: str
    name: str
    notes: list[str]
    outputs: list[str]
    servings: NotRequired[int]
    recipes: NotRequired[list[MealComponent]]
    nodes: list[Node]
    edges: list[Edge]


class MealComponent(TypedDict):
    tag: str
    recipeId: str
    name: str
    servings: int


class IngredientNode(TypedDict):
    id: str
    type: Literal['ingredient']
    name: str
    quantity: float
    unit: Unit


class ActionNode(TypedDict):
    id: str
    type: Literal['action']
    operation: str
    instruction: str
    scheduled_duration_seconds: int
    scheduled_duration_source: Literal['source', 'estimate']
    attention: Literal['active', 'passive']
    cooksRequired: int
    equipment: list[str]
    dependsOn: list[str]


class FoodStateNode(TypedDict):
    id: str
    type: Literal['food_state']
    name: str
    ingredient: NotRequired[str]
    quantity: NotRequired[float]
    unit: NotRequired[Unit]


Node = IngredientNode | ActionNode | FoodStateNode


Edge = TypedDict('Edge', {'from': str, 'to': str})
