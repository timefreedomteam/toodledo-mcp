# Basecamp tools

The cloud server also exposes Basecamp tools (`basecamp_*`), so Basecamp works in claude.ai on the web and on mobile through the same connector as Toodledo. They're enabled only when the server runs with `GOOGLE_CLOUD_PROJECT` set, because the Basecamp sign-in is stored in Secret Manager.

## One-time setup

1. Create the secrets and grant Cloud Run access:
   `GCP_PROJECT_ID=toodledo-mcp-rmb bash scripts/setup-basecamp.sh`
2. Register an app at https://launchpad.37signals.com/integrations. Set the Redirect URI to `<server URL>/basecamp/callback`.
3. Open `<server URL>/basecamp/connect`. Enter the connect password and the app's Client ID and Secret, then approve access in Basecamp.

The server stores the app credentials in `BASECAMP_CLIENT_ID` and `BASECAMP_CLIENT_SECRET`. It stores the sign-in (with the Basecamp account ID) in `BASECAMP_TOKENS`, and refreshes it automatically. To switch accounts or re-authorize, open `/basecamp/connect` again.

## Tools

| Tool | What it does |
| --- | --- |
| `basecamp_list_projects` | Projects and their enabled tools |
| `basecamp_list_people` | People in a project or the account |
| `basecamp_my_todos` | Open to-dos assigned to me or someone else |
| `basecamp_overdue_todos` | Overdue to-dos across all projects |
| `basecamp_list_todos` | A project's to-dos by list |
| `basecamp_add_todo` | Add a to-do (list, notes, due date, assignees) |
| `basecamp_update_todo` | Change title, notes, due date, assignees |
| `basecamp_complete_todo` | Complete or reopen a to-do |
| `basecamp_list_messages` / `basecamp_post_message` | Message board |
| `basecamp_read_chat` / `basecamp_post_chat` | Campfire chat |
| `basecamp_add_comment` | Comment on any item by ID |
| `basecamp_schedule` | Upcoming schedule entries |
| `basecamp_list_cards` / `basecamp_move_card` | Card tables |

Projects, lists, to-dos, people and columns can be named instead of using IDs.
