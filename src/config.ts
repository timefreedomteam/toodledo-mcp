import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  clientId: string;
  clientSecret: string;
}

const CONFIG_DIR = join(homedir(), ".toodledo-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function loadConfig(): Config {
  // Try environment variables first
  // Trim: secrets created with `echo ... | gcloud secrets create` carry a trailing newline
  const clientId = process.env.TOODLEDO_CLIENT_ID?.trim();
  const clientSecret = process.env.TOODLEDO_CLIENT_SECRET?.trim();

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Fall back to config file
  if (existsSync(CONFIG_FILE)) {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    if (data.client_id && data.client_secret) {
      return { clientId: data.client_id.trim(), clientSecret: data.client_secret.trim() };
    }
  }

  throw new Error(
    "Toodledo credentials not found. Set TOODLEDO_CLIENT_ID and TOODLEDO_CLIENT_SECRET " +
    `environment variables, or create ${CONFIG_FILE} with client_id and client_secret.`
  );
}
