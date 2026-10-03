"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { TargetDecision } from "@/lib/types";

/**
 * Record a decision on one target.
 *
 * This hits the same route the MCP `decide_target` tool calls, so a decision
 * made in the browser and one made by an agent take an identical code path and
 * both land in the same audit chain.
 */
export function DecisionButtons({
  planId,
  objectId,
  current,
}: {
  planId: string;
  objectId: string;
  current: TargetDecision;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<TargetDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: TargetDecision) {
    setPending(decision);
    setError(null);
    try {
      const response = await fetch(
        `/api/plans/${encodeURIComponent(planId)}/targets/${encodeURIComponent(objectId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the decision.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1.5" data-testid="decision-control">
        {(["observe", "skip"] as const).map((decision) => (
          <button
            key={decision}
            type="button"
            onClick={() => void decide(decision)}
            disabled={pending !== null}
            aria-pressed={current === decision}
            className={`btn ${current === decision ? "btn-primary" : ""}`}
            data-testid={`decide-${decision}`}
          >
            {pending === decision ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : null}
            {decision}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="signal-fallback mt-2 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}