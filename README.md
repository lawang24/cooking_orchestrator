# Cooking orchestrator

This cooking orchestrator will sort, assign, and and schedule all the steps in your recipes so your cooking can smoothly and efficiently.

## How to Use

1. Input the structured representation (use LLM to generate from recipe) of your recipes
2. Adjust settings (how many people, target finish time, etc)
3. Review recipe graph
4. Start the orchestration process when ready

## How Recipes are Represented

Recipes are represented as a directed graph of

1. ingredients
2. actions
3. intermediate food states.

Example:
potato -> boil 10 minutes -> boiled potatoes

Recipe input uses a simpler, step-oriented JSON format: `ingredients` lists each
ingredient and its portions, and `steps` defines operations with food inputs and outputs.
The compiler creates the ingredient, action, and food-state nodes and their edges.
You do not write a separate node or edge list. See
`schemas/recipe.example.json` and `schemas/recipe.schema.json`.

Each ingredient key is a canonical identity such as `light_soy_sauce`. Use the
same identity for the same ingredient across recipes; identities are currently
author-supplied, not catalog-validated. Each use of the ingredient is a named
portion:

```json
"water": {
  "name": "Water",
  "portions": {
    "marinade_water": {"quantity": 1, "unit": "tbsp", "name": "Water for marinade"},
    "sauce_water": {"quantity": 0.25, "unit": "cup", "name": "Water for sauce"}
  }
}
```

The compiler generates one ingredient node (`water`, 5 tbsp in total), one
`measure_water` action, and one food state per portion. Steps consume portion
IDs such as `sauce_water` directly. Measure steps are not written by hand; the
generated action defaults to 30 seconds plus 15 per extra portion, with equipment
chosen from the units. An optional ingredient-level `measure` object overrides
`duration` or `equipment`. Portions of one ingredient must all be volumes, weights,
or whole counts so they can be totaled.

Each step declares an `operation`, such as `slice` or `mix`, alongside its
instruction, duration, attention, cooks required, and equipment. Step outputs
need only an `id` and `name`; ingredient identity, quantity, and unit can be
supplied together.

Ingredient, step, and output IDs must be unique within a recipe. Steps need not
be listed in execution order: food inputs establish dependencies, and optional
`dependsOn` adds extra step ordering. Recipe-level `outputs` identifies the finished
food states. Timings remain planning values, not automatic completion triggers.

The example's 12 ingredients produce 12 measure actions and 16 portions, each
kept separate until its consuming step. A future meal planner can group the same
ingredient's measuring across recipes. Multi-recipe batching and scheduling are
not implemented yet.

## Visualize a recipe

One-time setup, from this project directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-validation.txt
```

Generate and open the beef-onion graph:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.recipe.json --open
```

The default output is `visualizations/<recipeId>.html`. Use the same command with any JSON file matching `schemas/recipe.schema.json`. The visualizer validates and compiles it into the internal graph before rendering. Rerun after changing the JSON; already generated HTML is a snapshot, not a live file watcher.

To choose an output path:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.recipe.json --output visualizations/dinner.html
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
.venv/bin/python scripts/compile_recipe.py recipes/beef-onion-stir-fry.recipe.json
.venv/bin/python -m unittest discover -s tests -v
```

To export and independently validate the internal graph:

```sh
.venv/bin/python scripts/compile_recipe.py recipes/beef-onion-stir-fry.recipe.json -o visualizations/beef-onion-stir-fry.graph.json
.venv/bin/python scripts/validate_recipe_graph.py visualizations/beef-onion-stir-fry.graph.json
```

Input schema validation is followed by graph checks for unique IDs, valid references,
single-use portions, cycles, and contribution to a finished output. The compiler preserves
recipe metadata, duration provenance, and explicit action ordering.

## Implementation

- `schemas/recipe.schema.json`: step-oriented input contract.
- `schemas/recipe.example.json`: golden example recipe, used by tests and the LLM guide.
- `recipes/`: saved recipes, one `<recipeId>.recipe.json` file each.
- `scripts/compile_recipe.py`: validates input and constructs the dependency graph.
- `scripts/validate_recipe_graph.py`: validates internal graph semantics.
- `scripts/visualize_recipe_graph.py`: compiles recipe JSON and packages the HTML viewer.
- `scripts/recipe_graph_viewer.html`: shared viewer template, including pan, zoom, and node inspection.
- `scripts/vendor/dagre-1.1.5.min.js`: bundled Dagre layout engine, version 1.1.5, obtained from `https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.5/dist/dagre.min.js`. Its MIT license is in `scripts/vendor/dagre-LICENSE` and included in generated HTML.

The renderer uses only the input graph; no recipe-specific nodes or layout positions are hardcoded. Recipe text is rendered as text, not executable markup.
