import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  edgePath,
  labels,
  lines,
  makeLayout,
  meta,
  name,
  type Model,
} from "../model";
import { NodeDetails } from "./NodeDetails";

export function GraphView({
  model,
  done,
  active,
}: {
  model: Model;
  done: ReadonlySet<string>;
  active: boolean;
}) {
  const [direction, setDirection] = useState("TB");
  const [orders, setOrders] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  const moved = useRef(false);
  const { graph, connections } = model;
  useEffect(() => {
    if (active) setLoaded(true);
  }, [active]);
  const layout = useMemo(
    () =>
      loaded
        ? makeLayout(
            graph.nodes,
            connections,
            {
              rankdir: direction,
              ranksep: 65,
              nodesep: 24,
              marginx: 25,
              marginy: 25,
            },
            (node) => ({
              width: 244,
              height: 70 + lines(name(node)).length * 19,
            }),
          )
        : null,
    [model, direction, loaded],
  );

  const fit = useCallback(() => {
    if (!layout || !svg.current) return;
    const { width, height } = svg.current.getBoundingClientRect();
    if (!width || !height) return;
    const bounds = layout.graph();
    const scale = Math.max(
      0.01,
      Math.min((width - 40) / bounds.width!, (height - 40) / bounds.height!, 1),
    );
    setView({
      scale,
      x: (width - bounds.width! * scale) / 2,
      y: (height - bounds.height! * scale) / 2,
    });
  }, [layout]);
  const zoom = useCallback((factor: number, x?: number, y?: number) => {
    const cx = x ?? (svg.current?.clientWidth ?? 0) / 2;
    const cy = y ?? (svg.current?.clientHeight ?? 0) / 2;
    setView((previous) => {
      const scale = Math.max(0.01, Math.min(3, previous.scale * factor));
      return {
        scale,
        x: cx - ((cx - previous.x) * scale) / previous.scale,
        y: cy - ((cy - previous.y) * scale) / previous.scale,
      };
    });
  }, []);
  useEffect(() => {
    if (active) fit();
  }, [active, fit]);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(() => {
      if (active) fit();
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, [active, fit]);
  useEffect(() => {
    const element = svg.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      zoom(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  function select(id: string, center = false) {
    setSelected(id);
    if (center && layout && svg.current) {
      const point = layout.node(id);
      setView({
        scale: 1,
        x: svg.current.clientWidth / 2 - point.x,
        y: svg.current.clientHeight / 2 - point.y,
      });
    }
  }
  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || event.pointerId !== drag.current.id) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const near = new Set(selected ? [selected] : []);
  for (const edge of connections) {
    if (
      (edge.kind === "food" || orders) &&
      (edge.from === selected || edge.to === selected)
    ) {
      near.add(edge.from);
      near.add(edge.to);
    }
  }
  return (
    <section id="graph-panel" aria-label="Whole graph" hidden={!active}>
      <div className="graph-summary">
        <h2 id="title">{graph.name}</h2>
        <div id="summary" className="muted">
          {graph.recipes
            ? `${graph.recipes.length} recipes`
            : `${graph.servings} servings`}{" "}
          · {graph.nodes.length} nodes · {graph.edges.length} food-flow links ·{" "}
          {connections.length - graph.edges.length} ordering links
        </div>
        <div className="legend" aria-label="Graph legend">
          <span className="key">
            <span className="swatch ingredient" />
            Ingredient
          </span>
          <span className="key">
            <span className="swatch action" />
            Action
          </span>
          <span className="key">
            <span className="swatch food_state" />
            Food state
          </span>
          <span className="key">
            <span className="line" />
            Food flow
          </span>
          <span className="key">
            <span className="line order" />
            Required order
          </span>
        </div>
      </div>
      <div className="toolbar" aria-label="Diagram controls">
        <button id="fit" type="button" onClick={fit}>
          Fit graph
        </button>
        <button
          id="minus"
          type="button"
          aria-label="Zoom out"
          onClick={() => zoom(1 / 1.3)}
        >
          −
        </button>
        <output id="zoom" aria-label="Zoom level">
          {Math.round(view.scale * 100)}%
        </output>
        <button
          id="plus"
          type="button"
          aria-label="Zoom in"
          onClick={() => zoom(1.3)}
        >
          +
        </button>
        <button id="actual" type="button" onClick={() => zoom(1 / view.scale)}>
          100%
        </button>
        <label>
          Direction{" "}
          <select
            id="direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="LR">Left to right</option>
            <option value="TB">Top to bottom</option>
          </select>
        </label>
        <label>
          <input
            id="orders"
            type="checkbox"
            checked={orders}
            onChange={(event) => setOrders(event.target.checked)}
          />{" "}
          Show ordering
        </label>
        <button id="clear" type="button" onClick={() => setSelected(null)}>
          Clear selection
        </button>
      </div>
      <div className="workspace">
        <div className="canvas" id="canvas">
          <svg
            id="diagram"
            ref={svg}
            className={dragging ? "dragging" : ""}
            role="group"
            aria-label="Recipe dependency graph. Select a node for details."
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                tx: view.x,
                ty: view.y,
              };
              moved.current = false;
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || event.pointerId !== start.id) return;
              const dx = event.clientX - start.x,
                dy = event.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 4) {
                moved.current = true;
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }
              if (moved.current)
                setView((previous) => ({
                  ...previous,
                  x: start.tx + dx,
                  y: start.ty + dy,
                }));
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(event) => {
              if (!moved.current && !(event.target as Element).closest(".node"))
                setSelected(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && selected) {
                event.preventDefault();
                event.stopPropagation();
                setSelected(null);
              }
            }}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge)" />
              </marker>
            </defs>
            <g
              id="viewport"
              transform={`translate(${view.x},${view.y}) scale(${view.scale})`}
            >
              <g id="edges">
                {layout &&
                  connections.map((edge, i) => {
                    const related =
                      edge.from === selected || edge.to === selected;
                    return (
                      <path
                        key={i}
                        d={edgePath(layout, edge, i)}
                        markerEnd="url(#arrow)"
                        data-index={i}
                        className={`edge ${edge.kind}${selected && !related ? " dim" : ""}${related ? " related" : ""}`}
                        style={{
                          display:
                            edge.kind === "order" && !orders
                              ? "none"
                              : undefined,
                        }}
                      />
                    );
                  })}
              </g>
              <g id="nodes">
                {layout &&
                  graph.nodes.map((node) => {
                    const point = layout.node(node.id),
                      completed = done.has(node.id);
                    return (
                      <g
                        key={node.id}
                        data-id={node.id}
                        className={`node ${node.type}-node${completed ? " done" : ""}${node.id === selected ? " selected" : ""}${selected && !near.has(node.id) ? " dim" : ""}`}
                        transform={`translate(${point.x - point.width / 2},${point.y - point.height / 2})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${labels[node.type]}: ${name(node)}. ${meta(node, graph)}${completed ? ". Done" : ""}`}
                        aria-pressed={node.id === selected}
                        onClick={() => {
                          if (!moved.current) select(node.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            select(node.id, true);
                          }
                        }}
                      >
                        <rect
                          width={point.width}
                          height={point.height}
                          rx={
                            node.type === "ingredient"
                              ? 24
                              : node.type === "food_state"
                                ? 12
                                : 3
                          }
                        />
                        <text x={16} y={22} className="category">
                          {labels[node.type]}
                          {completed ? " · ✓ DONE" : ""}
                        </text>
                        {lines(name(node)).map((line, i) => (
                          <text key={i} x={16} y={45 + i * 19}>
                            {line}
                          </text>
                        ))}
                        <text x={16} y={point.height - 15} className="meta">
                          {meta(node, graph)}
                        </text>
                      </g>
                    );
                  })}
              </g>
            </g>
          </svg>
          <div className="hint">
            Scroll to zoom · Drag to pan · Select a node
          </div>
        </div>
        <NodeDetails
          model={model}
          selected={selected}
          onSelect={(id) => select(id, true)}
        />
      </div>
    </section>
  );
}
