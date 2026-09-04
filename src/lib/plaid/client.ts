import { decryptToken, loadKey } from "@/lib/crypto";

/**
 * Plaid is off unless PLAID_ENABLED is exactly "true". Every route checks
 * this before doing anything, so an unconfigured deploy simply has no Plaid.
 */
export function isPlaidEnabled(): boolean {
  return process.env.PLAID_ENABLED === "true";
}

/**
 * The Plaid environment name, normalised. Dashboards and docs capitalise it
 * inconsistently and copy-paste picks up whitespace, none of which should
 * amount to a misconfigured deploy.
 */
export function resolvePlaidEnv(): string {
  // ?? only catches undefined, but a variable created in a dashboard and left
  // blank arrives as "" — which should mean "unset", not "invalid".
  const raw = (process.env.PLAID_ENV ?? "").trim().toLowerCase();
  return raw === "" ? "sandbox" : raw;
}

export interface PlaidReadiness {
  /** PLAID_ENABLED is exactly "true". */
  enabled: boolean;
  /** Names of required variables that are absent or empty. Never values. */
  missing: string[];
  /** Variables that are present but unusable, with the reason. */
  invalid: string[];
  ready: boolean;
}

/**
 * Reports whether Plaid is actually usable, and what is missing if not.
 *
 * Names and reasons only — no values ever leave the server. Without this a
 * misconfigured deploy just shows "disabled" with no way to tell which of the
 * six variables is at fault.
 */
export function plaidReadiness(): PlaidReadiness {
  const required: Record<string, string | undefined> = {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_TOKEN_ENCRYPTION_KEY: process.env.PLAID_TOKEN_ENCRYPTION_KEY,
    // plaid_items is deny-all under RLS, so the service role is the only way in.
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value || value.trim() === "")
    .map(([name]) => name);

  const invalid: string[] = [];

  const env = resolvePlaidEnv();
  if (!HOSTS[env]) {
    // Name what arrived — a typo is invisible otherwise.
    invalid.push(
      `PLAID_ENV must be one of ${Object.keys(HOSTS).join(", ")} — got "${env}"`,
    );
  }

  // A key that is present but not 32 bytes fails only at the moment a token
  // is encrypted, which is the worst time to find out.
  if (!missing.includes("PLAID_TOKEN_ENCRYPTION_KEY")) {
    try {
      loadKey();
    } catch (error) {
      invalid.push(
        `PLAID_TOKEN_ENCRYPTION_KEY: ${error instanceof Error ? error.message : "unusable"}`,
      );
    }
  }

  const enabled = isPlaidEnabled();
  return { enabled, missing, invalid, ready: enabled && missing.length === 0 && invalid.length === 0 };
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
  const env = resolvePlaidEnv();
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
