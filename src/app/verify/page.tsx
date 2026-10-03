import { VerifyPanel } from "@/components/verify-panel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify",
  description:
    "Replay the append-only SHA-384 audit chain and report the first broken link, if one exists.",
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ planId?: string }> }) {
  const { planId } = await searchParams;
  return <VerifyPanel initialPlanId={planId ?? null} />;
}