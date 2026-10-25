import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import type { Integration, IntegrationProvider, IntegrationsResponse } from "@lightbulb/shared";
import { db } from "../db/client.js";
import { appState, userCredentials } from "../db/schema.js";
import { HttpError } from "../lib/http.js";
import { decryptSecret, encryptSecret, maskSecret, secretsAvailable } from "./crypto.js";
import { githubUser } from "./github.js";

// A user's own connections: an Anthropic API key for cloud agent runs, and a GitHub token for
// publishing finished projects. Each is checked with the provider before it's saved.

const unavailable = () =>
  new HttpError(503, "integrations_unavailable", "This server can't store keys yet (SECRETS_KEY is not set)");

export async function listIntegrations(userId: string): Promise<IntegrationsResponse> {
  const rows = await db.select().from(userCredentials).where(eq(userCredentials.userId, userId));
  return {
    available: secretsAvailable(),
    integrations: rows.map(
      (row): Integration => ({
        provider: row.provider,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      }),
    ),
  };
}

/** Asks the provider whether the secret works; returns the label to show for it. */
async function verify(provider: IntegrationProvider, secret: string): Promise<string> {
  if (provider === "anthropic") {
    try {
      await new Anthropic({ apiKey: secret, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(400, "invalid_key", "Anthropic didn't accept that key");
      }
      throw new HttpError(502, "provider_unreachable", "Couldn't reach Anthropic to check the key");
    }
    return maskSecret(secret);
  }
  const user = await githubUser(secret);
  return user.login;
}

export async function connectIntegration(userId: string, provider: IntegrationProvider, secret: string) {
  if (!secretsAvailable()) throw unavailable();
  const label = await verify(provider, secret);
  const values = { userId, provider, secret: encryptSecret(secret), label, lastUsedAt: null };
  await db
    .insert(userCredentials)
    .values(values)
    .onConflictDoUpdate({
      target: [userCredentials.userId, userCredentials.provider],
      set: { secret: values.secret, label, lastUsedAt: null, createdAt: new Date() },
    });
  return listIntegrations(userId);
}

export async function disconnectIntegration(userId: string, provider: IntegrationProvider) {
  const [row] = await db
    .delete(userCredentials)
    .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, provider)))
    .returning({ id: userCredentials.id });
  // The cloud agent provisioned with that key belongs to the user's Anthropic account.
  if (row) await db.delete(appState).where(eq(appState.key, userBuilderKey(row.id)));
}

export const userBuilderKey = (credentialId: string) => `cloud_builder:user:${credentialId}`;

export async function hasIntegration(userId: string, provider: IntegrationProvider): Promise<boolean> {
  const [row] = await db
    .select({ id: userCredentials.id })
    .from(userCredentials)
    .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, provider)));
  return Boolean(row);
}

/** The decrypted secret for server-side use only; records that it was used. */
export async function useIntegration(
  userId: string,
  provider: IntegrationProvider,
): Promise<{ id: string; secret: string } | null> {
  const [row] = await db
    .select()
    .from(userCredentials)
    .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, provider)));
  if (!row || !secretsAvailable()) return null;
  await db.update(userCredentials).set({ lastUsedAt: new Date() }).where(eq(userCredentials.id, row.id));
  return { id: row.id, secret: decryptSecret(row.secret) };
}
