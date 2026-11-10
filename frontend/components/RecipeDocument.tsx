import { name, timing, type Model } from "../model";

// This is real, visible HTML before hydration, and remains available in Recipes.
export function RecipeDocument({
  model,
  hidden,
}: {
  model: Model;
  hidden: boolean;
}) {
  const { graph, actions } = model;
  return (
    <main
      id="recipes-panel"
      className="info-pane recipe-document"
      aria-label="Recipes"
      hidden={hidden}
    >
      <h1>{graph.name}</h1>
      <ul id="recipe-list">
        {(graph.recipes ?? [graph]).map((recipe) => (
          <li key={"tag" in recipe ? recipe.tag : recipe.recipeId}>
            {recipe.name} · {recipe.servings} serving
            {recipe.servings === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
      <h2>Ingredients</h2>
      <ul id="ingredient-list">
        {graph.nodes
          .filter((node) => node.type === "ingredient")
          .map((node) => (
            <li key={node.id}>
              {node.quantity} {node.unit} {node.name}
            </li>
          ))}
      </ul>
      <h2>Instructions</h2>
      <p className="muted">
        Timings are planning aids. Follow the completion cues in each
        instruction.
      </p>
      <ol id="recipe-instructions" className="instruction-list">
        {actions.map((node) => (
          <li key={node.id} data-action-id={node.id}>
            <h3>{name(node)}</h3>
            <p>{node.instruction}</p>
            <p className="muted">{timing(node)}</p>
            {node.equipment.length > 0 && (
              <p className="muted">
                Use{" "}
                {node.equipment.map((id) => id.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
      <h2>Recipe notes</h2>
      <ul id="recipe-notes">
        {graph.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
      <h2>Finished dishes</h2>
      <ul>
        {graph.outputs.map((id) => (
          <li key={id}>{name(model.byId.get(id)!)}</li>
        ))}
      </ul>
    </main>
  );
}
