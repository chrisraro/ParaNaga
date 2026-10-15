import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// Integration files share one Neon branch and run one at a time; a fixed (alphabetical) order
// keeps import-naga.test.ts, which expects the first commit of the import, ahead of the files
// that reuse its data. Unit files keep Vitest's default ordering.
class ByProjectThenPath extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const integration = sorted
      .filter((f) => f.project.name === "integration")
      .sort((a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0));
    let next = 0;
    return sorted.map((f) => (f.project.name === "integration" ? integration[next++]! : f));
  }
}

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url));

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
          fileParallelism: false,
        },
      },
    ],
    sequence: { sequencer: ByProjectThenPath },
    coverage: { provider: "v8", include: ["src/domain/**", "src/server/**"] },
  },
});
