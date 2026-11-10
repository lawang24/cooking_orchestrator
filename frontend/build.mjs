import { build } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const common = {
  root,
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
};
// One classic script keeps file:// exports usable without module fetches or a CDN.
await build({
  ...common,
  build: {
    outDir: "frontend/dist",
    emptyOutDir: true,
    target: "es2022",
    license: { fileName: "licenses.txt" },
    lib: {
      entry: "frontend/client.tsx",
      name: "RecipeViewer",
      formats: ["iife"],
      fileName: () => "viewer.js",
      cssFileName: "viewer",
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
