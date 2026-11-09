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

Recipe input uses a step-oriented JSON format: `ingredients` lists the total
amount of each ingredient needed for the recipe, and `steps` explicitly defines
all operations, including measurement. The compiler creates nodes and edges from
these declarations; it does not invent measurement actions or calculate starting
totals. See `schemas/recipe.example.json` and `schemas/recipe.schema.json`.

Each ingredient key is a canonical identity such as `light_soy_sauce`. Use the
same identity for the same ingredient across recipes; identities are currently
author-supplied, not catalog-validated. For example, water starts as one total:

```json
"water": {"name": "Water", "quantity": 5, "unit": "tbsp"}
```

An explicit step measures that total into separate food states for its uses:

```json
{
  "id": "measure_water",
  "operation": "measure",
  "instruction": "Measure water separately for the marinade and sauce.",
  "scheduled_duration_seconds": 45,
  "scheduled_duration_source": "estimate",
  "attention": "active",
  "cooksRequired": 1,
  "equipment": ["measuring_spoons", "measuring_cup"],
  "inputs": ["water"],
  "outputs": [
    {"id": "marinade_water", "name": "Water for marinade", "ingredient": "water", "quantity": 1, "unit": "tbsp"},
    {"id": "sauce_water", "name": "Water for sauce", "ingredient": "water", "quantity": 0.25, "unit": "cup"}
  ]
}
```

Every starting ingredient must feed an explicit `measure` step. An ingredient
used once needs just one measured output; split it into multiple purpose-specific
outputs when necessary. Measurement has one food input, and its outputs must
retain the ingredient identity and add up to the input amount in compatible
units. Here, 1 tbsp + 0.25 US cup = 5 tbsp. Each measured state is consumed once.
Authors supply measurement instructions, duration, cooks, equipment, and any
extra prerequisites just as they do for other steps.

Each step declares an `operation`, such as `slice` or `mix`, alongside its
instruction, duration, attention, cooks required, and equipment. Step outputs
need an `id` and `name`; measurement outputs also require ingredient identity,
quantity, and unit. For other steps these three fields are optional as a group.

Ingredient, step, and output IDs must be unique within a recipe. Steps need not
be listed in execution order: food inputs establish dependencies, and optional
`dependsOn` adds extra step ordering. Recipe-level `outputs` identifies the finished
food states. Timings remain planning values, not automatic completion triggers.

Timing is stored directly on each step (and compiled action), without a separate
`duration` object:

- `scheduled_duration_seconds`: positive integer seconds for future scheduling and calculations.
- `scheduled_duration_source`: `source` when the number comes from a recipe timing
  (including a value chosen within its stated range), or `estimate` when inferred.
  A total that includes estimated setup or transfer time is also an estimate.

Put source time ranges and observable completion cues in the cooking instruction.

The example explicitly declares 12 ingredients, 12 measure actions and 16 measured portions, each
kept separate until its consuming step. Meal composition compiles and validates
each recipe independently, prefixes graph IDs with recipe tags, then combines
the graphs. A separate graph pass merges matching ingredient nodes and their
authored measurement actions when their units are compatible and the actions
exactly match the conventional template in `merge_recipe_graphs.py` (including
instructions, the 30 + 15 seconds per extra portion estimate, and equipment). It recalculates
the total quantity and measurement estimate while preserving each portion.
The combined graph is validated before and after merging.

Customized measurements remain separate, whether authored in JSON or edited after
compilation, as do all prep and cooking actions.
Gyudon counts onions whole and the beef-onion stir-fry uses ounces: both can
belong to the same meal, but their onion nodes and measurements stay separate.
Scheduling cooks and equipment remains future work.

Generate a combined meal graph and viewer with the experiment CLI:

```sh
.venv/bin/python experiments/meal-merge/merge_recipes.py \
  beef=recipes/beef-onion-stir-fry.recipe.json gyudon=recipes/gyudon.recipe.json
```

Outputs go to `tmp/compiled/meal-beef-gyudon.graph.json` and `.html`.
Tags must be unique, start with a lowercase letter, and contain only lowercase
letters, digits, or underscores. Each component retains its own serving count.
The Python API `merge_recipe_graphs([(tag, compiled_graph), ...])` takes compiled
single-recipe graphs; `build_graph` accepts only a recipe input.

See [AGENTS.md](AGENTS.md) for the repeatable workflow for converting recipe sources into validated graphs and generating their visualizations.

## Visualize a recipe

One-time setup, from this project directory, using Python 3.11 or newer:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-validation.txt
```

Generate and open the beef-onion graph:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.recipe.json --open
```

The default output is `visualizations/<recipeId>.html`. Use the same command with any JSON file matching `schemas/recipe.schema.json`. The visualizer validates and compiles it into the internal graph before rendering. Rerun after changing the JSON; already generated HTML is a snapshot, not a live file watcher.

The gyudon example includes independent egg and garnish preparation branches:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/gyudon.recipe.json --open
```

Its rice input is already cooked and hot. This version includes the optional sesame garnish; all action ordering follows food-flow edges.

To choose an output path:

```sh
.venv/bin/python scripts/visualize_recipe_graph.py recipes/beef-onion-stir-fry.recipe.json --output visualizations/dinner.html
```

The output is self-contained and works offline. Open it directly in a browser; no server, account, or network connection is needed. Existing output HTML is replaced on each run. Invalid graphs fail validation before writing output.

### Viewer controls

For an HTTP preview, run `npm run dev` after Python setup, then open
`http://127.0.0.1:8766/gyudon.html` (or `beef-onion-stir-fry.html`). The server
regenerates every recipe on startup and serves only the `visualizations/`
directory, bound to localhost. Restart after source changes, then refresh the
page. Stop with Ctrl+C; choose another port with `npm run dev -- --port 8767`.

- The viewer opens with one centered cooking instruction, its planned duration, and any equipment it needs. Choose **Next** or press **Right** to complete the current action and advance. Choose **Finish step** to complete the last action. **Previous** or **Left** undoes progress back to the action you revisit. Hold either arrow key to keep stepping in that direction. After finishing the last action, **Undo finish** reopens it.
- The bottom-right minimap shows one dot per action. Links run from earlier actions to the actions that use their food or require them to finish first. A ring marks the current action, and green dots mark completed actions. Click the minimap to explore the full graph, including ingredients and food states.
- Open **Overview** in the top-right corner. **Progress** shows your position in the ordered action list. Select an action to jump to it. **Recipes** lists the recipes in this viewer, their serving counts, and notes.
- **Whole graph** shows ingredients, actions, and food states. Solid arrows show food flow and dashed arrows show required ordering. Select a node to inspect it, or follow a linked node in its details. Scroll to zoom, drag to pan, or use the zoom, layout, and fit controls. **Show ordering** toggles the dashed arrows and retains their layout constraints.
- Choose **Back to step** to resume the current instruction after inspecting the overview. Escape also returns to the step. On a selected graph node, Escape first clears its selection.
- The action order follows food dependencies and explicit prerequisites. Source order breaks ties between independent actions. Completion lasts until the page reloads. Jumping ahead in the progress list only moves the current position. Jumping back rewinds completion to that action. Completing an action after a jump also marks its prerequisites done, while independent branches keep their own status.

## Validation and tests

The Python scripts share dictionary types for validated recipes and compiled
graphs in `scripts/recipe_types.py`. Run ty to check how the scripts use those
types and Ruff to check that function parameters and returns have annotations.
Run these commands from the repository root with the virtual environment set up.

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/ty check
.venv/bin/ruff check scripts
```

For a uv-managed environment, install the same dependencies with
`uv pip install --python .venv/bin/python -r requirements-dev.txt`.
Run the compiler and Python tests with:

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
single-use portions, explicit measurement, conserved measurement quantities, cycles,
and contribution to a finished output. The compiler preserves
recipe metadata, duration provenance, and explicit action ordering.

Keyboard and selection behavior also have isolated DOM tests (Node.js 18+):

```sh
npm ci
npm run test:viewer
```

These tests generate fresh viewers and exercise their actual scripts without opening a browser. They check navigation, one-action selection, endpoint limits, dependency ordering, and switching modes; they do not verify pixel layout. The Node dependencies are only needed for development tests, not for generating or opening a viewer.

## Implementation

- `schemas/recipe.schema.json`: step-oriented input contract.
- `schemas/recipe.example.json`: golden example recipe, used by tests and the LLM guide.
- `recipes/`: saved recipes, one `<recipeId>.recipe.json` file each.
- `scripts/compile_recipe.py`: validates input and constructs the dependency graph.
- `scripts/merge_recipe_graphs.py`: combines compiled recipe graphs and merges measurements matching a conservative template.
- `scripts/validate_recipe_graph.py`: validates internal graph semantics.
- `scripts/visualize_recipe_graph.py`: compiles recipe JSON and packages the HTML viewer.
- `scripts/recipe_graph_viewer.html`: shared viewer template, including pan, zoom, and node inspection.
- `scripts/vendor/dagre-1.1.5.min.js`: bundled Dagre layout engine, version 1.1.5, obtained from `https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.5/dist/dagre.min.js`. Its MIT license is in `scripts/vendor/dagre-LICENSE` and included in generated HTML.

The renderer uses only the input graph; no recipe-specific nodes or layout positions are hardcoded. Recipe text is rendered as text, not executable markup.
