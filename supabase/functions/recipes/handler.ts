import { compileRecipe } from "./validate.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const maxBytes = 256 * 1024;
type Database = (path: string, payload?: unknown) => Promise<Response>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function readDocument(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.split(";")[0].trim().endsWith("/json")) throw new Error("Send a JSON recipe.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Send a JSON recipe.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Recipe must be smaller than 256 KB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createHandler(database: Database): (request: Request) => Promise<Response> {
  return async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
    try {
      if (request.method === "GET") {
        const after = new URL(request.url).searchParams.get("after");
        if (after && !/^[a-z][a-z0-9_-]*$/.test(after)) return json({ error: "Invalid pagination cursor." }, 400);
        const query = new URLSearchParams({ select: "recipe_id,document", order: "recipe_id.asc", limit: "25" });
        if (after) query.set("recipe_id", "gt." + after);
        const response = await database("recipes?" + query);
        if (!response.ok) return json({ error: "The shared library is unavailable. Please retry." }, 503);
        const rows: { recipe_id: string; document: unknown }[] = await response.json();
        return json({ recipes: rows.map(row => ({ id: "saved-" + row.recipe_id, ...compileRecipe(row.document) })),
          next: rows.length === 25 ? rows.at(-1)!.recipe_id : null });
      }
      let document: unknown;
      let data: ReturnType<typeof compileRecipe>;
      try { document = await readDocument(request); data = compileRecipe(document); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid recipe." }, 400); }
      // Never accept expected_revision from anonymous callers. Existing recipes
      // can only be returned unchanged; a conflicting document fails atomically.
      const response = await database("rpc/save_recipes", { p_recipes: [{ document, expected_revision: null }] });
      if (!response.ok) {
        const error = await response.json();
        if ((error.code === "PT409" || error.code === "40001")) return json({ error: "That recipeId is already used by another recipe. Edit the JSON to give yours a unique recipeId, then check and save again." }, 409);
        return json({ error: "The recipe could not be saved. Your JSON is still here; please retry." }, 503);
      }
      return json({ recipe: { id: "saved-" + data.graph.recipeId, ...data } }, 201);
    } catch {
      return json({ error: "The shared library is unavailable. Please retry." }, 503);
    }
  };
}
