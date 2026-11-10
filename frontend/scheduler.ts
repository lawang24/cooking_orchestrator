// Live, single-cook scheduling. Only a cook's start/finish events change state.
import type { ActionNode, Edge } from "./types";

export function createSchedule(actions: ActionNode[], links: Edge[]) {
  const parents = new Map(actions.map(({ id }) => [id, [] as string[]]));
  const followers = new Map(actions.map(({ id }) => [id, [] as string[]]));
  for (const { from, to } of links) {
    parents.get(to)!.push(from);
    followers.get(from)!.push(to);
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
  return { priority, parents };
}

type Schedule = ReturnType<typeof createSchedule>;
export interface CookingState {
  running: ReadonlySet<string>;
  done: ReadonlySet<string>;
}
export const initialCookingState: CookingState = {
  running: new Set(),
  done: new Set(),
};

export function currentAction(schedule: Schedule, state: CookingState) {
  const occupied = new Set<string>();
  for (const action of schedule.priority) {
    if (!state.running.has(action.id)) continue;
    if (action.attention === "active") return action;
    for (const tool of action.equipment) occupied.add(tool);
  }
  return schedule.priority.find(
    (action) =>
      action.cooksRequired <= 1 &&
      !state.running.has(action.id) &&
      !state.done.has(action.id) &&
      schedule.parents.get(action.id)!.every((id) => state.done.has(id)) &&
      action.equipment.every((tool) => !occupied.has(tool)),
  );
}

export type CookingEvent = { type: "start" | "finish"; id: string };
export function advance(
  schedule: Schedule,
  state: CookingState,
  event: CookingEvent,
): CookingState {
  if (event.type === "start") {
    if (
      state.running.has(event.id) ||
      currentAction(schedule, state)?.id !== event.id
    )
      return state;
    return { ...state, running: new Set(state.running).add(event.id) };
  }
  if (!state.running.has(event.id)) return state;
  const running = new Set(state.running);
  running.delete(event.id);
  return { running, done: new Set(state.done).add(event.id) };
}
