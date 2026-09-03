import { SignOutButton } from "./SignOutButton";

export const metadata = { title: "No access · 4x Cap Runway" };

export default function NotAuthorizedPage() {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="card max-w-sm p-6 text-center">
        <h1 className="text-lg font-semibold">This account has no access</h1>
        <p className="mt-2 text-sm text-ink-500">
          Signing in worked, but this address is not permitted to use this app.
          Nothing here is visible to it.
        </p>
        <SignOutButton />
      </div>
    </div>
  );
}
