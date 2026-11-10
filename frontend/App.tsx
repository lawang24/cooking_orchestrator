import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { completedNodes, createModel, name, type Model } from "./model";
import type { ViewerData } from "./types";
import { GraphView } from "./components/GraphView";
import { RecipeDocument } from "./components/RecipeDocument";
import { StepPlayer } from "./components/StepPlayer";
import { useArrowNavigation } from "./useArrowNavigation";

interface Progress {
  index: number;
  confirmed: Set<string>;
}
type Navigation =
  | { type: "next" | "previous" }
  | { type: "jump"; index: number };
function navigate(model: Model, state: Progress, event: Navigation): Progress {
  const { steps } = model;
  const confirmed = new Set(state.confirmed);
  if (event.type === "next") {
    confirmed.add(steps[state.index]);
    return { index: Math.min(steps.length - 1, state.index + 1), confirmed };
  }
  const finished =
    state.index === steps.length - 1 &&
    completedNodes(model, confirmed).has(steps[state.index]);
  const index =
    event.type === "jump"
      ? event.index
      : Math.max(0, state.index - (finished ? 0 : 1));
  if (index < state.index || event.type === "previous") {
    for (const id of steps.slice(index)) confirmed.delete(id);
  }
  return { index, confirmed };
}

export function App({ graph, steps }: ViewerData) {
  const model = useMemo(() => createModel({ graph, steps }), [graph, steps]);
  const [progress, dispatch] = useReducer(
    (state: Progress, event: Navigation) => navigate(model, state, event),
    { index: 0, confirmed: new Set<string>() },
  );
  const done = useMemo(
    () => completedNodes(model, progress.confirmed),
    [model, progress.confirmed],
  );
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState(false);
  const [panel, setPanel] = useState("progress");
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setReady(true);
  }, []);
  const showOverview = useCallback((open: boolean, nextPanel?: string) => {
    setOverview(open);
    if (nextPanel) setPanel(nextPanel);
    toggle.current?.focus();
    window.scrollTo(0, 0);
  }, []);
  const closeOverview = useCallback(() => showOverview(false), [showOverview]);
  useArrowNavigation(overview, closeOverview);
  return (
    <div id="viewer" data-hydrated={ready ? "true" : "false"}>
      <button
        id="overview-toggle"
        ref={toggle}
        type="button"
        hidden={!ready}
        aria-expanded={overview}
        aria-controls="overview"
        onClick={() => showOverview(!overview)}
      >
        {overview ? "Back to step" : "Overview"}
      </button>
      <StepPlayer
        model={model}
        index={progress.index}
        done={done}
        hidden={!ready || overview}
        onNext={() => dispatch({ type: "next" })}
        onPrevious={() => dispatch({ type: "previous" })}
        onMap={() => showOverview(true, "graph")}
      />
      <section id="overview" aria-label="Overview" hidden={ready && !overview}>
        <header hidden={!ready}>
          <h1>Overview</h1>
        </header>
        <nav
          className="panel-nav"
          aria-label="Overview sections"
          hidden={!ready}
        >
          {[
            ["progress", "Progress"],
            ["graph", "Whole graph"],
            ["recipes", "Recipes"],
          ].map(([id, title]) => (
            <button
              key={id}
              type="button"
              aria-controls={`${id}-panel`}
              aria-pressed={panel === id}
              onClick={() => setPanel(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <section
          id="progress-panel"
          className="info-pane"
          aria-label="Progress"
          hidden={!ready || panel !== "progress"}
        >
          <h2 id="step-count">
            Step {progress.index + 1} of {steps.length}
          </h2>
          <ol id="progress-list">
            {model.actions.map((node, i) => (
              <li key={node.id}>
                <button
                  type="button"
                  aria-current={progress.index === i ? "step" : undefined}
                  onClick={() => {
                    dispatch({ type: "jump", index: i });
                    showOverview(false);
                  }}
                >
                  <span className="step-number">{i + 1}</span>
                  {name(node)}
                  <span className="step-status">
                    {done.has(node.id) ? "✓ Done" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <GraphView
          model={model}
          done={done}
          active={ready && overview && panel === "graph"}
        />
        <RecipeDocument model={model} hidden={ready && panel !== "recipes"} />
      </section>
    </div>
  );
}
