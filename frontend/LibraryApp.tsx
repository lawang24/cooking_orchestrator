import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { App } from "./App";
import { NewRecipe } from "./components/NewRecipe";
import { formatRecipeText } from "./portions";
import type { LibraryData, LibraryRecipe, ViewerData } from "./types";
import { loadRecipes, saveRecipe } from "./recipe-storage";

export function LibraryApp({ recipes }: LibraryData) {
  const [shared, setShared] = useState<LibraryRecipe[]>();
  const [saved, setSaved] = useState<LibraryRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [route, setRoute] = useState("home");
  const [ready, setReady] = useState(false);
  const request = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const readRoute = () => setRoute(window.location.hash.slice(1) || "home");
    readRoute();
    setReady(true);
    window.addEventListener("hashchange", readRoute);
    return () => window.removeEventListener("hashchange", readRoute);
  }, []);
  const refresh = useCallback(async () => {
    const attempt = ++request.current;
    setLoading(true); setLoadError("");
    try {
      const items = await loadRecipes();
      if (request.current === attempt) setShared(items);
    } catch {
      if (request.current === attempt) setLoadError("Could not load the shared library. Showing available recipes.");
    } finally { if (request.current === attempt) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
  // Successful saves stay visible even if an older library request finishes later.
  const all = [...new Map([...(shared ?? recipes), ...saved].map(recipe => [recipe.id, recipe])).values()];
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
  async function save(_data: ViewerData, source: string) {
    const recipe = await saveRecipe(source);
    setSaved(current => [...current.filter(item => item.id !== recipe.id), recipe]);
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
      {ready && loading && <p className="library-notice" role="status">Loading shared recipes…</p>}
      {loadError && <p className="library-notice" role="alert">{loadError} <button type="button" onClick={() => void refresh()}>Retry</button></p>}
      {ready && !loading && !loadError && route !== "home" && <p className="library-notice" role="status">This recipe could not be found in the shared library.</p>}
      {all.length ? <ul className="library-recipes">
        {all.map(recipe => (
          <li key={recipe.id}>
            <a href={recipe.page ?? `#recipe/${recipe.id}`} onClick={event => open(event, `recipe/${recipe.id}`)}>
              <span className="library-recipe-name">{formatRecipeText(recipe.graph.name)}</span>
              <span className="library-recipe-meta">Serves {recipe.graph.servings}</span>
              <span className="library-arrow" aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul> : <p className="library-empty">Your first recipe starts here. Choose New recipe to add one.</p>}
    </main>
  );
}
