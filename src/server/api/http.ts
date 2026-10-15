import "server-only";
import type { z } from "zod";
import type { ApiError, ApiErrorCode } from "@/domain/api/schemas";
import { withRequestContext, type Db } from "@/server/db/context";

const SAFE_REQUEST_ID = /^[A-Za-z0-9:_-]{1,64}$/;

/** Client-supplied ids end up in logs and audit rows, so only a safe shape is accepted. */
export function safeRequestId(candidate: string | null | undefined): string {
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}

export const CACHE = {
  head: "public, s-maxage=30",
  immutable: "public, s-maxage=31536000, immutable",
  list: "public, s-maxage=300",
  none: "no-store",
} as const;

export class ApiProblem extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export const badRequest = (message: string) => new ApiProblem(400, "bad_request", message);
export const notFound = (message: string) => new ApiProblem(404, "not_found", message);

function errorResponse(status: number, code: ApiErrorCode, message: string, requestId: string): Response {
  const body: ApiError = { error: { code, message, requestId } };
  return Response.json(body, { status, headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId } });
}

export type ApiResult = { body: unknown; cacheControl: string };

/**
 * Wraps a public GET handler: request id, guest DB context, response validation against the
 * shared schema, and the error envelope. Reading `request.headers` first also keeps the handler
 * out of build-time prerendering (Cache Components), so the database is only queried per request.
 * Logs carry the route name, request id and error class only, never query values or coordinates.
 */
export async function publicGet<S extends z.ZodType>(
  request: Request,
  route: string,
  schema: S,
  run: (ctx: { requestId: string; withDb: <T>(fn: (db: Db) => Promise<T>) => Promise<T> }) => Promise<{
    body: z.input<S>;
    cacheControl: string;
  }>,
): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  try {
    const withDb = <T>(fn: (db: Db) => Promise<T>) => withRequestContext({ userId: null, requestId }, fn);
    const result = await run({ requestId, withDb });
    const body = schema.parse(result.body);
    return Response.json(body, { headers: { "Cache-Control": result.cacheControl, "X-Request-Id": requestId } });
  } catch (error) {
    if (error instanceof ApiProblem) return errorResponse(error.status, error.code, error.message, requestId);
    console.error(JSON.stringify({
      event: "api_error",
      route,
      requestId,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return errorResponse(500, "internal", "Something went wrong.", requestId);
  }
}
