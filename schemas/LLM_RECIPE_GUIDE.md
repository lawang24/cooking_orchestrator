# Generating recipe JSON with an LLM

Use this guide, [recipe.schema.json](recipe.schema.json), the complete example
[recipe.example.json](recipe.example.json), and the source recipe text when
generating a recipe. If the LLM cannot read files, supply their
contents. When using structured output, supply the input
schema through the model API as supported; still validate the result afterward.

## Output contract

Produce one JSON object matching `recipe.schema.json`. Return JSON only when
asked for a recipe, without Markdown fences, comments, or explanatory prose.
Do not generate `nodes`, `edges`, or any other internal graph format. Our code converts ingredients and steps into ingredient nodes, action
nodes, food-state nodes, and their connecting edges.

Include all required metadata: `schemaVersion`, `recipeId`, `name`,
`servings`, `notes`, `ingredients`, `steps`, and recipe-level `outputs`.
Preserve quantities from the recipe text. Do not include a `source` metadata field
or silently guess an ambiguous ingredient; request clarification when required
information is missing. When saving a recipe in `recipes/`, add
`"$schema": "../schemas/recipe.schema.json"` as the first field.

## Ingredient identity must stay constant across recipes

Each key in `ingredients` is the shared, canonical ingredient identity. The same
ingredient MUST use exactly the same key across every recipe. Reuse identities
from existing recipe files or a supplied ingredient catalog before creating a new
one. Use consistent lowercase snake_case identifiers, such as
`light_soy_sauce`, `oyster_sauce`, and `neutral_oil`.

Do not alternate between synonyms such as `light_soy_sauce` and `light_soy`.
Do not collapse materially different ingredients: `light_soy_sauce` and
`dark_soy_sauce` remain distinct. Preserve specified varieties and do not assume
an unspecified ingredient is equivalent to a more specific one.

List each ingredient once with `name`, total `quantity`, and `unit`. Sum every
allocation needed for this recipe, converting compatible units explicitly.
For example, `oyster_sauce` starts at 3 tsp total: 1 tsp for the marinade and
2 tsp for the sauce. The ingredient object has no `portions` field. Define those
purpose-specific food states as outputs of an authored measurement step.
Source recipes may group ingredients by component or say "divided"; preserve
those uses in the measurement outputs and document any unit conversions.

Matching ingredient identities allows a future meal planner to identify work
that might be shared across recipes. Keep each recipe self-contained;
cross-recipe batching belongs to the planner.

## Steps and measurement

- Write every measurement step explicitly with `operation: "measure"`. Each
  starting ingredient total must feed one such step. The compiler does not
  generate actions, durations, equipment, or portion names.
- A measurement consumes one ingredient total (or one already quantified food
  state) and produces one or more food states. For an ingredient used once,
  produce one output; otherwise produce separate outputs named for their uses.
  Each measured output requires `id`, `name`, `ingredient`, `quantity`, and `unit`.
- Measurement outputs must retain the input's canonical ingredient identity and
  sum to its amount using compatible volume, weight, or `whole` units. Do not mix
  weight and volume without an explicitly modeled conversion. Measurement is
  active work with at least one cook and explicitly authored timing and equipment.
- Give every step a unique `id`, a structured `operation`, and an actionable
  `instruction`. Reuse operation names for the same action, such as `slice`,
  `mix`, `marinate`, `cut`, `sear`, `simmer`, and `stir_fry`.
- Prep and cooking steps consume portion IDs directly, such as `sauce_water`.
  Do not hide measurement inside a mixing or cooking step's duration.
- `inputs` contains ingredient IDs for measurement, or food-output IDs for later work. Step `outputs` is an
  array of objects defining new food states, not a map or a list of strings.
  Each output requires `id` and `name`. If any of `ingredient`, `quantity`, or
  `unit` is supplied, supply all three. Do not invent quantities for mixtures.
- Use distinct IDs across ingredients, portions, steps, and food outputs within
  a recipe. Measurement IDs are authored; `measure_<ingredient>` is a useful
  convention, not a reserved name. Each nonterminal food portion is consumed by
  exactly one step; use an
  explicit split step with separate outputs when portions take different paths.
- Use `dependsOn` for additional step ordering, such as preserving a wok cooking
  sequence. Food dependencies already come from `inputs`. Array order alone
  does not impose execution order; leave independent preparation independent.
- Declare the completed dish's food-output IDs in recipe-level `outputs`.
  Every ingredient and step must contribute to a declared final output, and
  dependencies must not form cycles.

## Timing and resources

Put timing directly on each step, with no nested duration object:

- `scheduled_duration_seconds`: positive integer seconds used for future calculations.
- `scheduled_duration_source`: `source` for a recipe-provided time (or a selected
  value within its range), `estimate` for inferred timing. If adding estimated
  heating, setup, or transfer time to a source interval, mark the total `estimate`
  and preserve the source interval in `instruction`.

Include source ranges and completion cues in the cooking instruction. Choose a
scheduled value within any stated source range. Estimate measurement
separately from mixing to avoid counting the same work twice. The example's
measurement times are estimates, not universal constants.

Set `attention` to `active` with at least one cook, or `passive` with zero cooks.
List equipment requirements using stable identifiers. Equipment is not a food
input or output. Timings support planning; elapsed time alone does not confirm
that an action is complete.

## Validation

Check the generated JSON against `recipe.schema.json`, then run the project's
recipe compilation and graph validation path. Schema validation checks field
structure; graph validation must also check references, unique IDs, cycles,
portion consumption, measurement identity and quantity conservation, and connection
to final outputs. Review fidelity to the
source recipe separately. Neither a schema nor matching canonical identifiers
establishes that two cooking tasks can safely or practically be batched.

## Golden example

[recipe.example.json](recipe.example.json) is the golden example: a complete
beef-onion stir-fry recipe that the tests also use. It shows ingredient totals with explicit measurements producing
several named portions, estimated and source timings, and `dependsOn` ordering
for one shared wok. When the schema
changes, update the example to match and validate it again.
