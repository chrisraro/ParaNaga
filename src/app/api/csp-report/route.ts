const MAX_BYTES = 8 * 1024;

// Receives CSP violation reports during the Report-Only period (spec §5.10).
// Logs only the directive and blocked origin, never full URLs or page content.
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES) return new Response(null, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) return new Response(null, { status: 413 });
  try {
    const body = JSON.parse(text) as { "csp-report"?: Record<string, unknown> };
    const report = body["csp-report"] ?? {};
    const directive = String(report["violated-directive"] ?? report["effective-directive"] ?? "unknown");
    const blocked = String(report["blocked-uri"] ?? "unknown");
    let origin = blocked;
    try {
      origin = new URL(blocked).origin;
    } catch {
      // keyword values such as 'inline' or 'eval'
    }
    console.warn(JSON.stringify({ event: "csp_violation", directive: directive.slice(0, 80), blocked: origin.slice(0, 120) }));
  } catch {
    return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 204 });
}
