import type { LibraryRecipe } from "./types";

// Public, intentionally unauthenticated API. No database credential is bundled.
export const recipeEndpoint = "https://mrwzofomwdzmxnjgapdw.supabase.co/functions/v1/recipes";

async function request(url: string, options: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error("Could not reach the shared library. Check your connection and retry. Your JSON has not been cleared."); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The shared library is unavailable. Please retry.");
  return result;
}

export async function loadRecipes(): Promise<LibraryRecipe[]> {
  const recipes: LibraryRecipe[] = [];
  let after: string | null = null;
  const cursors = new Set<string>();
  do {
    const page = await request(recipeEndpoint + (after ? "?after=" + encodeURIComponent(after) : ""));
    recipes.push(...page.recipes);
    after = page.next;
    if (after) {
      if (cursors.has(after)) throw new Error("The shared library could not finish loading. Please retry.");
      cursors.add(after);
    }
  } while (after);
  return recipes;
}

export async function saveRecipe(source: string): Promise<LibraryRecipe> {
  const result = await request(recipeEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: source });
  return result.recipe;
}
