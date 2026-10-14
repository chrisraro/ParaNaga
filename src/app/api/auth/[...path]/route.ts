import { neonAuth } from "@/server/auth/neon";

type Ctx = { params: Promise<{ path: string[] }> };

function notConfigured() {
  return Response.json(
    { error: { code: "auth_not_configured", message: "Sign-in is not available yet." } },
    { status: 503 },
  );
}

async function handle(method: "GET" | "POST", request: Request, ctx: Ctx) {
  const auth = neonAuth();
  if (!auth) return notConfigured();
  return auth.handler()[method](request, ctx);
}

export function GET(request: Request, ctx: Ctx) {
  return handle("GET", request, ctx);
}

export function POST(request: Request, ctx: Ctx) {
  return handle("POST", request, ctx);
}
