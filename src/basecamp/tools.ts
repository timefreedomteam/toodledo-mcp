import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  dockTool,
  dockTools,
  findProject,
  findTodo,
  findTodoList,
  formatTodo,
  get,
  getAll,
  listPeople,
  listProjects,
  listTodoLists,
  listTodos,
  myId,
  plainText,
  resolvePeople,
  send,
  type Person,
  type Todo,
} from "./client.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` }],
      isError: true,
    };
  }
}

const projectParam = z.string().describe("Project name (or part of it) or ID");
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Recording {
  id: number;
  title?: string;
  subject?: string;
  content?: string;
  created_at: string;
  creator?: Person;
  app_url: string;
}

interface ScheduleEntry {
  id: number;
  summary: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  participants?: Person[];
}

interface CardColumn { id: number; title: string; cards_url: string; cards_count?: number }
interface CardTable { id: number; title: string; lists: CardColumn[] }
interface Card { id: number; title: string; due_on: string | null; assignees?: Person[]; parent?: { title: string } }

/** Pull every to-do out of a report response, whatever its grouping. */
function collectTodos(data: unknown): Todo[] {
  if (Array.isArray(data)) return data.flatMap((item) => ("content" in (item as object) ? [item as Todo] : collectTodos(item)));
  if (data && typeof data === "object") return Object.values(data).flatMap(collectTodos);
  return [];
}

function todoList(todos: Todo[], empty: string): string {
  return todos.length ? todos.map(formatTodo).join("\n\n") : empty;
}

export function registerBasecampTools(server: McpServer) {
  // --- Projects & people ---

  server.tool(
    "basecamp_list_projects",
    "List active Basecamp projects with the tools each one has (to-dos, message board, chat, schedule, card table).",
    {},
    () =>
      run(async () => {
        const projects = await listProjects();
        if (!projects.length) return "No active projects.";
        return projects
          .map((p) => {
            const tools = p.dock.filter((d) => d.enabled).map((d) => d.title).join(", ");
            return `${p.name} (ID: ${p.id})\n    Tools: ${tools}`;
          })
          .join("\n");
      })
  );

  server.tool(
    "basecamp_list_people",
    "List people in a Basecamp project, or everyone in the account if no project is given.",
    { project: projectParam.optional() },
    (params) =>
      run(async () => {
        const project = params.project ? await findProject(params.project) : undefined;
        const people = await listPeople(project);
        return people.map((p) => `${p.name}${p.email_address ? ` <${p.email_address}>` : ""} (ID: ${p.id})`).join("\n");
      })
  );

  // --- To-dos ---

  server.tool(
    "basecamp_my_todos",
    "List open Basecamp to-dos assigned to me (or another person) across all projects.",
    { person: z.string().optional().describe("Person's name; defaults to me") },
    (params) =>
      run(async () => {
        const personId = params.person ? (await resolvePeople([params.person]))[0] : await myId();
        const todos = collectTodos(await get<unknown>(`/reports/todos/assigned/${personId}.json`)).filter((t) => !t.completed);
        todos.sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"));
        return todoList(todos, "No open to-dos assigned.");
      })
  );

  server.tool(
    "basecamp_overdue_todos",
    "List every overdue Basecamp to-do across all projects.",
    {},
    () =>
      run(async () => {
        const todos = collectTodos(await get<unknown>("/reports/todos/overdue.json"));
        todos.sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));
        return todoList(todos, "Nothing is overdue.");
      })
  );

  server.tool(
    "basecamp_list_todos",
    "List to-dos in a Basecamp project, grouped by to-do list.",
    {
      project: projectParam,
      list: z.string().optional().describe("Only this to-do list (name or ID)"),
      completed: z.boolean().optional().describe("Show completed to-dos instead of open ones"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const lists = params.list ? [await findTodoList(project, params.list)] : await listTodoLists(project);
        const sections: string[] = [];
        for (const list of lists) {
          const todos = await listTodos(list, params.completed);
          sections.push(`## ${list.title} (list ID: ${list.id})\n${todoList(todos, "(none)")}`);
        }
        return sections.length ? sections.join("\n\n") : `${project.name} has no to-do lists.`;
      })
  );

  server.tool(
    "basecamp_add_todo",
    "Add a to-do to a Basecamp project's to-do list.",
    {
      project: projectParam,
      content: z.string().describe("The to-do's title"),
      list: z.string().optional().describe("To-do list name or ID (defaults to the project's first list)"),
      description: z.string().optional().describe("Notes (plain text or simple HTML)"),
      due_on: dateParam.optional().describe("Due date, YYYY-MM-DD"),
      assignees: z.array(z.string()).optional().describe("People's names; use \"me\" for myself"),
      notify: z.boolean().optional().describe("Notify assignees (default false)"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const list = await findTodoList(project, params.list);
        const assignee_ids = params.assignees ? await resolvePeople(params.assignees, project) : undefined;
        const todo = await send<Todo>("POST", `/buckets/${project.id}/todolists/${list.id}/todos.json`, {
          content: params.content,
          description: params.description,
          due_on: params.due_on,
          assignee_ids,
          notify: params.notify ?? false,
        });
        return `Added to ${project.name} / ${list.title}:\n${formatTodo(todo!)}`;
      })
  );

  server.tool(
    "basecamp_update_todo",
    "Change a Basecamp to-do's title, notes, due date or assignees. Fields not given stay as they are.",
    {
      project: projectParam,
      todo: z.string().describe("To-do ID or (part of) its title"),
      content: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New notes"),
      due_on: dateParam.nullable().optional().describe("New due date YYYY-MM-DD, or null to clear it"),
      assignees: z.array(z.string()).optional().describe("Replace assignees with these names (\"me\" for myself)"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const todo = await findTodo(project, params.todo);
        // Basecamp clears any field left out of a PUT, so send the full record.
        const updated = await send<Todo>("PUT", `/buckets/${project.id}/todos/${todo.id}.json`, {
          content: params.content ?? todo.content,
          description: params.description ?? todo.description ?? "",
          due_on: params.due_on === undefined ? todo.due_on : params.due_on,
          starts_on: todo.starts_on ?? null,
          assignee_ids: params.assignees
            ? await resolvePeople(params.assignees, project)
            : todo.assignees.map((p) => p.id),
          completion_subscriber_ids: (todo.completion_subscribers ?? []).map((p) => p.id),
          notify: false,
        });
        return `Updated:\n${formatTodo(updated!)}`;
      })
  );

  server.tool(
    "basecamp_complete_todo",
    "Mark a Basecamp to-do done, or reopen it.",
    {
      project: projectParam,
      todo: z.string().describe("To-do ID or (part of) its title"),
      reopen: z.boolean().optional().describe("Reopen a completed to-do instead"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const todo = await findTodo(project, params.todo);
        await send(params.reopen ? "DELETE" : "POST", `/buckets/${project.id}/todos/${todo.id}/completion.json`);
        return `${params.reopen ? "Reopened" : "Completed"}: ${todo.content}`;
      })
  );

  // --- Messages, chat, comments ---

  server.tool(
    "basecamp_list_messages",
    "List recent posts on a Basecamp project's message board.",
    { project: projectParam, limit: z.number().int().min(1).max(50).optional().describe("How many (default 10)") },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const board = dockTool(project, "message_board", "message board");
        const messages = await getAll<Recording>(`/buckets/${project.id}/message_boards/${board.id}/messages.json`, params.limit ?? 10);
        if (!messages.length) return "No messages.";
        return messages
          .slice(0, params.limit ?? 10)
          .map((m) => `${m.subject} (ID: ${m.id})\n    ${m.creator?.name ?? ""}, ${m.created_at.slice(0, 10)}\n    ${plainText(m.content).slice(0, 300)}`)
          .join("\n\n");
      })
  );

  server.tool(
    "basecamp_post_message",
    "Post a new message on a Basecamp project's message board. Everyone subscribed is notified.",
    {
      project: projectParam,
      subject: z.string(),
      content: z.string().describe("Body (plain text or simple HTML)"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const board = dockTool(project, "message_board", "message board");
        const msg = await send<Recording>("POST", `/buckets/${project.id}/message_boards/${board.id}/messages.json`, {
          subject: params.subject,
          content: params.content,
          status: "active",
        });
        return `Posted "${params.subject}" in ${project.name}: ${msg!.app_url}`;
      })
  );

  server.tool(
    "basecamp_read_chat",
    "Read recent lines from a Basecamp project's Campfire chat.",
    { project: projectParam, limit: z.number().int().min(1).max(100).optional().describe("How many lines (default 20)") },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const chat = dockTool(project, "chat", "Campfire chat");
        const lines = await get<Recording[]>(`/buckets/${project.id}/chats/${chat.id}/lines.json`);
        if (!lines.length) return "No chat lines.";
        return lines
          .slice(0, params.limit ?? 20)
          .reverse()
          .map((l) => `[${l.created_at.slice(0, 16).replace("T", " ")}] ${l.creator?.name ?? "?"}: ${plainText(l.content)}`)
          .join("\n");
      })
  );

  server.tool(
    "basecamp_post_chat",
    "Post a line in a Basecamp project's Campfire chat.",
    { project: projectParam, content: z.string() },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const chat = dockTool(project, "chat", "Campfire chat");
        await send("POST", `/buckets/${project.id}/chats/${chat.id}/lines.json`, { content: params.content });
        return `Posted in ${project.name} Campfire.`;
      })
  );

  server.tool(
    "basecamp_add_comment",
    "Comment on a Basecamp to-do, message, card or other item by its ID.",
    { project: projectParam, item_id: z.number().int().describe("ID of the to-do, message, card, etc."), content: z.string() },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        await send("POST", `/buckets/${project.id}/recordings/${params.item_id}/comments.json`, { content: params.content });
        return "Comment added.";
      })
  );

  // --- Schedule ---

  server.tool(
    "basecamp_schedule",
    "List upcoming entries on a Basecamp project's schedule.",
    { project: projectParam },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const schedule = dockTool(project, "schedule", "schedule");
        const entries = await getAll<ScheduleEntry>(`/buckets/${project.id}/schedules/${schedule.id}/entries.json`);
        const now = new Date().toISOString();
        const upcoming = entries.filter((e) => e.ends_at >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        if (!upcoming.length) return "Nothing upcoming on the schedule.";
        return upcoming
          .map((e) => {
            const when = e.all_day ? e.starts_at.slice(0, 10) : `${e.starts_at.slice(0, 16).replace("T", " ")} to ${e.ends_at.slice(11, 16)}`;
            const who = e.participants?.length ? ` | With: ${e.participants.map((p) => p.name).join(", ")}` : "";
            return `${e.summary} (ID: ${e.id})\n    ${when}${who}`;
          })
          .join("\n");
      })
  );

  // --- Card tables ---

  server.tool(
    "basecamp_list_cards",
    "List the columns and cards on a Basecamp project's card table(s).",
    { project: projectParam },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const tables = dockTools(project, "kanban_board");
        if (!tables.length) return `${project.name} has no card table.`;
        const out: string[] = [];
        for (const t of tables) {
          const table = await get<CardTable>(`/buckets/${project.id}/card_tables/${t.id}.json`);
          out.push(`# ${table.title}`);
          for (const column of table.lists) {
            const cards = await getAll<Card>(column.cards_url);
            out.push(`## ${column.title} (column ID: ${column.id})`);
            out.push(
              cards.length
                ? cards
                    .map((c) => {
                      const meta = [c.due_on && `Due: ${c.due_on}`, c.assignees?.length && `Assigned: ${c.assignees.map((p) => p.name).join(", ")}`]
                        .filter(Boolean)
                        .join(" | ");
                      return `- ${c.title} (ID: ${c.id})${meta ? ` | ${meta}` : ""}`;
                    })
                    .join("\n")
                : "(empty)"
            );
          }
        }
        return out.join("\n");
      })
  );

  server.tool(
    "basecamp_move_card",
    "Move a card to another column on a Basecamp card table.",
    {
      project: projectParam,
      card_id: z.number().int().describe("The card's ID (from basecamp_list_cards)"),
      column: z.string().describe("Destination column name or ID"),
    },
    (params) =>
      run(async () => {
        const project = await findProject(params.project);
        const want = params.column.trim().toLowerCase();
        for (const t of dockTools(project, "kanban_board")) {
          const table = await get<CardTable>(`/buckets/${project.id}/card_tables/${t.id}.json`);
          const column =
            table.lists.find((c) => String(c.id) === want || c.title.toLowerCase() === want) ??
            table.lists.find((c) => c.title.toLowerCase().includes(want));
          if (column) {
            await send("POST", `/buckets/${project.id}/card_tables/cards/${params.card_id}/moves.json`, { column_id: column.id });
            return `Moved card ${params.card_id} to "${column.title}".`;
          }
        }
        throw new Error(`No column matches "${params.column}" in ${project.name}`);
      })
  );
}
