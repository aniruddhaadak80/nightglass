import { decideTarget } from "@/lib/service";
import { failResult, fromResult, readJson, withSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; objectId: string }> };

/**
 * Record a decision on one target of a plan.
 *
 * The target is addressed by its catalogue object id in the path, which is what
 * the catalogue route hands the UI, so a decision always refers to a real
 * catalogue entry rather than a free-text name.
 */
export async function POST(request: Request, context: Context) {
  const { session, attach } = await withSession();
  const { id, objectId } = await context.params;
  const body = await readJson(request);
  if (body === null) {
    return attach(failResult("invalid_request", "Request body must be valid JSON."));
  }

  const payload = {
    ...(body as Record<string, unknown>),
    objectId,
  };

  const result = await decideTarget(session.ownerId, id, payload);
  return fromResult(result, attach);
}