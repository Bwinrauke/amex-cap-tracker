"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);

    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next) redirectTo.searchParams.set("next", next);

    const { error: signInError } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo.toString() },
    });

    if (signInError) {
      setError(signInError.message);
      setState("idle");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-ink-100">Check your email.</p>
        <p className="mt-2 text-sm text-ink-500">
          We sent a sign-in link to <span className="text-ink-300">{email}</span>. It opens
          this app directly.
        </p>
        <button
          onClick={() => setState("idle")}
          className="mt-4 text-xs text-brand-400 hover:underline"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="card space-y-4 p-6">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-ink-300">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none transition-colors placeholder:text-ink-500 focus:border-brand-500"
        />
      </div>

      {error ? <p className="text-sm text-danger-400">{error}</p> : null}

      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>

      <p className="text-center text-xs text-ink-500">
        No password. The link signs you in on this device.
      </p>
    </form>
  );
}
