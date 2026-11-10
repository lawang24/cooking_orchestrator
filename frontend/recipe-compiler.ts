import { pythonFiles } from "./python-files";
import type { ViewerData } from "./types";

type Compilation =
  | { ok: true; data: ViewerData }
  | { ok: false; error: string };

interface PythonRuntime {
  FS: { mkdirTree(path: string): void; writeFile(path: string, content: string): void };
  globals: { set(name: string, value: string): void; delete(name: string): void };
  loadPackage(name: string): Promise<unknown>;
  runPython(code: string): unknown;
}

const indexURL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
let runtime: Promise<PythonRuntime> | undefined;
let loadAttempt = 0;

async function initialize(status: (text: string) => void): Promise<PythonRuntime> {
  // A failed dynamic import is cached by the browser. Give a retry a fresh URL.
  const runtimeURL = `${indexURL}pyodide.mjs?load=${++loadAttempt}`;
  const { loadPyodide } = await import(/* @vite-ignore */ runtimeURL);
  const python: PythonRuntime = await loadPyodide({ indexURL });
  status("Loading validation tools…");
  await python.loadPackage("jsonschema");
  python.FS.mkdirTree("/recipe/scripts");
  python.FS.mkdirTree("/recipe/schemas");
  for (const [path, content] of Object.entries(pythonFiles)) {
    python.FS.writeFile(`/recipe/${path}`, content);
  }
  python.runPython('import sys\nsys.path.insert(0, "/recipe/scripts")\nfrom recipe_viewer_data import compile_recipe_json');
  return python;
}

// Let React update the loading indicator and the browser paint it before Python
// runs synchronously on the main thread, including when the runtime is cached.
const paintLoadingState = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => { setTimeout(resolve, 0); });
});

export async function compileRecipe(text: string, status: (text: string) => void): Promise<Compilation> {
  try {
    status("Loading recipe checker… The first check may take a moment.");
    await paintLoadingState();
    // Reuse one runtime for the page session. Browsing recipes never loads it.
    runtime ??= initialize(status).catch(error => {
      runtime = undefined;
      throw error;
    });
    const python = await runtime;
    status("Checking ingredients, measurements, and step dependencies…");
    await paintLoadingState();
    // Recipe text is data, never interpolated into executable Python.
    python.globals.set("recipe_text", text);
    try {
      return JSON.parse(python.runPython("compile_recipe_json(recipe_text)") as string) as Compilation;
    } finally {
      python.globals.delete("recipe_text");
    }
  } catch (error) {
    throw new Error("The recipe checker could not run. Check your connection and try again. Your JSON is still here.", { cause: error });
  }
}
