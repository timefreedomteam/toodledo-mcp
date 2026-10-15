import { getAccessToken } from "../auth/token-store.js";
import type {
  ToodledoFolder,
  ToodledoContext,
  ToodledoGoal,
  ToodledoError,
} from "../types.js";

const BASE_URL = "https://api.toodledo.com/3";

export class ToodledoApiError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
    this.name = "ToodledoApiError";
  }
}

export class ToodledoClient {
  // Name <-> ID caches
  private folders: Map<string, number> = new Map();
  private foldersById: Map<number, string> = new Map();
  private contexts: Map<string, number> = new Map();
  private contextsById: Map<number, string> = new Map();
  private goals: Map<string, number> = new Map();
  private goalsById: Map<number, string> = new Map();

  private foldersLoaded = false;
  private contextsLoaded = false;
  private goalsLoaded = false;

  /** Run a request, retrying once with a new token if Toodledo says this one hit its rate limit. */
  private async withTokenRetry(request: (token: string) => Promise<unknown>): Promise<unknown> {
    try {
      return await request(await getAccessToken());
    } catch (err) {
      if (!(err instanceof ToodledoApiError) || !/too many requests per token/i.test(err.message)) throw err;
      return await request(await getAccessToken(true));
    }
  }

  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    return this.withTokenRetry((token) => this.getWithToken(token, path, params));
  }

  private async getWithToken(token: string, path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("access_token", token);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const response = await fetch(url);
    const data = await response.json();
    this.checkError(data);
    return data;
  }

  async post(path: string, body: Record<string, string>): Promise<unknown> {
    return this.withTokenRetry((token) => this.postWithToken(token, path, body));
  }

  private async postWithToken(token: string, path: string, body: Record<string, string>): Promise<unknown> {
    const params = new URLSearchParams({ ...body, access_token: token });

    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await response.json();
    this.checkError(data);
    return data;
  }

  private checkError(data: unknown): void {
    if (data && typeof data === "object" && "errorCode" in data) {
      const err = data as ToodledoError;
      throw new ToodledoApiError(err.errorCode, err.errorDesc);
    }
    // Check for inline errors in arrays
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === "object" && "errorCode" in item) {
          const err = item as ToodledoError;
          throw new ToodledoApiError(err.errorCode, err.errorDesc);
        }
      }
    }
  }

  // --- Name resolution ---

  async resolveFolderName(name: string): Promise<number | null> {
    await this.ensureFolders();
    const id = this.folders.get(name.toLowerCase());
    if (id !== undefined) return id;
    // Refresh cache once in case it was just created
    await this.refreshFolders();
    return this.folders.get(name.toLowerCase()) ?? null;
  }

  async resolveContextName(name: string): Promise<number | null> {
    await this.ensureContexts();
    const id = this.contexts.get(name.toLowerCase());
    if (id !== undefined) return id;
    await this.refreshContexts();
    return this.contexts.get(name.toLowerCase()) ?? null;
  }

  async resolveGoalName(name: string): Promise<number | null> {
    await this.ensureGoals();
    const id = this.goals.get(name.toLowerCase());
    if (id !== undefined) return id;
    await this.refreshGoals();
    return this.goals.get(name.toLowerCase()) ?? null;
  }

  getFolderName(id: number): string {
    return this.foldersById.get(id) ?? "None";
  }

  getContextName(id: number): string {
    return this.contextsById.get(id) ?? "None";
  }

  getGoalName(id: number): string {
    return this.goalsById.get(id) ?? "None";
  }

  getFolderNames(): string[] {
    return [...this.foldersById.values()];
  }

  getContextNames(): string[] {
    return [...this.contextsById.values()];
  }

  getGoalNames(): string[] {
    return [...this.goalsById.values()];
  }

  // --- Cache management ---

  private async ensureFolders(): Promise<void> {
    if (!this.foldersLoaded) await this.refreshFolders();
  }

  private async ensureContexts(): Promise<void> {
    if (!this.contextsLoaded) await this.refreshContexts();
  }

  private async ensureGoals(): Promise<void> {
    if (!this.goalsLoaded) await this.refreshGoals();
  }

  async refreshFolders(): Promise<ToodledoFolder[]> {
    const data = (await this.get("/folders/get.php")) as ToodledoFolder[];
    this.folders.clear();
    this.foldersById.clear();
    for (const f of data) {
      this.folders.set(f.name.toLowerCase(), f.id);
      this.foldersById.set(f.id, f.name);
    }
    this.foldersLoaded = true;
    return data;
  }

  async refreshContexts(): Promise<ToodledoContext[]> {
    const data = (await this.get("/contexts/get.php")) as ToodledoContext[];
    this.contexts.clear();
    this.contextsById.clear();
    for (const c of data) {
      this.contexts.set(c.name.toLowerCase(), c.id);
      this.contextsById.set(c.id, c.name);
    }
    this.contextsLoaded = true;
    return data;
  }

  async refreshGoals(): Promise<ToodledoGoal[]> {
    const data = (await this.get("/goals/get.php")) as ToodledoGoal[];
    this.goals.clear();
    this.goalsById.clear();
    for (const g of data) {
      this.goals.set(g.name.toLowerCase(), g.id);
      this.goalsById.set(g.id, g.name);
    }
    this.goalsLoaded = true;
    return data;
  }

  findClosestName(name: string, available: string[]): string | null {
    const lower = name.toLowerCase();
    // Exact match
    const exact = available.find((n) => n.toLowerCase() === lower);
    if (exact) return exact;
    // Substring match
    const partial = available.find(
      (n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase())
    );
    return partial ?? null;
  }
}
