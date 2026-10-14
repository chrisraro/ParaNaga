import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
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
    coverage: { provider: "v8", include: ["src/domain/**", "src/server/**"] },
  },
});
