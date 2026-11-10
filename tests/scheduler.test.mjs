import test from "node:test";
import assert from "node:assert/strict";
import {
  createSchedule,
  currentAction,
  initialCookingState,
  finishTask,
  startAssignedTasks,
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
  let state = startAssignedTasks(plan, initialCookingState);
  function finish(id) {
    state = finishTask(plan, state, id);
  }
  assert.deepEqual([...state.running], ["sauce", "water", "chop"]);
  finish("water");
  assert.equal(currentAction(plan, state).id, "chop");
  assert.equal(finishTask(plan, state, "pasta"), state);
  finish("chop");
  assert.equal(currentAction(plan, state).id, "pasta");
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
  let state = startAssignedTasks(plan, initialCookingState);
  assert.deepEqual([...state.running], ["heat", "chop"], "downstream work counts toward priority");
  for (const id of ["saute", "use_water", "lift"]) {
    assert.equal(finishTask(plan, state, id), state);
  }
  assert.equal(
    currentAction(plan, state).id,
    "chop",
    "the two higher-priority actions are blocked",
  );
  state = finishTask(plan, state, "chop");
  assert.equal(currentAction(plan, state), undefined);
  state = finishTask(plan, state, "heat");
  assert.equal(
    currentAction(plan, state).id,
    "saute",
    "burner released on finish",
  );
});
