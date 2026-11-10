import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { completedNodes, createModel, name } from "./model";
import type { ViewerData } from "./types";
import { GraphView } from "./components/GraphView";
import { IngredientList, RecipeDocument } from "./components/RecipeDocument";
import { StepPlayer } from "./components/StepPlayer";
import { useArrowNavigation } from "./useArrowNavigation";

import {
  advance,
  createSchedule,
  currentAction,
  initialCookingState,
  type CookingEvent,
  type CookingState,
} from "./scheduler";

export function App({ graph, steps }: ViewerData) {
  const model = useMemo(() => createModel({ graph, steps }), [graph, steps]);
  const schedule = useMemo(
    () => createSchedule(model.actions, model.actionLinks),
    [model],
  );
  const [history, dispatch] = useReducer(
    (history: CookingState[], event: CookingEvent | { type: "undo" }) => {
      if (event.type === "undo")
        return history.length > 1 ? history.slice(0, -1) : history;
      const state = history[history.length - 1];
      const next = advance(schedule, state, event);
      return next === state ? history : [...history, next];
    },
    [initialCookingState],
  );
  const state = history[history.length - 1];
  const current = currentAction(schedule, state);
  const [preview, setPreview] = useState<string>();
  const node = preview
    ? model.actions.find((action) => action.id === preview)
    : current;
  const done = useMemo(
    () => completedNodes(model, state.done),
    [model, state.done],
  );
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [overview, setOverview] = useState(false);
  const [panel, setPanel] = useState("progress");
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (started) {
      window.scrollTo(0, 0);
      document.getElementById("step-instruction")?.focus();
    }
  }, [started]);
  const showOverview = useCallback((open: boolean, nextPanel?: string) => {
    setOverview(open);
    if (nextPanel) setPanel(nextPanel);
    toggle.current?.focus();
    window.scrollTo(0, 0);
  }, []);
  const closeOverview = useCallback(() => showOverview(false), [showOverview]);
  useArrowNavigation(started, overview, closeOverview);
  return (
    <div id="viewer" data-hydrated={ready ? "true" : "false"}>
      {ready && !started && (
        <main className="ingredient-review" aria-labelledby="recipe-title">
          <h1 id="recipe-title">{graph.name}</h1>
          {graph.servings && <p className="muted">Serves {graph.servings}</p>}
          <h2>Ingredients</h2>
          <IngredientList graph={graph} />
          <button type="button" id="start-recipe" onClick={() => setStarted(true)}>
            Start recipe
          </button>
        </main>
      )}
      <button
        id="overview-toggle"
        ref={toggle}
        type="button"
        hidden={!started}
        aria-expanded={overview}
        aria-controls="overview"
        onClick={() => showOverview(!overview)}
      >
        {overview ? "Back to step" : "Overview"}
      </button>
      <StepPlayer
        model={model}
        node={node}
        state={state}
        preview={Boolean(preview)}
        canUndo={history.length > 1}
        hidden={!started || overview}
        onUndo={() => dispatch({ type: "undo" })}
        onReturn={() => setPreview(undefined)}
        onEvent={dispatch}
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
            {state.done.size} of {steps.length} done
          </h2>
          <ol id="progress-list">
            {model.actions.map((node, i) => (
              <li key={node.id}>
                <button
                  type="button"
                  aria-current={current?.id === node.id ? "step" : undefined}
                  onClick={() => {
                    setPreview(node.id === current?.id ? undefined : node.id);
                    showOverview(false);
                  }}
                >
                  <span className="step-number">{i + 1}</span>
                  {name(node)}
                  <span className="step-status">
                    {state.done.has(node.id)
                      ? "✓ Done"
                      : state.running.has(node.id)
                        ? "In progress"
                        : ""}
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
