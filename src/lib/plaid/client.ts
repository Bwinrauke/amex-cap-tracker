import { decryptToken } from "@/lib/crypto";

/**
 * Plaid is off unless PLAID_ENABLED is exactly "true". Every route checks
 * this before doing anything, so an unconfigured deploy simply has no Plaid.
 */
export function isPlaidEnabled(): boolean {
  return process.env.PLAID_ENABLED === "true";
}

const HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export interface PlaidConfig {
  clientId: string;
  secret: string;
  host: string;
}

export function loadPlaidConfig(): PlaidConfig {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV ?? "sandbox";
  const host = HOSTS[env];

  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be set when Plaid is enabled.");
  }
  if (!host) {
    throw new Error(`PLAID_ENV must be one of ${Object.keys(HOSTS).join(", ")}, got "${env}".`);
  }

  return { clientId, secret, host };
}

/**
 * Minimal Plaid REST call. Uses fetch rather than the SDK so that a deploy
 * with Plaid switched off carries no extra dependency.
 */
export async function plaidFetch<T>(
  path: string,
  body: Record<string, unknown>,
  config = loadPlaidConfig(),
): Promise<T> {
  const response = await fetch(`${config.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      secret: config.secret,
      ...body,
    }),
  });

  const payload = (await response.json()) as T & { error_message?: string; error_code?: string };

  if (!response.ok) {
    throw new Error(
      `Plaid ${path} failed: ${payload.error_code ?? response.status} ${
        payload.error_message ?? ""
      }`.trim(),
    );
  }
  return payload;
}

/** Decrypts a stored item token. Kept here so callers never touch the key. */
export function accessTokenFor(item: { access_token_encrypted: string }): string {
  return decryptToken(item.access_token_encrypted);
}

export function plaidDisabledResponse() {
  return Response.json(
    { error: "Plaid is not enabled on this deployment." },
    { status: 503 },
  );
}
