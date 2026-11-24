// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDryRun, ImportList, StopList, StopRow } from "@/domain/admin/stops";
import type { AdminDashboard as DashboardData, RevisionList, RevisionRow } from "@/domain/admin/schemas";
import type { StaffList } from "@/domain/admin/system";
import AdminError from "@/app/admin/error";
import { AdminDashboard } from "@/ui/admin/dashboard";
import { ImportsScreen } from "@/ui/admin/imports";
import { RevisionsScreen } from "@/ui/admin/revisions";
import { StopsScreen } from "@/ui/admin/stops";
import { UsersScreen } from "@/ui/admin/users";

// The admin screens' state machines: what was reviewed is what gets sent, and a step-up belongs
// to the action that asked for it. The API module is replaced; nothing here reaches the network.

const api = vi.hoisted(() => ({
  fetchImports: vi.fn(),
  importDryRun: vi.fn(),
  importCommit: vi.fn(),
  fetchRevisions: vi.fn(),
  createDraft: vi.fn(),
  validate: vi.fn(),
  publish: vi.fn(),
  fetchDashboard: vi.fn(),
  fetchModeration: vi.fn(),
  fetchStops: vi.fn(),
  stopAction: vi.fn(),
  uploadStopPhoto: vi.fn(),
  fetchStaff: vi.fn(),
  findUser: vi.fn(),
  changeRole: vi.fn(),
}));
vi.mock("@/client/admin/api", () => api);
vi.mock("@/client/auth/step-up", () => ({
  sendStepUpCode: vi.fn(async () => ({ ok: true })),
  verifyStepUpCode: vi.fn(async () => ({ ok: true })),
}));

const ok = <T,>(data: T) => ({ ok: true as const, data });
const STEP_UP = { ok: false as const, status: 403, code: "step_up_required", message: "A fresh code is needed." };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});
afterEach(cleanup);

describe("ImportsScreen: commit sends the upload the dry run reviewed", () => {
  const BATCH = "00000000-0000-4000-8000-000000000001";
  const DRY: ImportDryRun = {
    snapshotVersion: "mymaps:naga:2026-10-20",
    mapId: "naga",
    fileName: "naga.kml",
    sha256: "abc",
    bytes: 6,
    baseline: { batchId: BATCH, snapshotVersion: "mymaps:naga:2026-10-15" },
    counts: { total: 1, byLayer: { A: 1 }, expectedTotal: 1, expectedByLayer: { A: 1 } },
    changes: { added: 0, changed: 1, unchanged: 0, missing: 0 },
    rows: [],
    conflicts: [],
    problems: [],
    canCommit: true,
  };
  const LIST: ImportList = { baseline: null, batches: [] };
  const upload = (retrievedOn: string) => ({ format: "kml", fileName: "naga.kml", text: "<kml/>", retrievedOn });

  const setDate = (v: string) => fireEvent.change(screen.getByTestId("import-date"), { target: { value: v } });
  async function pickFileAndDate(date: string) {
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [new File(["<kml/>"], "naga.kml")] } });
    setDate(date);
    await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>("import-dry-run").disabled).toBe(false));
  }

  beforeEach(() => {
    api.fetchImports.mockResolvedValue(ok(LIST));
    api.importDryRun.mockResolvedValue(ok(DRY));
    api.importCommit.mockResolvedValue(ok({ outcome: "committed", batchId: BATCH, snapshotVersion: "mymaps:naga:2026-10-20", revisionId: null, counts: {} }));
  });

  it("commits exactly the payload of the dry run on screen", async () => {
    render(<ImportsScreen />);
    await pickFileAndDate("2026-10-20");
    fireEvent.click(screen.getByTestId("import-dry-run"));
    fireEvent.click(await screen.findByTestId("import-commit"));
    await screen.findByTestId("import-commit-result");
    expect(api.importDryRun).toHaveBeenCalledWith(upload("2026-10-20"));
    expect(api.importCommit).toHaveBeenCalledTimes(1);
    expect(api.importCommit).toHaveBeenCalledWith(upload("2026-10-20"), BATCH);
  });

  it("drops the dry run when the date or the format changes, so nothing unreviewed can be committed", async () => {
    render(<ImportsScreen />);
    await pickFileAndDate("2026-10-20");
    fireEvent.click(screen.getByTestId("import-dry-run"));
    await screen.findByTestId("import-commit");
    setDate("2026-10-21");
    expect(screen.queryByTestId("import-dry")).toBeNull();
    expect(screen.queryByTestId("import-commit")).toBeNull();

    fireEvent.click(screen.getByTestId("import-dry-run"));
    await screen.findByTestId("import-commit");
    fireEvent.change(screen.getByTestId("import-format"), { target: { value: "csv" } });
    expect(screen.queryByTestId("import-commit")).toBeNull();
    expect(api.importCommit).not.toHaveBeenCalled();
  });

  it("ignores a dry run that answers after the upload changed, and locks the file while one runs", async () => {
    let answer!: (r: unknown) => void;
    api.importDryRun.mockReturnValueOnce(new Promise((r) => (answer = r)));
    render(<ImportsScreen />);
    await pickFileAndDate("2026-10-20");
    fireEvent.click(screen.getByTestId("import-dry-run"));
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("import-file").disabled).toBe(true));
    setDate("2026-10-21");
    answer(ok(DRY));
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("import-file").disabled).toBe(false));
    expect(screen.queryByTestId("import-dry")).toBeNull();
  });
});

describe("RevisionsScreen: a step-up belongs to the revision that asked for it", () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const row = (n: number, label: string, status: RevisionRow["status"]): RevisionRow => ({
    id: id(n),
    seq: n,
    label,
    kind: "provisional",
    status,
    createdAt: "2026-10-20T00:00:00.000Z",
    publishedAt: null,
    parentId: null,
    isSynthetic: false,
    memberCount: 1,
    isPublished: status === "published",
    validation: status === "published" ? null : { ok: true, validatedAt: "2026-10-22T00:00:00.000Z", errorCount: 0, warningCount: 0, current: true },
  });
  const LIST: RevisionList = { publishedId: id(2), revisions: [row(3, "draft-c", "draft"), row(2, "live-b", "published"), row(1, "old-a", "superseded")] };

  it("picking another revision during a step-up goes back to that revision's confirm step", async () => {
    api.fetchRevisions.mockResolvedValue(ok(LIST));
    api.publish.mockResolvedValue(STEP_UP);
    render(<RevisionsScreen />);

    fireEvent.click(await screen.findByTestId("publish-draft-c"));
    fireEvent.click(screen.getByTestId("confirm-publication-go"));
    await screen.findByTestId("admin-step-up");
    expect(api.publish.mock.calls).toEqual([[id(3), "publish", id(2)]]);

    // Another target while the code panel is open: the panel goes, nothing runs.
    fireEvent.click(screen.getByTestId("rollback-old-a"));
    expect(screen.queryByTestId("admin-step-up")).toBeNull();
    expect(screen.getByTestId("confirm-publication").textContent).toContain("Roll back to old-a?");
    expect(screen.getByTestId("confirm-publication-go").textContent).toBe("Roll back now");
    expect(api.publish).toHaveBeenCalledTimes(1);

    // Its own confirm click, then its own step-up; the code runs the roll back that was confirmed.
    fireEvent.click(screen.getByTestId("confirm-publication-go"));
    fireEvent.click(await screen.findByTestId("admin-step-up-send"));
    fireEvent.change(await screen.findByTestId("admin-step-up-code"), { target: { value: "123456" } });
    api.publish.mockResolvedValue(ok({}));
    fireEvent.click(screen.getByTestId("admin-step-up-verify"));
    await waitFor(() => expect(screen.getByTestId("admin-notice").textContent).toContain("Rolled back to old-a."));
    expect(api.publish.mock.calls).toEqual([
      [id(3), "publish", id(2)],
      [id(1), "rollback", id(2)],
      [id(1), "rollback", id(2)],
    ]);
    expect(screen.queryByTestId("confirm-publication")).toBeNull();
  });

  it("reads Working… on the confirm button only while its own request runs", async () => {
    api.fetchRevisions.mockResolvedValue(ok(LIST));
    let answer!: (r: unknown) => void;
    api.publish.mockReturnValue(new Promise((r) => (answer = r)));
    render(<RevisionsScreen />);
    fireEvent.click(await screen.findByTestId("publish-draft-c"));
    const go = screen.getByTestId<HTMLButtonElement>("confirm-publication-go");
    expect(go.textContent).toBe("Publish now");
    fireEvent.click(go);
    await waitFor(() => expect(go.textContent).toBe("Working…"));
    expect(screen.getByTestId<HTMLButtonElement>("rollback-old-a").disabled).toBe(true);
    answer(STEP_UP);
    await screen.findByTestId("admin-step-up");
    expect(go.textContent).toBe("Publish now");
    expect(go.disabled).toBe(true); // the code panel is the way forward, not a second confirm
  });
});

describe("AdminDashboard: all clear is only said about what was counted (A11)", () => {
  const CLEAR: DashboardData = {
    published: { id: "00000000-0000-4000-8000-000000000002", seq: 2, label: "live-b", kind: "provisional", publishedAt: "2026-10-16T03:00:00.000Z" },
    drafts: 0,
    latestDraft: null,
    stopsTotal: 10,
    stopCandidates: 0,
    openCorrections: 0,
    lastImport: null,
  };
  const some = (n: number) => Array.from({ length: n }, () => ({}));
  const queue = (items: number, appeals: number, reports = 0) => ok({ items: some(items), reports: some(reports), appeals: some(appeals), history: [] });
  const FAILED = { ok: false as const, status: 0, code: null, message: "The request failed. Check the connection and try again." };
  const attention = async () => (await screen.findByTestId("card-attention")).textContent ?? "";

  beforeEach(() => {
    api.fetchDashboard.mockResolvedValue(ok(CLEAR));
  });

  it("names every queue it counted when nothing is waiting", async () => {
    api.fetchModeration.mockResolvedValue(queue(0, 0));
    render(<AdminDashboard transit corrections moderation />);
    expect(await attention()).toContain("Nothing is waiting on you. A published revision is live and no draft, stop candidate, correction, moderation item, content report or appeal is open.");
  });

  it("counts the moderation queue, the reported items and the appeals", async () => {
    api.fetchModeration.mockResolvedValue(queue(2, 1, 3));
    render(<AdminDashboard transit corrections moderation />);
    const text = await attention();
    expect(text).toContain("2 items (posts, comments or photos) waiting for a decision.");
    expect(text).toContain("3 reported items (posts or comments) to look at.");
    expect(text).toContain("1 appeal to decide.");
    expect(text).not.toContain("Nothing is waiting");
  });

  it("says so when a queue could not be counted, and never counts driver reports", async () => {
    api.fetchModeration.mockResolvedValue(FAILED);
    render(<AdminDashboard transit corrections moderation complaints />);
    const text = await attention();
    expect(text).toContain("The moderation queue could not be counted just now.");
    expect(text).toContain("Driver reports");
    expect(text).toContain("Not counted here");
    expect(text).not.toContain("Nothing is waiting");
  });

  it("a moderator alone gets the claim about the moderation queue only", async () => {
    api.fetchModeration.mockResolvedValue(queue(0, 0));
    render(<AdminDashboard transit={false} corrections={false} moderation />);
    expect(await attention()).toContain("Nothing is waiting on you. No moderation item, content report or appeal is open.");
    expect(api.fetchDashboard).not.toHaveBeenCalled();
  });

  it("a failed load offers Retry, which loads again (A10)", async () => {
    api.fetchDashboard.mockResolvedValueOnce(FAILED);
    render(<AdminDashboard transit corrections moderation={false} />);
    expect((await screen.findByTestId("admin-dashboard-error")).textContent).toContain("The request failed.");
    expect(screen.queryByTestId("card-attention")).toBeNull();
    fireEvent.click(screen.getByTestId("load-retry"));
    expect((await screen.findByTestId("published-label")).textContent).toBe("live-b");
    expect(api.fetchDashboard).toHaveBeenCalledTimes(2);
  });
});

describe("StopsScreen: what was typed for a stop is not dropped silently (A7)", () => {
  const sid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const stop = (n: number, code: string, name: string, version = n + 50): StopRow =>
    ({
      stopPointId: sid(n), versionId: sid(version), name, aliases: [], status: "candidate", layer: "Loop Service A", code, labelRaw: name,
      lat: 13.62, lng: 123.18, curbSide: null, boardingAllowed: null, alightingAllowed: null, navigationApproved: false, editNote: null, isSynthetic: false,
      sequences: [], pins: [], evidence: [],
    }) as StopRow;
  const list = (...stops: StopRow[]): StopList => ({ revision: { id: sid(99), label: "draft-c", kind: "provisional", status: "draft" }, editable: true, stops }) as StopList;
  const open = (code: string) => fireEvent.click(within(screen.getByTestId(`stop-Loop Service A-${code}`)).getByRole("button"));
  const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

  beforeEach(() => {
    api.fetchStops.mockResolvedValue(ok(list(stop(1, "A1", "Plaza Rizal"), stop(2, "A2", "Cathedral"))));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks before another row replaces a form with unsent text; an untouched panel just switches", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StopsScreen mode="candidates" />);
    await screen.findByTestId("stops-table");
    open("A1");
    open("A2");
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("stop-panel").textContent).toContain("Cathedral");

    type("retire-reason", "Not a stop: a private driveway.");
    open("A1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toContain("Leave A2?");
    expect(screen.getByTestId("stop-panel").textContent).toContain("Cathedral");
    expect(screen.getByTestId<HTMLInputElement>("retire-reason").value).toBe("Not a stop: a private driveway.");

    confirm.mockReturnValue(true);
    open("A1");
    expect(screen.getByTestId("stop-panel").textContent).toContain("Plaza Rizal");
    expect(screen.getByTestId<HTMLInputElement>("retire-reason").value).toBe("");
  });

  it("sending one form keeps the text of the others, and a sent form no longer counts as unsent", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    api.stopAction.mockResolvedValue(ok({}));
    render(<StopsScreen mode="candidates" />);
    await screen.findByTestId("stops-table");
    open("A1");
    type("retire-reason", "Duplicate of A2.");
    type("evidence-note", "Ordinance list names it.");
    // The action made a new version of the stop: the list comes back with it.
    api.fetchStops.mockResolvedValue(ok(list(stop(1, "A1", "Plaza Rizal", 77), stop(2, "A2", "Cathedral"))));
    fireEvent.click(screen.getByTestId("evidence-go"));
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>("evidence-note").value).toBe(""));
    expect(api.stopAction.mock.calls[0]![1]).toMatchObject({ action: "evidence", expectedVersionId: sid(51), note: "Ordinance list names it." });
    expect(screen.getByTestId<HTMLInputElement>("retire-reason").value).toBe("Duplicate of A2.");

    // The other form now sends the version the list came back with.
    fireEvent.click(screen.getByTestId("retire-go"));
    await waitFor(() => expect(api.stopAction).toHaveBeenCalledTimes(2));
    expect(api.stopAction.mock.calls[1]![1]).toEqual({ action: "retire", expectedVersionId: sid(77), reason: "Duplicate of A2." });
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("retire-reason").value).toBe(""));
    open("A2");
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("stop-panel").textContent).toContain("Cathedral");
  });
});

describe("UsersScreen: revoking a role asks once more (A9)", () => {
  const role = (r: string) => ({ role: r, active: true, grantedAt: "2026-10-01T00:00:00.000Z", grantedBy: "Owner", revokedAt: null, reason: "seed" });
  const STAFF = {
    staff: [
      { userId: "u-me", name: "Me", email: "me@example.com", self: true, suspended: false, roles: [role("commuter"), role("admin")] },
      { userId: "u-ana", name: "Ana", email: "ana@example.com", self: false, suspended: false, roles: [role("commuter"), role("transport_reviewer")] },
    ],
  } as StaffList;

  it("nothing is sent until the confirm step is answered; Cancel sends nothing", async () => {
    api.fetchStaff.mockResolvedValue(ok(STAFF));
    api.changeRole.mockResolvedValue(ok({ ok: true }));
    render(<UsersScreen />);
    const revoke = await screen.findByTestId("revoke-u-ana-transport_reviewer");
    fireEvent.click(revoke);
    expect(screen.getByTestId("user-error-u-ana").textContent).toContain("Give a reason");
    expect(screen.queryByTestId("revoke-confirm-u-ana")).toBeNull();

    fireEvent.change(screen.getByTestId("reason-u-ana"), { target: { value: "Left the field team." } });
    fireEvent.click(revoke);
    const step = screen.getByTestId("revoke-confirm-u-ana");
    expect(step.textContent).toContain("Revoke Transport reviewer from Ana?");
    expect(step.textContent).toContain("Left the field team.");
    expect(document.activeElement?.textContent).toBe("Revoke Transport reviewer from Ana?");
    fireEvent.click(within(step).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("revoke-confirm-u-ana")).toBeNull();
    expect(api.changeRole).not.toHaveBeenCalled();

    fireEvent.click(revoke);
    fireEvent.click(screen.getByTestId("revoke-confirm-u-ana-go"));
    await waitFor(() => expect(screen.getByTestId("users-notice").textContent).toContain("Revoked Transport reviewer from Ana."));
    expect(api.changeRole.mock.calls).toEqual([[{ userId: "u-ana", role: "transport_reviewer", change: "revoke", reason: "Left the field team." }]]);
    expect(screen.queryByTestId("revoke-confirm-u-ana")).toBeNull();
  });
});

describe("admin error boundary (A10)", () => {
  it("offers Retry and never shows what was thrown", () => {
    const retry = vi.fn();
    render(<AdminError error={new Error("report PN-7KQ4-2M: plate ABC 1234")} retry={retry} />);
    const shown = screen.getByTestId("admin-error").textContent ?? "";
    expect(shown).toContain("This screen could not be shown");
    expect(shown).not.toMatch(/PN-7KQ4|ABC 1234/);
    fireEvent.click(screen.getByTestId("admin-error-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
