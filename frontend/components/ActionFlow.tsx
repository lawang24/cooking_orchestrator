import { name, type Model } from "../model";
import { formatQuantity, formatRecipeText } from "../portions";
import type { ActionNode, FoodNode } from "../types";
import { OriginalMethod } from "./OriginalMethod";

type Food = Exclude<FoodNode, ActionNode>;

function FoodLabel({ food }: { food: Food }) {
  // Older recipes repeat the structured quantity in the food's name.
  const suffix = ` (${food.quantity} ${food.unit})`;
  const label = food.name.endsWith(suffix) ? food.name.slice(0, -suffix.length) : food.name;
  return (
    <>
      <span className="food-name">{formatRecipeText(label)}</span>
      {food.quantity !== undefined && (
        <span className="food-amount">{formatQuantity(food.quantity, food.unit)} {food.unit}</span>
      )}
    </>
  );
}

function inputsFor(model: Model, id: string): Food[] {
  return model.graph.edges.filter(edge => edge.to === id)
    .map(edge => model.byId.get(edge.from)!)
    .filter((node): node is Food => node.type !== "action");
}

function FoodList({ foods, current }: { foods: Food[]; current?: string }) {
  const ordered = current
    ? [...foods.filter(food => food.id === current), ...foods.filter(food => food.id !== current)]
    : foods;
  return (
    <ul className="food-list">
      {ordered.map(food => (
        <li key={food.id} data-food-id={food.id} data-current={food.id === current || undefined}>
          <FoodLabel food={food} />
          {food.id === current && <span className="this-output">This output</span>}
        </li>
      ))}
    </ul>
  );
}

export function ActionFlow({ model, node, primary = false }: {
  model: Model;
  node: ActionNode;
  primary?: boolean;
}) {
  const Heading = primary ? "h2" : "h4";
  const Instruction = primary ? "h1" : "p";
  const outputs = model.graph.edges.filter(edge => edge.from === node.id)
    .map(edge => model.byId.get(edge.to)!)
    .filter((food): food is Food => food.type !== "action");
  return (
    <div className="action-flow">
      <section className="step-inputs" aria-label="Inputs">
        <Heading className="flow-label">Inputs</Heading>
        <FoodList foods={inputsFor(model, node.id)} />
      </section>
      <section className="step-action" aria-label="Action">
        <Instruction id={primary ? "step-instruction" : undefined} tabIndex={primary ? -1 : undefined}>
          {formatRecipeText(node.instruction)}
        </Instruction>
        <OriginalMethod key={node.id} model={model} id={node.id} />
      </section>
      <section className="step-outputs" aria-label="Outputs">
        <Heading className="flow-label">Outputs</Heading>
        <ul className="output-list">
          {outputs.map(food => {
            // Only immediate food flow determines the receiving step.
            const nextEdge = model.graph.edges.find(edge => edge.from === food.id);
            const action = nextEdge && model.byId.get(nextEdge.to);
            const nextInputs = action ? inputsFor(model, action.id) : [];
            return (
              <li className="output-card" key={food.id} data-output-id={food.id}>
                <div className="output-food"><FoodLabel food={food} /></div>
                {action ? (
                  <details className="next-step" open>
                    <summary>
                      Used for <strong>{name(action)}</strong>
                      <span className="input-count"> · {nextInputs.length} {nextInputs.length === 1 ? "input" : "inputs"}</span>
                    </summary>
                    <FoodList foods={nextInputs} current={food.id} />
                  </details>
                ) : <span className="finished-output">Finished dish</span>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
