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
    const first = process.env.INTEGRATION_FIRST;
    const rank = (f: TestSpecification) => (first && f.moduleId.includes(first) ? 0 : 1);
    return [...files].sort((a, b) => rank(a) - rank(b) || (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
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
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
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
    // Root-level only (Vitest does not allow a sequencer per project); unit files run in parallel
    // anyway, so the order only matters for the sequential integration project.
    sequence: { sequencer: NameSequencer },
    coverage: { provider: "v8", include: ["src/domain/**", "src/server/**"] },
  },
});
