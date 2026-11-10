import { useEffect, useMemo, useRef, useState } from "react";
import { agentInstructions } from "../agent-instructions";
import { compileRecipe } from "../recipe-compiler";
import { createModel } from "../model";
import { GraphView } from "./GraphView";
import { RecipeDocument } from "./RecipeDocument";
import type { ViewerData } from "../types";

const noCompletedSteps = new Set<string>();

export function NewRecipe({ onSave, onCancel }: {
  onSave: (data: ViewerData, source: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [reading, setReading] = useState(false);
  const [review, setReview] = useState<ViewerData>();
  const [graphVisible, setGraphVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const version = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const instructions = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const errors = useRef<HTMLDivElement>(null);
  const model = useMemo(() => review ? createModel(review) : undefined, [review]);
  const busy = checking || reading;
  useEffect(() => () => { version.current++; }, []);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [review]);
  useEffect(() => { if (error) errors.current?.focus(); }, [error]);
  useEffect(() => {
    if (showInstructions && copyStatus.startsWith("Select")) {
      instructions.current?.focus();
      instructions.current?.select();
    }
  }, [showInstructions, copyStatus]);

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(agentInstructions);
      setCopyStatus("Copied. Paste into your agent, then add your recipe URL or text.");
    } catch {
      setShowInstructions(true);
      setCopyStatus("Select and copy the instructions below, then paste them into your agent.");
    }
  }

  async function check() {
    setError("");
    // Catch syntax errors immediately, before downloading Python.
    try { JSON.parse(text); }
    catch (error) {
      setError(`This isn’t valid JSON yet. Paste the complete recipe object without Markdown fences.\n${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const request = ++version.current;
    setChecking(true);
    setStatus("Starting recipe check…");
    try {
      const result = await compileRecipe(text, message => { if (request === version.current) setStatus(message); });
      if (request !== version.current) return;
      if (result.ok) { setReview(result.data); setGraphVisible(false); }
      else setError(result.error);
    } catch (error) {
      if (request === version.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === version.current) { setChecking(false); setStatus(""); }
    }
  }

  async function readFile(file: File) {
    const request = ++version.current;
    setReading(true);
    setError("");
    try {
      const content = await file.text();
      if (request === version.current) { setText(content); input.current?.focus(); }
    } catch {
      if (request === version.current) setError("That file could not be read. Choose it again or paste its JSON.");
    } finally {
      if (request === version.current) setReading(false);
    }
  }

  return (
    <div className="recipe-creator">
      <nav className="creator-nav" aria-label="Recipe navigation">
        <a className="wordmark" href="#home" aria-disabled={busy} onClick={event => { event.preventDefault(); if (!busy) onCancel(); }}>← All recipes</a>
        <span className="muted">New recipe</span>
      </nav>
      <header className="creator-header">
        <p className="eyebrow">{review ? "02 / Review" : "01 / Add your recipe"}</p>
        <h1 ref={heading} tabIndex={-1}>{review ? "Ready for your kitchen?" : "Bring your own recipe"}</h1>
        <p>{review ? "Review the ingredients, instructions, and recipe notes before saving." : "Have your agent prepare the recipe, then bring its JSON here."}</p>
      </header>
      {review && model ? <>
        <div className="review-controls">
          <p className="validation-success">✓ Recipe structure and measurements checked</p>
          <div className="creator-actions">
            <button type="button" onClick={() => setReview(undefined)}>Edit JSON</button>
            <button type="button" className="primary-button" onClick={() => onSave(review, text)}>Save recipe</button>
          </div>
          <p className="muted session-note">Saved for this session. Refreshing clears added recipes.</p>
        </div>
        <nav className="review-tabs" aria-label="Recipe preview">
          <button type="button" aria-pressed={!graphVisible} aria-controls="recipes-panel" onClick={() => setGraphVisible(false)}>Recipe</button>
          <button type="button" aria-pressed={graphVisible} aria-controls="graph-panel" onClick={() => setGraphVisible(true)}>Graph</button>
        </nav>
        <RecipeDocument model={model} hidden={graphVisible} />
        <GraphView model={model} done={noCompletedSteps} active={graphVisible} />
      </> : <main className="creator-form">
        <section className="creator-card" aria-labelledby="agent-heading">
          <span className="card-number" aria-hidden="true">1</span>
          <div className="card-content">
            <h2 id="agent-heading">Give your agent the instructions</h2>
            <p>Copy our recipe guide, schema, and examples. Paste them into your agent along with your recipe URL or text.</p>
            <button type="button" id="copy-agent-instructions" onClick={copyInstructions}>Copy agent instructions</button>
            <p className="copy-status" role="status">{copyStatus}</p>
            <details open={showInstructions} onToggle={event => setShowInstructions(event.currentTarget.open)}>
              <summary>View instructions</summary>
              <textarea ref={instructions} aria-label="Agent instructions" className="instructions-text" readOnly value={agentInstructions} rows={12} />
            </details>
          </div>
        </section>
        <form className="creator-card" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!busy) void check(); }}>
          <span className="card-number" aria-hidden="true">2</span>
          <div className="card-content">
            <h2><label htmlFor="recipe-json">Bring back the recipe JSON</label></h2>
            <p>Paste your agent’s result, or choose a JSON file.</p>
            <textarea ref={input} id="recipe-json" className="recipe-json" value={text} spellCheck={false} autoCapitalize="off" autoComplete="off" rows={10} placeholder={'{\n  "schemaVersion": "1.0",\n  "recipeId": "your-recipe",\n  …\n}'} disabled={busy} required aria-describedby={error ? "recipe-error" : "recipe-json-help"} aria-invalid={Boolean(error)} onChange={event => { setText(event.target.value); setError(""); }} />
            <div className="file-picker"><label htmlFor="recipe-file">Or upload a file</label><input id="recipe-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }} /></div>
            <p id="recipe-json-help" className="muted">Your recipe is checked in this browser. The first check downloads the checker and needs an internet connection.</p>
            {error && <div id="recipe-error" className="recipe-error" ref={errors} role="alert" tabIndex={-1}>
              <h3>Recipe needs another look</h3>
              <pre>{error}</pre>
              <p>Update the JSON or send these details to your agent, then check it again.</p>
            </div>}
            <p className="checker-status" role="status" aria-live="polite">{busy && <span className="loading-spinner" aria-hidden="true" />}{reading ? "Reading file…" : status}</p>
            <div className="creator-actions">
              <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
              <button type="submit" className="primary-button" disabled={busy || !text.trim()}>{checking ? "Checking…" : "Check & review"}</button>
            </div>
            <p className="muted session-note">Added recipes last until you refresh this page.</p>
          </div>
        </form>
      </main>}
    </div>
  );
}
