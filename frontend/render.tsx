// Build-time CLI: validated JSON on stdin, a self-contained HTML document on stdout.
// No Node/Python server is involved when someone opens the generated page.
import { readFile } from "node:fs/promises";
import { prerenderToNodeStream } from "react-dom/static";
import { App } from "./App";
import { LibraryApp } from "./LibraryApp";
import { formatRecipeText } from "./portions";
import type { LibraryData, ViewerData } from "./types";

const input: Buffer[] = [];
for await (const chunk of process.stdin) input.push(Buffer.from(chunk));
const data = JSON.parse(
  Buffer.concat(input).toString("utf8"),
) as ViewerData | LibraryData;
const isLibrary = "recipes" in data;
const hasRecipeIndex = !isLibrary && data.hasRecipeIndex;
const { prelude } = await prerenderToNodeStream(
  isLibrary ? <LibraryApp {...data} /> : <App {...data} />,
);
prelude.setEncoding("utf8");
let markup = "";
for await (const chunk of prelude) markup += chunk.toString();
const [script, style, license, dependencyLicenses] = await Promise.all([
  readFile(new URL(isLibrary ? "./library.js" : "./viewer.js", import.meta.url), "utf8"),
  readFile(new URL(isLibrary ? "./library.css" : "./viewer.css", import.meta.url), "utf8"),
  readFile(
    new URL("../../scripts/vendor/dagre-LICENSE", import.meta.url),
    "utf8",
  ),
  readFile(new URL(isLibrary ? "./library-licenses.txt" : "./licenses.txt", import.meta.url), "utf8"),
]);
// JSON script elements are non-executable but HTML still recognizes closing tags.
function json(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
process.stdout.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isLibrary ? "Recipes · Cooking Orchestrator" : `${escape(formatRecipeText(data.graph.name))} — recipe graph`}</title>
<style>${style.replace(/<\/style/gi, "<\\/style")}</style></head><body>
<div id="root"${hasRecipeIndex ? ' data-recipe-index' : ''}>${markup}</div>
${isLibrary ? `<script id="library-data" type="application/json">${json(data)}</script>` : `<script id="recipe-data" type="application/json">${json(data.graph)}</script>
<script id="step-data" type="application/json">${json(data.steps)}</script>`}
<script>/* Dagre license\n${license}\n${dependencyLicenses.replace(/\*\//g, "* /").replace(/<\/script/gi, "<\\/script")}\n*/\n${script.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`);
