"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="mt-5 rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
    >
      Sign out
    </button>
  );
}
