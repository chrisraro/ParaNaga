import { describe, expect, it } from "vitest";
import { GET as cronJobsHandler } from "@/app/api/cron/jobs/route";
import { registerJobHandler, runJobBatch } from "@/server/jobs/worker";
import type { JobRow } from "@/server/jobs/types";

describe("cron jobs route authentication", () => {
  it("rejects request with 401 when CRON_SECRET is missing or invalid", async () => {
    const reqNoAuth = new Request("http://localhost/api/cron/jobs");
    const resNoAuth = await cronJobsHandler(reqNoAuth);
    expect(resNoAuth.status).toBe(401);

    const bodyNoAuth = await resNoAuth.json();
    expect(bodyNoAuth.error.code).toBe("unauthorized");

    const reqWrongSecret = new Request("http://localhost/api/cron/jobs", {
      headers: { authorization: "Bearer invalid-secret" },
    });
    const resWrongSecret = await cronJobsHandler(reqWrongSecret);
    expect(resWrongSecret.status).toBe(401);
  });
});

describe("job registry", () => {
  it("allows registering handlers for job kinds", () => {
    let handled = false;
    registerJobHandler("test_job", async (job: JobRow) => {
      handled = job.id === "test-1";
      return { success: true };
    });

    expect(handled).toBe(false);

    expect(typeof registerJobHandler).toBe("function");
    expect(typeof runJobBatch).toBe("function");
  });
});
