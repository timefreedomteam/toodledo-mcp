import { readSecret, writeSecret } from "./secrets.js";

// Basecamp sign-in through 37signals Launchpad (OAuth2).
// Docs: https://github.com/basecamp/api/blob/master/sections/authentication.md

const LAUNCHPAD = "https://launchpad.37signals.com";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const SECRET_CLIENT_ID = "BASECAMP_CLIENT_ID";
export const SECRET_CLIENT_SECRET = "BASECAMP_CLIENT_SECRET";
export const SECRET_TOKENS = "BASECAMP_TOKENS";

export interface BasecampApp {
  clientId: string;
  clientSecret: string;
}

export interface BasecampTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: number;
  account_name: string;
  redirect_uri: string;
}

interface LaunchpadTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

let cachedApp: BasecampApp | null = null;
let cachedTokens: BasecampTokens | null = null;

export async function loadApp(): Promise<BasecampApp | null> {
  if (cachedApp) return cachedApp;
  const [clientId, clientSecret] = await Promise.all([
    readSecret(SECRET_CLIENT_ID),
    readSecret(SECRET_CLIENT_SECRET),
  ]);
  if (!clientId || !clientSecret) return null;
  cachedApp = { clientId, clientSecret };
  return cachedApp;
}

export async function saveApp(app: BasecampApp): Promise<void> {
  const current = await loadApp();
  if (current?.clientId !== app.clientId) await writeSecret(SECRET_CLIENT_ID, app.clientId);
  if (current?.clientSecret !== app.clientSecret) await writeSecret(SECRET_CLIENT_SECRET, app.clientSecret);
  cachedApp = app;
}

export function callbackUrl(origin: string): string {
  return `${origin}/basecamp/callback`;
}

export function authorizationUrl(app: BasecampApp, origin: string, state: string): string {
  const params = new URLSearchParams({
    type: "web_server",
    client_id: app.clientId,
    redirect_uri: callbackUrl(origin),
    state,
  });
  return `${LAUNCHPAD}/authorization/new?${params}`;
}

async function requestToken(params: Record<string, string>): Promise<LaunchpadTokenResponse> {
  const res = await fetch(`${LAUNCHPAD}/authorization/token?${new URLSearchParams(params)}`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Basecamp sign-in failed (${res.status}): ${text}`);
  return JSON.parse(text) as LaunchpadTokenResponse;
}

/** Finish sign-in: trade the code for tokens and pick the Basecamp account. */
export async function exchangeCode(app: BasecampApp, origin: string, code: string): Promise<BasecampTokens> {
  const token = await requestToken({
    type: "web_server",
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: callbackUrl(origin),
    code,
  });
  if (!token.refresh_token) throw new Error("Basecamp did not return a refresh token");

  const res = await fetch(`${LAUNCHPAD}/authorization.json`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) throw new Error(`Couldn't read Basecamp accounts (${res.status})`);
  const info = (await res.json()) as { accounts: { product: string; id: number; name: string }[] };
  const account = info.accounts.find((a) => a.product === "bc3");
  if (!account) throw new Error("No Basecamp account found for this login");

  const tokens: BasecampTokens = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
    account_id: account.id,
    account_name: account.name,
    redirect_uri: callbackUrl(origin),
  };
  await writeSecret(SECRET_TOKENS, JSON.stringify(tokens));
  cachedTokens = tokens;
  return tokens;
}

const NOT_CONNECTED =
  "Basecamp isn't connected yet. Open <server URL>/basecamp/connect in a browser to set it up.";

/** A valid access token and account ID, refreshing the token when needed. */
export async function getSession(): Promise<{ accessToken: string; accountId: number }> {
  if (!cachedTokens) {
    const raw = await readSecret(SECRET_TOKENS);
    if (!raw) throw new Error(NOT_CONNECTED);
    cachedTokens = JSON.parse(raw) as BasecampTokens;
  }
  const tokens = cachedTokens;

  if (Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
    return { accessToken: tokens.access_token, accountId: tokens.account_id };
  }

  const app = await loadApp();
  if (!app) throw new Error(NOT_CONNECTED);
  const refreshed = await requestToken({
    type: "refresh",
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: tokens.redirect_uri,
    refresh_token: tokens.refresh_token,
  });
  cachedTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  writeSecret(SECRET_TOKENS, JSON.stringify(cachedTokens)).catch((err) =>
    console.error("Failed to save Basecamp tokens:", err)
  );
  return { accessToken: cachedTokens.access_token, accountId: cachedTokens.account_id };
}
