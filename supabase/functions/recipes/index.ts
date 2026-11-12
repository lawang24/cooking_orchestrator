import { createHandler } from "./handler.ts";

// Supabase supplies these inside the function. They never enter the frontend.
const url = Deno.env.get("SUPABASE_URL")!;
const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default
  || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
Deno.serve(createHandler((path, payload) => fetch(url + "/rest/v1/" + path, {
  method: payload === undefined ? "GET" : "POST",
  headers: { apikey: key, ...(key.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + key }), "Content-Type": "application/json" },
  body: payload === undefined ? undefined : JSON.stringify(payload),
})));
