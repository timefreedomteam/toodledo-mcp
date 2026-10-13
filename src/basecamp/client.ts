import { getSession } from "./auth.js";

// Minimal Basecamp API client. Docs: https://github.com/basecamp/bc3-api

const USER_AGENT = "toodledo-mcp (https://github.com/timefreedomteam/toodledo-mcp)";

export interface Person { id: number; name: string; email_address?: string }
export interface DockItem { id: number; name: string; title: string; enabled: boolean; url: string }
export interface Project { id: number; name: string; description?: string; dock: DockItem[] }
export interface TodoList { id: number; title: string; todos_url: string; completed_ratio?: string }
export interface Todo {
  id: number;
  title?: string;
  content: string;
  description?: string;
  completed: boolean;
  due_on: string | null;
  starts_on?: string | null;
  assignees: Person[];
  completion_subscribers?: Person[];
  bucket?: { id: number; name: string };
  parent?: { id: number; title: string };
  app_url: string;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { accessToken, accountId } = await getSession();
  const url = path.startsWith("https://") ? path : `https://3.basecampapi.com/${accountId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Basecamp API ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res;
}

export async function get<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T;
}

/** GET every page of a list endpoint (follows the Link: rel="next" header). */
export async function getAll<T>(path: string, limit = 500): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  while (next && items.length < limit) {
    const res = await request(next);
    items.push(...((await res.json()) as T[]));
    next = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return items;
}

export async function send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T | null> {
  const res = await request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

// --- Name lookups ---

export async function listProjects(): Promise<Project[]> {
  return getAll<Project>("/projects.json");
}

export async function findProject(ref: string): Promise<Project> {
  const projects = await listProjects();
  const want = ref.trim().toLowerCase();
  const match =
    projects.find((p) => String(p.id) === want) ??
    projects.find((p) => p.name.toLowerCase() === want) ??
    projects.filter((p) => p.name.toLowerCase().includes(want)).at(0);
  if (!match) {
    throw new Error(`No Basecamp project matches "${ref}". Projects: ${projects.map((p) => p.name).join(", ")}`);
  }
  return match;
}

export function dockTools(project: Project, name: string): DockItem[] {
  return project.dock.filter((d) => d.name === name && d.enabled);
}

export function dockTool(project: Project, name: string, label: string): DockItem {
  const tool = dockTools(project, name)[0];
  if (!tool) throw new Error(`Project "${project.name}" has no ${label}`);
  return tool;
}

export async function listTodoLists(project: Project): Promise<TodoList[]> {
  const todoset = dockTool(project, "todoset", "to-do lists");
  return getAll<TodoList>(`/buckets/${project.id}/todosets/${todoset.id}/todolists.json`);
}

export async function findTodoList(project: Project, ref?: string): Promise<TodoList> {
  const lists = await listTodoLists(project);
  if (!lists.length) throw new Error(`Project "${project.name}" has no to-do lists`);
  if (!ref) return lists[0];
  const want = ref.trim().toLowerCase();
  const match =
    lists.find((l) => String(l.id) === want) ??
    lists.find((l) => l.title.toLowerCase() === want) ??
    lists.find((l) => l.title.toLowerCase().includes(want));
  if (!match) {
    throw new Error(`No to-do list matches "${ref}" in ${project.name}. Lists: ${lists.map((l) => l.title).join(", ")}`);
  }
  return match;
}

export async function listTodos(list: TodoList, completed = false): Promise<Todo[]> {
  return getAll<Todo>(`${list.todos_url}${completed ? "?completed=true" : ""}`);
}

/** Find an open to-do by ID or by (part of) its title. */
export async function findTodo(project: Project, ref: string): Promise<Todo> {
  if (/^\d+$/.test(ref.trim())) return get<Todo>(`/buckets/${project.id}/todos/${ref.trim()}.json`);
  const want = ref.trim().toLowerCase();
  const matches: Todo[] = [];
  for (const list of await listTodoLists(project)) {
    for (const todo of await listTodos(list)) {
      if (todo.content.toLowerCase() === want) return todo;
      if (todo.content.toLowerCase().includes(want)) matches.push(todo);
    }
  }
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No open to-do matches "${ref}" in ${project.name}`);
  throw new Error(
    `Several to-dos match "${ref}": ${matches.map((t) => `${t.content} (ID ${t.id})`).join("; ")}. Use the ID.`
  );
}

export async function listPeople(project?: Project): Promise<Person[]> {
  return getAll<Person>(project ? `/projects/${project.id}/people.json` : "/people.json");
}

export async function resolvePeople(names: string[], project?: Project): Promise<number[]> {
  const people = await listPeople(project);
  const ids: number[] = [];
  for (const name of names) {
    const want = name.trim().toLowerCase();
    if (want === "me") {
      ids.push(await myId());
      continue;
    }
    const match =
      people.find((p) => p.name.toLowerCase() === want || p.email_address?.toLowerCase() === want) ??
      people.find((p) => p.name.toLowerCase().includes(want));
    if (!match) throw new Error(`No person matches "${name}"`);
    ids.push(match.id);
  }
  return ids;
}

export async function myId(): Promise<number> {
  return (await get<Person>("/my/profile.json")).id;
}

// --- Formatting ---

export function plainText(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatTodo(todo: Todo): string {
  const parts = [`${todo.completed ? "[x]" : "[ ]"} ${todo.content} (ID: ${todo.id})`];
  const meta: string[] = [];
  if (todo.bucket) meta.push(`Project: ${todo.bucket.name}`);
  if (todo.parent) meta.push(`List: ${todo.parent.title}`);
  if (todo.due_on) meta.push(`Due: ${todo.due_on}`);
  if (todo.assignees?.length) meta.push(`Assigned: ${todo.assignees.map((p) => p.name).join(", ")}`);
  if (meta.length) parts.push(`    ${meta.join(" | ")}`);
  const notes = plainText(todo.description);
  if (notes) parts.push(`    Notes: ${notes.slice(0, 200)}`);
  return parts.join("\n");
}
