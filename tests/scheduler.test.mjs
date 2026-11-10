import test from "node:test";
import assert from "node:assert/strict";
import {
  createSchedule,
  currentAction,
  initialCookingState,
  advance,
} from "../frontend/scheduler.ts";

function task(id, attention, seconds, equipment = []) {
  return {
    id,
    attention,
    equipment,
    scheduled_duration_seconds: seconds,
    cooksRequired: attention === "active" ? 1 : 0,
  };
}

test("passive tasks can finish independently while the cook works", () => {
  const sauce = task("sauce", "passive", 30, ["pan"]);
  const water = task("water", "passive", 20, ["pot"]);
  const chop = task("chop", "active", 10, ["knife"]);
  const pasta = task("pasta", "active", 1, ["pot"]);
  const plan = createSchedule(
    [chop, water, sauce, pasta],
    [{ from: "water", to: "pasta" }],
  );
  let state = initialCookingState;
  function start(id) {
    assert.equal(currentAction(plan, state)?.id, id);
    state = advance(plan, state, { type: "start", id });
  }
  function finish(id) {
    state = advance(plan, state, { type: "finish", id });
  }
  start("sauce");
  start("water");
  assert.deepEqual([...state.running], ["sauce", "water"]);
  start("chop");
  finish("water");
  assert.equal(currentAction(plan, state).id, "chop");
  assert.equal(advance(plan, state, { type: "start", id: "pasta" }), state);
  finish("chop");
  start("pasta");
  finish("pasta");
  assert.equal(currentAction(plan, state), undefined);
  assert.deepEqual([...state.running], ["sauce"]);
  finish("sauce");
  assert.equal(state.done.size, 4);
});

test("readiness requires finished prerequisites, free equipment and enough cooks", () => {
  const actions = [
    task("heat", "passive", 5, ["burner"]),
    task("saute", "active", 12, ["burner"]),
    task("use_water", "active", 10),
    task("chop", "active", 8),
    { ...task("lift", "active", 90), cooksRequired: 2 },
  ];
  const plan = createSchedule(actions, [{ from: "heat", to: "use_water" }]);
  assert.equal(
    currentAction(plan, initialCookingState).id,
    "heat",
    "downstream work counts toward priority",
  );
  let state = advance(plan, initialCookingState, { type: "start", id: "heat" });
  assert.equal(advance(plan, state, { type: "start", id: "heat" }), state);
  for (const id of ["saute", "use_water", "lift"]) {
    assert.equal(advance(plan, state, { type: "start", id }), state);
    assert.equal(advance(plan, state, { type: "finish", id }), state);
  }
  assert.equal(
    currentAction(plan, state).id,
    "chop",
    "the two higher-priority actions are blocked",
  );
  state = advance(plan, state, { type: "start", id: "chop" });
  state = advance(plan, state, { type: "finish", id: "chop" });
  assert.equal(currentAction(plan, state), undefined);
  state = advance(plan, state, { type: "finish", id: "heat" });
  assert.equal(
    currentAction(plan, state).id,
    "saute",
    "burner released on finish",
  );
});
