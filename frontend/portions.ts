import type { CompiledGraph, FoodStateNode } from "./types";

export const formatQuantity = (quantity: number) => Number(quantity.toPrecision(15)).toString();

const list = new Intl.ListFormat("en");

export function validServings(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

export function forServings(graph: CompiledGraph, servings = graph.servings): CompiledGraph {
  if (!graph.servings || servings === undefined || !validServings(servings) || servings === graph.servings) return graph;
  const factor = servings / graph.servings;
  const nodes = graph.nodes.map(node => {
    if (node.type === "action" || node.quantity === undefined) return node;
    // Older recipe exports repeat the structured amount at the end of a portion name.
    const suffix = ` (${node.quantity} ${node.unit})`;
    const name = node.type === "food_state" && node.name.endsWith(suffix)
      ? node.name.slice(0, -suffix.length)
      : node.name;
    return { ...node, quantity: node.quantity * factor, name };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const portions = new Map<string, FoodStateNode[]>();
  for (const { from, to } of graph.edges) {
    const action = byId.get(from)!;
    const output = byId.get(to)!;
    if (action.type !== "action" || action.operation !== "measure" || output.type !== "food_state") continue;
    const batch = portions.get(from) ?? [];
    batch.push(output);
    portions.set(from, batch);
  }
  return {
    ...graph,
    servings,
    nodes: nodes.map(node => {
      const batch = portions.get(node.id);
      if (node.type !== "action" || !batch) return node;
      const amounts = batch.map(portion =>
        `${formatQuantity(portion.quantity!)} ${portion.unit} ${portion.name.toLowerCase()}`
      );
      return { ...node, instruction: `Measure ${list.format(amounts)}.` };
    }),
  };
}
