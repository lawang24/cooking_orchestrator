import { useState } from "react";
import { validServings } from "../portions";

export function ServingControl({ servings, onChange }: {
  servings: number;
  onChange: (servings: number) => void;
}) {
  const [draft, setDraft] = useState(String(servings));
  const invalid = !validServings(Number(draft));

  function update(text: string) {
    setDraft(text);
    const value = Number(text);
    if (validServings(value)) onChange(value);
  }

  return (
    <div className="servings-control">
      <label htmlFor="servings">Servings</label>
      <div className="servings-stepper">
        <button type="button" aria-label="Decrease servings" disabled={servings <= 1}
          onClick={() => update(String(servings - 1))}>−</button>
        <input id="servings" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1"
          required value={draft} aria-invalid={invalid} aria-describedby={invalid ? "servings-error" : undefined}
          onChange={event => update(event.target.value)} />
        <button type="button" aria-label="Increase servings" disabled={servings >= Number.MAX_SAFE_INTEGER}
          onClick={() => update(String(servings + 1))}>+</button>
      </div>
      {invalid && <span id="servings-error">Enter a whole number of servings, starting at 1.</span>}
    </div>
  );
}
