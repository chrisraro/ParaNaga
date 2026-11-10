// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDryRun, ImportList } from "@/domain/admin/stops";
import type { RevisionList, RevisionRow } from "@/domain/admin/schemas";
import { ImportsScreen } from "@/ui/admin/imports";
import { RevisionsScreen } from "@/ui/admin/revisions";

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
