import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, loadConfig } from "../config.js";
import { refreshAccessToken } from "./oauth.js";
import type { TokenData, ToodledoTokenResponse } from "../types.js";

const TOKEN_FILE = join(getConfigDir(), "tokens.json");
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// Cloud Run injects TOODLEDO_TOKENS from Secret Manager as an env var
const useCloudTokens = !!process.env.TOODLEDO_TOKENS;

// In-memory cache for cloud mode (loaded from Secret Manager on first call)
let cachedTokens: TokenData | null = null;

// Lazy-load the secret manager module only when needed
async function getSecretManagerStore() {
  return await import("./secret-manager-store.js");
}

export function saveTokens(response: ToodledoTokenResponse): void {
  const data: TokenData = {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: Date.now() + response.expires_in * 1000,
    scope: response.scope,
  };

  if (useCloudTokens) {
    // In cloud mode, update in-memory cache and persist async
    cachedTokens = data;
    getSecretManagerStore()
      .then((sm) => sm.saveTokensToSecret(data))
      .catch((err) => console.error("Failed to save tokens to Secret Manager:", err));
  } else {
    const dir = getConfigDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  }
}

async function loadTokens(): Promise<TokenData> {
  if (useCloudTokens) {
    if (cachedTokens) return cachedTokens;
    cachedTokens = JSON.parse(process.env.TOODLEDO_TOKENS!) as TokenData;
    return cachedTokens;
  }

  if (!existsSync(TOKEN_FILE)) {
    throw new Error(
      `No tokens found at ${TOKEN_FILE}. Run 'npm run setup' to authenticate with Toodledo.`
    );
  }
  return JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as TokenData;
}

let refreshing: Promise<string> | null = null;

/** Pass force=true to swap a still-valid token for a new one (Toodledo rate-limits per token). */
export async function getAccessToken(force = false): Promise<string> {
  const tokens = await loadTokens();

  // If token is still valid (with buffer), return it
  if (!force && Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
    return tokens.access_token;
  }

  // Token expired, about to expire, or rate-limited - refresh it.
  // Concurrent callers share one refresh so the refresh token is only spent once.
  if (!refreshing) {
    const config = loadConfig();
    refreshing = refreshAccessToken(tokens.refresh_token, config.clientId, config.clientSecret)
      .then((refreshed) => {
        saveTokens(refreshed);
        return refreshed.access_token;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}
