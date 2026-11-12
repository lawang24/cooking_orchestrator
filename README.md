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

- `scheduled_duration_seconds`: positive integer seconds used to rank the work remaining on each branch.
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
The single-cook viewer can schedule actions across the merged graph.

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

One-time setup, from this project directory, using Python 3.11+ and Node.js 22.12+:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-validation.txt
npm ci
npm run build:viewer
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

The UI is authored in React and TypeScript. Python sends the validated graph and
action order to a Node build-time renderer, which prerenders the React components
to HTML and embeds the browser bundle, CSS, and data. Before JavaScript runs, the
page contains a visible recipe document with ingredients, every instruction,
timings, notes, and finished dishes. React hydrates that HTML and opens the
ingredient list. Choose **Start recipe** to see the first task. The complete document remains available under
**Overview → Recipes**. No browser requests to Python or Node are needed.

Quantities and decimal amounts in recipe text display as fractions, rounded to
the nearest ¼ (for example, `1.3` displays as `1 ¼`). Gram amounts round to the
nearest whole gram instead. Stored quantities retain
their precision for serving calculations.

To regenerate **all** saved recipes after frontend or recipe changes:

```sh
npm run build
```

This checks TypeScript, builds the frontend, and writes a recipe picker
(`visualizations/index.html`) alongside the recipe pages. The picker lists
the recipes in `recipes/*.recipe.json`. Open it locally or upload the files
printed by the build to the same directory on a static host. You can also
share individual recipe pages. Node and Python are generation dependencies only.
After editing frontend code, rerun `npm run build:viewer` before using the
single-recipe Python command. Generated files are ignored by Git.

### Add a recipe in the browser

Choose **New recipe** on the front page. **Copy agent instructions** copies the
current `AGENTS.md` together with the schema, authoring guide, example, decisions,
and supporting Python files. Paste this into your own agent along with a recipe
URL or its text. Bring the resulting recipe JSON back by pasting it or uploading
a `.json` file, then choose **Check & review**.

The existing Python compiler, JSON Schema validation, graph checks, and action
ordering run directly in your browser with Pyodide. A loading indicator is shown
while the checker loads and validates; creation controls are disabled until it
finishes. Review the readable
recipe or its graph, use **Edit JSON** for corrections, and choose **Save recipe**
to open the usual ingredient review and cooking guide. Failed checks retain the
JSON for correction or retry. The app does not call an agent or model service.

**Save recipe** publishes the authored JSON to the shared Supabase database.
Anyone can upload without signing in, and future visitors load the shared library
on page load. Saves survive refresh and work across devices. The form only opens
the saved recipe after the server confirms success; a failed save retains the
review and JSON for retry. Existing recipe IDs cannot be overwritten anonymously:
identical retries succeed without duplication, and different content using an
existing ID must be given a new `recipeId`.

The first browser check downloads the pinned Pyodide runtime and `jsonschema`
packages from jsDelivr and requires internet access. Saving then sends the recipe
JSON to the public `recipes` Supabase Edge Function, which independently validates
the same JSON Schema and graph semantics before storing it. Its TypeScript graph
checks are parity-tested against the Python compiler. Uploads are limited to
256 KB and 1,000 steps. No browser credential or login is required; the function
uses Supabase-provided credentials server-side and never returns them.

The front page embeds bundled recipes as an offline fallback, and offers Retry
when the shared library cannot load. Saving requires a connection and does not
fall back to a temporary local save. Already-loaded recipes remain usable during
the session. Individual generated recipe pages remain self-contained offline
exports. Cooking progress is never uploaded.

Run the real browser import tests in a dedicated headless Chromium context:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

These tests need internet access for Pyodide, use a temporary static preview on
port 18766 (override with `RECIPE_TEST_PORT`), and write failure artifacts to the
ignored `tmp/browser-tests/` directory. They cover parsing and validation errors,
graph review, cooking, persistence across reloads and separate browser contexts,
upload failures, ID conflicts, library retries, clipboard fallback, and checker
loading/retry. The public API is intercepted with an isolated test store; these
tests do not publish to the live database.

### Viewer controls

For an HTTP preview, run `npm run dev` after setup, then open
`http://127.0.0.1:8766/` to choose a recipe. Direct links such as `/gyudon.html` also work. The server
builds the React viewer and regenerates every recipe on startup, then serves only the `visualizations/`
directory, bound to localhost. Restart after source changes, then refresh the
page. Stop with Ctrl+C; choose another port with `npm run dev -- --port 8767`.

- Select the **Cooking Orchestrator** logo at the top of a recipe to return to the full recipe list.
- Before starting a single recipe, set **Servings** to a whole number of 1 or more. Ingredient totals and each measured portion update together. Cooking times use the original recipe’s guidance. Expand **Original method** on a scaled measurement for the author’s technique and original quantities. Reloading restores the authored yield.
- After **Start recipe**, each assigned hands-on action starts immediately and stays current until you choose **Done**. A passive action first appears as the current instruction: choose **Started** to acknowledge that it has begun. It then moves to **In progress** and the viewer offers the next eligible task. Each running passive task has its own **Done** button, available even while you work on another action. Occasional stirring can stay in the passive instruction.
- **Undo last action** reverses the last start acknowledgement or completion and restores the previous assignments. **Right** activates the main button and **Left** undoes the last change. Progress lasts until reload.
- Each step shows **Inputs**, the cooking instruction, and **Outputs**. Each output shows its amount and the step it is **Used for**, with that step's full input list expanded by default and the current output listed first and labeled **This output**. Select **Used for** to collapse or expand the list. Finished dishes are labeled directly. Amounts follow serving adjustments, and all connections come from food flow. Follow the receiving action's instructions for when to combine its ingredients.
- The bottom-right minimap shows one dot per action. Links run from earlier actions to the actions that use their food or require them to finish first. A ring marks the current action, and green dots mark completed actions. Click the minimap to explore those actions in detail.
- Open **Overview** in the top-right corner. **Progress** shows running and finished actions. Select any action to preview its instructions, then choose **Back to cooking** to resume. **Recipes** contains the complete readable recipe document: serving counts, ingredients, instructions, notes, and finished dishes.
- **Whole graph** opens in **Actions only** view. Solid arrows connect actions that supply food to the actions that use it. Choose **View → Whole graph** to see the ingredients and food states along those paths. Both views mark completed actions with **✓ Done** and update when you undo a completion. Select a node to inspect it or follow a link in its details. Scroll to zoom, drag to pan, or use the zoom, layout, and fit controls. **Show ordering** toggles the dashed prerequisite arrows and retains their layout constraints.
- Choose **Back to step** to resume the current instruction after inspecting the overview. Escape also returns to the step. On a selected graph node, Escape first clears its selection.
- An action is eligible once its food producers and explicit prerequisites are complete. Each distinct equipment ID represents one available item, reserved from start to manual completion. Actions requiring more than one cook stay blocked. Base priority favors the longest remaining chain of scheduled durations, with walkthrough order breaking ties. An action that directly uses food from the last completed hands-on action receives a 120-second priority bonus, keeping work such as getting and chopping onions together unless another branch has a larger lead. This changes ranking only, not planned durations or eligibility. Passive completions preserve the hands-on context, and undo restores it. Durations never trigger completion.

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
Build the viewer first, then run the compiler and Python tests:

```sh
npm ci
npm run build:viewer
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

Static rendering, hydration, keyboard and selection behavior have isolated DOM tests:

```sh
npm ci
npm run test:viewer
```

`test:viewer` checks TypeScript and rebuilds the frontend before testing. The tests
generate fresh viewers and exercise their actual scripts without opening a
browser. They check readable HTML with scripts disabled, hydration without
mismatches, escaped recipe text, navigation, selection, endpoint limits,
dependency ordering, and switching modes. They do not verify pixel layout.

## Implementation

### Supabase recipe storage

Project: [cooking-orchestrator](https://supabase.com/dashboard/project/mrwzofomwdzmxnjgapdw)
in `lawang24's Org` (Free), region `us-east-1`.
The recipe migration is applied and the five recipes in `recipes/` are seeded.
Codex can manage recipes through the connected Supabase integration without a
local secret key. The database setup is complete; the environment configuration
below is optional and only needed for direct access from the Python commands.

Supabase stores complete recipe JSON documents only. Cooking progress stays in
the browser. Recipes are publicly readable and addable through the `recipes`
Edge Function; direct table access remains private. Local recipe files and
offline HTML exports still work independently.
Use a project in a **Free-plan organization**; do not upgrade or enable paid
branches/add-ons. Free projects may pause after a week of low activity; resume
them in the dashboard before uploading/downloading. No keep-alive job is needed.

For a new project, apply all SQL files in `supabase/migrations/` in filename order
with the Supabase migration tooling or SQL editor. The conflict-status migration
uses HTTP 409 to prevent PostgREST from retrying a permanent revision conflict. The table has RLS enabled and no
anonymous/authenticated access. Only trusted server-side tooling uses its secret
key. The database checks document identity/version; Python enforces the complete
schema and graph semantics before upload and after download.

To use the standalone Python commands, copy `.env.example` to `.env`, enter the project URL and secret key from the
Supabase dashboard, and load the values into your shell. Never put the secret
key in frontend code or commit `.env`:

```sh
set -a
source .env
set +a
.venv/bin/python scripts/supabase_recipes.py upload --dry-run
.venv/bin/python scripts/supabase_recipes.py upload
.venv/bin/python scripts/supabase_recipes.py download
npm run dev -- --source supabase
```

Uploads default to `recipes/`. Downloads default to `tmp/supabase-recipes/`;
both commands accept `--directory <path>`. Downloads refuse to replace differing
local JSONs unless `--overwrite` is explicitly provided and never delete files.
The ignored `.supabase-revisions.json` in each directory tracks the last observed
revisions for that project. Keep it with your working recipe files.

All recipes in an upload are validated first and saved in one database
transaction. Identical documents are unchanged. A conflicting remote revision
rejects the whole batch. If a conflict occurs (or revision tracking is lost),
download into a fresh directory, compare and merge your edits there, then upload
that directory. This preserves the remote revision as the basis for your edits.
Do not resolve a conflict by deleting revision tracking or blindly overwriting
local changes. A network failure may leave the upload committed; retrying the
same documents safely reconciles the revisions.

To regenerate offline exports from Supabase without starting the preview server:

```sh
npm run build:viewer
.venv/bin/python scripts/serve_recipe_graphs.py --source supabase --build-only
```

The browser library fetches shared recipes on page load and uploads on Save.
Standalone Python tools also support explicit upload, download, and generation.
Exported HTML contains no database credentials. New shared recipes appear on
subsequent library loads without rebuilding or redeploying the static site.
Supabase-backed generation uses the same recipe library and cooking views as
local files. Individual static recipe pages are snapshots and require rebuilding
to reflect edits to their recipe.

`tests/test_supabase_recipes.py` covers validation, file round trips, pagination,
overwrite protection, revision tracking, credential handling, and viewer generation.
`supabase/tests/recipe_storage.sql` checks the actual database's inserts, updates,
idempotent retries, atomic conflict rollback, constraints, and access restrictions;
run it against a seeded project through the SQL editor or connector. All test
writes roll back. Supabase's informational
[RLS enabled without policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is expected here: browser users have no table or upload-function access.

### Source files

- `schemas/recipe.schema.json`: step-oriented input contract.
- `schemas/recipe.example.json`: golden example recipe, used by tests and the LLM guide.
- `recipes/`: saved recipes, one `<recipeId>.recipe.json` file each.
- `scripts/compile_recipe.py`: validates input and constructs the dependency graph.
- `scripts/merge_recipe_graphs.py`: combines compiled recipe graphs and merges measurements matching a conservative template.
- `scripts/validate_recipe_graph.py`: validates internal graph semantics.
- `scripts/visualize_recipe_graph.py`: compiles and validates recipes, computes action order, and invokes the React static renderer over stdin/stdout.
- `frontend/scheduler.ts`: single-cook eligibility, priority, and start/finish transitions.
- `frontend/App.tsx`: cooking history, previews, and navigation.
- `frontend/components/`: step player, graph view, node details, and semantic recipe document.
- `frontend/model.ts`: graph layout and dependency-derived progress, shared by the build and browser.
- `frontend/types.ts`: TypeScript shape of the validated JSON boundary; keep it aligned with `scripts/recipe_types.py` when changing the compiled graph contract.
- `frontend/render.tsx`: build-time React prerendering and self-contained HTML packaging.
- `frontend/client.tsx`: browser hydration entry point.
- `frontend/build.mjs`: Vite builds for the inline browser bundle and Node renderer; outputs go to ignored `frontend/dist/`.
- `frontend/styles.css`: shared viewer styles.
- `scripts/vendor/dagre-LICENSE`: retained MIT license for Dagre 1.1.5. Dagre is now an npm dependency; its license and the bundled dependencies' licenses are included in generated HTML.

The renderer uses only the input graph; no recipe-specific nodes or layout positions are hardcoded. Recipe text is rendered as text, not executable markup.


### Deploying the shared recipe API

The `recipes` Edge Function is deployed in the existing Free project. Its public
URL is configured in `frontend/recipe-storage.ts`. `supabase/config.toml` disables
JWT verification intentionally: anyone may read and add recipes. The database
retains RLS and private table/function grants. The endpoint exposes only listing
and validated insertion; it never forwards caller-supplied update revisions or
provides update/delete routes. Its service credential is automatically supplied
by Supabase, so GitHub Pages needs no secret environment variables.

After changing server validation, deploy all function dependencies, including the
authoritative schema and viewer types referenced from the repository:

```sh
npm run test:api
npx supabase functions deploy recipes --project-ref mrwzofomwdzmxnjgapdw
```

`tests/recipe-api.test.mjs` compares server compilation and rejection cases with
Python and checks endpoint behavior. Browser tests mock the shared service to
verify persistence and failures without writing test recipes to production.
Frontend changes reach GitHub Pages through the existing workflow on a push to
`main`; `npm run build` generates a local preview only. The Supabase API and
static frontend are deployed separately. Free-plan limits and pausing still
apply; this setup adds no paid plan, branch, or external hosting service.
