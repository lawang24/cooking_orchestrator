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
