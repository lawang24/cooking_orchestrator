import { useEffect, useRef, useState, type MouseEvent } from "react";
import { App } from "./App";
import { NewRecipe } from "./components/NewRecipe";
import { formatRecipeText } from "./portions";
import type { LibraryData, LibraryRecipe, ViewerData } from "./types";

export function LibraryApp({ recipes }: LibraryData) {
  const [added, setAdded] = useState<LibraryRecipe[]>([]);
  const [route, setRoute] = useState("home");
  const [ready, setReady] = useState(false);
  const sequence = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const readRoute = () => setRoute(window.location.hash.slice(1) || "home");
    readRoute();
    setReady(true);
    window.addEventListener("hashchange", readRoute);
    return () => window.removeEventListener("hashchange", readRoute);
  }, []);
  const all = [...added, ...recipes];
  const selected = route.startsWith("recipe/") ? all.find(recipe => recipe.id === route.slice(7)) : undefined;
  useEffect(() => {
    window.scrollTo(0, 0);
    title.current?.focus();
    document.title = `${formatRecipeText(selected?.graph.name ?? (route === "new" ? "New recipe" : "Recipes"))} · Cooking Orchestrator`;
  }, [route, selected]);

  function navigate(next: string) {
    window.location.hash = next;
    setRoute(next);
  }
  function open(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(next);
  }
  function save(data: ViewerData, source: string) {
    // A library entry has its own key; repeated recipe IDs never overwrite food
    // graphs or existing recipes. This list intentionally lives only in memory.
    const recipe = { ...data, source, id: `added-${++sequence.current}` };
    setAdded(current => [recipe, ...current]);
    navigate(`recipe/${recipe.id}`);
  }
  if (selected) return <App key={selected.id} {...selected} hasRecipeIndex onHome={() => navigate("home")} />;
  if (route === "new") return <NewRecipe onSave={save} onCancel={() => navigate("home")} />;

  return (
    <main className="recipe-library" id="recipe-library" data-hydrated={ready ? "true" : "false"}>
      <header className="library-header">
        <div><p className="eyebrow">Cooking Orchestrator</p><h1 ref={title} tabIndex={-1}>Choose a recipe</h1></div>
        <a className="primary-button" href="#new" hidden={!ready} onClick={event => open(event, "new")}><span aria-hidden="true">＋</span> New recipe</a>
      </header>
      <noscript><p>Open any recipe below to read its ingredients and instructions. Enable JavaScript to add a recipe or use the cooking guide.</p></noscript>
      {route !== "home" && <p className="library-notice" role="status">This recipe is no longer in this session. Add its JSON again to open it.</p>}
      {added.length > 0 && <p className="library-notice">Recipes added this session are cleared when you refresh.</p>}
      {all.length ? <ul className="library-recipes">
        {all.map(recipe => (
          <li key={recipe.id}>
            <a href={recipe.page ?? `#recipe/${recipe.id}`} onClick={event => open(event, `recipe/${recipe.id}`)}>
              <span className="library-recipe-name">{formatRecipeText(recipe.graph.name)}</span>
              <span className="library-recipe-meta">Serves {recipe.graph.servings}{!recipe.page && <span className="session-label">This session</span>}</span>
              <span className="library-arrow" aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul> : <p className="library-empty">Your first recipe starts here. Choose New recipe to add one.</p>}
    </main>
  );
}
