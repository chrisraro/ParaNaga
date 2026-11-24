// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearReportDraft, readReportDraft, saveReportDraft, type ReportDraft } from "@/client/corrections/draft";

const draft: ReportDraft = { category: "wrong_curb_side", entityType: "stop", entityText: "", description: "The sign moved.", hadLocation: true };

beforeEach(() => window.sessionStorage.clear());

describe("report draft kept while signing in", () => {
  it("comes back for the same report only, and is gone once cleared", () => {
    saveReportDraft("stop:a", draft, 1000);
    expect(readReportDraft("route:b", 2000)).toBeNull();
    expect(readReportDraft("stop:a", 2000)).toEqual(draft);
    clearReportDraft();
    expect(readReportDraft("stop:a", 2000)).toBeNull();
  });

  it("is ignored after 30 minutes, and when malformed", () => {
    saveReportDraft("stop:a", draft, 1000);
    expect(readReportDraft("stop:a", 1000 + 30 * 60_000)).toBeNull();
    window.sessionStorage.setItem("paranaga.reportDraft", "{bad");
    expect(readReportDraft("stop:a")).toBeNull();
    window.sessionStorage.setItem("paranaga.reportDraft", JSON.stringify({ ...draft, category: "x", report: "stop:a", savedAt: Date.now() }));
    expect(readReportDraft("stop:a")).toBeNull();
  });
});
