// Runs in the browser before the application becomes interactive (Next.js instrumentation-client),
// i.e. before any client module builds a Zod schema. Keep this import first.
import "./client/zod-jitless";
