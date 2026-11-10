// Live, single-cook scheduling. Assignments start immediately. Only the cook can complete a task.
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
  return schedule.priority.find(
    (action) => action.attention === "active" && state.running.has(action.id),
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
  for (const action of schedule.priority) {
    if (
      action.cooksRequired > 1 ||
      running.has(action.id) ||
      state.done.has(action.id) ||
      !schedule.parents.get(action.id)!.every((id) => state.done.has(id)) ||
      action.equipment.some((tool) => occupied.has(tool))
    ) continue;
    running.add(action.id);
    if (action.attention === "active") break;
    for (const tool of action.equipment) occupied.add(tool);
  }
  return { ...state, running };
}

export function finishTask(schedule: Schedule, state: CookingState, id: string): CookingState {
  if (!state.running.has(id)) return state;
  const running = new Set(state.running);
  running.delete(id);
  return startAssignedTasks(schedule, { running, done: new Set(state.done).add(id) });
}
