"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "link";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setState("working");
    setError(null);

    const { error: signInError } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setState("idle");
      return;
    }

    // Server components read the session from cookies, so refresh before
    // navigating or the first render still looks signed out.
    router.push(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setState("working");
    setError(null);

    const redirectTo = new URL("/auth/callback", window.location.origin);
    if (next) redirectTo.searchParams.set("next", next);

    const { error: linkError } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo.toString() },
    });

    if (linkError) {
      setError(linkError.message);
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
          We sent a sign-in link to <span className="text-ink-300">{email}</span>.
        </p>
        <button
          onClick={() => setState("idle")}
          className="mt-4 text-xs text-brand-400 hover:underline"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={mode === "password" ? signInWithPassword : sendLink}
      className="card space-y-4 p-6"
    >
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-ink-300">
          Email
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

      {mode === "password" ? (
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm text-ink-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500"
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger-400">{error}</p> : null}

      <button
        type="submit"
        disabled={state === "working"}
        className="w-full rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {state === "working"
          ? mode === "password"
            ? "Signing in…"
            : "Sending…"
          : mode === "password"
            ? "Sign in"
            : "Email me a sign-in link"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "password" ? "link" : "password");
          setError(null);
        }}
        className="w-full text-center text-xs text-ink-500 hover:text-brand-400"
      >
        {mode === "password"
          ? "Email me a sign-in link instead"
          : "Sign in with a password instead"}
      </button>
    </form>
  );
}
