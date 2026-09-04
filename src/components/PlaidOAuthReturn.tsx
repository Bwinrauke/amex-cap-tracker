"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
/** Key the panel writes the link token under before handing off to the bank. */
export const LINK_TOKEN_KEY = "plaid:link-token";

interface PlaidHandler {
  open: () => void;
  exit: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string) => void;
        onExit: (error: { display_message?: string; error_message?: string } | null) => void;
      }) => PlaidHandler;
    };
  }
}

/**
 * Where an OAuth bank returns the user.
 *
 * Plaid requires Link to be re-created with the ORIGINAL link token and the
 * full return URL as receivedRedirectUri — the URL carries an oauth_state_id
 * that resumes the session. The token cannot be re-minted here: a new one
 * would have no knowledge of the flow the user just completed.
 */
export function PlaidOAuthReturn() {
  const router = useRouter();
  const [status, setStatus] = useState("Finishing the connection…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resume() {
      const token = sessionStorage.getItem(LINK_TOKEN_KEY);
      if (!token) {
        setError(
          "The browser lost track of this connection attempt — the tab was closed or storage cleared. Start again from Connections.",
        );
        return;
      }

      await new Promise<void>((resolve, reject) => {
        if (window.Plaid) return resolve();
        const script = document.createElement("script");
        script.src = LINK_SCRIPT;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Could not load Plaid Link."));
        document.body.appendChild(script);
      });

      if (cancelled || !window.Plaid) return;

      const handler = window.Plaid.create({
        token,
        // The full URL, unmodified — Plaid rejects extra query parameters.
        receivedRedirectUri: window.location.href,
        onSuccess: async (publicToken: string) => {
          setStatus("Saving the connection…");
          try {
            const response = await fetch("/api/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicToken }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Could not save the connection.");
            sessionStorage.removeItem(LINK_TOKEN_KEY);
            router.replace("/connections");
            router.refresh();
          } catch (exchangeError) {
            setError(
              exchangeError instanceof Error ? exchangeError.message : "Exchange failed.",
            );
          }
        },
        onExit: (exitError) => {
          sessionStorage.removeItem(LINK_TOKEN_KEY);
          if (exitError) {
            setError(
              exitError.display_message ?? exitError.error_message ?? "The bank cancelled the connection.",
            );
          } else {
            router.replace("/connections");
          }
        },
      });

      handler.open();
    }

    resume().catch((resumeError) => {
      if (!cancelled) {
        setError(resumeError instanceof Error ? resumeError.message : "Could not resume.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-semibold text-danger-400">Connection not completed</h1>
          <p className="mt-2 text-sm text-ink-300">{error}</p>
          <a
            href="/connections"
            className="mt-5 inline-block rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-ink-950"
          >
            Back to Connections
          </a>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">{status}</h1>
          <p className="mt-2 text-sm text-ink-500">
            Returning you to the app — this usually takes a moment.
          </p>
        </>
      )}
    </div>
  );
}
