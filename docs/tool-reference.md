# Tool Reference

Complete parameter documentation for all 17 MCP tools exposed by the Toodledo MCP server.

## Task Management

### `toodledo_search_tasks`

Search for tasks. Returns incomplete tasks by default. Filter by folder, context, status, priority, or search text.

Results are sorted by priority (descending), then by due date (ascending).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | No | Folder name to filter by |
| `context` | string | No | Context name to filter by (e.g. "@home", "@work") |
| `status` | enum | No | Status filter |
| `priority` | enum | No | Priority filter |
| `starred` | boolean | No | Only show starred tasks |
| `include_completed` | boolean | No | Include completed tasks (default: false) |
| `search_text` | string | No | Filter tasks by title substring (case-insensitive) |

**Status values:** `none`, `next_action`, `active`, `planning`, `delegated`, `waiting`, `hold`, `postponed`, `someday`, `canceled`, `reference`

**Priority values:** `negative`, `low`, `medium`, `high`, `top`

---

### `toodledo_get_task`

Get a single task by ID with full details including notes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Task ID |

---

### `toodledo_add_task`

Create a new task. Specify folder, context, and goal by name — they are resolved to IDs automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Task title |
| `folder` | string | No | Folder name (GTD project) |
| `context` | string | No | Context name (e.g. "@home", "@work") |
| `goal` | string | No | Goal name |
| `priority` | enum | No | Priority level: `negative`, `low`, `medium`, `high`, `top` |
| `status` | enum | No | Task status (see status values above) |
| `star` | boolean | No | Star this task |
| `duedate` | string | No | Due date as `YYYY-MM-DD` |
| `startdate` | string | No | Start date as `YYYY-MM-DD` |
| `tag` | string | No | Comma-separated tags |
| `note` | string | No | Task note/description |
| `duration` | number | No | Duration in minutes |
| `parent` | number | No | Parent task ID for subtasks |

If a folder, context, or goal name is not found, the server returns an error listing the available names.

---

### `toodledo_edit_task`

Update an existing task. Only specify the fields you want to change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Task ID to edit |
| `title` | string | No | New title |
| `folder` | string | No | Folder name |
| `context` | string | No | Context name |
| `goal` | string | No | Goal name |
| `priority` | enum | No | Priority level |
| `status` | enum | No | Task status |
| `star` | boolean | No | Star/unstar |
| `duedate` | string | No | Due date as `YYYY-MM-DD`, or empty string to clear |
| `startdate` | string | No | Start date as `YYYY-MM-DD`, or empty string to clear |
| `tag` | string | No | Comma-separated tags |
| `note` | string | No | Task note/description |
| `duration` | number | No | Duration in minutes |
| `parent` | number | No | Parent task ID |

Dates can be set to an empty string (`""`) to clear them.

---

### `toodledo_complete_task`

Mark a task as completed. Sets the completion timestamp automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Task ID to complete |

---

### `toodledo_delete_task`

Permanently delete a task. This cannot be undone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Task ID to delete |

---

## Organization

### `toodledo_list_folders`

List all folders (GTD projects). Shows active folders by default.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include_archived` | boolean | No | Include archived folders (default: false) |

---

### `toodledo_add_folder`

Create a new folder (GTD project).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Folder name (max 64 characters) |
| `private` | boolean | No | Make folder private |

---

### `toodledo_delete_folder`

Delete a folder. Tasks in this folder will become unassigned.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Folder ID to delete |

---

### `toodledo_list_contexts`

List all contexts (GTD contexts like @home, @work, @phone, @errands).

No parameters.

---

### `toodledo_add_context`

Create a new context (e.g. @home, @work, @phone).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Context name (max 64 characters) |

---

### `toodledo_delete_context`

Delete a context. Tasks with this context will become unassigned.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Context ID to delete |

---

### `toodledo_list_goals`

List all goals organized by level (lifetime, long-term, short-term).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include_archived` | boolean | No | Include archived goals |

---

### `toodledo_add_goal`

Create a new goal.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Goal name |
| `level` | enum | No | Goal level: `lifetime`, `long-term`, `short-term` (default: `short-term`) |
| `contributes_to` | number | No | Parent goal ID this contributes to |

---

## GTD Workflows

### `toodledo_gtd_next_actions`

Get all Next Action tasks — your GTD "what should I do now?" list. Optionally filter by context.

Results are sorted by priority (descending), then by due date (ascending).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `context` | string | No | Filter by context name (e.g. "@home") |

---

### `toodledo_gtd_review`

GTD weekly review summary. Shows five sections:

1. **Inbox** — tasks with no folder AND no context (unprocessed items)
2. **Overdue** — tasks whose due date is before today
3. **Stalled Projects** — folders that have tasks but none with "Next Action" status
4. **Waiting For** — tasks with "Waiting" status
5. **Someday/Maybe** — tasks with "Someday" status

No parameters.

---

### `toodledo_gtd_dashboard`

High-level dashboard with task counts by folder, context, status, and priority. Includes overdue count, today's due tasks, and starred task count.

Shows the top 15 folders and contexts by task count. If there are tasks due today, they are listed individually at the bottom.

No parameters.

---

### `toodledo_reschedule_overdue`

Moves every incomplete task whose due date is before today to today, in one call. Tasks with a due time keep their time of day. A task counts as overdue only after its due day has ended.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | No | New due date as YYYY-MM-DD. Defaults to today in the server's time zone; pass your local date when the server runs in UTC (e.g. Cloud Run). |
| `dry_run` | boolean | No | List the overdue tasks without changing them |

Example: *"Push all my overdue tasks to today."*
