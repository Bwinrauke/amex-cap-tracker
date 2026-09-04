import { Shell } from "@/components/Shell";
import { PlaidOAuthReturn } from "@/components/PlaidOAuthReturn";

export const dynamic = "force-dynamic";

export default function PlaidOAuthPage() {
  return (
    <Shell title="Connecting" subtitle="Completing the handoff back from your bank.">
      <PlaidOAuthReturn />
    </Shell>
  );
}
