import { createPlan, listPlans } from "@/lib/service";
import { failResult, fromResult, readJson, readPaging, withSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List every plan owned by the current anonymous session. */
export async function GET(request: Request) {
  const { session, attach } = await withSession();
  const { limit, offset } = readPaging(request.url);
  const result = await listPlans(session.ownerId, limit, offset);
  return fromResult(result, attach);
}

/** Create a plan. */
export async function POST(request: Request) {
  const { session, attach } = await withSession();
  const body = await readJson(request);
  if (body === null) {
    return attach(failResult("invalid_request", "Request body must be valid JSON."));
  }
  const result = await createPlan(session.ownerId, body);
  const response = fromResult(result, attach);
  return response;
}