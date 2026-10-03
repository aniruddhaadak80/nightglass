import { createObservation, listObservations } from "@/lib/service";
import { failResult, fromResult, readJson, readPaging, withSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { session, attach } = await withSession();
  const { limit, offset } = readPaging(request.url);
  const result = await listObservations(session.ownerId, limit, offset);
  return fromResult(result, attach);
}

export async function POST(request: Request) {
  const { session, attach } = await withSession();
  const body = await readJson(request);
  if (body === null) {
    return attach(failResult("invalid_request", "Request body must be valid JSON."));
  }
  const result = await createObservation(session.ownerId, body);
  return fromResult(result, attach);
}