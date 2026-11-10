import type { CompiledGraph, FoodStateNode, Unit } from "./types";

// Round only for display; serving calculations keep the original precision.
export function formatQuantity(quantity: number, unit?: Unit): string {
  if (unit === "g") return String(Math.round(quantity));
  const quarters = Math.round(Math.abs(quantity) * 4);
  const whole = Math.floor(quarters / 4);
  const fraction = ["", "¼", "½", "¾"][quarters % 4];
  const amount = fraction ? `${whole || ""}${whole ? " " : ""}${fraction}` : String(whole);
  return quantity < 0 && quarters ? `−${amount}` : amount;
}

// Recipe prose can also contain amounts, dimensions, and time ranges.
export function formatRecipeText(text: string): string {
  return text.replace(/(?<![\w.])\d*\.\d+(?!\d|\.\d)/g, (value, offset: number) => {
    // Include both endpoints when a gram amount is written as a range.
    const grams = /^(?:\s*[–—-]\s*\d+(?:\.\d+)?)?\s*(?:g|grams?)\b/i.test(text.slice(offset + value.length));
    return formatQuantity(Number(value), grams ? "g" : undefined);
  });
}

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
        `${formatQuantity(portion.quantity!, portion.unit)} ${portion.unit} ${portion.name.toLowerCase()}`
      );
      return { ...node, instruction: `Measure ${list.format(amounts)}.` };
    }),
  };
}
