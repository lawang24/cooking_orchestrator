import compiler from "../scripts/compile_recipe.py?raw";
import validator from "../scripts/validate_recipe_graph.py?raw";
import quantities from "../scripts/recipe_quantities.py?raw";
import types from "../scripts/recipe_types.py?raw";
import viewerData from "../scripts/recipe_viewer_data.py?raw";
import schema from "../schemas/recipe.schema.json?raw";

// Preserve the repository layout in Pyodide's memory filesystem so the existing
// compiler can resolve its schema without a browser-specific validation fork.
export const pythonFiles: Record<string, string> = {
  "scripts/compile_recipe.py": compiler,
  "scripts/validate_recipe_graph.py": validator,
  "scripts/recipe_quantities.py": quantities,
  "scripts/recipe_types.py": types,
  "scripts/recipe_viewer_data.py": viewerData,
  "schemas/recipe.schema.json": schema,
};
