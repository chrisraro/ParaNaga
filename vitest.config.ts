import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url));

/**
 * Integration files share one database branch and run one at a time: run them in name order, so
 * the order never depends on Vitest's cache of earlier failures and durations (the default).
 * INTEGRATION_FIRST=<name fragment> moves matching files to the front (used to prove that no
 * file depends on what another one left published).
 */
class NameSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const isIntegration = (f: TestSpecification) => f.project.name === "integration";
    const first = process.env.INTEGRATION_FIRST;
    const rank = (f: TestSpecification) => (first && f.moduleId.includes(first) ? 0 : 1);
    const integration = files
      .filter(isIntegration)
      .sort((a, b) => rank(a) - rank(b) || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
    // Every other project keeps Vitest's default order (failed first, then slowest first).
    const others = await super.sort(files.filter((f) => !isIntegration(f)));
    return [...others, ...integration];
  }
}

// Server modules import "server-only"; tests run them as a React Server environment would.
const resolve = {
  alias: [
    { find: /^@\//, replacement: `${src}/` },
    { find: /^server-only$/, replacement: serverOnlyStub },
  ],
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        // The real-data planner tests are heavy: 5 s (the default) times out when the whole suite runs in parallel.
        test: { name: "unit", env: { DRIVER_REPORTS_ENABLED: "true" }, include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node", testTimeout: 30_000 },
      },
      {
        resolve,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          // One branch, shared state (published pointer, table locks in reference-api): never parallel.
          fileParallelism: false,
        },
      },
    ],
    // Root-level only (Vitest does not allow a sequencer per project); it orders only the
    // integration project's files and hands every other file to the default sequencer.
    sequence: { sequencer: NameSequencer },
    coverage: { provider: "v8", include: ["src/domain/**", "src/server/**"] },
  },
});
