// Live, single-cook scheduling. Passive assignments wait for a start acknowledgement.
import type { ActionNode, Connection } from "./types";

// Prefer staying with the food in hand, but let branches with a larger lead win.
const CONTINUATION_BONUS_SECONDS = 120;

export function createSchedule(actions: ActionNode[], links: Connection[]) {
  const parents = new Map(actions.map(({ id }) => [id, [] as string[]]));
  const followers = new Map(actions.map(({ id }) => [id, [] as string[]]));
  const foodFollowers = new Map(actions.map(({ id }) => [id, new Set<string>()]));
  for (const { from, to, kind } of links) {
    parents.get(to)!.push(from);
    followers.get(from)!.push(to);
    if (kind === "food") foodFollowers.get(from)!.add(to);
  }

  // The compiler supplies actions in topological order. Long branches take
  // priority; stable sorting preserves the walkthrough order for equal scores.
  const remaining = new Map<string, number>();
  for (const action of [...actions].reverse()) {
    const downstream = followers
      .get(action.id)!
      .map((id) => remaining.get(id)!);
    remaining.set(
      action.id,
      action.scheduled_duration_seconds + Math.max(0, ...downstream),
    );
  }
  const priority = [...actions].sort(
    (a, b) => remaining.get(b.id)! - remaining.get(a.id)!,
  );
  return { priority, parents, remaining, foodFollowers };
}

type Schedule = ReturnType<typeof createSchedule>;
export interface CookingState {
  running: ReadonlySet<string>;
  done: ReadonlySet<string>;
  pendingStart?: string;
  lastHandsOn?: string;
}
export const initialCookingState: CookingState = {
  running: new Set(),
  done: new Set(),
};

export function currentAction(schedule: Schedule, state: CookingState) {
  return schedule.priority.find(
    (action) => action.id === state.pendingStart ||
      (action.attention === "active" && state.running.has(action.id)),
  );
}

export function startAssignedTasks(schedule: Schedule, state: CookingState): CookingState {
  if (currentAction(schedule, state)) return state;
  const running = new Set(state.running);
  const occupied = new Set(
    schedule.priority
      .filter((action) => running.has(action.id))
      .flatMap((action) => action.equipment),
  );
  const continuations = state.lastHandsOn
    ? schedule.foodFollowers.get(state.lastHandsOn)
    : undefined;
  const score = (action: ActionNode) =>
    schedule.remaining.get(action.id)! +
    (continuations?.has(action.id) ? CONTINUATION_BONUS_SECONDS : 0);
  const priority = [...schedule.priority].sort((a, b) => score(b) - score(a));
  for (const action of priority) {
    if (
      action.cooksRequired > 1 ||
      running.has(action.id) ||
      state.done.has(action.id) ||
      !schedule.parents.get(action.id)!.every((id) => state.done.has(id)) ||
      action.equipment.some((tool) => occupied.has(tool))
    ) continue;
    if (action.attention === "passive") return { ...state, pendingStart: action.id };
    running.add(action.id);
    break;
  }
  return { ...state, running };
}

export function startTask(schedule: Schedule, state: CookingState, id: string): CookingState {
  if (state.pendingStart !== id) return state;
  return startAssignedTasks(schedule, {
    ...state,
    pendingStart: undefined,
    running: new Set(state.running).add(id),
  });
}

export function finishTask(schedule: Schedule, state: CookingState, id: string): CookingState {
  if (!state.running.has(id)) return state;
  const running = new Set(state.running);
  running.delete(id);
  return startAssignedTasks(schedule, {
    ...state,
    running,
    done: new Set(state.done).add(id),
    // Background completions must not change which food the cook last handled.
    lastHandsOn: currentAction(schedule, state)?.id === id ? id : state.lastHandsOn,
  });
}
