import { useMemo } from "react";
import { edgePath, makeLayout, timing, type Model } from "../model";

export interface PlayerProps {
  model: Model;
  index: number;
  done: ReadonlySet<string>;
  hidden: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onMap: () => void;
}
export function StepPlayer({
  model,
  index,
  done,
  hidden,
  onPrevious,
  onNext,
  onMap,
}: PlayerProps) {
  const { actions, actionLinks, steps } = model;
  const layout = useMemo(
    () =>
      makeLayout(
        actions,
        actionLinks,
        { rankdir: "TB", ranksep: 12, nodesep: 15, marginx: 10, marginy: 10 },
        () => ({ width: 10, height: 10 }),
      ),
    [model],
  );
  const node = actions[index];
  const last = index === actions.length - 1;
  const finished = last && done.has(node.id);
  const count = steps.filter((id) => done.has(id)).length;
  const current = layout.node(node.id);
  return (
    <main id="stepbar" aria-label="Current cooking action" hidden={hidden}>
      <div className="action-focus">
        <div aria-live="polite" aria-atomic="true">
          <p id="step-timing">{timing(node)}</p>
          <h1 id="step-instruction">{node.instruction}</h1>
          <p id="step-tools" hidden={!node.equipment.length}>
            Use {node.equipment.map((id) => id.replace(/_/g, " ")).join(", ")}
          </p>
        </div>
        <nav className="step-controls" aria-label="Step navigation">
          <button
            id="previous"
            type="button"
            disabled={index === 0 && !finished}
            onClick={onPrevious}
            aria-label={finished ? "Undo finish" : "Previous step"}
          >
            {finished ? "Undo finish" : "← Previous"}
          </button>
          <button
            id="next"
            type="button"
            disabled={finished}
            onClick={onNext}
            aria-label={
              last
                ? finished
                  ? "✓ Done"
                  : "Finish step"
                : "Complete step and go to next"
            }
          >
            {last ? (finished ? "✓ Done" : "Finish step") : "Next →"}
          </button>
        </nav>
      </div>
      <button
        id="map-button"
        type="button"
        title="Open whole graph"
        aria-controls="graph-panel"
        onClick={onMap}
        aria-label={`Open whole graph. ${count} of ${steps.length} actions done.`}
      >
        <span className="map-caption">
          <strong>Recipe map</strong>
          <small id="map-count">
            {count} / {steps.length} done
          </small>
        </span>
        <svg
          id="minimap"
          aria-hidden="true"
          viewBox={`0 0 ${layout.graph().width} ${layout.graph().height}`}
        >
          <g id="map-links">
            {actionLinks.map((edge, i) => (
              <path
                key={i}
                className={`map-link ${edge.kind}${done.has(edge.from) && done.has(edge.to) ? " done" : ""}`}
                data-from={edge.from}
                data-to={edge.to}
                d={edgePath(layout, edge, i)}
              />
            ))}
          </g>
          <g id="map-nodes">
            {actions.map((action) => (
              <circle
                key={action.id}
                data-id={action.id}
                className={`map-node${done.has(action.id) ? " done" : ""}`}
                cx={layout.node(action.id).x}
                cy={layout.node(action.id).y}
                r={5}
              />
            ))}
          </g>
          <circle id="map-current" r={9} cx={current.x} cy={current.y} />
        </svg>
      </button>
    </main>
  );
}
