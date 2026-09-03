"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/charges", label: "Charges" },
  { href: "/import", label: "Import" },
  { href: "/accounts", label: "Accounts" },
  { href: "/connections", label: "Connections" },
];

export function Nav({ email, role }: { email: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-ink-800 bg-ink-900/60 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-500/15 text-sm text-accent-400">
            4x
          </span>
          Cap Runway
        </Link>

        <nav className="flex flex-1 flex-wrap gap-1 text-sm">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-ink-800 text-ink-100"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 text-sm text-ink-500">
          <span className="hidden sm:inline">{email}</span>
          {role === "admin" ? (
            <span className="rounded-md bg-brand-500/15 px-2 py-0.5 text-xs text-brand-400">
              admin
            </span>
          ) : (
            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-xs">read-only</span>
          )}
          <button
            onClick={signOut}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
