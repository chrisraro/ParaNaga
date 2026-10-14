import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { serverEnv } from "@/server/env";
import { withRequestContext } from "@/server/db/context";

type Status = "ok" | "unconfigured" | "error";

function isOperator(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Public: liveness only, no DB wake-up, no configuration disclosure.
// Operators (Bearer CRON_SECRET) get a DB probe and configuration states, never values.
export async function GET(request: Request) {
  await connection();
  const env = serverEnv();
  const headers = { "Cache-Control": "no-store" };

  if (!isOperator(request, env.CRON_SECRET)) {
    return Response.json({ ok: true }, { headers });
  }

  let db: Status = "unconfigured";
  if (env.PARANAGA_DATABASE_URL) {
    try {
      await withRequestContext({ userId: null, requestId: crypto.randomUUID() }, (tx) => tx.execute(sql`select 1`));
      db = "ok";
    } catch {
      db = "error";
    }
  }

  const body = {
    ok: db !== "error",
    db,
    auth: env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET ? "configured" : "unconfigured",
    storage: env.STORAGE_ENDPOINT ? "configured" : "unconfigured",
    jev: env.OPENROUTER_API_KEY ? "configured" : "unconfigured",
  };
  return Response.json(body, { status: body.ok ? 200 : 503, headers });
}
