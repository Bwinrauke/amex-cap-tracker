import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="card max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold">That link didn&apos;t work</h1>
        <p className="mt-2 text-sm text-ink-500">
          Sign-in links expire after a short while and can only be used once. Request a
          fresh one.
        </p>
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
