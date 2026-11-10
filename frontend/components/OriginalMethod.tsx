import type { Model } from "../model";

export function OriginalMethod({ model, id }: { model: Model; id: string }) {
  const method = model.originalMethods.get(id);
  if (!method) return null;
  return (
    <details className="original-method">
      <summary>Original method ({model.originalServings} {model.originalServings === 1 ? "serving" : "servings"})</summary>
      <p>{method}</p>
    </details>
  );
}
