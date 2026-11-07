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

Include all required metadata: `schemaVersion`, `recipeId`, `name`, `source`,
`servings`, `notes`, `ingredients`, `steps`, and recipe-level `outputs`.
Preserve the source attribution and quantities. Do not invent missing source
metadata or silently guess an ambiguous ingredient; request clarification when
required information is missing. When saving a recipe in `recipes/`, add
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

List every use of an ingredient once, as a portion under that ingredient. Portion
keys are recipe-local IDs. For example, `oyster_sauce` has portions
`marinade_oyster_sauce` (1 tsp) and `sauce_oyster` (2 tsp); their quantities and
downstream uses stay separate. Source recipes often group their ingredient list
by component ("For the marinade", "For the sauce") or say "divided"; regroup by
ingredient and split those amounts into named portions. Keep display names
consistent where practical; quantities, units, portion IDs, and preparation
states may differ by recipe.

Matching ingredient identities allows a future meal planner to identify work
that might be shared across recipes. Keep each recipe self-contained;
cross-recipe batching belongs to the planner.

## Steps and measurement

- Do not write measure steps; `measure` is a reserved operation. The compiler
  generates one measure action per ingredient that produces all its portions.
  Its default duration is 30 seconds plus 15 per additional portion, and its
  equipment follows the units (spoons, cup, or scale). Add an ingredient-level
  `measure` object with `duration` and/or `equipment` only when the defaults
  are clearly wrong, such as weighing whole produce.
- Every portion needs `quantity` and `unit`. All portions of one ingredient must
  use volume units, weight units, or `whole` counts, not a mix. Give portions a
  `name` when the generated label (ingredient name and amount) would be
  ambiguous, such as two 1 tbsp oil portions.
- Give every step a unique `id`, a structured `operation`, and an actionable
  `instruction`. Reuse operation names for the same action, such as `slice`,
  `mix`, `marinate`, `cut`, `sear`, `simmer`, and `stir_fry`.
- Prep and cooking steps consume portion IDs directly, such as `sauce_water`.
  Do not hide measurement inside a mixing or cooking step's duration.
- `inputs` contains portion or food-output IDs. Step `outputs` is an
  array of objects defining new food states, not a map or a list of strings.
  Each output requires `id` and `name`. If any of `ingredient`, `quantity`, or
  `unit` is supplied, supply all three. Do not invent quantities for mixtures.
- Use distinct IDs across ingredients, portions, steps, and food outputs within
  a recipe. Generated measure actions use `measure_<ingredient>`. Each nonterminal food portion is consumed by exactly one step; use an
  explicit split step with separate outputs when portions take different paths.
- Use `dependsOn` for additional step ordering, such as preserving a wok cooking
  sequence. Food dependencies already come from `inputs`. Array order alone
  does not impose execution order; leave independent preparation independent.
- Declare the completed dish's food-output IDs in recipe-level `outputs`.
  Every ingredient and step must contribute to a declared final output, and
  dependencies must not form cycles.

## Timing and resources

Use positive integer `duration.plannedSeconds`. Set `basis` to `source` for
source-provided timings, or `estimate` with a required explanatory `note` for
estimates. When including a timing range, include both `minimumSeconds` and
`maximumSeconds`, and keep the planned duration within that range. Estimate
measurement separately from mixing to avoid counting the same work twice.
The example's measurement times are estimates, not universal constants.

Set `attention` to `active` with at least one cook, or `passive` with zero cooks.
List equipment requirements using stable identifiers. Equipment is not a food
input or output. Timings support planning; elapsed time alone does not confirm
that an action is complete.

## Validation

Check the generated JSON against `recipe.schema.json`, then run the project's
recipe compilation and graph validation path. Schema validation checks field
structure; graph validation must also check references, unique IDs, cycles,
portion consumption, and connection to final outputs. Review fidelity to the
source recipe separately. Neither a schema nor matching canonical identifiers
establishes that two cooking tasks can safely or practically be batched.

## Golden example

[recipe.example.json](recipe.example.json) is the golden example: a complete
beef-onion stir-fry recipe that the tests also use. It shows ingredients with
several named portions, estimated and source timings, and `dependsOn` ordering
for one shared wok. When the schema
changes, update the example to match and validate it again.
