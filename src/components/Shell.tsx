import { getAuthUser, getViewer } from "@/lib/auth";
import { Nav } from "./Nav";
import { redirect } from "next/navigation";

/** Page frame for every authenticated route. */
export async function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    // A session without a profile means the address is not permitted; sending
    // them to /login would just bounce them back and forth.
    redirect((await getAuthUser()) ? "/auth/not-authorized" : "/login");
  }

  return (
    <div className="min-h-screen">
      <Nav email={viewer.email} role={viewer.role} />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
