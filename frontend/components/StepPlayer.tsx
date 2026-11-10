import { useMemo } from "react";
import { edgePath, makeLayout, name, timing, type Model } from "../model";

import type { CookingState } from "../scheduler";
import type { ActionNode } from "../types";

interface PlayerProps {
  model: Model;
  node?: ActionNode;
  state: CookingState;
  hidden: boolean;
  preview: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onReturn: () => void;
  onFinish: (id: string) => void;
  onMap: () => void;
}
export function StepPlayer({
  model,
  node,
  state,
  hidden,
  preview,
  canUndo,
  onUndo,
  onReturn,
  onFinish,
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
  const { done, running } = state;
  const passive = actions.filter(
    (action) => action.attention === "passive" && running.has(action.id),
  );
  const current = node && layout.node(node.id);
  let message = "This recipe needs more than one cook to continue.";
  if (done.size === steps.length) message = "Recipe complete";
  else if (running.size) message = "Waiting for a task in progress";
  return (
    <main id="stepbar" aria-label="Current cooking action" hidden={hidden}>
      <div className="action-focus">
        <div aria-live="polite" aria-atomic="true">
          {node && (
            <p id="step-timing">
              {preview ? "Preview · " : "In progress · "}
              {timing(node)}
            </p>
          )}
          <h1 id="step-instruction" tabIndex={-1}>{node?.instruction ?? message}</h1>
          {node && node.equipment.length > 0 && (
            <p id="step-tools">
              Use {node.equipment.map((id) => id.replace(/_/g, " ")).join(", ")}
            </p>
          )}
        </div>
        <nav className="step-controls" aria-label="Cooking controls">
          <button
            id="previous"
            type="button"
            disabled={!canUndo || preview}
            onClick={onUndo}
          >
            Undo last action
          </button>
          <button
            id="next"
            type="button"
            hidden={!preview && !node}
            disabled={!preview && !node}
            onClick={() => {
              if (preview) onReturn();
              else if (node) onFinish(node.id);
            }}
          >
            {preview ? "Back to cooking" : "Done"}
          </button>
        </nav>
        {passive.length > 0 && (
          <section
            className="running-tasks"
            aria-label="Passive tasks in progress"
          >
            <h2>In progress</h2>
            <ul>
              {passive.map((action) => (
                <li key={action.id}>
                  <div>
                    <strong>{name(action)}</strong>
                    <p>{action.instruction}</p>
                    <small>{timing(action)}</small>
                  </div>
                  <button
                    type="button"
                    aria-label={`Done — ${name(action)}`}
                    onClick={() => {
                      onReturn();
                      onFinish(action.id);
                    }}
                  >
                    Done
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <button
        id="map-button"
        type="button"
        title="Open whole graph"
        aria-controls="graph-panel"
        onClick={onMap}
        aria-label={`Open whole graph. ${done.size} of ${steps.length} actions done.`}
      >
        <span className="map-caption">
          <strong>Recipe map</strong>
          <small id="map-count">
            {done.size} / {steps.length} done
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
          {current && (
            <circle id="map-current" r={9} cx={current.x} cy={current.y} />
          )}
        </svg>
      </button>
    </main>
  );
}
