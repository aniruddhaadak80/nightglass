import { rankPlan } from "@/lib/service";
import { failResult, fromResult, readJson, withSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * Rank every target on a saved plan against live conditions and the plan's own
 * site and instrument, persist the scores, and append a `plan.ranked` audit
 * event. This is the endpoint the UI, the curl examples and the MCP tool all
 * share.
 */
export async function POST(request: Request, context: Context) {
  const { session, attach } = await withSession();
  const { id } = await context.params;

  // Body is accepted and ignored for now; ranking takes no parameters. Reading
  // it keeps a malformed body from being silently accepted.
  const body = await readJson(request);
  void body;

  const result = await rankPlan(session.ownerId, id);
  if (typeof result === "object" && result !== null && "error" in result) {
    return attach(failResult(result.error.code, result.error.message));
  }
  return fromResult(result, attach);
}