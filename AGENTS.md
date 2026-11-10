# Recipe graph workflow

Use this workflow when asked to convert a recipe into a graph or visualize a recipe in this repository. A request such as “let’s do this recipe” with a recipe URL means: read the source, author its recipe JSON, compile and validate it, and generate the existing interactive viewer.

## Read before working

- `DECISIONS.md`: accepted design decisions. This file is append-only; corrections and superseding decisions must be new entries. Do not turn unaccepted suggestions into decisions.
- `schemas/recipe.schema.json`: the authoritative input contract. Read `schemas/LLM_RECIPE_GUIDE.md` for authoring conventions and `scripts/compile_recipe.py` for compilation of explicit measurement steps.
- `scripts/validate_recipe_graph.py`: semantic checks beyond JSON Schema.
- `recipes/beef-onion-stir-fry.recipe.json`: an example of the format, not a source of facts or mandatory ordering for other recipes.
- `README.md`: setup, visualization commands, and viewer behavior.

Inspect the working tree first and preserve unrelated or concurrent changes. For a recipe-only task, use the existing schema and renderer; do not redesign them unless the requested recipe exposes a real limitation that needs addressing.

## Read and interpret the recipe

1. Open the supplied source and read its ingredient list, serving count, instructions, and relevant preparation notes. Do not reconstruct a linked recipe from memory or search snippets. If the source is unavailable, explain the gap and request the missing recipe text rather than inventing it.
2. Use concise paraphrases for action instructions. The recipe format does not include a `source` metadata field.
3. Preserve quantities and units, including separate allocations of the same ingredient to different steps. Check that allocations add up to the source totals. Document any conversions.
4. Choose a concrete variant for optional ingredients or alternatives and record that choice in `notes`. Never make alternatives simultaneous requirements. Label estimated quantities; do not silently invent exact amounts for “to taste.” If ambiguity prevents a faithful graph, identify it instead of claiming completeness.
5. Make scope explicit: include preparation actions for whole/raw ingredients when relevant. If starting with something already prepared, such as cooked rice, describe that as an externally prepared input. If rice or another accompaniment is omitted, say so in `notes` and the handoff; do not silently imply its cooking is coordinated.

## Build the graph

Save `recipes/<recipe-id>.recipe.json` with a stable lowercase slug, `schemaVersion: "1.0"`, and `$schema: "../schemas/recipe.schema.json"`. Supply every required field, including `notes` and recipe-level `outputs`.

### Ingredients, steps, and food flow

- Key `ingredients` by canonical identity. Reuse existing keys for the same ingredient. Declare the total positive quantity and supported unit needed for that recipe. Define separate uses as outputs of explicit measurement steps, keeping units compatible.
- Author measurement steps explicitly with `operation: "measure"`, instruction, duration, attention, cooks required, and equipment. Each starting ingredient must feed one measurement action. It produces one quantified output for a single use, or separate purpose-specific outputs for multiple uses. Each output must include `ingredient`, `quantity`, and `unit`; identities must match and quantities must sum to the input total. The compiler does not invent measurement steps or defaults.
- Author each measurement, prep, or cooking step with a unique ID, structured `operation`, instruction, duration, attention, cooks required, and equipment. List its ingredient IDs (for measurement) or food-state IDs in `inputs` and define its output food states with an ID and name in `outputs`. The compiler builds nodes and food-flow edges from these references.
- Recipe-level `outputs` identifies the finished food states. IDs must be unique across ingredients, steps, and food states. Array position never defines execution order.

Expose meaningful changes of state: whole onion → cut onion → onion wedges, or coated beef → marinate → marinated beef. Separate active preparation from passive waiting so other work can happen during the wait. Avoid imposing a single linear sequence on independent branches.

The current validator requires each food state to have exactly one producer, each action to have food inputs and outputs, and each nonterminal ingredient/state to have exactly one consumer. Allocate repeated uses of an ingredient into separate portions. If an intermediate mixture feeds multiple branches, use an explicit splitting action and separate output portions; do not duplicate the same food. Every node must contribute through food flow to a declared output.

Equipment belongs in `equipment`, not in ingredient or food-state nodes. The current format cannot represent a standalone equipment-only action such as preheating with no food inputs/outputs. Fold such setup into the relevant cooking action and include it in the scheduled duration; do not fabricate a food state to satisfy validation.

### Dependencies and resource constraints

Food-flow edges already encode ordering: an action needs all its food inputs. Use `dependsOn` only for additional action prerequisites without food transfer. These references also belong to the dependency graph and must not create cycles.

Distinguish three cases:

| Case | Representation |
| --- | --- |
| An action needs another action's food output | Food-flow edges through that output state |
| A specific sequence is necessary for the recipe | An action ID in `dependsOn`, with the reason documented in `notes` |
| Actions compete for a cook, burner, or wok | `cooksRequired` and `equipment`; scheduling must resolve availability |

Sharing a wok alone does not establish which action must come first. Do not infer mandatory precedence merely from shared equipment or the order of paragraphs. If preserving a source sequence as a conservative modeling choice, identify that assumption in `notes`. The existing beef-onion example preserves a particular wok sequence; do not generalize that into an equipment rule.

An action is eligible when its food inputs are available and its explicit prerequisites are complete. Actually starting it also requires resources. The repository currently validates and visualizes dependencies; it does not implement a scheduler, live readiness tracking, or cook assignment.

### Durations

- Use positive integer seconds in `scheduled_duration_seconds` for planning.
- Set `scheduled_duration_source` to `source` for a recipe-provided time. Preserve stated ranges in the cooking instruction and choose a scheduled value within the range.
- Use `estimate` for inferred durations, including totals that add setup or transfer time to a source interval. Keep that source interval in the cooking instruction.
- Active work requires at least one cook. Passive waiting uses `attention: "passive"` and `cooksRequired: 0`; retain applicable equipment requirements.
- Timers are planning aids, not automatic proof of completion or doneness. Preserve observable completion cues in instructions. Do not claim summed action times equal wall-clock meal duration when branches can overlap.

## Validate and visualize

Run commands from the repository root. Reuse `.venv` when present. If setup is needed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-validation.txt
npm ci
npm run build:viewer
```

Viewer generation also requires Node.js 22.12+. Rebuild with `npm run build:viewer`
after frontend edits. The exported HTML needs no Node/Python runtime or server.
Replace `<recipe-id>` below with the actual slug:

```sh
.venv/bin/python scripts/compile_recipe.py recipes/<recipe-id>.recipe.json
.venv/bin/python scripts/visualize_recipe_graph.py recipes/<recipe-id>.recipe.json
```

Fix validation errors and regenerate. In addition to passing validation, compare the graph against the source: quantities, ingredient allocation, preparation, optional choices, timing provenance, final outputs, and justified dependencies. The validator checks measurement quantity conservation, but does not verify recipe accuracy, conservation through other transformations, cooking safety, or resource feasibility.

Use the reusable renderer for visualization requests. Do not substitute a one-off Mermaid diagram or manually authored recipe-specific HTML. The renderer produces `visualizations/<recipe-id>.html`, a self-contained offline snapshot; rerun it after JSON edits. Use `--open` to open the result in the default browser or `--output <path>` for a different destination.

When browser inspection is available, open the generated file and confirm that nodes and links render, node selection shows the right data, and the result is usable with zoom and pan. Solid arrows are food flow; dashed arrows come from `dependsOn`. “Show ordering” hides only dashed arrows, not dependencies or layout constraints. Report any verification you could not perform.

For changes to the schema, compiler, validator, or renderer, run the existing tests and add focused coverage for changed behavior:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

For viewer changes, also run `npm ci` and `npm run test:viewer` for the DOM navigation tests.

The reusable viewer is authored in `frontend/` using React and TypeScript.
`frontend/render.tsx` prerenders semantic recipe HTML and bundles the client code;
`frontend/client.tsx` hydrates it. Keep all ingredients and instructions readable
without JavaScript, retain offline exports, and verify hydration without errors.
`npm run build` typechecks, rebuilds the UI, and regenerates every saved recipe.
Build the viewer before running Python tests that exercise HTML generation.

Keep generated visualizations, `frontend/dist/`, screenshots, `.venv`, and caches out of version control according to `.gitignore`. Do not edit generated HTML as the source of a fix; change the JSON or shared React components/styles and regenerate. Preserve the bundled layout library's license.

## Handoff

Link the recipe JSON and generated HTML using absolute local paths. State what passed validation, any meaningful assumptions or omissions, and how to regenerate the view. Keep the explanation concise. Commit or push only when the active task authorizes it; creating a graph does not itself request a push.
