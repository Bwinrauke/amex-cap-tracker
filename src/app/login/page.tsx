import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · 4x Cap Runway" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent-500/15 text-accent-400">
            4x
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Cap Runway</h1>
          <p className="mt-1 text-sm text-ink-500">
            Bonus-category spend against every card's cap.
          </p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
