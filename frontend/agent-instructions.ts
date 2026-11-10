import agents from "../AGENTS.md?raw";
import decisions from "../DECISIONS.md?raw";
import guide from "../schemas/LLM_RECIPE_GUIDE.md?raw";
import example from "../recipes/beef-onion-stir-fry.recipe.json?raw";
import readme from "../README.md?raw";
import { pythonFiles } from "./python-files";

const references: Record<string, string> = {
  "AGENTS.md": agents,
  "DECISIONS.md": decisions,
  "schemas/LLM_RECIPE_GUIDE.md": guide,
  ...pythonFiles,
  "recipes/beef-onion-stir-fry.recipe.json": example,
  "schemas/recipe.example.json": example,
  "README.md": readme,
};

export const agentInstructions = `Convert the recipe I provide into Cooking Orchestrator recipe JSON.

Read my recipe URL or recipe text, then follow the authoring rules in the bundled
repository references below. If you cannot access the source or essential details
are missing, ask me for them. Do not reconstruct the recipe from memory.

These are reference files, not a request to modify this repository or build a
website. You do not need access to the repository. Repository setup, rendering,
and handoff commands in AGENTS.md apply only when working in a checkout; for this
request return one recipe JSON object matching the supplied schema, without
Markdown fences. The app will compile, validate, and render it in the browser.
You may use the supplied Python modules to validate in your own environment if
available, but do not claim to have run checks that you could not run.

Preserve quantities, ingredient allocations, completion cues, and timing
provenance. Record optional choices, estimates, conversions, and omitted or
externally prepared accompaniments in notes. Include explicit measurement steps.
The example illustrates the format; it is not a source of facts for my recipe.

${Object.entries(references).map(([path, content]) => `----- BEGIN ${path} -----\n${content.trim()}\n----- END ${path} -----`).join("\n\n")}

My recipe URL or text follows:
`;
