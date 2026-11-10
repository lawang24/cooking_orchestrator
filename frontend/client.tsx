import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import type { ViewerData } from "./types";
import "./styles.css";

const graph: ViewerData["graph"] = JSON.parse(
  document.getElementById("recipe-data")!.textContent!,
);
const steps: ViewerData["steps"] = JSON.parse(
  document.getElementById("step-data")!.textContent!,
);
const root = document.getElementById("root")!;
hydrateRoot(
  root,
  <App graph={graph} steps={steps} hasRecipeIndex={root.hasAttribute("data-recipe-index")} />,
);
