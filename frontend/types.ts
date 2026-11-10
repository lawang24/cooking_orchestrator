// JSON boundary from scripts/recipe_types.py. Python validates before export.
export type Unit =
  | "g"
  | "kg"
  | "oz"
  | "lb"
  | "ml"
  | "l"
  | "tsp"
  | "tbsp"
  | "cup"
  | "whole";
export interface IngredientNode {
  id: string;
  type: "ingredient";
  name: string;
  quantity: number;
  unit: Unit;
}
export interface ActionNode {
  id: string;
  type: "action";
  operation: string;
  instruction: string;
  scheduled_duration_seconds: number;
  scheduled_duration_source: "source" | "estimate";
  attention: "active" | "passive";
  cooksRequired: number;
  equipment: string[];
  dependsOn: string[];
}
export interface FoodStateNode {
  id: string;
  type: "food_state";
  name: string;
  ingredient?: string;
  quantity?: number;
  unit?: Unit;
}
export type FoodNode = IngredientNode | ActionNode | FoodStateNode;
export interface Edge {
  from: string;
  to: string;
}
export interface Connection extends Edge {
  kind: "food" | "order";
}
export interface MealComponent {
  tag: string;
  recipeId: string;
  name: string;
  servings: number;
}
export interface CompiledGraph {
  schemaVersion: "1.0";
  recipeId: string;
  name: string;
  notes: string[];
  outputs: string[];
  servings?: number;
  recipes?: MealComponent[];
  nodes: FoodNode[];
  edges: Edge[];
}
export interface ViewerData {
  hasRecipeIndex?: boolean;
  graph: CompiledGraph;
  steps: string[];
}
