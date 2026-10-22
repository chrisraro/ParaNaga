import "server-only";
import type { z } from "zod";
import type { ApiError, ApiErrorCode } from "@/domain/api/schemas";
import { withRequestContext, type Db } from "@/server/db/context";
import { safeRequestId } from "@/server/request-id";

export const CACHE = {
  head: "public, s-maxage=30",
  immutable: "public, s-maxage=31536000, immutable",
  list: "public, s-maxage=300",
  reference: "public, s-maxage=300, stale-while-revalidate=600",
  none: "no-store",
  /** Personal data (private reports, signed URLs): never stored by any cache, shared or not. */
  private: "private, no-store",
} as const;

export class ApiProblem extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export const badRequest = (message: string) => new ApiProblem(400, "bad_request", message);
export const unauthorized = (message: string = "Sign in to continue.") => new ApiProblem(401, "unauthorized", message);
export const forbidden = (message: string = "You are not allowed to do this.") => new ApiProblem(403, "forbidden", message);
/** The caller is signed in but must verify a fresh email code first (step-up, spec 05 §5.4). */
export const stepUpRequired = () => new ApiProblem(403, "step_up_required", "Enter a new code from your email to continue.");
export const notFound = (message: string) => new ApiProblem(404, "not_found", message);
/** The request is valid but the resource is not in a state that allows it (e.g. a stale publish). */
export const conflict = (message: string) => new ApiProblem(409, "conflict", message);
export const unavailable = (message: string) => new ApiProblem(503, "unavailable", message);
export const payloadTooLarge = (message: string) => new ApiProblem(413, "payload_too_large", message);
export const tooManyRequests = (message: string = "Too many requests. Please wait a moment.") =>
  new ApiProblem(429, "too_many_requests", message);

function errorResponse(status: number, code: ApiErrorCode, message: string, requestId: string): Response {
  const body: ApiError = { error: { code, message, requestId } };
  return Response.json(body, { status, headers: { "Cache-Control": CACHE.none, "X-Request-Id": requestId } });
}

export type ApiResult = { body: unknown; cacheControl: string };

type RunContext = { requestId: string; withDb: <T>(fn: (db: Db) => Promise<T>) => Promise<T> };
type Run<S extends z.ZodType> = (ctx: RunContext) => Promise<{ body: z.input<S>; cacheControl: string }>;

/**
 * Wraps a public handler: request id, guest DB context, response validation against the
 * shared schema, and the error envelope. Reading `request.headers` first also keeps a GET
 * handler out of build-time prerendering (Cache Components), so the database is only queried
 * per request. Logs carry the route name, request id and error class only, never query values,
 * request bodies or coordinates.
 */
async function publicHandler<S extends z.ZodType>(request: Request, route: string, schema: S, run: Run<S>): Promise<Response> {
  return handle(request, route, async (ctx) => {
    const result = await run(ctx);
    const body = schema.parse(result.body);
    return Response.json(body, { headers: { "Cache-Control": result.cacheControl, "X-Request-Id": ctx.requestId } });
  });
}

/**
 * Stored text served verbatim. `load` is called only when the client's copy is stale: a matching
 * If-None-Match gets 304 from the stored etag alone, without reading or checking the body.
 */
export type TextResult = { etag: string; contentType: string; cacheControl: string; load: () => Promise<string> };

/**
 * A public, read-only GET that serves stored text verbatim (e.g. the walk graph payload): `load`
 * reads and validates it. A strong ETag is sent; a matching If-None-Match gets 304 first.
 * Same request id, read-only transaction(s) and error envelope as publicGet.
 */
export function publicText(request: Request, route: string, run: (ctx: RunContext) => Promise<TextResult>): Promise<Response> {
  return handle(request, route, async (ctx) => {
    const result = await run(ctx);
    const etag = `"${result.etag}"`;
    const headers = { "Cache-Control": result.cacheControl, ETag: etag, "X-Request-Id": ctx.requestId };
    const match = request.headers.get("if-none-match");
    if (match !== null && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return new Response(null, { status: 304, headers });
    }
    const text = await result.load();
    return new Response(text, { headers: { ...headers, "Content-Type": result.contentType } });
  });
}

/** pg-pool gave up waiting for a free connection: busy, not broken (503, the client retries). */
const isPoolTimeout = (error: unknown) => error instanceof Error && /timeout exceeded when trying to connect/i.test(error.message);
const BUSY = "ParaNaga is busy. Try again in a moment.";

async function handle(request: Request, route: string, respond: (ctx: RunContext) => Promise<Response>): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  try {
    // One read-only REPEATABLE READ transaction per call: all statements share one snapshot.
    const withDb = <T>(fn: (db: Db) => Promise<T>) => withRequestContext({ userId: null, requestId }, fn, { readOnly: true });
    return await respond({ requestId, withDb });
  } catch (error) {
    if (error instanceof ApiProblem) return errorResponse(error.status, error.code, error.message, requestId);
    if (isPoolTimeout(error)) return errorResponse(503, "unavailable", BUSY, requestId);
    console.error(JSON.stringify({
      event: "api_error",
      route,
      requestId,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return errorResponse(500, "internal", "Something went wrong.", requestId);
  }
}

/**
 * A signed-in endpoint (account data, writes): request id, the error envelope and no-store are
 * handled here; `run` calls authorize() first and opens its own request context. An
 * AuthorizationError from authorize() becomes 401 (no session) or 403 (not allowed).
 */
export async function authedRoute(request: Request, route: string, run: (requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = safeRequestId(request.headers.get("x-vercel-id") ?? request.headers.get("x-request-id"));
  try {
    return await run(requestId);
  } catch (error) {
    if (error instanceof ApiProblem) return errorResponse(error.status, error.code, error.message, requestId);
    if (error instanceof Error && error.name === "AuthorizationError") {
      const unauthenticated = (error as { reason?: string }).reason === "unauthenticated";
      return unauthenticated
        ? errorResponse(401, "unauthorized", "Sign in to continue.", requestId)
        : errorResponse(403, "forbidden", "You are not allowed to do this.", requestId);
    }
    if (isPoolTimeout(error)) return errorResponse(503, "unavailable", BUSY, requestId);
    console.error(JSON.stringify({ event: "api_error", route, requestId, error: error instanceof Error ? error.name : "unknown" }));
    return errorResponse(500, "internal", "Something went wrong.", requestId);
  }
}

/** A public, read-only GET. */
export function publicGet<S extends z.ZodType>(request: Request, route: string, schema: S, run: Run<S>): Promise<Response> {
  return publicHandler(request, route, schema, run);
}

/**
 * A public, read-only POST (a computation over the published data, e.g. trip planning): same
 * envelope and read-only transaction as publicGet. Read the body with readJsonBody inside `run`.
 */
export function publicPost<S extends z.ZodType>(request: Request, route: string, schema: S, run: Run<S>): Promise<Response> {
  return publicHandler(request, route, schema, run);
}

/**
 * Reads a small JSON body: `application/json` only, at most `maxBytes` (checked against
 * Content-Length first, then while streaming, so an oversized body is never buffered whole).
 * Errors never echo the body.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw badRequest("Send a JSON body (Content-Type: application/json).");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge(`The request body must be at most ${maxBytes} bytes.`);
  if (!request.body) throw badRequest("The request body is empty.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw payloadTooLarge(`The request body must be at most ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}
