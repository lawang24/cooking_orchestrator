import { build } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const common = {
  root,
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
};
// One classic script keeps file:// exports usable without module fetches or a CDN.
for (const entry of ["viewer", "library"]) await build({
  ...common,
  build: {
    outDir: "frontend/dist",
    emptyOutDir: entry === "viewer",
    target: "es2022",
    license: { fileName: entry === "viewer" ? "licenses.txt" : "library-licenses.txt" },
    lib: {
      entry: entry === "viewer" ? "frontend/client.tsx" : "frontend/library-client.tsx",
      name: entry === "viewer" ? "RecipeViewer" : "RecipeLibrary",
      formats: ["iife"],
      fileName: () => `${entry}.js`,
      cssFileName: entry,
    },
  },
});
await build({
  ...common,
  build: {
    outDir: "frontend/dist",
    emptyOutDir: false,
    target: "node22",
    ssr: "frontend/render.tsx",
    rolldownOptions: { output: { entryFileNames: "render.mjs" } },
  },
});
