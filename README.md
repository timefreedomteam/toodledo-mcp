# Toodledo MCP Server

An MCP server that connects AI assistants to [Toodledo](https://www.toodledo.com/) for GTD-based task management. Manage tasks, folders, contexts, and goals through natural conversation, with built-in tools for GTD workflows like next-action lists, weekly reviews, and dashboards.

## Features

- **17 MCP tools** for full task lifecycle management (create, search, edit, complete, delete)
- **GTD workflow tools** — next actions list, weekly review summary, task dashboard
- **Folder/context/goal management** — create and organize your GTD system
- **Name-based resolution** — refer to folders, contexts, and goals by name instead of IDs, with fuzzy matching suggestions on typos
- **Two transport modes** — STDIO for local use with Claude Desktop/Code, HTTP for cloud deployment
- **OAuth2 authentication** — guided setup flow with automatic token refresh

## Prerequisites

- **Node.js 24+**
- **A Toodledo account** — [toodledo.com](https://www.toodledo.com/) (free tier works)
- **A Toodledo API application** — register at [api.toodledo.com](https://api.toodledo.com/3/account/doc_register.php)

## Quick Start

### 1. Register a Toodledo App

Go to the [Toodledo app registration page](https://api.toodledo.com/3/account/doc_register.php) and create a new application. Set the **callback URL** to:

```
http://localhost:9876/callback
```

Note the **Client ID** and **Client Secret** from the registration.

### 2. Configure Credentials

**Option A: Environment variables** (recommended)

```bash
export TOODLEDO_CLIENT_ID=your_client_id
export TOODLEDO_CLIENT_SECRET=your_client_secret
```

**Option B: Config file**

Create `~/.toodledo-mcp/config.json`:

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

### 3. Install and Authenticate

```bash
npm install
npm run build
npm run setup
```

The `setup` command opens a browser window for Toodledo OAuth2 authorization. After you approve access, tokens are saved to `~/.toodledo-mcp/tokens.json` and automatically refreshed.

### 4. Configure Your MCP Client

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "toodledo": {
      "command": "node",
      "args": ["/absolute/path/to/toodledo-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Code

Add a `.mcp.json` file to your project root:

```json
{
  "mcpServers": {
    "toodledo": {
      "command": "node",
      "args": ["/absolute/path/to/toodledo-mcp/dist/index.js"]
    }
  }
}
```

#### Remote (claude.ai)

For cloud deployment via HTTP transport, see [Cloud Deployment](docs/cloud-deployment.md).

## Tools

### Task Management

| Tool | Description |
|------|-------------|
| `toodledo_search_tasks` | Search and filter tasks by folder, context, status, priority, or text |
| `toodledo_get_task` | Get a single task by ID with full details |
| `toodledo_add_task` | Create a new task with folder/context by name |
| `toodledo_edit_task` | Update an existing task's fields |
| `toodledo_complete_task` | Mark a task as completed |
| `toodledo_delete_task` | Permanently delete a task |

### Organization

| Tool | Description |
|------|-------------|
| `toodledo_list_folders` | List all folders (GTD projects) |
| `toodledo_add_folder` | Create a new folder |
| `toodledo_delete_folder` | Delete a folder |
| `toodledo_list_contexts` | List all contexts (@home, @work, etc.) |
| `toodledo_add_context` | Create a new context |
| `toodledo_delete_context` | Delete a context |
| `toodledo_list_goals` | List all goals by level |
| `toodledo_add_goal` | Create a new goal |

### GTD Workflows

| Tool | Description |
|------|-------------|
| `toodledo_gtd_next_actions` | Get all Next Action tasks, optionally filtered by context |
| `toodledo_gtd_review` | Weekly review: inbox, stalled projects, overdue, waiting-for, someday/maybe |
| `toodledo_gtd_dashboard` | Dashboard with counts by folder, context, status, priority, and due dates |
| `toodledo_reschedule_overdue` | Move all overdue tasks to today (or a given date) in one call |

See [Tool Reference](docs/tool-reference.md) for complete parameter documentation.

## GTD Methodology

The server maps Toodledo concepts to the Getting Things Done methodology:

| Toodledo | GTD Concept | Examples |
|----------|-------------|---------|
| Folders | Projects | "Website Redesign", "Q3 Planning" |
| Contexts | @-contexts for batching | "@home", "@office", "@phone", "@errands" |
| Status | Action states | Next Action, Waiting, Someday, Active |
| `.inbox` context | Inbox | Quick captures and brain dumps |
| Goals | Horizons of focus | Lifetime, long-term, short-term |

See [GTD Workflow Guide](docs/gtd-workflow.md) for detailed usage patterns and recommended workflows.

## Cloud Deployment

The server supports HTTP transport for cloud deployment on Google Cloud Run, with an integrated OAuth2 server for remote MCP clients like claude.ai. See [Cloud Deployment](docs/cloud-deployment.md) for the full setup guide.

## Development

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Run with tsx (development, STDIO transport)
npm run setup    # One-time OAuth2 setup flow
```

### Architecture

```
src/
├── index.ts           # Entry point — STDIO and HTTP transport selection
├── config.ts          # Credential loading (env vars or config file)
├── types.ts           # TypeScript types, status/priority enums
├── format.ts          # Output formatting for task lists and details
├── auth/
│   ├── setup.ts       # Interactive OAuth2 setup CLI
│   ├── oauth.ts       # Toodledo OAuth2 authorization code flow
│   ├── oauth-server.ts # OAuth2 server for cloud MCP clients
│   ├── token-store.ts # Token storage (local file or Secret Manager)
│   └── secret-manager-store.ts  # Google Secret Manager integration
├── api/
│   ├── client.ts      # Toodledo API client with name-to-ID caching
│   ├── tasks.ts       # Task CRUD operations
│   ├── folders.ts     # Folder operations
│   ├── contexts.ts    # Context operations
│   └── goals.ts       # Goal operations
└── tools/
    ├── task-tools.ts   # 6 task management MCP tools
    ├── folder-tools.ts # 8 folder/context/goal MCP tools
    └── gtd-tools.ts    # 3 GTD workflow MCP tools
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TOODLEDO_CLIENT_ID` | Toodledo OAuth2 client ID | — |
| `TOODLEDO_CLIENT_SECRET` | Toodledo OAuth2 client secret | — |
| `TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `PORT` | HTTP server port (when `TRANSPORT=http`) | `8080` |
| `TOODLEDO_TOKENS` | Token JSON (enables Secret Manager cloud mode) | — |
| `CONNECT_PASSWORD` | Password entered once when connecting claude.ai (HTTP transport) | — |
| `OAUTH_CLIENT_ID` | OAuth2 server client ID | `toodledo-mcp` |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Secret Manager API | — |
