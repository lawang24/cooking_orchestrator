# Decision Log

This log is append-only. Add new decisions at the end; do not edit or delete existing entries. Record corrections or superseding decisions as new entries that reference the original decision.

## 001 — Represent recipes as a graph

Date: 2026-10-19

We’ll represent recipes as a graph where ingredients, intermediate food states, and actions are nodes. Edges connect inputs → actions → outputs. An action can start once all its inputs are ready, allowing us to coordinate multiple dishes.
