// Planner load test (N8): POST /api/v1/plan on a LOCAL production build, at a few concurrency
// levels, with realistic Naga coordinate pairs. Plain fetch + a worker pool; no dependency.
//
//   pnpm build && pnpm start --port 3600          (against a throwaway Neon branch, see docs/setup.md)
//   pnpm load:plan -- --base http://localhost:3600 --levels 10,25,50 --requests 300
//
// Refuses any host other than localhost / 127.0.0.1: never run it against production or a
// preview (it would spend the shared rate-limit table and the planner's CPU there).
//
// Pairs: the published snapshot's stops (fetched once from the same server, as the app does) plus
// a few well-known places, picked in pseudo-random pairs at least 400 m apart. Each request carries
// its own x-real-ip (a TEST-NET address) so the per-client limit (30/min) measures the planner, not
// the limiter; the limiter's database write still runs on every request. 429s are counted apart.

export {};

type Point = { lat: number; lng: number };

const LANDMARKS: Point[] = [
  { lat: 13.6236, lng: 123.1866 }, // Plaza Rizal
  { lat: 13.6290, lng: 123.1880 }, // Naga Metropolitan Cathedral
  { lat: 13.6305, lng: 123.1932 }, // Ateneo de Naga
  { lat: 13.6197, lng: 123.1957 }, // Central Bus Terminal
  { lat: 13.6285, lng: 123.1944 }, // Naga City Hall
  { lat: 13.6328, lng: 123.1949 }, // Basilica of Peñafrancia
  { lat: 13.6247, lng: 123.1879 }, // Universidad de Sta. Isabel
  { lat: 13.6175, lng: 123.2011 }, // Robinsons Place Naga
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const base = new URL(arg("base", "http://localhost:3600"));
const levels = arg("levels", "10,25,50").split(",").map(Number).filter((n) => n > 0);
const requestsPerLevel = Number(arg("requests", "300"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
  console.error(`Refusing ${base.origin}: the load test runs against a local build only.`);
  process.exit(2);
}

// Deterministic pseudo-random (mulberry32), so two runs send the same pairs.
let seed = 0x5eed;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const meters = (a: Point, b: Point) => {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  return Math.hypot(x, (b.lat - a.lat) * k) * 6_371_000;
};

async function points(): Promise<Point[]> {
  try {
    const head = (await (await fetch(new URL("/api/v1/network/head", base))).json()) as { revisionId?: string };
    if (!head.revisionId) throw new Error("no published revision");
    const snap = (await (await fetch(new URL(`/api/v1/network/snapshot/${head.revisionId}`, base))).json()) as { stops?: { lat: number; lng: number }[] };
    const stops = (snap.stops ?? []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => ({ lat: s.lat, lng: s.lng }));
    console.log(`points: ${stops.length} published stops + ${LANDMARKS.length} landmarks (revision ${head.revisionId})`);
    return [...stops, ...LANDMARKS];
  } catch (e) {
    console.log(`points: landmarks only (${(e as Error).message})`);
    return LANDMARKS;
  }
}

function pairs(pool: Point[], n: number): [Point, Point][] {
  const out: [Point, Point][] = [];
  while (out.length < n) {
    const a = pool[Math.floor(rand() * pool.length)]!;
    const b = pool[Math.floor(rand() * pool.length)]!;
    if (meters(a, b) >= 400) out.push([a, b]);
  }
  return out;
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : NaN);

let ipCounter = 0;
async function one([origin, destination]: [Point, Point]): Promise<{ ms: number; status: number }> {
  ipCounter += 1;
  const ip = `198.18.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; // RFC 2544 benchmarking range
  const started = performance.now();
  try {
    const res = await fetch(new URL("/api/v1/plan", base), {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip, "user-agent": "paranaga-load-plan" },
      body: JSON.stringify({ origin, destination }),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - started, status: res.status };
  } catch {
    return { ms: performance.now() - started, status: 0 };
  }
}

async function level(concurrency: number, work: [Point, Point][]) {
  const results: { ms: number; status: number }[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < work.length) results.push(await one(work[next++]!));
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  const ok = results.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
  const limited = results.filter((r) => r.status === 429).length;
  const errors = results.filter((r) => r.status !== 200 && r.status !== 429);
  const byStatus = Object.entries(errors.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}));
  return {
    concurrency,
    requests: results.length,
    "req/s": +(results.length / seconds).toFixed(1),
    p50: Math.round(pct(ok, 50)),
    p95: Math.round(pct(ok, 95)),
    p99: Math.round(pct(ok, 99)),
    max: Math.round(ok.at(-1) ?? NaN),
    "error %": +((errors.length / results.length) * 100).toFixed(2),
    "429": limited,
    errors: byStatus.map(([s, n]) => `${s === "0" ? "network" : s}×${n}`).join(" ") || "-",
  };
}

const pool = await points();
// Warm-up: the first plan of a revision builds its in-memory network.
for (const p of pairs(pool, 5)) await one(p);
const rows = [];
for (const c of levels) rows.push(await level(c, pairs(pool, requestsPerLevel)));
console.table(rows);
console.log("latencies in ms over 200 responses only; error % excludes 429");
