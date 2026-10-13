import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// Basecamp settings live in Secret Manager and are read at runtime (not mounted
// by Cloud Run), so the server still deploys before Basecamp is set up.

let client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  client ??= new SecretManagerServiceClient();
  return client;
}

function secretPath(name: string): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not set");
  return `projects/${project}/secrets/${name}`;
}

/** Latest value of a secret, or null if it doesn't exist or has no versions. */
export async function readSecret(name: string): Promise<string | null> {
  try {
    const [version] = await getClient().accessSecretVersion({
      name: `${secretPath(name)}/versions/latest`,
    });
    const payload = version.payload?.data;
    if (!payload) return null;
    const value = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8");
    return value.trim() || null;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 5 /* NOT_FOUND */ || code === 9 /* FAILED_PRECONDITION: no enabled versions */) {
      return null;
    }
    throw err;
  }
}

export async function writeSecret(name: string, value: string): Promise<void> {
  await getClient().addSecretVersion({
    parent: secretPath(name),
    payload: { data: Buffer.from(value) },
  });
}
