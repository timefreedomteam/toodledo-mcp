import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ToodledoClient } from "./api/client.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerFolderTools } from "./tools/folder-tools.js";
import { registerGtdTools } from "./tools/gtd-tools.js";
import {
  handleResourceMetadata,
  handleAuthServerMetadata,
  handleRegister,
  handleAuthorize,
  handleToken,
  validateBearerToken,
  sendUnauthorized,
} from "./auth/oauth-server.js";
import { createServer } from "node:http";

const TRANSPORT = process.env.TRANSPORT ?? "stdio";
const PORT = parseInt(process.env.PORT ?? "8080", 10);

// One client shared by all requests so the name-to-ID caches persist
const client = new ToodledoClient();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "toodledo",
    version: "0.1.0",
  });

  registerTaskTools(server, client);
  registerFolderTools(server, client);
  registerGtdTools(server, client);

  return server;
}

if (TRANSPORT === "stdio") {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else if (TRANSPORT === "http") {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // --- Public endpoints (no auth) ---

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      handleResourceMetadata(req, res);
      return;
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      handleAuthServerMetadata(req, res);
      return;
    }

    if (url.pathname === "/oauth/authorize") {
      await handleAuthorize(req, res, url);
      return;
    }

    if (url.pathname === "/oauth/token" && req.method === "POST") {
      await handleToken(req, res);
      return;
    }

    if (url.pathname === "/oauth/register" && req.method === "POST") {
      await handleRegister(req, res);
      return;
    }

    // --- Protected endpoints (require bearer token) ---

    const mcpPaths = new Set(["/mcp", "/mcp/", "/v1/mcp", "/v1/mcp/"]);
    if (!mcpPaths.has(url.pathname)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (!validateBearerToken(req)) {
      sendUnauthorized(req, res);
      return;
    }

    // Stateless mode: a fresh server and transport per request, so nothing is
    // lost when Cloud Run restarts or routes requests to another instance.
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createMcpServer();
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  });

  httpServer.listen(PORT, () => {
    console.log(`Toodledo MCP server listening on port ${PORT} (HTTP transport)`);
  });
} else {
  console.error(`Unknown TRANSPORT: ${TRANSPORT}. Use "stdio" or "http".`);
  process.exit(1);
}
