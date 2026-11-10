import test from "node:test";
import assert from "node:assert/strict";
import {
  createSchedule,
  currentAction,
  initialCookingState,
  finishTask,
  startTask,
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
    [{ from: "water", to: "pasta", kind: "food" }],
  );
  let state = startAssignedTasks(plan, initialCookingState);
  function finish(id) {
    state = finishTask(plan, state, id);
  }
  assert.equal(currentAction(plan, state).id, "sauce");
  assert.equal(state.running.size, 0);
  assert.equal(finishTask(plan, state, "sauce"), state, "an unstarted task cannot finish");
  assert.equal(startTask(plan, state, "water"), state, "only the assigned task can start");
  state = startTask(plan, state, "sauce");
  assert.equal(currentAction(plan, state).id, "water", "consecutive passive tasks each need acknowledgement");
  assert.deepEqual([...state.running], ["sauce"]);
  state = startTask(plan, state, "water");
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
  const plan = createSchedule(actions, [{ from: "heat", to: "use_water", kind: "food" }]);
  let state = startAssignedTasks(plan, initialCookingState);
  assert.equal(currentAction(plan, state).id, "heat");
  state = startTask(plan, state, "heat");
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

test("getting, peeling and slicing an ingredient stay together across close branch priorities", () => {
  const plan = createSchedule([
    task("get_onions", "active", 90),
    task("peel_onions", "active", 30),
    task("slice_onions", "active", 30),
    task("other_prep", "active", 140),
  ], [
    { from: "get_onions", to: "peel_onions", kind: "food" },
    { from: "peel_onions", to: "slice_onions", kind: "food" },
  ]);
  let state = startAssignedTasks(plan, initialCookingState);
  for (const id of ["get_onions", "peel_onions", "slice_onions", "other_prep"]) {
    assert.equal(currentAction(plan, state)?.id, id);
    state = finishTask(plan, state, id);
  }
  assert.equal(state.running.size, 0);
  assert.equal(state.done.size, 4);
});

test("a substantially longer branch takes priority over continuing the last ingredient", () => {
  const plan = createSchedule([
    task("get_onions", "active", 300),
    task("slice_onions", "active", 30),
    task("mix_marinade", "active", 30),
    task("marinate", "passive", 600),
  ], [
    { from: "get_onions", to: "slice_onions", kind: "food" },
    { from: "get_onions", to: "mix_marinade", kind: "order" },
    { from: "mix_marinade", to: "marinate", kind: "food" },
  ]);
  let state = startAssignedTasks(plan, initialCookingState);
  state = finishTask(plan, state, "get_onions");
  assert.equal(currentAction(plan, state).id, "mix_marinade");
  state = finishTask(plan, state, "mix_marinade");
  assert.equal(currentAction(plan, state).id, "marinate");
  assert.deepEqual([...state.running], []);
  state = startTask(plan, state, "marinate");
  assert.deepEqual([...state.running], ["marinate", "slice_onions"]);
});

test("ordering prerequisites alone do not imply continuing work on the same food", () => {
  const plan = createSchedule([
    task("get_onions", "active", 300),
    task("unrelated_step", "active", 30),
    task("other_prep", "active", 140),
  ], [{ from: "get_onions", to: "unrelated_step", kind: "order" }]);
  const state = finishTask(plan, startAssignedTasks(plan, initialCookingState), "get_onions");
  assert.equal(currentAction(plan, state).id, "other_prep");
});

test("continuation never bypasses prerequisites, occupied tools or cook requirements", async t => {
  for (const reason of ["prerequisite", "equipment", "cooks"]) {
    await t.test(reason, () => {
      const plan = createSchedule([
        task("hold_knife", "passive", 1000, ["knife"]),
        task("get_onions", "active", 300),
        { ...task("slice_onions", "active", 30, reason === "equipment" ? ["knife"] : []),
          cooksRequired: reason === "cooks" ? 2 : 1 },
        task("other_prep", "active", 140),
      ], [
        { from: "get_onions", to: "slice_onions", kind: "food" },
        ...(reason === "prerequisite"
          ? [{ from: "hold_knife", to: "slice_onions", kind: "order" }]
          : []),
      ]);
      let state = startAssignedTasks(plan, initialCookingState);
      state = startTask(plan, state, "hold_knife");
      assert.deepEqual([...state.running], ["hold_knife", "get_onions"]);
      state = finishTask(plan, state, "get_onions");
      assert.equal(currentAction(plan, state).id, "other_prep");
      assert.equal(state.running.has("slice_onions"), false);
    });
  }
});

test("passive completions retain the last hands-on context even after waiting", () => {
  const plan = createSchedule([
    task("wait", "passive", 1000),
    task("get_onions", "active", 300),
    task("slice_onions", "active", 30),
    task("other_prep", "active", 140),
  ], [
    { from: "get_onions", to: "slice_onions", kind: "food" },
    { from: "wait", to: "slice_onions", kind: "order" },
    { from: "wait", to: "other_prep", kind: "order" },
  ]);
  let state = startAssignedTasks(plan, initialCookingState);
  state = startTask(plan, state, "wait");
  state = finishTask(plan, state, "get_onions");
  assert.equal(currentAction(plan, state), undefined);
  assert.deepEqual([...state.running], ["wait"]);
  state = finishTask(plan, state, "wait");
  assert.equal(state.lastHandsOn, "get_onions");
  assert.equal(currentAction(plan, state).id, "slice_onions");
});

test("background completion leaves the assigned action in place and preserves its continuation", () => {
  const plan = createSchedule([
    task("wait", "passive", 1000),
    task("get_onions", "active", 90),
    task("peel_onions", "active", 30),
    task("slice_onions", "active", 30),
    task("other_prep", "active", 140),
  ], [
    { from: "get_onions", to: "peel_onions", kind: "food" },
    { from: "peel_onions", to: "slice_onions", kind: "food" },
  ]);
  let state = startAssignedTasks(plan, initialCookingState);
  state = startTask(plan, state, "wait");
  state = finishTask(plan, state, "get_onions");
  state = finishTask(plan, state, "wait");
  assert.equal(currentAction(plan, state).id, "peel_onions");
  assert.equal(state.lastHandsOn, "get_onions");
  state = finishTask(plan, state, "peel_onions");
  assert.equal(currentAction(plan, state).id, "slice_onions");
});

test("continuing into a passive step requires acknowledgement before freeing the cook", () => {
  const plan = createSchedule([
    task("start_simmer", "active", 300),
    task("simmer", "passive", 60, ["pot"]),
    task("chop_garnish", "active", 140, ["knife"]),
  ], [{ from: "start_simmer", to: "simmer", kind: "food" }]);
  let state = startAssignedTasks(plan, initialCookingState);
  state = finishTask(plan, state, "start_simmer");
  assert.equal(currentAction(plan, state).id, "simmer");
  assert.equal(state.pendingStart, "simmer");
  assert.deepEqual([...state.running], []);
  const pending = state;
  state = startTask(plan, state, "simmer");
  assert.deepEqual([...state.running], ["simmer", "chop_garnish"]);
  assert.equal(state.done.has("simmer"), false);
  assert.equal(currentAction(plan, state).id, "chop_garnish");
  assert.equal(pending.pendingStart, "simmer", "previous state remains available for undo");
  assert.equal(pending.running.size, 0);
  assert.equal(startTask(plan, state, "simmer"), state, "repeated acknowledgement is ignored");
});

test("background completion preserves a passive task awaiting acknowledgement", () => {
  const plan = createSchedule([
    task("sauce", "passive", 100, ["pan"]),
    task("water", "passive", 60, ["pot"]),
    task("garnish", "active", 10),
  ], []);
  let state = startAssignedTasks(plan, initialCookingState);
  state = startTask(plan, state, "sauce");
  state = finishTask(plan, state, "sauce");
  assert.equal(currentAction(plan, state).id, "water");
  assert.equal(state.pendingStart, "water");
  assert.equal(state.running.size, 0);
  assert.equal(state.done.has("water"), false);
  state = startTask(plan, state, "water");
  assert.equal(currentAction(plan, state).id, "garnish");
});

test("initial ties retain walkthrough order and schedule priorities are immutable", () => {
  const plan = createSchedule([
    task("get_onions", "active", 90),
    task("slice_onions", "active", 30),
    task("other_prep", "active", 120),
  ], [{ from: "get_onions", to: "slice_onions", kind: "food" }]);
  const priority = plan.priority.map(action => action.id);
  const before = startAssignedTasks(plan, initialCookingState);
  assert.equal(currentAction(plan, before).id, "get_onions");
  const after = finishTask(plan, before, "get_onions");
  assert.equal(currentAction(plan, after).id, "slice_onions");
  assert.equal(before.lastHandsOn, undefined);
  assert.deepEqual([...before.running], ["get_onions"]);
  assert.deepEqual([...before.done], []);
  assert.deepEqual(plan.priority.map(action => action.id), priority);
  assert.equal(currentAction(plan, finishTask(plan, before, "get_onions")).id, "slice_onions");
});
