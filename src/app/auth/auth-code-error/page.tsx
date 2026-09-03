import Link from "next/link";

export default async function AuthCodeErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">That link didn&apos;t work</h1>
        <p className="mt-2 text-sm text-ink-500">
          Sign-in links expire after a short while and can only be used once.
        </p>

        {reason ? (
          <p className="mt-4 rounded-lg border border-ink-800 bg-ink-950 p-3 text-left text-xs text-ink-300">
            {reason}
          </p>
        ) : null}

        <Link
          href="/login"
          className="mt-5 inline-block rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-ink-950"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
