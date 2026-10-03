import { deletePlan, getPlan, updatePlan } from "@/lib/service";
import { failResult, fromResult, readJson, withSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { session, attach } = await withSession();
  const { id } = await context.params;
  const result = await getPlan(session.ownerId, id);
  return fromResult(result, attach);
}

export async function PATCH(request: Request, context: Context) {
  const { session, attach } = await withSession();
  const { id } = await context.params;
  const body = await readJson(request);
  if (body === null) {
    return attach(failResult("invalid_request", "Request body must be valid JSON."));
  }
  const result = await updatePlan(session.ownerId, id, body);
  return fromResult(result, attach);
}

export async function DELETE(_request: Request, context: Context) {
  const { session, attach } = await withSession();
  const { id } = await context.params;
  const result = await deletePlan(session.ownerId, id);
  return fromResult(result, attach);
}