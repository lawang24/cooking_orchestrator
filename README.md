# Cooking orchestrator

Recipes are graphs of ingredients, actions, and intermediate food states. Food-flow edges connect inputs → actions → outputs. Action `dependsOn` fields add ordering constraints.

## Visualize a recipe

One-time setup, from this project directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-validation.txt
```

Generate and open the beef-onion graph:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.graph.json --open
```

The default output is `visualizations/<recipeId>.html`. Use the same command with any JSON file matching `schemas/recipe-graph.schema.json`. Rerun after changing the JSON; already generated HTML is a snapshot, not a live file watcher.

To choose an output path:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.graph.json --output visualizations/dinner.html
```

The output is self-contained and works offline. Open it directly in a browser; no server, account, or network connection is needed. Existing output HTML is replaced on each run. Invalid graphs fail validation before writing output.

### Viewer controls

- Ingredients, actions, and food states have distinct labels, colors, and shapes. Ingredient quantities and action durations appear on the nodes.
- Solid arrows represent food flow. Dashed arrows represent required action ordering.
- Scroll to zoom, drag to pan, or use **Fit graph**, **100%**, and the zoom buttons.
- Select a node to highlight its immediate connections and inspect its complete details. Use the linked nodes in the detail panel to navigate. **Jump to an action** centers that action at readable size.
- Switch between top-to-bottom and left-to-right layout. **Show ordering** hides only the dashed lines; their layout constraints and node details remain intact.
- Keyboard users can tab to graph nodes and press Enter or Space to select and center them; Escape clears selection.

This displays dependencies, not an execution schedule. It does not assign cooks or resolve equipment availability. Timings marked `est.` are estimates.

## Validation and tests

```sh
.venv/bin/python scripts/validate_recipe_graph.py recipes/beef-onion-stir-fry.graph.json
.venv/bin/python -m unittest discover -s tests -v
```

## Implementation

- `scripts/visualize_recipe_graph.py`: validates JSON and packages the HTML viewer.
- `scripts/recipe_graph_viewer.html`: shared viewer template, including pan, zoom, and node inspection.
- `scripts/vendor/dagre-1.1.5.min.js`: bundled Dagre layout engine, version 1.1.5, obtained from `https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.5/dist/dagre.min.js`. Its MIT license is in `scripts/vendor/dagre-LICENSE` and included in generated HTML.

The renderer uses only the input graph; no recipe-specific nodes or layout positions are hardcoded. Recipe text is rendered as text, not executable markup.
