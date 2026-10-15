import type { ToodledoClient } from "./client.js";
import type { ToodledoTask } from "../types.js";

const TASK_FIELDS =
  "folder,context,goal,location,tag,status,priority,star,duedate,duedatemod,startdate,duetime,starttime,remind,repeat,length,note,parent,children,added,timer,meta";

export interface GetTasksOptions {
  comp?: number; // -1=both, 0=incomplete (default), 1=completed
  before?: number; // unix timestamp
  after?: number; // unix timestamp
  id?: number; // single task by ID
  start?: number; // pagination offset
  num?: number; // max results (default 1000)
}

export async function getTasks(
  client: ToodledoClient,
  options: GetTasksOptions = {}
): Promise<ToodledoTask[]> {
  const params: Record<string, string> = {
    fields: TASK_FIELDS,
  };

  if (options.comp !== undefined) params.comp = String(options.comp);
  if (options.before !== undefined) params.before = String(options.before);
  if (options.after !== undefined) params.after = String(options.after);
  if (options.id !== undefined) params.id = String(options.id);
  if (options.start !== undefined) params.start = String(options.start);
  if (options.num !== undefined) params.num = String(options.num);

  const data = (await client.get("/tasks/get.php", params)) as Array<
    Record<string, unknown>
  >;

  // First element is metadata {num, total}, skip it
  if (data.length > 0 && "num" in data[0] && "total" in data[0]) {
    return data.slice(1) as unknown as ToodledoTask[];
  }

  return data as unknown as ToodledoTask[];
}

export async function addTask(
  client: ToodledoClient,
  task: Record<string, unknown>
): Promise<ToodledoTask> {
  // Without `fields`, Toodledo returns only id/title/modified/completed
  const data = (await client.post("/tasks/add.php", {
    tasks: JSON.stringify([task]),
    fields: TASK_FIELDS,
  })) as ToodledoTask[];

  return data[0]!;
}

export async function editTask(
  client: ToodledoClient,
  id: number,
  updates: Record<string, unknown>
): Promise<ToodledoTask> {
  const data = (await client.post("/tasks/edit.php", {
    tasks: JSON.stringify([{ id, ...updates }]),
    fields: TASK_FIELDS,
  })) as ToodledoTask[];

  return data[0]!;
}

export interface TaskEditResult {
  updated: ToodledoTask[];
  errors: { id: number; error: string }[];
}

// Toodledo accepts at most 50 tasks per edit request
const EDIT_BATCH_SIZE = 50;

export async function editTasks(
  client: ToodledoClient,
  edits: Array<{ id: number } & Record<string, unknown>>
): Promise<TaskEditResult> {
  const result: TaskEditResult = { updated: [], errors: [] };

  for (let i = 0; i < edits.length; i += EDIT_BATCH_SIZE) {
    const batch = edits.slice(i, i + EDIT_BATCH_SIZE);
    const data = (await client.post("/tasks/edit.php", {
      tasks: JSON.stringify(batch),
      fields: TASK_FIELDS,
    })) as Array<Record<string, unknown>>;

    // Per-task failures come back inline as {errorCode, errorDesc, ref}
    data.forEach((item, idx) => {
      if ("errorCode" in item) {
        result.errors.push({
          id: Number(item.ref ?? item.id ?? batch[idx]?.id),
          error: String(item.errorDesc ?? item.errorCode),
        });
      } else {
        result.updated.push(item as unknown as ToodledoTask);
      }
    });
  }

  return result;
}

export async function deleteTask(
  client: ToodledoClient,
  id: number
): Promise<void> {
  await client.post("/tasks/delete.php", {
    tasks: JSON.stringify([id]),
  });
}
