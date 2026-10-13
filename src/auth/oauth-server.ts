import { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";

// OAuth2 server for claude.ai. Single-user: anyone who knows CONNECT_PASSWORD
// may connect. Codes and tokens are HMAC-signed and stateless, so they survive
// Cloud Run restarts, scale-to-zero, and redeploys.

const CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "toodledo-mcp";
const CONNECT_PASSWORD = process.env.CONNECT_PASSWORD ?? "";

// Signing key derived from the Toodledo client secret, which is never exposed.
const SIGNING_KEY = crypto
  .createHash("sha256")
  .update(`toodledo-mcp-oauth|${process.env.TOODLEDO_CLIENT_SECRET ?? ""}`)
  .digest();

// The client secret is handed to anyone who registers, so it is not a security
// boundary; the password on the authorize page is.
const CLIENT_SECRET = hmac("client-secret");

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

// Best-effort single-use for auth codes (per instance)
const usedCodes = new Map<string, number>();

type TokenType = "code" | "access" | "refresh";

interface TokenPayload {
  typ: TokenType;
  exp: number;
  redirectUri?: string;
  codeChallenge?: string;
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", SIGNING_KEY).update(data).digest("base64url");
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, jti: crypto.randomUUID() })
  ).toString("base64url");
  return `${body}.${hmac(body)}`;
}

function verify(token: string | null, typ: TokenType): TokenPayload | null {
  // Without the client secret the signing key is guessable, so accept nothing
  if (!token || !process.env.TOODLEDO_CLIENT_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as TokenPayload;
    if (payload.typ !== typ || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getOrigin(req: IncomingMessage): string {
  return `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// --- Metadata endpoints ---

export function handleResourceMetadata(req: IncomingMessage, res: ServerResponse) {
  const origin = getOrigin(req);
  sendJson(res, 200, {
    resource: origin,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  });
}

export function handleAuthServerMetadata(req: IncomingMessage, res: ServerResponse) {
  const origin = getOrigin(req);
  sendJson(res, 200, {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  });
}

// --- Dynamic client registration (MCP spec requires it) ---

export async function handleRegister(req: IncomingMessage, res: ServerResponse) {
  await readBody(req);
  // Accept any registration and return our fixed client credentials.
  sendJson(res, 200, {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // never
  });
}

// --- Authorization endpoint ---

const AUTHORIZE_FIELDS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderPasswordPage(res: ServerResponse, params: URLSearchParams, error?: string) {
  const hidden = AUTHORIZE_FIELDS.map((name) => {
    const value = params.get(name);
    return value === null
      ? ""
      : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  }).join("");

  res.writeHead(error ? 401 : 200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Toodledo</title>
<style>body{font-family:system-ui,sans-serif;max-width:360px;margin:15vh auto;padding:0 16px}
input[type=password],button{width:100%;padding:10px;margin-top:8px;font-size:16px;box-sizing:border-box}
.err{color:#b00020}</style></head>
<body><h2>Connect Claude to Toodledo</h2>
<p>Enter the connect password you chose during setup.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/oauth/authorize">${hidden}
<input type="password" name="password" autofocus required>
<button type="submit">Connect</button></form></body></html>`);
}

function validateAuthorizeParams(res: ServerResponse, params: URLSearchParams): boolean {
  if (params.get("client_id") !== CLIENT_ID) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid client_id");
    return false;
  }
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !URL.canParse(redirectUri)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing or invalid redirect_uri");
    return false;
  }
  if (!CONNECT_PASSWORD) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("CONNECT_PASSWORD is not configured on the server.");
    return false;
  }
  return true;
}

export async function handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === "GET") {
    if (validateAuthorizeParams(res, url.searchParams)) {
      renderPasswordPage(res, url.searchParams);
    }
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const params = new URLSearchParams(await readBody(req));
  if (!validateAuthorizeParams(res, params)) return;

  if (!safeEqual(params.get("password") ?? "", CONNECT_PASSWORD)) {
    renderPasswordPage(res, params, "Wrong password. Try again.");
    return;
  }

  const redirectUri = params.get("redirect_uri")!;
  const code = sign({
    typ: "code",
    exp: Date.now() + CODE_TTL_MS,
    redirectUri,
    codeChallenge: params.get("code_challenge") ?? undefined,
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  const state = params.get("state");
  if (state) redirect.searchParams.set("state", state);

  res.writeHead(302, { Location: redirect.toString() });
  res.end();
}

// --- Token endpoint ---

function issueTokens(res: ServerResponse) {
  const now = Date.now();
  sendJson(res, 200, {
    access_token: sign({ typ: "access", exp: now + ACCESS_TTL_MS }),
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: sign({ typ: "refresh", exp: now + REFRESH_TTL_MS }),
  });
}

function getClientCredentials(req: IncomingMessage, params: URLSearchParams) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    const sep = decoded.indexOf(":");
    return {
      clientId: decodeURIComponent(decoded.slice(0, sep)),
      clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
    };
  }
  return { clientId: params.get("client_id"), clientSecret: params.get("client_secret") };
}

export async function handleToken(req: IncomingMessage, res: ServerResponse) {
  const params = new URLSearchParams(await readBody(req));
  const { clientId, clientSecret } = getClientCredentials(req, params);

  if (clientId !== CLIENT_ID || !safeEqual(clientSecret ?? "", CLIENT_SECRET)) {
    sendJson(res, 401, { error: "invalid_client" });
    return;
  }

  const grantType = params.get("grant_type");

  if (grantType === "refresh_token") {
    if (!verify(params.get("refresh_token"), "refresh")) {
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    issueTokens(res);
    return;
  }

  if (grantType !== "authorization_code") {
    sendJson(res, 400, { error: "unsupported_grant_type" });
    return;
  }

  const code = params.get("code");
  const stored = verify(code, "code");
  if (!stored || usedCodes.has(code!)) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  const redirectUri = params.get("redirect_uri");
  if (redirectUri && redirectUri !== stored.redirectUri) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  // PKCE verification
  if (stored.codeChallenge) {
    const codeVerifier = params.get("code_verifier");
    const hash = codeVerifier
      ? crypto.createHash("sha256").update(codeVerifier).digest("base64url")
      : "";
    if (hash !== stored.codeChallenge) {
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
  }

  const now = Date.now();
  for (const [used, exp] of usedCodes) if (exp < now) usedCodes.delete(used);
  usedCodes.set(code!, stored.exp);

  issueTokens(res);
}

// --- Token validation ---

export function validateBearerToken(req: IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  return verify(auth.slice(7), "access") !== null;
}

export function sendUnauthorized(req: IncomingMessage, res: ServerResponse): void {
  const origin = getOrigin(req);
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}
