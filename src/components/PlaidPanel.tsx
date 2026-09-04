"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LINK_TOKEN_KEY } from "./PlaidOAuthReturn";

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export interface PlaidAccountRowView {
  id: string;
  name: string | null;
  mask: string | null;
  subtype: string | null;
  card_account_id: string | null;
}

export function PlaidPanel({
  plaidAccounts,
  cardAccounts,
  isAdmin,
}: {
  plaidAccounts: PlaidAccountRowView[];
  cardAccounts: { id: string; nickname: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState<null | "link" | "sync">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plaid Link is loaded from Plaid's CDN rather than bundled, because it must
  // be the current version for institution support to stay correct.
  useEffect(() => {
    if (window.Plaid) {
      setScriptReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = LINK_SCRIPT;
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => setError("Could not load Plaid Link from Plaid's CDN.");
    document.body.appendChild(script);
  }, []);

  const connect = useCallback(async () => {
    setBusy("link");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/plaid/link-token", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not start a Plaid session.");
      if (!window.Plaid) throw new Error("Plaid Link has not finished loading.");

      /*
       * An OAuth bank navigates the whole page away, so the token has to
       * outlive this component. The return page reads it back to resume the
       * same Link session; a freshly minted one would not match.
       */
      sessionStorage.setItem(LINK_TOKEN_KEY, payload.linkToken);

      const handler = window.Plaid.create({
        token: payload.linkToken,
        onSuccess: async (publicToken: string) => {
          setBusy("link");
          try {
            const exchange = await fetch("/api/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicToken }),
            });
            const result = await exchange.json();
            if (!exchange.ok) throw new Error(result.error ?? "Could not save the connection.");
            sessionStorage.removeItem(LINK_TOKEN_KEY);
            setMessage(
              `Connected. ${result.accounts} account${result.accounts === 1 ? "" : "s"} found — map each one to a card below, then sync.`,
            );
            router.refresh();
          } catch (exchangeError) {
            setError(exchangeError instanceof Error ? exchangeError.message : "Exchange failed.");
          } finally {
            setBusy(null);
          }
        },
        onExit: (exitError) => {
          if (exitError) {
            setError(exitError.display_message ?? exitError.error_message ?? "Plaid Link closed.");
          }
          setBusy(null);
        },
      });

      handler.open();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Could not open Plaid Link.");
      setBusy(null);
    }
  }, [router]);

  async function sync() {
    setBusy("sync");
    setError(null);
    setMessage(null);

    const response = await fetch("/api/plaid/sync", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Sync failed.");
    } else {
      const parts = [`${payload.inserted} new charge${payload.inserted === 1 ? "" : "s"}`];
      if (payload.unmapped > 0) {
        parts.push(`${payload.unmapped} skipped from unmapped accounts`);
      }
      if (payload.skippedZero > 0) {
        parts.push(`${payload.skippedZero} zero-amount ignored`);
      }
      setMessage(
        parts.join(", ") +
          "." +
          (payload.cursorHeld
            ? " Nothing has been consumed — map the remaining accounts and sync again to pull their history."
            : ""),
      );
      if (payload.errors?.length) setError(payload.errors.join(" · "));
      router.refresh();
    }
    setBusy(null);
  }

  async function map(plaidAccountId: string, cardAccountId: string) {
    setError(null);
    const response = await fetch("/api/plaid/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaidAccountId, cardAccountId: cardAccountId || null }),
    });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Could not save the mapping.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={connect}
            disabled={!scriptReady || busy !== null}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy === "link" ? "Connecting…" : "Connect an institution"}
          </button>
          <button
            onClick={sync}
            disabled={busy !== null || plaidAccounts.length === 0}
            className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:opacity-40"
          >
            {busy === "sync" ? "Syncing…" : "Sync transactions"}
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3 text-sm text-accent-400">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-danger-400/30 bg-danger-400/5 p-3 text-sm text-danger-400">
          {error}
        </p>
      ) : null}

      {plaidAccounts.length === 0 ? (
        <p className="text-sm text-ink-500">
          Nothing connected yet. Linking an institution pulls its accounts in; each one then has
          to be pointed at a card before its transactions count toward a cap.
        </p>
      ) : (
        <ul className="divide-y divide-ink-850 text-sm">
          {plaidAccounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">
                  {account.name ?? "Account"}
                  {account.mask ? ` ••••${account.mask}` : ""}
                </span>
                {account.subtype ? (
                  <span className="text-xs text-ink-500">{account.subtype}</span>
                ) : null}
              </span>

              {isAdmin ? (
                <select
                  value={account.card_account_id ?? ""}
                  onChange={(e) => map(account.id, e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
                >
                  <option value="">Not mapped</option>
                  {cardAccounts.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.nickname}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-ink-500">
                  {account.card_account_id ? "mapped" : "not mapped"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
