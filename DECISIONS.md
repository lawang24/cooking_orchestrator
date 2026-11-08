# Decision Log

This log is append-only. Add new decisions at the end; do not edit or delete existing entries. Record corrections or superseding decisions as new entries that reference the original decision.

## 001 — Represent recipes as a graph

Date: 2026-10-19

We’ll represent recipes as a graph where ingredients, intermediate food states, and actions are nodes. Edges connect inputs → actions → outputs. An action can start once all its inputs are ready, allowing us to coordinate multiple dishes.

## 002 — Author recipes as steps and model measurement explicitly

Date: 2026-10-29

Refines decision 001: keep the dependency graph as the internal representation,
but author recipe JSON as ingredient allocations and steps with inputs and outputs.
A compiler generates nodes and edges and validates graph semantics. Step order in
the file does not imply execution order; optional `dependsOn` adds ordering beyond
food dependencies.

Represent measurement as its own active step, producing a quantified portion for
a later preparation or cooking step. Ingredient allocations carry a shared ingredient
identity, and steps carry structured operation names. This supplies information for
future meal-level grouping without combining portions or recipes during compilation.
Automatic batching, ingredient catalog normalization, and scheduling remain future work.

## 003 — Group portions under ingredients and generate one measure action each

Date: 2026-10-29

Supersedes the measurement part of decision 002. Recipe JSON keys `ingredients` by
canonical identity, and each ingredient lists its portions. The compiler generates
one ingredient node and one measure action per ingredient, producing every portion
as a separate food state; authors no longer write measure steps. This matches how
recipes list ingredients up front and removes duplicate measuring of the same
ingredient, such as two water measurements. Generated durations and equipment are
defaults that an ingredient-level `measure` object can override. Portions stay
separate until their consuming steps; authored prep and cooking steps are still
never batched.

## 004 — Remove source metadata

Date: 2026-11-07

Remove the structured `source` metadata from recipe inputs, meal components,
and compiled graphs. The viewer no longer displays a source link. Existing
recipe examples and authoring guidance follow this contract. Duration
`basis: "source"` remains available to distinguish recipe-provided timings
from estimates.

## 005 — Compose meals from compiled recipe graphs

Date: 2026-11-07

Refines decisions 002 and 003 for meal composition: compile and validate each
recipe independently, namespace its graph IDs, then combine the graphs. Apply
meal optimizations as a separate graph transformation and validate the result.
`build_graph` accepts only a recipe; there is no combined step-oriented `Meal`
input type.

Initially merge only matching canonical ingredient identities with compatible
units and measurement actions that match compiler defaults. Recalculate combined
quantities and default measurement durations; preserve individual portion nodes,
authored prep/cooking actions, final outputs, and ordering dependencies. Keep
customized measurements and incompatible units separate. Broader preparation
batching and cook/equipment scheduling remain future work.

## 006 — Remove ingredient measurement overrides

Date: 2026-11-08

Supersedes the override option in decision 003. Ingredients contain a name and
portions; the ingredient-level `measure` object is no longer accepted. The compiler
always generates measurement duration as 30 seconds plus 15 per additional portion
and selects equipment from portion units. Remove `MeasureOverrides` and the
override argument from measurement generation.

Decision 005's merge guard still preserves actions altered after compilation;
recipe authors can no longer customize measurements through recipe input.

## 007 — Author measurement steps and declare ingredient totals

Date: 2026-11-08

Supersedes the generated-measurement input contract in decisions 003 and 006.
Each starting ingredient declares the total `quantity` and `unit` required for
that recipe. Authors write measurement actions in `steps`, including timing,
instructions, equipment, and prerequisites. A measurement consumes one ingredient
total and produces one quantified food state for a single use or separate
purpose-specific states for multiple uses. Ingredient-level `portions` is removed.
The compiler copies declarations into graph nodes and edges without generating
measurement steps or recalculating starting quantities.

Require every starting ingredient to feed an explicit measurement. Measurement
outputs retain the input ingredient identity, use compatible units, and sum to
the input quantity. Measurement may also subdivide a quantified food state.
Other transformations retain the existing food-flow rules.

Refines decision 005: meal composition still operates on compiled graphs and
only batches measurements matching its conservative conventional template.
Custom authored instructions, durations, equipment, and prerequisites are
preserved by leaving those measurements separate. Existing recipes are migrated
with their quantities, food flow, timing estimates, and prerequisites preserved.

## 008 — Store timing directly on steps

Date: 2026-11-08

Replace the nested duration object and separate Duration type with three required
fields on recipe steps and compiled actions: `scheduled_duration_seconds`,
`duration_text`, and `scheduled_duration_source`. The numeric field is positive
integer seconds used for future scheduling and calculations. The text preserves
human-readable timing instructions, source ranges, completion cues, and estimate
explanations. The full action remains in `instruction`.

The source field is `source` when the scheduled number comes from an explicit
recipe time (including a value chosen within its range), or `estimate` when
inferred. Totals including estimated setup or transfer time are estimates even
if part of the step has a recipe-provided interval. Text is never parsed for
calculations; range fidelity is reviewed during authoring rather than enforced
with separate minimum/maximum fields. Existing numeric timings are preserved.

This supersedes decision 004's reference to duration `basis` and refines the
timing representation in decisions 005 and 007. Meal batching continues to
preserve custom timing by comparing all three fields with its template.

## 009 — Remove duration text from steps

Date: 2026-11-08

Supersedes the separate `duration_text` field in decision 008. Steps and compiled
actions retain `scheduled_duration_seconds` and `scheduled_duration_source`.
The viewer uses those fields for timing labels. Cooking instructions carry any
source time ranges and observable completion cues.
