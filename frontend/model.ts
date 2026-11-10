import dagre from "@dagrejs/dagre";
import type {
  ActionNode,
  CompiledGraph,
  Connection,
  FoodNode,
  ViewerData,
} from "./types";

export const labels = {
  ingredient: "INGREDIENT",
  action: "ACTION",
  food_state: "FOOD STATE",
};
export const name = (node: FoodNode) =>
  "name" in node
    ? node.name
    : node.id.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
export const time = (seconds: number) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`
    : `${seconds}s`;
export const timing = (node: ActionNode) =>
  `${time(node.scheduled_duration_seconds)} planned${node.scheduled_duration_source === "estimate" ? " (estimate)" : ""} · ${node.attention === "passive" ? "Hands-off" : "Hands-on"}`;
export function meta(node: FoodNode, graph: CompiledGraph) {
  if (node.type === "ingredient") return `${node.quantity} ${node.unit}`;
  if (node.type === "action")
    return `${time(node.scheduled_duration_seconds)} · ${node.attention}${node.scheduled_duration_source === "estimate" ? " · est." : ""}`;
  return graph.outputs.includes(node.id)
    ? "Finished dish"
    : "Intermediate state";
}

export function createModel({ graph, steps }: ViewerData) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const actions = steps.map((id) => {
    const node = byId.get(id);
    if (!node || node.type !== "action")
      throw new Error(`Invalid action ID: ${id}`);
    return node;
  });
  const connections: Connection[] = graph.edges.map((edge) => ({
    ...edge,
    kind: "food",
  }));
  for (const node of actions) {
    for (const from of node.dependsOn)
      connections.push({ from, to: node.id, kind: "order" });
  }
  const predecessors = new Map(
    graph.nodes.map((node) => [node.id, [] as string[]]),
  );
  const successors = new Map(
    graph.nodes.map((node) => [node.id, [] as string[]]),
  );
  for (const { from, to } of connections) {
    predecessors.get(to)!.push(from);
    successors.get(from)!.push(to);
  }
  // Collapse food states only for the action minimap, retaining ordering edges.
  const actionLinks: Connection[] = [];
  for (const node of actions) {
    const parents = new Map<string, Connection["kind"]>(
      node.dependsOn.map((id) => [id, "order"]),
    );
    for (const input of predecessors.get(node.id)!) {
      if (byId.get(input)!.type === "food_state")
        parents.set(predecessors.get(input)![0], "food");
    }
    for (const [from, kind] of parents)
      actionLinks.push({ from, to: node.id, kind });
  }
  return {
    graph,
    steps,
    byId,
    actions,
    connections,
    predecessors,
    successors,
    actionLinks,
  };
}
export type Model = ReturnType<typeof createModel>;

// Confirming an action also confirms its transitive prerequisites and food outputs.
export function completedNodes(model: Model, confirmed: ReadonlySet<string>) {
  const done = new Set<string>();
  const pending = [...confirmed];
  while (pending.length) {
    const id = pending.pop()!;
    if (done.has(id)) continue;
    done.add(id);
    pending.push(...model.predecessors.get(id)!);
    if (model.byId.get(id)!.type === "action") {
      for (const output of model.successors.get(id)!) {
        if (model.byId.get(output)!.type === "food_state") done.add(output);
      }
    }
  }
  return done;
}

export function lines(text: string, max = 27) {
  const result = [""];
  for (let word of text.split(/\s+/)) {
    while (word.length > max) {
      if (result.at(-1)) result.push("");
      result[result.length - 1] = word.slice(0, max);
      result.push("");
      word = word.slice(max);
    }
    const last = result.length - 1;
    if (result[last] && result[last].length + word.length + 1 > max)
      result.push(word);
    else result[last] += (result[last] ? " " : "") + word;
  }
  return result.filter(Boolean);
}

export function makeLayout(
  nodes: FoodNode[],
  links: Connection[],
  options: dagre.GraphLabel,
  nodeSize: (node: FoodNode) => { width: number; height: number },
) {
  const layout = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({ ...options, ranker: "longest-path" })
    .setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) layout.setNode(node.id, nodeSize(node));
  links.forEach((edge, i) =>
    layout.setEdge(
      edge.from,
      edge.to,
      { weight: edge.kind === "food" ? 3 : 1 },
      String(i),
    ),
  );
  const rank = new Map<string, number>();
  for (const id of dagre.graphlib.alg.topsort(layout)) {
    rank.set(
      id,
      (layout.predecessors(id) ?? []).reduce(
        (max, parent) => Math.max(max, rank.get(parent)! + 1),
        0,
      ),
    );
  }
  const bottom = Math.max(...rank.values());
  for (const node of nodes) {
    if (!layout.successors(node.id)?.length) rank.set(node.id, bottom);
  }
  for (const edge of layout.edges())
    layout.edge(edge).minlen = rank.get(edge.w)! - rank.get(edge.v)!;
  dagre.layout(layout);
  return layout;
}
export function edgePath(
  layout: dagre.graphlib.Graph,
  edge: Connection,
  index: number,
) {
  return layout
    .edge({ v: edge.from, w: edge.to, name: String(index) })
    .points.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
}
