import { labels, meta, name, time, type Model } from "../model";

export function NodeDetails({
  model,
  actionsOnly,
  done,
  selected,
  onSelect,
}: {
  model: Model;
  actionsOnly: boolean;
  done: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const links = (title: string, ids: string[]) =>
    ids.length > 0 && (
      <>
        <h3>{title}</h3>
        <div className="node-list">
          {ids.map((id) => {
            const node = model.byId.get(id)!;
            return (
              <button
                type="button"
                className="detail-button"
                key={id}
                onClick={() => onSelect(id)}
              >
                {name(node)}
                {node.type === "ingredient"
                  ? ` · ${node.quantity} ${node.unit}`
                  : ""}
              </button>
            );
          })}
        </div>
      </>
    );
  const node = selected ? model.byId.get(selected)! : null;
  const connections = actionsOnly ? model.actionLinks : model.connections;
  return (
    <aside aria-label="Node details">
      <div id="details" aria-live="polite">
        {!node ? (
          <>
            <h2>Explore the recipe</h2>
            <p>
              Select a node to inspect its inputs, outputs, and cooking details.
            </p>
            {links(
              "Jump to an action",
              model.actions.map((action) => action.id),
            )}
          </>
        ) : (
          <>
            <p className="muted">{labels[node.type]}{done.has(node.id) ? " · ✓ Done" : ""}</p>
            <h2>{name(node)}</h2>
            <p>{meta(node, model.graph)}</p>
            {node.type === "action" && (
              <>
                <p>{node.instruction}</p>
                <h3>Timing</h3>
                <p>
                  {time(node.scheduled_duration_seconds)} planned ·{" "}
                  {node.scheduled_duration_source === "estimate"
                    ? "Estimated duration"
                    : "Recipe duration"}
                </p>
                <h3>Resources</h3>
                <p>
                  {node.cooksRequired} cook{node.cooksRequired === 1 ? "" : "s"}{" "}
                  ·{" "}
                  {node.equipment
                    .map((id) => id.replace(/_/g, " "))
                    .join(", ") || "No equipment"}
                </p>
              </>
            )}
            {links(
              actionsOnly ? "Actions supplying food" : "Food inputs",
              connections
                .filter((edge) => edge.kind === "food" && edge.to === selected)
                .map((edge) => edge.from),
            )}
            {links(
              actionsOnly ? "Actions using this output" : "Food outputs / used by",
              connections
                .filter((edge) => edge.kind === "food" && edge.from === selected)
                .map((edge) => edge.to),
            )}
            {links("Must follow", node.type === "action" ? node.dependsOn : [])}
            {links(
              "Must precede",
              model.connections
                .filter(
                  (edge) => edge.kind === "order" && edge.from === selected,
                )
                .map((edge) => edge.to),
            )}
            <h3>Node ID</h3>
            <code>{selected}</code>
          </>
        )}
      </div>
    </aside>
  );
}
