// Import this before any module that builds Zod schemas in the browser. Zod probes `new
// Function("")` when a schema is built (to enable its JIT); under our CSP (no 'unsafe-eval')
// that probe is reported as a violation even though Zod catches it. jitless skips the probe.
// Server code keeps the default (no CSP there).
import { config } from "zod";

if (typeof window !== "undefined") config({ jitless: true });
