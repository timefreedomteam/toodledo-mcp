# Cloud Deployment

This guide covers deploying the Toodledo MCP server to Google Cloud Run with HTTP transport, enabling remote MCP clients like claude.ai to connect.

## How Cloud Mode Differs

| Aspect | Local (STDIO) | Cloud (HTTP) |
|--------|---------------|--------------|
| Transport | stdin/stdout | HTTP on port 8080 |
| Token storage | `~/.toodledo-mcp/tokens.json` | Google Secret Manager |
| Client auth | None (local process) | OAuth2 server with a connect password and signed bearer tokens |
| Token refresh | Writes to local file | Writes back to Secret Manager |
| Session lifecycle | Single persistent connection | Stateless (fresh MCP server per request) |

## Prerequisites

- A **Google Cloud project** with billing enabled
- The **`gcloud` CLI** installed and authenticated
- A **GitHub repository** for the code
- A **working local setup** — you should have already run `npm run setup` and have tokens at `~/.toodledo-mcp/tokens.json`

## Infrastructure Setup

Two scripts automate the GCP infrastructure setup. Run them in order.

### Step 1: GitHub Actions Deploy Setup

```bash
GCP_PROJECT_ID=<your-project-id> bash scripts/setup-github-deploy.sh <github-org/repo>
```

This script:
- Enables required GCP APIs (Cloud Run, Artifact Registry, Secret Manager, IAM)
- Creates an Artifact Registry Docker repository
- Creates a `github-deploy` service account with roles:
  - `roles/run.admin` — deploy to Cloud Run
  - `roles/artifactregistry.writer` — push container images
  - `roles/iam.serviceAccountUser` — act as the runtime service account
  - `roles/secretmanager.secretAccessor` — read secrets during deploy
- Creates a Workload Identity Federation pool and provider for GitHub OIDC
- Binds the GitHub repo to the service account for passwordless auth

The deploy workflow needs these GitHub repository settings. If the GitHub CLI (`gh`) is installed and signed in, the script sets them for you; otherwise it prints them and you add them at **Settings > Secrets and variables > Actions**:

| Name | Kind | Description |
|------|------|-------------|
| `WIF_PROVIDER` | Secret | Workload Identity Federation provider path |
| `WIF_SERVICE_ACCOUNT` | Secret | Deploy service account email |
| `GCP_PROJECT_ID` | Variable | Your Google Cloud project ID |

### Step 2: Secret Manager Setup

```bash
GCP_PROJECT_ID=<your-project-id> bash scripts/setup-secrets.sh
```

This script:
- Creates four secrets in Google Secret Manager:
  - `TOODLEDO_CLIENT_ID`
  - `TOODLEDO_CLIENT_SECRET`
  - `TOODLEDO_TOKENS` (uploaded from your local `~/.toodledo-mcp/tokens.json`)
  - `CONNECT_PASSWORD` (a password you choose, entered once when connecting claude.ai)
- Grants the Cloud Run runtime service account access to all secrets
- Grants `secretVersionAdder` on `TOODLEDO_TOKENS` so the server can write refreshed tokens back


## Deployment

Pushing to the `master` branch (or running the workflow manually from the Actions tab) triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`), which:

1. Authenticates to GCP via Workload Identity Federation
2. Builds the Docker image (multi-stage: Node 24 Alpine build + runtime)
3. Pushes to Artifact Registry tagged with the commit SHA
4. Deploys to Cloud Run with:
   - 256 MiB memory
   - 120 second timeout
   - Port 8080
   - At most one instance, so Toodledo token refreshes never race
   - `GOOGLE_CLOUD_PROJECT` set, so refreshed Toodledo tokens are written back to Secret Manager
   - All four secrets mounted as environment variables
   - Unauthenticated access allowed (the server handles auth itself via bearer tokens)

## OAuth2 Server

The cloud deployment includes an OAuth2 server that implements the MCP specification's authentication requirements. This allows MCP clients like claude.ai to authenticate automatically.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/oauth-protected-resource` | GET | OAuth resource metadata |
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata |
| `/oauth/register` | POST | Dynamic client registration |
| `/oauth/authorize` | GET | Authorization endpoint |
| `/oauth/token` | POST | Token exchange endpoint |

### Behavior

- **Connect password** — the authorize page asks for `CONNECT_PASSWORD` before issuing a code. This is a personal-use server, not a multi-tenant application.
- **PKCE support** — S256 code challenge verification for secure browser-based auth flows.
- **Stateless tokens** — auth codes, access tokens (24 hours) and refresh tokens (180 days) are HMAC-signed with a key derived from `TOODLEDO_CLIENT_SECRET`, so they survive restarts, scale-to-zero and redeploys. Changing that secret signs everyone out.
- **Dynamic client registration** — MCP spec requires it. The server accepts any registration and returns fixed credentials; the password, not the client secret, is what protects the server.

## MCP Endpoints

| Path | Description |
|------|-------------|
| `/mcp` | MCP protocol endpoint |
| `/mcp/` | MCP protocol endpoint (trailing slash) |
| `/v1/mcp` | MCP protocol endpoint (versioned alias) |
| `/v1/mcp/` | MCP protocol endpoint (versioned alias, trailing slash) |
| `/health` | Health check — returns `{"status": "ok"}` |

All MCP endpoints require a valid bearer token in the `Authorization` header.

## Configuring claude.ai

Once deployed, add your Cloud Run URL as a remote MCP server in claude.ai:

1. Go to claude.ai **Settings > Connectors > Add custom connector**
2. Enter your Cloud Run service URL with `/mcp` (e.g. `https://toodledo-mcp-HASH-uc.a.run.app/mcp`) and leave the OAuth fields empty
3. Click **Connect** and enter your connect password on the page that opens

claude.ai handles the rest of the OAuth2 flow using the server's discovery endpoints.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRANSPORT` | Transport mode | `http` (set in Dockerfile) |
| `PORT` | HTTP server port | `8080` |
| `TOODLEDO_CLIENT_ID` | Toodledo OAuth2 client ID | — |
| `TOODLEDO_CLIENT_SECRET` | Toodledo OAuth2 client secret | — |
| `TOODLEDO_TOKENS` | Token JSON blob (enables Secret Manager mode) | — |
| `CONNECT_PASSWORD` | Password required on the authorize page | — |
| `OAUTH_CLIENT_ID` | OAuth2 server client ID | `toodledo-mcp` |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Secret Manager API calls | — |
