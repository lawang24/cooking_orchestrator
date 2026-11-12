// Server-side counterpart of the Python compiler/graph checks. The authoritative
// schema is imported directly; parity tests compare graphs and rejection cases.
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../../schemas/recipe.schema.json" with { type: "json" };
import type { ActionNode, CompiledGraph, FoodNode, FoodStateNode, IngredientNode, ViewerData } from "../../../frontend/types.ts";

interface Recipe {
  schemaVersion: "1.0";
  recipeId: string;
  name: string;
  servings: number;
  notes: string[];
  outputs: string[];
  ingredients: Record<string, Omit<IngredientNode, "id" | "type">>;
  steps: (Omit<ActionNode, "type" | "dependsOn"> & {
    dependsOn?: string[];
    inputs: string[];
    outputs: Omit<FoodStateNode, "type">[];
  })[];
}

const ajv = new Ajv2020({ strict: false, ownProperties: true });
const validate = ajv.compile<Recipe>(schema);
const scales: Record<string, number>[] = [
  { tsp: 1, tbsp: 3, cup: 48, ml: 1 / 4.92892159375, l: 1000 / 4.92892159375 },
  { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 },
  { whole: 1 },
];

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function compileRecipe(document: unknown): ViewerData {
  const values: unknown[] = [document];
  while (values.length) {
    const value = values.pop();
    requireValid(typeof value !== "number" || Number.isFinite(value), "Recipe numbers must be finite.");
    if (value && typeof value === "object") values.push(...Object.values(value));
  }
  requireValid(validate(document), ajv.errorsText(validate.errors, { separator: "; " }));
  const recipe = document;
  // Bound graph work on the public endpoint independently of the body-size cap.
  requireValid(recipe.steps.length <= 1000, "Recipes may contain at most 1,000 steps.");
  const graph: CompiledGraph = {
    schemaVersion: recipe.schemaVersion, recipeId: recipe.recipeId, name: recipe.name,
    servings: recipe.servings, notes: recipe.notes, outputs: recipe.outputs, nodes: [], edges: [],
  };
  for (const [id, ingredient] of Object.entries(recipe.ingredients)) {
    graph.nodes.push({ id, type: "ingredient", ...ingredient });
  }
  for (const step of recipe.steps) {
    const { inputs, outputs, ...action } = step;
    graph.nodes.push({ ...action, type: "action", dependsOn: step.dependsOn ?? [] });
    for (const input of inputs) graph.edges.push({ from: input, to: step.id });
    for (const output of outputs) {
      graph.nodes.push({ type: "food_state", ...output });
      graph.edges.push({ from: step.id, to: output.id });
    }
  }
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  requireValid(nodes.size === graph.nodes.length, "Node IDs must be unique.");
  const incoming = new Map(graph.nodes.map(node => [node.id, new Set<string>()]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, new Set<string>()]));
  for (const { from, to } of graph.edges) {
    const source = nodes.get(from), target = nodes.get(to);
    requireValid(source && target, `Unknown food reference: ${from} → ${to}.`);
    requireValid((source.type !== "action" && target.type === "action") ||
      (source.type === "action" && target.type === "food_state"), "Invalid food-flow edge.");
    incoming.get(to)!.add(from);
    outgoing.get(from)!.add(to);
  }
  const dependencies: [string, string][] = [];
  for (const node of graph.nodes) {
    const inputs = [...incoming.get(node.id)!].map(id => nodes.get(id)!);
    const outputs = [...outgoing.get(node.id)!].map(id => nodes.get(id)!);
    if (node.type !== "action") {
      requireValid(outputs.length === (graph.outputs.includes(node.id) ? 0 : 1),
        `${node.id}: split portions explicitly; food must have exactly one consumer unless it is a final output.`);
      if (node.type === "food_state") requireValid(inputs.length === 1, `${node.id}: expected one producer.`);
      else requireValid(inputs.length === 0 && outputs.every(n => n.type === "action" && n.operation === "measure"),
        `${node.id}: ingredient totals must feed an explicit measurement.`);
    } else {
      requireValid(inputs.length && outputs.length, `${node.id}: actions require food inputs and outputs.`);
      if (node.operation === "measure") validateMeasurement(node, inputs, outputs);
      for (const id of node.dependsOn) {
        requireValid(nodes.get(id)?.type === "action", `${node.id}: dependsOn must reference an action.`);
        dependencies.push([id, node.id]);
      }
    }
  }
  for (const id of graph.outputs) requireValid(nodes.get(id)?.type === "food_state", "Outputs must reference food states.");
  const adjacency = new Map([...outgoing].map(([id, targets]) => [id, new Set(targets)]));
  for (const [from, to] of dependencies) adjacency.get(from)!.add(to);
  const degrees = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const targets of adjacency.values()) for (const target of targets) degrees.set(target, degrees.get(target)! + 1);
  const ready = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!;
    visited++;
    for (const target of adjacency.get(id)!) {
      degrees.set(target, degrees.get(target)! - 1);
      if (!degrees.get(target)) ready.push(target);
    }
  }
  requireValid(visited === nodes.size, "Cycle detected in food flow or action ordering.");
  const ancestors = new Set(graph.outputs), pending = [...ancestors];
  while (pending.length) for (const id of incoming.get(pending.pop()!)!) {
    if (!ancestors.has(id)) { ancestors.add(id); pending.push(id); }
  }
  requireValid(ancestors.size === nodes.size, "Every node must contribute food to a declared output.");

  // Same stable source-order tie breaking as recipe_viewer_data.action_order.
  const actions = graph.nodes.filter((n): n is ActionNode => n.type === "action");
  const prerequisites = new Map(actions.map(action => [action.id, new Set(action.dependsOn)]));
  for (const action of actions) for (const id of incoming.get(action.id)!) {
    for (const producer of incoming.get(id)!) prerequisites.get(action.id)!.add(producer);
  }
  const steps: string[] = [], done = new Set<string>();
  while (steps.length < actions.length) {
    const next = actions.find(action => !done.has(action.id) && [...prerequisites.get(action.id)!].every(id => done.has(id)));
    requireValid(next, "Cannot order cyclic actions.");
    steps.push(next.id); done.add(next.id);
  }
  return { graph, steps };
}

function validateMeasurement(action: ActionNode, inputs: FoodNode[], outputs: FoodNode[]): void {
  const source = inputs[0];
  requireValid(action.attention === "active" && action.cooksRequired >= 1 && inputs.length === 1 && source.type !== "action",
    `${action.id}: measurement requires one food input and active work.`);
  const identity = source.type === "ingredient" ? source.id : source.ingredient;
  requireValid(identity && source.quantity !== undefined && source.unit, `${action.id}: measurement input must be quantified.`);
  requireValid(outputs.every(output => output.type === "food_state" && output.ingredient === identity && output.quantity !== undefined && output.unit),
    `${action.id}: measured outputs must retain identity, quantity, and unit.`);
  const portions = outputs as FoodStateNode[];
  const scale = scales.find(scale => [source.unit!, ...portions.map(p => p.unit!)].every(unit => Object.hasOwn(scale, unit)));
  requireValid(scale, `${action.id}: measurement units must be compatible.`);
  const total = portions.reduce((sum, p) => sum + p.quantity! * scale[p.unit!], 0);
  const expected = source.quantity * scale[source.unit];
  requireValid(Number.isFinite(total) && Number.isFinite(expected) &&
    Math.abs(total - expected) <= Math.max(1e-9, 1e-9 * Math.max(Math.abs(total), Math.abs(expected))),
    `${action.id}: measured outputs must add up to the input quantity.`);
}
